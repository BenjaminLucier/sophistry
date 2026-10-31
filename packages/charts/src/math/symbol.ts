/**
 * Scatter marker symbols: square, diamond, triangle, cross or star, each
 * sized to the area of a circle of radius `r` so shapes read as equal sizes.
 */

import type { Point } from "@sophistry/core/geometry";

/**
 * The marker shapes a `Scatter` can draw.
 *
 * @category Math & helpers
 */
export type SymbolName =
	| "circle"
	| "square"
	| "diamond"
	| "triangle"
	| "cross"
	| "star";

/**
 * The symbols in the order a series cycles through them: most distinct first.
 *
 * @category Math & helpers
 */
export const SYMBOLS: readonly SymbolName[] = [
	"circle",
	"square",
	"triangle",
	"diamond",
	"cross",
	"star",
];

/** Inner/outer radius of the five-pointed star: the regular pentagram's. */
const STAR_RATIO = 0.381966;

/**
 * The outline (open ring) of `symbol` centred on `(cx, cy)`, with the area
 * of a circle of radius `r`. A circle comes back as a 32-gon.
 *
 * @returns The vertices, counter-clockwise.
 * @category Math & helpers
 */
export function symbolPolygon(
	symbol: SymbolName,
	cx: number,
	cy: number,
	r: number,
): Point[] {
	const area = Math.PI * r * r;
	const at = (x: number, y: number): Point => ({ x: cx + x, y: cy + y });
	switch (symbol) {
		case "square": {
			const h = Math.sqrt(area) / 2;
			return [at(-h, -h), at(h, -h), at(h, h), at(-h, h)];
		}
		case "diamond": {
			// A square turned 45°: same area, half-diagonal √(area / 2).
			const d = Math.sqrt(area / 2);
			return [at(0, -d), at(d, 0), at(0, d), at(-d, 0)];
		}
		case "triangle": {
			// Equilateral, pointing up, centred on its centroid.
			const side = Math.sqrt((4 * area) / Math.sqrt(3));
			const height = (side * Math.sqrt(3)) / 2;
			return [
				at(-side / 2, -height / 3),
				at(side / 2, -height / 3),
				at(0, (2 * height) / 3),
			];
		}
		case "cross": {
			// A plus of five unit squares of side w: area 5w².
			const w = Math.sqrt(area / 5);
			const a = w / 2;
			const b = (3 * w) / 2;
			return [
				at(-a, -b),
				at(a, -b),
				at(a, -a),
				at(b, -a),
				at(b, a),
				at(a, a),
				at(a, b),
				at(-a, b),
				at(-a, a),
				at(-b, a),
				at(-b, -a),
				at(-a, -a),
			];
		}
		case "star": {
			// Area of an n-point star polygon: n · R · r_in · sin(π / n).
			const outer = Math.sqrt(area / (5 * STAR_RATIO * Math.sin(Math.PI / 5)));
			const inner = outer * STAR_RATIO;
			return Array.from({ length: 10 }, (_, k) => {
				const radius = k % 2 === 0 ? outer : inner;
				const angle = Math.PI / 2 + (k * Math.PI) / 5;
				return at(radius * Math.cos(angle), radius * Math.sin(angle));
			});
		}
		default:
			return Array.from({ length: 32 }, (_, k) => {
				const angle = (k * 2 * Math.PI) / 32;
				return at(r * Math.cos(angle), r * Math.sin(angle));
			});
	}
}
