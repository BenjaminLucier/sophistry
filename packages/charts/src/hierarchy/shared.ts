/**
 * Shared props and helpers of the hierarchy charts (`treemap`, `icicle`,
 * `sunburst`, `circlePack`, `tree`): layout options, the keyed-transition
 * layout cache, branch colours, tooltip text, label fitting and zoom. Only
 * the props types are public.
 *
 * Each is a factory called once in a composite's `setup`, returning a
 * function its `update` calls with the current props, which recomputes only
 * when its inputs changed (by identity, or shallowly for small records).
 */

import type { ColorInput } from "@sophistry/core/color";
import { lighten } from "@sophistry/core/color";
import { formatTick } from "@sophistry/core/geometry";
import { clamp01, cssColor, mix } from "@sophistry/core/internal";
import type { Theme } from "@sophistry/core/themes";
import { interpolateZoom } from "d3-interpolate";
import type { Channel, ColorChannel } from "../data/channels.js";
import { resolveChannel, resolveColor } from "../data/channels.js";
import type { HierarchyNodeInfo, HierarchyOptions } from "../math/hierarchy.js";
import type { HierarchyJoinInfo } from "../math/hierarchyJoin.js";
import { hierarchyJoin, hierarchyKeys } from "../math/hierarchyJoin.js";
import type { JoinStaging } from "../math/join.js";
import { blendCss } from "../mix.js";
import type { TooltipSpec, TooltipState } from "../tooltip.js";
import { deepEqual, keyedMemo, shallowEqual } from "../util.js";

/** Default label font size of the hierarchy charts, in scene units. */
export const HIERARCHY_LABEL_FONT_SIZE = 0.2;
/** Default per-depth lightening of a branch colour. */
const DEFAULT_DEPTH_LIGHTEN = 0.12;
/** Lightening never goes past this, so deep levels keep their hue. */
const MAX_DEPTH_LIGHTEN = 0.6;

/** Space between a label and its tile's edges, as a fraction of the font size. */
const LABEL_PAD = 0.3;

/**
 * Props every hierarchy chart (`treemap`, `icicle`, `sunburst`,
 * `circlePack`, `tree`) shares. `data` is one object, the root of a nested
 * tree; `value` sizes the leaves and a parent is the sum of its leaves.
 * Channel functions receive `(node, i)` with `i` the node's pre-order
 * position (root 0).
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#hierarchies
 * @category Charts
 */
export interface HierarchyChartBaseProps<T> {
	/** The root of the tree. */
	data: T;
	/**
	 * A node's children: a key of `T` or `(d, i) => T[]`. Anything but a
	 * non-empty array makes the node a leaf. Defaults to the datum's `children` property.
	 */
	children?: Channel<T, readonly T[] | undefined>;
	/**
	 * A leaf's size: a key of `T` or `(d, i) => number`. Required unless `T` is
	 * `number`. A parent's own value is ignored; zero, negative and non-finite
	 * values drop the leaf.
	 */
	value?: Channel<T, number>;
	/** A node's name: drawn where it fits, and used in the tooltip. */
	label?: Channel<T, string>;
	/**
	 * Order siblings by descending value; `false` keeps data order. Colours
	 * never depend on it.
	 * @default true
	 */
	sort?: boolean;
	/** One colour for every node, or `(d, i) => colour` per node (returning nothing falls back to the branch colour). Wins over `colors`. */
	color?: ColorChannel<T>;
	/**
	 * Colours cycled across the top-level branches; every node inherits its
	 * branch's colour. Defaults to the theme's series colours.
	 */
	colors?: readonly ColorInput[];
	/**
	 * How much lighter each level below the top-level branches is drawn, 0..1
	 * toward white (capped at 0.6); 0 keeps one flat colour per branch.
	 * @default 0.12
	 */
	depthLighten?: number;
	/** Fill opacity of the nodes, 0..1. @default 1 */
	fillOpacity?: number;
	/** Draw node names where they fit. @default true */
	labels?: boolean;
	/** Label font size. @default 0.2 */
	labelFontSize?: number;
	/** Reveal, 0..1; each chart documents its own animation. @default 1 */
	progress?: number;
	/** Fraction of the reveal spent staggering, 0..0.95. Each chart documents its default. */
	stagger?: number;
	/** Hover or tap text: `true` for the node's path of names joined by `" / "` plus `": value"`, or `(d, i) => string`. */
	tooltip?: TooltipSpec<T>;
	/** Paint order; labels draw at `zIndex + 1`. */
	zIndex?: number;
	/** `false` hides the chart. @default true */
	visible?: boolean;
}

