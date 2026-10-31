/** Number of index-aligned pairs two parallel arrays offer, `Math.min(xs.length, ys.length)`; the longer tail is dropped. */
export function pairCount(
	xs: readonly unknown[],
	ys: readonly unknown[],
): number {
	return Math.min(xs.length, ys.length);
}
