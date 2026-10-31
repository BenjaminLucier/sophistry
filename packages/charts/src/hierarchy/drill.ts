/**
 * Tap-to-drill for the zoomable hierarchy charts (`treemap`, `icicle`,
 * `sunburst`, `circlePack`, `tree`): {@link createDrillDown}, which turns
 * "zoom to this node" into a tweened, scrubbable `{ from, to, t }` focus,
 * plus the drill props the charts share and the interaction a chart's
 * batched node carries.
 *
 * The drill-down is plain tracks (`focus` and `path` are `Readable`s a chart
 * prop binds to) and its zoom runs on a clock it is given. A chart without
 * a controlled `focus` keeps one of its own on its scene's clock.
 *
 * A chart's nodes are one batched node, so the chart is one tab stop whose
 * nodes the arrow keys walk (the accessibility layer's item list): Enter or
 * Space taps the current node (drilling as a tap does), Escape zooms out one
 * level (`aria-keyshortcuts="Escape"`). The item list walks every drawn node.
 */

import type {
	Clock,
	CompositeContext,
	Easing,
	KeyboardBehaviour,
	PlayResult,
	Readable,
	ReducedMotion,
	ScenePointerEvent,
	Track,
} from "@sophistry/core";
import {
	defaultClock,
	derive,
	play,
	reducedMotionContext,
	track,
	valueTo,
} from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import type { HierarchyPathSpec } from "../math/breadcrumbs";
import { isPathTransition, samePath } from "../math/breadcrumbs";
import type { HierarchyNodeInfo } from "../math/hierarchy";
import type { TooltipSpec, TooltipState } from "../tooltip";
import { tooltipLabel, tooltipText } from "../tooltip";
import type { HierarchyFocusSpec, ResolvedFocus } from "./shared";
import {
	drillTarget,
	findFocus,
	hierarchyTooltipText,
	isZooming,
} from "./shared";

/** Default length of a drill-down zoom, in seconds. */
const DEFAULT_DURATION = 0.75;
/** Nesting kept when a zoom interrupts a zoom; deeper ends snap to their nearer side. */
const MAX_NESTING = 3;

/**
 * How a drill-down zoom animates.
 *
 * @category Charts
 */
export interface DrillOptions {
	/** Length of the zoom, in seconds. @default 0.75 */
	duration?: number;
	/** Easing of the zoom. @default "smooth" */
	easing?: Easing;
}

/**
 * Options for {@link createDrillDown}.
 *
 * @category Charts
 */
export interface DrillDownOptions extends DrillOptions {
	/** The path in focus at first. Defaults to the root. @default [] */
	initial?: readonly string[];
	/**
	 * The clock the zoom's tween runs on: pass the scene's (`scene.clock`) so
	 * it pauses and steps with it. @default defaultClock
	 */
	clock?: Clock;
	/**
	 * Whether the zoom reduces motion (jumps to its end): `"auto"` defers to
	 * the clock, a `Readable` answers live (a scene's own setting).
	 * @default "auto"
	 */
	reducedMotion?: ReducedMotion | Readable<boolean>;
	/** Called just before a reduced-motion zoom jumps to its end. */
	onReducedJump?: () => void;
}

/**
 * A drill-down's state: where it is going and the tween getting it there.
 * Returned by {@link createDrillDown}.
 *
 * @category Charts
 */
export interface DrillDown {
	/**
	 * The focus to hand to a chart (and to {@link breadcrumbs}): a transition
	 * from the view when the last zoom started to {@link DrillDown.path}. A
	 * `Readable`: pass it as the chart's `focus` prop and the chart follows.
	 */
	readonly focus: Readable<HierarchyPathSpec>;
	/** Where the drill-down is (or is going): names below the root. */
	readonly path: Readable<readonly string[]>;
	/** The last zoom's 0..1 track; set or scrub it to replay that zoom. */
	readonly t: Track<number>;
	/**
	 * Zooms to the node at `path` from the view on screen now, interrupting any
	 * running zoom. Resolves `"done"`, or `"aborted"` if replaced; a no-op when
	 * already there. Hand it straight to a chart's `onFocusChange` or a trail's
	 * `onSelect`.
	 */
	zoomTo(path: readonly string[]): Promise<PlayResult>;
	/** Zooms out one level, to the parent of {@link DrillDown.path}. */
	zoomOut(): Promise<PlayResult>;
}

/** The end of a spec that dominates it, for collapsing deep nesting. */
function nearer(spec: HierarchyPathSpec): readonly string[] {
	if (!isPathTransition(spec)) return spec;
	return spec.t >= 0.5 ? nearer(spec.to) : nearer(spec.from);
}

