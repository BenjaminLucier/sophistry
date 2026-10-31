/**
 * The built-in shapes: definitions made with `defineShape`.
 */

export type {
	AngleAnchor,
	AngleProps,
	ElbowProps,
	Ray,
	RightAngleProps,
} from "./angle";
export { angle, elbow, resolveAngleAnchor, rightAngle } from "./angle";
export type { AnimatedBoundaryProps } from "./animated-boundary";
export { animatedBoundary } from "./animated-boundary";
export type {
	AnnularSectorProps,
	AnnulusProps,
	ArcBetweenPointsProps,
	ArcProps,
	SectorProps,
} from "./arc";
export { annularSector, annulus, arc, arcBetweenPoints, sector } from "./arc";
export type { CubicBezierProps, QuadraticBezierProps } from "./bezier";
export { cubicBezier, quadraticBezier } from "./bezier";
export type { BraceProps } from "./brace";
export { brace } from "./brace";
export type { CircleProps, EllipseProps } from "./circle";
export { circle, ellipse } from "./circle";
export type {
	AnnotationDotProps,
	DotProps,
	LabeledDotMetrics,
	LabeledDotProps,
} from "./dot";
export {
	annotationDot,
	dot,
	LABELED_DOT_FONT_SIZE,
	labeledDot,
	labeledDotRadius,
} from "./dot";
export type {
	ArrowProps,
	CurvedArrowProps,
	CurvedDoubleArrowProps,
	DashedLineProps,
	DoubleArrowProps,
	LineProps,
	TippedProps,
	VectorProps,
} from "./line";
export {
	arrow,
	bearingTo,
	curvedArrow,
	curvedDoubleArrow,
	curveEndBearing,
	DEFAULT_TIP_LENGTH,
	dashedLine,
	dashedLinePattern,
	doubleArrow,
	line,
	tipFillOf,
	tipGeometryAt,
	vector,
} from "./line";
export type {
	BackgroundRectangleProps,
	CrossProps,
	MatcherProps,
	MatcherTarget,
	SurroundingRectangleProps,
	UnderlineProps,
} from "./matchers";
export {
	backgroundRectangle,
	cross,
	surroundingRectangle,
	targetBounds,
	underline,
} from "./matchers";
export type { PathProps, PlotProps } from "./path";
export { path, plot } from "./path";
export type { PolygonProps } from "./polygon";
export { polygon } from "./polygon";
export type {
	PolygramProps,
	RegularPolygramProps,
	StarProps,
} from "./polygram";
export { polygram, regularPolygram, star } from "./polygram";
export type { RectProps, SquareProps } from "./rect";
export { rect, square } from "./rect";
export type { TracedPathProps } from "./traced-path";
export { tracedPath } from "./traced-path";
export type { TransformMatchingShapesProps } from "./transform-matching-shapes";
export { transformMatchingShapes } from "./transform-matching-shapes";
