/**
 * `ruleX` / `ruleY`: reference lines across the plot, or segments between
 * given ends, one per datum, drawn as one instances node of `line`s.
 *
 * Batched like every per-datum mark (see `points/scatter.ts`): each update
 * builds one item per key (its two ends in scene units and its colour) and
 * hands them to {@link createBatchedMark}. The reveal (and an entering or
 * leaving rule's presence) is each item's `progress` channel: the line
 * traces from its low end.
 */

import type {
	CompositeContext,
	CoordinateSystem,
	LineProps,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate, line } from "@sophistry/core";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { positionOf } from "../band";
import type { BatchItem, MarkTransition } from "../batch";
import { createBatchedMark } from "../batch";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { Channel, ColorChannel, PositionValue } from "../data/channels";
import {
	colorResolver,
	dateSinkContext,
	identity,
	resolveChannel,
} from "../data/channels";
import { endSpace } from "../end-space";
import type { AxisExtent } from "../frame/types";
import { itemTooltipHandlers } from "../item-tooltip";
import type { JoinEnd } from "../join";
import {
	createKeyedData,
	joinFrames,
	keyRanks,
	layerTransition,
} from "../join";
import { blendCss, mixPoints } from "../mix";
import type { AnyDatum, KeyedTransitionProps, RevealProps } from "../props";
import { staggered } from "../stagger";
import type { TooltipSpec } from "../tooltip";
import { tooltipContext, tooltipText } from "../tooltip";
import { mix } from "../util";
import { tooltipProps } from "./shared";

/**
 * Props every rule takes.
 *
 * @category Charts
 */
export interface RuleBaseProps<T> extends KeyedTransitionProps<T>, RevealProps {
	/** One rule per datum. `ruleY.create({ data: [0] })` is a zero line. */
	data: readonly T[];
	/** Rule colour, constant or `(d, i) => colour`. Defaults to the theme foreground. */
	color?: ColorChannel<T>;
	/** Line width. */
	strokeWidth?: number;
	/** Dash pattern, as on any line: `[0.1, 0.08]`. */
	dash?: number[];
	opacity?: number;
	/**
	 * Reveal, 0..1: each rule draws from its low end to its high end.
	 * @default 1
	 */
	progress?: number;
	/**
	 * Hover tooltip: `true` for the rule's value, or a template, function or options. See {@link
	 * TooltipSpec}.
	 */
	tooltip?: TooltipSpec<T>;
	/**
	 * How rules move when `data` changes (outside a `to` blend): a tween or a
	 * spring in the node's tween bank; new rules draw out of their low end,
	 * removed ones draw back into it. Omitted, data changes are instant.
	 */
	transition?: MarkTransition;
	zIndex?: number;
	visible?: boolean;
	/**
	 * The data to transition to, matched to `data` by `key`: rules slide and stretch to their new
	 * place; new ones draw out, removed ones draw back in. See {@link KeyedTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
}

/**
 * Props of {@link ruleX}: `x` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export interface RuleXProps<T = unknown> extends RuleBaseProps<T> {
	/**
	 * Where the vertical rule stands: a number in data units (a `Date` reads as epoch ms) or a
	 * category on a band axis. Defaults to the datum when `data` is `number[]`.
	 */
	x?: Channel<T, BandKey | PositionValue>;
	/** Lower end, in data units. Defaults to the bottom of the plotting area. */
	y1?: Channel<T, PositionValue>;
	/** Upper end, in data units. Defaults to the top of the plotting area. */
	y2?: Channel<T, PositionValue>;
}

/**
 * Props of {@link ruleY}: `y` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export interface RuleYProps<T = unknown> extends RuleBaseProps<T> {
	/**
	 * Height of the horizontal rule: a number in data units (a `Date` reads as epoch ms) or a
	 * category on a band axis. Defaults to the datum when `data` is `number[]`.
	 */
	y?: Channel<T, BandKey | PositionValue>;
	/** Left end, in data units. Defaults to the left of the plotting area. */
	x1?: Channel<T, PositionValue>;
	/** Right end, in data units. Defaults to the right of the plotting area. */
	x2?: Channel<T, PositionValue>;
}

/** A rule in neutral terms: `at` is the channel across, `from`/`to` along. */
interface RuleSpec {
	vertical: boolean;
	at: Channel<unknown, BandKey | PositionValue> | undefined;
	from: Channel<unknown, PositionValue> | undefined;
	to: Channel<unknown, PositionValue> | undefined;
	name: string;
}

