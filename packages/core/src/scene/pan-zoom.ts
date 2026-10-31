/**
 * `panZoom`: wheel, drag and pinch navigation that writes the `units` and
 * `center` tracks the scene (or one camera) reads. It owns nothing, so an
 * animation and a gesture can drive the same camera in turn.
 * `panZoomHandlers` is the gesture maths alone, with no scene around it.
 */

import type { Bounds, Point } from "../geometry";
import type { Track } from "../reactive";
import { track } from "../reactive";
import { mineCamera, subscribeCameraGesture } from "../render/camera-gesture";
import type {
	BackgroundPointerEvent,
	SceneWheelEvent,
} from "../render/pointer";
import type { Animatable } from "../tween/target";
import type { Scene } from "./scene";
import { sceneInternals } from "./scene";

/** @category Stage & cameras */
export interface PanZoomOptions {
	/**
	 * Scene units across the view — the camera's `units`, as a cell (a
	 * `track(...)`). Written on zoom, read on every gesture.
	 */
	units: Animatable<number>;
	/**
	 * The scene point at the middle of the view, in scene units — the camera's
	 * `center`, as a cell (a `trackPoint(...)`). Written on pan and zoom.
	 */
	center: Animatable<Point>;
	/**
	 * Live canonical-pixel positions of every pointer down — `driver.pointers`.
	 * Without it there is no pinch; everything else works. `panZoom` fills
	 * this in from the scene's driver.
	 */
	pointers?: Map<number, Point>;
	/** Canonical pixels → scene units — `driver.toScene`. Pinch needs it too. */
	toScene?: (at: Point) => Point;
	/**
	 * Only respond to gestures locked to this camera index (its order among the
	 * scene's cameras, from 0), so each pane is navigated independently.
	 * Omitted: respond to any camera, including the single view of a scene
	 * without cameras.
	 */
	camera?: number;
	/**
	 * Whether dragging empty space (and two-finger pinch movement) pans.
	 *
	 * @default true
	 */
	pan?: boolean;
	/**
	 * Whether the wheel and pinch zoom.
	 *
	 * @default true
	 */
	zoom?: boolean;
	/**
	 * Closest the camera may get, in scene units across the view. Fewer units is
	 * more zoomed in. Never below 1e-6.
	 *
	 * @default 1e-6
	 */
	minUnits?: number;
	/**
	 * Farthest the camera may get, in scene units across the view.
	 *
	 * @default Infinity
	 */
	maxUnits?: number;
	/** A box, in scene units, that the view's *centre* is kept inside. Unbounded when omitted. */
	bounds?: Bounds;
	/**
	 * Multiplies the wheel's effect.
	 *
	 * @default 1
	 */
	zoomSpeed?: number;
	/**
	 * What a plain (non-`ctrl`) wheel does. Defaults to `"zoom"`, the convention
	 * every graphing tool uses; `"pan"` is the document convention, where a
	 * two-finger scroll scrolls and only a pinch zooms.
	 */
	wheel?: "zoom" | "pan";
}

/**
 * The event handlers {@link panZoomHandlers} returns, ready to wire to a pointer driver.
 *
 * @category Stage & cameras
 */
export interface PanZoomHandlers {
	/** Handles a gesture that hit no node: pan with one pointer, pinch with two. */
	background(event: BackgroundPointerEvent): void;
	/**
	 * Handles a wheel event: zoom about the cursor, or pan, per
	 * `PanZoomOptions.wheel`. Returns `false` when it leaves the wheel alone
	 * (another camera's, or nothing enabled for it), so the driver offers it
	 * to the next stage listener.
	 */
	wheel(event: SceneWheelEvent): boolean;
	/** Forgets any gesture in flight: what disposing has to do. */
	reset(): void;
}

/** CSS pixels a `deltaMode` of lines or pages is worth. Firefox reports lines. */
const LINE_PIXELS = 16;
const PAGE_PIXELS = 400;

/** Wheel deltas in CSS pixels, whatever unit the browser chose to state them in. */
function wheelPixels(event: WheelEvent): Point {
	const factor =
		event.deltaMode === 1
			? LINE_PIXELS
			: event.deltaMode === 2
				? PAGE_PIXELS
				: 1;
	return { x: event.deltaX * factor, y: event.deltaY * factor };
}

