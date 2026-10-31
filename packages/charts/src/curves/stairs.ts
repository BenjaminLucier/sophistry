/**
 * `stairs`: a step function held flat across each `[edges[i], edges[i + 1]]`
 * interval, one open line per `series`, drawn as one path batch. Also the
 * step-line drawing `ecdf` shares ({@link stepLineItems}): lines kept by
 * group, coloured by the series scale unless `stroke` is set, revealed along
 * x behind one front (or by arc length), and morphed as step functions
 * across a keyed transition.
 */

import type {
	CompositeContext,
	CoordinateSystem,
	PaintSpec,
	PathBatchItem,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { polylineToCurvePath } from "@sophistry/core/geometry";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { Channel, DateSink } from "../data/channels";
import {
	channelValues,
	dateSinkContext,
	identity,
	numberValues,
} from "../data/channels";
import type { Mapper } from "../end-space";
import { endSpace } from "../end-space";
import type { ChartFrame } from "../frame/types";
import type { GroupJoin } from "../join";
import {
	createGroupJoin,
	layerTransition,
	sweepIn,
	transitionColor,
} from "../join";
import type { StepFunction } from "../math/morph";
import { morphSteps } from "../math/morph";
import { clipPolylineToX, revealCutoff, xExtent } from "../math/reveal";
import { stairsPolyline } from "../math/stairs";
import type { AnyDatum, CurveReveal, SeriesTransitionProps } from "../props";
import type { Category, GroupKey } from "../series";
import { createSeries, groupIndices, WHOLE } from "../series";
import { keyedMemo } from "../util";
import type { CurveBatch } from "./shared";
import { createCurveBatch, groupColors } from "./shared";

/**
 * The stroke props every step line takes (`stairs`, `ecdf`).
 *
 * @category Charts
 */
export interface StepLineStyleProps {
	/** Line colour (or gradient) for every line. Defaults to the `series` colour, else the theme's foreground. */
	stroke?: PaintSpec;
	/** Line width. Defaults to the theme's stroke width. */
	strokeWidth?: number;
	/** Dash pattern, in scene units. Solid when omitted. */
	dash?: number[];
	/** Offset into `dash`. @default 0 */
	dashOffset?: number;
	/** How line ends are capped. @default "round" */
	lineCap?: CanvasLineCap;
	/** How corners are joined. @default "round" */
	lineJoin?: CanvasLineJoin;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Reveal 0..1 (see `reveal`). @default 1 */
	progress?: number;
	/** Paint order. */
	zIndex?: number;
	/** Set to false to hide the lines. */
	visible?: boolean;
}

/**
 * Props of {@link stairs}: `value` defaults to the datum when `data` is
 * `number[]`; name it otherwise.
 *
 * @category Charts
 */
export interface StairsProps<T = unknown>
	extends SeriesTransitionProps<T>,
		StepLineStyleProps {
	/** One step per datum. */
	data: readonly T[];
	/**
	 * Height of each step, in data units, held across `[edges[i], edges[i + 1]]`. Defaults to the
	 * datum when `data` is `number[]`; required otherwise.
	 */
	value?: Channel<T, number>;
	/**
	 * Step boundaries in data units, ascending, exactly one more than `data` (else throws). With a
	 * `series`, shared by every category. Defaults to `0..data.length`.
	 */
	edges?: readonly number[];
	/**
	 * The category of each datum: one step line per category, coloured through the chart's shared
	 * colour scale and legend. `stroke` wins.
	 */
	series?: Channel<T, BandKey>;
	/**
	 * How `progress` reveals the steps: `"x"` left to right at a constant rate, or `"length"` by
	 * arc length.
	 * @default "x"
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	reveal?: CurveReveal;
	/**
	 * The data to transition to, lines matched by `series`: shared lines morph and stay step
	 * functions every frame, new ones sweep in, leaving ones fade out. See {@link
	 * SeriesTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
}

/** The descriptor entries of {@link StepLineStyleProps}. */
export const stepLineStyleDescriptor = {
	stroke: { invalidates: Invalidate.UPDATE },
	strokeWidth: { invalidates: Invalidate.UPDATE },
	dash: { invalidates: Invalidate.UPDATE },
	dashOffset: { invalidates: Invalidate.UPDATE },
	lineCap: { invalidates: Invalidate.UPDATE },
	lineJoin: { invalidates: Invalidate.UPDATE },
	opacity: { invalidates: Invalidate.UPDATE },
	progress: { default: 1, invalidates: Invalidate.UPDATE },
	zIndex: { invalidates: Invalidate.UPDATE },
	visible: { invalidates: Invalidate.UPDATE },
} as const;

/**
 * A step function through `coords`, read left to right (a reversed x axis flips the edges), so it
 * still morphs as a step function.
 */
function sceneSteps(step: StepFunction, coords: Mapper): StepFunction {
	const edges = step.edges.map((x) => coords.coordsToPoint(x, 0).x);
	const values = step.values.map((y) => coords.coordsToPoint(0, y).y);
	return (edges[0] as number) > (edges[edges.length - 1] as number)
		? { edges: edges.reverse(), values: values.reverse() }
		: { edges, values };
}

/** What a step-line drawing keeps between updates. */
export interface StepLines {
	scene: (
		deps: readonly unknown[],
		make: () => Map<GroupKey, Point[][]>,
	) => Map<GroupKey, Point[][]>;
	lines: CurveBatch;
}

/** Makes a {@link StepLines}. Call once, in `setup`. */
export function createStepLines(): StepLines {
	return { scene: keyedMemo(), lines: createCurveBatch() };
}

/**
 * Draws one step line per group (what `stairs` and `ecdf` share): each
 * group's line in scene units on this frame (morphed as a step function on
 * the update stage, entering ones swept in, leaving ones faded), cut at one
 * front along x (or by arc length), as path batch items.
 *
 * @internal
 */
export function drawStepLines(
	own: StepLines,
	spec: {
		props: StepLineStyleProps;
		theme: { palette: { foreground: string } };
		frame: ChartFrame | null;
		coords: CoordinateSystem;
		/** `data`'s step functions, per group. */
		steps: Map<GroupKey, StepFunction>;
		/** `to`'s, while a transition runs. */
		to: Map<GroupKey, StepFunction> | undefined;
		join: GroupJoin;
		colorOf: (key: GroupKey) => string | undefined;
		progress: number | undefined;
		alongX: boolean;
	},
): SceneNode[] {
	const { coords, join, props } = spec;
	const space = endSpace(spec.frame, coords);
	const project = (step: StepFunction, system: Mapper = coords): Point[] =>
		stairsPolyline(step.values, step.edges).map((at) =>
			system.coordsToPoint(at.x, at.y),
		);
	/** Each group's line on this frame, in scene units, as pieces. */
	const scene = own.scene(
		[
			spec.steps,
			spec.to,
			coords,
			spec.frame?.ends,
			spec.frame?.join,
			join.active ? join.t : -1,
		],
		() => {
			const out = new Map<GroupKey, Point[][]>();
			const far = spec.to;
			if (!far) {
				for (const [key, step] of spec.steps) out.set(key, [project(step)]);
				return out;
			}
			for (const key of join.groups) {
				const a = spec.steps.get(key);
				const b = far.get(key);
				if (a && b)
					out.set(key, [
						space.morph(a, b, join.update, {
							scene: sceneSteps,
							morph: morphSteps,
							build: project,
						}),
					]);
				else if (a) out.set(key, [project(a, space.coords("from"))]);
				else if (b)
					out.set(
						key,
						sweepIn(
							{ lines: [project(b, space.coords("to"))], rings: [] },
							join.enterOf(key as BandKey),
						).lines,
					);
			}
			return out;
		},
	);
	/** Where the reveal's cut stands, in scene x: one front for every line. */
	let cutoff: number | null | undefined;
	const reveal = spec.progress ?? 1;
	if (!spec.alongX || reveal >= 1) cutoff = undefined;
	else if (!(reveal > 0)) cutoff = null;
	else {
		const extent = xExtent([...scene.values()].flat());
		cutoff = extent ? revealCutoff(reveal, extent) : null;
	}
	const items: [GroupKey, PathBatchItem][] = [];
	if (cutoff !== null) {
		for (const key of join.groups) {
			const fade = join.fade(key);
			if (!(fade > 0)) continue;
			const pieces = scene.get(key) ?? [];
			const shown =
				cutoff === undefined
					? pieces
					: pieces.flatMap((piece) => clipPolylineToX(piece, cutoff));
			if (shown.length === 0) continue;
			const curvePaths = shown.map((piece) =>
				polylineToCurvePath(piece, false),
			);
			/** Drawn by arc length: the whole steps, traced to `reveal` of their length. */
			const traced = !spec.alongX && reveal < 1 ? reveal : 1;
			const color =
				props.stroke === undefined && key !== WHOLE
					? spec.colorOf(key)
					: undefined;
			items.push([
				key,
				{
					closed: false,
					curvePaths,
					...(traced < 1 ? { progress: traced } : {}),
					...(color !== undefined ? { stroke: color } : {}),
					...(fade < 1 ? { opacity: fade } : {}),
				},
			]);
		}
	}
	own.lines.update(items, {
		stroke: props.stroke ?? spec.theme.palette.foreground,
		strokeWidth: props.strokeWidth,
		dash: props.dash,
		dashOffset: props.dashOffset,
		lineCap: props.lineCap,
		lineJoin: props.lineJoin,
		opacity: props.opacity,
		zIndex: props.zIndex,
		visible: props.visible,
	});
	return [own.lines.node];
}

/** One dataset's step functions, one per group, in data units. */
interface StairsSide {
	values: number[];
	steps: Map<GroupKey, StepFunction>;
	longest: number;
}

function sideOf(
	data: readonly unknown[],
	of: readonly Category[] | undefined,
	props: StairsProps<AnyDatum>,
	dates: DateSink | null,
): StairsSide {
	const values = numberValues(
		data,
		props.value as Channel<unknown, number>,
		identity,
		"value",
		dates,
	);
	const steps = new Map<GroupKey, StepFunction>();
	let longest = 0;
	for (const [key, indices] of groupIndices(data.length, of)) {
		longest = Math.max(longest, indices.length);
		steps.set(key, {
			values: indices.map((i) => values[i] as number),
			edges:
				(props.edges as number[] | undefined) ??
				Array.from({ length: indices.length + 1 }, (_, i) => i),
		});
	}
	return { values, steps, longest };
}

/** What a stairs keeps between updates. */
interface StairsState {
	layer: ChartLayer;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	join: ReturnType<typeof createGroupJoin>;
	from: (deps: readonly unknown[], make: () => StairsSide) => StairsSide;
	to: (deps: readonly unknown[], make: () => StairsSide) => StairsSide;
	lines: StepLines;
}

const states = new WeakMap<object, StairsState>();

function draw(ctx: CompositeContext<StairsProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as StairsState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords) throw new Error("Stairs must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.stroke !== undefined,
		mark: { line: true },
		dates,
	});
	const from = state.from(
		[props.data, series.of, props.value, props.edges, dates],
		() => sideOf(props.data, series.of, props, dates),
	);
	const far = props.to;
	const to = far
		? state.to([far, props.series, props.value, props.edges, dates], () =>
				sideOf(
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
		fromGroups: [...from.steps.keys()],
		toGroups: to ? [...to.steps.keys()] : undefined,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
	});
	const extentOf = (side: StairsSide) => ({
		x: { values: (props.edges as number[] | undefined) ?? [0, side.longest] },
		y: { values: side.values },
	});
	layer.report({
		...extentOf(from),
		color: transitionColor(series.extent, join.toCategories),
		transition: layerTransition(join, props.staging, to ? extentOf(to) : {}),
	});
	return drawStepLines(state.lines, {
		props,
		theme: ctx.theme,
		frame,
		coords,
		steps: from.steps,
		to: to?.steps,
		join,
		colorOf: groupColors(layer, series, join),
		progress: layer.progress(props.progress),
		alongX: props.reveal !== "length",
	});
}

/**
 * A step function held flat across each `[edges[i], edges[i + 1]]` interval,
 * drawn as one open line: a histogram's outline without the fill. Inside a
 * `chart` or `axes`. See {@link stairsPolyline} for the geometry alone.
 *
 * @example
 * ```ts
 * import { chart, stairs } from "@sophistry/charts";
 *
 * chart.create({
 * 	width: 8,
 * 	height: 4,
 * 	children: [stairs.create({ data: [3, 5, 2, 6], edges: [0, 1, 2, 4, 5] })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#histograms
 * @category Charts
 */
export const stairs = defineComposite<StairsProps<AnyDatum>>({
	name: "Stairs",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		edges: { invalidates: Invalidate.UPDATE },
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
