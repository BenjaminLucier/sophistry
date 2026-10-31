/**
 * `orbitControls3D`: drag to orbit, wheel to dolly, by writing the `eye`
 * track a `camera3D` reads (the 3D counterpart of core's `panZoom`). A
 * gesture and an animation can drive the same `eye` in turn. Pass the same
 * `target` to both. `orbitControlsHandlers` is the gesture maths alone, with
 * no scene around it.
 *
 * It subscribes through core's camera-gesture plumbing, the same way
 * `panZoom` does, so the two share one wheel line (`wheelPriority`, then
 * subscription order) and one touch claim when both are attached.
 */

import type { Animatable, Readable, Scene } from "@sophistry/core";
import { isReadable, pointerDriver } from "@sophistry/core";
import {
	type BackgroundPointerEvent,
	mineCamera,
	type Point3,
	type SceneWheelEvent,
	sceneInternals,
	subscribeCameraGesture,
} from "@sophistry/core/internal";

/** @category Controls */
export interface OrbitControls3DOptions {
	/** The `camera3D`'s `eye` (a world-space point), as a cell: the one thing this writes. */
	eye: Animatable<Point3>;
	/**
	 * The world-space point the camera orbits around. Keep equal to the `camera3D`'s `target`.
	 * Defaults to the origin.
	 */
	target?: Point3;
	/**
	 * Degrees of orbit per CSS pixel of drag.
	 * @default 0.4
	 */
	rotateSpeed?: number;
	/**
	 * Multiplies the wheel's dolly effect.
	 * @default 1
	 */
	zoomSpeed?: number;
	/**
	 * Closest the eye may dolly to `target`, in world units.
	 * @default 1
	 */
	minRadius?: number;
	/**
	 * Farthest the eye may dolly from `target`, in world units.
	 * @default Infinity
	 */
	maxRadius?: number;
	/**
	 * Degrees from the equator the eye may climb toward either pole. Defaults
	 * to 89: never quite 90, so azimuth stays well-defined instead of
	 * spinning freely at the moment `eye - target` lines up with up.
	 */
	maxElevation?: number;
	/**
	 * Whether dragging empty space orbits.
	 * @default true
	 */
	rotate?: boolean;
	/**
	 * Whether the wheel dollies the eye toward or away from `target`.
	 * @default true
	 */
	zoom?: boolean;
	/** Only respond to gestures locked to this camera index: see `panZoom`. */
	camera?: number;
}

/**
 * The event handlers {@link orbitControlsHandlers} returns, ready to wire to a pointer driver.
 *
 * @category Controls
 */
export interface OrbitControls3DHandlers {
	/** Handles a gesture that hit no node: drag orbits the eye around `target`. */
	background(event: BackgroundPointerEvent): void;
	/**
	 * Handles a wheel event: dollies the eye toward or away from `target`.
	 * Returns `false` when it leaves the wheel alone (another camera's, or
	 * `zoom: false`), so the next scene listener hears it.
	 */
	wheel(event: SceneWheelEvent): boolean;
	/** Forgets any gesture in flight: what disposing has to do. */
	reset(): void;
}

/** Degrees to radians: `rotateSpeed` and `maxElevation` are stated in degrees. */
const DEGREES_TO_RADIANS = Math.PI / 180;

/** CSS pixels a `deltaMode` of lines or pages is worth (as `panZoom`). Firefox reports lines. */
const LINE_PIXELS = 16;
const PAGE_PIXELS = 400;

const ORIGIN: Point3 = Object.freeze({ x: 0, y: 0, z: 0 });

/** A wheel's vertical delta in CSS pixels, whatever unit the browser chose to state it in. */
function wheelPixelsY(event: WheelEvent): number {
	const factor =
		event.deltaMode === 1
			? LINE_PIXELS
			: event.deltaMode === 2
				? PAGE_PIXELS
				: 1;
	return event.deltaY * factor;
}

/** `eye - target` as azimuth (around Y, 0 along +Z), elevation, and radius. */
function toSpherical(eye: Point3, target: Point3) {
	const dx = eye.x - target.x;
	const dy = eye.y - target.y;
	const dz = eye.z - target.z;
	const radius = Math.max(1e-6, Math.hypot(dx, dy, dz));
	return {
		radius,
		azimuth: Math.atan2(dx, dz),
		elevation: Math.asin(Math.min(1, Math.max(-1, dy / radius))),
	};
}

function fromSpherical(
	target: Point3,
	radius: number,
	azimuth: number,
	elevation: number,
): Point3 {
	const horizontal = radius * Math.cos(elevation);
	return {
		x: target.x + horizontal * Math.sin(azimuth),
		y: target.y + radius * Math.sin(elevation),
		z: target.z + horizontal * Math.cos(azimuth),
	};
}

