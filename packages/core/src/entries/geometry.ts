/**
 * `@sophistry/core/geometry`: the pure geometry toolkit behind the primitives
 * (paths, arcs, shape polylines, transforms, morphing, scales and ticks, time
 * zones, fields, implicit curves, graph layouts). Plain functions of plain data,
 * in scene units with y up.
 *
 * @example
 * ```ts
 * import { circlePolyline, compose, rotate, translate } from "@sophistry/core/geometry";
 *
 * const ring = circlePolyline(0, 0, 2);
 * const turned = compose(translate(1, 0), rotate(Math.PI / 4));
 * ```
 *
 * @module @sophistry/core/geometry
 * @packageDocumentation
 */

export type { AngleArcOptions } from "../geometry/arc.js";
export {
	angleArcCurvePath,
	angleArcPolyline,
	annularSectorCurvePath,
	annularSectorPolyline,
	annulusCurvePaths,
	annulusPolylines,
	arcBetweenPoints,
	arcBetweenPointsCurvePath,
	arcCurvePath,
	cubicBezierPolyline,
	elbowPolyline,
	ellipseCurvePath,
	polygramPolyline,
	quadraticBezierPolyline,
	rightAngleMarkPolyline,
	sectorCurvePath,
	sectorPolyline,
	segmentsForArc,
	starInnerRadius,
	starPolygon,
} from "../geometry/arc.js";
export type { BandKey, BandScale, BandScaleOptions } from "../geometry/band.js";
export {
	bandScale,
	interpolateBandScale,
	slotBandScale,
} from "../geometry/band.js";
export { boundsOf, centerOf, pointOnBounds } from "../geometry/bounds.js";
export type { BraceOptions } from "../geometry/brace.js";
export { braceRings, braceSpan, braceTip } from "../geometry/brace.js";
export type { ClosedCurveKind, CurveKind } from "../geometry/curves.js";
export {
	areaCurvePath,
	clipClosedCurvePathToX,
	clipCurvePathToX,
	closedCurvePath,
	curvePath,
	reverseCurvePath,
} from "../geometry/curves.js";
export type { StreamlineOptions, VectorFn } from "../geometry/field.js";
export {
	fieldJitter,
	rk4Step,
	streamline,
	streamlineBothWays,
} from "../geometry/field.js";
export type {
	GraphData,
	GraphDirection,
	GraphEdge,
	GraphExtent,
	GraphLayout,
	GraphLayoutName,
	GraphLayoutOptions,
	GraphLayoutSpec,
	VertexId,
} from "../geometry/graph-layout.js";
export {
	circularLayout,
	edgeKey,
	explicitLayout,
	graphLayouts,
	gridLayout,
	partiteLayout,
	pathEdges,
	resolveGraphLayout,
	shellLayout,
	springGrowth,
	springLayout,
	springTrajectory,
	treeLayout,
} from "../geometry/graph-layout.js";
export type {
	ImplicitCurveOptions,
	ImplicitCurvePiece,
} from "../geometry/implicit.js";
export { implicitCurve } from "../geometry/implicit.js";
export type { PointPath } from "../geometry/lerp.js";
export {
	clamp,
	lerp,
	lerpPoint,
	lerpPoint3,
	pathAlongArc,
	progressIn,
	remap,
} from "../geometry/lerp.js";
export type {
	Correspondence,
	MorphInterpolator,
	RingsInterpolator,
} from "../geometry/morph.js";
export {
	morphCurvePaths,
	morphPathData,
	morphPolylines,
	morphRings,
} from "../geometry/morph.js";
export type { ArcTable, CurveArcTable } from "../geometry/path/arclength.js";
export {
	measure,
	measureCurve,
	normalAtT,
	pointAtT,
	resample,
	revealedPolylines,
	sliceAtT,
	sliceBetween,
	sliceCurveAtT,
	sliceCurveBetween,
	tangentAtT,
} from "../geometry/path/arclength.js";
export {
	arcCubics,
	cubicArcLength,
	flattenCubicPolyline,
	lineSegment,
	quadraticToCubic,
	splitCubicAt,
} from "../geometry/path/cubic.js";
export type { PathSegment } from "../geometry/path/svg-path.js";
export {
	closePolyline,
	curvePathToPolyline,
	flattenPath,
	parsePathData,
	pathDataToCurvePath,
	polylineToCurvePath,
	toPathData,
} from "../geometry/path/svg-path.js";
export type {
	Bounds,
	CurvePath,
	CurveSegment,
	Point,
	Polyline,
	Subpath,
} from "../geometry/path/types.js";
export type {
	RangeTransition,
	WeightedTick,
} from "../geometry/scale/range-transition.js";
export {
	currentRange,
	interpolateRange,
	isRangeTransition,
	spacedTicks,
	transitionTicks,
} from "../geometry/scale/range-transition.js";
export type {
	DivergingKind,
	DivergingScaleOptions,
	Range,
	Scale,
	ScaleName,
	ScaleSpec,
	ScaleTicks,
	TimeScaleOptions,
} from "../geometry/scale/scales.js";
export {
	divergingScale,
	linearScale,
	logScale,
	powScale,
	resolveScale,
	sqrtScale,
	symlogScale,
	timeScale,
} from "../geometry/scale/scales.js";
export type {
	TickFormatContext,
	TickFormatter,
	TickFormatterName,
	TickFormatterSpec,
} from "../geometry/scale/tick-format.js";
export {
	formatSpecifier,
	formatTick,
	resolveTickFormatter,
	tickFormatters,
} from "../geometry/scale/tick-format.js";
export type {
	AxisTickOptions,
	LogTickOptions,
	TickOptions,
} from "../geometry/scale/ticks.js";
export {
	axisTicks,
	logTicks,
	niceStep,
	thinTickLabels,
	tickStep,
	tickValues,
} from "../geometry/scale/ticks.js";
export type {
	MatchedShapePart,
	MatchShapesOptions,
	ShapeMatch,
	ShapePart,
	ShapeTransform,
} from "../geometry/shape-match.js";
export {
	matchShapesByPointCloud,
	morphShapes,
} from "../geometry/shape-match.js";
export {
	arcPolyline,
	arrowHead,
	arrowHeadAt,
	circlePolyline,
	ellipsePolyline,
	linePolyline,
	plotPolyline,
	rectPolyline,
	regularPolygon,
	segmentsForRadius,
} from "../geometry/shapes.js";
export type {
	TemporalInstantLike,
	TemporalPlainDateLike,
	TemporalPlainDateTimeLike,
	TemporalValue,
	TimeValue,
	TimeZone,
} from "../geometry/time.js";
export {
	fromWallTime,
	timeZoneOffset,
	toEpochMs,
	toWallTime,
} from "../geometry/time.js";
export type { TipGeometry, TipShape } from "../geometry/tips.js";
export { tipIsClosed, tipPolylines } from "../geometry/tips.js";
export type { Matrix } from "../geometry/transform.js";
export {
	about,
	applyToPoint,
	applyToPolyline,
	columnsOf,
	compose,
	determinant,
	fromColumns,
	fromTranslationRotationScale,
	IDENTITY,
	invert,
	lerpMatrix,
	linearMap,
	rotate,
	scale,
	scaleFactorOf,
	translate,
} from "../geometry/transform.js";
