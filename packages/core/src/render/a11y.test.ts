// @vitest-environment happy-dom
/**
 * The accessibility mirror against hand-built fakes of the registry and focus
 * channel: placement through the canonical view, cameras and dpr; tab order;
 * labels, roles and states; focus kept in step both ways; the keyboard; item
 * lists for batched nodes; and `dispose`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Point } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import { IDENTITY, rotate } from "../geometry/transform.js";
import { viewMatrix } from "../geometry/view-matrix.js";
import type {
	FocusChannel,
	FocusSource,
	InteractionRegistry,
} from "../interact/registry.js";
import type {
	InteractionHandlers,
	InteractionRecord,
	ScenePointerEvent,
} from "../interact/types.js";
import { isFocusable } from "../interact/types.js";
import { type Track, track } from "../reactive/index.js";
import type {
	DrawSpec,
	MarksSpec,
	ShapeSpec,
	StrokeStyle,
} from "../spec/types.js";
import { resetFrameLoop, stepFrame } from "../tween/frame-loop.js";
import type {
	AccessibilityDriver,
	AccessibilityMirror,
	FocusItem,
} from "./a11y.js";
import { createAccessibilityMirror, focusIds } from "./a11y.js";
import type { CameraView } from "./camera.js";

const style: StrokeStyle = {
	stroke: "black",
	strokeWidth: 0,
	fill: null,
	along: null,
	opacity: 1,
	fillOpacity: 1,
	lineCap: "round",
	lineJoin: "round",
	dash: null,
	dashOffset: 0,
};

/** A 1000x500 canvas at `units` wide, origin in the middle, y up. */
const stageView = (units: number): Matrix =>
	viewMatrix(
		{ x: 0, y: 0, width: 1000, height: 500 },
		units,
		{ x: 0, y: 0 },
		true,
	);

/** An axis-aligned rect's spec, centred at `center`. */
function rect(id: number, center: Point, width = 1, height = 1): ShapeSpec {
	const minX = center.x - width / 2;
	const minY = center.y - height / 2;
	return {
		kind: "shape",
		id,
		zIndex: 0,
		polylines: [
			[
				{ x: minX, y: minY },
				{ x: minX + width, y: minY },
				{ x: minX + width, y: minY + height },
				{ x: minX, y: minY + height },
			],
		],
		closed: true,
		fillFrom: 0,
		style,
		progress: 1,
	};
}

/** A batched marks spec with its items at `points`. */
function marks(id: number, points: [number, number][]): MarksSpec {
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	return {
		kind: "marks",
		id,
		zIndex: 0,
		shape: { kind: "circle" },
		count: points.length,
		centers: new Float64Array(points.flat()),
		extents: new Float64Array(points.length).fill(0.1),
		fills: "red",
		alphas: null,
		style,
		progress: 1,
		bounds: {
			minX: Math.min(...xs) - 0.1,
			minY: Math.min(...ys) - 0.1,
			maxX: Math.max(...xs) + 0.1,
			maxY: Math.max(...ys) + 0.1,
		},
	};
}

interface RecordOptions {
	label?: string | null;
	role?: string | null;
	pressed?: boolean | null;
	focusable?: boolean;
	focusOwner?: number | null;
	toLocal?: Matrix;
	handlers?: InteractionHandlers;
}

/** A hand-built record; `handlers` defaults to a bare `onTap`. */
function record(id: number, options: RecordOptions = {}): InteractionRecord {
	const handlers = options.handlers ?? { onTap: () => {} };
	return {
		id,
		toScene: () => IDENTITY,
		toLocal: () => options.toLocal ?? IDENTITY,
		pointerEvents: () => "painted",
		hitArea: () => null,
		cursor: () => null,
		handlers: () => handlers,
		label: () => options.label ?? null,
		role: () => options.role ?? null,
		pressed: () => options.pressed ?? null,
		focusable: () => options.focusable,
		focusOwner: () => options.focusOwner ?? null,
	};
}

/** A registry over a records track, as the scene's would behave. */
function fakeRegistry(
	records: Track<InteractionRecord[]>,
): InteractionRegistry {
	const version = track(0);
	records.subscribe(() => version.set(version.peek() + 1));
	const membersOf = (id: number) =>
		records
			.peek()
			.filter((member) => member.id === id || member.focusOwner() === id);
	return {
		version,
		records: () => records.peek(),
		candidates: () => new Map(),
		find: (id) => records.peek().find((member) => member.id === id),
		hasDrag: () => false,
		hasHover: () => false,
		hasDrop: () => false,
		hasWheel: () => false,
		focusable: () => records.peek().filter(isFocusable),
		membersOf,
	};
}

