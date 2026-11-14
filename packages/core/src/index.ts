/**
 * `@sophistry/core`: the framework-free scene graph, its primitives,
 * animations and renderer.
 *
 * @module @sophistry/core
 * @packageDocumentation
 */

export * from "./anim/index.js";
export * from "./coords/index.js";
export * from "./entries/color.js";
export type {
	Bounds,
	Matrix,
	Point,
	Range,
	RangeTransition,
} from "./entries/geometry.js";
export * from "./entries/themes.js";
export * from "./export/index.js";
export type { Point3 } from "./geometry3d/index.js";
export type {
	BoundsSource,
	ClampOptions,
	ConstraintName,
	ConstraintSpec,
	DragConstraint,
	DragContext,
	SnapOptions,
	ValueSource,
} from "./interact/constrain.js";
export {
	alongDirection,
	alongPath,
	axisX,
	axisY,
	chain,
	constraints,
	free,
	inFrame,
	onCircle,
	snapTo,
	snapToGrid,
	toBounds,
} from "./interact/constrain.js";
export type {
	DraggableProps,
	DragOptions,
	DragParam,
	FlagSource,
} from "./interact/drag.js";
export { draggable } from "./interact/drag.js";
export type { DropOptions, DropTargetProps } from "./interact/drop.js";
export { dropTarget } from "./interact/drop.js";
export type {
	AngleParamOptions,
	LineSource,
	ScalarParamOptions,
} from "./interact/param.js";
export {
	angleParam,
	pathParam,
	pointParam,
	scalarParam,
} from "./interact/param.js";
export type { PointerChannel, ScenePointer } from "./interact/pointer.js";
export { createPointerChannel } from "./interact/pointer.js";
export type { FocusChannel, FocusSource } from "./interact/registry.js";
export type {
	DragBehaviour,
	DropTarget,
	HitArea,
	InteractionHandlers,
	InteractionProps,
	KeyboardBehaviour,
	PointerEvents,
	SceneNodeWheelEvent,
	ScenePointerEvent,
	Sink,
} from "./interact/types.js";
export * from "./labels/index.js";
export * from "./network/index.js";
export * from "./reactive/index.js";
export type { CameraView, PipCorner, Viewport } from "./render/camera.js";
export {
	FULL_VIEWPORT,
	pictureInPictureViewports,
	quadViewports,
	splitViewports,
} from "./render/camera.js";
export type { PointerDriver } from "./render/pointer.js";
export * from "./scene/index.js";
export * from "./shapes/index.js";
export type { ShapeGeometry, ShapeWrite } from "./spec/bake.js";
export type { ClipShape } from "./spec/clip.js";
export type { ColorRampSpec } from "./spec/colorRampProp.js";
export * from "./spec/gradient.js";
export * from "./spec/layout.js";
export type {
	LaidOutFragment,
	LayoutRun,
	TextLayout,
	TextLayoutOptions,
} from "./spec/text-layout.js";
export { layoutText } from "./spec/text-layout.js";
export type { ImagePixels } from "./spec/types.js";
export * from "./tween/index.js";
