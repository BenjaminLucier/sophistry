/**
 * The pointer driver against a fake canvas and a hand-built registry: camera
 * locking, slop in screen pixels, the spaces events report, wheel claiming
 * and the listener line, re-testing under a still pointer, items of batched
 * nodes, and the publish loop guard. The driver's deferred work runs on a
 * microtask (`schedule: queueMicrotask`), settled with `await settle()`.
 */

import { describe, expect, it } from "vitest";
import type { Matrix } from "../geometry/transform.js";
import { IDENTITY, translate } from "../geometry/transform.js";
import { viewMatrix } from "../geometry/view-matrix.js";
import type { InteractionRegistry } from "../interact/registry.js";
import type {
	HitCandidate,
	InteractionHandlers,
	InteractionRecord,
	ScenePointerEvent,
} from "../interact/types.js";
import { isFocusable } from "../interact/types.js";
import type { Readable } from "../reactive/index.js";
import { track } from "../reactive/index.js";
import type {
	DrawSpec,
	MarksSpec,
	ShapeSpec,
	TextSpec,
} from "../spec/types.js";
import type { CameraView } from "./camera.js";
import type { PointerDriverOptions } from "./pointer.js";
import { type BackgroundPointerEvent, createPointerDriver } from "./pointer.js";

const SIZE = { width: 800, height: 600 };

/** A constant `Readable`. */
const fixed = <T>(value: T): Readable<T> => ({
	peek: () => value,
	subscribe: () => () => {},
});

/** The driver's deferred work, run on a microtask. */
const schedule = (run: () => void) => {
	queueMicrotask(run);
	return undefined;
};

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
}

/** A registry over a fixed list of records (what `scene/interaction.ts` builds from nodes). */
function staticRegistry(list: InteractionRecord[] = []): InteractionRegistry {
	const candidates = new Map<number, HitCandidate>();
	for (const record of list) {
		candidates.set(record.id, {
			id: record.id,
			pointerEvents: record.pointerEvents(),
			hitArea: null,
		});
	}
	const some = (test: (record: InteractionRecord) => boolean) =>
		list.some(test);
	return {
		version: track(0),
		records: () => list,
		candidates: () => candidates,
		find: (id) => list.find((record) => record.id === id),
		hasDrag: () => some((r) => r.handlers().drag !== undefined),
		hasHover: () =>
			some((r) => {
				const h = r.handlers();
				return (
					h.onEnter !== undefined ||
					h.onLeave !== undefined ||
					h.hover !== undefined ||
					r.cursor() !== null
				);
			}),
		hasDrop: () => some((r) => r.handlers().drop !== undefined),
		hasWheel: () => some((r) => r.handlers().onWheel !== undefined),
		focusable: () => list.filter(isFocusable),
		membersOf: (id) => list.filter((r) => r.id === id),
	};
}

/** A record with the given handlers, sitting under `toScene`. */
function record(
	id: number,
	handlers: InteractionHandlers,
	toScene: Matrix = IDENTITY,
): InteractionRecord {
	return {
		id,
		toScene: () => toScene,
		toLocal: () => ({
			a: 1,
			b: 0,
			c: 0,
			d: 1,
			e: -toScene.e,
			f: -toScene.f,
		}),
		pointerEvents: () => "painted",
		hitArea: () => null,
		cursor: () => null,
		handlers: () => handlers,
		label: () => null,
		role: () => null,
		focusable: () => undefined,
		focusOwner: () => null,
	};
}

/** A driver on a fake canvas with fixed defaults; `overrides` replace any option. */
function driverOn(
	canvas: unknown,
	overrides: Partial<PointerDriverOptions> = {},
) {
	return createPointerDriver({
		canvas: canvas as HTMLCanvasElement,
		registry: staticRegistry(),
		snapshot: fixed<readonly DrawSpec[]>([]),
		size: fixed(SIZE),
		canonicalView: fixed(IDENTITY),
		schedule,
		...overrides,
	});
}

