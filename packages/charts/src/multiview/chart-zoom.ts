/**
 * Wheel, pinch, drag, box and keyboard zoom for a `chart`, as a writer of
 * the same range tracks `chartLink` and `rangeBrush` use. Zooming works in
 * drawn positions, so log, reversed and band axes all zoom correctly.
 */

import type {
	CompositeContext,
	ContextKey,
	KeyboardBehaviour,
	SceneNode,
	SceneNodeWheelEvent,
} from "@sophistry/core";
import {
	createContextKey,
	defineComposite,
	Invalidate,
	rect,
	text,
} from "@sophistry/core";
import type { Matrix } from "@sophistry/core/geometry";
import { applyToPoint, invert } from "@sophistry/core/geometry";
import { chartContext } from "../context.js";
import type { ChartFrame } from "../frame/types.js";
import { textWidth } from "../text-width.js";
import type { BrushCell, ChartZoomBox } from "./brush.js";
import {
	chartZoomActions,
	chartZoomDrag,
	WHEEL_LINE,
	WHEEL_PAGE,
} from "./brush.js";
import type { BrushAxisOption } from "./chart-link.js";
import {
	brushAxisOption,
	isNumber,
	isPair,
	requireFrame,
} from "./chart-link.js";

export type { ChartZoomBox } from "./brush.js";

/**
 * Props for {@link chartZoom}.
 *
 * @category Charts
 */
export interface ChartZoomProps {
	/** The x range's two ends, `[from, to]`: the tracks the chart's `xRange` reads. */
	x?: readonly [BrushCell, BrushCell];
	/** The y range's two ends. Only the axes given (`x`, `y` or both) zoom and pan. */
	y?: readonly [BrushCell, BrushCell];
	/**
	 * How far the view may go, in data units: `[min, max]` per axis (or one pair for both). `0`,
	 * Home and a double tap return to them. Defaults to unbounded (a band axis is bounded by its
	 * categories).
	 */
	bounds?: BrushAxisOption<readonly [number, number]>;
	/**
	 * The narrowest range a zoom in reaches, in data units (or per axis). Defaults to none (one
	 * category on a band axis).
	 */
	minSpan?: BrushAxisOption<number>;
	/**
	 * What a plain wheel does over the plot: `"zoom"` about the cursor, `"pan"`, or `false` to
	 * leave it to the page. A trackpad pinch always zooms unless `false`.
	 * @default "zoom"
	 */
	wheel?: "zoom" | "pan" | false;
	/**
	 * Drag on the plot to pan, two fingers to pinch-zoom.
	 * @default true
	 */
	pan?: boolean;
	/**
	 * What a plain drag on the plot does: `"pan"` or `"box"` (draw a rectangle to zoom into).
	 * Shift-drag does the other. Escape cancels a box, Backspace steps back out of the last one.
	 * @default "pan"
	 */
	dragMode?: ChartZoomDragMode;
	/**
	 * Called when the toolbar chooses a drag mode. With it, `dragMode` is controlled; without it,
	 * the toolbar keeps its own choice.
	 */
	onDragModeChange?: (mode: ChartZoomDragMode) => void;
	/**
	 * Whether box zoom is available at all.
	 * @default true
	 */
	boxZoom?: boolean;
	/**
	 * A mode toolbar in a plot corner: Pan and Box set the drag mode, Reset returns to `bounds`.
	 * `true` for the defaults, or options.
	 * @default false
	 */
	toolbar?: boolean | ChartZoomToolbarOptions;
	/**
	 * On a band axis, settle drags, pinches, boxes and keys on whole categories (the wheel stays
	 * continuous). Defaults to true on a band axis.
	 */
	snap?: boolean;
	/**
	 * Multiplies the wheel's zoom.
	 * @default 1
	 */
	zoomSpeed?: number;
	/**
	 * Fraction of the view an arrow key pans (Shift: a fifth of it).
	 * @default 0.1
	 */
	step?: number;
	/**
	 * How much `+` and `-` zoom per press.
	 * @default 1.25
	 */
	zoomStep?: number;
	/** Take no input; the tracks still drive the chart. */
	disabled?: boolean;
	/**
	 * Accessible name of the plot as a zoomable control.
	 * @default "zoomable plot"
	 */
	label?: string;
	/** Paint order of the (invisible) gesture surface; keep it under the marks you want to hover. */
	zIndex?: number;
}

