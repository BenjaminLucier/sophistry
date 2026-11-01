/**
 * `mosaic`: a Marimekko chart, columns as wide as their share of the whole,
 * split into segments as tall as each row's share within the column.
 *
 * Every segment is one `rect` instance of one instances node, keyed by its
 * (column, row) pair; per-segment picking and tooltips go through
 * `event.item`. Columns grow from the bottom edge (geometry).
 * Segment and column names are `label` nodes, one per name that fits.
 */

import type { CompositeContext, RectProps, SceneNode } from "@sophistry/core";
import { defineComposite, Invalidate, rect } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { Point } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import { clamp01, cssColor } from "@sophistry/core/internal";
import type { BatchItem } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import type { Channel, ColorChannel } from "../data/channels.js";
import {
	numberValues,
	resolveChannel,
	resolveColor,
} from "../data/channels.js";
import { itemTooltipHandlers } from "../item-tooltip.js";
import type {
	MosaicInput,
	MosaicKey,
	MosaicLayout,
	MosaicRect,
} from "../math/mosaic.js";
import { mosaicLayout } from "../math/mosaic.js";
import { largestRemainder } from "../math/waffle.js";
import { readableOn } from "../mix.js";
import type { AnyDatum } from "../props.js";
import { staggered } from "../stagger.js";
import type { TooltipSpec, TooltipState } from "../tooltip.js";
import { tooltipText } from "../tooltip.js";
import type { KeyedLabel } from "./labels.js";
import { createLabelMeasure, labelList } from "./labels.js";
import { createOwnTooltip } from "./own-tooltip.js";

/** Share of `progress` spent fading in the column names before the columns grow. */
const FRAME_SHARE = 0.2;
const DEFAULT_STAGGER = 0.5;
const DEFAULT_PADDING = 0.04;
const DEFAULT_LABEL_FONT_SIZE = 0.2;
/** Space between a label and its segment's edges, as a fraction of the font size. */
const LABEL_PAD = 0.3;
/** Gap between the mosaic's bottom edge and the column names, as a fraction of the font size. */
const COLUMN_LABEL_GAP = 0.5;
/** Line spacing of a column's name and its share, as a fraction of the font size. */
const LINE_HEIGHT = 1.25;
/** The weight the mosaic's names are set (and measured) at. */
const LABEL_WEIGHT = 400;

/**
 * Props of {@link mosaic}.
 *
 * @category Charts
 */
export interface MosaicProps<T> {
	/** Long-form table: one datum per (column, row, value); duplicate pairs sum. */
	data: readonly T[];
	/** The column category. Data with no category are skipped. */
	x: Channel<T, MosaicKey>;
	/** The segment (row) category. Data with no category are skipped. */
	y: Channel<T, MosaicKey>;
	/**
	 * The amount; negative and non-finite values count as 0. Omitted, every datum counts 1 (a
	 * contingency table of counts).
	 */
	value?: Channel<T, number>;
	/** Column order, left to right; unlisted categories follow. Defaults to first-seen order. */
	columns?: readonly MosaicKey[];
	/** Segment order, bottom to top; unlisted categories follow. Defaults to first-seen order. */
	rows?: readonly MosaicKey[];
	/** Width of the mosaic. */
	width: number;
	/** Height of the mosaic (column names hang below it). */
	height: number;
	/** Centre of the mosaic. Defaults to the origin. */
	center?: Point;
	/**
	 * Gap between columns, and between segments in a column.
	 * @default 0.04
	 */
	padding?: number;
	/**
	 * One colour for every segment, or `(d, i) => colour` called with the segment's first datum
	 * (returning nothing falls back to `colors`). Wins over `colors`.
	 */
	color?: ColorChannel<T>;
	/**
	 * Colours cycled across the row categories, so a row has one colour in every column. Defaults
	 * to the theme's categorical colours.
	 */
	colors?: readonly ColorInput[];
	/**
	 * Fill opacity of the segments, 0..1.
	 * @default 1
	 */
	fillOpacity?: number;
	/**
	 * Write each row's name inside its segment where it fits.
	 * @default true
	 */
	labels?: boolean;
	/**
	 * Write each column's name under it where it fits.
	 * @default true
	 */
	columnLabels?: boolean;
	/**
	 * Write each column's share of the total under its name.
	 * @default false
	 */
	shares?: boolean;
	/**
	 * Label font size.
	 * @default 0.2
	 */
	labelFontSize?: number;
	/**
	 * Reveal, 0..1: column names fade in first, then the columns grow left to right from the
	 * bottom, segment names fading in as they go.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the columns' reveal spent staggering column after column, 0..0.95.
	 * @default 0.5
	 */
	stagger?: number;
	/**
	 * Hover tooltip on a segment: `true` for "column · row: value (pct% of column)", or `(d, i) =>
	 * string` called with its first datum.
	 */
	tooltip?: TooltipSpec<T>;
	/** Paint order; labels draw at `zIndex + 1`. */
	zIndex?: number;
	/**
	 * Set to `false` to hide the chart.
	 * @default true
	 */
	visible?: boolean;
}

