/**
 * `chord`: flows between groups round a circle.
 *
 * Two path batches: the ribbons (each its own fill and fade, paint order
 * under the ring) and the group arcs (each its own fill). Hover, taps,
 * tooltips and accessible names resolve per ribbon and per arc through
 * `event.item` / `itemLabel`. Group names are anchored `label` nodes.
 */

import type {
	ColorInput,
	CompositeContext,
	PathBatchItem,
	PathBatchItemsProps,
	PathBatchNode,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate, pathBatch } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import {
	anchoredLabelPlace,
	clamp01,
	cssColor,
	polarPoint,
} from "@sophistry/core/internal";
import type {
	Channel,
	ColorChannel,
	RequiredUnless,
} from "../data/channels.js";
import {
	identity,
	numberValues,
	resolveChannel,
	resolveColor,
} from "../data/channels.js";
import { itemTooltipHandlers } from "../item-tooltip.js";
import type { ChordGroup, ChordLayout, ChordLink } from "../math/chord.js";
import { chordLayout, chordRibbon } from "../math/chord.js";
import type { SankeyId } from "../math/sankey.js";
import type { AnyDatum } from "../props.js";
import { ranks, staggered } from "../stagger.js";
import type { TooltipSpec } from "../tooltip.js";
import { tooltipText } from "../tooltip.js";
import type { KeyedLabel } from "./shared.js";
import {
	createItemCache,
	createOwnTooltip,
	labelList,
	wedgeItem,
} from "./shared.js";

const DEFAULT_RADIUS = 2;
const DEFAULT_THICKNESS = 0.08;
const DEFAULT_RIBBON_OPACITY = 0.55;
const DEFAULT_LABEL_FONT_SIZE = 0.22;
const DEFAULT_STAGGER = 0.5;
/** Arrowhead length, as a fraction of the radius. */
const DEFAULT_ARROW_SIZE = 0.08;
/** Gap between the ring and the ribbons' ends, as a fraction of the radius. */
const RIBBON_GAP = 0.01;
const LABEL_GAP = 0.12;
/** Share of `progress` spent sweeping the ring before any ribbon shows. */
const RING_SHARE = 0.5;

/** @category Charts */
export interface ChordBaseProps<L, N> {
	/** The flows, one per datum; flows between the same two groups (same direction) add up. */
	data: readonly L[];
	/** The group a flow leaves. */
	source: Channel<L, SankeyId>;
	/** The group a flow enters. */
	target: Channel<L, SankeyId>;
	/** The flow's size; non-finite and negative values count as 0. */
	value: Channel<L, number>;
	/**
	 * The groups, in the order they go round the circle and are coloured. Every id a flow names
	 * must be here (else throws). Defaults to the flows' endpoints in first-seen order.
	 */
	nodes?: readonly N[];
	/**
	 * A group's id, matched against `source`/`target`. Defaults to the datum itself, when `nodes`
	 * is `(string | number)[]`.
	 */
	nodeId?: Channel<N, SankeyId>;
	/** The text beside a group's arc. Defaults to its id. */
	nodeLabel?: Channel<N, string>;
	/** Centre of the diagram. Defaults to the origin. */
	center?: Point;
	/**
	 * Outer radius of the ring; labels sit outside it.
	 * @default 2
	 */
	radius?: number;
	/** Thickness of the ring. Defaults to 0.08 × `radius`. */
	thickness?: number;
	/**
	 * Gap between neighbouring groups, in radians.
	 * @default 0.04
	 */
	padAngle?: number;
	/**
	 * Angle the first group begins at, in radians from +x. The default is 12 o'clock.
	 * @default Math.PI / 2
	 */
	startAngle?: number;
	/**
	 * Go round clockwise.
	 * @default true
	 */
	clockwise?: boolean;
	/**
	 * One chord per flow direction, and arcs sized by inflow plus outflow, so a group that only
	 * receives still shows. Otherwise one chord per pair of groups, arcs sized by outflow.
	 * @default false
	 */
	directed?: boolean;
	/**
	 * With `directed`: draw each chord's receiving end as an arrowhead.
	 * @default false
	 */
	arrows?: boolean;
	/** Length of an arrowhead. Defaults to 0.08 × `radius`. */
	arrowSize?: number;
	/** Group colours, cycled by group order. Defaults to the theme's categorical colours. */
	colors?: readonly ColorInput[];
	/**
	 * A chord's colour: its `"source"` group's (the larger end, or the sender when `directed`), its
	 * `"target"` group's, or a colour channel given the chord's first flow.
	 * @default "source"
	 */
	ribbonColor?: "source" | "target" | ColorChannel<L>;
	/**
	 * Fill opacity of the chords, 0..1.
	 * @default 0.55
	 */
	ribbonOpacity?: number;
	/**
	 * Draw group labels.
	 * @default true
	 */
	labels?: boolean;
	/**
	 * Font size of group labels.
	 * @default 0.22
	 */
	labelFontSize?: number;
	/**
	 * Reveal, 0..1: the ring sweeps round from `startAngle` with its labels, then the chords fade
	 * in.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the chords' reveal spent staggering them, 0..0.95.
	 * @default 0.5
	 */
	stagger?: number;
	/**
	 * Hover tooltip: `true` shows "A → B: value" on a chord and "name: value" on a group; a
	 * function replaces the chord text, given its first flow.
	 */
	tooltip?: TooltipSpec<L>;
	/** Paint order of the chords; the ring paints above them. */
	zIndex?: number;
	visible?: boolean;
}