/**
 * What a plain drag on a {@link chartZoom} plot does: pan, or draw a box to
 * zoom into.
 *
 * @category Charts
 */
export type ChartZoomDragMode = "pan" | "box";

/**
 * Options for {@link ChartZoomProps.toolbar}.
 *
 * @category Charts
 */
export interface ChartZoomToolbarOptions {
	/**
	 * The plot corner the toolbar sits in.
	 * @default "top-right"
	 */
	corner?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
	/**
	 * The buttons' text size.
	 * @default 0.24
	 */
	fontSize?: number;
}

/** Box zooms remembered for Backspace. */
const HISTORY = 32;
/** The rubber band paints over the marks, under a tooltip. */
const BOX_Z = 999;
/** The toolbar paints over the marks, under the rubber band and a tooltip. */
const TOOLBAR_Z = 998;
/** Padding inside a toolbar button, and the gap between buttons, as fractions of the font size. */
const BUTTON_PAD = 0.45;
const BUTTON_GAP = 0.25;
/** A button's height, and the toolbar's inset from the plot's corner, as fractions of the font size. */
const BUTTON_HEIGHT = 1.6;
const TOOLBAR_INSET = 0.4;

/** An axis of a chart, `"x"` or `"y"`. */
type Axis = "x" | "y";

/** The reason a gesture's state (the box, the toolbar's mode) reruns the update. */
const GESTURE: ContextKey<unknown> = createContextKey("chartZoomGesture");

/** A toolbar button. */
interface Button {
	key: string;
	text: string;
	label: string;
	pressed?: () => boolean;
	press: () => void;
}

/** What a zoom keeps between updates. */
interface ZoomState {
	frame: ChartFrame;
	box: ChartZoomBox | null;
	ownMode: ChartZoomDragMode;
	/** The `dragMode` prop the own mode last followed (a later prop change wins). */
	modeProp: ChartZoomDragMode | undefined;
	surface: SceneNode;
	band: SceneNode | null;
	reset: () => boolean;
	bounds: (axis: Axis) => readonly [number, number] | undefined;
}

const zoomStates = new WeakMap<object, ZoomState>();

function mode(state: ZoomState, props: ChartZoomProps): ChartZoomDragMode {
	return props.onDragModeChange ? (props.dragMode ?? "pan") : state.ownMode;
}

