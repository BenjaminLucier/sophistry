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

export type { AngleArcOptions } from "../geometry/arc";
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
} from "../geometry/arc";
export type { BandKey, BandScale, BandScaleOptions } from "../geometry/band";
export {
	bandScale,
	interpolateBandScale,
	slotBandScale,
} from "../geometry/band";
export { boundsOf, centerOf, pointOnBounds } from "../geometry/bounds";
export type { BraceOptions } from "../geometry/brace";
export { braceRings, braceSpan, braceTip } from "../geometry/brace";
export type { ClosedCurveKind, CurveKind } from "../geometry/curves";
export {
	areaCurvePath,
	clipClosedCurvePathToX,
	clipCurvePathToX,
	closedCurvePath,
	curvePath,
	reverseCurvePath,
} from "../geometry/curves";
export type { StreamlineOptions, VectorFn } from "../geometry/field";
export {
	fieldJitter,
	rk4Step,
	streamline,
	streamlineBothWays,
} from "../geometry/field";
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
} from "../geometry/graph-layout";
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
} from "../geometry/graph-layout";
export type {
	ImplicitCurveOptions,
	ImplicitCurvePiece,
} from "../geometry/implicit";
export { implicitCurve } from "../geometry/implicit";
export type { PointPath } from "../geometry/lerp";
export {
	clamp,
	lerp,
	lerpPoint,
	lerpPoint3,
	pathAlongArc,
	progressIn,
	remap,
} from "../geometry/lerp";
export type {
	Correspondence,
	MorphInterpolator,
	RingsInterpolator,
} from "../geometry/morph";
export {
	morphCurvePaths,
	morphPathData,
	morphPolylines,
	morphRings,
} from "../geometry/morph";
export type { ArcTable, CurveArcTable } from "../geometry/path/arclength";
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
} from "../geometry/path/arclength";
export {
	arcCubics,
	cubicArcLength,
	flattenCubicPolyline,
	lineSegment,
	quadraticToCubic,
	splitCubicAt,
} from "../geometry/path/cubic";
export type { PathSegment } from "../geometry/path/svg-path";
export {
	closePolyline,
	curvePathToPolyline,
	flattenPath,
	parsePathData,
	pathDataToCurvePath,
	polylineToCurvePath,
	toPathData,
} from "../geometry/path/svg-path";
export type {
	Bounds,
	CurvePath,
	CurveSegment,
	Point,
	Polyline,
	Subpath,
} from "../geometry/path/types";
export type {
	RangeTransition,
	WeightedTick,
} from "../geometry/scale/range-transition";
export {
	currentRange,
	interpolateRange,
	isRangeTransition,
	spacedTicks,
	transitionTicks,
} from "../geometry/scale/range-transition";
export type {
	DivergingKind,
	DivergingScaleOptions,
	Range,
	Scale,
	ScaleName,
	ScaleSpec,
	ScaleTicks,
	TimeScaleOptions,
} from "../geometry/scale/scales";
export {
	divergingScale,
	linearScale,
	logScale,
	powScale,
	resolveScale,
	sqrtScale,
	symlogScale,
	timeScale,
} from "../geometry/scale/scales";
export type {
	TickFormatContext,
	TickFormatter,
	TickFormatterName,
	TickFormatterSpec,
} from "../geometry/scale/tick-format";
export {
	formatSpecifier,
	formatTick,
	resolveTickFormatter,
	tickFormatters,
} from "../geometry/scale/tick-format";
export type {
	AxisTickOptions,
	LogTickOptions,
	TickOptions,
} from "../geometry/scale/ticks";
export {
	axisTicks,
	logTicks,
	niceStep,
	thinTickLabels,
	tickStep,
	tickValues,
} from "../geometry/scale/ticks";
export type {
	MatchedShapePart,
	MatchShapesOptions,
	ShapeMatch,
	ShapePart,
	ShapeTransform,
} from "../geometry/shape-match";
export { matchShapesByPointCloud, morphShapes } from "../geometry/shape-match";
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
} from "../geometry/shapes";
export type {
	TemporalInstantLike,
	TemporalPlainDateLike,
	TemporalPlainDateTimeLike,
	TemporalValue,
	TimeValue,
	TimeZone,
} from "../geometry/time";
export {
	fromWallTime,
	timeZoneOffset,
	toEpochMs,
	toWallTime,
} from "../geometry/time";
export type { TipGeometry, TipShape } from "../geometry/tips";
export { tipIsClosed, tipPolylines } from "../geometry/tips";
export type { Matrix } from "../geometry/transform";
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
} from "../geometry/transform";