/** Caps how deeply interrupted zooms nest; the innermost snap to their nearer end. */
function collapse(spec: HierarchyPathSpec, depth = 0): HierarchyPathSpec {
	if (!isPathTransition(spec)) return spec;
	if (depth >= MAX_NESTING) return nearer(spec);
	return {
		from: collapse(spec.from, depth + 1),
		to: collapse(spec.to, depth + 1),
		t: spec.t,
	};
}

/**
 * Animated, scrubbable drill-down for a zoomable hierarchy chart. Pass
 * `focus` to the chart (and to {@link breadcrumbs}), and `zoomTo` to the
 * chart's `onFocusChange`; every frame is a pure function of the track `t`.
 * Give it the scene's clock so the zoom runs with the scene.
 *
 * @example
 * ```ts
 * import { createScene } from "@sophistry/core";
 * import { createDrillDown, treemap } from "@sophistry/charts";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 10 });
 * const files = {
 * 	name: "repo",
 * 	children: [
 * 		{ name: "src", children: [{ name: "index.ts", size: 12 }, { name: "chart.ts", size: 30 }] },
 * 		{ name: "README.md", size: 4 },
 * 	],
 * };
 * const zoom = createDrillDown({ clock: scene.clock });
 * scene.add(
 * 	treemap.create({
 * 		data: files,
 * 		value: "size",
 * 		label: "name",
 * 		width: 8,
 * 		height: 4,
 * 		focus: zoom.focus,
 * 		onFocusChange: (path) => void zoom.zoomTo(path),
 * 	}),
 * );
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#hierarchies
 * @category Charts
 */
export function createDrillDown(options: DrillDownOptions = {}): DrillDown {
	const start = [...(options.initial ?? [])];
	const ends = track<{ from: HierarchyPathSpec; to: readonly string[] }>({
		from: start,
		to: start,
	});
	const t = track(1);
	let run: AbortController | undefined;
	let running: Promise<PlayResult> = Promise.resolve("done");

	const zoomTo = (path: readonly string[]): Promise<PlayResult> => {
		const next = [...path];
		const { from, to } = ends.peek();
		const k = t.peek();
		// Already there, or already on the way.
		if (samePath(to, next)) return k >= 1 ? Promise.resolve("done") : running;
		// Stop the running zoom first: two runs would both write `t`.
		run?.abort();
		const here: HierarchyPathSpec =
			k >= 1 ? to : k <= 0 ? from : collapse({ from, to, t: k });
		ends.set({ from: here, to: next });
		t.set(0);
		const controller = new AbortController();
		run = controller;
		running = play(
			valueTo(t, 1, {
				duration: options.duration ?? DEFAULT_DURATION,
				easing: options.easing ?? "smooth",
			}),
			{
				clock: options.clock ?? defaultClock,
				signal: controller.signal,
				reducedMotion: options.reducedMotion,
				onReducedJump: options.onReducedJump,
			},
		);
		return running;
	};

	return {
		focus: derive(
			[ends, t],
			({ from, to }, k): HierarchyPathSpec =>
				k >= 1 ? to : { from, to, t: k },
		),
		path: derive(ends, ({ to }) => to),
		t,
		zoomTo,
		zoomOut: () => zoomTo(ends.peek().to.slice(0, -1)),
	};
}

/**
 * A breadcrumb trail drawn by a zoomable hierarchy chart itself (its
 * `breadcrumbs` prop), by default just above the chart's top-left corner.
 *
 * @category Charts
 */
export interface HierarchyBreadcrumbOptions {
	/** The root crumb's text. Defaults to the root's `label`, else `"All"`. */
	root?: string;
	/** Where the trail starts (its left end, vertically centred). */
	at?: Point;
	/** Font size. Defaults to the chart's label size + 0.04. */
	fontSize?: number;
	/**
	 * The widest the trail may be before its middle collapses into `…`;
	 * `false` never collapses. Defaults to the chart's width.
	 */
	maxWidth?: number | false;
	/**
	 * A back control before the trail (`true` for `"←"`, or its text) that zooms
	 * out one level.
	 * @default false
	 */
	back?: boolean | string;
}

/**
 * Tap-to-drill props shared by `treemap`, `icicle`, `sunburst`, `circlePack`
 * and `tree`. Uncontrolled (`drill`, no `focus`), the chart keeps its own
 * focus and tweens to tapped nodes; controlled (`focus` + `onFocusChange`),
 * a tap only calls `onFocusChange`. A tap on the focused node zooms out,
 * on a parent zooms in, on a leaf zooms to its parent; Enter and Space tap
 * the node the arrow keys are on, Escape zooms out. Focus is by name path,
 * so keep sibling labels unique.
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#hierarchies
 * @category Charts
 */