/** A category's display text. */
const keyText = (key: MosaicKey) =>
	typeof key === "number" ? formatTick(key) : key;

/** A usable category: a string, or a number that is not NaN. */
function isKey(value: unknown): value is MosaicKey {
	return (
		typeof value === "string" ||
		(typeof value === "number" && !Number.isNaN(value))
	);
}

/** One segment, in scene units. */
interface SegmentItem extends BatchItem {
	key: string;
	rect: MosaicRect;
	center: Point;
	width: number;
	height: number;
	fill: string;
	/** Where its tooltip points. */
	at: Point;
}

interface MosaicState {
	tooltipOf: ReturnType<typeof createOwnTooltip>;
	tooltip: TooltipState | null;
	handlers: ReturnType<typeof itemTooltipHandlers> | null;
	layout: (...args: unknown[]) => MosaicLayout;
	percents: (layout: MosaicLayout) => number[];
	segments: ReturnType<
		typeof createBatchedMark<
			SegmentItem,
			RectProps,
			SceneNode<RectProps>,
			keyof RectProps
		>
	>;
	measure: ReturnType<typeof createLabelMeasure>;
	props: MosaicProps<AnyDatum>;
}

const states = new WeakMap<object, MosaicState>();

function draw(
	ctx: CompositeContext<MosaicProps<AnyDatum>>,
	state: MosaicState,
): SceneNode[] {
	const props = ctx.props;
	state.props = props;
	const theme = ctx.theme;
	const tooltip = state.tooltipOf(ctx);
	if (tooltip !== state.tooltip) {
		state.tooltip = tooltip;
		state.handlers = itemTooltipHandlers(
			tooltip,
			(item) => {
				const own = state.segments.itemAt(item);
				if (!own) return undefined;
				const p = state.props;
				return tooltipText(
					p.tooltip,
					() => describe(own.rect),
					p.data[own.rect.dataIndex],
					own.rect.dataIndex,
				);
			},
			(item) => state.segments.itemAt(item)?.at,
			() => undefined,
		);
	}
	const layout = state.layout(
		props.data,
		props.x,
		props.y,
		props.value,
		props.columns,
		props.rows,
		props.width,
		props.height,
		props.padding ?? DEFAULT_PADDING,
	);
	const left = (props.center?.x ?? 0) - props.width / 2;
	const top = (props.center?.y ?? 0) + props.height / 2;
	const bottom = (props.center?.y ?? 0) - props.height / 2;
	const fontSize = props.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE;
	/** A label's width at the mosaic's weight (400). */
	const labelWidth = (text: string) =>
		state.measure(text, fontSize, theme, LABEL_WEIGHT);
	const progress = clamp01(props.progress ?? 1);
	const frameT = clamp01(progress / FRAME_SHARE);
	const dataT = clamp01((progress - FRAME_SHARE) / (1 - FRAME_SHARE));
	const stagger = props.stagger ?? DEFAULT_STAGGER;
	const columnCount = layout.columns.length;
	const shown = props.visible !== false && progress > 0;
	const palette = props.colors ?? theme.palette.series;
	const ownColor = resolveColor(props.color);
	const colorOf = (r: MosaicRect) =>
		ownColor?.(props.data[r.dataIndex], r.dataIndex) ??
		cssColor(
			palette.length === 0
				? theme.palette.foreground
				: (palette[r.rowIndex % palette.length] as ColorInput),
		);

	const items: SegmentItem[] = [];
	const texts: KeyedLabel[] = [];
	for (const r of shown ? layout.rects : []) {
		/** The column's own growth, by its place in column order. */
		const t = staggered(dataT, r.columnIndex, columnCount, stagger);
		if (!(t > 0)) continue;
		/** The final box, in scene units (y up). */
		const minX = left + r.x0;
		const maxX = left + r.x1;
		const minY = top - r.y1;
		const maxY = top - r.y0;
		/** The box scaled toward the mosaic's bottom edge by the column's growth. */
		const grownMinY = bottom + (minY - bottom) * t;
		const grownMaxY = bottom + (maxY - bottom) * t;
		const fill = colorOf(r);
		const key = `${JSON.stringify(r.column)}\u0000${JSON.stringify(r.row)}`;
		items.push({
			key,
			rect: r,
			center: { x: (minX + maxX) / 2, y: (grownMinY + grownMaxY) / 2 },
			width: Math.max(0, maxX - minX),
			height: Math.max(0, grownMaxY - grownMinY),
			fill,
			at: { x: (minX + maxX) / 2, y: grownMaxY },
		});
		if (props.labels === false || !(t > 0.5)) continue;
		const text = keyText(r.row);
		const pad = LABEL_PAD * fontSize;
		if (
			labelWidth(text) + 2 * pad > maxX - minX ||
			fontSize + 2 * pad > maxY - minY
		)
			continue;
		texts.push({
			key,
			props: {
				text,
				x: (minX + maxX) / 2,
				y: (grownMinY + grownMaxY) / 2,
				align: "center",
				baseline: "middle",
				fontSize,
				color: readableOn(
					fill,
					theme.palette.foreground,
					theme.palette.background,
				),
				opacity: clamp01(2 * t - 1),
				zIndex: (props.zIndex ?? 0) + 1,
			},
		});
	}

	/** The names (and shares) under each column, where they fit. */
	const columnTexts: KeyedLabel[] = [];
	if (shown && props.columnLabels !== false) {
		const columns = layout.columns;
		const y = bottom - fontSize * COLUMN_LABEL_GAP;
		const percents = props.shares ? state.percents(layout) : [];
		columns.forEach((column, k) => {
			// A name may spill into the gaps beside its column, not past them.
			const gapLeft = k > 0 ? column.x0 - (columns[k - 1]?.x1 ?? 0) : 0;
			const gapRight =
				k < columns.length - 1 ? (columns[k + 1]?.x0 ?? 0) - column.x1 : 0;
			const room = column.x1 - column.x0 + Math.min(gapLeft, gapRight);
			const x = left + (column.x0 + column.x1) / 2;
			const name = keyText(column.key);
			let lines = 0;
			const line = (text: string, kind: string, at: number) => {
				columnTexts.push({
					key: `${kind}\u0000${JSON.stringify(column.key)}`,
					props: {
						text,
						x,
						y: at,
						align: "center",
						baseline: "top",
						fontSize,
						color: theme.palette.foreground,
						opacity: frameT,
						zIndex: (props.zIndex ?? 0) + 1,
					},
				});
				lines++;
			};
			if (labelWidth(name) <= room) line(name, "name", y);
			if (props.shares) {
				const share = `${percents[k]}%`;
				if (labelWidth(share) <= room)
					line(share, "share", y - (lines > 0 ? fontSize * LINE_HEIGHT : 0));
			}
		});
	}

	const tips = props.tooltip !== undefined && props.tooltip !== false;
	const handlers = tips ? state.handlers : null;
	state.segments.update(items, {
		stroke: "none",
		fillOpacity: props.fillOpacity ?? 1,
		zIndex: props.zIndex ?? 0,
		label: handlers ? `Mosaic, ${items.length} segments` : undefined,
		itemLabel: handlers?.itemLabel,
		onEnter: handlers?.onEnter,
		onLeave: handlers?.onLeave,
		onTap: handlers?.onTap,
	} as never);
	return [
		state.segments.node,
		...labelList(ctx, "labels", texts),
		...labelList(ctx, "columns", columnTexts),
	];
}