/**
 * A keyed data transition for a hierarchy chart. Nodes are matched by their
 * path of names; matched nodes move and resize, others fade out or in.
 *
 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
 * @category Charts
 */
export interface HierarchyTransitionProps<T> {
	/**
	 * The tree to transition to (same shape and channels as `data`); give
	 * siblings unique `text` nodes so they match. Matched nodes move in straight
	 * lines, so tiles reordering between the ends slide across each other;
	 * `sort: false`, an order-keeping treemap `tile` or `tile: "resquarify"`
	 * keep every frame a clean tiling. See {@link TransitionProps}.
	 */
	to?: T;
	/** Transition progress from `data` (0) to `to` (1). @default 0 */
	blend?: number;
	/** See {@link TransitionProps.staging}. @default "staged" */
	staging?: JoinStaging;
	/**
	 * Fraction of the enter stage spent staggering entering nodes, 0..0.95, in
	 * the new tree's pre-order (parents before children).
	 * @default 0
	 */
	enterStagger?: number;
}

/** The base and transition prop keys every hierarchy chart declares. */
export const HIERARCHY_PROP_KEYS = [
	"data",
	"children",
	"value",
	"label",
	"sort",
	"color",
	"colors",
	"depthLighten",
	"fillOpacity",
	"labels",
	"labelFontSize",
	"progress",
	"stagger",
	"tooltip",
	"zIndex",
	"visible",
	"to",
	"blend",
	"staging",
	"enterStagger",
] as const;

/** Fields that place a rectangle or partition node. */
export const RECT_FIELDS = ["x0", "x1", "y0", "y1"] as const;
/** Fields that place a packed circle. */
export const CIRCLE_FIELDS = ["x", "y", "r"] as const;

/** A laid-out node, maybe joined across a keyed transition. */
export type Joined<N> = N & Partial<HierarchyJoinInfo>;

/** A hierarchy chart's layout on one update: the frame drawn, and each end's own. */
export interface HierarchyEnds<N> {
	/** `data`'s layout, or with `to` the two ends joined at `blend`. */
	layout: readonly Joined<N>[];
	from: readonly N[];
	to: readonly N[] | undefined;
}

/**
 * A hierarchy chart's layout cache: `data`'s, or with `to` the two ends
 * joined at `blend`. Each end is laid out again only when its tree or a
 * layout input (`deps`) changed; a `blend` scrub re-joins without laying
 * out. Call once, in `setup`.
 *
 * @param fields - The numeric fields that place a node.
 * @internal
 */
export function createHierarchyLayout<T, N extends HierarchyNodeInfo<T>>(
	fields: readonly (keyof N & string)[],
): (
	props: { data: T } & HierarchyTransitionProps<T>,
	layoutOf: (data: T, end: "from" | "to") => N[],
	deps: readonly unknown[],
) => HierarchyEnds<N> {
	const fromMemo = keyedMemo<N[]>();
	const toMemo = keyedMemo<N[]>();
	const joinMemo = keyedMemo<readonly Joined<N>[]>();
	let previous: readonly Joined<N>[] | undefined;
	return (props, layoutOf, deps) => {
		const from = fromMemo([props.data, ...deps], () =>
			layoutOf(props.data, "from"),
		);
		const target = props.to;
		const to =
			target === undefined
				? undefined
				: toMemo([target, ...deps], () => layoutOf(target, "to"));
		if (!to) {
			previous = from;
			return { layout: from, from, to };
		}
		const layout = joinMemo(
			[from, to, props.blend ?? 0, props.staging, props.enterStagger],
			() => {
				const next = hierarchyJoin<T, N>(from, to, {
					blend: props.blend ?? 0,
					staging: props.staging,
					enterStagger: props.enterStagger,
					fields,
				});
				// Keep the nodes a frame did not change (a stage that has not
				// started, or has finished), so their marks hold still.
				const before = previous;
				if (!before || before === from) return next;
				let same = before.length === next.length;
				const kept = next.map((node, i) => {
					const old = before[i];
					if (old && shallowEqual(old, node)) return old;
					same = false;
					return node;
				});
				return same ? before : kept;
			},
		);
		previous = layout;
		return { layout, from, to };
	};
}

/**
 * Each laid-out node's identity across updates: its path of names, as
 * `hierarchyKeys` gives it (the root is `""`). The instance key of its mark.
 * Call once, in `setup`.
 *
 * @internal
 */
