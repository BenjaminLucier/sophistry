/**
 * `usePanZoom` and `<PanZoom>`: core's `panZoom` attached to the enclosing
 * stage's scene while a component is mounted.
 */

import type { PanZoomController, PanZoomSceneOptions } from "@sophistry/core";
import { panZoom } from "@sophistry/core";
import {
	type ReactNode,
	type Ref,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useScene } from "./hooks.js";

/**
 * Options for {@link usePanZoom}: core's `PanZoomSceneOptions`.
 *
 * @category Stage & cameras
 */
export type UsePanZoomOptions = PanZoomSceneOptions;

/**
 * A view of the latest options: `panZoom` spreads its options at every
 * gesture, so reading through this keeps them as of the last render without
 * re-attaching.
 */
function liveOptions(latest: {
	readonly current: UsePanZoomOptions;
}): UsePanZoomOptions {
	return new Proxy({} as UsePanZoomOptions, {
		get: (_, key) => Reflect.get(latest.current, key),
		has: (_, key) => Reflect.has(latest.current, key),
		ownKeys: () => Reflect.ownKeys(latest.current),
		getOwnPropertyDescriptor: (_, key) => {
			const descriptor = Reflect.getOwnPropertyDescriptor(latest.current, key);
			return descriptor ? { ...descriptor, configurable: true } : undefined;
		},
	});
}

/**
 * Lets the user pan and zoom the enclosing stage (or one camera) while the
 * component is mounted: drag on empty space pans, the wheel zooms about the
 * cursor, pinch zooms and pans (core's `panZoom`). Pass the same `units` and
 * `center` tracks the `<Stage>` (or `<Camera>`) binds (`useTrack`); omitted,
 * `panZoom` makes its own and binds them to the scene.
 *
 * Attaches in a layout effect. `pan`, `zoom`, `minUnits`, `maxUnits`,
 * `bounds`, `zoomSpeed` and `wheel` are read at each gesture, so the latest
 * render's values apply; `units`, `center`, `camera` and `wheelPriority` are
 * read when it attaches.
 *
 * @example
 * ```tsx
 * import type { Point, Track } from "@sophistry/core";
 * import { Stage, usePanZoom, useTrack } from "@sophistry/react";
 *
 * function Navigation({ units, center }: { units: Track<number>; center: Track<Point> }) {
 * 	usePanZoom({ units, center, minUnits: 4, maxUnits: 40 });
 * 	return null;
 * }
 *
 * function Figure() {
 * 	const units = useTrack(14);
 * 	const center = useTrack({ x: 0, y: 0 });
 * 	return (
 * 		<Stage units={units} center={center}>
 * 			<Navigation units={units} center={center} />
 * 		</Stage>
 * 	);
 * }
 * ```
 *
 * @param options - See {@link UsePanZoomOptions}.
 * @returns The controller once attached (null during the first render).
 * @throws Outside a `<Stage>`.
 * @category Stage & cameras
 */
export function usePanZoom(
	options: UsePanZoomOptions = {},
): PanZoomController | null {
	const scene = useScene();
	const latest = useRef(options);
	latest.current = options;
	const [controller, setController] = useState<PanZoomController | null>(null);
	useLayoutEffect(() => {
		const attached = panZoom(scene, liveOptions(latest));
		setController(attached);
		return () => {
			attached.dispose();
			setController(null);
		};
	}, [scene]);
	return controller;
}

/**
 * Props for {@link PanZoom}: core's `PanZoomSceneOptions`, plus a `ref` that
 * receives the controller (for a reset button).
 *
 * @category Stage & cameras
 */
export interface PanZoomProps extends PanZoomSceneOptions {
	/** The controller while attached, null otherwise. */
	ref?: Ref<PanZoomController | null>;
}

/**
 * {@link usePanZoom} as a component: place it inside
 * the `<Stage>` and give it the `units` and `center` tracks the stage binds.
 * Renders nothing; navigation stops when it unmounts.
 *
 * @example
 * ```tsx
 * import { NumberPlane, PanZoom, Stage, useTrack } from "@sophistry/react";
 *
 * function Figure() {
 * 	const units = useTrack(14);
 * 	const center = useTrack({ x: 0, y: 0 });
 * 	return (
 * 		<Stage units={units} center={center}>
 * 			<PanZoom units={units} center={center} minUnits={4} maxUnits={40} />
 * 			<NumberPlane xRange={[-20, 20, 1]} yRange={[-12, 12, 1]} width={40} height={24} />
 * 		</Stage>
 * 	);
 * }
 * ```
 *
 * @param props - See {@link PanZoomProps}; read as for {@link usePanZoom}.
 * @returns Nothing.
 * @throws Outside a `<Stage>`.
 * @category Stage & cameras
 */
export function PanZoom(props: PanZoomProps): ReactNode {
	const { ref, ...options } = props;
	const controller = usePanZoom(options);
	useImperativeHandle<PanZoomController | null, PanZoomController | null>(
		ref,
		() => controller,
		[controller],
	);
	return null;
}
