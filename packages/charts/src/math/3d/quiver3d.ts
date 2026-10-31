/**
 * 3D vector field geometry: one arrow per index, tail at `(x, y, z)`,
 * direction and length `(u, v, w) * scale` (not normalised; pre-normalise
 * the components for equal lengths).
 */

import type { Point3 } from "@sophistry/core/internal";
import { pairCount } from "../shared/pairs";

/** @category Math */
export interface QuiverVector3 {
	/** Index into the input arrays, keeping a `colors` array aligned past dropped entries. */
	index: number;
	origin: Point3;
	vector: Point3;
}

/** @category Math */
export interface QuiverOptions {
	/** Multiplies `(u, v, w)` before it becomes the drawn vector. @default 1 */
	scale?: number;
}

const DEFAULT_SCALE = 1;

/**
 * One vector per finite `(x, y, z, u, v, w)`, keeping its index; the six
 * arrays pair by index.
 *
 * @param us - Vector x component, in data units (before `scale`).
 * @category Math & helpers
 */
export function quiverVectors(
	xs: readonly number[],
	ys: readonly number[],
	zs: readonly number[],
	us: readonly number[],
	vs: readonly number[],
	ws: readonly number[],
	options: QuiverOptions = {},
): QuiverVector3[] {
	const scale = options.scale ?? DEFAULT_SCALE;
	let n = pairCount(xs, ys);
	n = Math.min(n, zs.length, us.length, vs.length, ws.length);

	const vectors: QuiverVector3[] = [];
	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const y = ys[i];
		const z = zs[i];
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
			continue;

		const vx = us[i] * scale;
		const vy = vs[i] * scale;
		const vz = ws[i] * scale;
		if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz))
			continue;

		vectors.push({
			index: i,
			origin: { x, y, z },
			vector: { x: vx, y: vy, z: vz },
		});
	}
	return vectors;
}