export function createHierarchyKeys<T>(): (
	nodes: readonly HierarchyNodeInfo<T>[],
) => readonly string[] {
	let last: { paths: string; keys: string[] } | null = null;
	return (nodes) => {
		// Keys only change with the tree's shape, not with a blend's geometry.
		const paths = nodes.map((node) => node.path.join("\u0000")).join("\u0001");
		if (last && last.paths === paths) return last.keys;
		const keys = hierarchyKeys(nodes);
		last = { paths, keys };
		return keys;
	};
}

/** A node's keyed-transition presence, 1 without one. @internal */
export function presenceOf(node: Partial<HierarchyJoinInfo>): number {
	return node.presence ?? 1;
}

/**
 * Fill colours by layout position, blended in OKLCH between the ends of a
 * keyed transition. Call once, in `setup`.
 *
 * @internal
 */
export function createHierarchyFills<T>(): (
	props: HierarchyChartBaseProps<T>,
	theme: Theme,
	ends: HierarchyEnds<HierarchyNodeInfo<T>>,
) => readonly string[] {
	const fromMemo = keyedMemo<string[]>();
	const toMemo = keyedMemo<string[] | undefined>();
	const blendMemo = keyedMemo<readonly string[]>();
	const stable = (() => {
		let last: readonly string[] | null = null;
		return (next: readonly string[]) => {
			if (last && shallowEqual(last, next)) return last;
			last = next;
			return next;
		};
	})();
	return (props, theme, ends) => {
		const inputs = [props.color, props.colors, props.depthLighten, theme];
		const a = fromMemo([...inputs, ends.from], () =>
			hierarchyColors(props, theme, ends.from),
		);
		const end = ends.to;
		const b = toMemo([...inputs, end], () =>
			end ? hierarchyColors(props, theme, end) : undefined,
		);
		if (!b) return stable(a);
		return stable(
			blendMemo([a, b, ends.layout, theme], () =>
				ends.layout.map((node) => {
					const p = (node.fromAt ?? -1) >= 0 ? a[node.fromAt ?? -1] : undefined;
					const q = (node.toAt ?? -1) >= 0 ? b[node.toAt ?? -1] : undefined;
					if (p !== undefined && q !== undefined)
						return blendCss(p, q, node.update ?? 0);
					return p ?? q ?? theme.palette.foreground;
				}),
			),
		);
	};
}

/** The layout accessors for a hierarchy chart's channel props. @internal */
export function hierarchyOptions<T>(
	props: HierarchyChartBaseProps<T>,
): HierarchyOptions<T> {
	return {
		children: resolveChannel<T, readonly T[] | undefined>(
			props.children,
			undefined,
			"children",
		),
		value: resolveChannel<T, number>(props.value, undefined, "value"),
		label: resolveChannel<T, string>(props.label, undefined, "label"),
		sort: props.sort,
	};
}

/** The props {@link hierarchyOptions} reads: a layout cache's dependencies. @internal */
export function hierarchyOptionDeps<T>(
	props: HierarchyChartBaseProps<T>,
): unknown[] {
	return [props.children, props.value, props.label, props.sort];
}

/**
 * One fill per laid-out node: the `color` channel, else the branch colour
 * lightened by depth; a root with children takes the theme's muted colour.
 *
 * @internal
 */
function hierarchyColors<T>(
	props: HierarchyChartBaseProps<T>,
	theme: Theme,
	nodes: readonly HierarchyNodeInfo<T>[],
): string[] {
	const explicit = resolveColor(props.color);
	const palette = props.colors ?? theme.palette.series;
	const step = Math.max(0, props.depthLighten ?? DEFAULT_DEPTH_LIGHTEN) || 0;
	const base = (branch: number): ColorInput =>
		palette.length === 0
			? theme.palette.foreground
			: (palette[branch % palette.length] as ColorInput);
	return nodes.map((node) => {
		const own = explicit?.(node.datum, node.index);
		if (own) return own;
		if (node.branch < 0) {
			return cssColor(node.leaf ? base(0) : theme.palette.muted);
		}
		const amount = Math.min(MAX_DEPTH_LIGHTEN, step * (node.depth - 1));
		const color = base(node.branch);
		return cssColor(amount > 0 ? lighten(color, amount) : color);
	});
}

/** The default tooltip text: the path below the root joined by `" / "`, then `": value"`. @internal */
export function hierarchyTooltipText<T>(node: HierarchyNodeInfo<T>): string {
	const names = node.path.slice(1).filter((name) => name !== "");
	const head = names.length > 0 ? names.join(" / ") : node.label;
	const value = formatTick(node.value);
	return head ? `${head}: ${value}` : value;
}

