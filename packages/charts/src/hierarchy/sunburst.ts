/**
 * `sunburst`: the partition layout in polar coordinates.
 *
 * Every sector is one item of one path batch, with the native curve outline
 * of a `Sector` (the centre disc) or an `AnnularSector` (a ring), its own fill and its own stroke (the background-coloured outline on
 * rings, none on the disc or a full turn); per-node picking, tooltips and
 * drilling go through `event.item`. The clockwise sweep cuts each sector's
 * angle (geometry). Names are `text` nodes, one per sector
 * whose name fits.
 */

import type {
	CompositeContext,
	PathBatchItem,
	PathBatchItemsProps,
	PathBatchNode,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, pathBatch } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import {
	annularSectorCurvePath,
	sectorCurvePath,
} from "@sophistry/core/geometry";
import { clamp01, cssColor, polarPoint, TAU } from "@sophistry/core/internal";
import type { RequiredUnless } from "../data/channels.js";
import type { HierarchyRect } from "../math/hierarchy.js";
import { partitionLayout } from "../math/hierarchy.js";
import { readableOn } from "../mix.js";
import type { AnyDatum } from "../props.js";
import { staggered } from "../stagger.js";
import { mix } from "../util.js";
import type { HierarchyDrillProps } from "./drill.js";
import type { HierarchyChart } from "./frame.js";
import { createHierarchyChart } from "./frame.js";
import type { KeyedLabel } from "./labels.js";
import { createLabelMeasure, labelList } from "./labels.js";
import { hierarchyPropsDescriptor } from "./props.js";
import type {
	HierarchyChartBaseProps,
	HierarchyFocusSpec,
	HierarchyTransitionProps,
} from "./shared.js";
import {
	HIERARCHY_LABEL_FONT_SIZE,
	hierarchyOptionDeps,
	hierarchyOptions,
	labelPad,
	presenceOf,
	RECT_FIELDS,
	throughView,
} from "./shared.js";

const DEFAULT_STROKE_WIDTH = 0.02;
const DEFAULT_STAGGER = 0.2;
/** Hole-to-outer-radius ratio under which a ring's label starts easing to the centre (rest rings sit at 0.5 or more). */
const DISC_BLEND = 0.35;
/** Smallest sweep worth drawing, in radians: what `sector` and `annularSector` skip. */
const NO_SWEEP = 1e-9;

/** @category Charts */
export interface SunburstBaseProps<T>
	extends HierarchyChartBaseProps<T>,
		HierarchyTransitionProps<T>,
		HierarchyDrillProps<T> {
	/** Centre of the chart. Defaults to the origin. */
	center?: Point;
	/**
	 * Outer radius.
	 * @default 1
	 */
	radius?: number;
	/**
	 * Draw the root as a disc in the centre; `false` leaves a hole of the same size.
	 * @default true
	 */
	root?: boolean;
	/** Outline between the sectors. Defaults to the theme background. */
	stroke?: string;
	/**
	 * Outline width.
	 * @default 0.02
	 */
	strokeWidth?: number;
	/**
	 * Zoom into a node: it becomes the centre disc and its descendants open out round the whole
	 * turn while the rest fades. A path of names below the root (`["a"]`), a predicate, or `{ from,
	 * to, t }` for a scrubbable transition. Given, the chart is controlled: taps only call
	 * `onFocusChange`. Defaults to the root.
	 */
	focus?: HierarchyFocusSpec<T>;
}

/**
 * Props of {@link sunburst}: `value` is required unless the tree's nodes are numbers.
 *
 * @category Charts
 */
export type SunburstProps<T> = SunburstBaseProps<T> &
	RequiredUnless<T, number, "value">;

/** What a drawn sector's item was made from, to keep it while they hold. */
interface SectorInputs {
	inner: number;
	outer: number;
	startAngle: number;
	angle: number;
	fill: string;
	stroke: string;
	opacity: number;
}

interface SunburstState {
	chart: HierarchyChart<AnyDatum, HierarchyRect<AnyDatum>>;
	sectors: PathBatchNode<PathBatchItemsProps>;
	/** Last update's item per key, reused while its inputs hold (its outline stays prepared). */
	kept: Map<string, { inputs: SectorInputs; item: PathBatchItem }>;
	/** Each drawn item's node position and tooltip anchor, in item order. */
	positions: number[];
	anchors: Point[];
	measure: ReturnType<typeof createLabelMeasure>;
}

const states = new WeakMap<object, SunburstState>();

/** Two sectors' inputs equal field by field. */
function sameInputs(a: SectorInputs, b: SectorInputs): boolean {
	return (
		a.inner === b.inner &&
		a.outer === b.outer &&
		a.startAngle === b.startAngle &&
		a.angle === b.angle &&
		a.fill === b.fill &&
		a.stroke === b.stroke &&
		a.opacity === b.opacity
	);
}

