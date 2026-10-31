/**
 * `@sophistry/solidjs`: Solid bindings for Sophistry. Every core
 * definition as a component (generated: `export const Circle =
 * wrap(circle);`), `<Stage>`, `<MultiStage>`, `<Camera>`, the camera layouts
 * (`<SplitScreen>`, `<PictureInPicture>`, `<QuadView>`), `<PanZoom>`, and
 * hooks.
 *
 * Components are not DOM components. Each runs once, makes one retained
 * scene node, and returns its handle; the stage collects the handles and core
 * owns the tree from then on. A changed Solid prop is forwarded with one
 * `node.set(key, value)`; nothing re-renders.
 *
 * ## Tracks in Solid
 *
 * For per-frame animation, pass the `Readable` itself as the prop. It binds
 * in core: the animation writes the track, the node pulls it at commit, and
 * no Solid code runs per frame.
 *
 * ```tsx
 * const radius = track(1);                      // or useTrack(1)
 * <Circle radius={radius} />                    // binds: zero Solid work per frame
 * player.play(valueTo(radius, 3, { duration: 1 }));
 * ```
 *
 * A Solid signal works too (`radius={size()}`), but every change then runs a
 * Solid effect and a `set`: fine for state that changes on user input, wasteful
 * for 60 writes a second. Use `useTrackValue(track)` only to show a value in
 * DOM or for logic that must run in Solid.
 *
 * @module @sophistry/solidjs
 * @packageDocumentation
 */

export type { ClockProviderProps } from "./clock";
export { ClockProvider } from "./clock";
export { useClock, useScene } from "./context";
export * from "./generated/core.gen";
export type {
	UseMovablePointOptions,
	UseMovablePointResult,
	UsePlayerOptions,
	UsePlayerResult,
} from "./hooks";
export {
	useMovablePoint,
	usePlayer,
	useTheme,
	useTrack,
	useTrackValue,
} from "./hooks";
export type {
	CameraPaneProps,
	PictureInPictureProps,
	QuadViewProps,
	SplitScreenProps,
} from "./layouts";
export { PictureInPicture, QuadView, SplitScreen } from "./layouts";
export type { PanZoomProps, UsePanZoomOptions } from "./pan-zoom";
export { PanZoom, usePanZoom } from "./pan-zoom";
export type { CameraProps, MultiStageProps, StageProps } from "./stage";
export { Camera, MultiStage, Stage } from "./stage";
export type { ComponentProps } from "./wrap";
export { wrap } from "./wrap";
