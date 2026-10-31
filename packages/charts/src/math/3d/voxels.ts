/**
 * Boolean voxel grid geometry: each `true` `filled[i][j][k]` occupies the unit
 * cube `[i, i+1] x [j, j+1] x [k, k+1]`; ragged or missing entries are empty.
 * Only exposed faces are emitted (faces between two filled voxels are
 * culled), wound counter-clockwise from outside.
 */

import type { Point3 } from "@sophistry/core/internal";

/** @category Math */
export interface VoxelFace {
	points: Point3[];
}

/** `false` for any missing or out-of-bounds index. */
function isFilled(
	filled: readonly (readonly (readonly boolean[])[])[],
	i: number,
	j: number,
	k: number,
): boolean {
	return filled[i]?.[j]?.[k] === true;
}

/**
 * One quad per exposed face of every filled voxel.
 *
 * @category Math & helpers
 */
export function voxelFaces(
	filled: readonly (readonly (readonly boolean[])[])[],
): VoxelFace[] {
	const faces: VoxelFace[] = [];
	for (let i = 0; i < filled.length; i++) {
		const plane = filled[i];
		if (!plane) continue;
		for (let j = 0; j < plane.length; j++) {
			const row = plane[j];
			if (!row) continue;
			for (let k = 0; k < row.length; k++) {
				if (row[k] !== true) continue;

				const x0 = i;
				const x1 = i + 1;
				const y0 = j;
				const y1 = j + 1;
				const z0 = k;
				const z1 = k + 1;
				const p000: Point3 = { x: x0, y: y0, z: z0 };
				const p001: Point3 = { x: x0, y: y0, z: z1 };
				const p010: Point3 = { x: x0, y: y1, z: z0 };
				const p011: Point3 = { x: x0, y: y1, z: z1 };
				const p100: Point3 = { x: x1, y: y0, z: z0 };
				const p101: Point3 = { x: x1, y: y0, z: z1 };
				const p110: Point3 = { x: x1, y: y1, z: z0 };
				const p111: Point3 = { x: x1, y: y1, z: z1 };

				// +X / -X / +Y / -Y / +Z / -Z, same order and winding as `boxFaces`.
				if (!isFilled(filled, i + 1, j, k))
					faces.push({ points: [p100, p110, p111, p101] });
				if (!isFilled(filled, i - 1, j, k))
					faces.push({ points: [p000, p001, p011, p010] });
				if (!isFilled(filled, i, j + 1, k))
					faces.push({ points: [p010, p011, p111, p110] });
				if (!isFilled(filled, i, j - 1, k))
					faces.push({ points: [p000, p100, p101, p001] });
				if (!isFilled(filled, i, j, k + 1))
					faces.push({ points: [p001, p101, p111, p011] });
				if (!isFilled(filled, i, j, k - 1))
					faces.push({ points: [p000, p010, p110, p100] });
			}
		}
	}
	return faces;
}