/** One rule's channels, as given. */
interface RuleRow {
	at: BandKey | undefined;
	from?: number;
	to?: number;
}

/** A rule on one frame, in data units: where it stands across, its ends along (undefined: the plot's edge), its colour. */
interface RuleState {
	at: number;
	from?: number;
	to?: number;
	color: string;
}

/** What one rule draws on a frame. */
interface RuleItem extends BatchItem {
	from: Point;
	to: Point;
	stroke: string;
	/** How far the line has traced from its low end, 0..1. */
	progress: number;
	/** The datum its tooltip reads, its index, and the value across. */
	datum: unknown;
	index: number;
	across: BandKey | undefined;
}

type RuleLines = ReturnType<
	typeof createBatchedMark<
		RuleItem,
		LineProps,
		SceneNode<LineProps>,
		keyof LineProps
	>
>;

/** What a rule layer keeps between updates. */
interface RuleState2 {
	layer: ChartLayer;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	lines: RuleLines;
	rows: {
		data: readonly unknown[] | undefined;
		spec: unknown[];
		value: RuleRow[];
	}[];
}

const states = new WeakMap<object, RuleState2>();

/** A rule's two ends in scene units, low end first so it draws upward / rightward. */
function endsOf(
	coords: CoordinateSystem,
	vertical: boolean,
	rule: { at: number; from?: number; to?: number },
): [Point, Point] | null {
	const { at } = rule;
	const area = coords.area();
	if (vertical) {
		const x = coords.coordsToPoint(at, 0).x;
		const a =
			rule.from === undefined
				? area.minY
				: coords.coordsToPoint(at, rule.from).y;
		const b =
			rule.to === undefined ? area.maxY : coords.coordsToPoint(at, rule.to).y;
		if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
		return [
			{ x, y: Math.min(a, b) },
			{ x, y: Math.max(a, b) },
		];
	}
	const y = coords.coordsToPoint(0, at).y;
	const a =
		rule.from === undefined ? area.minX : coords.coordsToPoint(rule.from, at).x;
	const b =
		rule.to === undefined ? area.maxX : coords.coordsToPoint(rule.to, at).x;
	if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
	return [
		{ x: Math.min(a, b), y },
		{ x: Math.max(a, b), y },
	];
}

