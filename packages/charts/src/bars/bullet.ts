/**
 * `bullet`: one measure against a target and qualitative ranges per row,
 * drawn in scene units (no `chart`). The qualitative bands, the measure bars
 * and the target markers are three instances nodes of `rect`s (they paint
 * at three depths); titles and tick numbers are label nodes.
 *
 * The tooltip overlay is the chart frame's; until a shared one exists,
 * `bullet` keeps its own tooltip state (the bars' handlers show and hide
 * it) and draws no panel.
 */

import type {
	CompositeContext,
	LabelProps,
	RectProps,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate, label, rect } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import { mixColor } from "@sophistry/core/color";
import type { Point } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import {
	clamp01,
	cssColor,
	maxOf,
	measureLabel,
	minOf,
} from "@sophistry/core/internal";
import type { BatchItem } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import type { Channel, ColorChannel, Quantity } from "../data/channels.js";
import {
	colorResolver,
	identity,
	numberValues,
	resolveChannel,
	resolveQuantity,
} from "../data/channels.js";
import { itemTooltipHandlers } from "../item-tooltip.js";
import type { BulletRowGeometry } from "../math/bullet.js";
import { bulletDomain, bulletRow } from "../math/bullet.js";
import type { AnyDatum } from "../props.js";
import { staggered } from "../stagger.js";
import type { TooltipSpec, TooltipState } from "../tooltip.js";
import { createTooltipState, tooltipText } from "../tooltip.js";
import { labelStyle } from "./shared.js";

/** Share of `progress` spent fading in the bands, titles and ticks before the data. */
const FRAME_SHARE = 0.3;
/** Share of a row's own reveal spent on its bar; the target marker takes the rest. */
const BAR_SHARE = 0.8;
const DEFAULT_STAGGER = 0.3;
const DEFAULT_PADDING = 0.35;
/** The measure bar is a third of the band's thickness. */
const DEFAULT_BAR_SIZE = 1 / 3;
/** The target marker's length, as a fraction of the band's thickness. */
const TARGET_SIZE = 0.7;
const DEFAULT_LABEL_FONT_SIZE = 0.24;
const DEFAULT_TICK_FONT_SIZE = 0.16;
/** Gap between a row's title and its scale, in scene units. */
const LABEL_GAP = 0.2;
/** Widest share of `width` the titles may take when `labelWidth` is not given. */
const MAX_LABEL_SHARE = 0.45;
/** Mix toward the foreground of the worst (darkest, in a light theme) and best bands. */
const WORST_BAND = 0.42;
const BEST_BAND = 0.14;
const EPSILON = 1e-9;

/**
 * Props of {@link bullet}: `value` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export interface BulletProps<T = unknown> {
	/** One bullet per datum, stacked top-down in data order. */
	data: readonly T[];
	/**
	 * The featured measure. Defaults to the datum when `data` is `number[]`; required otherwise. A
	 * non-finite value draws no bar.
	 */
	value?: Channel<T, number>;
	/** The comparative measure, drawn as a short perpendicular line. Omitted, no marker. */
	target?: Channel<T, number>;
	/**
	 * Qualitative thresholds, ascending, each where a band ends: `[150, 225, 300]` reads poor /
	 * satisfactory / good. The last band runs to the end of the scale.
	 */
	ranges?: Channel<T, readonly number[]>;
	/** The row's title, right-aligned to the left of its scale. */
	label?: Channel<T, string>;
	/**
	 * Where a row's scale starts, in data units: a number or a channel. Defaults to 0 (or below the
	 * smallest value when one is negative).
	 */
	min?: Quantity<T>;
	/**
	 * Where a row's scale ends, in data units: a number or a channel. Defaults to the largest of
	 * the row's value, target and thresholds.
	 */
	max?: Quantity<T>;
	/**
	 * Give every row the same scale instead of its own (use when rows measure the same thing).
	 * @default false
	 */
	sharedScale?: boolean;
	/**
	 * Round default scale ends out to tick values.
	 * @default true
	 */
	nice?: boolean;
	/** Width of the chart, titles included. */
	width: number;
	/** Height of the chart; each row gets an equal slot. */
	height: number;
	/** Centre of the chart. Defaults to the origin. */
	center?: Point;
	/**
	 * Width kept for the titles. Defaults to the widest title plus a gap, at most 45% of `width`.
	 */
	labelWidth?: number;
	/**
	 * Colour of the measure bar, constant or `(d, i) => colour`. Defaults to the theme's first
	 * series colour.
	 */
	color?: ColorChannel<T>;
	/**
	 * One colour per band, worst first. Defaults to graded greys from background toward foreground,
	 * the worst band strongest.
	 */
	rangeColors?: readonly ColorInput[];
	/** Colour of the target marker. Defaults to the theme's foreground. */
	targetColor?: ColorInput;
	/**
	 * Thickness of the measure bar, as a fraction of the band's.
	 * @default 1/3
	 */
	barSize?: number;
	/**
	 * Gap between rows, as a fraction of a row's slot.
	 * @default 0.35
	 */
	padding?: number;
	/**
	 * Write tick numbers under each row's scale.
	 * @default true
	 */
	ticks?: boolean;
	/**
	 * Title font size.
	 * @default 0.24
	 */
	labelFontSize?: number;
	/**
	 * Tick-number font size.
	 * @default 0.16
	 */
	tickFontSize?: number;
	/**
	 * Reveal, 0..1: bands, titles and ticks fade in first; then each row's bar grows from zero and
	 * its target draws in, rows staggered top-down.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the data reveal spent staggering row after row, 0..0.95.
	 * @default 0.3
	 */
	stagger?: number;
	/** Hover tooltip on the bar: `true` for "label: value (target T)", or `(d, i) => string`. */
	tooltip?: TooltipSpec<T>;
	/** Paint order; higher draws later. */
	zIndex?: number;
	visible?: boolean;
}

