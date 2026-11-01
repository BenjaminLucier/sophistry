/**
 * `labels`: text at data positions.
 *
 * One `label` node per datum, kept by key: the core has no batched text
 * (a text spec is one string with its own measured box), and a label beside
 * its point (`direction`) is placed by that box. Labels annotate a few
 * points, not thousands, so this is the one point mark that stays per datum.
 */

import type {
	CompositeContext,
	LabelProps,
	SceneNode,
	Vec2,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	label,
	measuresText,
} from "@sophistry/core";
import type { BandKey } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import type { Placement } from "@sophistry/core/internal";
import { anchoredLabelProps, clamp01 } from "@sophistry/core/internal";
import { positionOf } from "../band.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, ColorChannel, PositionValue } from "../data/channels.js";
import {
	colorResolver,
	dateSinkContext,
	identity,
	indexOf,
	resolveChannel,
} from "../data/channels.js";
import { endSpace } from "../end-space.js";
import type { AxisExtent } from "../frame/types.js";
import type { JoinEnd } from "../join.js";
import {
	createKeyedData,
	joinFrames,
	keyRanks,
	layerTransition,
} from "../join.js";
import { blendCss } from "../mix.js";
import type { AnyDatum, KeyedTransitionProps, RevealProps } from "../props.js";
import { staggered } from "../stagger.js";
import { keyedMemo, mix } from "../util.js";

const DEFAULT_FONT_SIZE = 0.26;
/** Clears a default marker (radius 0.09) with room to spare. */
const DEFAULT_GAP = 0.18;
/**
 * How far into the data phase labels start to fade in: they annotate the marks, so they arrive
 * as those finish rather than ahead of them.
 */
const LABEL_REVEAL_START = 0.7;

/**
 * Props of {@link labels}.
 *
 * @category Charts
 */
export interface LabelsProps<T = unknown>
	extends KeyedTransitionProps<T>,
		RevealProps {
	/** One label per datum. */
	data: readonly T[];
	/** X position: a number in data units (a `Date` reads as epoch ms) or a category on a band axis. Defaults to the index when `data` is `number[]`. */
	x?: Channel<T, BandKey | PositionValue>;
	/** Y position: a number in data units or a category on a band axis. Defaults to the datum when `data` is `number[]`. */
	y?: Channel<T, BandKey | PositionValue>;
	/** The text. Defaults to the datum, as a number, when `data` is `number[]`. */
	text?: Channel<T, string>;
	/** Which side of the point the text sits on (`UP`, `RIGHT`, `UR`, ...), `gap` away. Omitted, the text is centred on the point. */
	direction?: Vec2;
	/**
	 * Gap between the point and the text when `direction` is set.
	 * @default 0.18
	 */
	gap?: number;
	/**
	 * Font size.
	 * @default 0.26
	 */
	fontSize?: number;
	/** Text colour, constant or `(d, i) => colour`. Defaults to the theme foreground. */
	color?: ColorChannel<T>;
	opacity?: number;
	/**
	 * Reveal, 0..1: each label fades in, over the end of the data phase.
	 * @default 1
	 */
	progress?: number;
	zIndex?: number;
	visible?: boolean;
}

/** One label's channels, as given. */
interface LabelRow {
	x: BandKey;
	y: BandKey;
	text: string;
}

/** A label on one frame: its place in data units, its text and colour. */
interface LabelState {
	x: number;
	y: number;
	text: string;
	color: string;
}

function blendLabel(a: LabelState, b: LabelState, u: number): LabelState {
	return {
		x: mix(a.x, b.x, u),
		y: mix(a.y, b.y, u),
		text: u < 0.5 ? a.text : b.text,
		color: a.color === b.color ? a.color : blendCss(a.color, b.color, u),
	};
}

interface LabelsState {
	layer: ChartLayer;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	rows: {
		from: ReturnType<typeof keyedMemo<LabelRow[]>>;
		to: ReturnType<typeof keyedMemo<LabelRow[]>>;
	};
	nodes: Map<BandKey, SceneNode<LabelProps>>;
}

const states = new WeakMap<object, LabelsState>();

