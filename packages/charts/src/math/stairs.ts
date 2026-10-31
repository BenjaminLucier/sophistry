/** Stairs: a step function held constant across each `[edges[i], edges[i+1]]`. */

import type { Point } from "@sophistry/core/geometry";

/**
 * The step-function polyline.
 *
 * @category Math & helpers
 */
export type StairsPolyline = Point[];

/**
 * The step-function polyline for `values` held over `edges`.
 *
 * @param edges - Step boundaries, one more than `values`; defaults to `0..values.length`.
 * @returns The polyline in data coordinates, two points per value.
 * @throws If `edges` is given and its length is not `values.length + 1`.
 * @category Math & helpers
 */
export function stairsPolyline(
	values: readonly number[],
	edges?: readonly number[],
): StairsPolyline {
	const n = values.length;
	const xs = edges ?? Array.from({ length: n + 1 }, (_, i) => i);
	if (xs.length !== n + 1) {
		throw new Error(
			`stairsPolyline: edges must have one more entry than values (got ${xs.length} edges for ${n} values)`,
		);
	}
	const points: Point[] = [];
	for (let i = 0; i < n; i++) {
		points.push({ x: xs[i], y: values[i] });
		points.push({ x: xs[i + 1], y: values[i] });
	}
	return points;
}