/** A focus channel that, like the scene's, ignores a write of what it holds. */
function fakeFocus(): FocusChannel {
	const state = track<{ id: number | null; source: FocusSource }>({
		id: null,
		source: "script",
	});
	return {
		state,
		set(id, source = "script") {
			const now = state.peek();
			if (now.id !== id || now.source !== source) state.set({ id, source });
		},
	};
}

interface Harness {
	host: HTMLElement;
	records: Track<InteractionRecord[]>;
	registry: InteractionRegistry;
	focus: FocusChannel;
	snapshot: Track<readonly DrawSpec[]>;
	size: Track<{ width: number; height: number }>;
	canonicalView: Track<Matrix>;
	cameraViews: Track<readonly CameraView[]>;
	dpr: Track<number>;
	items: (FocusItem | null)[];
	cancelled: (number | null | undefined)[];
	picked: { at: Point; exclude: number | null | undefined }[];
	inFlight: { value: boolean };
	mirror: AccessibilityMirror;
}

let harness: Harness | null = null;
let clock = 0;

function setup(
	records: InteractionRecord[],
	specs: DrawSpec[],
	options: { units?: number; dpr?: number; cameras?: CameraView[] } = {},
): Harness {
	const host = document.createElement("div");
	host.style.position = "relative";
	document.body.append(host);
	const recordsTrack = track(records);
	const registry = fakeRegistry(recordsTrack);
	const focus = fakeFocus();
	const snapshot = track<readonly DrawSpec[]>(specs);
	const size = track({ width: 1000, height: 500 });
	const canonicalView = track(stageView(options.units ?? 10));
	const cameraViews = track<readonly CameraView[]>(options.cameras ?? []);
	const dpr = track(options.dpr ?? 1);
	const items: (FocusItem | null)[] = [];
	const cancelled: (number | null | undefined)[] = [];
	const picked: { at: Point; exclude: number | null | undefined }[] = [];
	const inFlight = { value: false };
	const driver: AccessibilityDriver = {
		pick(at, exclude) {
			picked.push({ at, exclude });
			return 99;
		},
		cancel(id) {
			cancelled.push(id);
			const was = inFlight.value;
			inFlight.value = false;
			return was;
		},
	};
	const mirror = createAccessibilityMirror({
		host,
		registry,
		focus,
		snapshot,
		size,
		canonicalView,
		cameraViews,
		dpr,
		driver: () => driver,
		onItem: (current) => items.push(current),
	});
	harness = {
		host,
		records: recordsTrack,
		registry,
		focus,
		snapshot,
		size,
		canonicalView,
		cameraViews,
		dpr,
		items,
		cancelled,
		picked,
		inFlight,
		mirror,
	};
	return harness;
}

/** Runs the commit and paint phases of one frame, where the mirror updates. */
const frame = () => {
	clock += 16;
	stepFrame(clock, { tick: false });
};

const elements = (host: HTMLElement) => [
	...host.querySelectorAll<HTMLElement>("[data-vis-focus]"),
];

const boxes = (host: HTMLElement) =>
	elements(host).map((element) => ({
		label: element.getAttribute("aria-label"),
		left: element.style.left,
		top: element.style.top,
		width: element.style.width,
		height: element.style.height,
	}));

const labels = (host: HTMLElement) =>
	elements(host).map((element) => element.getAttribute("aria-label"));

const mirrorOf = (host: HTMLElement, label: string) => {
	const element = host.querySelector<HTMLElement>(
		`[data-vis-focus][aria-label="${label}"]`,
	);
	if (!element) throw new Error(`no mirror labelled ${label}`);
	return element;
};

const key = (
	element: HTMLElement,
	name: string,
	init: KeyboardEventInit = {},
) => {
	const event = new KeyboardEvent("keydown", {
		key: name,
		bubbles: true,
		cancelable: true,
		...init,
	});
	element.dispatchEvent(event);
	return event;
};

const camera = (overrides: Partial<CameraView>): CameraView => ({
	units: 10,
	center: { x: 0, y: 0 },
	yUp: true,
	viewport: { x: 0, y: 0, width: 1, height: 1 },
	border: null,
	borderWidth: 0,
	background: null,
	...overrides,
});