/** A segment's default tooltip: "column · row: value (pct% of column)". */
function describe(r: MosaicRect): string {
	const column = keyText(r.column);
	const pct = Math.round(r.rowShare * 100);
	return `${column} · ${keyText(r.row)}: ${formatTick(r.value)} (${pct}% of ${column})`;
}

/**
 * A mosaic (Marimekko) chart: columns whose widths are their share of the whole, split into
 * segments whose heights are each row's share within the column, so every rectangle's area is
 * its value. `data` is long-form, one datum per (column, row, value). Lays itself out in a
 * `width × height` box; needs no `chart`. The segments are one instances node (`event.item`
 * picks one). See {@link mosaicLayout} for the layout alone.
 *
 * @example
 * ```ts
 * import { mosaic } from "@sophistry/charts";
 *
 * const sales = [
 * 	{ region: "north", product: "tea", units: 30 },
 * 	{ region: "north", product: "coffee", units: 50 },
 * 	{ region: "south", product: "tea", units: 45 },
 * 	{ region: "south", product: "coffee", units: 15 },
 * ];
 * mosaic.create({ data: sales, x: "region", y: "product", value: "units", width: 8, height: 4, shares: true });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#gauges-bullets-waffles-mosaics-and-radial-bars
 * @category Charts
 */