function setupZoom(ctx: CompositeContext<ChartZoomProps>): SceneNode[] {
	const frame = requireFrame(ctx.context(chartContext), "chartZoom");
	if (!ctx.props.x && !ctx.props.y)
		throw new Error("chartZoom needs `x` and/or `y` range tracks.");
	const props = () => ctx.props;
	const enabled = () => props().disabled !== true;
	const band = (axis: Axis) =>
		axis === "x" ? state.frame.xBand : state.frame.yBand;
	const snap = (axis: Axis) =>
		props().snap !== false && band(axis) !== undefined;
	const bounds = (axis: Axis): readonly [number, number] | undefined => {
		const given = brushAxisOption(props().bounds, axis, isPair);
		if (given) return given;
		const scale = band(axis);
		if (!scale) return undefined;
		// Every category, on whole slots (a band's outer padding is no place to stop).
		const [a, b] = scale.range;
		// `+ 0`: a ceiling of a hair below 0 is -0, which a track would keep.
		return [
			Math.ceil(Math.min(a, b) - 1e-9) + 0,
			Math.floor(Math.max(a, b) + 1e-9) + 0,
		];
	};
	const coords = () => state.frame.coords;
	const actions = chartZoomActions({
		coords,
		get x() {
			return props().x;
		},
		get y() {
			return props().y;
		},
		bounds,
		minSpan: (axis) => {
			const given = brushAxisOption(props().minSpan, axis, isNumber);
			return band(axis) ? Math.max(given ?? 1, snap(axis) ? 1 : 0) : given;
		},
		snap,
	});
	/** Box zooms to step back out of, newest last: what each replaced. */
	const history: number[][] = [];
	const boxes = () => props().boxZoom !== false;
	const drag = chartZoomDrag(actions, enabled, {
		box: (event) =>
			boxes() &&
			(mode(state, props()) === "box") !== (event.native?.shiftKey === true),
		onBox(next) {
			state.box = next;
			ctx.invalidate(GESTURE);
		},
		onZoom(before) {
			history.push(before);
			if (history.length > HISTORY) history.shift();
		},
		pan: () => props().pan !== false,
	});
	const step = () => props().step ?? 0.1;
	const zoomStep = () => props().zoomStep ?? 1.25;
	/** Resets, forgetting the box zooms it stepped out of. */
	const reset = () => {
		history.length = 0;
		return actions.reset();
	};

	const keyboard: KeyboardBehaviour = {
		nudge(delta, fine) {
			if (!enabled()) return;
			const area = coords().area();
			const share = fine ? step() / 5 : step();
			const origin = actions.snapshot();
			// The arrow moves the view: what is right of it comes into sight.
			actions.panBy({
				x: -delta.x * share * (area.maxX - area.minX),
				y: -delta.y * share * (area.maxY - area.minY),
			});
			actions.settle(origin, "slide", true);
		},
		key(event) {
			if (!enabled()) return false;
			const zoom = (factor: number) => {
				const origin = actions.snapshot();
				actions.zoomAbout(actions.centre(), factor);
				actions.settle(origin, "ends", factor > 1 ? "out" : "in");
				return true;
			};
			switch (event.key) {
				case "+":
				case "=":
					return zoom(1 / zoomStep());
				case "-":
				case "_":
					return zoom(zoomStep());
				case "0":
				case "Home":
					return reset();
				case "Backspace": {
					const before = history.pop();
					if (!before) return false;
					actions.restore(before);
					return true;
				}
				default:
					return false;
			}
		},
		get shortcuts() {
			return boxes() ? "+ - 0 Home Backspace" : "+ - 0 Home";
		},
	};

	/** The wheel over the plot: zoom or pan; declined (`false`) when it is not ours. */
	const wheel = (event: SceneNodeWheelEvent) => {
		if (!enabled() || props().wheel === false) return false;
		const native = event.native;
		const factor =
			native.deltaMode === 1
				? WHEEL_LINE
				: native.deltaMode === 2
					? WHEEL_PAGE
					: 1;
		const dx = native.deltaX * factor;
		const dy = native.deltaY * factor;
		const zooming = native.ctrlKey || (props().wheel ?? "zoom") === "zoom";
		if (zooming) {
			// A pinch's deltas are a few units a step where a mouse notch is ~100.
			const rate = native.ctrlKey ? 0.01 : 0.002;
			actions.zoomAbout(
				event.local,
				Math.exp(dy * rate * (props().zoomSpeed ?? 1)),
			);
			return true;
		}
		// Scrolling moves the view the way the page would: down shows lower y.
		const toLocal = invert(
			(ctx.node as unknown as { space: { matrix: Matrix } }).space.matrix,
		);
		const origin = applyToPoint(toLocal, { x: 0, y: 0 });
		const moved = applyToPoint(toLocal, {
			x: dx * event.unitsPerPixel.x,
			y: dy * event.unitsPerPixel.y,
		});
		actions.panBy({ x: origin.x - moved.x, y: origin.y - moved.y });
		return true;
	};

	const surface = rect.create({
		stroke: "none",
		pointerEvents: "all",
		drag,
		keyboard,
		onWheel: wheel,
		onDoubleTap: () => {
			if (enabled()) reset();
		},
	} as never);
	const state: ZoomState = {
		frame,
		box: null,
		ownMode: ctx.props.dragMode ?? "pan",
		modeProp: ctx.props.dragMode,
		surface,
		band: null,
		reset,
		bounds,
	};
	zoomStates.set(ctx.node, state);
	return drawZoom(ctx, state);
}

