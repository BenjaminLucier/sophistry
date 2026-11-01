/**
 * coords: coordinate systems (axes, planes, number lines) and the context
 * they publish.
 */

export type { AxesProps, AxisOptions } from "./axes.js";
export { axes } from "./axes.js";
export type {
	Complex,
	ComplexCoordinateSystem,
	ComplexPlaneProps,
} from "./complex-plane.js";
export {
	complexCoordsOf,
	complexPlane,
	imaginaryTick,
} from "./complex-plane.js";
export type {
	AxisPosition,
	CartesianOptions,
	CoordinateSystem,
	XAxisPosition,
	YAxisPosition,
} from "./coords.js";
export {
	axisPositionValue,
	coordsContext,
	coordsOf,
	coordsReadable,
	createCartesianCoords,
	createPhases,
	crossingValue,
	phaseProgress,
	publishCoords,
	requireCoords,
	UNDER_AXES_Z_INDEX,
} from "./coords.js";
export type {
	CurveSampling,
	FunctionGraphHandle,
	FunctionGraphProps,
	ParametricGraphProps,
	PolarGraphProps,
} from "./function-graph.js";
export {
	functionGraph,
	graphHandle,
	parametricGraph,
	polarGraph,
	sampleRuns,
} from "./function-graph.js";
export type {
	AreaUnderGraphProps,
	LineToGraphProps,
	RiemannRectanglesProps,
	SecantSlopeGroupProps,
	TangentToGraphProps,
} from "./graph-annotations.js";
export {
	angleOfTangent,
	areaUnderGraph,
	horizontalLineToGraph,
	inputToGraphPoint,
	riemannRectangles,
	secantSlopeGroup,
	slopeOfSecant,
	tangentToGraph,
	verticalLineToGraph,
} from "./graph-annotations.js";
export type { ImplicitFunctionProps } from "./implicit-function.js";
export { implicitFunction } from "./implicit-function.js";
export type {
	BasisVectorsProps,
	LinearTransformProps,
} from "./linear-transform.js";
export {
	basisVectors,
	LinearTransformNode,
	linearTransform,
	transformDeterminant,
} from "./linear-transform.js";
export type { NumberLineProps, UnitIntervalProps } from "./number-line.js";
export { numberLine, unitInterval } from "./number-line.js";
export type { NumberPlaneProps } from "./number-plane.js";
export { numberPlane } from "./number-plane.js";
export type {
	AzimuthUnits,
	PolarCoordinateSystem,
	PolarPlaneProps,
} from "./polar-plane.js";
export { piMultipleLabel, polarCoordsOf, polarPlane } from "./polar-plane.js";
export type { TangentLineProps } from "./tangent.js";
export { tangentLine } from "./tangent.js";
export type {
	FieldEngine,
	FieldEnvironment,
	FieldProps,
	StreamLinesProps,
	VectorFieldHandle,
	VectorFieldProps,
} from "./vector-field.js";
export {
	createFieldEngine,
	fieldHandle,
	streamLines,
	vectorField,
} from "./vector-field.js";
