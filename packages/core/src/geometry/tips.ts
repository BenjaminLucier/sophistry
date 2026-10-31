/**
 * Arrow tip outlines.
 *
 * A tip is *geometry*, not style: every shape here returns the same
 * `TipGeometry`, and whether it ends up hollow or solid is the component's
 * choice of `fill`. What the geometry does decide is `closed` — a tip that
 * encloses area has to say so, or the renderer won't fill it and an arc-length
 * reveal won't close the ring.
 *
 * Every tip is anchored so that `tip` is the point the arrow actually reaches
 * and the body extends *backwards* along `direction`. Callers can therefore
 * append a tip to a shaft without shortening the shaft.
 */

import { ellipseCurvePath } from "./arc";
import { closePolyline, polylineToCurvePath } from "./path/svg-path";
import type { CurvePath, Point, Polyline } from "./path/types";
import { arrowHeadAt, circlePolyline } from "./shapes";

/**
 * Arrow tip styles. `"vee"` is two open strokes; the rest are closed and fillable.
 *
 * @category Shapes
 */
export type TipShape = "vee" | "triangle" | "stealth" | "circle" | "square";

/**
 * The outline of one arrow tip, in both polyline and curve form.
 *
 * @category Shapes
 */
export interface TipGeometry {
	/** The outline as polylines. */
	polylines: Polyline[];
	/** Whether the outline encloses area (see {@link tipIsClosed}). */
	closed: boolean;
	/** The same outline as native curve paths. */
	curvePaths: CurvePath[];
}

/** Stealth's notch, as a fraction of the tip's axial length (Manim's 1.5/2). */
const STEALTH_NOTCH = 0.75;

/**
 * A tip is a handful of pixels across at any sensible zoom, so its roundness
 * doesn't warrant the adaptive count `segmentsForRadius` computes for shapes.
 */
const TIP_SEGMENTS = 24;

/**
 * Outline for one arrow tip.
 *
 * `direction` is the bearing the arrow travels *towards*, in radians; `length`
 * is the tip's extent measured back along it.
 *
 * @param shape - Which tip style to build.
 * @param tip - Where the point of the arrow sits, scene units.
 * @param direction - Bearing in radians the arrow points towards (0 along +x).
 * @param length - Extent of the tip back along the shaft, scene units.
 *
 * @category Shapes
 */
export function tipPolylines(
	shape: TipShape,
	tip: Point,
	direction: number,
	length: number,
): TipGeometry {
	// Unit vectors: `back` runs from the tip into the shaft, `side` across it.
	const back: Point = { x: -Math.cos(direction), y: -Math.sin(direction) };
	const side: Point = { x: -back.y, y: back.x };
	const at = (along: number, across: number): Point => ({
		x: tip.x + (back.x * along + side.x * across) * length,
		y: tip.y + (back.y * along + side.y * across) * length,
	});

	switch (shape) {
		case "vee": {
			const vee = arrowHeadAt(tip, direction, length);
			return {
				polylines: [vee],
				closed: false,
				curvePaths: [polylineToCurvePath(vee, false)],
			};
		}
		case "triangle": {
			// The same three points as the vee, joined up: outline and solid head
			// read as one arrowhead rather than two subtly different ones.
			const triangle = closePolyline(arrowHeadAt(tip, direction, length));
			return {
				polylines: [triangle],
				closed: true,
				curvePaths: [polylineToCurvePath(triangle, true)],
			};
		}
		case "stealth": {
			const stealth = closePolyline([
				{ ...tip },
				at(1, 0.5),
				at(STEALTH_NOTCH, 0),
				at(1, -0.5),
			]);
			return {
				polylines: [stealth],
				closed: true,
				curvePaths: [polylineToCurvePath(stealth, true)],
			};
		}
		case "circle": {
			const centre = at(0.5, 0);
			return {
				polylines: [
					circlePolyline(centre.x, centre.y, length / 2, TIP_SEGMENTS),
				],
				closed: true,
				curvePaths: [
					ellipseCurvePath(centre.x, centre.y, length / 2, length / 2),
				],
			};
		}
		case "square": {
			const square = closePolyline([
				at(0, 0.5),
				at(0, -0.5),
				at(1, -0.5),
				at(1, 0.5),
			]);
			return {
				polylines: [square],
				closed: true,
				curvePaths: [polylineToCurvePath(square, true)],
			};
		}
	}
}

/**
 * Whether a tip encloses area, and so wants filling rather than outlining.
 *
 * @param shape - The tip style.
 * @returns False for `"vee"`, true otherwise.
 *
 * @category Shapes
 */
export function tipIsClosed(shape: TipShape): boolean {
	return shape !== "vee";
}