function drawZoom(
	ctx: CompositeContext<ChartZoomProps>,
	state: ZoomState,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	if (props.dragMode !== state.modeProp) {
		state.modeProp = props.dragMode;
		state.ownMode = props.dragMode ?? "pan";
	}
	const enabled = props.disabled !== true;
	const boxes = props.boxZoom !== false;
	const area = state.frame.coords.area();
	const current = mode(state, props);
	state.surface.update({
		center: { x: (area.minX + area.maxX) / 2, y: (area.minY + area.maxY) / 2 },
		width: area.maxX - area.minX,
		height: area.maxY - area.minY,
		cursor: !enabled
			? undefined
			: current === "box" && boxes
				? "crosshair"
				: props.pan !== false
					? "grab"
					: undefined,
		label: props.label ?? "zoomable plot",
		focusable: enabled,
		zIndex: props.zIndex,
	} as never);
	const nodes: SceneNode[] = [state.surface];
	if (props.toolbar && enabled) nodes.push(...toolbar(ctx, state, area));
	else {
		ctx.list("toolbarBack", [] as Button[], {
			create: () => rect.create({ width: 0, height: 0 }),
		});
		ctx.list("toolbarText", [] as Button[], {
			create: () => text.create({ text: "" }),
		});
	}

	// The rubber band as drawn: a thin box's other axis spans the plot.
	const drawn = state.box;
	if (drawn) {
		const [x0, x1] = drawn.x
			? [Math.min(drawn.a.x, drawn.b.x), Math.max(drawn.a.x, drawn.b.x)]
			: [area.minX, area.maxX];
		const [y0, y1] = drawn.y
			? [Math.min(drawn.a.y, drawn.b.y), Math.max(drawn.a.y, drawn.b.y)]
			: [area.minY, area.maxY];
		// Kept inside the plot: the pointer may leave it mid-drag.
		const cx0 = Math.max(x0, area.minX);
		const cx1 = Math.min(x1, area.maxX);
		const cy0 = Math.max(y0, area.minY);
		const cy1 = Math.min(y1, area.maxY);
		const bandProps = {
			center: { x: (cx0 + cx1) / 2, y: (cy0 + cy1) / 2 },
			width: Math.max(0, cx1 - cx0),
			height: Math.max(0, cy1 - cy0),
			fill: theme.palette.series[0],
			fillOpacity: 0.12,
			stroke: theme.palette.foreground,
			strokeWidth: 0.02,
			dash: [0.08, 0.06],
			zIndex: BOX_Z,
		};
		if (state.band) state.band.update(bandProps as never);
		else state.band = rect.create(bandProps as never);
		nodes.push(state.band);
	} else if (state.band) {
		state.band.dispose();
		state.band = null;
	}
	return nodes;
}

/**
 * `chartZoom`'s toolbar: the mode buttons (toggles) and Reset, drawn on the
 * canvas in a plot corner, each a tab stop through the accessibility mirror.
 */