/** One row, resolved: its datum's place, numbers and geometry. */
interface Row {
	index: number;
	value: number;
	target: number | undefined;
	label: string | undefined;
	geometry: BulletRowGeometry;
}

/** A rect of a bullet: a band, a bar or a target marker. */
interface BulletRect extends BatchItem {
	center: Point;
	width: number;
	height: number;
	fill: string;
	opacity: number;
	/** The row's index (bars: for the tooltip), and where its tooltip points. */
	index: number;
	at: Point;
}

type Rects = ReturnType<
	typeof createBatchedMark<
		BulletRect,
		RectProps,
		SceneNode<RectProps>,
		keyof RectProps
	>
>;

/** What a bullet keeps between updates. */
interface BulletState {
	tooltip: TooltipState;
	bands: Rects;
	bars: Rects;
	targets: Rects;
}

const states = new WeakMap<object, BulletState>();

function rects(): Rects {
	return createBatchedMark<
		BulletRect,
		RectProps,
		SceneNode<RectProps>,
		keyof RectProps
	>(rect as never, {
		channels: {
			center: (item) => item.center,
			width: (item) => item.width,
			height: (item) => item.height,
			fill: (item) => item.fill,
			opacity: (item) => item.opacity,
		},
	});
}

function draw(ctx: CompositeContext<BulletProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as BulletState;
	const props = ctx.props as Readonly<BulletProps<unknown>>;
	const theme = ctx.theme;
	const progress = clamp01(props.progress ?? 1);
	const labelNodes = (entries: { key: string; props: LabelProps }[]) =>
		ctx.list("labels", entries, {
			key: (entry) => entry.key,
			create: (entry) => label.create(entry.props),
			update: (node, entry) => {
				node.update(entry.props);
			},
		});
	if (props.visible === false || !(progress > 0)) {
		labelNodes([]);
		return [];
	}

	const values = numberValues(props.data, props.value, identity, "value");
	const targets =
		props.target === undefined
			? undefined
			: numberValues(props.data, props.target, undefined, "target");
	const readRanges = resolveChannel(props.ranges, undefined, "ranges");
	const thresholds = props.data.map((d, i) => {
		const r = readRanges?.(d, i);
		return Array.isArray(r)
			? r.map((v) => (typeof v === "number" ? v : Number.NaN))
			: [];
	});
	const readLabel = resolveChannel(props.label, undefined, "label");
	const labels = readLabel
		? props.data.map((d, i) => readLabel(d, i) as string | undefined)
		: undefined;
	const lo = resolveQuantity(props.min);
	const hi = resolveQuantity(props.max);
	const bounds = props.data.map((d, i) => ({
		min: lo?.(d, i),
		max: hi?.(d, i),
	}));
	const finite = (list: (number | undefined)[]) =>
		list.filter((v): v is number => Number.isFinite(v));
	const shared = props.sharedScale
		? bulletDomain([...values, ...(targets ?? []), ...thresholds.flat()], {
				min: (() => {
					const mins = finite(bounds.map((b) => b.min));
					return mins.length > 0 ? minOf(mins) : undefined;
				})(),
				max: (() => {
					const maxes = finite(bounds.map((b) => b.max));
					return maxes.length > 0 ? maxOf(maxes) : undefined;
				})(),
				nice: props.nice,
			})
		: undefined;
	const rows: Row[] = values.map((value, index) => ({
		index,
		value,
		target: targets?.[index],
		label: labels?.[index],
		geometry: bulletRow(value, {
			target: targets?.[index],
			ranges: thresholds[index],
			min: bounds[index]?.min,
			max: bounds[index]?.max,
			nice: props.nice,
			domain: shared,
		}),
	}));

	const labelFontSize = props.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE;
	const tickFontSize = props.tickFontSize ?? DEFAULT_TICK_FONT_SIZE;
	const showTicks = props.ticks !== false;
	const fontFamily = theme.defaults.fontFamily;
	const cx = props.center?.x ?? 0;
	const cy = props.center?.y ?? 0;
	const left = cx - props.width / 2;
	const top = cy + props.height / 2;
	/** The titles' column, gap included. */
	let labelArea = 0;
	if (props.labelWidth !== undefined) labelArea = Math.max(0, props.labelWidth);
	else if (labels?.some(Boolean)) {
		const widest = labels.reduce(
			(m, name) =>
				name
					? Math.max(
							m,
							measureLabel(name, labelStyle(labelFontSize, fontFamily)).width,
						)
					: m,
			0,
		);
		labelArea = Math.min(widest + LABEL_GAP, props.width * MAX_LABEL_SHARE);
	}
	/** Room past the scale's end for half its last tick number. */
	const rightPad = showTicks
		? rows.reduce((m, row) => {
				const last = row.geometry.ticks[row.geometry.ticks.length - 1];
				if (last === undefined) return m;
				const w = measureLabel(
					formatTick(last),
					labelStyle(tickFontSize, fontFamily),
				).width;
				return Math.max(m, w / 2);
			}, 0)
		: 0;
	const x0 = left + labelArea;
	const length = Math.max(0, props.width - labelArea - rightPad);
	const xAt = (fraction: number) => x0 + length * fraction;
	const slot = rows.length > 0 ? props.height / rows.length : 0;
	const tickArea = showTicks ? tickFontSize * 1.5 : 0;
	const bandHeight = Math.max(
		0,
		(slot - tickArea) *
			(1 - Math.min(0.95, Math.max(0, props.padding ?? DEFAULT_PADDING))),
	);
	const centreY = (index: number) => top - index * slot - (slot - tickArea) / 2;
	const barHeight = bandHeight * clamp01(props.barSize ?? DEFAULT_BAR_SIZE);
	const frameT = clamp01(progress / FRAME_SHARE);
	const dataT = clamp01((progress - FRAME_SHARE) / (1 - FRAME_SHARE));
	const bandColor = (index: number, count: number) => {
		const given = props.rangeColors?.[index];
		if (given !== undefined) return cssColor(given);
		const t =
			count <= 1
				? (WORST_BAND + BEST_BAND) / 2
				: WORST_BAND - ((WORST_BAND - BEST_BAND) * index) / (count - 1);
		return cssColor(
			mixColor(theme.palette.background, theme.palette.foreground, t),
		);
	};
	const barColor = colorResolver(
		props.color,
		[theme.palette.series[0] ?? theme.palette.foreground],
		theme.palette.foreground,
	);
	const targetColor = cssColor(props.targetColor ?? theme.palette.foreground);
	const zIndex = props.zIndex ?? 0;

	const bands: BulletRect[] = [];
	const bars: BulletRect[] = [];
	const marks: BulletRect[] = [];
	const texts: { key: string; props: LabelProps }[] = [];
	for (const row of rows) {
		const g = row.geometry;
		/** This row's own reveal, top row first. */
		const t = staggered(
			dataT,
			row.index,
			rows.length,
			props.stagger ?? DEFAULT_STAGGER,
		);
		const barT = clamp01(t / BAR_SHARE);
		const targetT = clamp01((t - BAR_SHARE) / (1 - BAR_SHARE));
		const y = centreY(row.index);
		for (const band of g.bands) {
			if (!(band.endFraction - band.startFraction > EPSILON)) continue;
			const center = {
				x: xAt((band.startFraction + band.endFraction) / 2),
				y,
			};
			bands.push({
				key: `${row.index}:${band.index}`,
				center,
				width: length * (band.endFraction - band.startFraction),
				height: bandHeight,
				fill: bandColor(band.index, g.bands.length),
				opacity: frameT,
				index: row.index,
				at: center,
			});
		}
		/** The bar's ends as fractions of the scale, at this moment of the reveal. */
		const m = g.measure;
		if (m) {
			const grow = g.zero ? barT : 1;
			const end = m.startFraction + (m.endFraction - m.startFraction) * grow;
			const span = [
				Math.min(m.startFraction, end),
				Math.max(m.startFraction, end),
			] as const;
			// Only while it has any length to draw.
			if ((span[1] - span[0]) * length > EPSILON)
				bars.push({
					key: row.index,
					center: { x: xAt((span[0] + span[1]) / 2), y },
					width: length * (span[1] - span[0]),
					height: barHeight,
					fill: barColor(props.data[row.index], row.index),
					opacity: g.zero ? 1 : barT,
					index: row.index,
					at: { x: xAt(m.endFraction), y: y + barHeight / 2 },
				});
		}
		if (targetT > 0 && g.target) {
			const center = { x: xAt(g.target.fraction), y };
			marks.push({
				key: row.index,
				center,
				width: Math.max(0.02, Math.min(0.06, bandHeight * 0.08)),
				height: bandHeight * TARGET_SIZE * targetT,
				fill: targetColor,
				opacity: targetT,
				index: row.index,
				at: center,
			});
		}
		if (row.label)
			texts.push({
				key: `label:${row.index}`,
				props: {
					text: row.label,
					x: x0 - LABEL_GAP,
					y,
					align: "right",
					fontSize: labelFontSize,
					color: theme.palette.foreground,
					opacity: frameT,
					zIndex: zIndex + 3,
				},
			});
		if (showTicks)
			g.ticks.forEach((tick, i) => {
				texts.push({
					key: `tick:${row.index}:${i}`,
					props: {
						text: formatTick(tick),
						x: xAt((tick - g.domain[0]) / (g.domain[1] - g.domain[0])),
						y: y - bandHeight / 2 - tickFontSize * 0.3,
						baseline: "top",
						fontSize: tickFontSize,
						color: theme.palette.muted,
						opacity: frameT,
						zIndex: zIndex + 3,
					},
				});
			});
	}

	const text = (row: Row) => {
		const value = formatTick(row.value);
		const head = row.label ? `${row.label}: ${value}` : value;
		return row.target !== undefined && Number.isFinite(row.target)
			? `${head} (target ${formatTick(row.target)})`
			: head;
	};
	const handlers = itemTooltipHandlers(
		state.tooltip,
		(item) => {
			const bar = state.bars.itemAt(item);
			const row = bar ? rows[bar.index] : undefined;
			if (!bar || !row) return undefined;
			return tooltipText(
				props.tooltip,
				() => text(row),
				props.data[row.index],
				row.index,
			);
		},
		(item) => state.bars.itemAt(item)?.at,
		() => "Bullet",
	);
	state.bands.update(bands, { stroke: "none", zIndex } as never);
	state.bars.update(bars, {
		stroke: "none",
		zIndex: zIndex + 1,
		...(props.tooltip !== undefined
			? {
					label: handlers.label,
					onEnter: handlers.onEnter,
					onLeave: handlers.onLeave,
					onTap: handlers.onTap,
					itemLabel: handlers.itemLabel,
				}
			: {}),
	} as never);
	state.targets.update(marks, { stroke: "none", zIndex: zIndex + 2 } as never);
	return [
		state.bands.node,
		state.bars.node,
		state.targets.node,
		...labelNodes(texts),
	];
}