function draw(
	ctx: CompositeContext<SunburstProps<AnyDatum>>,
	state: SunburstState,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	/** Unit layout: `x` is the fraction of a turn, `y` the fraction of `radius`. */
	const frame = state.chart.frame(
		props,
		theme,
		(data) => partitionLayout(data, hierarchyOptions(props)),
		hierarchyOptionDeps(props),
		{
			/** The window onto the unit layout: a node's share of the turn, from its ring out. */
			viewOf: (layout, position) => {
				const n = layout[position];
				return n
					? { x0: n.x0, x1: n.x1, y0: n.y0, y1: 1 }
					: { x0: 0, x1: 1, y0: 0, y1: 1 };
			},
		},
	);
	const { layout, keys, fills, zoom } = frame;
	const firstDepth = props.root === false ? 1 : 0;
	const rings = (layout[0]?.height ?? 0) + 1 - firstDepth;
	const cx = props.center?.x ?? 0;
	const cy = props.center?.y ?? 0;
	const r = props.radius ?? 1;
	const fontSize = props.labelFontSize ?? HIERARCHY_LABEL_FONT_SIZE;
	const progress = props.progress ?? 1;
	const stagger = props.stagger ?? DEFAULT_STAGGER;
	const on = props.visible !== false;
	const stroke = cssColor(props.stroke ?? theme.palette.background);
	const v = zoom.view;

	const items: PathBatchItem[] = [];
	const positions: number[] = [];
	const anchors: Point[] = [];
	const kept = new Map<string, { inputs: SectorInputs; item: PathBatchItem }>();
	const texts: KeyedLabel[] = [];
	for (let position = firstDepth; position < layout.length; position++) {
		const node = layout[position] as (typeof layout)[number];
		if (node.depth < firstDepth) continue;
		/** Present (1) inside the focused subtree, fading out of it. */
		const weight = zoom.weight(position) * presenceOf(node);
		/** The node through the zoom's window: turn fractions and radius fractions. */
		const [a0, a1] = throughView(node.x0, node.x1, v.x0, v.x1);
		const [r0, r1] = throughView(node.y0, node.y1, v.y0, v.y1);
		/** How far round this node's ring the sweep has got, 0..1 of a turn. */
		const sweep = staggered(progress, node.depth - firstDepth, rings, stagger);
		/** The swept part of this node's own (visible) span, 0..1. */
		const reveal = !(a1 > a0)
			? sweep >= a0 && sweep > 0
				? 1
				: 0
			: clamp01((sweep - a0) / (a1 - a0));
		const shown = on && reveal > 0 && weight > 0 && a1 > a0 && r1 > r0;
		if (!shown) continue;
		const fill = fills[position] ?? theme.palette.foreground;
		const end = Math.min(a1, a0 + (a1 - a0) * reveal);
		// Layout angle `a` (0 at 12 o'clock, clockwise) → π/2 − 2πa.
		const startAngle = Math.PI / 2 - TAU * a0;
		const angle = -TAU * (end - a0);
		const inner = r0 * r;
		const outer = r1 * r;
		/** The centre disc: the root, or the focused node when zoomed in. */
		const disc = r0 <= 1e-9;
		/**
		 * How far a ring is from the centre disc, 0..1: 0 for the disc, 1 once its
		 * hole is a sizeable part of it. A drill's focused node closes into the
		 * disc, and its label eases to the centre with it rather than snapping.
		 */
		const apart = r1 > 0 ? clamp01(r0 / (r1 * DISC_BLEND)) : 0;
		const midAngle = Math.PI / 2 - TAU * ((a0 + a1) / 2);
		const midRadius = ((r0 + r1) / 2) * r * apart;
		if (Math.abs(angle) > NO_SWEEP) {
			const inputs: SectorInputs = {
				inner,
				outer,
				startAngle,
				angle,
				fill,
				// The root disc has no outline (ring 1's already separates them, and a
				// full turn's would draw a seam from the centre to 12 o'clock); nor
				// does a full-turn ring, whose two radial edges meet at 12 o'clock.
				stroke: inner > 0 && angle > -TAU + 1e-6 ? stroke : "none",
				opacity: weight,
			};
			const key = keys[position] as string;
			const previous = state.kept.get(key);
			const item =
				previous && sameInputs(previous.inputs, inputs)
					? previous.item
					: sectorItem(cx, cy, inputs);
			kept.set(key, { inputs, item });
			items.push(item);
			positions.push(position);
			anchors.push(polarPoint(cx, cy, midRadius, midAngle));
		}
		if (props.labels === false || !node.label) continue;
		const width =
			state.measure(node.label, fontSize, theme) + 2 * labelPad(fontSize);
		let place: { x: number; y: number; rotation: number } | null = null;
		if (disc) {
			// The centre disc: horizontal, across its diameter.
			if (width <= 2 * r1 * r) place = { x: cx, y: cy, rotation: 0 };
		} else {
			// Room along the radius, widening to the disc's diameter as the ring
			// closes into it.
			const room = mix(2 * r1 * r, (r1 - r0) * r, apart);
			const arc = TAU * (a1 - a0) * midRadius;
			if (!(width > room || (apart >= 1 && fontSize * 1.2 > arc))) {
				// Along the radius, flipped on the left half to stay upright; level
				// as it reaches the centre.
				const rotation =
					(Math.cos(midAngle) < 0 ? midAngle + Math.PI : midAngle) * apart;
				place = { ...polarPoint(cx, cy, midRadius, midAngle), rotation };
			}
		}
		if (!place) continue;
		texts.push({
			key: keys[position] as string,
			props: {
				text: node.label,
				x: place.x,
				y: place.y,
				rotation: place.rotation,
				fontSize,
				color: readableOn(
					fill,
					theme.palette.foreground,
					theme.palette.background,
				),
				opacity: reveal * weight,
				zIndex: (props.zIndex ?? 0) + 1,
			},
		});
	}
	state.kept = kept;
	state.positions = positions;
	state.anchors = anchors;

	state.sectors.update({
		items,
		stroke,
		strokeWidth: props.strokeWidth ?? DEFAULT_STROKE_WIDTH,
		fillOpacity: props.fillOpacity ?? 1,
		zIndex: props.zIndex ?? 0,
		...state.chart.interaction(
			`Sunburst, ${items.length} nodes`,
			(item) => state.positions[item],
			(item) => state.anchors[item],
		),
	} as never);
	const trail = state.chart.breadcrumbs({
		options: props.breadcrumbs,
		corner: { x: cx - r, y: cy + r },
		width: 2 * r,
		labelFontSize: fontSize,
		progress: props.progress,
		zIndex: props.zIndex,
		visible: props.visible,
	});
	const out: SceneNode[] = [state.sectors, ...labelList(ctx, "labels", texts)];
	if (trail) out.push(trail);
	return out;
}

