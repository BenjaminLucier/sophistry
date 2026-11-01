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
export { cssColor } from "../color/parse.js";
export { fullOptions } from "../coords/axes.js";
// For @sophistry/charts: how a chart's frame composes its axes, grid
// and titles out of the same pieces as `axes` and `numberPlane`.
export type {
	AxisTickSource,
	OriginFade,
	OriginNumberOptions,
} from "../coords/axis-composition.js";
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
} from "../coords/axis-composition.js";
export type {
	AnchoredLabelOptions,
	AxisNumberOptions,
	NumberFormatOptions,
} from "../coords/axis-labels.js";
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
} from "../coords/axis-labels.js";
export { axisFacesFar } from "../coords/coords.js";
export type { GridLinesOptions } from "../coords/grid-lines.js";
export {
	DEFAULT_GRID_OPACITY,
	DEFAULT_GRID_STROKE_WIDTH,
	DEFAULT_GRID_Z_INDEX,
	gridLineNodes,
	stablePoint,
} from "../coords/grid-lines.js";
// For @sophistry/text: geometry helpers the LaTeX morph builds on.
export { unionBounds } from "../geometry/bounds.js";
// For @sophistry/charts: numeric helpers, segment stitching,
// triangulation and calendar axes the chart maths builds on.
export { delaunayTriangleIndices } from "../geometry/delaunay.js";
export { lerpPolyline } from "../geometry/lerp.js";
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
} from "../geometry/num.js";
export type { Resolver } from "../geometry/resolver.js";
export { createResolver } from "../geometry/resolver.js";
export { calendarAxis } from "../geometry/scale/scales.js";
export { crossFade, FADE_STAGGER } from "../geometry/shape-match.js";
export { stitchSegments } from "../geometry/stitch.js";
export { axisTimeZone, temporalEpochMs } from "../geometry/time.js";
export type { PixelBox } from "../geometry/view-matrix.js";
export { isYUp, viewMatrix } from "../geometry/view-matrix.js";
export * from "../geometry3d/index.js";
export * from "../interact/index.js";
export * from "../render/index.js";
export type { CameraList } from "../scene/cameras.js";
export { createCameraList } from "../scene/cameras.js";
// The scene graph's plumbing: custom node classes, the commit engine and the
// interaction registry. Public definitions go through `defineShape` and
// friends on the root entry.
export { CompositeNode } from "../scene/composite.js";
export { BaseContainer } from "../scene/container.js";
export { watchFontLoads } from "../scene/fonts.js";
export type {
	SceneGraphOptions,
	SceneGraphStats,
} from "../scene/graph.js";
export { SceneGraph, SceneRoot } from "../scene/graph.js";
export { GroupNode } from "../scene/group.js";
export type { InstancesNodeProps } from "../scene/instance-node.js";
export {
	InstancesNodeImpl,
	instancesDefinition,
} from "../scene/instance-node.js";
export type { SceneInteractionRegistry } from "../scene/interaction.js";
export {
	createFocusChannel,
	createInteractionRegistry,
} from "../scene/interaction.js";
export {
	InteractionGroupNode,
	mergeHandlers,
} from "../scene/interaction-group.js";
export type { InteractionGroupValue } from "../scene/interaction-group-context.js";
export { interactionGroupContext } from "../scene/interaction-group-context.js";
export {
	ANY_CONTEXT,
	BaseNode,
	memo,
	ROOT_SPACE,
	sameMatrix,
} from "../scene/node.js";
export type { SceneInternals } from "../scene/scene.js";
// For the bindings: the scene box's default classes, restored when
// `boxClass` is removed.
export {
	DEFAULT_CLASS as DEFAULT_BOX_CLASS,
	sceneInternals,
} from "../scene/scene.js";
// For @sophistry/text: composites that hand their shape props to the
// shape node they own (`mathTex`).
export {
	forwardedProps,
	forwardHandlers,
	forwardProps,
	rawProp,
} from "../shapes/forward.js";
export * from "../spec/index.js";
// For the bindings' test harnesses: a clean frame loop between tests.
export { resetFrameLoop } from "../tween/frame-loop.js";