beforeEach(() => {
	resetFrameLoop();
});

afterEach(() => {
	harness?.mirror.dispose();
	harness?.host.remove();
	harness = null;
	resetFrameLoop();
});

describe("placement", () => {
	it("sits over the node's box: scene bounds through the stage's view matrix", () => {
		const { host } = setup(
			[record(1, { label: "a" })],
			[rect(1, { x: 1, y: 0 })],
		);
		// 1000x500 canvas at 10 units wide: 100px per unit, origin at (500, 250).
		expect(boxes(host)).toEqual([
			{
				label: "a",
				left: "550px",
				top: "200px",
				width: "100px",
				height: "100px",
			},
		]);
	});

	it("follows a zoom without any spec changing, at the next frame", () => {
		const { host, canonicalView } = setup(
			[record(1, { label: "a" })],
			[rect(1, { x: 1, y: 0 })],
		);
		canonicalView.set(stageView(5));
		// Coalesced: nothing moves until the frame's paint phase.
		expect(boxes(host)[0]?.left).toBe("550px");
		frame();
		expect(boxes(host)).toEqual([
			{
				label: "a",
				left: "600px",
				top: "150px",
				width: "200px",
				height: "200px",
			},
		]);
	});

	it("follows the snapshot as the node moves", () => {
		const { host, snapshot } = setup(
			[record(1, { label: "a" })],
			[rect(1, { x: 1, y: 0 })],
		);
		snapshot.set([rect(1, { x: 2, y: 0 })]);
		frame();
		expect(boxes(host)[0]?.left).toBe("650px");
	});

	it("converts device pixels to CSS pixels by the dpr", () => {
		const { host } = setup(
			[record(1, { label: "a" })],
			[rect(1, { x: 1, y: 0 })],
			{
				dpr: 2,
			},
		);
		expect(boxes(host)).toEqual([
			{
				label: "a",
				left: "275px",
				top: "100px",
				width: "50px",
				height: "50px",
			},
		]);
	});

	it("covers an interaction group's members with the owner's one element", () => {
		const { host } = setup(
			[
				record(1, { label: "group", focusOwner: 1 }),
				record(2, { focusOwner: 1 }),
			],
			[rect(1, { x: 0, y: 0 }), rect(2, { x: 2, y: 0 })],
		);
		expect(boxes(host)).toEqual([
			{
				label: "group",
				left: "450px",
				top: "200px",
				width: "300px",
				height: "100px",
			},
		]);
	});

	it("is no tab stop for a node that drew nothing or is entirely off the canvas", () => {
		const { host } = setup(
			[
				record(1, { label: "drawn" }),
				record(2, { label: "nothing" }),
				record(3, { label: "away" }),
			],
			[rect(1, { x: 0, y: 0 }), rect(3, { x: 40, y: 0 })],
		);
		expect(labels(host)).toEqual(["drawn"]);
	});

	it("goes through the topmost camera whose viewport holds the node's centre", () => {
		const { host } = setup(
			[record(1, { label: "both" }), record(2, { label: "main only" })],
			[rect(1, { x: 0, y: 0 }), rect(2, { x: -3, y: 0 })],
			{
				cameras: [
					camera({}),
					// An inset over the right half, zoomed in 2x on the origin.
					camera({
						units: 2.5,
						viewport: { x: 0.5, y: 0, width: 0.5, height: 1 },
					}),
				],
			},
		);
		// Inset box: x 500..1000, 200px per unit, centre at (750, 250).
		expect(boxes(host)).toEqual([
			{
				label: "both",
				left: "650px",
				top: "150px",
				width: "200px",
				height: "200px",
			},
			{
				label: "main only",
				left: "150px",
				top: "200px",
				width: "100px",
				height: "100px",
			},
		]);
	});

	it("drops a node no camera shows", () => {
		const { host } = setup(
			[record(1, { label: "shown" }), record(2, { label: "hidden" })],
			[rect(1, { x: -2, y: 0 }), rect(2, { x: 6, y: 0 })],
			{
				cameras: [camera({ viewport: { x: 0, y: 0, width: 0.5, height: 1 } })],
			},
		);
		expect(labels(host)).toEqual(["shown"]);
	});
});

