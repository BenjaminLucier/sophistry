/** Hexagonal binning: finite `(x, y)` pairs counted into a pointy-top hex grid. */

import type { Point } from "@sophistry/core/geometry";
import { pairCount } from "./shared/pairs.js";

/**
 * One occupied hex: its centre in data units, and how many points landed in it.
 *
 * @category Math & helpers
 */
export interface HexBinCell {
	center: Point;
	count: number;
}

/**
 * Bins finite `(x, y)` pairs (paired by index) into a pointy-top hex grid of
 * the given `radius`, in data units.
 *
 * @param radius - Centre-to-corner distance of each hexagon, in data units; must be positive.
 * @returns One {@link HexBinCell} per occupied hexagon, in no particular order.
 * @category Math & helpers
 */
export function hexbin(
	xs: readonly number[],
	ys: readonly number[],
	radius: number,
): HexBinCell[] {
	if (!(radius > 0) || !Number.isFinite(radius)) return [];
	const n = pairCount(xs, ys);
	const cells = new Map<string, HexBinCell>();

	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const y = ys[i];
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

		const fq = ((Math.sqrt(3) / 3) * x - y / 3) / radius;
		const fr = ((2 / 3) * y) / radius;
		const [q, r] = roundAxial(fq, fr);

		const key = `${q},${r}`;
		const existing = cells.get(key);
		if (existing) {
			existing.count++;
		} else {
			cells.set(key, {
				center: {
					x: radius * Math.sqrt(3) * (q + r / 2),
					y: radius * 1.5 * r,
				},
				count: 1,
			});
		}
	}

	return Array.from(cells.values());
}

/** Rounds fractional axial `(q, r)` to the nearest hex, via cube coordinates. */
function roundAxial(q: number, r: number): [number, number] {
	const cubeX = q;
	const cubeZ = r;
	const cubeY = -cubeX - cubeZ;

	let rx = Math.round(cubeX);
	let ry = Math.round(cubeY);
	let rz = Math.round(cubeZ);

	const dx = Math.abs(rx - cubeX);
	const dy = Math.abs(ry - cubeY);
	const dz = Math.abs(rz - cubeZ);

	if (dx > dy && dx > dz) {
		rx = -ry - rz;
	} else if (dy > dz) {
		ry = -rx - rz;
	} else {
		rz = -rx - ry;
	}

	return [rx, rz];
}
