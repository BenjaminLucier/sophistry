/** The `startAngle`/`clockwise` sweep options shared by the polar charts. */

export { TAU } from "@sophistry/core/internal";

/** @category Math */
export interface PolarSweepOptions {
	/**
	 * Radians from +x (counter-clockwise, y up) where the first slice, wedge or axis begins. The
	 * default is 12 o'clock.
	 * @default Math.PI / 2
	 */
	startAngle?: number;
	/** Sweep direction. @default true */
	clockwise?: boolean;
}

export interface ResolvedPolarSweep {
	startAngle: number;
	/** `-1` for clockwise, `1` for counter-clockwise — multiply into an angular step. */
	direction: 1 | -1;
}

/** 12 o'clock: +π/2, as scene y points up. */
const DEFAULT_START_ANGLE = Math.PI / 2;

/**
 * Resolves `{ startAngle, clockwise }` to `{ startAngle, direction }`, filling
 * in the shared defaults (12 o'clock, clockwise).
 */
export function resolvePolarSweep(
	options: PolarSweepOptions | undefined,
): ResolvedPolarSweep {
	return {
		startAngle: options?.startAngle ?? DEFAULT_START_ANGLE,
		direction: (options?.clockwise ?? true) ? -1 : 1,
	};
}