function clampUnits(units: number, options: PanZoomOptions): number {
	const min = Math.max(options.minUnits ?? 1e-6, 1e-6);
	const max = options.maxUnits ?? Number.POSITIVE_INFINITY;
	return Math.min(max, Math.max(min, units));
}

function clampCenter(center: Point, options: PanZoomOptions): Point {
	const bounds = options.bounds;
	if (!bounds) return center;
	// The *centre* is clamped, not the visible box: clamping the box would need
	// the aspect ratio and would refuse to show a region smaller than the
	// viewport at all, which is the wrong answer for a zoomed-in scene.
	return {
		x: Math.min(bounds.maxX, Math.max(bounds.minX, center.x)),
		y: Math.min(bounds.maxY, Math.max(bounds.minY, center.y)),
	};
}

/**
 * Zoom by `factor` while pinning `at` — the scene point under the cursor stays
 * under the cursor.
 *
 * The derivation, since this is the formula everyone gets wrong: a screen
 * position is a fixed *fraction* of the viewport, so the scene offset it stands
 * for is that fraction times `units`. Scaling `units` by `k` therefore scales
 * every offset from the centre by `k`, and asking for `at` to keep its screen
 * position means `at - center` must scale by `k` too — hence
 * `center ← at - (at - center)·k`. `k` is the ratio actually applied rather
 * than the one requested, or the point would drift at the zoom limits.
 */
function zoomAbout(options: PanZoomOptions, at: Point, factor: number): void {
	const from = options.units.peek();
	const to = clampUnits(from * factor, options);
	const ratio = from === 0 ? 1 : to / from;
	if (to !== from) options.units.set(to);
	const center = options.center.peek();
	options.center.set(
		clampCenter(
			{
				x: at.x - (at.x - center.x) * ratio,
				y: at.y - (at.y - center.y) * ratio,
			},
			options,
		),
	);
}

/** The two-finger geometry: how far apart they are, and where their middle is. */
interface Pinch {
	/** Finger spacing as scene distance per unit of camera `units` — camera-independent. */
	distance: number;
	/** Scene units. */
	midpoint: Point;
	/** The camera's `units` when the pinch began — what the spread ratio is relative to. */
	units: number;
}

/**
 * The factor that takes the camera from `current` units to the units the
 * pinch asks for: `startUnits · (startDistance / distance)`.
 *
 * The ratio is against where the gesture *began*, so the factor handed to
 * `zoomAbout` must be the ratio of that target to the units *now*; applying
 * the full spread ratio to units that already include earlier moves would
 * compound, and the zoom would run away exponentially.
 */
export function pinchFactor(
	startUnits: number,
	startDistance: number,
	distance: number,
	currentUnits: number,
): number {
	if (!(currentUnits > 0)) return 1;
	return (startUnits * (startDistance / distance)) / currentUnits;
}

/**
 * Pan and zoom as three event handlers, with no scene around them: `panZoom`
 * is sugar over this, the way `splitScreen` is sugar over `splitViewports`.
 *
 * Options come through a getter so a live change (a new `maxUnits`, a camera
 * arriving) is picked up without rebuilding the handlers and losing the
 * gesture in flight.
 *
 * @param options - Getter for the current {@link PanZoomOptions}.
 * @returns Handlers to subscribe with `driver.onBackground` and `driver.onWheel`.
 *
 * @category Stage & cameras
 */