describe("tab order", () => {
	it("is the registry's order, through insertions and reorders", () => {
		const first = record(1, { label: "first" });
		const shown = record(2, { label: "shown" });
		const x = record(3, { label: "x" });
		const y = record(4, { label: "y" });
		const { host, records } = setup(
			[first, x, y],
			[1, 2, 3, 4].map((id) => rect(id, { x: id - 3, y: 0 })),
		);
		expect(labels(host)).toEqual(["first", "x", "y"]);
		records.set([first, shown, x, y]);
		frame();
		expect(labels(host)).toEqual(["first", "shown", "x", "y"]);
		records.set([first, shown, y, x]);
		frame();
		expect(labels(host)).toEqual(["first", "shown", "y", "x"]);
		records.set([first, y]);
		frame();
		expect(labels(host)).toEqual(["first", "y"]);
	});

	it("skips records that are not tab stops", () => {
		const { host } = setup(
			[
				record(1, { label: "tap" }),
				record(2, { label: "hover only", handlers: { onEnter: () => {} } }),
				record(3, { label: "opted out", focusable: false }),
			],
			[1, 2, 3].map((id) => rect(id, { x: id - 2, y: 0 })),
		);
		expect(labels(host)).toEqual(["tap"]);
	});

	it("keeps DOM focus on an element through a reorder", () => {
		const a = record(1, { label: "a" });
		const b = record(2, { label: "b" });
		const c = record(3, { label: "c" });
		const { host, records, focus } = setup(
			[a, b, c],
			[1, 2, 3].map((id) => rect(id, { x: id - 2, y: 0 })),
		);
		const element = mirrorOf(host, "a");
		element.focus();
		records.set([c, b, a]);
		frame();
		expect(labels(host)).toEqual(["c", "b", "a"]);
		expect(document.activeElement).toBe(element);
		expect(focus.state.peek()).toEqual({ id: 1, source: "keyboard" });
	});
});

describe("attributes", () => {
	it("announces label and role, a button by default", () => {
		const { host } = setup(
			[record(1, { label: "a" }), record(2, { label: "b", role: "slider" })],
			[rect(1, { x: 0, y: 0 }), rect(2, { x: 2, y: 0 })],
		);
		const [a, b] = elements(host);
		expect(a.getAttribute("role")).toBe("button");
		expect(b.getAttribute("role")).toBe("slider");
		expect(a.tabIndex).toBe(0);
		expect(a.style.outline).toContain("none");
	});

	it("reports aria-pressed for a toggle only, as a string", () => {
		const { host } = setup(
			[
				record(1, { label: "on", pressed: true }),
				record(2, { label: "off", pressed: false }),
				record(3, { label: "plain" }),
			],
			[1, 2, 3].map((id) => rect(id, { x: id - 2, y: 0 })),
		);
		expect(mirrorOf(host, "on").getAttribute("aria-pressed")).toBe("true");
		expect(mirrorOf(host, "off").getAttribute("aria-pressed")).toBe("false");
		expect(mirrorOf(host, "plain").hasAttribute("aria-pressed")).toBe(false);
	});

	it("advertises the arrows when the node nudges, plus its own keys", () => {
		const { host } = setup(
			[
				record(1, {
					label: "plot",
					handlers: {
						keyboard: { nudge: () => {}, key: () => false, shortcuts: "+ - 0" },
					},
				}),
				record(2, {
					label: "leaf",
					handlers: { keyboard: { key: () => false, shortcuts: "Escape" } },
				}),
				record(3, { label: "plain" }),
			],
			[1, 2, 3].map((id) => rect(id, { x: id - 2, y: 0 })),
		);
		expect(mirrorOf(host, "plot").getAttribute("aria-keyshortcuts")).toBe(
			"ArrowUp ArrowDown ArrowLeft ArrowRight + - 0",
		);
		expect(mirrorOf(host, "leaf").getAttribute("aria-keyshortcuts")).toBe(
			"Escape",
		);
		expect(mirrorOf(host, "plain").hasAttribute("aria-keyshortcuts")).toBe(
			false,
		);
	});

	it("re-reads label and pressed when the registry's version moves", () => {
		let pressed = false;
		const toggle: InteractionRecord = {
			...record(1, { label: "mode" }),
			pressed: () => pressed,
		};
		const { host, registry } = setup([toggle], [rect(1, { x: 0, y: 0 })]);
		expect(mirrorOf(host, "mode").getAttribute("aria-pressed")).toBe("false");
		pressed = true;
		(registry.version as Track<number>).set(1);
		frame();
		expect(mirrorOf(host, "mode").getAttribute("aria-pressed")).toBe("true");
	});
});

