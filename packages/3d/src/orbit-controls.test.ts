// @vitest-environment happy-dom
/**
 * `orbitControlsHandlers` as pure gesture maths (driven with hand-made
 * events, like core's `pan-zoom.test.ts`), and `orbitControls3D` on a
 * mounted scene: real pointer and wheel events through the scene's driver,
 * the `eye` track bound to a `camera3D`, and the wheel line it shares with
 * `panZoom` (two stage-level wheel listeners, with a node's `onWheel` standing in for
 * a chart's zoom).
 *
 * The canvas measures 1000x500 CSS pixels at dpr 1 and the scenes are 10
 * units wide: 100 px per unit, scene origin at (500, 250), y up.
 */

import {
	type Animatable,
	createScene,
	panZoom,
	rect,
	type Scene,
	track,
} from "@sophistry/core";
import {
	type BackgroundPointerEvent,
	type Point3,
	resetFrameLoop,
	type SceneWheelEvent,
} from "@sophistry/core/internal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { camera3D } from "./camera3d.js";
import { orbitControls3D, orbitControlsHandlers } from "./orbit-controls.js";

function cell<T>(initial: T): Animatable<T> {
	let value = initial;
	return {
		peek: () => value,
		set: (next: T) => {
			value = next;
		},
	};
}

const radiusOf = (eye: Point3, target: Point3 = { x: 0, y: 0, z: 0 }) =>
	Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z);

const DEGREES = Math.PI / 180;

/** A background event at canonical `(x, y)`. */
function backgroundEvent(
	phase: BackgroundPointerEvent["phase"],
	x: number,
	y: number,
	extra: Partial<BackgroundPointerEvent> = {},
): BackgroundPointerEvent {
	return {
		phase,
		pointerId: 1,
		native: {} as PointerEvent,
		canonical: { x, y },
		scene: { x, y },
		camera: -1,
		...extra,
	};
}

/** A wheel event with `deltaY`, recording whether it was default-prevented. */
function wheelEvent(
	deltaY: number,
	extra: Partial<SceneWheelEvent> = {},
	deltaMode = 0,
) {
	const native = {
		deltaX: 0,
		deltaY,
		deltaMode,
		prevented: false,
		preventDefault() {
			native.prevented = true;
		},
	};
	const event: SceneWheelEvent = {
		native: native as unknown as WheelEvent,
		canonical: { x: 0, y: 0 },
		scene: { x: 0, y: 0 },
		camera: -1,
		unitsPerPixel: { x: 0.01, y: -0.01 },
		...extra,
	};
	return { event, native };
}