/**
 * A bullet chart: one measure against a target and qualitative ranges per
 * row, a compact dashboard KPI that stacks into a table. Each row gets its
 * own scale unless `sharedScale`. Draws in scene units; needs no `chart`.
 *
 * @example
 * ```ts
 * import { createScene } from "@sophistry/core";
 * import { bullet } from "@sophistry/charts";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 10 });
 * scene.add(
 * 	bullet.create({
 * 		data: [{ name: "Revenue", value: 270, target: 250, ranges: [150, 225, 300] }],
 * 		value: "value",
 * 		target: "target",
 * 		ranges: "ranges",
 * 		label: "name",
 * 		width: 8,
 * 		height: 1.5,
 * 	}),
 * );
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#gauges-bullets-waffles-mosaics-and-radial-bars
 * @category Charts
 */
export const bullet = defineComposite<BulletProps<AnyDatum>>({
	name: "Bullet",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		target: { invalidates: Invalidate.UPDATE },
		ranges: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		min: { invalidates: Invalidate.UPDATE },
		max: { invalidates: Invalidate.UPDATE },
		sharedScale: { invalidates: Invalidate.UPDATE },
		nice: { invalidates: Invalidate.UPDATE },
		width: { default: 8, invalidates: Invalidate.UPDATE },
		height: { default: 2, invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		labelWidth: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		rangeColors: { invalidates: Invalidate.UPDATE },
		targetColor: { invalidates: Invalidate.UPDATE },
		barSize: { invalidates: Invalidate.UPDATE },
		padding: { invalidates: Invalidate.UPDATE },
		ticks: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		tickFontSize: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			tooltip: createTooltipState(),
			bands: rects(),
			bars: rects(),
			targets: rects(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});

/**
 * A `bullet` node's tooltip state (what its bars show on hover), for an
 * overlay to bind to; null for a node that is not a `bullet`.
 *
 * @category Charts
 */
export function bulletTooltip(node: SceneNode): TooltipState | null {
	return states.get(node)?.tooltip ?? null;
}
