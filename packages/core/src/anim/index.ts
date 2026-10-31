export type {
	Animation,
	CycleStart,
	LeafHooks,
	LeafTiming,
	Placed,
} from "./animation";
export {
	animation,
	compose,
	cycles,
	EPSILON,
	easedLeaf,
	restTime,
	sampleTime,
} from "./animation";
export type { DrawOptions, UnwriteOptions, WriteOptions } from "./draw";
export { draw, drawBorderThenFill, erase, unwrite, write } from "./draw";
export type { IndicateOptions } from "./emphasis";
export { circumscribe, flash, indicate, pulse, wiggle } from "./emphasis";
export type { FadeOptions } from "./fade";
export { fadeIn, fadeInFrom, fadeOut, fadeOutTo, fadeTo } from "./fade";
export type { SpinInOptions } from "./growing";
export {
	growFromCenter,
	growFromEdge,
	growFromPoint,
	shrinkToCenter,
	spinInFromNothing,
} from "./growing";
export type {
	ApplyWaveOptions,
	BlinkOptions,
	FocusOnOptions,
} from "./indication";
export {
	applyWave,
	blink,
	focusOn,
	passingFlash,
	showPassingFlash,
} from "./indication";
export type { MoveOptions } from "./move";
export {
	colorTo,
	moveAlong,
	moveBy,
	moveTo,
	rotateBy,
	rotateTo,
	scaleTo,
	valueTo,
} from "./move";
export type {
	ApplyFunctionOptions,
	PhaseFlowOptions,
	PointMapOptions,
} from "./movement";
export {
	applyComplexFunction,
	applyFunction,
	homotopy,
	phaseFlow,
} from "./movement";
export type { LaggedOptions, RepeatOptions } from "./sequence";
export { forever, hold, lagged, parallel, repeat, sequence } from "./sequence";
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
} from "./slots";
export {
	arcMotion,
	circleSlots,
	createSlots,
	gridSlots,
	rowSlots,
} from "./slots";
export type { SpeedSpec } from "./speed";
export { changeSpeed } from "./speed";
export type { FollowOptions, SpringToOptions } from "./spring";
export { follow, springTo } from "./spring";
export type {
	PlayContext,
	PlayResult,
	Timeline,
	TimelineInternals,
} from "./timeline";
export {
	anySignal,
	play,
	splitPlayArguments,
	timeline,
	timelineInternals,
} from "./timeline";
export type { MorphOptions } from "./transform";
export { morph, morphCurve, morphPath, morphWith } from "./transform";
export type { TweenOptions } from "./tween";
export { tween, wait } from "./tween";
export type {
	AnimOptions,
	DriveProgressOptions,
	DriveTrackOptions,
} from "./types";
export { driveProgress, driveTrack } from "./types";