describe("orbitControlsHandlers: drag", () => {
	it("a drag right steps azimuth negative by rotateSpeed degrees per pixel, keeping the radius", () => {
		const eye = cell<Point3>({ x: 0, y: 0, z: 10 });
		const h = orbitControlsHandlers(() => ({ eye }));
		h.background(backgroundEvent("down", 0, 0));
		h.background(backgroundEvent("move", 100, 0));
		// 100 px at the default 0.4 degrees per pixel: 40 degrees.
		expect(eye.peek().x).toBeCloseTo(10 * Math.sin(-40 * DEGREES), 9);
		expect(eye.peek().z).toBeCloseTo(10 * Math.cos(-40 * DEGREES), 9);
		expect(eye.peek().y).toBeCloseTo(0, 9);
		expect(radiusOf(eye.peek())).toBeCloseTo(10, 9);
	});

	it("is incremental: two moves add up to one of the same total", () => {
		const eye = cell<Point3>({ x: 0, y: 0, z: 10 });
		const h = orbitControlsHandlers(() => ({ eye, rotateSpeed: 0.5 }));
		h.background(backgroundEvent("down", 0, 0));
		h.background(backgroundEvent("move", 30, 0));
		h.background(backgroundEvent("move", 60, 0));
		const azimuth = Math.atan2(eye.peek().x, eye.peek().z);
		expect(azimuth).toBeCloseTo(-30 * DEGREES, 9);
	});

	it("a vertical drag climbs in elevation, clamped at maxElevation", () => {
		const eye = cell<Point3>({ x: 0, y: 0, z: 10 });
		const h = orbitControlsHandlers(() => ({ eye, maxElevation: 30 }));
		h.background(backgroundEvent("down", 0, 0));
		h.background(backgroundEvent("move", 0, 50));
		// 50 px is 20 degrees: under the limit.
		expect(Math.asin(eye.peek().y / 10)).toBeCloseTo(20 * DEGREES, 9);
		h.background(backgroundEvent("move", 0, 500));
		expect(Math.asin(eye.peek().y / 10)).toBeCloseTo(30 * DEGREES, 9);
		h.background(backgroundEvent("move", 0, -2000));
		expect(Math.asin(eye.peek().y / 10)).toBeCloseTo(-30 * DEGREES, 9);
	});

	it("orbits about target, not the origin", () => {
		const target = { x: 5, y: 1, z: -2 };
		const eye = cell<Point3>({ x: 5, y: 1, z: 8 });
		const h = orbitControlsHandlers(() => ({ eye, target }));
		h.background(backgroundEvent("down", 0, 0));
		h.background(backgroundEvent("move", 225, 0));
		// 90 degrees to the right: from +Z of the target to -X of it.
		expect(eye.peek().x).toBeCloseTo(-5, 9);
		expect(eye.peek().z).toBeCloseTo(-2, 9);
		expect(radiusOf(eye.peek(), target)).toBeCloseTo(10, 9);
	});

	it("needs a down first, stops at up and cancel, and reset forgets the gesture", () => {
		const eye = cell<Point3>({ x: 0, y: 0, z: 10 });
		const h = orbitControlsHandlers(() => ({ eye }));
		h.background(backgroundEvent("move", 100, 0));
		expect(eye.peek()).toEqual({ x: 0, y: 0, z: 10 });
		h.background(backgroundEvent("down", 0, 0));
		h.background(backgroundEvent("up", 0, 0));
		h.background(backgroundEvent("move", 100, 0));
		expect(eye.peek()).toEqual({ x: 0, y: 0, z: 10 });
		h.background(backgroundEvent("down", 0, 0));
		h.background(backgroundEvent("cancel", 0, 0));
		h.background(backgroundEvent("move", 100, 0));
		expect(eye.peek()).toEqual({ x: 0, y: 0, z: 10 });
		h.background(backgroundEvent("down", 0, 0));
		h.reset();
		h.background(backgroundEvent("move", 100, 0));
		expect(eye.peek()).toEqual({ x: 0, y: 0, z: 10 });
	});

	it("rotate: false ignores drags; another camera's gestures are ignored", () => {
		const eye = cell<Point3>({ x: 0, y: 0, z: 10 });
		let rotate = false;
		const h = orbitControlsHandlers(() => ({ eye, rotate, camera: 1 }));
		h.background(backgroundEvent("down", 0, 0, { camera: 1 }));
		h.background(backgroundEvent("move", 100, 0, { camera: 1 }));
		expect(eye.peek()).toEqual({ x: 0, y: 0, z: 10 });
		// Read live: turning it back on needs no rebuild.
		rotate = true;
		h.background(backgroundEvent("down", 0, 0, { camera: 0 }));
		h.background(backgroundEvent("move", 100, 0, { camera: 0 }));
		expect(eye.peek()).toEqual({ x: 0, y: 0, z: 10 });
		h.background(backgroundEvent("down", 0, 0, { camera: 1 }));
		h.background(backgroundEvent("move", 100, 0, { camera: 1 }));
		expect(eye.peek().x).not.toBe(0);
	});
});

