/**
 * `colorbar`: a ramp legend, a bar shaded low to high with ticks and numbers.
 *
 * The bar, each tick's line and number (keyed by value) and the title are
 * kept across updates and hidden with `visible: false` when not shown; the ticks are recomputed only when the domain, scale or
 * formatting change, the gradient only when the ramp or orientation do.
 */

import type {
	Colormap,
	ColorRampSpec,
	CompositeContext,
	GradientSpec,
	LabelProps,
	LineProps,
	RectProps,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	label,
	line,
	linearGradient,
	measuresText,
	rect,
} from "@sophistry/core";
import type {
	DivergingKind,
	Point,
	Scale,
	ScaleSpec,
	TickFormatter,
	TickFormatterSpec,
} from "@sophistry/core/geometry";
import {
	axisTicks,
	divergingScale,
	resolveScale,
	resolveTickFormatter,
	tickFormatters,
	tickStep,
} from "@sophistry/core/geometry";
import {
	clamp01,
	DEFAULT_FONT_WEIGHT,
	measureLabel,
	resolveColorRamp,
} from "@sophistry/core/internal";
import { keyedMemo } from "../util";
import { write } from "./nodes";

const DEFAULT_LENGTH = 3;
const DEFAULT_THICKNESS = 0.22;
const DEFAULT_FONT_SIZE = 0.24;
const TICK_LENGTH = 0.08;
/** Stops sampled from the colormap for the bar's gradient. */
const GRADIENT_STOPS = 24;

/**
 * Props for {@link colorbar}.
 *
 * @category Charts
 */
export interface ColorbarProps {
	/** The value range the colours span, `[low, high]`: low at the bar's start. */
	domain: readonly [number, number];
	/**
	 * The ramp: a colormap name (`"viridis"`), CSS stops, or `(t) => colour`. Defaults to the
	 * theme's ramp.
	 */
	ramp?: ColorRampSpec | Colormap;
	/** The bar's bottom-left corner (vertical) or top-left (horizontal). */
	at: Point;
	/**
	 * `"vertical"`: low at the bottom, numbers on the right. `"horizontal"`: low on the left,
	 * numbers below.
	 * @default "vertical"
	 */
	orientation?: "vertical" | "horizontal";
	/**
	 * Length of the bar along its values.
	 * @default 3
	 */
	length?: number;
	/**
	 * Thickness of the bar.
	 * @default 0.22
	 */
	thickness?: number;
	/** A title above the bar (vertical) or beside it (horizontal). */
	label?: string;
	/**
	 * How values map along the bar, as on an axis: `"linear"`, `"log"`, `"sqrt"`, `"symlog"`, or
	 * your own {@link Scale}. Ticks follow it; colour the data with the same scale.
	 * @default "linear"
	 */
	scale?: ScaleSpec;
	/**
	 * The log base when `scale` is `"log"`.
	 * @default 10
	 */
	base?: number;
	/**
	 * A diverging centre: this value sits mid-bar, each half through `scale`. Colour the data with
	 * the same `rampMidpoint`.
	 */
	midpoint?: number;
	/**
	 * How a tick's number is written, as on an axis: a function, a built-in name (`"si"`,
	 * `"percent"`, ...) or a format string (`",.1f"`). Defaults to the axes' formatting.
	 */
	tickFormat?: TickFormatterSpec;
	/**
	 * Target number of ticks.
	 * @default 5
	 */
	ticks?: number;
	/**
	 * Font size of the numbers and the title.
	 * @default 0.24
	 */
	fontSize?: number;
	/**
	 * Reveal, 0..1: the bar fades in, then its numbers.
	 * @default 1
	 */
	progress?: number;
	/** Paint order; higher draws later. */
	zIndex?: number;
	/** Set to `false` to hide the colour bar. */
	visible?: boolean;
}

/** The ticks a colour bar draws and how it writes them. */
interface ColorbarTicks {
	/** The bar's mapping over `[low, high]`. */
	scale: Scale;
	low: number;
	high: number;
	/** Tick values inside the domain, ascending. */
	values: number[];
	format: TickFormatter;
}

/** A scale name as a `divergingScale` half's kind; linear for the rest. */
function divergingKind(scale: ScaleSpec | undefined): DivergingKind {
	return scale === "log" || scale === "sqrt" || scale === "symlog"
		? scale
		: "linear";
}

