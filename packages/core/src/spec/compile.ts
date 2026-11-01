/**
 * Spec sources to the frame a renderer paints.
 *
 * `compileFrame` is the pure version: read each spec, drop empties,
 * stable-sort by `zIndex`; usable from tests, SSR and equivalence checks. The
 * incremental collector the scene uses (patching only changed specs into the
 * last frame) lives with the scene graph and must always produce the same
 * array as this function.
 *
 * Ties paint in tree order: the order the sources are handed over in.
 */

import type { DrawSpec, SpecSource } from "./types.js";

/**
 * Reads every source's current spec and returns them in paint order.
 *
 * Hidden or empty sources — whose `spec()` reads `null` — drop out rather than
 * appearing as a hole. The sort is stable (`Array.prototype.sort` has been
 * stable since ES2019), so sources sharing a `zIndex` keep the order they were
 * given in. Pass them in tree order and ties paint in tree order.
 *
 * Not incremental: it reads `spec()` once per source.
 *
 * @param sources - The spec sources in tree order.
 * @returns Scene-space draw specs ordered by ascending `zIndex`.
 *
 * @category Scene registry & specs
 */
export function compileFrame(sources: readonly SpecSource[]): DrawSpec[] {
	const specs = sources
		.map((source) => source.spec())
		.filter((spec): spec is DrawSpec => spec !== null);
	return specs.sort((a, b) => a.zIndex - b.zIndex);
}
