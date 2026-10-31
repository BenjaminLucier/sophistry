/**
 * `@sophistry/core`: the framework-free scene graph, its primitives,
 * animations and renderer.
 *
 * @module @sophistry/core
 * @packageDocumentation
 */

export * from "./anim";
export * from "./coords";
export * from "./entries/color";
export type {
	Bounds,
	Matrix,
	Point,
	Range,
	RangeTransition,
} from "./entries/geometry";
export * from "./entries/themes";
export * from "./export";
export type { Point3 } from "./geometry3d";
export type {
	BoundsSource,
	ClampOptions,
	ConstraintName,
	ConstraintSpec,
	DragConstraint,
	DragContext,
	SnapOptions,
	ValueSource,
} from "./interact/constrain";
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
} from "./interact/constrain";
export type {
	DraggableProps,
	DragOptions,
	DragParam,
	FlagSource,
} from "./interact/drag";
export { draggable } from "./interact/drag";
export type { DropOptions, DropTargetProps } from "./interact/drop";
export { dropTarget } from "./interact/drop";
export type {
	AngleParamOptions,
	LineSource,
	ScalarParamOptions,
} from "./interact/param";
export {
	angleParam,
	pathParam,
	pointParam,
	scalarParam,
} from "./interact/param";
export type { PointerChannel, ScenePointer } from "./interact/pointer";
export { createPointerChannel } from "./interact/pointer";
export type { FocusChannel, FocusSource } from "./interact/registry";
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
} from "./interact/types";
export * from "./labels";
export * from "./network";
export * from "./reactive";
export type { CameraView, PipCorner, Viewport } from "./render/camera";
export {
	FULL_VIEWPORT,
	pictureInPictureViewports,
	quadViewports,
	splitViewports,
} from "./render/camera";
export type { PointerDriver } from "./render/pointer";
export * from "./scene";
export * from "./shapes";
export type { ShapeGeometry, ShapeWrite } from "./spec/bake";
export type { ClipShape } from "./spec/clip";
export type { ColorRampSpec } from "./spec/colorRampProp";
export * from "./spec/gradient";
export * from "./spec/layout";
export type { ImagePixels } from "./spec/types";
export * from "./tween";