function clampRadius(radius: number, options: OrbitControls3DOptions): number {
	const min = Math.max(options.minRadius ?? 1, 1e-6);
	const max = Math.max(min, options.maxRadius ?? Number.POSITIVE_INFINITY);
	return Math.min(max, Math.max(min, radius));
}

/**
 * Drag-to-orbit and wheel-to-dolly as three event handlers, with no scene
 * around them: {@link orbitControls3D} is sugar over this, the way `panZoom`
 * is sugar over `panZoomHandlers`.
 *
 * Incremental rather than anchored: `panZoomHandlers` re-derives `center`
 * from "what would put the grabbed scene point back under the finger" each
 * move, because a scene point is a stable thing to re-anchor to. A spherical
 * angle has no such anchor (the point under the cursor changes identity as
 * the camera turns), so this tracks the last canonical position per pointer
 * and applies the *delta* each move instead. Camera orbit controls converge
 * on this same choice everywhere they're built for exactly that reason.
 *
 * Options come through a getter so a live change (a new `maxRadius`, `rotate`
 * turned off) is picked up without rebuilding the handlers and losing the
 * gesture in flight.
 *
 * @example
 * ```ts
 * import { track } from "@sophistry/core";
 * import { type OrbitControls3DHandlers, orbitControlsHandlers } from "@sophistry/3d";
 *
 * // Your own pointer source; `orbitControls3D` wires the scene's for you.
 * declare const driver: {
 * 	onBackground(handler: OrbitControls3DHandlers["background"]): () => void;
 * 	onWheel(handler: OrbitControls3DHandlers["wheel"]): () => void;
 * };
 *
 * const eye = track({ x: 0, y: 0, z: 10 });
 * const handlers = orbitControlsHandlers(() => ({ eye, rotateSpeed: 0.2 }));
 * const stopBackground = driver.onBackground(handlers.background);
 * const stopWheel = driver.onWheel(handlers.wheel);
 * ```
 *
 * @param options - Getter for the current {@link OrbitControls3DOptions}.
 * @returns Handlers to subscribe with `driver.onBackground` and `driver.onWheel`.
 *
 * @category Controls
 */
export function orbitControlsHandlers(
	options: () => OrbitControls3DOptions,
): OrbitControls3DHandlers {
	/** The last canonical position of each background pointer down. */
	const last = new Map<number, { x: number; y: number }>();

	function mine(camera: number): boolean {
		return mineCamera(options().camera, camera);
	}

	function background(event: BackgroundPointerEvent): void {
		if (!mine(event.camera)) return;
		const o = options();
		if (o.rotate === false) return;

		if (event.phase === "down") {
			last.set(event.pointerId, event.canonical);
			return;
		}
		if (event.phase === "up" || event.phase === "cancel") {
			last.delete(event.pointerId);
			return;
		}

		const from = last.get(event.pointerId);
		if (!from) return;
		last.set(event.pointerId, event.canonical);

		const dx = event.canonical.x - from.x;
		const dy = event.canonical.y - from.y;
		if (dx === 0 && dy === 0) return;

		const target = o.target ?? ORIGIN;
		const speed = (o.rotateSpeed ?? 0.4) * DEGREES_TO_RADIANS;
		const spherical = toSpherical(o.eye.peek(), target);
		const maxElevation = (o.maxElevation ?? 89) * DEGREES_TO_RADIANS;

		o.eye.set(
			fromSpherical(
				target,
				spherical.radius,
				// A drag to the right should feel like walking the camera rightward
				// around the target, which is a *negative* azimuth step: azimuth
				// is measured the way `toSpherical` reads it back, not the way a
				// screen x-axis increases.
				spherical.azimuth - dx * speed,
				Math.min(
					maxElevation,
					Math.max(-maxElevation, spherical.elevation + dy * speed),
				),
			),
		);
	}

	function wheel(event: SceneWheelEvent): boolean {
		if (!mine(event.camera)) return false;
		const o = options();
		if (o.zoom === false) return false;
		event.native.preventDefault();

		const target = o.target ?? ORIGIN;
		const spherical = toSpherical(o.eye.peek(), target);
		// Multiplicative, like `panZoom`'s zoom: a notch feels the same size
		// whether the camera is close in or dollied far out.
		const factor = Math.exp(
			wheelPixelsY(event.native) * 0.002 * (o.zoomSpeed ?? 1),
		);
		const radius = clampRadius(spherical.radius * factor, o);

		o.eye.set(
			fromSpherical(target, radius, spherical.azimuth, spherical.elevation),
		);
		return true;
	}

	return {
		background,
		wheel,
		reset() {
			last.clear();
		},
	};
}

