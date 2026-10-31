export type { WritePhase } from "../geometry/write-phase";
export { writeLagRatio, writePhase } from "../geometry/write-phase";
export type {
	Clock,
	ClockListener,
	ClockOptions,
	ReducedMotionTransition,
	VisibilityHandle,
} from "./clock";
export { createClock, defaultClock, watchClockVisibility } from "./clock";
export type { Easing, EasingFunction, EasingName } from "./easing";
export {
	easings,
	exponentialDecay,
	notQuiteThere,
	resolveEasing,
	runningStart,
	squish,
	thereAndBack,
	thereAndBackWithPause,
} from "./easing";
export type {
	FrameCallback,
	FrameParticipantOptions,
	FramePhase,
} from "./frame-loop";
export {
	currentFramePhase,
	onFrame,
	requestFrame,
	stepFrame,
	watch,
} from "./frame-loop";
export type { Interpolator } from "./interpolate";
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
} from "./interpolate";
export type { InterpolatorName } from "./interpolators";
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
} from "./interpolators";
export type { ReducedMotion } from "./reduced-motion";
export {
	prefersReducedMotion,
	resolveReducedMotion,
} from "./reduced-motion";
export type {
	SpringOptions,
	SpringProgress,
	SpringSpec,
	SpringState,
} from "./spring";
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
} from "./spring";
export type { Animatable, PathKey } from "./target";
export { lensTarget, propTarget, storeTarget } from "./target";
export { isTrack, trackPoint } from "./track";