/**
 * Props of {@link chord}: `nodeId` is required when `nodes` holds records.
 *
 * @category Charts
 */
export type ChordProps<L, N = SankeyId> = ChordBaseProps<L, N> &
	RequiredUnless<N, SankeyId, "nodeId">;

/** Group ids (in order) and their labels. */
interface GroupList {
	ids: SankeyId[];
	labels: Map<SankeyId, string>;
	given: boolean;
}

function groupListOf(
	nodes: readonly unknown[] | undefined,
	nodeId: unknown,
	nodeLabel: unknown,
): GroupList {
	const ids: SankeyId[] = [];
	const labels = new Map<SankeyId, string>();
	if (nodes) {
		const id = resolveChannel<unknown, SankeyId>(
			nodeId as Channel<unknown, SankeyId> | undefined,
			identity,
			"nodeId",
		);
		const label = resolveChannel(
			nodeLabel as Channel<unknown, string> | undefined,
			undefined,
			"nodeLabel",
		);
		nodes.forEach((d, i) => {
			ids.push(id(d, i));
			if (label) labels.set(ids[i] as SankeyId, label(d, i));
		});
	}
	return { ids, labels, given: nodes !== undefined };
}

/** The flow matrix, plus the first datum behind each cell (for tooltips and colour channels). */
interface Flows {
	order: SankeyId[];
	matrix: number[][];
	first: (number | undefined)[][];
}

function flowsOf(
	data: readonly unknown[],
	sourceChannel: unknown,
	targetChannel: unknown,
	valueChannel: unknown,
	groups: GroupList,
): Flows {
	const source = resolveChannel(
		sourceChannel as Channel<unknown, SankeyId>,
		undefined,
		"source",
	);
	const target = resolveChannel(
		targetChannel as Channel<unknown, SankeyId>,
		undefined,
		"target",
	);
	const values = numberValues(
		data,
		valueChannel as Channel<unknown, number>,
		undefined,
		"value",
	);
	const order = [...groups.ids];
	const position = new Map<SankeyId, number>(order.map((id, i) => [id, i]));
	const indexOf = (id: SankeyId) => {
		let i = position.get(id);
		if (i === undefined) {
			if (groups.given) {
				throw new Error(
					`chord: flow names group "${String(id)}", which is not in \`nodes\`.`,
				);
			}
			i = order.length;
			order.push(id);
			position.set(id, i);
		}
		return i;
	};
	const ends = data.map((d, i) => [
		indexOf(source(d, i) as SankeyId),
		indexOf(target(d, i) as SankeyId),
	]);
	const n = order.length;
	const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
	const first = Array.from({ length: n }, () =>
		new Array<number | undefined>(n).fill(undefined),
	);
	ends.forEach(([s, t], i) => {
		const v = values[i] as number;
		const row = matrix[s as number] as number[];
		if (Number.isFinite(v) && v > 0)
			row[t as number] = (row[t as number] as number) + v;
		const firstRow = first[s as number] as (number | undefined)[];
		firstRow[t as number] ??= i;
	});
	return { order, matrix, first };
}

