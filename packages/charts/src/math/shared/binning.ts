/**
 * Equal-width bin math shared by `histogramBins` (1D) and `histogram2d` (2D):
 * both bin a continuous range into `n` buckets with the same right-inclusive
 * last bin and the same degenerate-range widening.
 */

/**
 * How many bins to use and where the last edge lands: an explicit `count`
 * wins; else a positive `step` is the bin width (`max` extended to a whole
 * step, with float tolerance so `[0, 0.3, 0.1]` is 3 bins); else
 * `fallbackCount` bins span `[min, max]`.
 *
 * @returns The bin count and the (possibly extended) upper bound.
 */
export function resolveBinning(
	min: number,
	max: number,
	count: number | undefined,
	step: number | undefined,
	fallbackCount: number,
): { n: number; max: number } {
	if (count !== undefined) {
		return { n: Math.max(1, Math.floor(count)), max };
	}
	if (step !== undefined && Number.isFinite(step) && step > 0) {
		const n = Math.max(1, Math.ceil((max - min) / step - 1e-9));
		return { n, max: min + n * step };
	}
	return { n: Math.max(1, Math.floor(fallbackCount)), max };
}

/** Widens a degenerate `[min, max]` (`min === max`) symmetrically to a small nonzero span. */
export function widenDegenerate(min: number, max: number): [number, number] {
	return min === max ? [min - 0.5, max + 0.5] : [min, max];
}

/** Bin index for `value` within `[min, max]` split into `bins` equal buckets, the last bin right-inclusive. */
export function binIndex(
	value: number,
	min: number,
	max: number,
	bins: number,
): number {
	const span = max - min;
	const raw = Math.floor(((value - min) / span) * bins);
	let index = Math.min(bins - 1, Math.max(0, raw));
	// The division above and `binEdges`' multiply-then-divide round
	// differently, so a value sitting exactly on an edge can land one bin low
	// (or high). Nudge against the actual edge values so the two agree.
	while (index < bins - 1 && value >= edgeAt(min, max, bins, index + 1))
		index++;
	while (index > 0 && value < edgeAt(min, max, bins, index)) index--;
	return index;
}

/** Edge `i` of `n` equal bins over `[min, max]`; the one formula `binEdges` and `binIndex` share. */
function edgeAt(min: number, max: number, n: number, i: number): number {
	return min + ((max - min) * i) / n;
}

/** `n + 1` evenly spaced edges from `min` to `max`, split into `n` bins. */
export function binEdges(min: number, max: number, n: number): number[] {
	const edges: number[] = new Array(n + 1);
	for (let i = 0; i <= n; i++) edges[i] = edgeAt(min, max, n, i);
	return edges;
}
