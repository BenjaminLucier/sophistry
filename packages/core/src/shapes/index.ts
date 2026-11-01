/**
 * The built-in shapes: definitions made with `defineShape`.
 */

export type {
	AngleAnchor,
	AngleProps,
	ElbowProps,
	Ray,
	RightAngleProps,
} from "./angle.js";
export { angle, elbow, resolveAngleAnchor, rightAngle } from "./angle.js";
export type { AnimatedBoundaryProps } from "./animated-boundary.js";
export { animatedBoundary } from "./animated-boundary.js";
export type {
	AnnularSectorProps,
	AnnulusProps,
	ArcBetweenPointsProps,
	ArcProps,
	SectorProps,
} from "./arc.js";
export {
	annularSector,
	annulus,
	arc,
	arcBetweenPoints,
	sector,
} from "./arc.js";
export type { CubicBezierProps, QuadraticBezierProps } from "./bezier.js";
export { cubicBezier, quadraticBezier } from "./bezier.js";
export type { BraceProps } from "./brace.js";
export { brace } from "./brace.js";
export type { CircleProps, EllipseProps } from "./circle.js";
export { circle, ellipse } from "./circle.js";
export type {
	AnnotationDotProps,
	DotProps,
	LabeledDotMetrics,
	LabeledDotProps,
} from "./dot.js";
export {
	annotationDot,
	dot,
	LABELED_DOT_FONT_SIZE,
	labeledDot,
	labeledDotRadius,
} from "./dot.js";
export type {
	ArrowProps,
	CurvedArrowProps,
	CurvedDoubleArrowProps,
	DashedLineProps,
	DoubleArrowProps,
	LineProps,
	TippedProps,
	VectorProps,
} from "./line.js";
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
} from "./line.js";
export type {
	BackgroundRectangleProps,
	CrossProps,
	MatcherProps,
	MatcherTarget,
	SurroundingRectangleProps,
	UnderlineProps,
} from "./matchers.js";
export {
	backgroundRectangle,
	cross,
	surroundingRectangle,
	targetBounds,
	underline,
} from "./matchers.js";
export type { PathProps, PlotProps } from "./path.js";
export { path, plot } from "./path.js";
export type { PolygonProps } from "./polygon.js";
export { polygon } from "./polygon.js";
export type {
	PolygramProps,
	RegularPolygramProps,
	StarProps,
} from "./polygram.js";
export { polygram, regularPolygram, star } from "./polygram.js";
export type { RectProps, SquareProps } from "./rect.js";
export { rect, square } from "./rect.js";
export type { TracedPathProps } from "./traced-path.js";
export { tracedPath } from "./traced-path.js";
export type { TransformMatchingShapesProps } from "./transform-matching-shapes.js";
export { transformMatchingShapes } from "./transform-matching-shapes.js";
