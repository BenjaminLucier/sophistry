/**
 * coords: coordinate systems (axes, planes, number lines) and the context
 * they publish.
 */

export type { AxesProps, AxisOptions } from "./axes";
export { axes } from "./axes";
export type {
	Complex,
	ComplexCoordinateSystem,
	ComplexPlaneProps,
} from "./complex-plane";
export { complexCoordsOf, complexPlane, imaginaryTick } from "./complex-plane";
export type {
	AxisPosition,
	CartesianOptions,
	CoordinateSystem,
	XAxisPosition,
	YAxisPosition,
} from "./coords";
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
} from "./coords";
export type {
	CurveSampling,
	FunctionGraphHandle,
	FunctionGraphProps,
	ParametricGraphProps,
	PolarGraphProps,
} from "./function-graph";
export {
	functionGraph,
	graphHandle,
	parametricGraph,
	polarGraph,
	sampleRuns,
} from "./function-graph";
export type {
	AreaUnderGraphProps,
	LineToGraphProps,
	RiemannRectanglesProps,
	SecantSlopeGroupProps,
	TangentToGraphProps,
} from "./graph-annotations";
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
} from "./graph-annotations";
export type { ImplicitFunctionProps } from "./implicit-function";
export { implicitFunction } from "./implicit-function";
export type {
	BasisVectorsProps,
	LinearTransformProps,
} from "./linear-transform";
export {
	basisVectors,
	LinearTransformNode,
	linearTransform,
	transformDeterminant,
} from "./linear-transform";
export type { NumberLineProps, UnitIntervalProps } from "./number-line";
export { numberLine, unitInterval } from "./number-line";
export type { NumberPlaneProps } from "./number-plane";
export { numberPlane } from "./number-plane";
export type {
	AzimuthUnits,
	PolarCoordinateSystem,
	PolarPlaneProps,
} from "./polar-plane";
export { piMultipleLabel, polarCoordsOf, polarPlane } from "./polar-plane";
export type { TangentLineProps } from "./tangent";
export { tangentLine } from "./tangent";
export type {
	FieldEngine,
	FieldEnvironment,
	FieldProps,
	StreamLinesProps,
	VectorFieldHandle,
	VectorFieldProps,
} from "./vector-field";
export {
	createFieldEngine,
	fieldHandle,
	streamLines,
	vectorField,
} from "./vector-field";