function fakeCanvas() {
	const listeners = new Map<string, Set<(e: never) => void>>();
	/** Each event type's latest `passive` option, as last added. */
	const passive = new Map<string, boolean | undefined>();
	const canvas = {
		style: {
			cursor: "",
			touchAction: "",
			setProperty() {},
		} as unknown as Record<string, string>,
		addEventListener(
			type: string,
			fn: (e: never) => void,
			options?: { passive?: boolean },
		) {
			const set = listeners.get(type) ?? new Set();
			listeners.set(type, set);
			set.add(fn);
			passive.set(type, options?.passive);
		},
		removeEventListener(type: string, fn: (e: never) => void) {
			listeners.get(type)?.delete(fn);
		},
		getBoundingClientRect: () => ({
			left: 0,
			top: 0,
			width: SIZE.width,
			height: SIZE.height,
		}),
		setPointerCapture() {},
		releasePointerCapture() {},
	};
	const fire = (type: string, e: object) => {
		for (const fn of listeners.get(type) ?? []) fn(e as never);
	};
	return { canvas, fire, listeners, passive };
}

function ptr(x: number, y: number, extra: object = {}) {
	return {
		pointerId: 1,
		pointerType: "mouse",
		button: 0,
		clientX: x,
		clientY: y,
		timeStamp: 0,
		...extra,
	};
}

function setup(cameras?: () => CameraView[]) {
	const c = fakeCanvas();
	const events: BackgroundPointerEvent[] = [];
	const driver = driverOn(c.canvas, {
		cameraViews: cameras
			? { peek: cameras, subscribe: () => () => {} }
			: undefined,
	});
	driver.onBackground((e) => events.push(e));
	return { ...c, driver, events, dispose: () => driver.destroy() };
}

describe("pointer driver", () => {
	it("ignores non-primary buttons", () => {
		const t = setup();
		t.fire("pointerdown", ptr(10, 10, { button: 2 }));
		t.fire("pointerdown", ptr(10, 10, { button: 1, pointerId: 2 }));
		expect(t.events).toEqual([]);
		t.fire("pointerdown", ptr(10, 10, { pointerType: "touch" }));
		expect(t.events.map((e) => e.phase)).toEqual(["down"]);
		t.dispose();
	});

	it("reads a locked camera's mapping live, so a pan does not accelerate", () => {
		const view: CameraView = {
			units: 8,
			center: { x: 0, y: 0 },
			yUp: true,
			viewport: { x: 0, y: 0, width: 1, height: 1 },
			border: null,
			borderWidth: 0,
			background: null,
		};
		const t = setup(() => [view]);
		t.fire("pointerdown", ptr(400, 300));
		const grab = t.events[0].scene;
		// Pan the way <PanZoom> does: shift the centre by grabbed - now.
		for (let x = 410; x <= 500; x += 10) {
			t.fire("pointermove", ptr(x, 300));
			const now = t.events[t.events.length - 1].scene;
			view.center = {
				x: view.center.x + grab.x - now.x,
				y: view.center.y + grab.y - now.y,
			};
		}
		// 100px of 800 across 8 units = 1 unit; the grab point is under the finger.
		expect(view.center.x).toBeCloseTo(-1, 6);
		t.dispose();
	});

	it("destroy ends in-flight gestures as cancelled and resets the canvas", () => {
		const t = setup();
		t.canvas.style.cursor = "pointer";
		t.canvas.style.touchAction = "none";
		t.fire("pointerdown", ptr(10, 10));
		t.driver.destroy();
		expect(t.events.map((e) => e.phase)).toEqual(["down", "cancel"]);
		expect(t.canvas.style.cursor).toBe("");
		expect(t.canvas.style.touchAction).toBe("");
		expect(t.driver.pointers.size).toBe(0);
		t.dispose();
	});
});