function draw(ctx: CompositeContext<LabelsProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as LabelsState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords) throw new Error("Labels must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;
	if (props.direction) measuresText(ctx);

	const rowsOf = (data: readonly unknown[], end: JoinEnd) =>
		state.rows[end]([data, props.x, props.y, props.text, dates], () => {
			const x = resolveChannel<unknown, BandKey | PositionValue>(
				props.x as Channel<unknown, BandKey | PositionValue>,
				indexOf,
				"x",
				dates,
			);
			const y = resolveChannel<unknown, BandKey | PositionValue>(
				props.y as Channel<unknown, BandKey | PositionValue>,
				identity,
				"y",
				dates,
			);
			const text = resolveChannel<unknown, string>(
				props.text as Channel<unknown, string>,
				(d) => (typeof d === "number" ? formatTick(d) : String(d)),
				"text",
			);
			return data.map((d, i) => ({
				x: x(d, i) as BandKey,
				y: y(d, i) as BandKey,
				text: text(d, i),
			}));
		});
	const fromRows = rowsOf(props.data, "from");
	const toRows = props.to ? rowsOf(props.to, "to") : undefined;
	const keyed = state.keyed({
		data: props.data,
		to: props.to,
		key: props.key,
		series: undefined,
		of: undefined,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		dates,
	});
	/** One end's extents: categories when any position is one, else numbers. */
	const extentsOf = (rows: readonly LabelRow[]) => {
		const extent = (keys: BandKey[]): AxisExtent => {
			const categories = keys.filter((k) => typeof k === "string");
			return categories.length > 0
				? { categories }
				: { values: keys.filter((k): k is number => typeof k === "number") };
		};
		return {
			x: extent(rows.map((r) => r.x)),
			y: extent(rows.map((r) => r.y)),
		};
	};
	layer.report({
		...extentsOf(fromRows),
		transition: layerTransition(
			keyed,
			props.staging,
			toRows ? extentsOf(toRows) : {},
		),
	});

	const colorOf = colorResolver(
		props.color as ColorChannel<unknown>,
		[theme.palette.foreground],
		theme.palette.foreground,
	);
	const space = endSpace(frame, coords);
	const frames = joinFrames<LabelState>(
		keyed,
		(end, index) => {
			const row = (end === "from" ? fromRows : toRows)?.[index];
			const data = end === "from" ? props.data : props.to;
			const x = positionOf(space.band(end, "x"), row?.x);
			const y = positionOf(space.band(end, "y"), row?.y);
			if (!row || !data || x === undefined || y === undefined) return undefined;
			return { x, y, text: row.text, color: colorOf(data[index], index) };
		},
		blendLabel,
		space.swapping,
	);
	const rank = keyRanks(keyed.keys);
	const count = keyed.active ? keyed.keys.length : props.data.length;
	const reveal = clamp01(
		((layer.progress(props.progress) ?? 1) - LABEL_REVEAL_START) /
			(1 - LABEL_REVEAL_START),
	);
	const fontSize = props.fontSize ?? DEFAULT_FONT_SIZE;
	const out: SceneNode[] = [];
	const seen = new Set<BandKey>();
	for (const key of keyed.keys) {
		const own = frames.get(key);
		if (!own || !(own.presence > 0)) continue;
		seen.add(key);
		// Mid-swap, each end's place through its own plot.
		const at = space.place(own, (s) => s);
		const opacity =
			(props.opacity ?? 1) *
			staggered(reveal, rank.get(key) ?? 0, count, props.stagger ?? 0) *
			own.presence;
		let node = state.nodes.get(key);
		if (!node) {
			node = label.create({ text: own.state.text });
			state.nodes.set(key, node);
		}
		if (props.direction) {
			node.update({
				...anchoredLabelProps(
					{
						text: own.state.text,
						at,
						direction: props.direction,
						gap: props.gap ?? DEFAULT_GAP,
						fontSize,
						color: own.state.color,
						opacity,
						zIndex: props.zIndex,
					},
					theme.defaults.fontFamily,
					node.get("place") as Placement | undefined,
				),
				x: 0,
				y: 0,
				visible: props.visible,
			} as never);
		} else {
			node.update({
				text: own.state.text,
				x: at.x,
				y: at.y,
				place: undefined,
				fontSize,
				color: own.state.color,
				opacity,
				zIndex: props.zIndex,
				visible: props.visible,
			} as never);
		}
		out.push(node);
	}
	for (const key of [...state.nodes.keys()])
		if (!seen.has(key)) state.nodes.delete(key);
	return out;
}

/**
 * Text at data positions: names on a scatter, values over a line, annotations at a peak. Each
 * label is placed by its measured box, so `direction: UP` clears the point by the same gap
 * for any text. One `label` node per datum (see the file header).
 *
 * @example
 * ```ts
 * import { UP } from "@sophistry/core";
 * import { chart, labels } from "@sophistry/charts";
 *
 * const cities = [
 * 	{ name: "Lima", gdp: 15, life: 76 },
 * 	{ name: "Oslo", gdp: 80, life: 83 },
 * ];
 * chart.create({ width: 8, height: 4, children: [labels.create({ data: cities, x: "gdp", y: "life", text: "name", direction: UP })] });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#marks
 * @category Charts
 */
export const labels = defineComposite<LabelsProps<AnyDatum>>({
	name: "Labels",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		text: { invalidates: Invalidate.UPDATE },
		direction: { invalidates: Invalidate.UPDATE },
		gap: { invalidates: Invalidate.UPDATE },
		fontSize: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			layer: chartLayer(ctx),
			keyed: createKeyedData<AnyDatum>(),
			rows: { from: keyedMemo(), to: keyedMemo() },
			nodes: new Map(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
