/**
 * A `chart`'s coordinate systems: the plot through its primary and
 * secondary axes, the ghost and end mappings of an axis changing kind, and
 * where the axes stand.
 *
 * {@link createChartCoords} is made once per chart; its function runs on
 * every update and returns the same coordinate system objects while their
 * mapping is unchanged (they are immutable, so a new one means the mapping
 * moved).
 */

import type {
	CoordinateSystem,
	XAxisPosition,
	YAxisPosition,
} from "@sophistry/core";
import {
	axisPositionValue,
	createCartesianCoords,
	crossingValue,
} from "@sophistry/core";
import type { Bounds, Point, Range } from "@sophistry/core/geometry";
import { mix } from "@sophistry/core/internal";
import type { JoinStages, StageWindow } from "../math/join";
import { keyedMemo, shallowEqual, stableValue } from "../util";
import type { AxisEnds, MergedAxisOptions, ResolvedAxis } from "./fit";
import { axisNow, sameOptionalPlacement } from "./fit";
import type { SecondaryFlags } from "./secondary";
import type { ChartEnd, ChartEnds } from "./types";

/** How one axis maps, for a coordinate system through it. */
interface Mapping {
	axis: ResolvedAxis;
	range: Range;
	clamp: boolean | undefined;
}

const scaleOf = (axis: ResolvedAxis) =>
	axis.kind === "continuous" ? axis.scale : undefined;
const baseOf = (axis: ResolvedAxis) =>
	axis.kind === "continuous" ? axis.base : undefined;
/** A kind's crossing on an axis: a band axis's first slot, a continuous one's zero (or nearest end). */
export const crossingOf = (axis: ResolvedAxis): number =>
	axis.kind === "band"
		? Math.min(axis.range[0], axis.range[1])
		: crossingValue(axis.range);

/** What one update of the chart's coordinates reads. */
export interface ChartCoordsInput {
	xOptions: MergedAxisOptions;
	yOptions: MergedAxisOptions;
	x: { axis: ResolvedAxis; range: Range };
	y: { axis: ResolvedAxis; range: Range };
	x2: { axis: ResolvedAxis; range: Range; options: MergedAxisOptions };
	y2: { axis: ResolvedAxis; range: Range; options: MergedAxisOptions };
	/** The primary axes' fitted ends (steady while the blend moves). */
	xEnds: AxisEnds | undefined;
	yEnds: AxisEnds | undefined;
	/** The other end of an axis changing kind mid-swap. */
	xGhost: ResolvedAxis | undefined;
	yGhost: ResolvedAxis | undefined;
	axisBands: { x: boolean; y: boolean };
	xPosition: XAxisPosition;
	yPosition: YAxisPosition;
	plotWidth: number;
	plotHeight: number;
	center: Point;
	stage(pick: (stages: JoinStages) => StageWindow): number;
}

/** A chart's coordinate systems on one update. */
export interface ChartCoords {
	/** The plot through the primary axes. */
	coords: CoordinateSystem;
	/** y through `y2`. */
	coords2: CoordinateSystem;
	/** x through `x2`. */
	coords3: CoordinateSystem;
	/** Both secondary axes. */
	coords4: CoordinateSystem;
	/** The plot through a kind-swapping x axis's ghost. */
	ghostX: CoordinateSystem;
	/** The plot through a kind-swapping y axis's ghost. */
	ghostY: CoordinateSystem;
	/** Where a kind-swapping axis's ghost stands across the other axis, in data units. */
	ghostAt(axis: "x" | "y", ghost: ResolvedAxis): number;
	/** Which fitted axes change kind across the keyed transition, if any. */
	kindSwap: { x: boolean; y: boolean } | undefined;
	/** The ends a context's layers see (see {@link ChartEnds}). */
	endsThrough(flags: SecondaryFlags): ChartEnds | undefined;
	/** The primary context's ends, with their mappings even when no axis swaps. */
	primaryEnds: { ends: ChartEnds | undefined; from: ChartEnd; to: ChartEnd };
	/** Mid-swap, where the axes stand at each end blended in scene units. */
	swapOrigin: (Point & { x2: boolean; y2: boolean }) | undefined;
	/** Where each axis is drawn, in data units. */
	axesAt: { x: number; y: number };
	/** The y value the x axis runs along. */
	xAxisAt: number;
	/** The x value the y axis stands at. */
	yAxisAt: number;
	/** Where the axes are drawn, in scene units. */
	origin: Point;
	/** Where the axes' titles hang from. */
	titlesAt: Point;
	area: Bounds;
}

/** A coordinate system with its crossing replaced. */
function withCrossing(
	system: CoordinateSystem,
	crossing: { x: number; y: number },
): CoordinateSystem {
	return Object.freeze({ ...system, crossing: () => ({ ...crossing }) });
}