describe("pointer driver: hit testing in scene units", () => {
	const camera = (units: number, yUp = true): CameraView => ({
		units,
		center: { x: 0, y: 0 },
		yUp,
		viewport: { x: 0, y: 0, width: 1, height: 1 },
		border: null,
		borderWidth: 0,
		background: null,
	});

	const hairline: ShapeSpec = {
		kind: "shape",
		id: 1,
		zIndex: 0,
		polylines: [
			[
				{ x: -2, y: 0 },
				{ x: 2, y: 0 },
			],
		],
		closed: false,
		fillFrom: 0,
		style: {
			stroke: "#000",
			strokeWidth: 0.02,
			fill: null,
			along: null,
			opacity: 1,
			fillOpacity: 1,
			lineCap: "round",
			lineJoin: "round",
			dash: null,
			dashOffset: 0,
		},
		progress: 1,
	};

	function rig(options: {
		cameras?: CameraView[];
		specs: Array<ShapeSpec | TextSpec>;
		records: InteractionRecord[];
		canonical?: ReturnType<typeof viewMatrix>;
	}) {
		const c = fakeCanvas();
		const driver = driverOn(c.canvas, {
			registry: staticRegistry(options.records),
			snapshot: fixed<readonly DrawSpec[]>(options.specs),
			canonicalView: fixed(options.canonical ?? IDENTITY),
			cameraViews: options.cameras ? fixed(options.cameras) : undefined,
		});
		return { ...c, driver, dispose: () => driver.destroy() };
	}

	/** Press and release at a CSS point; returns what a tap handler saw, if any. */
	function tapAt(
		t: ReturnType<typeof rig>,
		x: number,
		y: number,
	): ScenePointerEvent | null {
		t.fire("pointerdown", ptr(x, y));
		t.fire("pointerup", ptr(x, y, { timeStamp: 10 }));
		return seen;
	}
	let seen: ScenePointerEvent | null = null;
	const onTap = (event: ScenePointerEvent) => {
		seen = event;
	};

	it("converts the screen-pixel slop into scene units by the camera's scale", async () => {
		// units 8 over 800px → 100px per scene unit: 8px of slop is 0.08 units.
		const t = rig({
			cameras: [camera(8)],
			specs: [hairline],
			records: [record(1, { onTap })],
		});
		await settle();
		seen = null;
		// 6px below the line (0.06 units): inside slop + half the stroke width.
		expect(tapAt(t, 400, 306)?.id).toBe(1);
		seen = null;
		// 12px (0.12 units): outside.
		expect(tapAt(t, 400, 312)).toBeNull();
		t.dispose();
	});

	it("the same 8px of slop is a much larger scene distance in a zoomed-out camera", async () => {
		// units 80 → 10px per scene unit: 8px of slop is 0.8 units.
		const t = rig({
			cameras: [camera(80)],
			specs: [hairline],
			records: [record(1, { onTap })],
		});
		await settle();
		seen = null;
		expect(tapAt(t, 400, 306)?.id).toBe(1); // 0.6 units away
		seen = null;
		expect(tapAt(t, 400, 312)).toBeNull(); // 1.2 units away
		t.dispose();
	});

	it("a plain stage uses its own view matrix the same way", async () => {
		const stage = viewMatrix(
			{ x: 0, y: 0, width: SIZE.width, height: SIZE.height },
			8,
			{ x: 0, y: 0 },
			true,
		);
		const t = rig({
			specs: [hairline],
			records: [record(1, { onTap })],
			canonical: stage,
		});
		await settle();
		seen = null;
		expect(tapAt(t, 400, 306)?.id).toBe(1);
		seen = null;
		expect(tapAt(t, 400, 312)).toBeNull();
		t.dispose();
	});

	it("reports the point in scene units, in the node's local units, and in the stage's own pixels", async () => {
		const stage = viewMatrix(
			{ x: 0, y: 0, width: SIZE.width, height: SIZE.height },
			16,
			{ x: 0, y: 0 },
			true,
		);
		// The node sits inside a group translated by (1, 0).
		const t = rig({
			cameras: [camera(8)],
			specs: [hairline],
			records: [record(1, { onTap }, translate(1, 0))],
			canonical: stage,
		});
		await settle();
		seen = null;
		const event = tapAt(t, 500, 300); // one unit right of centre at 100px/unit
		expect(event?.scene.x).toBeCloseTo(1, 9);
		expect(event?.scene.y).toBeCloseTo(0, 9);
		expect(event?.local.x).toBeCloseTo(0, 9);
		// The stage frames 16 units over 800px (50px/unit): scene x=1 → 450px.
		expect(event?.canonical.x).toBeCloseTo(450, 9);
		expect(event?.canonical.y).toBeCloseTo(300, 9);
		t.dispose();
	});

	it("a text run's hit box follows the picked view's y direction", async () => {
		const label: TextSpec = {
			kind: "text",
			id: 2,
			zIndex: 0,
			text: "Hi",
			at: { x: 0, y: 0 },
			rotation: 0,
			style: {
				fill: "#000",
				fontSize: 0.5,
				fontFamily: "sans-serif",
				fontWeight: 400,
				italic: false,
				align: "left",
				baseline: "top",
				opacity: 1,
				letterSpacing: 0,
			},
			progress: 1,
		};
		// 100px/unit. A top-baseline run hangs below its anchor *on screen*.
		const onScreenBelow = { x: 410, y: 320 }; // 20px below centre
		const onScreenAbove = { x: 410, y: 280 };
		for (const yUp of [true, false]) {
			const t = rig({
				cameras: [camera(8, yUp)],
				specs: [label],
				records: [record(2, { onTap })],
			});
			await settle();
			seen = null;
			expect(tapAt(t, onScreenBelow.x, onScreenBelow.y)?.id).toBe(2);
			seen = null;
			expect(tapAt(t, onScreenAbove.x, onScreenAbove.y)).toBeNull();
			t.dispose();
		}
	});
});

