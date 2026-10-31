/**
 * Angle marks: the arc between two rays, the right-angle square, and an
 * elbow at a bearing you give. Built where they sit.
 */

import type { AngleArcOptions, Point } from "../geometry";
import {
	angleArcCurvePath,
	elbowPolyline,
	polylineToCurvePath,
	rightAngleMarkPolyline,
} from "../geometry";
import { Invalidate } from "../scene/context";
import {
	defineShape,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "../scene/shape";

/**
 * A segment, in the shape `line` already takes.
 *
 * @category Shapes
 */
export interface Ray {
	/** Start point in scene units. */
	from: Point;
	/** End point in scene units. */
	to: Point;
}

/**
 * Two rays sharing a vertex. Scenes usually have the *lines* to hand rather
 * than a vertex, so both spellings are accepted and normalized here.
 *
 * @category Shapes
 */
export interface AngleAnchor {
	/** Vertex of the angle. Defaults to the origin. */
	vertex?: Point;
	/** A point the first ray passes through. Defaults to one unit right of the vertex. */
	from?: Point;
	/** A point the second ray passes through. Defaults to one unit above the vertex. */
	to?: Point;
	/** Or two segments; their intersection becomes the vertex. Used only when both `line1` and `line2` are given. */
	line1?: Ray;
	/** Second segment: see `line1`. */
	line2?: Ray;
}

/**
 * Resolves either spelling to a vertex and two ray endpoints.
 *
 * Parallel lines have no vertex, so they fall back to `line1.from`: a
 * degenerate mark is easier to spot in a scene than a silent no-op.
 *
 * @param anchor - The vertex and ray points, or two segments.
 * @returns The vertex and a point on each ray.
 *
 * @category Shapes
 */
export function resolveAngleAnchor(anchor: AngleAnchor): {
	vertex: Point;
	from: Point;
	to: Point;
} {
	const { line1, line2 } = anchor;
	if (line1 && line2) {
		const d1 = { x: line1.to.x - line1.from.x, y: line1.to.y - line1.from.y };
		const d2 = { x: line2.to.x - line2.from.x, y: line2.to.y - line2.from.y };
		const denominator = d1.x * d2.y - d1.y * d2.x;
		const vertex =
			denominator === 0
				? { ...line1.from }
				: (() => {
						const t =
							((line2.from.x - line1.from.x) * d2.y -
								(line2.from.y - line1.from.y) * d2.x) /
							denominator;
						return { x: line1.from.x + d1.x * t, y: line1.from.y + d1.y * t };
					})();
		return {
			vertex,
			from: { x: vertex.x + d1.x, y: vertex.y + d1.y },
			to: { x: vertex.x + d2.x, y: vertex.y + d2.y },
		};
	}

	const vertex = anchor.vertex ?? { x: 0, y: 0 };
	return {
		vertex,
		from: anchor.from ?? { x: vertex.x + 1, y: vertex.y },
		to: anchor.to ?? { x: vertex.x, y: vertex.y + 1 },
	};
}

/** Descriptor entries for the {@link AngleAnchor} props: outline inputs. */
const anchorProps = {
	vertex: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	from: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	to: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	line1: { invalidates: Invalidate.GEOMETRY },
	line2: { invalidates: Invalidate.GEOMETRY },
} as const;

/** @category Shapes */
export interface AngleProps extends ShapeProps, AngleAnchor, AngleArcOptions {
	/**
	 * Distance of the mark from the vertex.
	 * @default 0.6
	 */
	radius?: number;
}

/**
 * The arc marking the angle between two rays. Defaults to the minor arc;
 * `otherAngle` takes the reflex one and `quadrant` flips either ray, which
 * between them reach all four regions two crossing lines cut out.
 *
 * No dots or labels: compose a `dot`/`label` beside it if you want them.
 *
 * @example
 * ```ts
 * import { angle, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(angle.create({ vertex: { x: 0, y: 0 }, from: { x: 1, y: 0 }, to: { x: 1, y: 1 } }));
 * ```
 *
 * @see {@link rightAngle}
 *
 * @category Shapes
 */
export const angle = defineShape<
	AngleProps,
	ShapeInstanceable | "vertex" | "from" | "to" | "radius"
>({
	name: "Angle",
	props: {
		...shapeProps,
		...anchorProps,
		radius: {
			default: 0.6,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		quadrant: { invalidates: Invalidate.GEOMETRY },
		otherAngle: { default: false, invalidates: Invalidate.GEOMETRY },
	},
	geometry: (props) => {
		const { vertex, from, to } = resolveAngleAnchor(props);
		const radius = props.radius ?? 0.6;
		const options = {
			quadrant: props.quadrant,
			otherAngle: props.otherAngle,
		};
		return {
			closed: false,
			curvePaths: [angleArcCurvePath(vertex, from, to, radius, options)],
		};
	},
});

/** @category Shapes */
export interface RightAngleProps extends ShapeProps, AngleAnchor {
	/**
	 * Leg length of the square.
	 * @default 0.3
	 */
	size?: number;
}

/**
 * The little square that marks a right angle at a vertex between two rays.
 *
 * Takes the same anchor props as {@link angle}. It draws the mark whatever the
 * actual angle is, so only use it where the rays really are perpendicular.
 *
 * @example
 * ```ts
 * import { createScene, rightAngle } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(rightAngle.create({ vertex: { x: 0, y: 0 } }));
 * ```
 *
 * @category Shapes
 */
export const rightAngle = defineShape<
	RightAngleProps,
	ShapeInstanceable | "vertex" | "from" | "to" | "size"
>({
	name: "RightAngle",
	props: {
		...shapeProps,
		...anchorProps,
		size: {
			default: 0.3,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
	},
	geometry: (props) => {
		const { vertex, from, to } = resolveAngleAnchor(props);
		const mark = rightAngleMarkPolyline(
			vertex,
			{ x: from.x - vertex.x, y: from.y - vertex.y },
			{ x: to.x - vertex.x, y: to.y - vertex.y },
			props.size ?? 0.3,
		);
		return {
			closed: false,
			curvePaths: [polylineToCurvePath(mark, false)],
		};
	},
});

/** @category Shapes */
export interface ElbowProps extends ShapeProps {
	/** The corner the mark hinges on, in scene units. */
	vertex: Point;
	/**
	 * Leg length of the mark.
	 * @default 0.3
	 */
	width?: number;
	/**
	 * Radians; rotates the mark about `vertex`.
	 * @default 0
	 */
	angle?: number;
}

/**
 * A right-angle corner mark at a bearing you give directly, rather than from rays.
 *
 * @example
 * ```ts
 * import { createScene, elbow } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(elbow.create({ vertex: { x: 0, y: 0 }, angle: Math.PI / 4 }));
 * ```
 *
 * @see {@link rightAngle}
 *
 * @category Shapes
 */
export const elbow = defineShape<
	ElbowProps,
	ShapeInstanceable | "vertex" | "width" | "angle"
>({
	name: "Elbow",
	props: {
		...shapeProps,
		vertex: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		width: {
			default: 0.3,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		angle: { default: 0, invalidates: Invalidate.GEOMETRY, instanceable: true },
	},
	geometry: (props) => {
		const corner = elbowPolyline(
			props.vertex,
			props.width ?? 0.3,
			props.angle ?? 0,
		);
		return {
			closed: false,
			curvePaths: [polylineToCurvePath(corner, false)],
		};
	},
});
