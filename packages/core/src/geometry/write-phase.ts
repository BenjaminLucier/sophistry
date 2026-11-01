/**
 * Manim's `Write` timing as pure functions: which piece of a many-piece shape
 * is where, for one overall progress.
 *
 * `Write` (a `DrawBorderThenFill` with a lag) runs over the pieces of a
 * `VGroup` in order, each starting `lagRatio` of the way into the previous
 * one. Within its own window a piece spends the first half tracing its outline
 * with no fill, and the second half bringing the fill up while the outline
 * thins back to the piece's own stroke. These mirror `Animation.get_sub_alpha`
 * and `DrawBorderThenFill.interpolate_submobject`, so a scene that writes
 * parts by hand (one `<Path>` per glyph from `createLatex`) moves exactly as a
 * `MathTex` does.
 */

import { progressIn } from "./lerp.js";

/**
 * Where one piece of a write stands.
 *
 * @category Animation presets
 */
export interface WritePhase {
	/** How much of the piece's outline is traced, 0..1: the piece's `progress`. */
	border: number;
	/**
	 * How far the fill has come up, 0..1. Also how far the outline has thinned
	 * from its writing width back to the piece's own `strokeWidth`.
	 */
	fill: number;
}

/**
 * Manim's default `lag_ratio` for `Write`: `min(4 / count, 0.2)`, so a long
 * formula overlaps its glyphs more and a short one writes them nearly one by
 * one.
 *
 * @param count - Number of pieces being written.
 * @returns The lag ratio.
 *
 * @category Animation presets
 */
export function writeLagRatio(count: number): number {
	return Math.min(4 / Math.max(1, count), 0.2);
}

/**
 * Where piece `index` of `count` stands at an overall write `progress`.
 *
 * @param progress - Overall progress of the write, 0..1.
 * @param index - The piece, in writing order.
 * @param count - Number of pieces.
 * @param lagRatio - Fraction of a piece's window before the next one starts. Defaults to {@link writeLagRatio}.
 * @returns How much of the piece's outline is traced and how far its fill is up.
 *
 * @category Animation presets
 */
export function writePhase(
	progress: number,
	index: number,
	count: number,
	lagRatio = writeLagRatio(count),
): WritePhase {
	const span = (count - 1) * lagRatio + 1;
	// Glyph `index` writes over its own window of the run, measured in
	// glyph-lengths rather than as a share of it: whole-number boundaries
	// stay exact, so a glyph exactly half written has no fill at all.
	const alpha = progressIn(
		progress * span,
		index * lagRatio,
		index * lagRatio + 1,
	);
	return {
		border: Math.min(1, alpha * 2),
		fill: Math.max(0, alpha * 2 - 1),
	};
}
