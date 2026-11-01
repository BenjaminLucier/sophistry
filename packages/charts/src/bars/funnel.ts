/**
 * `funnel`: how many make it through each stage of a process. A preset: a
 * `chart` with a band y axis whose one layer (the internal `FunnelStages`)
 * draws the stages as one instances node of `rect`s, the necks between them
 * as one path batch (each neck is its own trapezoid), and the names and
 * values as label nodes.
 */

import type {
	CompositeContext,
	LabelProps,
	PathBatchItem,
	RectProps,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	LEFT,
	label,
	pathBatch,
	RIGHT,
	rect,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Bounds, Point } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import { measureLabel } from "@sophistry/core/internal";
import type { BatchItem } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import { chart } from "../chart.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, ColorChannel } from "../data/channels.js";
import {
	colorResolver,
	identity,
	numberValues,
	resolveChannel,
} from "../data/channels.js";
import { itemTooltipHandlers } from "../item-tooltip.js";
import { readableOn } from "../mix.js";
import type { AnyDatum } from "../props.js";
import { staggered } from "../stagger.js";
import type { TooltipSpec } from "../tooltip.js";
import { tooltipContext, tooltipText } from "../tooltip.js";
import { besidePlace, labelStyle, tooltipProps } from "./shared.js";

const DEFAULT_STAGGER = 0.5;
const DEFAULT_PADDING = 0.25;
const DEFAULT_LABEL_FONT_SIZE = 0.24;
/** Gap around a stage's value text, in scene units. */
const LABEL_PAD = 0.1;
/** Gap between a stage name and the widest stage's left edge, in scene units. */
const LABEL_GAP = 0.2;

/**
 * Props of {@link funnel}: `value` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export interface FunnelProps<T = unknown> {
	/** One stage per datum, widest (first) at the top. */
	data: readonly T[];
	/** How many reached this stage. Defaults to the datum when `data` is `number[]`. */
	value?: Channel<T, number>;
	/** The stage's name, drawn to its left. Omitted, no names are drawn. */
	label?: Channel<T, string>;
	/** Width of the plotting area. */
	width: number;
	/** Height of the plotting area. */
	height: number;
	/** Centre of the plotting area. Defaults to the origin. */
	center?: Point;
	/** One colour for every stage, or `(d, i) => colour`. Wins over `colors`. */
	color?: ColorChannel<T>;
	/** Colours cycled across the stages. Defaults to the theme's categorical colours. */
	colors?: readonly ColorInput[];
	/**
	 * Fill opacity of the stages, 0..1.
	 * @default 0.85
	 */
	fillOpacity?: number;
	/**
	 * Gap between stages, as a fraction of a stage's slot.
	 * @default 0.25
	 */
	padding?: number;
	/**
	 * Shade the narrowing between stages.
	 * @default true
	 */
	connectors?: boolean;
	/**
	 * What to write in each stage: `"value"`, `"percent"` (of the first stage), `"both"`, or
	 * `"none"`.
	 * @default "both"
	 */
	show?: "value" | "percent" | "both" | "none";
	/** Title above the chart. */
	title?: string;
	/**
	 * Reveal, 0..1: stage names first, then each stage widens out from the centre, top to bottom.
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the data reveal spent staggering stage after stage, 0..0.95.
	 * @default 0.5
	 */
	stagger?: number;
	/** Hover tooltip: `true` for "stage: value (pct)", or `(d, i) => string`. */
	tooltip?: TooltipSpec<T>;
	zIndex?: number;
	visible?: boolean;
}

/** One stage on a frame. */
interface StageItem extends BatchItem {
	box: Bounds;
	fill: string;
	index: number;
}

/** What the stages layer keeps between updates. */
interface StagesState {
	layer: ChartLayer;
	rects: ReturnType<
		typeof createBatchedMark<
			StageItem,
			RectProps,
			SceneNode<RectProps>,
			keyof RectProps
		>
	>;
	necks: SceneNode;
}