function draw(
	ctx: CompositeContext<RuleXProps<AnyDatum> & RuleYProps<AnyDatum>>,
	spec: RuleSpec,
): SceneNode[] {
	const state = states.get(ctx.node) as RuleState2;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error(`${spec.name} must be placed inside a chart or axes.`);
	const dates = ctx.context(dateSinkContext);
	const tooltip = ctx.context(tooltipContext);
	const theme = ctx.theme;

	/** One dataset's rules, channels as given, cached by data and channels. */
	const rowsOf = (slot: 0 | 1, data: readonly unknown[]): RuleRow[] => {
		const cache = state.rows[slot] as RuleState2["rows"][number];
		const deps = [spec.at, spec.from, spec.to, dates];
		if (
			cache.data === data &&
			cache.spec.length === deps.length &&
			cache.spec.every((d, i) => d === deps[i])
		)
			return cache.value;
		const at = resolveChannel<unknown, BandKey | PositionValue>(
			spec.at,
			identity,
			spec.vertical ? "x" : "y",
			dates,
		);
		const from = resolveChannel(
			spec.from,
			undefined,
			spec.vertical ? "y1" : "x1",
			dates,
		);
		const to = resolveChannel(
			spec.to,
			undefined,
			spec.vertical ? "y2" : "x2",
			dates,
		);
		const value = data.map((d, i) => ({
			at: at(d, i) as BandKey | undefined,
			from: from?.(d, i) as number | undefined,
			to: to?.(d, i) as number | undefined,
		}));
		state.rows[slot] = { data, spec: deps, value };
		return value;
	};
	const fromRows = rowsOf(0, props.data);
	const toRows = props.to === undefined ? undefined : rowsOf(1, props.to);

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

	/** One end's extents: across, its positions (categories when any is one); along, the ends given. */
	const extentsOf = (rows: readonly RuleRow[]) => {
		const across = rows.map((r) => r.at);
		const categories = across.filter((v): v is string => typeof v === "string");
		const numbers = across.filter((v): v is number => typeof v === "number");
		const along = rows.flatMap((r) =>
			[r.from, r.to].filter((v): v is number => typeof v === "number"),
		);
		const acrossExtent: AxisExtent =
			categories.length > 0 ? { categories } : { values: numbers };
		const alongExtent: AxisExtent = { values: along };
		return spec.vertical
			? { x: acrossExtent, y: alongExtent }
			: { x: alongExtent, y: acrossExtent };
	};
	layer.report({
		...extentsOf(fromRows),
		transition: toRows
			? layerTransition(keyed, props.staging, extentsOf(toRows))
			: undefined,
	});

	const colorOf = colorResolver(
		props.color,
		[theme.palette.foreground],
		theme.palette.foreground,
	);
	/** An edge of the plotting area along the rules, in data units. */
	const edge = (low: boolean): number => {
		const area = coords.area();
		const corner = coords.pointToCoords(
			low ? { x: area.minX, y: area.minY } : { x: area.maxX, y: area.maxY },
		);
		return spec.vertical ? corner.y : corner.x;
	};
	/** Two rules blended at `u`, in data units; an end at the plot's edge on one side blends from or to that edge. */
	const blendRule = (a: RuleState, b: RuleState, u: number): RuleState => {
		const end = (p: number | undefined, q: number | undefined, low: boolean) =>
			p === undefined && q === undefined
				? undefined
				: mix(p ?? edge(low), q ?? edge(low), u);
		return {
			at: mix(a.at, b.at, u),
			from: end(a.from, b.from, true),
			to: end(a.to, b.to, false),
			color: blendCss(a.color, b.color, u),
		};
	};
	const space = endSpace(frame, coords);
	const frames = joinFrames<RuleState>(
		keyed,
		(end: JoinEnd, index) => {
			const row = (end === "from" ? fromRows : toRows)?.[index];
			const data = end === "from" ? props.data : props.to;
			const band = space.band(end, spec.vertical ? "x" : "y");
			const at = positionOf(band, row?.at);
			if (!row || !data || at === undefined) return undefined;
			return {
				at,
				from: row.from,
				to: row.to,
				color: colorOf(data[index], index),
			};
		},
		blendRule,
		space.swapping,
	);
	const rank = keyRanks(keyed.keys);
	/** How many rules share the stagger: every datum (as without a transition), else every key. */
	const count = keyed.active ? keyed.keys.length : props.data.length;
	const progress = layer.progress(props.progress) ?? 1;

	const items: RuleItem[] = [];
	for (const [key, own] of frames) {
		// Mid-swap, each end's rule through its own plot, blended.
		const ends = space.shape(
			own,
			(rule, _end, system) => endsOf(system, spec.vertical, rule),
			mixPoints,
		);
		if (!ends) continue;
		/** The reveal and the join's presence together: an exit draws back into the low end. */
		const t =
			staggered(progress, rank.get(key) ?? 0, count, props.stagger ?? 0) *
			own.presence;
		if (!(t > 0)) continue;
		const [low, high] = ends;
		const row = (own.end === "to" ? toRows : fromRows)?.[own.index];
		const data = own.end === "to" ? props.to : props.data;
		items.push({
			key,
			from: low,
			to: high,
			progress: Math.min(1, t),
			stroke: own.state.color,
			datum: data?.[own.index],
			index: own.index,
			across: row?.at,
		});
	}

	const across = spec.vertical ? "x" : "y";
	const handlers = itemTooltipHandlers(
		tooltip,
		(item) => {
			const rule = state.lines.itemAt(item);
			if (!rule) return undefined;
			return tooltipText(
				props.tooltip,
				() => [
					{
						channel: across,
						of: spec.at,
						value: rule.across,
						format: frame?.format(across),
					},
				],
				rule.datum,
				rule.index,
				tooltip ?? undefined,
			);
		},
		(item) => state.lines.itemAt(item)?.to,
		() => spec.name,
	);
	state.lines.update(
		items,
		{
			strokeWidth: props.strokeWidth,
			dash: props.dash,
			opacity: props.opacity,
			zIndex: props.zIndex,
			visible: props.visible,
			...tooltipProps(tooltip, props.tooltip, handlers),
		} as never,
		{
			transition: props.transition,
			animate: !keyed.active && progress >= 1,
		},
	);
	return [state.lines.node];
}

