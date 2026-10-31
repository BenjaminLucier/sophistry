/**
 * `@sophistry/react`: React bindings for Sophistry. A custom reconciler
 * renders Sophistry elements straight into the core scene graph; every
 * primitive and composite is a generated component (`Circle = wrap(circle)`).
 *
 * - `<Stage>` renders a `<div>` with a scene in it; its children are
 *   Sophistry elements (`<Circle>`, `<Group>`, ...) and components that
 *   render them. Each element is one host fiber over one scene node: a
 *   re-render calls `node.set` for the props that changed, nothing else.
 * - `useScene`, `useClock`, `usePlayer`, `useTheme` find the enclosing
 *   stage's scene; `useTrack` and `useTrackValue` connect tracks and
 *   components; `useMovablePoint` makes a draggable point; `usePanZoom` (or
 *   `<PanZoom>`) navigates the stage.
 * - `<Camera>` adds a view; `<SplitScreen>`, `<PictureInPicture>` and
 *   `<QuadView>` arrange two or four.
 * - `ref` on an element is its node handle (`bounds()`, `set(...)`); `ref`
 *   on `<Stage>` is the `Scene`.
 *
 * ## Tracks in React
 *
 * Make a track with `useTrack` and pass **the track itself** as the prop.
 * The node binds to it: animating it (`player.play(valueTo(radius, 2))`, a
 * drag, a spring) repaints the scene without a single React render.
 *
 * ```tsx
 * const radius = useTrack(1);
 * const player = usePlayer();
 * return <Circle radius={radius} onTap={() => player.play(valueTo(radius, 2))} />;
 * ```
 *
 * `useTrackValue(track)` re-renders the component on every change: use it
 * for DOM text and logic (a readout beside the stage), never to feed a value
 * back into a scene prop, which would re-render React once per frame.
 *
 * @module @sophistry/react
 * @packageDocumentation
 */

export type { CameraProps } from "./camera";
export { Camera } from "./camera";
export type { ClockProviderProps } from "./context";
export { ClockProvider } from "./context";
export * from "./generated/core.gen";
export type { MovablePoint, Player, PlayerOptions } from "./hooks";
export {
	useClock,
	useMovablePoint,
	usePlayer,
	useScene,
	useTheme,
	useTrack,
	useTrackValue,
} from "./hooks";
export type { InstancesProps } from "./instances";
export { Instances } from "./instances";
export type {
	CameraPaneProps,
	PictureInPictureProps,
	QuadViewProps,
	SplitScreenProps,
} from "./layouts";
export { PictureInPicture, QuadView, SplitScreen } from "./layouts";
export type { PanZoomProps, UsePanZoomOptions } from "./pan-zoom";
export { PanZoom, usePanZoom } from "./pan-zoom";
export type { MultiStageProps, StageProps } from "./stage";
export { MultiStage, Stage } from "./stage";
export type { ComponentProps, SophistryComponent } from "./wrap";
export { wrap } from "./wrap";