/**
 * Options for {@link orbitControls3D}: {@link OrbitControls3DOptions} with a
 * `target` that may be bound, plus the controller's place in the scene's
 * wheel line.
 *
 * @category Controls
 */
export interface OrbitControls3DSceneOptions
	extends Omit<OrbitControls3DOptions, "target"> {
	/**
	 * The world-space point the camera orbits around: the `camera3D`'s
	 * `target`. A `Readable` (the same track bound to the camera) is read at
	 * each gesture, so an animated target is followed. Defaults to the origin.
	 */
	target?: Point3 | Readable<Point3>;
	/**
	 * Where this stands in line for a wheel no shape took, among the scene's
	 * wheel listeners (a `panZoom`, another `orbitControls3D`): higher hears
	 * it first, and the first that takes it stops it. Equal priorities go in
	 * subscription order. Read once.
	 *
	 * @default 0
	 */
	wheelPriority?: number;
}

/**
 * What {@link orbitControls3D} returns.
 *
 * @category Controls
 */
export interface OrbitControls3DController {
	/** The `eye` being written: the one passed in. */
	readonly eye: Animatable<Point3>;
	/**
	 * Changes options live (`rotate`, `zoom`, speeds, limits, `target`,
	 * `camera`), keeping any gesture in flight. `eye` and `wheelPriority`
	 * are fixed at creation.
	 */
	update(
		changes: Partial<
			Omit<OrbitControls3DSceneOptions, "eye" | "wheelPriority">
		>,
	): void;
	/** Puts `eye` back where it was when `orbitControls3D` was called. */
	reset(): void;
	/** Stops listening and forgets any gesture in flight. Idempotent; also runs when the scene is disposed. */
	dispose(): void;
}

/**
 * Lets the user orbit and dolly a `camera3D` with the pointer, by writing the
 * `eye` cell it is given.
 *
 * Dragging empty space orbits the eye around `target` at `rotateSpeed`
 * degrees per CSS pixel (elevation limited by `maxElevation`); the wheel
 * dollies the eye toward or away from `target`, between `minRadius` and
 * `maxRadius`. The `camera3D` must be bound to the same cell (`eye: eye`) for
 * anything to move. A shape whose drag accepts the gesture, or whose
 * `onWheel` takes the wheel, wins over the orbit. Sets `touch-action: none`
 * on the canvas until disposed. A headless scene has no pointer, so nothing
 * is listened to.
 *
 * Alongside a `panZoom` on the same scene, both hear background drags, and exactly one takes each unclaimed wheel: the higher
 * `wheelPriority`, then whichever subscribed first. A listener with nothing
 * to do (`zoom: false`) passes the wheel on.
 *
 * @example
 * ```ts
 * import { createScene, track } from "@sophistry/core";
 * import { camera3D, cube3D, orbitControls3D } from "@sophistry/3d";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 10 });
 * const eye = track({ x: 6, y: 4, z: 8 });
 * scene.add(camera3D.create({ eye, children: [cube3D.create({ size: 2 })] }));
 * const orbit = orbitControls3D(scene, { eye, minRadius: 3, maxRadius: 30 });
 * document.querySelector<HTMLButtonElement>("#reset")!.onclick = () => orbit.reset();
 * ```
 *
 * @param scene - The scene whose pointer input drives the orbit.
 * @param options - See {@link OrbitControls3DSceneOptions}; `eye` is required.
 * @returns An {@link OrbitControls3DController}.
 * @see {@link orbitControlsHandlers}
 * @see {@link https://sophistry.dev/guides/3d/#drag-to-orbit}
 * @category Controls
 */
export function orbitControls3D(
	scene: Scene,
	options: OrbitControls3DSceneOptions,
): OrbitControls3DController {
	let current: OrbitControls3DSceneOptions = { ...options };
	const eye = options.eye;
	const initialEye = eye.peek();
	const driver = pointerDriver(scene);
	const internals = sceneInternals(scene);

	const handlers = orbitControlsHandlers(() => {
		const target = current.target;
		return {
			...current,
			eye,
			target: isReadable(target) ? (target.peek() as Point3) : target,
		};
	});
	const stop = driver
		? subscribeCameraGesture(driver, handlers, {
				wheelPriority: options.wheelPriority,
			})
		: () => {};
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		stop();
	};
	internals?.onDispose(dispose);

	return {
		eye,
		update(changes) {
			current = { ...current, ...changes };
		},
		reset() {
			eye.set(initialEye);
		},
		dispose,
	};
}
