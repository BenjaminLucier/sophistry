export type {
	Animation,
	CycleStart,
	LeafHooks,
	LeafTiming,
	Placed,
} from "./animation.js";
export {
	animation,
	compose,
	cycles,
	EPSILON,
	easedLeaf,
	restTime,
	sampleTime,
} from "./animation.js";
export type { DrawOptions, UnwriteOptions, WriteOptions } from "./draw.js";
export { draw, drawBorderThenFill, erase, unwrite, write } from "./draw.js";
export type { IndicateOptions } from "./emphasis.js";
export { circumscribe, flash, indicate, pulse, wiggle } from "./emphasis.js";
export type { FadeOptions } from "./fade.js";
export { fadeIn, fadeInFrom, fadeOut, fadeOutTo, fadeTo } from "./fade.js";
export type { SpinInOptions } from "./growing.js";
export {
	growFromCenter,
	growFromEdge,
	growFromPoint,
	shrinkToCenter,
	spinInFromNothing,
} from "./growing.js";
export type {
	ApplyWaveOptions,
	BlinkOptions,
	FocusOnOptions,
} from "./indication.js";
export {
	applyWave,
	blink,
	focusOn,
	passingFlash,
	showPassingFlash,
} from "./indication.js";
export type { MoveOptions } from "./move.js";
export {
	colorTo,
	moveAlong,
	moveBy,
	moveTo,
	rotateBy,
	rotateTo,
	scaleTo,
	valueTo,
} from "./move.js";
export type {
	ApplyFunctionOptions,
	PhaseFlowOptions,
	PointMapOptions,
} from "./movement.js";
export {
	applyComplexFunction,
	applyFunction,
	homotopy,
	phaseFlow,
} from "./movement.js";
export type { LaggedOptions, RepeatOptions } from "./sequence.js";
export {
	forever,
	hold,
	lagged,
	parallel,
	repeat,
	sequence,
} from "./sequence.js";
export type {
	ArcMotionOptions,
	CircleSlotsOptions,
	GridSlotsOptions,
	Motion,
	MotionContext,
	Presence,
	RowSlotsOptions,
	SlotItem,
	SlotLayout,
	SlotOpOptions,
	SlotPlan,
	Slots,
	SlotsOptions,
} from "./slots.js";
export {
	arcMotion,
	circleSlots,
	createSlots,
	gridSlots,
	rowSlots,
} from "./slots.js";
export type { SpeedSpec } from "./speed.js";
export { changeSpeed } from "./speed.js";
export type { FollowOptions, SpringToOptions } from "./spring.js";
export { follow, springTo } from "./spring.js";
export type {
	PlayContext,
	PlayResult,
	Timeline,
	TimelineInternals,
} from "./timeline.js";
export {
	anySignal,
	play,
	splitPlayArguments,
	timeline,
	timelineInternals,
} from "./timeline.js";
export type { MorphOptions } from "./transform.js";
export { morph, morphCurve, morphPath, morphWith } from "./transform.js";
export type { TweenOptions } from "./tween.js";
export { tween, wait } from "./tween.js";
export type {
	AnimOptions,
	DriveProgressOptions,
	DriveTrackOptions,
} from "./types.js";
export { driveProgress, driveTrack } from "./types.js";