/** A colour bar's ticks and formatter, through the axes' machinery (a log bar gets decades). */
function colorbarTicks(
	props: Pick<
		ColorbarProps,
		"domain" | "scale" | "base" | "midpoint" | "tickFormat" | "ticks"
	>,
): ColorbarTicks {
	const low = Math.min(props.domain[0], props.domain[1]);
	const high = Math.max(props.domain[0], props.domain[1]);
	const count = props.ticks ?? 5;
	const range: [number, number] = [low, high];
	const scale =
		props.midpoint !== undefined && typeof props.scale !== "object"
			? divergingScale(range, props.midpoint, {
					kind: divergingKind(props.scale),
					base: props.base,
				})
			: resolveScale(props.scale, range, props.base);
	const valid = Number.isFinite(low) && Number.isFinite(high) && high > low;
	const values = valid
		? axisTicks(scale, range, { count, minorTickCount: 0 }).majors.filter(
				(value) =>
					value >= low && value <= high && Number.isFinite(scale.toUnit(value)),
			)
		: [];
	const step = valid ? tickStep(range, { count }) : 0;
	const format = resolveTickFormatter(
		props.tickFormat,
		scale.tickFormat ?? tickFormatters.plain,
		{
			scale: props.scale,
			range,
			count: step > 0 ? Math.round((high - low) / step) : undefined,
		},
	);
	return { scale, low, high, values, format };
}

/**
 * How wide a vertical {@link colorbar} is: the bar, its ticks and its widest number (or title).
 *
 * @internal
 */
export function colorbarWidth(
	props: Pick<
		ColorbarProps,
		| "domain"
		| "scale"
		| "base"
		| "midpoint"
		| "thickness"
		| "label"
		| "tickFormat"
		| "ticks"
		| "fontSize"
	>,
	fontFamily: string,
): number {
	const fontSize = props.fontSize ?? DEFAULT_FONT_SIZE;
	const style = {
		fontSize,
		fontFamily,
		fontWeight: DEFAULT_FONT_WEIGHT,
		italic: false,
		letterSpacing: 0,
	};
	const { values, format } = colorbarTicks(props);
	let numbers = 0;
	for (const value of values) {
		const text = format(value);
		numbers = Math.max(numbers, measureLabel(text, style).width);
	}
	const bar =
		(props.thickness ?? DEFAULT_THICKNESS) +
		(numbers > 0 ? TICK_LENGTH + fontSize * 0.4 + numbers : 0);
	const title =
		props.label === undefined ? 0 : measureLabel(props.label, style).width;
	return Math.max(bar, title);
}

/** The nodes one tick draws. */
interface TickNodes {
	line: SceneNode<LineProps>;
	label: SceneNode<LabelProps>;
}

/** What a colour bar keeps between updates. */
interface ColorbarState {
	colormap: (deps: readonly unknown[], make: () => Colormap) => Colormap;
	fill: (deps: readonly unknown[], make: () => GradientSpec) => GradientSpec;
	ticks: (deps: readonly unknown[], make: () => ColorbarTicks) => ColorbarTicks;
	bar: SceneNode<RectProps> | undefined;
	title: SceneNode<LabelProps> | undefined;
	nodes: Map<number, TickNodes>;
}

/** Each colour bar node's state, kept from `setup` for its updates. */
const states = new WeakMap<object, ColorbarState>();

/**
 * A ramp legend: a bar shaded low to high with ticks and numbers, saying what each colour
 * stands for. `chart` with `colorbar` draws one for its value-coloured layers; use this
 * directly anywhere else.
 *
 * @example
 * ```ts
 * import { colorbar } from "@sophistry/charts";
 *
 * colorbar.create({
 * 	at: { x: 4, y: -1.5 },
 * 	domain: [0, 100],
 * 	ramp: "viridis",
 * 	label: "Density",
 * });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#color
 * @category Charts
 */
export const colorbar = defineComposite<ColorbarProps>({
	name: "Colorbar",
	props: {
		domain: { default: [0, 1], invalidates: Invalidate.UPDATE },
		ramp: { invalidates: Invalidate.UPDATE },
		at: { default: { x: 0, y: 0 }, invalidates: Invalidate.UPDATE },
		orientation: { invalidates: Invalidate.UPDATE },
		length: { invalidates: Invalidate.UPDATE },
		thickness: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		scale: { invalidates: Invalidate.UPDATE },
		base: { invalidates: Invalidate.UPDATE },
		midpoint: { invalidates: Invalidate.UPDATE },
		tickFormat: { invalidates: Invalidate.UPDATE },
		ticks: { invalidates: Invalidate.UPDATE },
		fontSize: { invalidates: Invalidate.UPDATE },
		progress: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const state: ColorbarState = {
			colormap: keyedMemo(),
			fill: keyedMemo(),
			ticks: keyedMemo(),
			bar: undefined,
			title: undefined,
			nodes: new Map(),
		};
		states.set(ctx.node, state);
		return renderColorbar(ctx, state);
	},
	update: (_changed, ctx) =>
		renderColorbar(ctx, states.get(ctx.node) as ColorbarState),
});