/** What a chord diagram keeps between updates. */
interface ChordState {
	tooltip: ReturnType<typeof createOwnTooltip>;
	ribbons: PathBatchNode<PathBatchItemsProps>;
	arcs: PathBatchNode<PathBatchItemsProps>;
	ribbonItems: ReturnType<typeof createItemCache<PathBatchItem>>;
	arcItems: ReturnType<typeof createItemCache<PathBatchItem | undefined>>;
	groups: typeof groupListOf;
	flows: typeof flowsOf;
	layout: (
		matrix: number[][],
		padAngle: number | undefined,
		startAngle: number | undefined,
		clockwise: boolean | undefined,
		directed: boolean | undefined,
	) => ChordLayout;
	chordRank: (
		layout: ChordLayout,
		start: number,
		direction: number,
	) => number[];
	/** The chord and group behind each drawn item, by item index. */
	drawnChords: ChordLink[];
	drawnGroups: ChordGroup[];
}

const states = new WeakMap<object, ChordState>();

function draw(
	ctx: CompositeContext<ChordProps<AnyDatum, AnyDatum>>,
): SceneNode[] {
	const state = states.get(ctx.node) as ChordState;
	const props = ctx.props;
	const theme = ctx.theme;
	const tooltip = state.tooltip(ctx);

	const groups = state.groups(props.nodes, props.nodeId, props.nodeLabel);
	const flows = state.flows(
		props.data,
		props.source,
		props.target,
		props.value,
		groups,
	);
	const layout = state.layout(
		flows.matrix,
		props.padAngle,
		props.startAngle,
		props.clockwise,
		props.directed,
	);

	const cx = props.center?.x ?? 0;
	const cy = props.center?.y ?? 0;
	const center = { x: cx, y: cy };
	const radius = props.radius ?? DEFAULT_RADIUS;
	const thickness = props.thickness ?? DEFAULT_THICKNESS * radius;
	const inner = Math.max(0, radius - thickness);
	/** The arrowheads' length, or 0 for plain ribbons. */
	const headRadius =
		props.arrows && props.directed
			? Math.max(0, props.arrowSize ?? DEFAULT_ARROW_SIZE * radius)
			: 0;
	const visible = props.visible !== false;
	const zIndex = props.zIndex ?? 0;

	const nameOf = (index: number) => {
		const id = flows.order[index];
		return id === undefined ? "" : (groups.labels.get(id) ?? String(id));
	};
	const palette = props.colors ?? theme.palette.series;
	const groupColor = (index: number): string =>
		cssColor(
			palette.length === 0
				? theme.palette.foreground
				: (palette[index % palette.length] as ColorInput),
		);
	/** The first datum behind a chord: its source direction's, else its target's. */
	const datumOf = (link: ChordLink): number | undefined => {
		const { source: s, target: t } = link;
		return (
			flows.first[s.index]?.[s.subindex] ?? flows.first[t.index]?.[t.subindex]
		);
	};
	const ribbonColorOf = resolveColor(
		typeof props.ribbonColor === "function" ||
			(props.ribbonColor !== undefined &&
				props.ribbonColor !== "source" &&
				props.ribbonColor !== "target")
			? (props.ribbonColor as ColorChannel<unknown>)
			: undefined,
	);
	const ribbonColor = (link: ChordLink): string => {
		const spec = props.ribbonColor;
		if (spec === undefined || spec === "source")
			return groupColor(link.source.index);
		if (spec === "target") return groupColor(link.target.index);
		const i = datumOf(link);
		return (
			(i === undefined ? undefined : ribbonColorOf?.(props.data[i], i)) ??
			groupColor(link.source.index)
		);
	};
	const chordText = (link: ChordLink): string => {
		const { source: s, target: t } = link;
		const a = `${nameOf(s.index)} → ${nameOf(s.subindex)}: ${formatTick(s.value)}`;
		if (props.directed || s.index === t.index || !(t.value > 0)) return a;
		return `${a} · ${nameOf(t.index)} → ${nameOf(t.subindex)}: ${formatTick(t.value)}`;
	};

	const progress = clamp01(props.progress ?? 1);
	const ringSweep = clamp01(progress / RING_SHARE);
	const ribbonPhase = clamp01((progress - RING_SHARE) / (1 - RING_SHARE));
	const start = props.startAngle ?? Math.PI / 2;
	const direction = props.clockwise === false ? 1 : -1;
	/** Turn fraction (0..1) of an angle from the start, in the sweep's direction. */
	const turnOf = (angle: number) =>
		((angle - start) * direction) / (Math.PI * 2);
	/** Chords ranked by where the sweep met their nearer end. */
	const chordRank = state.chordRank(layout, start, direction);

	// The ribbons, each fading in on its own turn.
	const ribbons: PathBatchItem[] = [];
	const drawnChords: ChordLink[] = [];
	const ribbonRadius = inner * (1 - RIBBON_GAP);
	layout.chords.forEach((link, i) => {
		const t = staggered(
			ribbonPhase,
			chordRank[i] ?? 0,
			layout.chords.length,
			props.stagger ?? DEFAULT_STAGGER,
		);
		if (!(t > 0)) return;
		const fill = ribbonColor(link);
		const outline = state.ribbonItems.get(
			i,
			[link, ribbonRadius, cx, cy, headRadius, fill],
			() => ({
				polylines: [chordRibbon(link, ribbonRadius, { center, headRadius })],
				closed: true,
				fill,
			}),
		);
		ribbons.push(t >= 1 ? outline : { ...outline, opacity: t });
		drawnChords.push(link);
	});
	state.ribbonItems.sweep();
	state.drawnChords = drawnChords;

	// The ring, swept round from the start, and each group's name.
	const arcs: PathBatchItem[] = [];
	const drawnGroups: ChordGroup[] = [];
	const names: KeyedLabel[] = [];
	const fontSize = props.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE;
	for (const group of layout.groups) {
		if (group.endAngle === group.startAngle) continue;
		// The part of this arc the sweep has uncovered, 0..1.
		const a = turnOf(group.startAngle);
		const b = turnOf(group.endAngle);
		const shown = !(b > a)
			? ringSweep >= a
				? 1
				: 0
			: clamp01((ringSweep - a) / (b - a));
		const mid = (group.startAngle + group.endAngle) / 2;
		if (shown > 0) {
			const angle = (group.endAngle - group.startAngle) * shown;
			const fill = groupColor(group.index);
			const arc = state.arcItems.get(
				group.index,
				[cx, cy, inner, radius, group.startAngle, angle, fill],
				() =>
					wedgeItem(
						{
							cx,
							cy,
							innerRadius: inner,
							outerRadius: radius,
							startAngle: group.startAngle,
							angle,
						},
						{ fill },
						true,
					),
			);
			if (arc) {
				arcs.push(arc);
				drawnGroups.push(group);
			}
		}
		if (props.labels !== false && visible) {
			const text = nameOf(group.index);
			const at = polarPoint(cx, cy, radius, mid);
			names.push({
				key: group.index,
				props: {
					text,
					place: anchoredLabelPlace(
						{
							text,
							at,
							direction: { x: Math.cos(mid), y: Math.sin(mid) },
							gap: LABEL_GAP,
							fontSize,
						},
						theme.defaults.fontFamily,
					),
					fontSize,
					color: theme.palette.foreground,
					opacity: shown,
					zIndex: zIndex + 2,
				},
			});
		}
	}
	state.arcItems.sweep();
	state.drawnGroups = drawnGroups;

	const tipped = props.tooltip !== undefined || !!tooltip.config();
	const ribbonHandlers = itemTooltipHandlers(
		tooltip,
		(item) => {
			const link = state.drawnChords[item];
			if (!link || !props.tooltip) return undefined;
			const index = datumOf(link);
			return index === undefined
				? chordText(link)
				: tooltipText(
						props.tooltip,
						() => chordText(link),
						props.data[index],
						index,
						tooltip,
					);
		},
		(item) => {
			const link = state.drawnChords[item];
			if (!link) return undefined;
			const s = link.source;
			return polarPoint(cx, cy, inner, (s.startAngle + s.endAngle) / 2);
		},
		() => "Chord ribbons",
	);
	const arcHandlers = itemTooltipHandlers(
		tooltip,
		(item) => {
			const group = state.drawnGroups[item];
			return group && props.tooltip
				? `${nameOf(group.index)}: ${formatTick(group.value)}`
				: undefined;
		},
		(item) => {
			const group = state.drawnGroups[item];
			return group
				? polarPoint(cx, cy, radius, (group.startAngle + group.endAngle) / 2)
				: undefined;
		},
		() => "Chord groups",
	);
	const interaction = (handlers: typeof arcHandlers) =>
		tipped
			? {
					label: handlers.label,
					onEnter: handlers.onEnter,
					onLeave: handlers.onLeave,
					onTap: handlers.onTap,
					itemLabel: handlers.itemLabel,
				}
			: {
					label: undefined,
					onEnter: undefined,
					onLeave: undefined,
					onTap: undefined,
					itemLabel: undefined,
				};
	state.ribbons.update({
		items: ribbons,
		stroke: "none",
		fillOpacity: props.ribbonOpacity ?? DEFAULT_RIBBON_OPACITY,
		zIndex,
		visible,
		...interaction(ribbonHandlers),
	} as Partial<PathBatchItemsProps>);
	state.arcs.update({
		items: arcs,
		stroke: "none",
		zIndex: zIndex + 1,
		visible,
		...interaction(arcHandlers),
	} as Partial<PathBatchItemsProps>);
	return [
		state.ribbons,
		state.arcs,
		...labelList(ctx, "names", names),
		...state.tooltip.overlay(ctx),
	];
}

