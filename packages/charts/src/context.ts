/**
 * How layers find their chart: the context keys a `chart` provides and the
 * helper every layer calls ({@link chartLayer}), the imperative form of
 * a chart, layer and colour scale lookup.
 *
 * - {@link chartContext}: the frame snapshot ({@link ChartFrame}). A new
 *   object whenever the fit, the reveal, the colour scale or a transition
 *   stage changes; a layer reading it with `ctx.context(chartContext)` reruns
 *   its `update` exactly then.
 * - {@link chartLayersContext}: where reports go ({@link ChartLayers}),
 *   stable for the chart's life.
 * - `coordsContext` (core): the chart publishes its coordinate system there
 *   too, so core's graphs and annotations plot inside a chart.
 * - `tooltipContext`, `dateSinkContext`: the chart's tooltip and date sink.
 */

import type {
	CompositeContext,
	ContextKey,
	CoordinateSystem,
} from "@sophistry/core";
import { coordsContext, createContextKey } from "@sophistry/core";
import type { BandKey } from "@sophistry/core/geometry";
import type { Theme } from "@sophistry/core/themes";
import type {
	ChartFrame,
	ChartLayerExtent,
	ChartLayers,
} from "./frame/types.js";
import type { OrdinalColorScale } from "./math/ordinal.js";
import { ordinalColorScale } from "./math/ordinal.js";
import { shallowEqual } from "./util.js";

/**
 * The enclosing chart's frame, or null outside one (a plain `axes`, or no
 * coordinate system at all). Read it with `ctx.context(chartContext)` inside
 * `setup`/`update`; see {@link ChartFrame}.
 *
 * @category Extending
 */
export const chartContext: ContextKey<ChartFrame | null> =
	createContextKey<ChartFrame | null>("chart", null);

/**
 * Where the enclosing chart's layers report their extents, or null outside a
 * chart. Layers use {@link chartLayer} rather than reading it directly.
 *
 * @category Extending
 */
export const chartLayersContext: ContextKey<ChartLayers | null> =
	createContextKey<ChartLayers | null>("chartLayers", null);

/**
 * A layer's link to its chart. See {@link chartLayer}.
 *
 * @category Extending
 */
export interface ChartLayer {
	/**
	 * The chart's current frame, or null outside a chart. Reading it reruns
	 * the layer's `update` when the chart publishes a new frame.
	 */
	frame(): ChartFrame | null;
	/**
	 * The coordinate system in scope: the chart's (or an `axes`'), else null.
	 * Reading it reruns `update` when it changes.
	 */
	coords(): CoordinateSystem | null;
	/**
	 * Sends the layer's extent to the chart (a no-op outside one). Call from
	 * every `update` with the current report; the chart refits only when it
	 * changed by value. `undefined` withdraws the report.
	 */
	report(extent: ChartLayerExtent | undefined): void;
	/** The layer's own `progress`, scaled by the frame's data phase (as given outside a chart). */
	progress(own: number | undefined): number | undefined;
	/**
	 * The categorical colour scale `series` maps through: inside a chart the
	 * frame's shared scale (report the categories as `color: { categories }`),
	 * outside one a scale over `categories` cycling the theme's colours.
	 */
	colorScale(categories: readonly BandKey[]): OrdinalColorScale;
}

/**
 * Wires a layer composite into its chart: reports its extent so the frame
 * can fit its axes, and scales its reveal by the frame's data phase. Outside
 * a chart it reports nothing and leaves `progress` untouched, so layers also
 * work in a plain `axes`. Call once, in `setup`; the report is withdrawn
 * when the layer is disposed.
 *
 * @example
 * ```ts
 * import { type CompositeContext, circle, defineComposite, Invalidate } from "@sophistry/core";
 * import { type ChartLayer, chartLayer } from "@sophistry/charts";
 *
 * interface PinsProps {
 * 	xs: readonly number[];
 * 	ys: readonly number[];
 * }
 *
 * const layers = new WeakMap<object, ChartLayer>();
 *
 * function draw(ctx: CompositeContext<PinsProps>) {
 * 	const layer = layers.get(ctx.node)!;
 * 	const { xs, ys } = ctx.props;
 * 	layer.report({ x: { values: xs }, y: { values: ys, zero: true } });
 * 	const coords = layer.coords();
 * 	if (!coords) return [];
 * 	// Build children in data space through `coords`.
 * 	return xs.map((x, i) => circle.create({ center: coords.coordsToPoint(x, ys[i]), radius: 0.08 }));
 * }
 *
 * export const pins = defineComposite<PinsProps>({
 * 	name: "Pins",
 * 	props: {
 * 		xs: { default: [], invalidates: Invalidate.UPDATE },
 * 		ys: { default: [], invalidates: Invalidate.UPDATE },
 * 	},
 * 	setup: (ctx) => {
 * 		layers.set(ctx.node, chartLayer(ctx));
 * 		return draw(ctx);
 * 	},
 * 	update: (_changed, ctx) => draw(ctx),
 * });
 * ```
 *
 * @category Extending
 */
export function chartLayer<P>(ctx: CompositeContext<P>): ChartLayer {
	const owner = {};
	let layers: ChartLayers | null | undefined;
	const registry = () => {
		layers ??= ctx.context(chartLayersContext);
		return layers;
	};
	let reported = false;
	ctx.onDispose(() => {
		if (reported) layers?.report(owner, null);
	});
	let outside: {
		theme: Theme;
		domain: readonly BandKey[];
		scale: OrdinalColorScale;
	} | null = null;
	return {
		frame: () => ctx.context(chartContext),
		coords: () => ctx.context(coordsContext),
		report(extent) {
			const target = registry();
			if (!target) return;
			if (extent === undefined) {
				if (reported) target.report(owner, null);
				reported = false;
				return;
			}
			reported = true;
			target.report(owner, extent);
		},
		progress(own) {
			const frame = ctx.context(chartContext);
			if (!frame) return own;
			return (own ?? 1) * frame.dataProgress;
		},
		colorScale(categories) {
			const frame = ctx.context(chartContext);
			if (frame) return frame.colorScale;
			const theme = ctx.theme;
			if (
				outside &&
				outside.theme === theme &&
				shallowEqual(outside.domain, categories)
			)
				return outside.scale;
			const scale = ordinalColorScale(categories, theme.palette.series);
			outside = { theme, domain: categories, scale };
			return scale;
		},
	};
}