describe("orbitControlsHandlers: wheel", () => {
	it("dollies multiplicatively, keeps the direction, and prevents the page scroll", () => {
		const eye = cell<Point3>({ x: 0, y: 6, z: 8 });
		const h = orbitControlsHandlers(() => ({ eye }));
		const { event, native } = wheelEvent(-100);
		expect(h.wheel(event)).toBe(true);
		expect(native.prevented).toBe(true);
		expect(radiusOf(eye.peek())).toBeCloseTo(10 * Math.exp(-0.2), 9);
		expect(eye.peek().y / eye.peek().z).toBeCloseTo(6 / 8, 9);
	});

	it("zoomSpeed scales it, and line-mode deltas count as 16 px a line", () => {
		const eye = cell<Point3>({ x: 0, y: 0, z: 10 });
		const h = orbitControlsHandlers(() => ({ eye, zoomSpeed: 2 }));
		h.wheel(wheelEvent(50).event);
		expect(radiusOf(eye.peek())).toBeCloseTo(10 * Math.exp(0.2), 9);
		const other = cell<Point3>({ x: 0, y: 0, z: 10 });
		const lines = orbitControlsHandlers(() => ({ eye: other }));
		lines.wheel(wheelEvent(-3, {}, 1).event);
		expect(radiusOf(other.peek())).toBeCloseTo(10 * Math.exp(-48 * 0.002), 9);
	});

	it("clamps the radius to minRadius and maxRadius", () => {
		const eye = cell<Point3>({ x: 0, y: 0, z: 10 });
		const h = orbitControlsHandlers(() => ({
			eye,
			minRadius: 4,
			maxRadius: 20,
		}));
		h.wheel(wheelEvent(-5000).event);
		expect(radiusOf(eye.peek())).toBeCloseTo(4, 9);
		h.wheel(wheelEvent(5000).event);
		expect(radiusOf(eye.peek())).toBeCloseTo(20, 9);
		// The default floor is 1 world unit.
		const near = cell<Point3>({ x: 0, y: 0, z: 2 });
		orbitControlsHandlers(() => ({ eye: near })).wheel(wheelEvent(-5000).event);
		expect(radiusOf(near.peek())).toBeCloseTo(1, 9);
	});

	it("declines (returns false, no preventDefault) for zoom: false or another camera", () => {
		const eye = cell<Point3>({ x: 0, y: 0, z: 10 });
		const off = orbitControlsHandlers(() => ({ eye, zoom: false }));
		const first = wheelEvent(-100);
		expect(off.wheel(first.event)).toBe(false);
		expect(first.native.prevented).toBe(false);
		const pinned = orbitControlsHandlers(() => ({ eye, camera: 0 }));
		const second = wheelEvent(-100, { camera: 1 });
		expect(pinned.wheel(second.event)).toBe(false);
		expect(second.native.prevented).toBe(false);
		expect(eye.peek()).toEqual({ x: 0, y: 0, z: 10 });
	});
});

// ---------------------------------------------------------------------------
// On a mounted scene. A trimmed copy of core's `scene/test-dom.ts` (not
// exported): happy-dom has no 2D context, no layout and no real frames.

let restoreDom: () => void = () => {};
let frameQueue: FrameRequestCallback[] = [];
const scenes: Scene[] = [];

beforeEach(() => {
	resetFrameLoop();
	frameQueue = [];
	const globals = globalThis as Record<string, unknown>;
	const saved = {
		getContext: HTMLCanvasElement.prototype.getContext,
		rect: HTMLElement.prototype.getBoundingClientRect,
		raf: globals.requestAnimationFrame,
		caf: globals.cancelAnimationFrame,
		dpr: window.devicePixelRatio,
	};
	const context = new Proxy(
		{},
		{
			get: (_, prop) =>
				prop === "measureText" ? () => ({ width: 10 }) : () => {},
			set: () => true,
		},
	);
	HTMLCanvasElement.prototype.getContext = (() =>
		context) as unknown as typeof HTMLCanvasElement.prototype.getContext;
	HTMLElement.prototype.getBoundingClientRect = () =>
		({
			left: 0,
			top: 0,
			right: 1000,
			bottom: 500,
			x: 0,
			y: 0,
			width: 1000,
			height: 500,
		}) as DOMRect;
	globals.requestAnimationFrame = (callback: FrameRequestCallback) =>
		frameQueue.push(callback);
	globals.cancelAnimationFrame = () => {};
	window.devicePixelRatio = 1;
	restoreDom = () => {
		HTMLCanvasElement.prototype.getContext = saved.getContext;
		HTMLElement.prototype.getBoundingClientRect = saved.rect;
		globals.requestAnimationFrame = saved.raf;
		globals.cancelAnimationFrame = saved.caf;
		window.devicePixelRatio = saved.dpr;
		resetFrameLoop();
		document.body.innerHTML = "";
	};
});

