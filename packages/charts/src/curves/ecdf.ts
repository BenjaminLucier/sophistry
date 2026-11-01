/**
 * `ecdf`: an empirical cumulative distribution function per `series`, drawn
 * as `stairs` draws its lines (one path batch, see {@link drawStepLines}).
 */

import type { CompositeContext, SceneNode } from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { BandKey } from "@sophistry/core/geometry";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, DateSink } from "../data/channels.js";
import {
	channelValues,
	dateSinkContext,
	identity,
	numberValues,
} from "../data/channels.js";
import { createGroupJoin, layerTransition, transitionColor } from "../join.js";
import type { EcdfSteps } from "../math/ecdf.js";
import { ecdfSteps } from "../math/ecdf.js";
import type { AnyDatum, CurveReveal, SeriesTransitionProps } from "../props.js";
import type { Category, GroupKey } from "../series.js";
import { createSeries, groupIndices } from "../series.js";
import { keyedMemo } from "../util.js";
import { groupColors } from "./shared.js";
import type { StepLineStyleProps, StepLines } from "./stairs.js";
import {
	createStepLines,
	drawStepLines,
	stepLineStyleDescriptor,
} from "./stairs.js";

/**
 * Props of {@link ecdf}: `value` defaults to the datum when `data` is
 * `number[]`; name it otherwise.
 *
 * @category Charts
 */
export interface EcdfProps<T = unknown>
	extends SeriesTransitionProps<T>,
		StepLineStyleProps {
	/** One observation per datum. */
	data: readonly T[];
	/**
	 * The observed value, in data units. Defaults to the datum when `data` is `number[]`; required
	 * otherwise. Non-finite values are dropped.
	 */
	value?: Channel<T, number>;
	/**
	 * Data-space padding left of the smallest and right of the largest value; see {@link
	 * ecdfSteps}. Defaults to 5% of the span (0.5 when all values are equal).
	 */
	pad?: number;
	/**
	 * How `progress` reveals the curve: along x or by arc length.
	 * @default "x"
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	reveal?: CurveReveal;
	/**
	 * The category of each datum: one curve per category, coloured through the chart's shared
	 * colour scale and legend. `stroke` wins.
	 */
	series?: Channel<T, BandKey>;
	/**
	 * The sample to transition to, curves matched by `series`: shared curves morph and stay step
	 * functions, new ones sweep in, leaving ones fade out. See {@link SeriesTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
}

function stepsOf(
	data: readonly unknown[],
	of: readonly Category[] | undefined,
	props: EcdfProps<AnyDatum>,
	dates: DateSink | null,
): Map<GroupKey, EcdfSteps> {
	const all = numberValues(
		data,
		props.value as Channel<unknown, number>,
		identity,
		"value",
		dates,
	);
	const out = new Map<GroupKey, EcdfSteps>();
	for (const [key, indices] of groupIndices(all.length, of))
		out.set(
			key,
			ecdfSteps(
				indices.map((i) => all[i] as number),
				{ pad: props.pad },
			),
		);
	return out;
}

type Steps = Map<GroupKey, EcdfSteps>;

/** What an ecdf keeps between updates. */
interface EcdfState {
	layer: ChartLayer;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	join: ReturnType<typeof createGroupJoin>;
	from: (deps: readonly unknown[], make: () => Steps) => Steps;
	to: (deps: readonly unknown[], make: () => Steps) => Steps;
	lines: StepLines;
}

const states = new WeakMap<object, EcdfState>();

function draw(ctx: CompositeContext<EcdfProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as EcdfState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords) throw new Error("Ecdf must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.stroke !== undefined,
		mark: { line: true },
		dates,
	});
	const steps = state.from(
		[props.data, series.of, props.value, props.pad, dates],
		() => stepsOf(props.data, series.of, props, dates),
	);
	const far = props.to;
	const to = far
		? state.to([far, props.series, props.value, props.pad, dates], () =>
				stepsOf(
					far,
					props.series === undefined
						? undefined
						: channelValues(far, props.series, undefined, "series", dates),
					props,
					dates,
				),
			)
		: undefined;
	const join = state.join({
		fromGroups: [...steps.keys()],
		toGroups: to ? [...to.keys()] : undefined,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
	});
	const extentOf = (side: Steps) => {
		const all = [...side.values()];
		return {
			x: { values: all.flatMap((step) => step.edges) },
			y: { values: all.flatMap((step) => step.values) },
		};
	};
	layer.report({
		...extentOf(steps),
		color: transitionColor(series.extent, join.toCategories),
		transition: layerTransition(join, props.staging, to ? extentOf(to) : {}),
	});
	return drawStepLines(state.lines, {
		props,
		theme: ctx.theme,
		frame,
		coords,
		steps,
		to,
		join,
		colorOf: groupColors(layer, series, join),
		progress: layer.progress(props.progress),
		alongX: props.reveal !== "length",
	});
}

/**
 * An empirical cumulative distribution function: a step function rising
 * from 0 to 1, jumping at each observed value. One curve per `series`.
 * Inside a `chart` or an `axes` with a y range like `[0, 1, 0.25]`. See
 * {@link ecdfSteps} for the steps alone.
 *
 * @example
 * ```ts
 * import { chart, ecdf } from "@sophistry/charts";
 *
 * const samples = [
 * 	{ group: "a", height: 162 },
 * 	{ group: "a", height: 171 },
 * 	{ group: "b", height: 175 },
 * 	{ group: "b", height: 183 },
 * ];
 * chart.create({
 * 	width: 8,
 * 	height: 4,
 * 	children: [ecdf.create({ data: samples, value: "height", series: "group" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#distributions
 * @category Charts
 */
export const ecdf = defineComposite<EcdfProps<AnyDatum>>({
	name: "Ecdf",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		pad: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		reveal: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		...stepLineStyleDescriptor,
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		states.set(ctx.node, {
			layer,
			series: createSeries<AnyDatum>(layer),
			join: createGroupJoin(),
			from: keyedMemo(),
			to: keyedMemo(),
			lines: createStepLines(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