const ruleProps = {
	data: { default: [], invalidates: Invalidate.UPDATE },
	color: { invalidates: Invalidate.UPDATE },
	strokeWidth: { invalidates: Invalidate.UPDATE },
	dash: { invalidates: Invalidate.UPDATE },
	opacity: { invalidates: Invalidate.UPDATE },
	progress: { default: 1, invalidates: Invalidate.UPDATE },
	tooltip: { invalidates: Invalidate.UPDATE },
	transition: { invalidates: Invalidate.UPDATE },
	zIndex: { invalidates: Invalidate.UPDATE },
	visible: { invalidates: Invalidate.UPDATE },
	key: { invalidates: Invalidate.UPDATE },
	to: { invalidates: Invalidate.UPDATE },
	blend: { invalidates: Invalidate.UPDATE },
	staging: { invalidates: Invalidate.UPDATE },
	enterStagger: { invalidates: Invalidate.UPDATE },
	stagger: { invalidates: Invalidate.UPDATE },
} as const;

function setupRules(
	ctx: CompositeContext<RuleXProps<AnyDatum> & RuleYProps<AnyDatum>>,
	spec: () => RuleSpec,
): SceneNode[] {
	const layer = chartLayer(ctx);
	states.set(ctx.node, {
		layer,
		keyed: createKeyedData<AnyDatum>(),
		lines: createBatchedMark<
			RuleItem,
			LineProps,
			SceneNode<LineProps>,
			keyof LineProps
		>(line as never, {
			channels: {
				from: (item) => item.from,
				to: (item) => item.to,
				stroke: (item) => item.stroke,
				progress: (item) => item.progress,
			},
			// A rule draws out of its low end and back into it.
			enter: { progress: 0 },
			exit: { progress: 0 },
		}),
		rows: [
			{ data: undefined, spec: [], value: [] },
			{ data: undefined, spec: [], value: [] },
		],
	});
	return draw(ctx, spec());
}

/**
 * Vertical reference lines across the plot; `y1`/`y2` shorten them to
 * segments (a lollipop's stick, a candle's wick). Inside a `chart` or
 * `axes`. Drawn as one instances node of lines: `event.key` is the datum's
 * key.
 *
 * @example
 * ```ts
 * import { chart, ruleX } from "@sophistry/charts";
 *
 * chart.create({ width: 8, height: 4, children: [ruleX.create({ data: [2, 5], dash: [0.1, 0.08] })] });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#marks
 * @category Charts
 */
export const ruleX = defineComposite<RuleXProps<AnyDatum>>({
	name: "RuleX",
	props: {
		...ruleProps,
		x: { invalidates: Invalidate.UPDATE },
		y1: { invalidates: Invalidate.UPDATE },
		y2: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) =>
		setupRules(ctx as never, () => ({
			vertical: true,
			at: ctx.props.x as RuleSpec["at"],
			from: ctx.props.y1 as RuleSpec["from"],
			to: ctx.props.y2 as RuleSpec["to"],
			name: "RuleX",
		})),
	update: (_changed, ctx) =>
		draw(ctx as never, {
			vertical: true,
			at: ctx.props.x as RuleSpec["at"],
			from: ctx.props.y1 as RuleSpec["from"],
			to: ctx.props.y2 as RuleSpec["to"],
			name: "RuleX",
		}),
});

/**
 * Horizontal reference lines across the plot; `ruleY.create({ data: [0] })`
 * is a zero line and `x1`/`x2` shorten them to segments. Inside a `chart`
 * or `axes`. Drawn as one instances node of lines.
 *
 * @example
 * ```ts
 * import { chart, linePlot, ruleY } from "@sophistry/charts";
 *
 * const data = [-2, 1, 3, -1, 4];
 * chart.create({ width: 8, height: 4, children: [linePlot.create({ data }), ruleY.create({ data: [0] })] });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#marks
 * @category Charts
 */
export const ruleY = defineComposite<RuleYProps<AnyDatum>>({
	name: "RuleY",
	props: {
		...ruleProps,
		y: { invalidates: Invalidate.UPDATE },
		x1: { invalidates: Invalidate.UPDATE },
		x2: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) =>
		setupRules(ctx as never, () => ({
			vertical: false,
			at: ctx.props.y as RuleSpec["at"],
			from: ctx.props.x1 as RuleSpec["from"],
			to: ctx.props.x2 as RuleSpec["to"],
			name: "RuleY",
		})),
	update: (_changed, ctx) =>
		draw(ctx as never, {
			vertical: false,
			at: ctx.props.y as RuleSpec["at"],
			from: ctx.props.x1 as RuleSpec["from"],
			to: ctx.props.x2 as RuleSpec["to"],
			name: "RuleY",
		}),
});
