/**
 * `gauge`: one value on an arc with a centre readout.
 *
 * One reading, so mostly single nodes: the track and the value arc
 * (`annularSector`), the needle and its hub, the counting readout
 * (`decimalNumber`) and the captions. The threshold bands, one outline each,
 * draw as one path batch. Nodes are made once and shown or hidden; none is
 * rebuilt while the reveal plays.
 */

import type {
	AnnularSectorProps,
	ColorInput,
	CompositeContext,
	PathBatchItem,
	PathBatchItemsProps,
	SceneNode,
} from "@sophistry/core";
import {
	annularSector,
	circle,
	decimalNumber,
	defineComposite,
	easings,
	formatDecimal,
	Invalidate,
	line,
	pathBatch,
	text,
} from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import { clamp01, cssColor } from "@sophistry/core/internal";
import {
	GAUGE_END_ANGLE,
	GAUGE_START_ANGLE,
	gaugeBandIndex,
	gaugeBands,
	gaugeFraction,
} from "../math/gauge.js";
import type { TooltipSpec } from "../tooltip.js";
import { tooltipHandlers, tooltipText } from "../tooltip.js";
import { createOwnTooltip, NO_SWEEP, wedgeItem } from "./shared.js";

/** Share of `progress` spent drawing the track and bands before the value. */
const FRAME_SHARE = 0.3;
const DEFAULT_THICKNESS = 0.18;
const BAND_GAP = 0.2;
const BAND_WIDTH = 0.3;
const READOUT_SIZE = 0.36;
const LABEL_SIZE = 0.14;

/**
 * One threshold zone of a {@link gauge}, given by where it *ends*.
 *
 * @category Charts
 */
export interface GaugeBand {
	/**
	 * The value this band runs up to, in data units, starting where the previous band ends (or at
	 * `min`). `Infinity` means "to `max`".
	 */
	to: number;
	/** The band's colour. Defaults to the theme's categorical colours, by band index. */
	color?: ColorInput;
}

/** @category Charts */
export interface GaugeProps {
	/**
	 * The reading, in data units. Drawn clamped to `[min, max]`; the readout shows it unclamped.
	 */
	value: number;
	/**
	 * The value at the start of the arc.
	 * @default 0
	 */
	min?: number;
	/**
	 * The value at the end of the arc.
	 * @default 100
	 */
	max?: number;
	/** Centre of the gauge. Defaults to the origin. */
	center?: Point;
	/**
	 * Outer radius of the arc.
	 * @default 1
	 */
	radius?: number;
	/** Radial thickness of the arc. Defaults to 0.18 × `radius`. */
	thickness?: number;
	/**
	 * Where `min` sits, in radians from +x (counter-clockwise positive, as on `arc`). The default
	 * is 210°: with the default `endAngle`, a 240° arc open at the bottom.
	 * @default 7 * Math.PI / 6
	 */
	startAngle?: number;
	/**
	 * Where `max` sits, in radians from +x; less than `startAngle` reads clockwise.
	 * @default -Math.PI / 6
	 */
	endAngle?: number;
	/**
	 * Threshold zones in ascending order (`[{ to: 60 }, { to: 85 }, { to: 100 }]`), drawn as a thin
	 * track inside the arc. Unless `color` is given, the value arc takes its band's colour.
	 */
	bands?: readonly GaugeBand[];
	/**
	 * Colour of the value arc. Defaults to the value's band colour, else the theme's first series
	 * colour.
	 */
	color?: ColorInput;
	/** Colour of the empty track behind the value arc. Defaults to the theme's grid colour. */
	trackColor?: ColorInput;
	/**
	 * Draw a needle from the centre to the value.
	 * @default false
	 */
	needle?: boolean;
	/**
	 * Decimal places of the readout (and tooltip).
	 * @default 0
	 */
	decimalPlaces?: number;
	/** Suffix on the readout, e.g. `"%"` or `" ms"`. */
	unit?: string;
	/** Readout font size. Defaults to 0.36 × `radius`. */
	valueFontSize?: number;
	/** Caption under the readout. */
	label?: string;
	/** Font size of `label` and the range labels. Defaults to 0.14 × `radius`. */
	labelFontSize?: number;
	/**
	 * Write `min` and `max` at the ends of the arc.
	 * @default true
	 */
	rangeLabels?: boolean;
	/**
	 * Reveal, 0..1: track and bands sweep in first, then the value arc sweeps to the value while
	 * the readout counts up.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/** Hover tooltip on the value arc: `true` for "label: value", or `(value) => string`. */
	tooltip?: TooltipSpec<number>;
	/** Paint order; higher draws later. */
	zIndex?: number;
	visible?: boolean;
}