describe("focus in step with the channel", () => {
	it("DOM focus writes the channel with source keyboard; blur clears it", () => {
		const { host, focus } = setup(
			[record(1, { label: "a" }), record(2, { label: "b" })],
			[rect(1, { x: 0, y: 0 }), rect(2, { x: 2, y: 0 })],
		);
		mirrorOf(host, "a").focus();
		expect(focus.state.peek()).toEqual({ id: 1, source: "keyboard" });
		mirrorOf(host, "b").focus();
		expect(focus.state.peek()).toEqual({ id: 2, source: "keyboard" });
		mirrorOf(host, "b").blur();
		expect(focus.state.peek()).toEqual({ id: null, source: "keyboard" });
	});

	it("a pointer's focus moves the browser at the next frame and keeps its source", () => {
		const { host, focus } = setup(
			[record(1, { label: "left" }), record(2, { label: "right" })],
			[rect(1, { x: -2, y: 0 }), rect(2, { x: 2, y: 0 })],
		);
		focus.set(1, "pointer");
		expect(document.activeElement).not.toBe(mirrorOf(host, "left"));
		frame();
		expect(document.activeElement).toBe(mirrorOf(host, "left"));
		expect(focus.state.peek()).toEqual({ id: 1, source: "pointer" });
		focus.set(2, "pointer");
		frame();
		expect(document.activeElement).toBe(mirrorOf(host, "right"));
		expect(focus.state.peek()).toEqual({ id: 2, source: "pointer" });
		// A press on the background clears the focus: the browser's goes too.
		focus.set(null, "pointer");
		frame();
		expect(document.activeElement).toBe(document.body);
		expect(focus.state.peek()).toEqual({ id: null, source: "pointer" });
	});

	it("clearing the channel leaves focus elsewhere on the page alone", () => {
		const { host, focus } = setup(
			[record(1, { label: "a" })],
			[rect(1, { x: 0, y: 0 })],
		);
		const input = document.createElement("input");
		document.body.append(input);
		focus.set(1, "script");
		frame();
		input.focus();
		focus.set(null);
		frame();
		expect(document.activeElement).toBe(input);
		input.remove();
		expect(host).toBeDefined();
	});

	it("focuses a node registered in the same frame focus moved to it", () => {
		const { host, records, snapshot, focus } = setup([], []);
		records.set([record(5, { label: "late" })]);
		snapshot.set([rect(5, { x: 0, y: 0 })]);
		focus.set(5, "script");
		frame();
		expect(document.activeElement).toBe(mirrorOf(host, "late"));
	});
});

describe("focusIds", () => {
	it("rings the focused node's group, only when focus came from the keyboard", () => {
		const { registry, focus } = setup(
			[record(1, { focusOwner: 1 }), record(2, { focusOwner: 1 }), record(3)],
			[],
		);
		expect(focusIds(registry, focus)).toBeNull();
		focus.set(1, "pointer");
		expect(focusIds(registry, focus)).toBeNull();
		focus.set(1, "keyboard");
		expect(focusIds(registry, focus)).toEqual([1, 2]);
		focus.set(3, "keyboard");
		expect(focusIds(registry, focus)).toEqual([3]);
	});
});