/** The pad between a label and its tile edge, for a font size. */
export function labelPad(fontSize: number): number {
	return LABEL_PAD * fontSize;
}

/**
 * A node to zoom into: its names below the root (`[]` is the root,
 * `["src", "lib"]` is "lib" inside "src"), or a predicate picking the first
 * matching node in pre-order. A path that stops matching zooms as far as it got.
 *
 * @category Charts
 */
export type HierarchyFocus<T> =
	| readonly string[]
	| ((datum: T, index: number) => boolean);

/**
 * What a zoomable hierarchy chart shows: one node, or a `{ from, to, t }`
 * transition between two that scrubs. Either end may itself be a
 * transition, so an interrupted zoom starts from where it had reached.
 *
 * @see https://sophistry.dev/guides/chart-animation/#domain-transitions
 * @category Charts
 */
export type HierarchyFocusSpec<T> =
	| HierarchyFocus<T>
	| {
			from: HierarchyFocusSpec<T>;
			to: HierarchyFocusSpec<T>;
			t: number;
	  };

/** A window onto a hierarchy layout, in the layout's own units. */
export interface HierarchyView {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

/** A focus spec with every end found in the layout. @internal */
export type ResolvedFocus =
	| { at: number }
	| { from: ResolvedFocus; to: ResolvedFocus; t: number };

/** The pre-order position of the node `focus` names, or 0 (the root). @internal */
export function findFocus<T>(
	nodes: readonly HierarchyNodeInfo<T>[],
	focus: HierarchyFocus<T> | undefined,
): number {
	if (nodes.length === 0 || focus === undefined) return 0;
	if (typeof focus === "function") {
		const found = nodes.findIndex((n) => focus(n.datum, n.index));
		return found < 0 ? 0 : found;
	}
	let at = 0;
	for (const name of focus) {
		const child = nodes.findIndex((n) => n.parent === at && n.label === name);
		if (child < 0) break;
		at = child;
	}
	return at;
}

/** Every end of a focus spec found in the layout. @internal */
export function resolveFocus<T>(
	nodes: readonly HierarchyNodeInfo<T>[],
	spec: HierarchyFocusSpec<T> | undefined,
): ResolvedFocus {
	if (
		spec !== undefined &&
		typeof spec === "object" &&
		!Array.isArray(spec) &&
		"from" in spec
	) {
		const t = spec.t;
		return {
			from: resolveFocus(nodes, spec.from),
			to: resolveFocus(nodes, spec.to),
			t: t > 0 ? (t < 1 ? t : 1) : 0,
		};
	}
	return { at: findFocus(nodes, spec as HierarchyFocus<T> | undefined) };
}

/** Whether a resolved focus is mid-transition, i.e. the view is moving. @internal */
export function isZooming(focus: ResolvedFocus): boolean {
	if ("at" in focus) return false;
	if (focus.t <= 0) return isZooming(focus.from);
	if (focus.t >= 1) return isZooming(focus.to);
	return true;
}

/** Where a resolved focus is heading: its last `to`'s node. */
function targetOf(focus: ResolvedFocus): number {
	return "at" in focus ? focus.at : targetOf(focus.to);
}

/** Every node position a resolved focus mentions, ascending, once each. */
function positionsOf(focus: ResolvedFocus): number[] {
	const out = new Set<number>();
	const visit = (f: ResolvedFocus) => {
		if ("at" in f) out.add(f.at);
		else {
			visit(f.from);
			visit(f.to);
		}
	};
	visit(focus);
	return [...out].sort((a, b) => a - b);
}

/** Whether the node at `position` is `ancestor` or below it. @internal */
export function isWithin<T>(
	nodes: readonly HierarchyNodeInfo<T>[],
	position: number,
	ancestor: number,
): boolean {
	for (let at = position; at >= 0; at = nodes[at]?.parent ?? -1) {
		if (at === ancestor) return true;
	}
	return false;
}

/** Two windows blended linearly: every edge moves at a constant rate. */
export function lerpView(
	a: HierarchyView,
	b: HierarchyView,
	t: number,
): HierarchyView {
	return {
		x0: mix(a.x0, b.x0, t),
		x1: mix(a.x1, b.x1, t),
		y0: mix(a.y0, b.y0, t),
		y1: mix(a.y1, b.y1, t),
	};
}

/**
 * Two square windows blended along van Wijk and Nuij's smooth zoom path:
 * constant apparent speed, pulling out and back in between distant nodes.
 */
export function smoothZoomView(
	a: HierarchyView,
	b: HierarchyView,
	t: number,
): HierarchyView {
	const [x, y, w] = interpolateZoom(
		[(a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2, a.x1 - a.x0],
		[(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.x1 - b.x0],
	)(t);
	return { x0: x - w / 2, x1: x + w / 2, y0: y - w / 2, y1: y + w / 2 };
}

/** A zoomable hierarchy chart's camera on one update. See {@link createHierarchyZoom}. @internal */
export interface HierarchyZoom {
	/** The window the focus asks for. */
	view: HierarchyView;
	/** A node's presence: 1 inside the focused subtree, 0 outside, blended. */
	weight(position: number): number;
	/** The node the focus is heading for. */
	target: number;
	resolved: ResolvedFocus;
}

/**
 * A zoomable hierarchy chart's camera: the window `focus` asks for, and each
 * node's presence (1 inside the focused subtree, 0 outside, blended). The
 * resolved focus and the subtree tables are cached across updates (a zoom
 * scrub touches neither). Call once, in `setup`.
 *
 * @internal
 */
export function createHierarchyZoom<T>(): (
	nodes: readonly HierarchyNodeInfo<T>[],
	focus: HierarchyFocusSpec<T> | undefined,
	viewOf: (position: number) => HierarchyView,
	blend?: (a: HierarchyView, b: HierarchyView, t: number) => HierarchyView,
) => HierarchyZoom {
	let resolvedLast: ResolvedFocus | null = null;
	const insideMemo = keyedMemo<Map<number, boolean[]>>();
	let viewLast: HierarchyView | null = null;
	return (nodes, focus, viewOf, blend = lerpView) => {
		const next = resolveFocus(nodes, focus);
		const resolved =
			resolvedLast && deepEqual(resolvedLast, next) ? resolvedLast : next;
		resolvedLast = resolved;
		const positions = positionsOf(resolved);
		/** For each focused node, whether each node is inside its subtree. */
		const inside = insideMemo([nodes, positions.join(",")], () => {
			const map = new Map<number, boolean[]>();
			for (const at of positions) {
				map.set(
					at,
					nodes.map((_, i) => (at === 0 ? true : isWithin(nodes, i, at))),
				);
			}
			return map;
		});
		const viewAt = (f: ResolvedFocus): HierarchyView =>
			"at" in f
				? viewOf(f.at)
				: f.t <= 0
					? viewAt(f.from)
					: f.t >= 1
						? viewAt(f.to)
						: blend(viewAt(f.from), viewAt(f.to), f.t);
		const fresh = viewAt(resolved);
		const view = viewLast && shallowEqual(viewLast, fresh) ? viewLast : fresh;
		viewLast = view;
		const weightIn = (f: ResolvedFocus, position: number): number => {
			if ("at" in f) return inside.get(f.at)?.[position] ? 1 : 0;
			const a = f.t >= 1 ? 0 : weightIn(f.from, position);
			const b = f.t <= 0 ? 0 : weightIn(f.to, position);
			return a + (b - a) * f.t;
		};
		return {
			view,
			target: targetOf(resolved),
			resolved,
			weight: (position) => weightIn(resolved, position),
		};
	};
}

/**
 * Where a tap drills: the focused node zooms out to its parent, a node with
 * children zooms in, a leaf zooms to its parent; -1 when nothing would move.
 *
 * @internal
 */
export function drillTarget<T>(
	nodes: readonly HierarchyNodeInfo<T>[],
	focus: number,
	tapped: number,
): number {
	const node = nodes[tapped];
	if (!node) return -1;
	const to = tapped === focus ? node.parent : node.leaf ? node.parent : tapped;
	return to < 0 || to === focus ? -1 : to;
}

/** A layout interval seen through the window `[v0, v1]`, clamped, as fractions 0..1. @internal */
export function throughView(
	lo: number,
	hi: number,
	v0: number,
	v1: number,
): [number, number] {
	const span = v1 - v0;
	if (!(Math.abs(span) > 1e-12)) return [0, 0];
	return [clamp01((lo - v0) / span), clamp01((hi - v0) / span)];
}

/**
 * Closes the chart's open tooltip whenever the view or the layout moved
 * since the last update, so it never points at a node's old place. Call
 * once, in `setup`; call the result in every update.
 *
 * @internal
 */
export function createTooltipCloser(): (
	tooltip: TooltipState,
	moved: readonly unknown[],
) => void {
	let last: readonly unknown[] | null = null;
	return (tooltip, moved) => {
		if (last && !shallowEqual(last, moved)) {
			const open = tooltip.active.peek();
			if (open) tooltip.hide(open.owner);
		}
		last = moved;
	};
}
