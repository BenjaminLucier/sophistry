/**
 * `breadcrumbs`: a trail of names for a drill-down, and the trail a zoomable
 * hierarchy chart draws for its own `breadcrumbs` prop.
 *
 * A trail is a handful of words, each its own tap target and tab stop, so
 * every crumb, separator and the back control stay `label` nodes (keyed by
 * the crumb's path, so a crumb cross-fading through a zoom keeps its node).
 */

import type {
	CompositeContext,
	KeyboardBehaviour,
	LabelProps,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate, label } from "@sophistry/core";
import type { Bounds, Point } from "@sophistry/core/geometry";
import { clamp01 } from "@sophistry/core/internal";
import type { BreadcrumbItem, HierarchyPathSpec } from "../math/breadcrumbs.js";
import { breadcrumbLayout, isPathTransition } from "../math/breadcrumbs.js";
import type { HierarchyNodeInfo } from "../math/hierarchy.js";
import { textWidth } from "../text-width.js";
import { deepEqual, keyedMemo } from "../util.js";
import type { HierarchyBreadcrumbOptions, HierarchyDrill } from "./drill.js";
import type { ResolvedFocus } from "./shared.js";

const DEFAULT_FONT_SIZE = 0.24;
const DEFAULT_SEPARATOR = "›";
const DEFAULT_BACK = "←";
/** Space each side of a separator, as a fraction of the font size. */
const GAP = 0.35;
/** A crumb's tap target reaches this far past its text, as a fraction of the font size. */
const HIT_PAD = 0.25;
/** The weight crumbs are measured at: `label`'s. */
const CRUMB_WEIGHT = 500;

/** @category Charts */
export interface BreadcrumbsProps {
	/**
	 * The trail: names below the root (`[]` is the root alone), or a `{ from, to, t }` transition
	 * such as {@link createDrillDown}'s `focus`, so the crumbs follow a zoom.
	 */
	path: HierarchyPathSpec;
	/**
	 * The root crumb's text.
	 * @default "All"
	 */
	root?: string;
	/**
	 * Anchor x.
	 * @default 0
	 */
	x?: number;
	/**
	 * Anchor y (the text's vertical middle).
	 * @default 0
	 */
	y?: number;
	/**
	 * Where the anchor is on the trail.
	 * @default "left"
	 */
	align?: "left" | "center" | "right";
	/**
	 * Font size.
	 * @default 0.24
	 */
	fontSize?: number;
	/**
	 * Drawn between crumbs.
	 * @default "›"
	 */
	separator?: string;
	/**
	 * The widest the trail may be: a deeper path collapses its middle into one `…` crumb (tap it to
	 * climb), keeping the root and as many last crumbs as fit. Omitted, the trail never collapses.
	 */
	maxWidth?: number;
	/**
	 * The collapsed crumbs' text.
	 * @default "…"
	 */
	ellipsis?: string;
	/**
	 * A back control before the root crumb: `true` for `"←"`, or its text. With `onSelect`, tapping
	 * it asks for the parent of the node in focus; it fades out at the root. Defaults to none.
	 */
	back?: boolean | string;
	/** The last crumb's colour (the node in focus). Defaults to the theme foreground. */
	color?: string;
	/** The other crumbs' colour, marking them as tappable. Defaults to the theme accent. */
	linkColor?: string;
	/**
	 * Called with a crumb's path when an earlier crumb is tapped (or Enter is pressed on it).
	 * Without it the crumbs are not interactive.
	 */
	onSelect?: (path: string[]) => void;
	/**
	 * Reveal, 0..1: the trail fades in.
	 * @default 1
	 */
	progress?: number;
	/** Paint order; higher draws later. */
	zIndex?: number;
	/**
	 * Set to `false` to hide the trail.
	 * @default true
	 */
	visible?: boolean;
}

/** One keyed label of the trail. */
interface CrumbLabel {
	key: string;
	props: LabelProps;
}

