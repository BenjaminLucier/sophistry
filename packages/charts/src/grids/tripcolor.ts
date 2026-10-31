/**
 * `tripcolor`: a pseudocolour plot over scattered points, drawn as one path
 * batch (one closed triangle per face). Faces fade in as a diagonal wave
 * from the top-left; tooltips resolve per face through `event.item`.
 */

import type {
	ColorRampSpec,
	CompositeContext,
	PathBatchItem,
	PathBatchItemsProps,
	PathBatchNode,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	pathBatch,
	UNDER_AXES_Z_INDEX,
} from "@sophistry/core";
import { formatTick } from "@sophistry/core/geometry";
import { resolveColorRamp } from "@sophistry/core/internal";
import type { Colormap } from "@sophistry/core/themes";
import type { ColorNorm, RampScaleProps } from "../color-norm";
import { colorNorm, rampOf } from "../color-norm";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import { dateSinkContext } from "../data/channels";
import type { RampExtent } from "../frame/types";
import { itemTooltipHandlers } from "../item-tooltip";
import type { TripcolorFace } from "../math/tricontour";
import { tripcolorFaces } from "../math/tricontour";
import type { AnyDatum } from "../props";
import { ranks } from "../stagger";
import type { TooltipSpec } from "../tooltip";
import { tooltipContext, tooltipText } from "../tooltip";
import { keyedMemo } from "../util";
import type { TriChartBaseProps, TriPoints } from "./tri-shared";
import { triPoints, triReveal, valueExtent } from "./tri-shared";

/**
 * Props of {@link tripcolor}.
 *
 * @category Charts
 */
export interface TripcolorProps<T = unknown>
	extends TriChartBaseProps<T>,
		RampScaleProps {
	/**
	 * How a face's value becomes colour: a colormap name (`"viridis"`), CSS stops, or `(t) =>
	 * colour`. Defaults to the theme's ramp.
	 */
	ramp?: ColorRampSpec;
	/** Value at the bottom of the ramp. Defaults to the smallest face value. */
	rampMin?: number;
	/** Value at the top of the ramp. Defaults to the largest face value. */
	rampMax?: number;
	/** Outline of every triangle, to show the mesh. Defaults to none. */
	stroke?: string;
	/** Width of the mesh outline. */
	strokeWidth?: number;
	/**
	 * Opacity of the faces, 0..1.
	 * @default 1
	 */
	opacity?: number;
	/**
	 * Hover tooltip: `true` for the face's value, or `(d, i) => string` given the face's first
	 * corner.
	 */
	tooltip?: TooltipSpec<T>;
	/**
	 * Paint order; higher draws later. Defaults to `UNDER_AXES_Z_INDEX` (above the grid, under the
	 * axes).
	 */
	zIndex?: number;
	/** Set to false to hide the faces. */
	visible?: boolean;
}

/** A face placed in scene units. */
interface PlacedFace {
	face: TripcolorFace;
	item: PathBatchItem;
	/** Its place in the diagonal wave. */
	rank: number;
}

/** What a tripcolor keeps between updates. */
interface TripcolorState {
	layer: ChartLayer;
	points: (deps: readonly unknown[], make: () => TriPoints) => TriPoints;
	faces: (
		deps: readonly unknown[],
		make: () => TripcolorFace[],
	) => TripcolorFace[];
	colors: (
		deps: readonly unknown[],
		make: () => { ramp: Colormap; norm: ColorNorm; extent: RampExtent },
	) => { ramp: Colormap; norm: ColorNorm; extent: RampExtent };
	placed: (deps: readonly unknown[], make: () => PlacedFace[]) => PlacedFace[];
	batch: PathBatchNode<PathBatchItemsProps>;
	/** The faces drawn on this frame, by item index. */
	drawn: PlacedFace[];
}

const states = new WeakMap<object, TripcolorState>();