const stageStates = new WeakMap<object, StagesState>();

function drawStages(ctx: CompositeContext<FunnelProps<AnyDatum>>): SceneNode[] {
	const state = stageStates.get(ctx.node) as StagesState;
	const props = ctx.props as Readonly<FunnelProps<unknown>>;
	const plot = state.layer.frame();
	if (!plot) throw new Error("FunnelStages must be placed inside a chart.");
	const { coords } = plot;
	const theme = ctx.theme;
	const tooltip = ctx.context(tooltipContext);

	const values = numberValues(props.data, props.value, identity, "value");
	const widest = values.reduce(
		(m, v) => (Number.isFinite(v) && v > m ? v : m),
		0,
	);
	const firstValue = values[0] as number;
	const first = Number.isFinite(firstValue) && firstValue > 0 ? firstValue : 1;

	// The value axis is symmetric about zero, so a stage centred on it can
	// spread both ways; the axis itself is not drawn.
	state.layer.report({ x: { values: [-widest / 2, widest / 2] } });

	const fillOf = colorResolver(
		props.color,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	// The funnel's `progress` already drives the chart; the stages take only
	// its data half, not the same prop a second time.
	const dataProgress = state.layer.progress(undefined) ?? 1;
	const t = (index: number) =>
		staggered(
			dataProgress,
			index,
			props.data.length,
			props.stagger ?? DEFAULT_STAGGER,
		);
	/** A stage's box in scene units at reveal `grow`, centred on x = 0. */
	const boxFor = (index: number, grow: number): Bounds | null => {
		const band = plot.yBand;
		const value = values[index];
		if (!band || value === undefined || !Number.isFinite(value)) return null;
		const start = band.start(index);
		if (start === undefined) return null;
		const half = (value * grow) / 2;
		const a = coords.coordsToPoint(-half, start);
		const b = coords.coordsToPoint(half, start + band.bandwidth);
		return {
			minX: Math.min(a.x, b.x),
			maxX: Math.max(a.x, b.x),
			minY: Math.min(a.y, b.y),
			maxY: Math.max(a.y, b.y),
		};
	};
	const percentOf = (value: number) =>
		formatTick(Math.round((value / first) * 1000) / 10);
	const text = (index: number) => {
		const value = values[index] as number;
		const percent = `${percentOf(value)}%`;
		switch (props.show ?? "both") {
			case "value":
				return formatTick(value);
			case "percent":
				return percent;
			case "none":
				return "";
			default:
				return `${formatTick(value)} · ${percent}`;
		}
	};
	const fontFamily = theme.defaults.fontFamily;
	const nameOf = resolveChannel(props.label, undefined, "label");

	const stages: StageItem[] = [];
	const necks: PathBatchItem[] = [];
	const labels: { key: string; props: LabelProps }[] = [];
	props.data.forEach((datum, index) => {
		const box = boxFor(index, t(index));
		const fill = fillOf(datum, index);
		/** The trapezoid from this stage's bottom edge to the next stage's top. */
		if (props.connectors !== false) {
			const next = boxFor(index + 1, t(index + 1));
			if (box && next)
				necks.push({
					polylines: [
						[
							{ x: box.minX, y: box.minY },
							{ x: box.maxX, y: box.minY },
							{ x: next.maxX, y: next.maxY },
							{ x: next.minX, y: next.maxY },
						],
					],
					closed: true,
					fill,
				});
		}
		if (box) {
			stages.push({ key: index, box, fill, index });
			const content = text(index);
			if (content) {
				/**
				 * Inside the stage when it fits at full width; past its right edge when it
				 * doesn't. Decided on the grown stage, so a label doesn't jump inside
				 * partway through the reveal.
				 */
				const whole = boxFor(index, 1);
				const inside =
					!!whole &&
					measureLabel(content, labelStyle(DEFAULT_LABEL_FONT_SIZE, fontFamily))
						.width +
						2 * LABEL_PAD <=
						whole.maxX - whole.minX;
				const middle = (box.minY + box.maxY) / 2;
				labels.push({
					key: `value:${index}`,
					props: inside
						? {
								text: content,
								x: (box.minX + box.maxX) / 2,
								y: middle,
								fontSize: DEFAULT_LABEL_FONT_SIZE,
								color: readableOn(
									fill,
									theme.palette.foreground,
									theme.palette.background,
								),
								opacity: t(index),
								zIndex: (props.zIndex ?? 0) + 1,
								visible: props.visible,
							}
						: {
								text: content,
								place: besidePlace(
									content,
									{ x: box.maxX, y: middle },
									RIGHT,
									LABEL_PAD,
									DEFAULT_LABEL_FONT_SIZE,
									fontFamily,
								),
								fontSize: DEFAULT_LABEL_FONT_SIZE,
								color: theme.palette.foreground,
								opacity: t(index),
								zIndex: (props.zIndex ?? 0) + 1,
							},
				});
			}
		}
		/** Where a stage's name hangs: left of the widest stage, level with the stage. */
		const name = nameOf?.(datum, index);
		const centre = plot.yBand?.center(index as BandKey);
		if (name && centre !== undefined) {
			labels.push({
				key: `name:${index}`,
				props: {
					text: name,
					place: besidePlace(
						name,
						coords.coordsToPoint(-widest / 2, centre),
						LEFT,
						LABEL_GAP,
						DEFAULT_LABEL_FONT_SIZE,
						fontFamily,
					),
					fontSize: DEFAULT_LABEL_FONT_SIZE,
					color: theme.palette.muted,
					opacity: plot.frameProgress,
					zIndex: props.zIndex,
				},
			});
		}
	});

	const handlers = itemTooltipHandlers(
		tooltip,
		(item) => {
			const stage = state.rects.itemAt(item);
			if (!stage) return undefined;
			const datum = props.data[stage.index];
			return tooltipText(
				props.tooltip,
				() => {
					const name = nameOf?.(datum, stage.index);
					const value = values[stage.index] as number;
					return `${name ?? stage.index}: ${formatTick(value)} (${percentOf(value)}%)`;
				},
				datum,
				stage.index,
				tooltip ?? undefined,
			);
		},
		(item) => {
			const box = state.rects.itemAt(item)?.box;
			return box ? { x: (box.minX + box.maxX) / 2, y: box.maxY } : undefined;
		},
		() => "Funnel",
	);
	state.rects.update(stages, {
		fillOpacity: props.fillOpacity ?? 0.85,
		stroke: "none",
		zIndex: props.zIndex,
		visible: props.visible,
		...tooltipProps(tooltip, props.tooltip, handlers),
	} as never);
	state.necks.update({
		items: necks,
		fillOpacity: 0.18,
		stroke: "none",
		zIndex: props.zIndex,
		visible: props.visible,
	} as never);
	const labelNodes = ctx.list("labels", labels, {
		key: (entry) => entry.key,
		create: (entry) => label.create(entry.props),
		update: (node, entry) => {
			node.update(entry.props);
		},
	});
	// Necks first, so each neck paints before its stage.
	return [state.necks, state.rects.node, ...labelNodes];
}

/** Every funnel prop, shared by the preset and its stages layer. */
const FUNNEL_PROPS = {
	data: { default: [], invalidates: Invalidate.UPDATE },
	value: { invalidates: Invalidate.UPDATE },
	label: { invalidates: Invalidate.UPDATE },
	width: { default: 8, invalidates: Invalidate.UPDATE },
	height: { default: 4, invalidates: Invalidate.UPDATE },
	center: { invalidates: Invalidate.UPDATE },
	color: { invalidates: Invalidate.UPDATE },
	colors: { invalidates: Invalidate.UPDATE },
	fillOpacity: { invalidates: Invalidate.UPDATE },
	padding: { invalidates: Invalidate.UPDATE },
	connectors: { invalidates: Invalidate.UPDATE },
	show: { invalidates: Invalidate.UPDATE },
	title: { invalidates: Invalidate.UPDATE },
	progress: { invalidates: Invalidate.UPDATE },
	stagger: { invalidates: Invalidate.UPDATE },
	tooltip: { invalidates: Invalidate.UPDATE },
	zIndex: { invalidates: Invalidate.UPDATE },
	visible: { invalidates: Invalidate.UPDATE },
} as const;

/** The stages, necks and labels of a funnel, inside its chart. Internal. */
const funnelStages = defineComposite<FunnelProps<AnyDatum>>({
	name: "FunnelStages",
	props: FUNNEL_PROPS,
	setup: (ctx) => {
		stageStates.set(ctx.node, {
			layer: chartLayer(ctx),
			rects: createBatchedMark<
				StageItem,
				RectProps,
				SceneNode<RectProps>,
				keyof RectProps
			>(rect as never, {
				channels: {
					center: (item) => ({
						x: (item.box.minX + item.box.maxX) / 2,
						y: (item.box.minY + item.box.maxY) / 2,
					}),
					width: (item) => item.box.maxX - item.box.minX,
					height: (item) => item.box.maxY - item.box.minY,
					fill: (item) => item.fill,
				},
			}),
			necks: pathBatch.create({ items: [] }),
		});
		return drawStages(ctx);
	},
	update: (_changed, ctx) => drawStages(ctx),
});

/** The chart props of a funnel. */
function chartProps(props: Readonly<FunnelProps<unknown>>) {
	const read = resolveChannel(props.label, undefined, "label");
	const names = read ? props.data.map((d, i) => read(d, i) ?? "") : undefined;
	return {
		width: props.width,
		height: props.height,
		center: props.center,
		// Exactly ± half the widest stage: the top stage spans the plot.
		xAxis: { visible: false, nice: false },
		yAxis: {
			scale: "band" as const,
			categories: props.data.map((_, i) => i),
			padding: props.padding ?? DEFAULT_PADDING,
			categoryLabel: (_: unknown, i: number) => names?.[i] ?? "",
			// The band axis would stand at x = 0, under the stages; names are
			// drawn just left of the widest stage instead (see the stages).
			numbers: false,
			line: false,
		},
		title: props.title,
		progress: props.progress,
		zIndex: props.zIndex,
		visible: props.visible,
	};
}

const funnelStates = new WeakMap<
	object,
	{ chart: SceneNode; stages: SceneNode }
>();

/**
 * A funnel: how many make it through each stage of a process. Stages stack
 * top-down, each centred with a width proportional to its value, shaded
 * necks showing the loss between them. A `chart` with a band y axis and no
 * value axis.
 *
 * @example
 * ```ts
 * import { createScene } from "@sophistry/core";
 * import { funnel } from "@sophistry/charts";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 10 });
 * scene.add(funnel.create({ data: [1200, 640, 310, 95], width: 6, height: 4 }));
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#waterfalls-funnels-and-candlesticks
 * @category Charts
 */
export const funnel = defineComposite<FunnelProps<AnyDatum>>({
	name: "Funnel",
	props: FUNNEL_PROPS,
	setup: (ctx) => {
		const stages = funnelStages.create({ ...ctx.props } as never);
		const node = chart.create({
			...(chartProps(ctx.props) as object),
			children: [stages],
		} as never);
		funnelStates.set(ctx.node, { chart: node, stages });
		return [node];
	},
	update: (_changed, ctx) => {
		const own = funnelStates.get(ctx.node) as {
			chart: SceneNode;
			stages: SceneNode;
		};
		own.chart.update(chartProps(ctx.props) as never);
		own.stages.update({ ...ctx.props } as never);
		return [own.chart];
	},
});
