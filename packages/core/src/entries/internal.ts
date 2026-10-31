/**
 * `@sophistry/core/internal`: renderer, paint, bake, picking and frame
 * loop plumbing for extension packages (`text`, `charts`, `3d`), custom
 * renderers and the framework bindings.
 *
 * **Unstable**: not covered by semver.
 *
 * @module @sophistry/core/internal
 * @packageDocumentation
 */

// For @sophistry/charts: CSS strings from any colour input.
export { cssColor } from "../color/parse";
export { fullOptions } from "../coords/axes";
// For @sophistry/charts: how a chart's frame composes its axes, grid
// and titles out of the same pieces as `axes` and `numberPlane`.
export type {
	AxisTickSource,
	OriginFade,
	OriginNumberOptions,
} from "../coords/axis-composition";
export {
	axisTicksAt,
	contains,
	ORIGIN_ONLY,
	originBlocks,
	originFade,
	originWeight,
	resolveOrigin,
	weightedTicks,
	writesOrigin,
	yieldOrigin,
} from "../coords/axis-composition";
export type {
	AnchoredLabelOptions,
	AxisNumberOptions,
	NumberFormatOptions,
} from "../coords/axis-labels";
export {
	anchoredLabelPlace,
	anchoredLabelProps,
	axisFormatter,
	DEFAULT_NUMBER_FONT_SIZE,
	DEFAULT_NUMBER_GAP,
	DEFAULT_TICK_SIZE,
	measureAxisNumbers,
	numberStyle,
	stablePlace,
} from "../coords/axis-labels";
export { axisFacesFar } from "../coords/coords";
export type { GridLinesOptions } from "../coords/grid-lines";
export {
	DEFAULT_GRID_OPACITY,
	DEFAULT_GRID_STROKE_WIDTH,
	DEFAULT_GRID_Z_INDEX,
	gridLineNodes,
	stablePoint,
} from "../coords/grid-lines";
// For @sophistry/text: geometry helpers the LaTeX morph builds on.
export { unionBounds } from "../geometry/bounds";
// For @sophistry/charts: numeric helpers, segment stitching,
// triangulation and calendar axes the chart maths builds on.
export { delaunayTriangleIndices } from "../geometry/delaunay";
export { lerpPolyline } from "../geometry/lerp";
export {
	clamp01,
	clampNonNegative,
	finiteOrZero,
	finiteValues,
	hashUnit,
	maxOf,
	minOf,
	mix,
	polarPoint,
	TAU,
	wrapAngle,
} from "../geometry/num";
export type { Resolver } from "../geometry/resolver";
export { createResolver } from "../geometry/resolver";
export { calendarAxis } from "../geometry/scale/scales";
export { crossFade, FADE_STAGGER } from "../geometry/shape-match";
export { stitchSegments } from "../geometry/stitch";
export { axisTimeZone, temporalEpochMs } from "../geometry/time";
export type { PixelBox } from "../geometry/view-matrix";
export { isYUp, viewMatrix } from "../geometry/view-matrix";
export * from "../geometry3d";
export * from "../interact";
export * from "../render";
export type { CameraList } from "../scene/cameras";
export { createCameraList } from "../scene/cameras";
// The scene graph's plumbing: custom node classes, the commit engine and the
// interaction registry. Public definitions go through `defineShape` and
// friends on the root entry.
export { CompositeNode } from "../scene/composite";
export { BaseContainer } from "../scene/container";
export { watchFontLoads } from "../scene/fonts";
export type {
	SceneGraphOptions,
	SceneGraphStats,
} from "../scene/graph";
export { SceneGraph, SceneRoot } from "../scene/graph";
export { GroupNode } from "../scene/group";
export type { InstancesNodeProps } from "../scene/instance-node";
export { InstancesNodeImpl, instancesDefinition } from "../scene/instance-node";
export type { SceneInteractionRegistry } from "../scene/interaction";
export {
	createFocusChannel,
	createInteractionRegistry,
} from "../scene/interaction";
export {
	InteractionGroupNode,
	mergeHandlers,
} from "../scene/interaction-group";
export type { InteractionGroupValue } from "../scene/interaction-group-context";
export { interactionGroupContext } from "../scene/interaction-group-context";
export {
	ANY_CONTEXT,
	BaseNode,
	memo,
	ROOT_SPACE,
	sameMatrix,
} from "../scene/node";
export type { SceneInternals } from "../scene/scene";
// For the bindings: the scene box's default classes, restored when
// `boxClass` is removed.
export {
	DEFAULT_CLASS as DEFAULT_BOX_CLASS,
	sceneInternals,
} from "../scene/scene";
// For @sophistry/text: composites that hand their shape props to the
// shape node they own (`mathTex`).
export {
	forwardedProps,
	forwardHandlers,
	forwardProps,
	rawProp,
} from "../shapes/forward";
export * from "../spec";
// For the bindings' test harnesses: a clean frame loop between tests.
export { resetFrameLoop } from "../tween/frame-loop";