/** Builds or updates a colour bar's nodes for its current props; returns them in paint order. */
function renderColorbar(
	ctx: CompositeContext<ColorbarProps>,
	state: ColorbarState,
): SceneNode[] {
	// Numbers are placed by anchor, not measured, but a font load may still change the frame's room.
	measuresText(ctx);
	const props = ctx.props;
	const theme = ctx.theme;
	const vertical = props.orientation !== "horizontal";
	const length = props.length ?? DEFAULT_LENGTH;
	const thickness = props.thickness ?? DEFAULT_THICKNESS;
	const fontSize = props.fontSize ?? DEFAULT_FONT_SIZE;
	const colormap = state.colormap([props.ramp, theme.palette.ramp], () => {
		const colors = props.ramp;
		return typeof colors === "function"
			? colors
			: resolveColorRamp(colors, () => theme.palette.ramp);
	});
	const fill = state.fill([colormap, vertical], () =>
		linearGradient(
			Array.from({ length: GRADIENT_STOPS }, (_, i) =>
				colormap(i / (GRADIENT_STOPS - 1)),
			),
			{ angle: vertical ? Math.PI / 2 : 0 },
		),
	);
	const bar = state.ticks(
		[
			props.domain[0],
			props.domain[1],
			props.scale,
			props.base,
			props.midpoint,
			props.tickFormat,
			props.ticks,
		],
		() => colorbarTicks(props),
	);
	/** A value's place along the bar, in scene units from its start, under the bar's scale. */
	const along = (value: number) =>
		bar.high > bar.low ? bar.scale.toUnit(value) * length : 0;
	const at = props.at;
	/** The point `offset` along the bar and `across` out from its far side. */
	const point = (offset: number, across: number): Point =>
		vertical
			? { x: at.x + thickness + across, y: at.y + offset }
			: { x: at.x + offset, y: at.y - thickness - across };
	const barShown = clamp01((props.progress ?? 1) * 2);
	const numbersShown = clamp01((props.progress ?? 1) * 2 - 1);
	const showBar = props.visible !== false && barShown > 0;
	const showNumbers = showBar && numbersShown > 0;
	const muted = theme.palette.muted;
	const zIndex = props.zIndex;
	const children: SceneNode[] = [];

	const barProps: Partial<RectProps> = {
		center: {
			x: at.x + (vertical ? thickness : length) / 2,
			y: at.y + (vertical ? length : -thickness) / 2,
		},
		width: vertical ? thickness : length,
		height: vertical ? length : thickness,
		fill,
		stroke: theme.palette.border,
		strokeWidth: 0.015,
		opacity: barShown,
		zIndex,
		visible: showBar,
	};
	if (state.bar) write(state.bar, barProps);
	else state.bar = rect.create(barProps as RectProps);
	children.push(state.bar);

	const kept = new Map<number, TickNodes>();
	for (const value of bar.values) {
		const offset = along(value);
		const numberAt = point(offset, TICK_LENGTH + fontSize * 0.4);
		const lineProps: Partial<LineProps> = {
			from: point(offset, 0),
			to: point(offset, TICK_LENGTH),
			stroke: muted,
			strokeWidth: 0.015,
			opacity: numbersShown,
			zIndex,
			visible: showNumbers,
		};
		const labelProps: Partial<LabelProps> = {
			text: bar.format(value),
			x: numberAt.x,
			y: numberAt.y - (vertical ? 0 : fontSize * 0.45),
			align: vertical ? "left" : "center",
			fontSize,
			color: muted,
			opacity: numbersShown,
			zIndex,
			visible: showNumbers,
		};
		let nodes = state.nodes.get(value);
		if (nodes) {
			write(nodes.line, lineProps);
			write(nodes.label, labelProps);
		} else {
			nodes = {
				line: line.create(lineProps as LineProps),
				label: label.create(labelProps as LabelProps),
			};
		}
		kept.set(value, nodes);
		children.push(nodes.line, nodes.label);
	}
	// Ticks gone from the bar: left out of the children, their nodes are disposed.
	state.nodes = kept;

	if (props.label) {
		const titleProps: Partial<LabelProps> = {
			text: props.label,
			x: vertical ? at.x : at.x + length + fontSize * 0.5,
			y: vertical ? at.y + length + fontSize * 0.9 : at.y - thickness / 2,
			align: "left",
			fontSize,
			color: theme.palette.foreground,
			opacity: numbersShown,
			zIndex,
			visible: showNumbers,
		};
		if (state.title) write(state.title, titleProps);
		else state.title = label.create(titleProps as LabelProps);
		children.push(state.title);
	} else {
		state.title = undefined;
	}
	return children;
}