afterEach(() => {
	for (const scene of scenes.splice(0)) scene.dispose();
	restoreDom();
});

/** Runs queued frames: commits, paints, and the driver's re-test. */
function frames(): void {
	for (let ran = 0; frameQueue.length > 0 && ran < 20; ran++) {
		for (const callback of frameQueue.splice(0)) callback(1000 + ran * 16);
	}
}

function mount(): Scene {
	const host = document.createElement("div");
	document.body.append(host);
	const scene = createScene({ host, units: 10 });
	scenes.push(scene);
	return scene;
}

/** Scene units to client pixels. */
const client = (x: number, y: number) => ({
	clientX: 500 + x * 100,
	clientY: 250 - y * 100,
});

/** Dispatches a pointer event at scene `(x, y)` on the scene's canvas. */
function fire(scene: Scene, type: string, x: number, y: number): void {
	const event = new PointerEvent(type, {
		bubbles: true,
		cancelable: true,
		pointerId: 1,
		pointerType: "mouse",
		button: 0,
		...client(x, y),
	});
	(scene.canvas as HTMLCanvasElement).dispatchEvent(event);
}

/** Dispatches a wheel at scene `(x, y)`; happy-dom's WheelEvent drops the mouse fields, so they are set here. */
function wheel(scene: Scene, x: number, y: number, deltaY: number): Event {
	const event = new Event("wheel", { cancelable: true });
	Object.assign(event, { ...client(x, y), deltaX: 0, deltaY, deltaMode: 0 });
	(scene.canvas as HTMLCanvasElement).dispatchEvent(event);
	return event;
}

describe("orbitControls3D on a scene", () => {
	it("dragging empty space orbits the eye the camera3D is bound to; the wheel dollies", () => {
		const scene = mount();
		const eye = track<Point3>({ x: 0, y: 0, z: 10 });
		const camera = scene.add(camera3D.create({ eye }));
		const orbit = orbitControls3D(scene, { eye });
		frames();
		expect(orbit.eye).toBe(eye);
		expect((scene.canvas as HTMLCanvasElement).style.touchAction).toBe("none");
		fire(scene, "pointerdown", 0, 0);
		fire(scene, "pointermove", 1, 0);
		fire(scene, "pointerup", 1, 0);
		// 100 px right: 40 degrees of negative azimuth.
		expect(eye.peek().x).toBeCloseTo(10 * Math.sin(-40 * DEGREES), 9);
		frames();
		expect(camera.get("eye")).toEqual(eye.peek());
		const event = wheel(scene, 0, 0, -100);
		expect(event.defaultPrevented).toBe(true);
		expect(radiusOf(eye.peek())).toBeCloseTo(10 * Math.exp(-0.2), 9);
		orbit.reset();
		expect(eye.peek()).toEqual({ x: 0, y: 0, z: 10 });
	});

	it("follows a bound target and takes live option changes through update", () => {
		const scene = mount();
		const target = track<Point3>({ x: 0, y: 0, z: 0 });
		const eye = track<Point3>({ x: 0, y: 0, z: 10 });
		const orbit = orbitControls3D(scene, { eye, target });
		frames();
		target.set({ x: 0, y: 0, z: 5 });
		wheel(scene, 0, 0, -5000);
		// Dollied to the default 1-unit floor around the moved target.
		expect(eye.peek().z).toBeCloseTo(6, 9);
		orbit.update({ zoom: false, rotate: false });
		const declined = wheel(scene, 0, 0, 100);
		expect(declined.defaultPrevented).toBe(false);
		fire(scene, "pointerdown", 0, 0);
		fire(scene, "pointermove", 1, 0);
		expect(eye.peek().z).toBeCloseTo(6, 9);
	});

	it("a node's onWheel wins over the dolly", () => {
		const scene = mount();
		const eye = track<Point3>({ x: 0, y: 0, z: 10 });
		orbitControls3D(scene, { eye });
		const wheels: number[] = [];
		scene.add(
			rect.create({
				center: { x: 0, y: 0 },
				width: 1,
				height: 1,
				fill: "#f00",
				onWheel: () => {
					wheels.push(1);
				},
			}),
		);
		frames();
		wheel(scene, 0, 0, -100);
		expect(wheels).toEqual([1]);
		expect(radiusOf(eye.peek())).toBe(10);
		// Off the node: the orbit's.
		wheel(scene, 3, 0, -100);
		expect(radiusOf(eye.peek())).toBeCloseTo(10 * Math.exp(-0.2), 9);
	});

	it("dispose stops listening and releases the touch claim; so does disposing the scene", () => {
		const scene = mount();
		const eye = track<Point3>({ x: 0, y: 0, z: 10 });
		const orbit = orbitControls3D(scene, { eye });
		orbit.dispose();
		orbit.dispose();
		frames();
		expect((scene.canvas as HTMLCanvasElement).style.touchAction).toBe("");
		wheel(scene, 0, 0, -100);
		expect(eye.peek()).toEqual({ x: 0, y: 0, z: 10 });
		// A controller left attached goes with its scene.
		const other = mount();
		const kept = orbitControls3D(other, { eye });
		other.dispose();
		expect(() => kept.dispose()).not.toThrow();
	});

	it("a headless scene has no pointer: nothing is listened to, nothing throws", () => {
		const scene = createScene({ headless: true, units: 10 });
		scenes.push(scene);
		const eye = track<Point3>({ x: 0, y: 0, z: 10 });
		const orbit = orbitControls3D(scene, { eye });
		orbit.reset();
		orbit.dispose();
		expect(eye.peek()).toEqual({ x: 0, y: 0, z: 10 });
	});
});