/**
 * A chord diagram: flows between groups round a circle. Each group is an arc as long as its
 * total, and each pair with any flow is joined by a ribbon as wide as the flow each way. Takes
 * `source`/`target`/`value` like `sankey`; draws in scene units. Ribbons and arcs are one path
 * batch each. See {@link chordLayout} and {@link chordRibbon} for the geometry alone.
 *
 * @example
 * ```ts
 * import { chord } from "@sophistry/charts";
 *
 * chord.create({
 * 	data: [
 * 		{ from: "north", to: "south", n: 5 },
 * 		{ from: "south", to: "north", n: 3 },
 * 	],
 * 	source: "from",
 * 	target: "to",
 * 	value: "n",
 * 	tooltip: true,
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#flows
 * @category Charts
 */
export const chord = defineComposite<ChordProps<AnyDatum, AnyDatum>>({
	name: "Chord",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		source: { invalidates: Invalidate.UPDATE },
		target: { invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		nodes: { invalidates: Invalidate.UPDATE },
		nodeId: { invalidates: Invalidate.UPDATE },
		nodeLabel: { invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		radius: { invalidates: Invalidate.UPDATE },
		thickness: { invalidates: Invalidate.UPDATE },
		padAngle: { invalidates: Invalidate.UPDATE },
		startAngle: { invalidates: Invalidate.UPDATE },
		clockwise: { invalidates: Invalidate.UPDATE },
		directed: { invalidates: Invalidate.UPDATE },
		arrows: { invalidates: Invalidate.UPDATE },
		arrowSize: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		ribbonColor: { invalidates: Invalidate.UPDATE },
		ribbonOpacity: { invalidates: Invalidate.UPDATE },
		labels: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			tooltip: createOwnTooltip(),
			ribbons: pathBatch.create({ items: [] }),
			arcs: pathBatch.create({ items: [] }),
			ribbonItems: createItemCache<PathBatchItem>(),
			arcItems: createItemCache<PathBatchItem | undefined>(),
			groups: ctx.memo(groupListOf),
			flows: ctx.memo(flowsOf),
			layout: ctx.memo(
				(
					matrix: number[][],
					padAngle: number | undefined,
					startAngle: number | undefined,
					clockwise: boolean | undefined,
					directed: boolean | undefined,
				) => chordLayout(matrix, { padAngle, startAngle, clockwise, directed }),
			),
			chordRank: ctx.memo(
				(layout: ChordLayout, start: number, direction: number) => {
					const turnOf = (angle: number) =>
						((angle - start) * direction) / (Math.PI * 2);
					return ranks(
						layout.chords.map((c) =>
							Math.min(
								turnOf(c.source.startAngle),
								turnOf(c.target.startAngle),
							),
						),
					);
				},
			),
			drawnChords: [],
			drawnGroups: [],
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