export function panZoomHandlers(
	options: () => PanZoomOptions,
): PanZoomHandlers {
	/**
	 * The scene point each background pointer grabbed, and the pinch it started.
	 *
	 * Everything below is *anchored* rather than incremental: each move asks
	 * "what would put the grabbed point back under the finger", never "how far
	 * has the finger moved since last time". Incremental is what accumulates
	 * error, and it is also what makes a clamped edge slide out from under the
	 * cursor instead of springing back when you drag away from it.
	 */
	const grabbed = new Map<number, Point>();
	let pinch: Pinch | null = null;

	function mine(camera: number): boolean {
		return mineCamera(options().camera, camera);
	}

	/** The live two-finger geometry, or null if it cannot be read this instant. */
	function pinchNow(): Pinch | null {
		const { pointers, toScene } = options();
		if (!pointers || !toScene) return null;
		const ids = [...grabbed.keys()].filter((id) => pointers.has(id));
		if (ids.length < 2) return null;
		const a = pointers.get(ids[0]) as Point;
		const b = pointers.get(ids[1]) as Point;
		const sa = toScene(a);
		const sb = toScene(b);
		const units = options().units.peek();
		return {
			// Scene distance per camera unit: proportional to the fingers' spacing
			// on the glass whatever the camera is doing. Canonical pixels would
			// not do for a camera pane, where they stretch with its zoom.
			distance: units > 0 ? Math.hypot(sb.x - sa.x, sb.y - sa.y) / units : 0,
			midpoint: toScene({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
			units,
		};
	}

	function panTo(target: Point, at: Point): void {
		const o = options();
		if (o.pan === false) return;
		const center = o.center.peek();
		// Grab the world: shift the centre by however far the grabbed point has
		// slid away from the finger. Self-correcting, so a frame where the camera
		// was moved by something else leaves no residue.
		o.center.set(
			clampCenter(
				{ x: center.x + target.x - at.x, y: center.y + target.y - at.y },
				o,
			),
		);
	}

	function pinchMove(): void {
		const now = pinchNow();
		if (!now) return;
		if (!pinch) {
			pinch = now;
			return;
		}
		const o = options();
		if (o.zoom !== false && now.distance > 0 && pinch.distance > 0) {
			// Two fingers a fixed distance apart on the glass span a scene distance
			// proportional to `units`, so holding the *grabbed* separation means
			// `units ← units · (grabbed / current)`.
			zoomAbout(
				o,
				now.midpoint,
				pinchFactor(pinch.units, pinch.distance, now.distance, o.units.peek()),
			);
		}
		// The zoom pinned the midpoint, so the scene point under the fingers'
		// middle is still `now.midpoint` and the two steps compose: zoom about
		// where the middle is, then slide what it grabbed back under it.
		panTo(pinch.midpoint, now.midpoint);
	}

	function background(event: BackgroundPointerEvent): void {
		if (!mine(event.camera)) return;
		const o = options();
		if (o.pan === false && o.zoom === false) return;

		if (event.phase === "down") {
			grabbed.set(event.pointerId, event.scene);
			pinch = grabbed.size >= 2 ? pinchNow() : null;
			return;
		}

		if (event.phase === "up" || event.phase === "cancel") {
			grabbed.delete(event.pointerId);
			pinch = null;
			// A finger lifting out of a pinch leaves the other one holding a grab
			// from before the zoom, which would jump the moment it moved. Re-grab
			// whatever it is over now.
			const { pointers, toScene } = o;
			if (grabbed.size === 1 && pointers && toScene) {
				for (const id of grabbed.keys()) {
					const at = pointers.get(id);
					if (at) grabbed.set(id, toScene(at));
				}
			}
			return;
		}

		if (!grabbed.has(event.pointerId)) return;
		if (grabbed.size >= 2) {
			pinchMove();
			return;
		}
		panTo(grabbed.get(event.pointerId) as Point, event.scene);
	}

	function wheel(event: SceneWheelEvent): boolean {
		if (!mine(event.camera)) return false;
		const o = options();
		const delta = wheelPixels(event.native);
		// `ctrlKey` on a wheel is a trackpad *pinch*, which browsers report as a
		// wheel with the modifier synthesised — no key is held. A plain delta is a
		// mouse notch or a two-finger scroll, and those two are not reliably
		// distinguishable, so `wheel` picks which reading they get.
		const zooming = event.native.ctrlKey || (o.wheel ?? "zoom") === "zoom";

		if (zooming && o.zoom !== false) {
			event.native.preventDefault();
			// A pinch's deltas are a few units per step where a mouse notch is ~100,
			// so the two need different sensitivities to feel like the same gesture.
			const rate = event.native.ctrlKey ? 0.01 : 0.002;
			zoomAbout(o, event.scene, Math.exp(delta.y * rate * (o.zoomSpeed ?? 1)));
			return true;
		}

		if (o.pan === false) return false;
		event.native.preventDefault();
		const center = o.center.peek();
		// `unitsPerPixel` carries the y flip, so scrolling down moves the camera
		// down the scene whichever way up the stage is.
		o.center.set(
			clampCenter(
				{
					x: center.x + delta.x * event.unitsPerPixel.x,
					y: center.y + delta.y * event.unitsPerPixel.y,
				},
				o,
			),
		);
		return true;
	}

	return {
		background,
		wheel,
		reset() {
			grabbed.clear();
			pinch = null;
		},
	};
}

/**
 * Options for {@link panZoom}: {@link PanZoomOptions} with `units` and
 * `center` optional (the scene's own framing, bound for you, when omitted)
 * and without `pointers` and `toScene`, which come from the scene's driver.
 *
 * @category Stage & cameras
 */
export interface PanZoomSceneOptions
	extends Omit<PanZoomOptions, "pointers" | "toScene" | "units" | "center"> {
	/**
	 * The `units` the scene (or the camera) reads. Omitted, a `track` starting
	 * at the scene's current width in units is made and bound with
	 * `scene.setView`; required with `camera`, since a camera's tracks are
	 * yours to hand it.
	 */
	units?: Animatable<number>;
	/** The `center` the scene (or the camera) reads; omitted, made and bound like `units`. */
	center?: Animatable<Point>;
	/**
	 * Where this stands in line for a wheel no shape took, among the scene's
	 * wheel listeners (another `panZoom`, an `OrbitControls3D`): higher hears it
	 * first, and the first that takes it stops it. Equal priorities go in
	 * subscription order. Read once.
	 *
	 * @default 0
	 */
	wheelPriority?: number;
}

/**
 * What {@link panZoom} returns.
 *
 * @category Stage & cameras
 */
export interface PanZoomController {
	/** The `units` being written: the one passed in, or the track made for the scene. */
	readonly units: Animatable<number>;
	/** The `center` being written: the one passed in, or the track made for the scene. */
	readonly center: Animatable<Point>;
	/** Puts `units` and `center` back where they were when `panZoom` was called. */
	reset(): void;
	/** Stops listening and forgets any gesture in flight. Idempotent; also runs when the scene is disposed. */
	dispose(): void;
}

/**
 * Lets the user pan and zoom the scene (or one camera) by writing its `units`
 * and `center`. Drag on empty space pans (drags on draggable shapes still move
 * the shape), the wheel zooms about the cursor, pinch zooms and pans.
 * `wheel: "pan"` makes a plain scroll pan. Sets `touch-action: none` on the
 * canvas until disposed. A headless scene has no pointer, so nothing is
 * listened to, but the tracks still bind.
 *
 * @example
 * ```ts
 * import { createScene, panZoom } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.getElementById("figure")!, units: 10 });
 * const navigation = panZoom(scene, { minUnits: 1, maxUnits: 100 });
 * document.getElementById("reset")?.addEventListener("click", () => navigation.reset());
 * ```
 *
 * @param scene - The scene to navigate.
 * @param options - See {@link PanZoomSceneOptions}.
 * @returns A {@link PanZoomController}.
 * @see {@link panZoomHandlers}
 * @see {@link https://sophistry.dev/guides/cameras/#pan-and-zoom}
 * @category Stage & cameras
 */
export function panZoom(
	scene: Scene,
	options: PanZoomSceneOptions = {},
): PanZoomController {
	if (options.camera !== undefined && (!options.units || !options.center)) {
		throw new TypeError(
			"panZoom: a camera's `units` and `center` must be passed in (the tracks the camera reads).",
		);
	}
	let units: Animatable<number>;
	let center: Animatable<Point>;
	if (options.units && options.center) {
		units = options.units;
		center = options.center;
	} else {
		const frame = scene.frame.peek();
		const own = {
			units: options.units ?? track(frame.maxX - frame.minX),
			center:
				options.center ??
				track<Point>({
					x: (frame.minX + frame.maxX) / 2,
					y: (frame.minY + frame.maxY) / 2,
				}),
		};
		units = own.units;
		center = own.center;
		scene.setView({
			units: options.units ? undefined : (own.units as Track<number>),
			center: options.center ? undefined : (own.center as Track<Point>),
		});
	}
	const initial = { units: units.peek(), center: center.peek() };
	const driver = sceneInternals(scene)?.driver ?? null;

	const handlers = panZoomHandlers(() => ({
		...options,
		units,
		center,
		pointers: driver?.pointers,
		toScene: driver?.toScene,
	}));
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
	sceneInternals(scene)?.onDispose(dispose);

	return {
		units,
		center,
		reset() {
			units.set(initial.units);
			center.set(initial.center);
		},
		dispose,
	};
}
