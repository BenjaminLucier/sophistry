/**
 * Deterministic, seeded colours. Scenes are pure functions of their signals, so
 * nothing calls `Math.random`: `randomColor` hashes its seed (integer-only, so
 * identical on every engine) for variety that is the same on every render.
 */

import { hslToRgb } from "./convert";
import type { Color } from "./types";

/**
 * A deterministic value in `[0, 1)` for `(seed, salt)`, built only from
 * integer operations (`Math.imul`, xor, shifts — the murmur3 finalizer), which
 * the language defines exactly, so it is bit-identical on every JS engine.
 * (A `Math.sin` hash would not be: its low bits are implementation-defined.)
 * The seed's integer part (wrapped to 32 bits) and its fraction (as a 32-bit
 * fixed-point value) are both mixed in, so non-integer seeds still differ.
 */
function hash01(seed: number, salt: number): number {
	const whole = Math.floor(seed);
	const frac = Math.floor((seed - whole) * 4294967296) >>> 0;
	let h = (whole | 0) ^ Math.imul(frac ^ 0x9e3779b9, 0x85ebca6b);
	h ^= Math.imul(salt + 1, 0xc2b2ae35);
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

/** Turns a string seed into a number by folding its char codes — good
 * enough for a hash input, not for anything cryptographic. */
function seedToNumber(seed: string): number {
	let h = 0;
	for (let i = 0; i < seed.length; i++) {
		h = (h * 31 + seed.charCodeAt(i)) | 0;
	}
	return h;
}

/**
 * Options for {@link randomColor}.
 *
 * @category Ops
 */
export interface RandomColorOptions {
	/** Saturation range, 0..1. Defaults to `[0.55, 0.85]` — full-random
	 * saturation swings between mud (low) and neon (high), and this range is
	 * tuned to stay in the "reads as a deliberate colour" band. */
	saturation?: [number, number];
	/** Lightness range, 0..1. Defaults to `[0.45, 0.65]` — kept away from
	 * both white and black so the result is never accidentally invisible
	 * against a light or dark theme background. */
	lightness?: [number, number];
	/**
	 * Opacity of the result, 0..1.
	 * @default 1
	 */
	alpha?: number;
}

/**
 * A deterministic colour from `seed`: same seed, same colour, so it is safe in a
 * memo. Hue is hashed over the full circle with saturation and lightness kept in
 * a band, so every colour is about equally vivid.
 *
 * @param seed - A number, or a string folded to a number.
 * @param options - See {@link RandomColorOptions}.
 * @returns A `Color`.
 *
 * @example
 * ```ts
 * import { toCss } from "@sophistry/core";
 * import { randomColor } from "@sophistry/core/color";
 *
 * const colorOf = (id: string) => toCss(randomColor(id));
 * ```
 *
 * @category Ops
 */
export function randomColor(
	seed: number | string,
	options: RandomColorOptions = {},
): Color {
	const n = typeof seed === "string" ? seedToNumber(seed) : seed;
	const [sMin, sMax] = options.saturation ?? [0.55, 0.85];
	const [lMin, lMax] = options.lightness ?? [0.45, 0.65];

	const h = hash01(n, 0) * 360;
	const s = sMin + hash01(n, 1) * (sMax - sMin);
	const l = lMin + hash01(n, 2) * (lMax - lMin);

	return hslToRgb({ h, s, l, a: options.alpha ?? 1 });
}