describe("pointer driver: wheels on nodes", () => {
	const square = (id: number, zIndex: number): ShapeSpec => ({
		kind: "shape",
		id,
		zIndex,
		polylines: [
			[
				{ x: -1, y: -1 },
				{ x: 1, y: -1 },
				{ x: 1, y: 1 },
				{ x: -1, y: 1 },
			],
		],
		closed: true,
		fillFrom: 0,
		style: {
			stroke: "#000",
			strokeWidth: 0,
			fill: "#000",
			along: null,
			opacity: 1,
			fillOpacity: 1,
			lineCap: "round",
			lineJoin: "round",
			dash: null,
			dashOffset: 0,
		},
		progress: 1,
	});
	function rig(records: InteractionRecord[]) {
		const c = fakeCanvas();
		// 100 px per scene unit, origin at (400, 300).
		const stage = viewMatrix(
			{ x: 0, y: 0, width: SIZE.width, height: SIZE.height },
			8,
			{ x: 0, y: 0 },
			true,
		);
		const driver = driverOn(c.canvas, {
			registry: staticRegistry(records),
			snapshot: fixed<readonly DrawSpec[]>([square(1, 0), square(2, 1)]),
			canonicalView: fixed(stage),
		});
		return { ...c, driver, dispose: () => driver.destroy() };
	}
	const wheel = (clientX: number) => {
		let prevented = false;
		return {
			event: {
				clientX,
				clientY: 300,
				deltaX: 0,
				deltaY: -100,
				deltaMode: 0,
				preventDefault() {
					prevented = true;
				},
			},
			prevented: () => prevented,
		};
	};

	it("the topmost node with onWheel claims it, through nodes without; the stage hears the rest", async () => {
		const got: string[] = [];
		let take = true;
		const t = rig([
			record(1, {
				onWheel: (e) => {
					got.push(`node ${e.id} at ${e.local.x.toFixed(1)}`);
					return take;
				},
			}),
			// On top, but with no `onWheel`: transparent to the wheel.
			record(2, { onTap: () => {} }),
		]);
		await settle();
		// Something takes wheels: the listener is no longer passive.
		expect(t.passive.get("wheel")).toBe(false);
		// A stage listener that only watches: it passes every wheel on.
		t.driver.onWheel(() => {
			got.push("stage");
			return false;
		});
		const over = wheel(450);
		t.fire("wheel", over.event);
		expect(got).toEqual(["node 1 at 0.5"]);
		expect(over.prevented()).toBe(true);
		// Off the node: the stage's listener.
		t.fire("wheel", wheel(700).event);
		expect(got.at(-1)).toBe("stage");
		// A node that declines passes it on, and the page keeps it unless the stage takes it.
		take = false;
		const declined = wheel(450);
		t.fire("wheel", declined.event);
		expect(got.slice(-2)).toEqual(["node 1 at 0.5", "stage"]);
		expect(declined.prevented()).toBe(false);
		t.dispose();
	});

	it("offers an unclaimed wheel to the stage's listeners in line, until one takes it", async () => {
		const got: string[] = [];
		const t = rig([]);
		await settle();
		let firstTakes = true;
		// Subscription order among equal priorities: "first" hears it first.
		t.driver.onWheel(() => {
			got.push("first");
			return firstTakes;
		});
		t.driver.onWheel(() => {
			got.push("second");
		});
		const one = wheel(450);
		t.fire("wheel", one.event);
		// The first took it: the second never heard it, and the page keeps still.
		expect(got).toEqual(["first"]);
		expect(one.prevented()).toBe(true);
		// The first declines: the second hears it, and taking it (any return
		// but `false`, `undefined` included) prevents the scroll.
		firstTakes = false;
		const two = wheel(450);
		t.fire("wheel", two.event);
		expect(got.slice(-2)).toEqual(["first", "second"]);
		expect(two.prevented()).toBe(true);
		t.dispose();
	});

	it("puts a higher priority first, and a wheel every listener declines scrolls the page", async () => {
		const got: string[] = [];
		const t = rig([]);
		await settle();
		let take = true;
		t.driver.onWheel(() => {
			got.push("default");
			return false;
		});
		const stopHigh = t.driver.onWheel(
			() => {
				got.push("high");
				return take;
			},
			{ priority: 1 },
		);
		t.driver.onWheel(
			() => {
				got.push("low");
				return false;
			},
			{ priority: -1 },
		);
		t.fire("wheel", wheel(450).event);
		expect(got).toEqual(["high"]);
		take = false;
		const declined = wheel(450);
		t.fire("wheel", declined.event);
		expect(got.slice(-3)).toEqual(["high", "default", "low"]);
		expect(declined.prevented()).toBe(false);
		// Unsubscribed: out of line.
		stopHigh();
		t.fire("wheel", wheel(450).event);
		expect(got.slice(-2)).toEqual(["default", "low"]);
		t.dispose();
	});

	it("a node's claim still comes before every stage listener", async () => {
		const got: string[] = [];
		const t = rig([
			record(1, {
				onWheel: () => {
					got.push("node");
				},
			}),
		]);
		await settle();
		t.driver.onWheel(
			() => {
				got.push("stage");
			},
			{ priority: 100 },
		);
		t.fire("wheel", wheel(450).event);
		expect(got).toEqual(["node"]);
		t.fire("wheel", wheel(700).event);
		expect(got).toEqual(["node", "stage"]);
		t.dispose();
	});

	it("stays passive while nothing takes wheels", async () => {
		const t = rig([record(1, { onTap: () => {} })]);
		await settle();
		expect(t.passive.get("wheel")).toBe(true);
		const stop = t.driver.onWheel(() => {});
		expect(t.passive.get("wheel")).toBe(false);
		stop();
		expect(t.passive.get("wheel")).toBe(true);
		t.dispose();
	});
});

