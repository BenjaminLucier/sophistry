export type { WritePhase } from "../geometry/write-phase.js";
export { writeLagRatio, writePhase } from "../geometry/write-phase.js";
export type {
	Clock,
	ClockListener,
	ClockOptions,
	ReducedMotionTransition,
	VisibilityHandle,
} from "./clock.js";
export { createClock, defaultClock, watchClockVisibility } from "./clock.js";
export type { Easing, EasingFunction, EasingName } from "./easing.js";
export {
	easings,
	exponentialDecay,
	notQuiteThere,
	resolveEasing,
	runningStart,
	squish,
	thereAndBack,
	thereAndBackWithPause,
} from "./easing.js";
export type {
	FrameCallback,
	FrameParticipantOptions,
	FramePhase,
} from "./frame-loop.js";
export {
	currentFramePhase,
	onFrame,
	requestFrame,
	stepFrame,
	watch,
} from "./frame-loop.js";
export type { Interpolator } from "./interpolate.js";
// `lerpPoint` is deliberately not re-exported from this barrel: `geometry/`
// already publishes it (via `geometry/lerp.ts`, its canonical home — see
// that file's module doc), and `export *`-ing both from the package root
// (`src/index.ts`) would make the name ambiguous. Reach for it via
// `geometry/` at the package boundary, or `../tween/interpolate`
// from inside this package.
export {
	clamp,
	lerp,
	lerpPoint3,
	progressIn,
	remap,
} from "./interpolate.js";
export type { InterpolatorName } from "./interpolators.js";
export {
	auto,
	cssColorInterpolator,
	curvePathInterpolator,
	detectInterpolator,
	interpolators,
	matrixInterpolator,
	point3Interpolator,
	pointInterpolator,
	polylineInterpolator,
	resolveInterpolator,
} from "./interpolators.js";
export type { ReducedMotion } from "./reduced-motion.js";
export {
	prefersReducedMotion,
	resolveReducedMotion,
} from "./reduced-motion.js";
export type {
	SpringOptions,
	SpringProgress,
	SpringSpec,
	SpringState,
} from "./spring.js";
export {
	dampingRatio,
	naturalFrequency,
	spring,
	springAt,
	springDefaults,
	springEasing,
	springEnergyNorm,
	springProgress,
	springRestDelta,
	springSettleTime,
} from "./spring.js";
export type { Animatable, PathKey } from "./target.js";
export { lensTarget, propTarget, storeTarget } from "./target.js";
export { isTrack, trackPoint } from "./track.js";