/** A sector as a path batch item: `sector`'s outline for the disc, `annularSector`'s for a ring. */
function sectorItem(
	cx: number,
	cy: number,
	inputs: SectorInputs,
): PathBatchItem {
	const end = inputs.startAngle + inputs.angle;
	const curve =
		inputs.inner > 0
			? annularSectorCurvePath(
					cx,
					cy,
					inputs.inner,
					inputs.outer,
					inputs.startAngle,
					end,
				)
			: sectorCurvePath(cx, cy, inputs.outer, inputs.startAngle, end);
	return {
		curvePaths: [curve],
		closed: true,
		fill: inputs.fill,
		stroke: inputs.stroke,
		opacity: inputs.opacity,
	};
}

/**
 * A sunburst: the partition layout in polar coordinates, the root in the centre and one ring
 * per depth outward, each sector spanning exactly its children, sized by value. Draws in scene
 * units, clockwise from 12 o'clock; reveals with one clockwise sweep. Supports drill-down
 * `focus` and keyed transitions. The sectors are one path batch (`event.item` picks a sector).
 * See {@link partitionLayout} for the layout alone.
 *
 * @example
 * ```ts
 * import { sunburst } from "@sophistry/charts";
 *
 * const files = {
 * 	name: "repo",
 * 	children: [
 * 		{ name: "src", children: [{ name: "index.ts", size: 12 }, { name: "chart.ts", size: 30 }] },
 * 		{ name: "README.md", size: 4 },
 * 	],
 * };
 * sunburst.create({ data: files, value: "size", label: "name", radius: 2, drill: true });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#hierarchies
 * @category Charts
 */
export const sunburst = defineComposite<SunburstProps<AnyDatum>>({
	name: "Sunburst",
	props: hierarchyPropsDescriptor<SunburstProps<AnyDatum>>([
		"center",
		"radius",
		"root",
		"stroke",
		"strokeWidth",
	]),
	setup: (ctx) => {
		const state: SunburstState = {
			chart: createHierarchyChart(ctx, RECT_FIELDS),
			sectors: pathBatch.create({ items: [] }),
			kept: new Map(),
			positions: [],
			anchors: [],
			measure: createLabelMeasure(),
		};
		states.set(ctx.node, state);
		return draw(ctx, state);
	},
	update: (_changed, ctx) => draw(ctx, states.get(ctx.node) as SunburstState),
});
