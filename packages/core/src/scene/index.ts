/**
 * The scene graph: nodes, containers, definitions (`definePrimitive`,
 * `defineShape`, `defineText`, `defineMarks`, `defineImage`,
 * `defineComposite`), groups, the commit engine, and `createScene` with its
 * cameras.
 *
 * The plumbing (`SceneGraph`, `BaseNode`, `BaseContainer`, `ANY_CONTEXT`,
 * `sceneInternals`, `createCameraList`, the interaction registry, the node
 * classes) is left out on purpose; `entries/internal.ts` takes it from the
 * modules directly.
 */

export type {
	Camera,
	CameraHost,
	CameraLayout,
	CameraOptions,
	CameraPane,
	PictureInPictureLayout,
	SplitScreenLayout,
} from "./cameras.js";
export { pictureInPicture, quadView, splitScreen } from "./cameras.js";
export type {
	Changes,
	CompositeContext,
	CompositeOptions,
	ListOptions,
} from "./composite.js";
export { defineComposite } from "./composite.js";
export * from "./context.js";
export { fontEpochContext, measuresText } from "./fonts.js";
export type { GroupProps } from "./group.js";
export { group } from "./group.js";
export * from "./instances.js";
export type { InteractionGroupProps } from "./interaction-group.js";
export { interactionGroup } from "./interaction-group.js";
export * from "./interaction-props.js";
export * from "./marks.js";
export * from "./pan-zoom.js";
export * from "./path-batch.js";
export * from "./primitive.js";
export type {
	Scene,
	SceneBackground,
	SceneOptions,
	SceneSize,
	SceneView,
} from "./scene.js";
export { createScene, pointerDriver } from "./scene.js";
export * from "./shape.js";
export * from "./text.js";
export * from "./types.js";