describe("the keyboard", () => {
	it("Enter and Space tap at the node's centre, and make the focus visible", () => {
		const taps: ScenePointerEvent[] = [];
		const { host, focus, picked } = setup(
			[
				record(1, {
					label: "a",
					toLocal: { a: 1, b: 0, c: 0, d: 1, e: -1, f: 0 },
					handlers: { onTap: (event) => taps.push(event) },
				}),
			],
			[rect(1, { x: 1, y: 0 })],
		);
		focus.set(1, "pointer");
		frame();
		const element = mirrorOf(host, "a");
		expect(key(element, "Enter").defaultPrevented).toBe(true);
		expect(key(element, " ").defaultPrevented).toBe(true);
		expect(taps).toHaveLength(2);
		const [tap] = taps;
		expect(tap.pointerId).toBe(-1);
		expect(tap.id).toBe(1);
		expect(tap.camera).toBe(-1);
		expect(tap.scene).toEqual({ x: 1, y: 0 });
		expect(tap.local).toEqual({ x: 0, y: 0 });
		expect(tap.canonical).toEqual({ x: 600, y: 250 });
		expect(focus.state.peek()).toEqual({ id: 1, source: "keyboard" });
		// `pick` goes to the driver at the canonical point, excluding the node.
		expect(tap.pick()).toBe(99);
		expect(picked).toEqual([{ at: { x: 600, y: 250 }, exclude: 1 }]);
	});

	it("prefers the keyboard behaviour's activate over onTap", () => {
		const calls: string[] = [];
		const { host } = setup(
			[
				record(1, {
					label: "a",
					handlers: {
						onTap: () => calls.push("tap"),
						keyboard: { activate: () => calls.push("activate") },
					},
				}),
			],
			[rect(1, { x: 0, y: 0 })],
		);
		key(mirrorOf(host, "a"), "Enter");
		expect(calls).toEqual(["activate"]);
	});

	it("leaves Enter alone on a node with nothing to activate", () => {
		const { host } = setup(
			[
				record(1, {
					label: "a",
					focusable: true,
					handlers: { onEnter: () => {} },
				}),
			],
			[rect(1, { x: 0, y: 0 })],
		);
		expect(key(mirrorOf(host, "a"), "Enter").defaultPrevented).toBe(false);
	});

	it("a behaviour's key hears keys first; a key nobody takes is left to the page", () => {
		const keys: string[] = [];
		const { host, focus } = setup(
			[
				record(1, {
					label: "plot",
					handlers: {
						onTap: () => keys.push("tap"),
						keyboard: {
							key: (event) => {
								keys.push(event.key);
								return event.key === "+" || event.key === "Enter";
							},
						},
					},
				}),
			],
			[rect(1, { x: 0, y: 0 })],
		);
		const plot = mirrorOf(host, "plot");
		expect(key(plot, "+").defaultPrevented).toBe(true);
		expect(focus.state.peek()).toEqual({ id: 1, source: "keyboard" });
		expect(key(plot, "q").defaultPrevented).toBe(false);
		key(plot, "Enter");
		expect(keys).toEqual(["+", "q", "Enter"]);
	});

	it("arrows nudge in the node's own units, Shift for the fine step", () => {
		const nudges: [Point, boolean][] = [];
		const { host } = setup(
			[
				record(1, {
					label: "handle",
					handlers: {
						keyboard: { nudge: (delta, fine) => nudges.push([delta, fine]) },
					},
				}),
			],
			[rect(1, { x: 0, y: 0 })],
		);
		const handle = mirrorOf(host, "handle");
		expect(key(handle, "ArrowRight").defaultPrevented).toBe(true);
		key(handle, "ArrowUp", { shiftKey: true });
		expect(nudges[0][0].x).toBeCloseTo(1, 9);
		expect(nudges[0][0].y).toBeCloseTo(0, 9);
		expect(nudges[0][1]).toBe(false);
		// Up on screen is +y in a y-up scene.
		expect(nudges[1][0].x).toBeCloseTo(0, 9);
		expect(nudges[1][0].y).toBeCloseTo(1, 9);
		expect(nudges[1][1]).toBe(true);
	});

	it("maps an arrow through a rotated node's inverse matrix", () => {
		const nudges: Point[] = [];
		const { host } = setup(
			[
				record(1, {
					label: "handle",
					// The node's frame is turned a quarter turn: scene +x is its local -y.
					toLocal: rotate(-Math.PI / 2),
					handlers: { keyboard: { nudge: (delta) => nudges.push(delta) } },
				}),
			],
			[rect(1, { x: 0, y: 0 })],
		);
		key(mirrorOf(host, "handle"), "ArrowRight");
		expect(nudges[0].x).toBeCloseTo(0, 9);
		expect(nudges[0].y).toBeCloseTo(-1, 9);
	});

	it("Escape cancels a drag in flight first, and only then reaches the node", () => {
		const keys: string[] = [];
		const { host, cancelled, inFlight } = setup(
			[
				record(1, {
					label: "leaf",
					handlers: {
						keyboard: {
							key: (event) => {
								keys.push(event.key);
								return true;
							},
							shortcuts: "Escape",
						},
					},
				}),
			],
			[rect(1, { x: 0, y: 0 })],
		);
		const leaf = mirrorOf(host, "leaf");
		inFlight.value = true;
		const cancel = key(leaf, "Escape");
		// The cancel is the whole of that press: nothing else took it.
		expect(cancel.defaultPrevented).toBe(false);
		expect(keys).toEqual([]);
		expect(key(leaf, "Escape").defaultPrevented).toBe(true);
		expect(keys).toEqual(["Escape"]);
		expect(cancelled).toEqual([1, 1]);
	});
});