describe("orbitControls3D beside panZoom: two scene-level wheel listeners", () => {
	/** A `panZoom` and an `orbitControls3D` on one scene, subscribed in `order`. */
	function setup(
		order: "pan-first" | "orbit-first",
		options: { orbitPriority?: number; panZoom?: boolean } = {},
	) {
		const scene = mount();
		const eye = track<Point3>({ x: 0, y: 0, z: 10 });
		const units = track(10);
		const center = track({ x: 0, y: 0 });
		const pan = () =>
			panZoom(scene, {
				units,
				center,
				zoom: options.panZoom,
				pan: options.panZoom,
			});
		const orbit = () =>
			orbitControls3D(scene, { eye, wheelPriority: options.orbitPriority });
		if (order === "pan-first") {
			pan();
			orbit();
		} else {
			orbit();
			pan();
		}
		frames();
		return { scene, units, radius: () => radiusOf(eye.peek()) };
	}

	it("the first subscribed takes an unclaimed wheel, and the other never hears it", () => {
		const t = setup("pan-first");
		const event = wheel(t.scene, 0, 2, -100);
		expect(event.defaultPrevented).toBe(true);
		expect(t.units.peek()).toBeCloseTo(10 * Math.exp(-0.2), 9);
		expect(t.radius()).toBe(10);
		const u = setup("orbit-first");
		wheel(u.scene, 0, 2, -100);
		expect(u.radius()).toBeCloseTo(10 * Math.exp(-0.2), 9);
		expect(u.units.peek()).toBe(10);
	});

	it("a higher wheelPriority goes first; a listener with nothing to do passes it on", () => {
		const t = setup("pan-first", { orbitPriority: 1 });
		wheel(t.scene, 0, 2, -100);
		expect(t.radius()).toBeCloseTo(10 * Math.exp(-0.2), 9);
		expect(t.units.peek()).toBe(10);
		// A `panZoom` that neither zooms nor pans declines: the orbit dollies.
		const u = setup("pan-first", { panZoom: false });
		wheel(u.scene, 0, 2, -100);
		expect(u.radius()).toBeCloseTo(10 * Math.exp(-0.2), 9);
		expect(u.units.peek()).toBe(10);
	});
});
