/** Level resolution shared by contour lines and filled contours: explicit values, or a count spaced over the data's finite extent. */

/** Smallest/largest finite value in a 2D grid, or `null` if it has none. */
export function dataExtent(
	z: readonly (readonly number[])[],
): [number, number] | null {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const row of z) {
		for (const value of row) {
			if (!Number.isFinite(value)) continue;
			if (value < min) min = value;
			if (value > max) max = value;
		}
	}
	return min <= max ? [min, max] : null;
}

/** Resolves `levels` (explicit values as is, or a count spaced by `evenFn`) against `z`'s extent; `[]` for a constant or all-non-finite field. */
export function resolveLevels(
	levels: readonly number[] | number,
	z: readonly (readonly number[])[],
	evenFn: (min: number, max: number, count: number) => number[],
): number[] {
	if (Array.isArray(levels)) return levels.slice();
	const extent = dataExtent(z);
	if (!extent || extent[0] === extent[1]) return [];
	return evenFn(extent[0], extent[1], levels as number);
}