/** The nodes a gauge draws with, made once. */
interface GaugeNodes {
	track: SceneNode<AnnularSectorProps>;
	bands: SceneNode<PathBatchItemsProps>;
	value: SceneNode<AnnularSectorProps>;
	needle: ReturnType<typeof line.create>;
	hub: ReturnType<typeof circle.create>;
	readout: ReturnType<typeof decimalNumber.create>;
	caption: ReturnType<typeof text.create>;
	minLabel: ReturnType<typeof text.create>;
	maxLabel: ReturnType<typeof text.create>;
	tooltip: ReturnType<typeof createOwnTooltip>;
	/** The value arc's tooltip text and anchor, as of the last update. */
	tip: { text: () => string | undefined; at: () => Point };
	handlers: ReturnType<typeof tooltipHandlers> | undefined;
}

const states = new WeakMap<object, GaugeNodes>();

function draw(ctx: CompositeContext<GaugeProps>): SceneNode[] {
	const nodes = states.get(ctx.node) as GaugeNodes;
	const props = ctx.props;
	const theme = ctx.theme;
	const all: SceneNode[] = [
		nodes.track,
		nodes.bands,
		nodes.value,
		nodes.needle,
		nodes.hub,
		nodes.readout,
		nodes.caption,
		nodes.minLabel,
		nodes.maxLabel,
	];
	const progress = clamp01(props.progress ?? 1);
	if (props.visible === false || !(progress > 0)) {
		for (const node of all)
			(node as SceneNode<{ visible?: boolean }>).set("visible", false);
		return [...all, ...nodes.tooltip.overlay(ctx)];
	}

	const lo = props.min ?? 0;
	const hi = props.max ?? 100;
	const start = props.startAngle ?? GAUGE_START_ANGLE;
	const sweep = (props.endAngle ?? GAUGE_END_ANGLE) - start;
	const cx = props.center?.x ?? 0;
	const cy = props.center?.y ?? 0;
	const radius = props.radius ?? 1;
	const thickness = props.thickness ?? radius * DEFAULT_THICKNESS;
	const inner = Math.max(0, radius - thickness);
	const bandOuter = Math.max(0, inner - thickness * BAND_GAP);
	const bandInner = Math.max(0, bandOuter - thickness * BAND_WIDTH);
	const fontSize = props.valueFontSize ?? radius * READOUT_SIZE;
	const labelFontSize = props.labelFontSize ?? radius * LABEL_SIZE;
	const places = Math.max(0, Math.trunc(props.decimalPlaces ?? 0));
	const zIndex = props.zIndex ?? 0;
	const center = { x: cx, y: cy };

	/** The value, or `min` when it is not a number. */
	const reading = Number.isFinite(props.value) ? props.value : lo;
	/** The frame's own reveal: track, bands, captions. */
	const frameT = clamp01(progress / FRAME_SHARE);
	/** The data's linear reveal, after the frame. */
	const dataLinear = clamp01((progress - FRAME_SHARE) / (1 - FRAME_SHARE));
	/** Eased out, shared by the arc and the readout so they move in step. */
	const dataT = easings.out(dataLinear);
	const dataOpacity = Math.min(1, dataLinear * 6);

	const spans = gaugeBands(props.bands ?? [], lo, hi);
	const bandColor = (index: number) => {
		const series = theme.palette.series;
		return cssColor(
			props.bands?.[index]?.color ??
				(series.length > 0
					? (series[index % series.length] as ColorInput)
					: theme.palette.foreground),
		);
	};
	let valueColor: string;
	if (props.color !== undefined) valueColor = cssColor(props.color);
	else {
		const band = gaugeBandIndex(reading, spans);
		valueColor =
			band >= 0
				? bandColor(band)
				: cssColor(theme.palette.series[0] ?? theme.palette.foreground);
	}

	/** The value arc's current fraction of the full sweep. */
	const shown = gaugeFraction(reading, lo, hi) * dataT;
	const valueAngle = start + sweep * shown;
	const pointAt = (angle: number, distance: number) => ({
		x: cx + Math.cos(angle) * distance,
		y: cy + Math.sin(angle) * distance,
	});
	const formatted = (value: number) =>
		formatDecimal(value, { decimalPlaces: places, unit: props.unit }).text;

	nodes.track.update({
		center,
		innerRadius: inner,
		outerRadius: radius,
		startAngle: start,
		angle: sweep * frameT,
		fill: props.trackColor ?? theme.palette.grid,
		stroke: "none",
		zIndex,
		visible: true,
	});

	const bands: PathBatchItem[] = [];
	for (const span of spans) {
		const end = Math.min(span.endFraction, frameT);
		if (!(end - span.startFraction > NO_SWEEP)) continue;
		const item = wedgeItem(
			{
				cx,
				cy,
				innerRadius: bandInner,
				outerRadius: bandOuter,
				startAngle: start + sweep * span.startFraction,
				angle: sweep * (end - span.startFraction),
			},
			{ fill: bandColor(span.index) },
			true,
		);
		if (item) bands.push(item);
	}
	nodes.bands.update({
		items: bands,
		stroke: "none",
		zIndex,
		visible: true,
	});

	// The value arc, with its tooltip: "label: value".
	const tooltip = nodes.tooltip(ctx);
	nodes.tip.text = () =>
		tooltipText(
			props.tooltip,
			(value) =>
				props.label ? `${props.label}: ${formatted(value)}` : formatted(value),
			reading,
			0,
			tooltip,
		) as string | undefined;
	nodes.tip.at = () => pointAt(valueAngle, radius);
	nodes.handlers ??= tooltipHandlers(
		tooltip,
		() => nodes.tip.text(),
		() => nodes.tip.at(),
	);
	const handlers = nodes.handlers;
	nodes.value.update({
		center,
		innerRadius: inner,
		outerRadius: radius,
		startAngle: start,
		angle: sweep * shown,
		fill: valueColor,
		stroke: "none",
		zIndex: zIndex + 1,
		visible: Math.abs(sweep * shown) > NO_SWEEP,
		label: handlers.label,
		onEnter: handlers.onEnter,
		onLeave: handlers.onLeave,
		onTap: handlers.onTap,
	});

	const needle = !!props.needle && dataLinear > 0;
	const foreground = theme.palette.foreground;
	nodes.needle.update({
		from: center,
		to: pointAt(
			valueAngle,
			(props.bands?.length ? bandInner : inner) - thickness * 0.15,
		),
		stroke: foreground,
		strokeWidth: radius * 0.025,
		opacity: dataOpacity,
		zIndex: zIndex + 2,
		visible: needle,
	});
	nodes.hub.update({
		center,
		radius: radius * 0.06,
		fill: foreground,
		stroke: "none",
		opacity: dataOpacity,
		zIndex: zIndex + 2,
		visible: needle,
	});

	const readoutY = props.needle ? cy - radius * 0.4 : cy;
	// Integer columns to hold open so the counting readout keeps one width.
	const integerDigits = formatDecimal(
		Math.max(Math.abs(lo), Math.abs(reading)),
		{
			decimalPlaces: places,
		},
	).integerDigits;
	nodes.readout.update({
		value: lo + (reading - lo) * dataT,
		decimalPlaces: places,
		unit: props.unit,
		minIntegerDigits: integerDigits,
		reserveSign: lo < 0 || reading < 0,
		x: cx,
		y: readoutY,
		fontSize,
		color: foreground,
		opacity: dataOpacity,
		zIndex: zIndex + 3,
		visible: true,
	});
	nodes.caption.update({
		text: props.label ?? "",
		x: cx,
		y: readoutY - fontSize * 0.75,
		fontSize: labelFontSize,
		color: theme.palette.muted,
		opacity: frameT,
		zIndex: zIndex + 3,
		visible: !!props.label,
	});
	// Under the arc's ends, centred on the track.
	const rangeLabelAt = (angle: number) => {
		const p = pointAt(angle, (inner + radius) / 2);
		return { x: p.x, y: p.y - labelFontSize * 1.1 };
	};
	const ranges = props.rangeLabels !== false;
	const low = rangeLabelAt(start);
	const high = rangeLabelAt(start + sweep);
	nodes.minLabel.update({
		text: formatTick(lo),
		x: low.x,
		y: low.y,
		fontSize: labelFontSize,
		color: theme.palette.muted,
		opacity: frameT,
		zIndex: zIndex + 3,
		visible: ranges,
	});
	nodes.maxLabel.update({
		text: formatTick(hi),
		x: high.x,
		y: high.y,
		fontSize: labelFontSize,
		color: theme.palette.muted,
		opacity: frameT,
		zIndex: zIndex + 3,
		visible: ranges,
	});
	return [...all, ...nodes.tooltip.overlay(ctx)];
}