describe("pointer driver: the view changing under a still pointer", () => {
	const cam = (units: number, cx = 0): CameraView => ({
		units,
		center: { x: cx, y: 0 },
		yUp: true,
		viewport: { x: 0, y: 0, width: 1, height: 1 },
		border: null,
		borderWidth: 0,
		background: null,
	});
	const hairline = (id: number): ShapeSpec => ({
		kind: "shape",
		id,
		zIndex: 0,
		polylines: [
			[
				{ x: -1, y: 0 },
				{ x: 1, y: 0 },
			],
		],
		closed: false,
		fillFrom: 0,
		style: {
			stroke: "#000",
			strokeWidth: 0.02,
			fill: null,
			along: null,
			opacity: 1,
			fillOpacity: 1,
			lineCap: "round",
			lineJoin: "round",
			dash: null,
			dashOffset: 0,
		},
		progress: 1,
	});
	function rig(initial: CameraView[], handlers: InteractionHandlers = {}) {
		const c = fakeCanvas();
		const specs = [hairline(1)];
		const cameras = track<readonly CameraView[]>(initial);
		const size = track(SIZE);
		const published: Array<{ x: number; y: number } | null> = [];
		const driver = driverOn(c.canvas, {
			registry: staticRegistry([record(1, handlers)]),
			snapshot: fixed<readonly DrawSpec[]>(specs),
			size,
			cameraViews: cameras,
			pointer: (value) => {
				published.push(value ? value.scene : null);
			},
		});
		return {
			...c,
			driver,
			dispose: () => driver.destroy(),
			setCameras: (views: CameraView[]) => cameras.set(views),
			setSize: (next: { width: number; height: number }) => size.set(next),
			published,
			settle,
		};
	}

	it("re-hit-tests when a camera moves under a stationary pointer", async () => {
		const enters: number[] = [];
		const leaves: number[] = [];
		const t = rig([cam(8)], {
			onEnter: (e) => enters.push(e.id as number),
			onLeave: (e) => leaves.push(e.id as number),
		});
		await t.settle();
		// 100px/unit; the line sits on y=0 which is the pane centre row (300).
		t.fire("pointermove", ptr(400, 300));
		expect(enters).toEqual([1]);
		// Pan the camera so the line is now far off (centre moves up 3 units).
		t.setCameras([{ ...cam(8), center: { x: 0, y: 3 } }]);
		await t.settle();
		expect(leaves).toEqual([1]);
		t.setCameras([cam(8)]);
		await t.settle();
		expect(enters).toEqual([1, 1]);
		t.dispose();
	});

	it("re-publishes the scene position when the camera moves, hover or not", async () => {
		const t = rig([cam(8)]);
		await t.settle();
		t.fire("pointermove", ptr(500, 300));
		expect(t.published.at(-1)?.x).toBeCloseTo(1, 6);
		t.setCameras([cam(8, 2)]);
		await t.settle();
		expect(t.published.at(-1)?.x).toBeCloseTo(3, 6);
		t.dispose();
	});

	it("re-tests when the stage resizes", async () => {
		const t = rig([cam(8)]);
		await t.settle();
		t.fire("pointermove", ptr(400, 300));
		const before = t.published.length;
		t.setSize({ width: 1600, height: 1200 });
		await t.settle();
		expect(t.published.length).toBeGreaterThan(before);
		t.dispose();
	});

	it("re-tests after a wheel listener moves the camera", async () => {
		const enters: number[] = [];
		const leaves: number[] = [];
		const t = rig([cam(8)], {
			onEnter: (e) => enters.push(e.id as number),
			onLeave: (e) => leaves.push(e.id as number),
		});
		t.driver.onWheel(() => {
			t.setCameras([{ ...cam(8), center: { x: 0, y: 3 } }]);
		});
		await t.settle();
		t.fire("pointermove", ptr(400, 300));
		expect(enters).toEqual([1]);
		t.fire("wheel", { clientX: 400, clientY: 300, deltaY: -100 });
		await t.settle();
		expect(leaves).toEqual([1]);
		t.dispose();
	});

	it("pinch positions follow the live camera for a stationary finger", async () => {
		const t = rig([cam(8)]);
		await t.settle();
		t.fire("pointerdown", ptr(300, 300, { pointerId: 1 }));
		t.fire("pointerdown", ptr(500, 300, { pointerId: 2 }));
		const a0 = t.driver.toScene(t.driver.pointers.get(1) as never);
		expect(a0.x).toBeCloseTo(-1, 6);
		// Camera pans 2 units right; finger 1 has not moved.
		t.setCameras([cam(8, 2)]);
		await t.settle();
		t.fire("pointermove", ptr(520, 300, { pointerId: 2 }));
		const a1 = t.driver.toScene(t.driver.pointers.get(1) as never);
		const b1 = t.driver.toScene(t.driver.pointers.get(2) as never);
		expect(a1.x).toBeCloseTo(1, 6);
		expect(b1.x).toBeCloseTo(3.2, 6);
		t.dispose();
	});
});

