/**
 * Dodging overlapping marks apart: in data space, sub-bands within a
 * category's band (`dodgeSpan`, grouped bars); in screen space, circles
 * pushed off an axis until they clear each other (`beeswarmOffsets`).
 */

import { clamp01 } from "@sophistry/core/internal";

/**
 * Sub-band `slot` of `count` within one band, as fractions `[from, to]` of
 * the band, with `padding` of each sub-band left empty.
 *
 * @param padding - Fraction of each sub-band left empty, 0..1. Defaults to 0.1.
 * @category Math & helpers
 */
export function dodgeSpan(
	slot: number,
	count: number,
	padding = 0.1,
): [number, number] {
	const n = Math.max(1, Math.floor(count));
	const pad = Number.isFinite(padding) ? clamp01(padding) : 0;
	return [(slot + pad / 2) / n, (slot + 1 - pad / 2) / n];
}

/** @category Math */
export interface BeeswarmOptions {
	/**
	 * Which side of the axis circles may move to: `"both"` (centred on the
	 * axis), `"positive"` or `"negative"` (standing on a baseline).
	 * @default "both"
	 */
	side?: "both" | "positive" | "negative";
	/** Extra room left between neighbouring circles, in the same units as the radii. @default 0 */
	gap?: number;
}

/**
 * Beeswarm offsets: each circle keeps its position along the axis and moves
 * across it just far enough to clear those placed before it (in ascending
 * order). Deterministic, so it scrubs. Positions and radii share units
 * (scene units).
 *
 * @param positions - Each circle's centre along the axis; non-finite ones get `NaN`.
 * @param radii - One radius for every circle, or one per circle.
 * @returns One offset across the axis per circle.
 * @category Math & helpers
 */
export function beeswarmOffsets(
	positions: readonly number[],
	radii: number | readonly number[],
	options: BeeswarmOptions = {},
): number[] {
	const side = options.side ?? "both";
	const gap = Math.max(0, options.gap ?? 0);
	const radius = (i: number) => {
		const r = typeof radii === "number" ? radii : (radii[i] ?? 0);
		return Number.isFinite(r) ? Math.max(0, r) : 0;
	};
	const offsets = positions.map(() => Number.NaN);
	const order = positions
		.map((_, i) => i)
		.filter((i) => Number.isFinite(positions[i]))
		.sort((a, b) => positions[a] - positions[b] || a - b);
	let maxRadius = 0;
	for (const i of order) maxRadius = Math.max(maxRadius, radius(i));

	const placed: number[] = [];
	let first = 0;
	const allowed = (offset: number) =>
		side === "both" ||
		(side === "positive" ? offset >= -1e-12 : offset <= 1e-12);

	for (const i of order) {
		const p = positions[i];
		const r = radius(i);
		const reach = r + maxRadius + gap;
		// Placed circles are in ascending position: drop the ones too far left.
		while (first < placed.length && p - positions[placed[first]] >= reach)
			first++;
		const near = placed.slice(first).filter((j) => {
			const d = r + radius(j) + gap;
			return Math.abs(p - positions[j]) < d;
		});
		const candidates = [0];
		for (const j of near) {
			const d = r + radius(j) + gap;
			const dx = p - positions[j];
			const dy = Math.sqrt(Math.max(0, d * d - dx * dx));
			candidates.push(offsets[j] + dy, offsets[j] - dy);
		}
		const fits = (offset: number) =>
			near.every((j) => {
				const d = r + radius(j) + gap;
				const dx = p - positions[j];
				const dy = offset - offsets[j];
				return dx * dx + dy * dy >= d * d - 1e-9;
			});
		let best = Number.NaN;
		for (const candidate of candidates) {
			if (!allowed(candidate) || !fits(candidate)) continue;
			if (
				Number.isNaN(best) ||
				Math.abs(candidate) < Math.abs(best) - 1e-12 ||
				(Math.abs(Math.abs(candidate) - Math.abs(best)) <= 1e-12 &&
					candidate > best)
			)
				best = candidate;
		}
		offsets[i] = Number.isNaN(best) ? 0 : best;
		placed.push(i);
	}
	return offsets;
}
