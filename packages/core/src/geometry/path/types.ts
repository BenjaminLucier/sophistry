/**
 * The path value types shared by every layer: points, polylines, subpaths
 * and the cubic-only `CurvePath`. Types only; the math lives in the sibling
 * modules (`./cubic`, `./svg-path`, `./arclength`).
 */

/**
 * A 2D position. In scene space `x` grows right and `y` grows up; units depend on context (scene units unless a function says pixels).
 *
 * @category Value types
 */
export interface Point {
	/** Horizontal coordinate. */
	x: number;
	/** Vertical coordinate. */
	y: number;
}

/**
 * A flattened, drawable run of points. Bounds and hit testing read polylines;
 * `CurvePath` is the exact curve form.
 *
 * @category Paths
 */
export type Polyline = Point[];

/**
 * A polyline plus whether its last point joins back to its first.
 *
 * @category Paths
 */
export interface Subpath {
	/** The vertices. A closed subpath repeats its first point at the end. */
	points: Polyline;
	/** Whether the last point joins back to the first (SVG `Z`). */
	closed: boolean;
}

/**
 * One span of a `CurvePath`: a cubic bézier to `to` via `c1`/`c2`. A straight
 * line is a cubic with control points at the thirds (`lineSegment`), so every
 * segment is handled the same way.
 *
 * @category Paths
 */
export interface CurveSegment {
	/** First control point. */
	c1: Point;
	/** Second control point. */
	c2: Point;
	/** End point; the start is the previous segment's `to` (or `CurvePath.start`). */
	to: Point;
}

/**
 * A drawable path kept in its original curve form — the native alternative to
 * flattening into a `Polyline`. `start` plus `segments` mirrors how canvas
 * paths and SVG path data are built: one anchor, then a run of moves from it.
 *
 * @category Paths
 */
export interface CurvePath {
	/** Where the path begins. */
	start: Point;
	/** Cubic moves from `start`, in order. */
	segments: CurveSegment[];
	/** Whether the path closes back to `start` (drawn with `closePath`). */
	closed: boolean;
}

/**
 * An axis-aligned bounding box. Empty input to `boundsOf` yields infinities; callers that can see empty geometry check first (see `boundsOfPolylines`).
 *
 * @category Value types
 */
export interface Bounds {
	/** Smallest x. */
	minX: number;
	/** Smallest y. */
	minY: number;
	/** Largest x. */
	maxX: number;
	/** Largest y. */
	maxY: number;
}