describe("an item list for a batched node", () => {
	// Out of x order on purpose: the keys walk the screen, not the data.
	const points: [number, number][] = [
		[2, 2],
		[4, 3],
		[1, 4],
		[3, 1],
	];
	const itemLabel = (item: number) => {
		const [x, y] = points[item];
		return `x: ${x}, y: ${y}`;
	};

	function listSetup(handlers: InteractionHandlers = {}) {
		const h = setup(
			[
				record(1, {
					label: "Scatter, 4 points",
					focusable: true,
					handlers: { itemLabel, ...handlers },
				}),
			],
			[marks(1, points)],
			{ units: 20 },
		);
		const list = mirrorOf(h.host, "Scatter, 4 points");
		const option = () => list.querySelector<HTMLElement>('[role="option"]');
		return { ...h, list, option };
	}

	it("walks the markers left to right as one listbox tab stop", () => {
		const { host, list, option, items } = listSetup();
		expect(elements(host)).toHaveLength(1);
		expect(list.getAttribute("role")).toBe("listbox");
		expect(list.getAttribute("aria-activedescendant")).toBeNull();
		expect(list.getAttribute("aria-keyshortcuts")).toBe(
			"ArrowLeft ArrowRight ArrowUp ArrowDown Home End PageUp PageDown",
		);

		list.focus();
		const seen: string[] = [];
		const step = (name: string) => {
			expect(key(list, name).defaultPrevented).toBe(true);
			seen.push(
				`${option()?.getAttribute("aria-posinset")}/${option()?.getAttribute("aria-setsize")} ${option()?.textContent}`,
			);
		};
		step("ArrowRight");
		expect(list.getAttribute("aria-activedescendant")).toBe(option()?.id);
		step("ArrowRight");
		step("End");
		step("ArrowRight");
		step("Home");
		// Place along the screen, of how many, then the item's label.
		expect(seen).toEqual([
			"1/4 x: 1, y: 4",
			"2/4 x: 2, y: 2",
			"4/4 x: 4, y: 3",
			"4/4 x: 4, y: 3",
			"1/4 x: 1, y: 4",
		]);
		expect(items.map((item) => item?.item ?? null)).toEqual([2, 0, 1, 2]);

		key(list, "Escape");
		expect(list.getAttribute("aria-activedescendant")).toBeNull();
		expect(items.at(-1)).toBeNull();
	});

	it("sends leave and enter as the current item moves, at the item's centre", () => {
		const log: string[] = [];
		const { list } = listSetup({
			onEnter: (event) => log.push(`enter ${event.item} ${event.scene.x}`),
			onLeave: (event) => log.push(`leave ${event.item}`),
		});
		list.focus();
		key(list, "ArrowRight");
		key(list, "ArrowRight");
		list.blur();
		expect(log).toEqual(["enter 2 1", "leave 2", "enter 0 2", "leave 0"]);
	});

	it("Enter taps the current item, and only once there is one", () => {
		const taps: (number | null | undefined)[] = [];
		const { list } = listSetup({ onTap: (event) => taps.push(event.item) });
		list.focus();
		// No current item yet: an ordinary activation of the whole node.
		key(list, "Enter");
		key(list, "ArrowRight");
		key(list, "End");
		key(list, " ");
		expect(taps).toEqual([undefined, 1]);
	});

	it("drops the current item when the node stops being drawn", () => {
		const { list, snapshot, items, host } = listSetup();
		list.focus();
		key(list, "ArrowRight");
		snapshot.set([]);
		frame();
		expect(elements(host)).toHaveLength(0);
		expect(items.at(-1)).toBeNull();
	});
});

describe("dispose", () => {
	it("removes every element and stops listening", () => {
		const { host, mirror, snapshot, focus } = setup(
			[record(1, { label: "a" })],
			[rect(1, { x: 0, y: 0 })],
		);
		expect(host.contains(mirror.element)).toBe(true);
		mirror.dispose();
		expect(host.children).toHaveLength(0);
		snapshot.set([rect(1, { x: 1, y: 0 })]);
		focus.set(1, "script");
		frame();
		expect(host.children).toHaveLength(0);
	});
});