function draw(ctx: CompositeContext<TripcolorProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as TripcolorState;
	const props = ctx.props;
	const coords = state.layer.coords();
	if (!coords)
		throw new Error("Tripcolor must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const tooltip = ctx.context(tooltipContext);
	const theme = ctx.theme;
	const points = state.points([props.data, props.x, props.y, props.value], () =>
		triPoints(props, dates),
	);
	const faces = state.faces([points, props.triangles], () =>
		tripcolorFaces(points.xs, points.ys, points.zs, {
			triangles: props.triangles,
		}),
	);
	const colors = state.colors(
		[
			faces,
			props.ramp,
			theme,
			props.rampScale,
			props.rampMidpoint,
			props.rampMin,
			props.rampMax,
		],
		() => {
			const ramp = resolveColorRamp(props.ramp, () => theme.palette.ramp);
			const norm = colorNorm(
				faces.map((f) => f.value),
				{
					rampScale: props.rampScale,
					rampMidpoint: props.rampMidpoint,
					rampMin: props.rampMin,
					rampMax: props.rampMax,
					always: true,
				},
			);
			return { ramp, norm, extent: rampOf(norm, norm.domain, ramp) };
		},
	);
	state.layer.report({
		covers: true,
		x: { values: points.xs },
		y: { values: points.ys },
		ramp: colors.extent,
	});
	const placed = state.placed([faces, coords, colors], () => {
		// Diagonal wave from the top-left: x rising, y falling, each normalised to the extent.
		const [x0, x1] = valueExtent(points.xs);
		const [y0, y1] = valueExtent(points.ys);
		const sx = x1 - x0 || 1;
		const sy = y1 - y0 || 1;
		const order = ranks(
			faces.map((f) => {
				const [a, b, c] = f.points as [
					{ x: number; y: number },
					{ x: number; y: number },
					{ x: number; y: number },
				];
				const cx = (a.x + b.x + c.x) / 3;
				const cy = (a.y + b.y + c.y) / 3;
				return (cx - x0) / sx + (y1 - cy) / sy;
			}),
		);
		const out: PlacedFace[] = [];
		faces.forEach((face, i) => {
			// The face's place on the ramp; not drawn where the scale has none.
			const unit = colors.norm.unit(face.value);
			if (!Number.isFinite(unit)) return;
			out.push({
				face,
				rank: order[i] ?? 0,
				item: {
					closed: true,
					polylines: [
						face.points.map(({ x, y }) => coords.coordsToPoint(x, y)),
					],
					fill: colors.ramp(unit),
				},
			});
		});
		return out;
	});
	const own = state.layer.progress(props.progress);
	const drawn: PlacedFace[] = [];
	const items: PathBatchItem[] = [];
	for (const placedFace of placed) {
		const t = triReveal(own, placedFace.rank, faces.length, props.stagger);
		if (!(t > 0)) continue;
		drawn.push(placedFace);
		items.push(t >= 1 ? placedFace.item : { ...placedFace.item, opacity: t });
	}
	state.drawn = drawn;

	const handlers = itemTooltipHandlers(
		tooltip,
		(index) => {
			const face = state.drawn[index]?.face;
			if (!face) return undefined;
			const corner = face.indices[0];
			return tooltipText(
				props.tooltip,
				() => formatTick(face.value),
				props.data[corner],
				corner,
				tooltip ?? undefined,
			);
		},
		(index) => {
			const face = state.drawn[index]?.face;
			if (!face) return undefined;
			const [a, b, c] = face.points as [
				{ x: number; y: number },
				{ x: number; y: number },
				{ x: number; y: number },
			];
			return coords.coordsToPoint(
				(a.x + b.x + c.x) / 3,
				Math.max(a.y, b.y, c.y),
			);
		},
		() => "Tripcolor",
	);
	const interactive =
		tooltip && (props.tooltip !== undefined || tooltip.config());
	state.batch.update({
		items,
		stroke: props.stroke ?? "none",
		strokeWidth: props.strokeWidth,
		opacity: props.opacity,
		zIndex: props.zIndex ?? UNDER_AXES_Z_INDEX,
		visible: props.visible,
		...(interactive
			? {
					label: handlers.label,
					onEnter: handlers.onEnter,
					onLeave: handlers.onLeave,
					onTap: handlers.onTap,
					itemLabel: handlers.itemLabel,
				}
			: {}),
	} as never);
	return [state.batch];
}

/**
 * A pseudocolour plot over scattered points: the points are triangulated (Delaunay, or your own
 * `triangles`) and each triangle filled with the mean of its corners' values. `stroke` outlines
 * the mesh. Reveals as a diagonal wave from the top-left. Inside a `chart` or `axes`; drawn as
 * one path batch. See {@link tripcolorFaces} for the faces alone.
 *
 * @example
 * ```ts
 * import { chart, tripcolor } from "@sophistry/charts";
 *
 * const samples = [
 * 	{ x: 0, y: 0, v: 1 },
 * 	{ x: 1, y: 0, v: 3 },
 * 	{ x: 0, y: 1, v: 2 },
 * 	{ x: 1, y: 1, v: 5 },
 * ];
 * chart.create({
 * 	width: 6,
 * 	height: 4,
 * 	children: [tripcolor.create({ data: samples, x: "x", y: "y", value: "v", tooltip: true })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const tripcolor = defineComposite<TripcolorProps<AnyDatum>>({
	name: "Tripcolor",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		triangles: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		ramp: { invalidates: Invalidate.UPDATE },
		rampMin: { invalidates: Invalidate.UPDATE },
		rampMax: { invalidates: Invalidate.UPDATE },
		rampScale: { invalidates: Invalidate.UPDATE },
		rampMidpoint: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			layer: chartLayer(ctx),
			points: keyedMemo(),
			faces: keyedMemo(),
			colors: keyedMemo(),
			placed: keyedMemo(),
			batch: pathBatch.create({ items: [] }),
			drawn: [],
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