/** What a trail's handlers read on each event. */
interface BreadcrumbsState {
	props: BreadcrumbsProps;
	/** Each crumb's current layout, by key. */
	items: Map<string, BreadcrumbItem>;
	back: { path: string[] | null } | undefined;
	/** Each crumb's tap handler, made once per key. */
	taps: Map<string, () => void>;
	/** The trail's layout, cached on the path and the options it reads. */
	layoutOf: (
		path: HierarchyPathSpec,
		options: readonly unknown[],
	) => ReturnType<typeof breadcrumbLayout>;
}

const breadcrumbStates = new WeakMap<object, BreadcrumbsState>();

/** The trail's text style for measuring. */
function measurer(fontSize: number, fontFamily: string) {
	return (text: string) => textWidth(text, fontSize, fontFamily, CRUMB_WEIGHT);
}

function drawBreadcrumbs(
	ctx: CompositeContext<BreadcrumbsProps>,
	state: BreadcrumbsState,
): SceneNode[] {
	const props = ctx.props;
	state.props = props;
	const theme = ctx.theme;
	const fontSize = props.fontSize ?? DEFAULT_FONT_SIZE;
	const separator = props.separator ?? DEFAULT_SEPARATOR;
	const backText =
		props.back === true
			? DEFAULT_BACK
			: typeof props.back === "string"
				? props.back
				: undefined;
	const layout = state.layoutOf(props.path, [
		fontSize,
		theme.defaults.fontFamily,
		separator,
		props.root,
		props.align,
		props.maxWidth,
		props.ellipsis,
		backText,
	]);
	const x0 = props.x ?? 0;
	const y0 = props.y ?? 0;
	const progress = clamp01(props.progress ?? 1);
	const shown = props.visible !== false && progress > 0;
	const interactive = props.onSelect !== undefined;
	const linkColor = props.linkColor ?? theme.palette.accent;
	const rootName = props.root ?? "All";
	/** A tap target round a run of text starting at `left` (offset from the anchor). */
	const hitBox = (left: number, width: number): Bounds => {
		const pad = HIT_PAD * fontSize;
		return {
			minX: x0 + left - pad,
			maxX: x0 + left + width + pad,
			minY: y0 - fontSize / 2 - pad,
			maxY: y0 + fontSize / 2 + pad,
		};
	};
	const labels: CrumbLabel[] = [];

	const back = layout.back;
	state.back = back ? { path: back.path } : undefined;
	if (backText !== undefined) {
		const opacity = clamp01(back?.weight ?? 0) * progress;
		const tappable =
			interactive && (back?.weight ?? 0) >= 0.5 && back?.path != null;
		const path = back?.path;
		/** "Back to <parent>", the parent named as its crumb is. */
		const name = !path
			? "Back"
			: `Back to ${path.length === 0 ? rootName : path[path.length - 1]}`;
		labels.push({
			key: "\u0000back",
			props: {
				text: backText,
				x: x0 + (back?.x ?? 0),
				y: y0,
				align: "left",
				fontSize,
				color: linkColor,
				opacity,
				zIndex: props.zIndex,
				visible: shown && opacity > 0,
				pointerEvents: interactive ? "bounds" : undefined,
				hitArea: interactive
					? hitBox(back?.x ?? 0, back?.width ?? 0)
					: undefined,
				cursor: interactive && tappable ? "pointer" : undefined,
				label: interactive ? name : undefined,
				focusable: interactive ? shown && tappable : undefined,
				onTap: tappable ? tapOf(state, "\u0000back") : undefined,
				keyboard: interactive ? zoomOutKey(state) : undefined,
			},
		});
	}

	state.items = new Map();
	for (const item of layout.items) {
		state.items.set(item.key, item);
		const opacity = clamp01(item.weight) * progress;
		/** A link back up: an earlier crumb, while it is mostly one. */
		const link = item.current < 0.5;
		const tappable = interactive && link && item.weight >= 0.5;
		/** The ellipsis is named by the crumb it climbs to, as that crumb would be. */
		const name = !item.ellipsis
			? item.name
			: item.path.length === 0
				? rootName
				: (item.path[item.path.length - 1] as string);
		if (item.depth > 0) {
			labels.push({
				key: `\u0000sep${item.key}`,
				props: {
					text: separator,
					x: x0 + item.separatorX,
					y: y0,
					fontSize,
					color: theme.palette.muted,
					opacity,
					zIndex: props.zIndex,
					visible: shown && opacity > 0,
				},
			});
		}
		labels.push({
			key: item.key,
			props: {
				text: item.name,
				x: x0 + item.x,
				y: y0,
				align: "left",
				fontSize,
				color: link ? linkColor : (props.color ?? theme.palette.foreground),
				opacity,
				zIndex: props.zIndex,
				visible: shown && opacity > 0,
				pointerEvents: interactive ? "bounds" : undefined,
				hitArea: interactive ? hitBox(item.x, item.width) : undefined,
				cursor: interactive && tappable ? "pointer" : undefined,
				label: interactive ? name : undefined,
				focusable: interactive ? shown && tappable : undefined,
				onTap: tappable ? tapOf(state, item.key) : undefined,
				keyboard: interactive ? zoomOutKey(state) : undefined,
			},
		});
	}
	return ctx.list("crumbs", labels, {
		key: (entry) => entry.key,
		create: (entry) => label.create(entry.props),
		update: (node, entry) => {
			node.update(entry.props);
		},
	});
}

