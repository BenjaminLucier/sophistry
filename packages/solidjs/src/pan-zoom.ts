/**
 * `usePanZoom` and `<PanZoom>`: core's `panZoom` attached to the enclosing
 * stage's scene for a component's lifetime.
 */

import type { JSX } from "@solidjs/web";
import type { PanZoomController, PanZoomSceneOptions } from "@sophistry/core";
import { panZoom } from "@sophistry/core";
import { onCleanup } from "solid-js";
import { useScene } from "./context";

/**
 * Options for {@link usePanZoom}: core's `PanZoomSceneOptions`.
 *
 * @category Stage & cameras
 */
export type UsePanZoomOptions = PanZoomSceneOptions;

/**
 * Lets the user pan and zoom the enclosing stage (or one camera) for the
 * component's lifetime: drag on empty space pans, the wheel zooms about the
 * cursor, pinch zooms and pans (core's `panZoom`). Pass the same `units` and
 * `center` tracks the `<Stage>` (or `<Camera>`) binds; omitted, `panZoom`
 * makes its own and binds them to the scene.
 *
 * The options object is spread at every gesture, so a Solid props object
 * passed through keeps `pan`, `zoom`, `minUnits`, `maxUnits`, `bounds`,
 * `zoomSpeed` and `wheel` live; `units`, `center`, `camera` and
 * `wheelPriority` are read once.
 *
 * @example
 * ```tsx
 * import { track, trackPoint } from "@sophistry/core";
 * import { Stage, usePanZoom } from "@sophistry/solidjs";
 *
 * const units = track(14);
 * const center = trackPoint(0, 0);
 *
 * function Navigation() {
 * 	usePanZoom({ units, center, minUnits: 4, maxUnits: 40 });
 * 	return null;
 * }
 *
 * export const Figure = () => (
 * 	<Stage units={units} center={center}>
 * 		<Navigation />
 * 	</Stage>
 * );
 * ```
 *
 * @param options - See {@link UsePanZoomOptions}.
 * @returns The controller (`units`, `center`, `reset`, `dispose`).
 * @throws When called outside a `<Stage>`.
 * @category Stage & cameras
 */
export function usePanZoom(options: UsePanZoomOptions = {}): PanZoomController {
	const controller = panZoom(useScene(), options);
	onCleanup(() => controller.dispose());
	return controller;
}

/**
 * Props for {@link PanZoom}: core's `PanZoomSceneOptions`, plus a `ref` that
 * receives the controller (for a reset button).
 *
 * @category Stage & cameras
 */
export interface PanZoomProps extends PanZoomSceneOptions {
	/** Called once with the controller. */
	ref?: (controller: PanZoomController) => void;
}

/**
 * {@link usePanZoom} as a component: place it inside
 * the `<Stage>` and give it the `units` and `center` tracks the stage binds.
 * Renders nothing; navigation stops when it is removed.
 *
 * @example
 * ```tsx
 * import { track, trackPoint } from "@sophistry/core";
 * import { NumberPlane, PanZoom, Stage } from "@sophistry/solidjs";
 *
 * const units = track(14);
 * const center = trackPoint(0, 0);
 *
 * export const Figure = () => (
 * 	<Stage units={units} center={center}>
 * 		<PanZoom units={units} center={center} minUnits={4} maxUnits={40} />
 * 		<NumberPlane xRange={[-20, 20, 1]} yRange={[-12, 12, 1]} width={40} height={24} />
 * 	</Stage>
 * );
 * ```
 *
 * @param props - See {@link PanZoomProps}; read as for {@link usePanZoom}.
 * @returns Nothing.
 * @throws When rendered outside a `<Stage>`.
 * @category Stage & cameras
 */
export function PanZoom(props: PanZoomProps): JSX.Element {
	const controller = usePanZoom(props);
	props.ref?.(controller);
	return null;
}
