export type { AngleArcOptions } from "./arc.js";
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
} from "./arc.js";
export type { BandKey, BandScale, BandScaleOptions } from "./band.js";
export { bandScale, interpolateBandScale, slotBandScale } from "./band.js";
export { boundsOf, centerOf, pointOnBounds } from "./bounds.js";
export type { BraceOptions } from "./brace.js";
export { braceRings, braceSpan, braceTip } from "./brace.js";
export type { ClosedCurveKind, CurveKind } from "./curves.js";
export {
	areaCurvePath,
	clipClosedCurvePathToX,
	clipCurvePathToX,
	closedCurvePath,
	curvePath,
	reverseCurvePath,
} from "./curves.js";
export type { StreamlineOptions, VectorFn } from "./field.js";
export {
	fieldJitter,
	rk4Step,
	streamline,
	streamlineBothWays,
} from "./field.js";
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
} from "./graph-layout.js";
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
} from "./graph-layout.js";
export type { ImplicitCurveOptions, ImplicitCurvePiece } from "./implicit.js";
export { implicitCurve } from "./implicit.js";
export { lerpPoint } from "./lerp.js";
// `lerpPoint` is exported from `./lerp` (its canonical home — see that
// file's module doc) rather than from `./morph`, even though `./morph` also
// re-exports it (from `../tween/interpolate`, for its own historical
// reasons — see that file's module doc). Same function either way; this is
// just which import path this barrel prefers.
export type { MorphInterpolator, RingsInterpolator } from "./morph.js";
export {
	morphCurvePaths,
	morphPathData,
	morphPolylines,
	morphRings,
} from "./morph.js";
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
} from "./num.js";
export type { ArcTable, CurveArcTable } from "./path/arclength.js";
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
} from "./path/arclength.js";
export {
	arcCubics,
	cubicArcLength,
	flattenCubicPolyline,
	lineSegment,
	quadraticToCubic,
	splitCubicAt,
} from "./path/cubic.js";
export {
	closePolyline,
	curvePathToPolyline,
	flattenPath,
	parsePathData,
	pathDataToCurvePath,
	polylineToCurvePath,
	toPathData,
} from "./path/svg-path.js";
export type {
	Bounds,
	CurvePath,
	CurveSegment,
	Point,
	Polyline,
	Subpath,
} from "./path/types.js";
export type { Resolver } from "./resolver.js";
export { createResolver } from "./resolver.js";
export type { CornerRadii, CornerRadius } from "./rounded-rect.js";
export {
	resolveCornerRadii,
	roundedRectCurvePath,
} from "./rounded-rect.js";
export type {
	RangeTransition,
	WeightedTick,
} from "./scale/range-transition.js";
export {
	currentRange,
	interpolateRange,
	isRangeTransition,
	spacedTicks,
	transitionTicks,
} from "./scale/range-transition.js";
export type {
	DivergingKind,
	DivergingScaleOptions,
	Range,
	Scale,
	ScaleName,
	ScaleSpec,
	ScaleTicks,
	TimeScaleOptions,
} from "./scale/scales.js";
export {
	divergingScale,
	linearScale,
	logScale,
	powScale,
	resolveScale,
	sqrtScale,
	symlogScale,
	timeScale,
} from "./scale/scales.js";
export type {
	TickFormatContext,
	TickFormatter,
	TickFormatterName,
	TickFormatterSpec,
} from "./scale/tick-format.js";
export {
	formatSpecifier,
	formatTick,
	resolveTickFormatter,
	tickFormatters,
} from "./scale/tick-format.js";
export type {
	AxisTickOptions,
	LogTickOptions,
	TickOptions,
} from "./scale/ticks.js";
export {
	axisTicks,
	logTicks,
	niceStep,
	thinTickLabels,
	tickStep,
	tickValues,
} from "./scale/ticks.js";
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
} from "./shapes.js";
export type {
	TemporalInstantLike,
	TemporalPlainDateLike,
	TemporalPlainDateTimeLike,
	TemporalValue,
	TimeValue,
	TimeZone,
} from "./time.js";
export {
	fromWallTime,
	timeZoneOffset,
	toEpochMs,
	toWallTime,
} from "./time.js";
export type { TipGeometry, TipShape } from "./tips.js";
export { tipIsClosed, tipPolylines } from "./tips.js";
export type { Matrix } from "./transform.js";
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
} from "./transform.js";
