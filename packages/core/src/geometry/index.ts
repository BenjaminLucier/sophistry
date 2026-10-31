export type { AngleArcOptions } from "./arc";
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
} from "./arc";
export type { BandKey, BandScale, BandScaleOptions } from "./band";
export { bandScale, interpolateBandScale, slotBandScale } from "./band";
export { boundsOf, centerOf, pointOnBounds } from "./bounds";
export type { BraceOptions } from "./brace";
export { braceRings, braceSpan, braceTip } from "./brace";
export type { ClosedCurveKind, CurveKind } from "./curves";
export {
	areaCurvePath,
	clipClosedCurvePathToX,
	clipCurvePathToX,
	closedCurvePath,
	curvePath,
	reverseCurvePath,
} from "./curves";
export type { StreamlineOptions, VectorFn } from "./field";
export {
	fieldJitter,
	rk4Step,
	streamline,
	streamlineBothWays,
} from "./field";
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
} from "./graph-layout";
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
} from "./graph-layout";
export type { ImplicitCurveOptions, ImplicitCurvePiece } from "./implicit";
export { implicitCurve } from "./implicit";
export { lerpPoint } from "./lerp";
// `lerpPoint` is exported from `./lerp` (its canonical home — see that
// file's module doc) rather than from `./morph`, even though `./morph` also
// re-exports it (from `../tween/interpolate`, for its own historical
// reasons — see that file's module doc). Same function either way; this is
// just which import path this barrel prefers.
export type { MorphInterpolator, RingsInterpolator } from "./morph";
export {
	morphCurvePaths,
	morphPathData,
	morphPolylines,
	morphRings,
} from "./morph";
export {
	clamp01,
	clampNonNegative,
	finiteExtent,
	finiteOrZero,
	finiteValues,
	hashUnit,
	isFinitePoint,
	linspace,
	maxOf,
	minOf,
	mix,
	mixPoint,
	polarPoint,
	TAU,
	wrapAngle,
} from "./num";
export type { ArcTable, CurveArcTable } from "./path/arclength";
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
} from "./path/arclength";
export {
	arcCubics,
	cubicArcLength,
	flattenCubicPolyline,
	lineSegment,
	quadraticToCubic,
	splitCubicAt,
} from "./path/cubic";
export {
	closePolyline,
	curvePathToPolyline,
	flattenPath,
	parsePathData,
	pathDataToCurvePath,
	polylineToCurvePath,
	toPathData,
} from "./path/svg-path";
export type {
	Bounds,
	CurvePath,
	CurveSegment,
	Point,
	Polyline,
	Subpath,
} from "./path/types";
export type { Resolver } from "./resolver";
export { createResolver } from "./resolver";
export type { RangeTransition, WeightedTick } from "./scale/range-transition";
export {
	currentRange,
	interpolateRange,
	isRangeTransition,
	spacedTicks,
	transitionTicks,
} from "./scale/range-transition";
export type {
	DivergingKind,
	DivergingScaleOptions,
	Range,
	Scale,
	ScaleName,
	ScaleSpec,
	ScaleTicks,
	TimeScaleOptions,
} from "./scale/scales";
export {
	divergingScale,
	linearScale,
	logScale,
	powScale,
	resolveScale,
	sqrtScale,
	symlogScale,
	timeScale,
} from "./scale/scales";
export type {
	TickFormatContext,
	TickFormatter,
	TickFormatterName,
	TickFormatterSpec,
} from "./scale/tick-format";
export {
	formatSpecifier,
	formatTick,
	resolveTickFormatter,
	tickFormatters,
} from "./scale/tick-format";
export type {
	AxisTickOptions,
	LogTickOptions,
	TickOptions,
} from "./scale/ticks";
export {
	axisTicks,
	logTicks,
	niceStep,
	thinTickLabels,
	tickStep,
	tickValues,
} from "./scale/ticks";
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
} from "./shapes";
export type {
	TemporalInstantLike,
	TemporalPlainDateLike,
	TemporalPlainDateTimeLike,
	TemporalValue,
	TimeValue,
	TimeZone,
} from "./time";
export {
	fromWallTime,
	timeZoneOffset,
	toEpochMs,
	toWallTime,
} from "./time";
export type { TipGeometry, TipShape } from "./tips";
export { tipIsClosed, tipPolylines } from "./tips";
export type { Matrix } from "./transform";
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
} from "./transform";
