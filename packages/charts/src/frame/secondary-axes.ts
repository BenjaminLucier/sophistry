/**
 * `secondaryX` and `secondaryY`: the layers inside map one axis through the
 * enclosing chart's secondary scale. They provide lifted versions of the
 * chart's contexts to their children: the frame and coordinate system
 * through the secondary axis, a report sink that moves the layers' extents
 * onto it, and a date sink that notes dates there.
 */

import type { CompositeContext, SceneNode } from "@sophistry/core";
import { defineComposite, Invalidate, publishCoords } from "@sophistry/core";
import { secondaryLiftContext } from "../chart.js";
import { chartContext, chartLayersContext } from "../context.js";
import type { DateSink } from "../data/channels.js";
import { dateSinkContext } from "../data/channels.js";
import { onSecondary } from "./secondary.js";
import type { ChartLayers } from "./types.js";

/**
 * Props for {@link secondaryY}.
 *
 * @category Charts
 */
export interface SecondaryYProps {
	/** The layers to map through the secondary y axis. */
	children?: readonly SceneNode[];
}

/**
 * Props for {@link secondaryX}.
 *
 * @category Charts
 */
export interface SecondaryXProps {
	/** The layers to map through the secondary x axis. */
	children?: readonly SceneNode[];
}

/** The composite behind both: `axis` is the one its layers map through the secondary scale. */
function onSecondaryAxis(axis: "x" | "y") {
	const name = axis === "x" ? "SecondaryX" : "SecondaryY";
	const flags = { x2: axis === "x", y2: axis === "y" };
	const lifted = (
		ctx: CompositeContext<{ children?: readonly SceneNode[] }>,
	) => {
		const lift = ctx.context(secondaryLiftContext);
		const parent = ctx.context(chartContext);
		if (!lift || !parent)
			throw new Error(`${name} must be placed inside a chart.`);
		const frame = lift.lift(parent, axis);
		ctx.provide(chartContext, frame);
		publishCoords(ctx, frame.coords);
		return ctx.children;
	};
	return defineComposite<{ children?: readonly SceneNode[] }>({
		name,
		props: {
			children: { kind: "children", invalidates: Invalidate.NONE },
		},
		setup: (ctx) => {
			// Reports and dates read inside go on the secondary axis.
			const reports: ChartLayers = {
				report(owner, extent) {
					ctx
						.context(chartLayersContext)
						?.report(
							owner,
							extent === null ? null : onSecondary(extent, flags),
						);
				},
			};
			const dates: DateSink = {
				note: (on) =>
					ctx.context(dateSinkContext)?.note(on === axis ? `${axis}2` : on),
				timeZone: (on) =>
					ctx
						.context(dateSinkContext)
						?.timeZone(on === axis ? `${axis}2` : on) ?? "UTC",
			};
			ctx.provide(chartLayersContext, reports);
			ctx.provide(dateSinkContext, dates);
			return lifted(ctx);
		},
		update: (_changed, ctx) => lifted(ctx),
	});
}

/**
 * A secondary y axis, drawn on the plot's right edge. Layers inside share
 * the chart's x axis, colours, legend and reveal but map y through the
 * chart's `y2Range`, `y2Axis` and `y2Label`. Only inside a `chart`.
 *
 * @example
 * ```ts
 * import { bars, chart, linePlot, secondaryY } from "@sophistry/charts";
 *
 * const data = [
 * 	{ month: "Jan", temp: 3, rain: 60 },
 * 	{ month: "Feb", temp: 4, rain: 45 },
 * 	{ month: "Mar", temp: 8, rain: 50 },
 * ];
 * chart.create({
 * 	width: 8,
 * 	height: 4,
 * 	y2Label: "rain (mm)",
 * 	children: [
 * 		linePlot.create({ data, x: "month", y: "temp" }),
 * 		secondaryY.create({ children: [bars.create({ data, category: "month", value: "rain" })] }),
 * 	],
 * });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#the-chart-frame
 * @category Charts
 */
export const secondaryY = onSecondaryAxis("y");

/**
 * A secondary x axis, drawn along the plot's top edge. Layers inside share
 * the chart's y axis, colours, legend and reveal but map x through the
 * chart's `x2Range`, `x2Axis` and `x2Label`. Nest it with
 * {@link secondaryY} for both. Only inside a `chart`.
 *
 * @see https://sophistry.dev/guides/charts/#the-chart-frame
 * @category Charts
 */
export const secondaryX = onSecondaryAxis("x");
