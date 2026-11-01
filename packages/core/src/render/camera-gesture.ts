/**
 * The plumbing `panZoom` and `OrbitControls3D` share: the "locked to another
 * camera" gate, and subscribing to a pointer driver's background gestures,
 * unclaimed wheels and touch claim in one call. Their gesture maths stays
 * separate: pan/zoom re-anchors to a scene point; orbit tracks a delta.
 */

import type {
	BackgroundPointerEvent,
	PointerDriver,
	SceneWheelEvent,
} from "./pointer.js";

/**
 * Whether a gesture locked to `camera` belongs to a controller that only
 * wants a specific camera index (`wanted`). `undefined` means "any camera",
 * which is how a scene without cameras (camera index `-1`) is reached
 * without every controller having to special-case it.
 *
 * @param wanted - The controller's camera index, or undefined for any.
 * @param camera - The camera index a gesture is locked to.
 * @returns Whether the controller should handle it.
 *
 * @category Interaction plumbing
 */
export function mineCamera(
	wanted: number | undefined,
	camera: number,
): boolean {
	return wanted === undefined || wanted === camera;
}

/**
 * The three driver subscriptions every camera-navigation controller makes.
 *
 * @category Interaction plumbing
 */
export interface CameraGestureHandlers {
	background(event: BackgroundPointerEvent): void;
	/** Returns `false` to pass the wheel to the next scene listener (see `PointerDriver.onWheel`). */
	wheel(event: SceneWheelEvent): boolean;
	/** Forgets any gesture in flight: what unsubscribing has to do. */
	reset(): void;
}

/** @category Interaction plumbing */
export interface CameraGestureOptions {
	/**
	 * The wheel's place in line among the scene's wheel listeners: higher
	 * hears it first. Read once, on subscribing.
	 *
	 * @default 0
	 */
	wheelPriority?: number;
}

/**
 * Subscribes `handlers` to `driver`: background gestures, unclaimed wheels
 * (at `wheelPriority`) and a touch claim, so the canvas stops the page
 * scrolling under a finger while a camera can be dragged.
 *
 * @param driver - The scene's pointer driver.
 * @param handlers - What to call; see {@link CameraGestureHandlers}.
 * @param options - See {@link CameraGestureOptions}.
 * @returns A function that unsubscribes everything and calls `handlers.reset()`.
 *
 * @category Interaction plumbing
 */
export function subscribeCameraGesture(
	driver: PointerDriver,
	handlers: CameraGestureHandlers,
	options: CameraGestureOptions = {},
): () => void {
	const stops = [
		driver.onBackground(handlers.background),
		driver.onWheel(handlers.wheel, { priority: options.wheelPriority }),
		driver.claimTouch(),
	];
	let stopped = false;
	return () => {
		if (stopped) return;
		stopped = true;
		for (const stop of stops) stop();
		handlers.reset();
	};
}
