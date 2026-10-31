/**
 * The `Interpolator` type, plus re-exports of the lerp primitives from
 * `../geometry/lerp` (their home, so `geometry/` never imports `tween/`). The
 * `auto` interpolator and the named registry are in `./interpolators`, which
 * imports this file and not the reverse.
 */

export {
	clamp,
	lerp,
	lerpPoint,
	lerpPoint3,
	progressIn,
	remap,
} from "../geometry/lerp";

/**
 * Produces a sampler between two values of the same shape.
 *
 * @category Tracks & clocks
 */
export type Interpolator<T> = (a: T, b: T) => (t: number) => T;