export const mosaic = defineComposite<MosaicProps<AnyDatum>>({
	name: "Mosaic",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		columns: { invalidates: Invalidate.UPDATE },
		rows: { invalidates: Invalidate.UPDATE },
		width: { invalidates: Invalidate.UPDATE },
		height: { invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		padding: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		labels: { invalidates: Invalidate.UPDATE },
		columnLabels: { invalidates: Invalidate.UPDATE },
		shares: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const state: MosaicState = {
			tooltipOf: createOwnTooltip(),
			tooltip: null,
			handlers: null,
			layout: ctx.memo((...args: unknown[]) => {
				const [
					data,
					xOf,
					yOf,
					valueChannel,
					columns,
					rows,
					width,
					height,
					padding,
				] = args as [
					readonly unknown[],
					Channel<unknown, MosaicKey>,
					Channel<unknown, MosaicKey>,
					Channel<unknown, number> | undefined,
					readonly MosaicKey[] | undefined,
					readonly MosaicKey[] | undefined,
					number,
					number,
					number,
				];
				/** The table, plus each entry's data index (data with no category are skipped). */
				const readX = resolveChannel(xOf, undefined, "x");
				const readY = resolveChannel(yOf, undefined, "y");
				const values =
					valueChannel === undefined
						? undefined
						: numberValues(data, valueChannel, undefined, "value");
				const cells: MosaicInput[] = [];
				const source: number[] = [];
				data.forEach((d, i) => {
					const x = readX(d, i);
					const y = readY(d, i);
					if (!isKey(x) || !isKey(y)) return;
					cells.push({ x, y, value: values ? (values[i] as number) : 1 });
					source.push(i);
				});
				const laid = mosaicLayout(cells, {
					columns,
					rows,
					width,
					height,
					padding,
				});
				// Re-point every segment at its datum's index in `data`.
				return {
					...laid,
					rects: laid.rects.map((r) => ({
						...r,
						dataIndex: source[r.dataIndex] as number,
					})),
				};
			}),
			/** Whole percentages of the total, one per drawn column, summing to 100. */
			percents: ctx.memo((layout: MosaicLayout) =>
				largestRemainder(
					layout.columns.map((c) => c.value),
					100,
				),
			),
			segments: createBatchedMark<
				SegmentItem,
				RectProps,
				SceneNode<RectProps>,
				keyof RectProps
			>(rect as never, {
				channels: {
					center: (item) => item.center,
					width: (item) => item.width,
					height: (item) => item.height,
					fill: (item) => item.fill,
				},
			}),
			measure: createLabelMeasure(),
			props: ctx.props,
		};
		states.set(ctx.node, state);
		return draw(ctx, state);
	},
	update: (_changed, ctx) => draw(ctx, states.get(ctx.node) as MosaicState),
});
