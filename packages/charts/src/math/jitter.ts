/** Seeded jitter: offsets that are a pure function of a key and a seed, so they stay put across frames and when scrubbed. */

import { hashUnit } from "@sophistry/core/internal";

/** @category Math */
export interface JitterOptions {
	/** Total width the offsets spread over, centred on 0. @default 1 */
	width?: number;
	/** Varies the pattern. @default 0 */
	seed?: number;
}

/**
 * One offset in `[-width / 2, width / 2)` per key. Key by something stable
 * (an id) and a datum keeps its offset as others come and go.
 *
 * @returns Offsets parallel to `keys`.
 * @category Math & helpers
 */
export function jitterOffsets(
	keys: readonly (string | number)[],
	options: JitterOptions = {},
): number[] {
	const width = Number.isFinite(options.width) ? (options.width ?? 1) : 1;
	const seed = options.seed ?? 0;
	return keys.map((key) => (hashUnit(key, seed) - 0.5) * width);
}