/** A crumb's tap handler, one per key for the crumb's life, so its registration holds still. */
function tapOf(state: BreadcrumbsState, key: string): () => void {
	let tap = state.taps.get(key);
	if (!tap) {
		tap = () => {
			const path =
				key === "\u0000back" ? state.back?.path : state.items.get(key)?.path;
			if (path) state.props.onSelect?.([...path]);
		};
		state.taps.set(key, tap);
	}
	return tap;
}

/** Escape on any crumb asks for the parent of where the trail is heading. */
const zoomOutKeys = new WeakMap<BreadcrumbsState, KeyboardBehaviour>();
function zoomOutKey(state: BreadcrumbsState): KeyboardBehaviour {
	let behaviour = zoomOutKeys.get(state);
	if (!behaviour) {
		behaviour = {
			shortcuts: "Escape",
			key(event) {
				const onSelect = state.props.onSelect;
				if (event.key !== "Escape" || !onSelect) return false;
				let path = state.props.path;
				while (isPathTransition(path)) path = path.to;
				if (path.length === 0) return false;
				onSelect(path.slice(0, -1));
				return true;
			},
		};
		zoomOutKeys.set(state, behaviour);
	}
	return behaviour;
}

/**
 * A breadcrumb trail for a drill-down: the root's name, then each name on the path to the node
 * in focus. Tap (or Enter on) an earlier crumb to go back up; Escape asks for the parent. Give
 * it the same `path` as a hierarchy chart's `focus` and it scrubs with the zoom. The hierarchy
 * charts draw one themselves with their `breadcrumbs` prop.
 *
 * @example
 * ```ts
 * import { createScene } from "@sophistry/core";
 * import { breadcrumbs, createDrillDown } from "@sophistry/charts";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 10 });
 * const zoom = createDrillDown({ clock: scene.clock });
 * breadcrumbs.create({ path: zoom.focus, root: "repo", x: -4, y: 2.4, onSelect: (path) => void zoom.zoomTo(path) });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#hierarchies
 * @category Charts
 */