function toolbar(
	ctx: CompositeContext<ChartZoomProps>,
	state: ZoomState,
	area: { minX: number; maxX: number; minY: number; maxY: number },
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const options = props.toolbar === true ? {} : props.toolbar || {};
	const chooseMode = (next: ChartZoomDragMode) => {
		const own = ctx.props.onDragModeChange;
		if (own) own(next);
		else {
			state.ownMode = next;
			ctx.invalidate(GESTURE);
		}
	};
	const buttons: Button[] = [];
	if (props.boxZoom !== false && props.pan !== false) {
		buttons.push(
			{
				key: "pan",
				text: "Pan",
				label: "Pan",
				pressed: () => mode(state, ctx.props) === "pan",
				press: () => chooseMode("pan"),
			},
			{
				key: "box",
				text: "Box",
				label: "Box zoom",
				pressed: () => mode(state, ctx.props) === "box",
				press: () => chooseMode("box"),
			},
		);
	}
	const canReset = (["x", "y"] as const).some(
		(axis) => props[axis] !== undefined && state.bounds(axis) !== undefined,
	);
	if (canReset)
		buttons.push({
			key: "reset",
			text: "Reset",
			label: "Reset zoom",
			press: () => state.reset(),
		});

	// Each button's box, laid out from the corner along the plot's top or bottom edge.
	const size = options.fontSize ?? 0.24;
	const corner = options.corner ?? "top-right";
	const right = corner.endsWith("right");
	const top = corner.startsWith("top");
	const height = BUTTON_HEIGHT * size;
	const inset = TOOLBAR_INSET * size;
	const cy = top
		? area.maxY - inset - height / 2
		: area.minY + inset + height / 2;
	const widths = buttons.map(
		(b) =>
			textWidth(b.text, size, theme.defaults.fontFamily, 500) +
			2 * BUTTON_PAD * size,
	);
	const gap = BUTTON_GAP * size;
	const total =
		widths.reduce((sum, w) => sum + w, 0) +
		gap * Math.max(0, widths.length - 1);
	let x = right ? area.maxX - inset - total : area.minX + inset;
	const boxes = widths.map((width) => {
		const cx = x + width / 2;
		x += width + gap;
		return { cx, cy, width, height };
	});

	const backs = ctx.list("toolbarBack", buttons, {
		key: (button) => button.key,
		create: () => rect.create({ width: 0, height: 0 }),
	});
	const texts = ctx.list("toolbarText", buttons, {
		key: (button) => button.key,
		create: () => text.create({ text: "" }),
	});
	const nodes: SceneNode[] = [];
	buttons.forEach((button, i) => {
		const pair = {
			back: backs[i] as SceneNode,
			text: texts[i] as SceneNode,
		};
		const box = boxes[i] as (typeof boxes)[number];
		const on = button.pressed?.() ?? false;
		pair.back.update({
			center: { x: box.cx, y: box.cy },
			width: box.width,
			height: box.height,
			cornerRadius: 0.15 * size,
			fill: on ? theme.palette.accent : theme.palette.background,
			fillOpacity: on ? 0.25 : 0.85,
			stroke: on ? theme.palette.accent : theme.palette.muted,
			strokeWidth: 0.015,
			cursor: "pointer",
			label: button.label,
			pressed: button.pressed ? on : undefined,
			onTap: () => button.press(),
			zIndex: TOOLBAR_Z,
		} as never);
		pair.text.update({
			text: button.text,
			x: box.cx,
			y: box.cy,
			fontSize: size,
			color: theme.palette.foreground,
			zIndex: TOOLBAR_Z + 0.5,
		} as never);
		nodes.push(pair.back, pair.text);
	});
	return nodes;
}

/**
 * Zoom and pan for the `chart` it is in, by writing the range tracks the chart reads:
 * wheel, drag, pinch, box zoom and keyboard (arrows pan, `+`/`-` zoom, `0` resets). It holds
 * no state, so linked charts, a `rangeBrush` on the same tracks, and animations all stay
 * in sync. Marks with tooltips drawn after it still answer hover. Which axes zoom (`x`, `y`)
 * is read on every gesture.
 *
 * @example
 * ```ts
 * import { derive, track } from "@sophistry/core";
 * import { chart, chartZoom, linePlot } from "@sophistry/charts";
 *
 * const data = Array.from({ length: 60 }, (_, i) => Math.sin(i / 5));
 * const from = track(0);
 * const to = track(10);
 * chart.create({
 * 	width: 8,
 * 	height: 3,
 * 	xRange: derive([from, to], (a, b) => [a, b]),
 * 	clip: true,
 * 	children: [chartZoom.create({ x: [from, to], bounds: [0, 59] }), linePlot.create({ data })],
 * });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#multiple-views
 * @category Charts
 */
export const chartZoom = defineComposite<ChartZoomProps>({
	name: "ChartZoom",
	props: {
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		bounds: { invalidates: Invalidate.UPDATE },
		minSpan: { invalidates: Invalidate.NONE },
		wheel: { invalidates: Invalidate.NONE },
		pan: { invalidates: Invalidate.UPDATE },
		dragMode: { invalidates: Invalidate.UPDATE },
		onDragModeChange: { kind: "event", invalidates: Invalidate.UPDATE },
		boxZoom: { invalidates: Invalidate.UPDATE },
		toolbar: { invalidates: Invalidate.UPDATE },
		snap: { invalidates: Invalidate.NONE },
		zoomSpeed: { invalidates: Invalidate.NONE },
		step: { invalidates: Invalidate.NONE },
		zoomStep: { invalidates: Invalidate.NONE },
		disabled: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
	},
	setup: setupZoom,
	update: (_changed, ctx) => {
		const state = zoomStates.get(ctx.node) as ZoomState;
		state.frame = requireFrame(ctx.context(chartContext), "chartZoom");
		return drawZoom(ctx, state);
	},
});