describe("pointer driver: items of a batched node", () => {
	const marks: MarksSpec = {
		kind: "marks",
		id: 1,
		zIndex: 0,
		shape: { kind: "circle" },
		count: 2,
		centers: new Float64Array([100, 100, 130, 100]),
		extents: new Float64Array([10, 10]),
		fills: "#000",
		alphas: null,
		style: {
			stroke: "none",
			strokeWidth: 0,
			fill: null,
			along: null,
			opacity: 1,
			fillOpacity: 1,
			lineCap: "round",
			lineJoin: "round",
			dash: null,
			dashOffset: 0,
		},
		progress: 1,
		bounds: { minX: 90, minY: 90, maxX: 140, maxY: 110 },
	};

	it("leaves one item and enters the next, on the same node", async () => {
		const c = fakeCanvas();
		const log: string[] = [];
		const driver = driverOn(c.canvas, {
			registry: staticRegistry([
				record(1, {
					onEnter: (e) => log.push(`enter ${e.id}:${e.item}`),
					onLeave: (e) => log.push(`leave ${e.id}:${e.item}`),
					onTap: (e) => log.push(`tap ${e.id}:${e.item}`),
				}),
			]),
			snapshot: fixed<readonly DrawSpec[]>([marks]),
		});
		const dispose = () => driver.destroy();
		await settle();
		c.fire("pointermove", ptr(100, 100));
		c.fire("pointermove", ptr(102, 100));
		c.fire("pointermove", ptr(130, 101));
		c.fire("pointermove", ptr(300, 300));
		expect(log).toEqual(["enter 1:0", "leave 1:0", "enter 1:1", "leave 1:1"]);
		c.fire("pointerdown", ptr(131, 100));
		c.fire("pointerup", ptr(131, 100));
		expect(log.at(-1)).toBe("tap 1:1");
		dispose();
	});
});

describe("pointer driver: a scene changing under a still pointer", () => {
	it("re-publishes the pointer only when it has something new to say", async () => {
		// A tooltip that follows the pointer is drawn into the scene, so every
		// publish moved it, the snapshot changed, the still pointer was re-tested
		// and published again: a loop that must be broken off.
		const c = fakeCanvas();
		const specs = track<readonly DrawSpec[]>([], { equals: false });
		const published: unknown[] = [];
		const driver = driverOn(c.canvas, {
			// Something hover-interested, as a tooltip's mark is.
			registry: staticRegistry([
				record(1, { onEnter: () => {}, onLeave: () => {} }),
			]),
			snapshot: specs,
			pointer: (value) => {
				published.push(value);
			},
		});
		const dispose = () => driver.destroy();
		await settle();
		c.fire("pointermove", ptr(100, 100));
		const after = published.length;
		for (let k = 0; k < 5; k++) {
			specs.set([]);
			await settle();
		}
		expect(published.length).toBe(after);
		dispose();
	});
});