export const breadcrumbs = defineComposite<BreadcrumbsProps>({
	name: "Breadcrumbs",
	props: {
		path: { default: [], invalidates: Invalidate.UPDATE },
		root: { invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		align: { invalidates: Invalidate.UPDATE },
		fontSize: { invalidates: Invalidate.UPDATE },
		separator: { invalidates: Invalidate.UPDATE },
		maxWidth: { invalidates: Invalidate.UPDATE },
		ellipsis: { invalidates: Invalidate.UPDATE },
		back: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		linkColor: { invalidates: Invalidate.UPDATE },
		onSelect: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const state: BreadcrumbsState = {
			props: ctx.props,
			items: new Map(),
			back: undefined,
			taps: new Map(),
			layoutOf: () => ({ items: [], width: 0 }),
		};
		breadcrumbStates.set(ctx.node, state);
		const memo = keyedMemo<ReturnType<typeof breadcrumbLayout>>();
		let lastPath: HierarchyPathSpec | undefined;
		const layoutOf = (path: HierarchyPathSpec, options: readonly unknown[]) => {
			// An equal path (a new but deep-equal spec) keeps the layout.
			const stable = lastPath && deepEqual(lastPath, path) ? lastPath : path;
			lastPath = stable;
			return memo([stable, ...options], () => {
				const [
					fontSize,
					fontFamily,
					separator,
					root,
					align,
					maxWidth,
					ellipsis,
					back,
				] = options as [
					number,
					string,
					string,
					string | undefined,
					BreadcrumbsProps["align"],
					number | undefined,
					string | undefined,
					string | undefined,
				];
				const measure = measurer(fontSize, fontFamily);
				return breadcrumbLayout(stable, {
					root: root ?? "All",
					measure,
					separatorWidth: measure(separator),
					gap: GAP * fontSize,
					align,
					maxWidth,
					ellipsis,
					backWidth: back === undefined ? undefined : measure(back),
				});
			});
		};
		state.layoutOf = layoutOf;
		return drawBreadcrumbs(ctx, state);
	},
	update: (_changed, ctx) =>
		drawBreadcrumbs(ctx, breadcrumbStates.get(ctx.node) as BreadcrumbsState),
});

/** Space between a chart's edge and its own breadcrumbs, in scene units. */
const CHART_GAP = 0.15;

/** Where a chart's trail goes and how wide it may grow. @internal */
export interface ChartBreadcrumbsFrame<T> {
	options: boolean | HierarchyBreadcrumbOptions | undefined;
	nodes: readonly HierarchyNodeInfo<T>[];
	resolved: ResolvedFocus;
	drill: HierarchyDrill<T>;
	/** The chart's top-left corner, in scene units. */
	corner: Point;
	/** The chart's width: how wide the trail may grow by default. */
	width: number;
	/** The chart's label font size. */
	labelFontSize: number;
	progress?: number;
	zIndex?: number;
	visible?: boolean;
}

/**
 * The trail a zoomable hierarchy chart draws for its `breadcrumbs` prop: its
 * focus as names, just above the chart's top-left unless placed, collapsing
 * past the chart's width. Call once, in `setup`; the result hands back the
 * trail's node (made the first time it is asked for), or null for none.
 *
 * @internal
 */
export function createChartBreadcrumbs<T>(): (
	frame: ChartBreadcrumbsFrame<T>,
) => SceneNode | null {
	let node: SceneNode<BreadcrumbsProps> | null = null;
	let drill: HierarchyDrill<T> | null = null;
	const onSelect = (target: string[]) => drill?.selectPath(target);
	let lastPath: HierarchyPathSpec | null = null;
	return (frame) => {
		const options: HierarchyBreadcrumbOptions | undefined =
			frame.options === true
				? {}
				: frame.options === false
					? undefined
					: frame.options;
		if (!options) return null;
		drill = frame.drill;
		const fontSize = options.fontSize ?? frame.labelFontSize + 0.04;
		const given = options.maxWidth;
		const maxWidth = given === false ? undefined : (given ?? frame.width);
		const names = (f: ResolvedFocus): HierarchyPathSpec =>
			"at" in f
				? (frame.nodes[f.at]?.path.slice(1) ?? [])
				: { from: names(f.from), to: names(f.to), t: f.t };
		const next = names(frame.resolved);
		const path = lastPath && deepEqual(lastPath, next) ? lastPath : next;
		lastPath = path;
		const at = options.at ?? {
			x: frame.corner.x,
			y: frame.corner.y + CHART_GAP + fontSize / 2,
		};
		const props: BreadcrumbsProps = {
			path,
			root: options.root ?? (frame.nodes[0]?.label || "All"),
			x: at.x,
			y: at.y,
			fontSize,
			maxWidth,
			back: options.back,
			onSelect: frame.drill.canSelect ? onSelect : undefined,
			progress: frame.progress,
			zIndex: frame.zIndex,
			visible: frame.visible,
		};
		if (!node) node = breadcrumbs.create(props);
		else node.update(props);
		return node;
	};
}