export interface HierarchyDrillProps<T> {
	/**
	 * Tap or Enter on a node to zoom to it: `true`, or the zoom's timing.
	 * Defaults to true when `onFocusChange` is given, else false.
	 */
	drill?: boolean | DrillOptions;
	/** Called when a tap or breadcrumb asks to zoom, with the path below the root and that node's datum. */
	onFocusChange?: (path: string[], datum: NoInfer<T>) => void;
	/** The uncontrolled focus at first: a path of names below the root. Defaults to the root. */
	defaultFocus?: readonly string[];
	/** Draw a breadcrumb trail of the focus path above the chart; tap a crumb to zoom out to it. */
	breadcrumbs?: boolean | HierarchyBreadcrumbOptions;
}

/** The drill prop keys every zoomable hierarchy chart declares. */
export const DRILL_PROP_KEYS = [
	"drill",
	"onFocusChange",
	"defaultFocus",
	"breadcrumbs",
	"focus",
] as const;

/** A chart's drill-down state on one update: the focus to draw and how to ask for a new one. @internal */
export interface HierarchyDrill<T> {
	/** The focus to draw. */
	focus: HierarchyFocusSpec<T> | undefined;
	/** Whether taps drill. */
	enabled: boolean;
	/** Whether asking to zoom does anything (uncontrolled, or someone listens). */
	canSelect: boolean;
	/** Asks to zoom to the node at `position` of the current layout. */
	select(position: number): void;
	/** Asks to zoom to a path. */
	selectPath(path: readonly string[]): void;
}

/** The props {@link createHierarchyDrill} reads. */
type DrillChartProps<T> = HierarchyDrillProps<T> & {
	focus?: HierarchyFocusSpec<T>;
};

/**
 * A chart's drill-down: its `focus`, `drill`, `onFocusChange` and
 * `defaultFocus` props resolved, with the uncontrolled focus kept on the
 * scene's clock. The chart reruns its `update` while its own zoom runs.
 * Call once, in `setup`; call the result in every update.
 *
 * @internal
 */
export function createHierarchyDrill<T, P extends DrillChartProps<T>>(
	ctx: CompositeContext<P>,
): (
	props: DrillChartProps<T>,
	nodes: readonly HierarchyNodeInfo<T>[],
) => HierarchyDrill<T> {
	let current: {
		props: DrillChartProps<T>;
		nodes: readonly HierarchyNodeInfo<T>[];
	} = { props: ctx.props, nodes: [] };
	const timing = (): DrillOptions =>
		typeof current.props.drill === "object" ? current.props.drill : {};
	// Getters: the chart's `drill` timing is read when each zoom starts.
	const own = createDrillDown({
		initial: ctx.props.defaultFocus,
		clock: ctx.clock,
		reducedMotion: ctx.context(reducedMotionContext),
		get duration() {
			return timing().duration;
		},
		get easing() {
			return timing().easing;
		},
	});
	const unsubscribe = own.focus.subscribe(() =>
		ctx.invalidate("focus" as keyof P),
	);
	ctx.onDispose(unsubscribe);
	const controlled = () => current.props.focus !== undefined;
	const selectPath = (path: readonly string[]) => {
		const all = current.nodes;
		const node = all[findFocus(all, path)];
		if (node) current.props.onFocusChange?.([...path], node.datum);
		if (!controlled()) void own.zoomTo(path);
	};
	const select = (position: number) => {
		const node = current.nodes[position];
		if (node) selectPath(node.path.slice(1));
	};
	return (props, nodes) => {
		current = { props, nodes };
		// Read every update, so the derived focus keeps telling us when it moves.
		const ownFocus = own.focus.peek();
		const isControlled = props.focus !== undefined;
		return {
			focus: isControlled ? props.focus : ownFocus,
			enabled:
				props.drill === undefined
					? props.onFocusChange !== undefined
					: props.drill !== false,
			canSelect: !isControlled || props.onFocusChange !== undefined,
			select,
			selectPath,
		};
	};
}

/** What a chart's node interaction reads on each event: the latest update's state. @internal */
export interface NodeInteractionState<T> {
	/** The chart's tooltip. */
	tooltip: TooltipState;
	/** The chart's `tooltip` prop. */
	spec: TooltipSpec<T> | undefined;
	/** The whole layout. */
	nodes: readonly HierarchyNodeInfo<T>[];
	/** The node the zoom is heading for. */
	target: number;
	/** The resolved focus: no tooltip opens while it moves. */
	resolved: ResolvedFocus;
	drill: HierarchyDrill<T>;
	/** A batched item's position in the whole layout, or undefined. */
	positionOf(item: number): number | undefined;
	/** Where a batched item's tooltip points, in scene units. */
	atOf(item: number): Point | undefined;
}

/** The interaction props a hierarchy chart's batched node carries. @internal */
export interface NodeInteractionProps {
	label?: string;
	itemLabel?: (item: number) => string | undefined;
	onEnter?: (event: ScenePointerEvent) => void;
	onLeave?: (event: ScenePointerEvent) => void;
	onTap?: (event: ScenePointerEvent) => void;
	keyboard?: KeyboardBehaviour;
	cursor?: string;
}