const sameKindSwap = (
	a: { x: boolean; y: boolean } | undefined,
	b: { x: boolean; y: boolean } | undefined,
) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y);

/**
 * The chart's coordinate systems and where its axes stand. Make one per
 * chart in `setup`; call the result in every update.
 */
export function createChartCoords(): (input: ChartCoordsInput) => ChartCoords {
	/** A cache per system, so each keeps its identity while its mapping holds. */
	const system = () => {
		const memo = keyedMemo<CoordinateSystem>();
		return (
			x: Mapping,
			y: Mapping,
			plot: { width: number; height: number; center: Point },
			crossing: { x: number; y: number },
		): CoordinateSystem =>
			memo(
				[
					x.range[0],
					x.range[1],
					x.range[2],
					y.range[0],
					y.range[1],
					y.range[2],
					scaleOf(x.axis),
					scaleOf(y.axis),
					baseOf(x.axis),
					baseOf(y.axis),
					x.clamp,
					y.clamp,
					plot.width,
					plot.height,
					plot.center.x,
					plot.center.y,
					crossing.x,
					crossing.y,
				],
				() =>
					withCrossing(
						createCartesianCoords({
							xRange: x.range,
							yRange: y.range,
							width: plot.width,
							height: plot.height,
							center: plot.center,
							xScale: scaleOf(x.axis),
							yScale: scaleOf(y.axis),
							xBase: baseOf(x.axis),
							yBase: baseOf(y.axis),
							xClamp: x.clamp,
							yClamp: y.clamp,
						}),
						crossing,
					),
			);
	};
	const base = system();
	const base2 = system();
	const base3 = system();
	const base4 = system();
	const ghostXSystem = system();
	const ghostYSystem = system();
	const endSystems = {
		primaryFrom: system(),
		primaryTo: system(),
		x2From: system(),
		x2To: system(),
		y2From: system(),
		y2To: system(),
		bothFrom: system(),
		bothTo: system(),
	};
	const kindSwapStable = stableValue(sameKindSwap);
	const endAxis = {
		xFrom: stableValue<ResolvedAxis | undefined>(sameOptionalPlacement),
		xTo: stableValue<ResolvedAxis | undefined>(sameOptionalPlacement),
		yFrom: stableValue<ResolvedAxis | undefined>(sameOptionalPlacement),
		yTo: stableValue<ResolvedAxis | undefined>(sameOptionalPlacement),
	};
	const atStable = {
		from: stableValue<{ x: number; y: number }>(shallowEqual),
		to: stableValue<{ x: number; y: number }>(shallowEqual),
		axesAt: stableValue<{ x: number; y: number }>(shallowEqual),
	};
	const endStable = new Map<string, (end: ChartEnd) => ChartEnd>();
	const endsStable = new Map<
		string,
		(ends: ChartEnds | undefined) => ChartEnds | undefined
	>();
	const sameEnd = (a: ChartEnd, b: ChartEnd) =>
		a.coords === b.coords &&
		a.xBand === b.xBand &&
		a.yBand === b.yBand &&
		a.axesAt === b.axesAt;
	const sameChartEnds = (a: ChartEnds | undefined, b: ChartEnds | undefined) =>
		a === b ||
		(!!a &&
			!!b &&
			a.x === b.x &&
			a.y === b.y &&
			a.from === b.from &&
			a.to === b.to);
	const swapOriginStable = stableValue<
		(Point & { x2: boolean; y2: boolean }) | undefined
	>((a, b) => a === b || (!!a && !!b && shallowEqual(a, b)));
	const originStable = stableValue<Point>(shallowEqual);
	const titlesStable = stableValue<Point>(shallowEqual);
	const areaStable = stableValue<Bounds>(shallowEqual);

	return (input) => {
		const { xOptions, yOptions, axisBands, stage } = input;
		const plot = {
			width: input.plotWidth,
			height: input.plotHeight,
			center: input.center,
		};
		const throughX: Mapping = {
			axis: input.x.axis,
			range: input.x.range,
			clamp: input.x.axis.kind === "continuous" && xOptions.clamp,
		};
		const throughY: Mapping = {
			axis: input.y.axis,
			range: input.y.range,
			clamp: input.y.axis.kind === "continuous" && yOptions.clamp,
		};
		const throughX2: Mapping = {
			axis: input.x2.axis,
			range: input.x2.range,
			clamp: input.x2.options.clamp,
		};
		const throughY2: Mapping = {
			axis: input.y2.axis,
			range: input.y2.range,
			clamp: input.y2.options.clamp,
		};
		const xRange = input.x.range;
		const yRange = input.y.range;
		/**
		 * Where the axes cross, in data units: a continuous range at zero (or
		 * its nearest end), a band range at its first slot.
		 */
		const crossing = {
			x: axisBands.x ? Math.min(xRange[0], xRange[1]) : crossingValue(xRange),
			y: axisBands.y ? Math.min(yRange[0], yRange[1]) : crossingValue(yRange),
		};
		const coords = base(throughX, throughY, plot, crossing);
		// On a secondary axis, bars and areas stand on its own zero.
		const coords2 = base2(throughX, throughY2, plot, {
			x: crossing.x,
			y: crossingValue(input.y2.range),
		});
		const coords3 = base3(throughX2, throughY, plot, {
			x: crossingValue(input.x2.range),
			y: crossing.y,
		});
		const coords4 = base4(throughX2, throughY2, plot, {
			x: crossingValue(input.x2.range),
			y: crossingValue(input.y2.range),
		});

		/**
		 * The plot mapped through a kind-swapping axis's other end (its
		 * ghost), for drawing that end's axis and grid while the two
		 * cross-fade.
		 */
		const ghostAxisX = input.xGhost ?? input.x.axis;
		const ghostAxisY = input.yGhost ?? input.y.axis;
		const ghostXMapping: Mapping = {
			axis: ghostAxisX,
			range: ghostAxisX.range,
			clamp: false,
		};
		const ghostYMapping: Mapping = {
			axis: ghostAxisY,
			range: ghostAxisY.range,
			clamp: false,
		};
		const ghostX = ghostXSystem(ghostXMapping, throughY, plot, {
			x: crossingOf(ghostAxisX),
			y: crossing.y,
		});
		const ghostY = ghostYSystem(throughX, ghostYMapping, plot, {
			x: crossing.x,
			y: crossingOf(ghostAxisY),
		});
		const ghostAt = (axis: "x" | "y", ghost: ResolvedAxis): number => {
			const position =
				(axis === "x" ? xOptions.position : yOptions.position) ??
				(ghost.kind === "band" ? "edge" : "zero");
			const other = axis === "x" ? yRange : xRange;
			if (position !== "zero") return axisPositionValue(position, other);
			const otherBand = axis === "x" ? axisBands.y : axisBands.x;
			return otherBand ? Math.min(other[0], other[1]) : crossingValue(other);
		};

		/** Which fitted axes change kind across the keyed transition, if any. */
		const sx = !!input.xEnds && input.xEnds.from.kind !== input.xEnds.to.kind;
		const sy = !!input.yEnds && input.yEnds.from.kind !== input.yEnds.to.kind;
		const kindSwap = kindSwapStable(sx || sy ? { x: sx, y: sy } : undefined);

		/** One axis's mapping at one end of a swap: that end's fitted axis while the axis swaps, else the axis now. */
		const endMapping = (axis: "x" | "y", end: "from" | "to"): Mapping => {
			const options = axis === "x" ? xOptions : yOptions;
			const current = axis === "x" ? throughX : throughY;
			const swaps = axis === "x" ? kindSwap?.x : kindSwap?.y;
			const ends = axis === "x" ? input.xEnds : input.yEnds;
			const stable =
				endAxis[
					`${axis}${end === "from" ? "From" : "To"}` as keyof typeof endAxis
				];
			const own = stable(
				swaps && ends
					? axisNow(
							options,
							undefined,
							{ kind: "swap", ...ends, u: end === "from" ? 0 : 1 },
							[],
							axis === "y",
						)
					: undefined,
			);
			if (!own) return current;
			return {
				axis: own,
				range: own.range,
				clamp: own.kind === "continuous" && options.clamp,
			};
		};
		const xFrom = endMapping("x", "from");
		const xTo = endMapping("x", "to");
		const yFrom = endMapping("y", "from");
		const yTo = endMapping("y", "to");
		/**
		 * Where the axes stand through two mappings (one end of a kind swap),
		 * in data units: each axis's `position` against the other's range at
		 * this end, or its kind's default there.
		 */
		const axesThrough = (x: Mapping, y: Mapping) => {
			const xAt =
				xOptions.position ?? (x.axis.kind === "band" ? "edge" : "zero");
			const yAt =
				yOptions.position ?? (y.axis.kind === "band" ? "edge" : "zero");
			return {
				x:
					yAt === "zero"
						? crossingOf(x.axis)
						: axisPositionValue(yAt, x.axis.range),
				y:
					xAt === "zero"
						? crossingOf(y.axis)
						: axisPositionValue(xAt, y.axis.range),
			};
		};
		const fromAxesAt = atStable.from(axesThrough(xFrom, yFrom));
		const toAxesAt = atStable.to(axesThrough(xTo, yTo));
		/** The plot through two mappings: coordinates, band scales, and where the primary axes stand. */
		const endThrough = (
			name: keyof typeof endSystems,
			x: Mapping,
			y: Mapping,
			at: { x: number; y: number },
		): ChartEnd => {
			let stable = endStable.get(name);
			if (!stable) {
				stable = stableValue<ChartEnd>(sameEnd);
				endStable.set(name, stable);
			}
			return stable({
				coords: endSystems[name](x, y, plot, {
					x: crossingOf(x.axis),
					y: crossingOf(y.axis),
				}),
				xBand: x.axis.kind === "band" ? x.axis.band : undefined,
				yBand: y.axis.kind === "band" ? y.axis.band : undefined,
				axesAt: at,
			});
		};
		const endsCache = new Map<
			string,
			{ ends: ChartEnds | undefined; from: ChartEnd; to: ChartEnd }
		>();
		/**
		 * The ends a context's layers see (a secondary axis never swaps, so its
		 * own mapping at both); undefined unless an axis it maps through swaps.
		 */
		const endsWith = (flags: SecondaryFlags) => {
			const name = flags.x2
				? flags.y2
					? "both"
					: "x2"
				: flags.y2
					? "y2"
					: "primary";
			const cached = endsCache.get(name);
			if (cached) return cached;
			const from = endThrough(
				`${name}From` as keyof typeof endSystems,
				flags.x2 ? throughX2 : xFrom,
				flags.y2 ? throughY2 : yFrom,
				fromAxesAt,
			);
			const to = endThrough(
				`${name}To` as keyof typeof endSystems,
				flags.x2 ? throughX2 : xTo,
				flags.y2 ? throughY2 : yTo,
				toAxesAt,
			);
			const x = !!kindSwap?.x && !flags.x2;
			const y = !!kindSwap?.y && !flags.y2;
			let stable = endsStable.get(name);
			if (!stable) {
				stable = stableValue<ChartEnds | undefined>(sameChartEnds);
				endsStable.set(name, stable);
			}
			const ends = stable(x || y ? { x, y, from, to } : undefined);
			const value = { ends, from, to };
			endsCache.set(name, value);
			return value;
		};
		const primaryEnds = endsWith({ x2: false, y2: false });
		/** Where one end's axes stand, in scene units. */
		const endOrigin = (end: ChartEnd): Point =>
			end.coords.coordsToPoint(end.axesAt.x, end.axesAt.y);
		/**
		 * Mid-swap (the update stage running): where the axes stand at each
		 * end, blended in scene units, so an axis crossing the swapping one
		 * slides instead of jumping at the midpoint. Undefined otherwise.
		 */
		let swapOrigin: (Point & { x2: boolean; y2: boolean }) | undefined;
		if (kindSwap) {
			const u = stage((stages) => stages.update);
			if (u > 0 && u < 1) {
				const a = endOrigin(primaryEnds.from);
				const b = endOrigin(primaryEnds.to);
				swapOrigin = {
					x: mix(a.x, b.x, u),
					y: mix(a.y, b.y, u),
					x2: kindSwap.x,
					y2: kindSwap.y,
				};
			}
		}
		swapOrigin = swapOriginStable(swapOrigin);
		/**
		 * Where each axis is drawn, in data units: `x` the x value the y axis
		 * stands at, `y` the y value the x axis runs along. A continuous axis
		 * defaults to the crossing, a band axis to the low edge.
		 */
		const axesAt = atStable.axesAt({
			x:
				input.yPosition === "zero"
					? crossing.x
					: axisPositionValue(input.yPosition, xRange),
			y:
				input.xPosition === "zero"
					? crossing.y
					: axisPositionValue(input.xPosition, yRange),
		});
		const own = coords.coordsToPoint(axesAt.x, axesAt.y);
		const origin = originStable(
			swapOrigin
				? {
						x: swapOrigin.x2 ? swapOrigin.x : own.x,
						y: swapOrigin.y2 ? swapOrigin.y : own.y,
					}
				: own,
		);
		const titlesAt = titlesStable(
			swapOrigin ? { x: swapOrigin.x, y: swapOrigin.y } : own,
		);
		return {
			coords,
			coords2,
			coords3,
			coords4,
			ghostX,
			ghostY,
			ghostAt,
			kindSwap,
			endsThrough: (flags) => endsWith(flags).ends,
			primaryEnds,
			swapOrigin,
			axesAt,
			xAxisAt: axesAt.y,
			yAxisAt: axesAt.x,
			origin,
			titlesAt,
			area: areaStable(coords.area()),
		};
	};
}