/**
 * A gauge: one value on an arc with a centre readout, the KPI dial of a dashboard. Optional
 * threshold `bands` colour the value by zone; `needle` adds a pointer. Draws in scene units;
 * needs no `chart`.
 *
 * @example
 * ```ts
 * import { gauge } from "@sophistry/charts";
 *
 * gauge.create({ value: 72, unit: "%", label: "CPU", bands: [{ to: 60 }, { to: 85 }, { to: 100 }] });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#gauges-bullets-waffles-mosaics-and-radial-bars
 * @category Charts
 */
export const gauge = defineComposite<GaugeProps>({
	name: "Gauge",
	props: {
		value: { default: 0, invalidates: Invalidate.UPDATE },
		min: { invalidates: Invalidate.UPDATE },
		max: { invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		radius: { invalidates: Invalidate.UPDATE },
		thickness: { invalidates: Invalidate.UPDATE },
		startAngle: { invalidates: Invalidate.UPDATE },
		endAngle: { invalidates: Invalidate.UPDATE },
		bands: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		trackColor: { invalidates: Invalidate.UPDATE },
		needle: { invalidates: Invalidate.UPDATE },
		decimalPlaces: { invalidates: Invalidate.UPDATE },
		unit: { invalidates: Invalidate.UPDATE },
		valueFontSize: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		rangeLabels: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const ring = { innerRadius: 0, outerRadius: 1 };
		states.set(ctx.node, {
			track: annularSector.create(ring),
			bands: pathBatch.create({ items: [] }),
			value: annularSector.create(ring),
			needle: line.create({ from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }),
			hub: circle.create({ radius: 0 }),
			readout: decimalNumber.create({ value: 0 }),
			caption: text.create({ text: "" }),
			minLabel: text.create({ text: "" }),
			maxLabel: text.create({ text: "" }),
			tooltip: createOwnTooltip(),
			tip: { text: () => undefined, at: () => ({ x: 0, y: 0 }) },
			handlers: undefined,
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