/** A real mouse or pen over the node: not a synthesised keyboard event, not touch. */
function hovering(event: ScenePointerEvent | undefined): boolean {
	if (!event || !(event.pointerId >= 0)) return false;
	return event.native?.pointerType !== "touch";
}

/** A chart's node interaction: see {@link createNodeInteraction}. @internal */
export interface NodeInteraction {
	/**
	 * The props to spread into the batched node's shared props (empty when
	 * neither drilling nor tooltips are on), naming the node `name`.
	 */
	props(name: string): NodeInteractionProps;
	/** Taps the node at layout `position` (its tooltip pointing at `at`), as a tap on its item does. */
	tapNode(position: number, at: Point): void;
}

/**
 * The interaction of a hierarchy chart's batched node (tooltip, drilling
 * tap, Escape, cursor, each node's accessible name), made once so the
 * handlers' identities hold across updates. `stateOf` hands back the latest
 * update's state. Call once, in `setup`.
 *
 * @internal
 */
export function createNodeInteraction<T>(
	stateOf: () => NodeInteractionState<T>,
): NodeInteraction {
	const owner = {};
	let openAt: number | undefined;
	const contentOf = (state: NodeInteractionState<T>, position: number) => {
		const node = state.nodes[position];
		if (!node) return undefined;
		return tooltipText(
			state.spec,
			() => hierarchyTooltipText(node),
			node.datum,
			node.index,
		);
	};
	const show = (position: number, at: Point | undefined, follow: boolean) => {
		const state = stateOf();
		const content = contentOf(state, position);
		if (content === undefined || !at) return false;
		state.tooltip.show(owner, content, at, follow);
		openAt = position;
		return true;
	};
	const hide = () => {
		stateOf().tooltip.hide(owner);
		openAt = undefined;
	};
	/** The tooltip's own tap: open it, or close it when it shows this node. */
	const toggle = (position: number, at: Point | undefined) => {
		const open = stateOf().tooltip.active.peek();
		if (open?.owner === owner && position === openAt) {
			hide();
			return;
		}
		if (!show(position, at, false) && open?.owner === owner) hide();
	};
	const closeAny = () => {
		const tooltip = stateOf().tooltip;
		const open = tooltip.active.peek();
		if (open) tooltip.hide(open.owner);
		openAt = undefined;
	};
	const tapNode = (position: number, at: Point | undefined) => {
		const state = stateOf();
		if (!state.drill.enabled) {
			toggle(position, at);
			return;
		}
		const to = drillTarget(state.nodes, state.target, position);
		if (to < 0) {
			toggle(position, at);
			return;
		}
		closeAny();
		state.drill.select(to);
	};
	const positionOfEvent = (event: ScenePointerEvent) => {
		const item = event.item;
		return item === null || item === undefined
			? undefined
			: stateOf().positionOf(item);
	};
	const onEnter = (event: ScenePointerEvent) => {
		const state = stateOf();
		// Nodes slide under a still pointer while the view moves: no tooltip then.
		if (isZooming(state.resolved)) return;
		const position = positionOfEvent(event);
		if (position === undefined) return;
		show(position, state.atOf(event.item as number), hovering(event));
	};
	const onLeave = () => hide();
	const onTap = (event: ScenePointerEvent) => {
		const position = positionOfEvent(event);
		if (position === undefined) return;
		tapNode(position, stateOf().atOf(event.item as number));
	};
	/** Escape zooms out one level, as tapping the focused node does. */
	const keyboard: KeyboardBehaviour = {
		shortcuts: "Escape",
		key(event) {
			const state = stateOf();
			if (event.key !== "Escape" || !state.drill.canSelect) return false;
			const target = state.target;
			const parent = state.nodes[target]?.parent ?? -1;
			if (target === 0 || parent < 0) return false;
			closeAny();
			state.drill.select(parent);
			return true;
		},
	};
	const itemLabel = (item: number) => {
		const state = stateOf();
		const position = state.positionOf(item);
		if (position === undefined) return undefined;
		const content = contentOf(state, position);
		if (content !== undefined) return tooltipLabel(content);
		const node = state.nodes[position];
		return state.drill.enabled && node ? hierarchyTooltipText(node) : undefined;
	};
	return {
		props(name) {
			const state = stateOf();
			const tips = state.spec !== undefined && state.spec !== false;
			const drilling = state.drill.enabled;
			if (!tips && !drilling) return {};
			return {
				label: name,
				itemLabel,
				onEnter: tips ? onEnter : undefined,
				onLeave: tips ? onLeave : undefined,
				onTap,
				keyboard: drilling ? keyboard : undefined,
				cursor: drilling ? "pointer" : undefined,
			};
		},
		tapNode,
	};
}
