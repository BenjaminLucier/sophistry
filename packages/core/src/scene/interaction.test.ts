// @vitest-environment happy-dom
/**
 * Interaction end to end on a mounted scene: real nodes, the registry built
 * from the graph, the pointer driver on the scene's canvas and the focus
 * ring. Events reach nodes both as `node.on(...)` and as `onX`
 * props, drag goes through `draggable`, hover is a hit-test transition
 * re-tested when the scene moves under a still pointer, long press, double
 * tap and the context menu, drop targets, `touch-action` from the registry,
 * tab order as tree order, interaction groups, and `panZoom`.
 *
 * The canvas measures 1000x500 CSS pixels at dpr 1 and the scenes are 10
 * units wide: 100 px per unit, scene origin at (500, 250), y up.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draggable } from "../interact/drag.js";
import { dropTarget } from "../interact/drop.js";
import type { ScenePointerEvent } from "../interact/types.js";
import { track } from "../reactive/index.js";
import { rect } from "../shapes/rect.js";
import { trackPoint } from "../tween/track.js";
import { group } from "./group.js";
import { interactionGroup } from "./interaction-group.js";
import { panZoom } from "./pan-zoom.js";
import type { Scene } from "./scene.js";
import { createScene, sceneInternals } from "./scene.js";
import type { DomHarness } from "./test-dom.js";
import { installDom, mountPoint } from "./test-dom.js";

let dom: DomHarness;
const scenes: Scene[] = [];

beforeEach(() => {
	dom = installDom({ width: 1000, height: 500 });
});

afterEach(() => {
	vi.useRealTimers();
	for (const scene of scenes.splice(0)) scene.dispose();
	dom.restore();
});

function mount(): Scene {
	const scene = createScene({ host: mountPoint(), units: 10 });
	scenes.push(scene);
	return scene;
}

/** A filled unit square at scene `(x, y)`. */
const square = (x: number, y = 0, extra: Record<string, unknown> = {}) =>
	rect.create({
		center: { x, y },
		width: 1,
		height: 1,
		fill: "#f00",
		...extra,
	});

/** Scene units to client pixels. */
const client = (x: number, y: number) => ({
	clientX: 500 + x * 100,
	clientY: 250 - y * 100,
});

/** Dispatches a pointer event at scene `(x, y)` on the scene's canvas. */
function fire(
	scene: Scene,
	type: string,
	x: number,
	y: number,
	extra: Record<string, unknown> = {},
): void {
	const canvas = scene.canvas as HTMLCanvasElement;
	const event = new PointerEvent(type, {
		bubbles: true,
		cancelable: true,
		pointerId: 1,
		pointerType: "mouse",
		button: 0,
		...client(x, y),
		...extra,
	});
	canvas.dispatchEvent(event);
}

const tap = (scene: Scene, x: number, y: number) => {
	fire(scene, "pointerdown", x, y);
	fire(scene, "pointerup", x, y);
};

/** Commits, paints, and runs the driver's re-test. */
const frames = () => dom.drain();

describe("events on nodes", () => {
	it("reach a node both as an onTap prop and through node.on('tap')", () => {
		const scene = mount();
		const log: string[] = [];
		const node = scene.add(
			square(0, 0, {
				onTap: (e: ScenePointerEvent) => log.push(`prop ${e.id}`),
			}),
		);
		const stop = node.on("tap", (e) => log.push(`on ${e.id}`));
		frames();
		tap(scene, 0, 0);
		expect(log).toEqual([`prop ${node.id}`, `on ${node.id}`]);
		// Off the node: nothing.
		tap(scene, 3, 0);
		expect(log).toHaveLength(2);
		stop();
		frames();
		tap(scene, 0, 0);
		expect(log).toEqual([
			`prop ${node.id}`,
			`on ${node.id}`,
			`prop ${node.id}`,
		]);
	});

	it("a node with only node.on handlers is interactive, and stops being when they go", () => {
		const scene = mount();
		const node = scene.add(square(0));
		const registry = sceneInternals(scene)?.registry;
		frames();
		expect(registry?.records()).toEqual([]);
		const taps: number[] = [];
		const stop = node.on("tap", (e) => taps.push(e.id as number));
		frames();
		expect(registry?.records().map((r) => r.id)).toEqual([node.id]);
		tap(scene, 0, 0);
		expect(taps).toEqual([node.id]);
		stop();
		frames();
		expect(registry?.records()).toEqual([]);
	});

	it("reports local units through an enclosing group", () => {
		const scene = mount();
		let seen: ScenePointerEvent | null = null;
		scene.add(
			group.create({
				x: 2,
				children: [
					square(0, 0, { onTap: (e: ScenePointerEvent) => (seen = e) }),
				],
			}),
		);
		frames();
		tap(scene, 2.25, 0);
		expect(seen).not.toBeNull();
		const event = seen as unknown as ScenePointerEvent;
		expect(event.scene.x).toBeCloseTo(2.25, 9);
		expect(event.local.x).toBeCloseTo(0.25, 9);
	});

	it("a hit area rides its group when the group moves", () => {
		const scene = mount();
		const taps: number[] = [];
		const parent = scene.add(
			group.create({
				children: [
					square(0, 0, {
						hitArea: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
						onTap: () => taps.push(1),
					}),
				],
			}),
		);
		frames();
		tap(scene, 1.8, 0);
		expect(taps).toHaveLength(1);
		parent.set("x", -3);
		frames();
		tap(scene, 1.8, 0);
		expect(taps).toHaveLength(1);
		tap(scene, -1.5, 0);
		expect(taps).toHaveLength(2);
	});

	it("double tap fires onTap twice and onDoubleTap once; a right click is a context menu", () => {
		const scene = mount();
		const log: string[] = [];
		scene.add(
			square(0, 0, {
				onTap: () => log.push("tap"),
				onDoubleTap: () => log.push("double"),
				onContextMenu: () => log.push("menu"),
			}),
		);
		frames();
		tap(scene, 0, 0);
		tap(scene, 0, 0);
		expect(log).toEqual(["tap", "tap", "double"]);
		// The secondary button starts no gesture; the menu has its own event.
		fire(scene, "pointerdown", 0, 0, { button: 2 });
		fire(scene, "contextmenu", 0, 0);
		expect(log).toEqual(["tap", "tap", "double", "menu"]);
	});

	it("a long press fires while held still, and not after the pointer wandered", () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const scene = mount();
		const log: string[] = [];
		scene.add(square(0, 0, { onLongPress: () => log.push("long") }));
		frames();
		fire(scene, "pointerdown", 0, 0);
		vi.advanceTimersByTime(600);
		expect(log).toEqual(["long"]);
		fire(scene, "pointerup", 0, 0);
		// Past the 8 px slop before the delay: no long press.
		fire(scene, "pointerdown", 0, 0);
		fire(scene, "pointermove", 0.2, 0);
		vi.advanceTimersByTime(600);
		fire(scene, "pointerup", 0.2, 0);
		expect(log).toEqual(["long"]);
	});
});

describe("drag, drop and touch-action", () => {
	it("draggable writes the track the node reads; touch-action follows hasDrag", () => {
		const scene = mount();
		const canvas = scene.canvas as HTMLCanvasElement;
		const position = trackPoint(0, 0);
		frames();
		expect(canvas.style.touchAction).toBe("");
		const node = scene.add(
			rect.create({
				center: position,
				width: 1,
				height: 1,
				fill: "#f00",
				...draggable(position, { threshold: 0 }),
			}),
		);
		frames();
		expect(canvas.style.touchAction).toBe("none");
		fire(scene, "pointerdown", 0.2, 0);
		fire(scene, "pointermove", 1.2, 0.5);
		expect(position.peek().x).toBeCloseTo(1, 9);
		expect(position.peek().y).toBeCloseTo(0.5, 9);
		fire(scene, "pointerup", 1.2, 0.5);
		node.dispose();
		frames();
		expect(canvas.style.touchAction).toBe("");
	});

	it("a drop target hears enter, drop and leave for the node in hand", () => {
		const scene = mount();
		const position = trackPoint(-2, 0);
		const over = track(false);
		const log: string[] = [];
		const target = scene.add(
			square(2, 0, {
				...dropTarget({
					over,
					onEnter: () => log.push("enter"),
					onDrop: (dragged) => log.push(`drop ${dragged}`),
					onLeave: () => log.push("leave"),
				}),
			}),
		);
		const handle = scene.add(
			rect.create({
				center: position,
				width: 0.5,
				height: 0.5,
				fill: "#00f",
				zIndex: 1,
				...draggable(position, { threshold: 0 }),
			}),
		);
		frames();
		fire(scene, "pointerdown", -2, 0);
		fire(scene, "pointermove", 2, 0);
		expect(log).toEqual(["enter"]);
		expect(over.peek()).toBe(true);
		fire(scene, "pointerup", 2, 0);
		expect(log).toEqual(["enter", `drop ${handle.id}`, "leave"]);
		expect(over.peek()).toBe(false);
		expect(target.id).not.toBe(handle.id);
	});

	it("a cancelled drag (lost capture) restores the origin", () => {
		const scene = mount();
		const position = trackPoint(0, 0);
		scene.add(
			rect.create({
				center: position,
				width: 1,
				height: 1,
				fill: "#f00",
				...draggable(position, { threshold: 0 }),
			}),
		);
		frames();
		fire(scene, "pointerdown", 0, 0);
		fire(scene, "pointermove", 2, 0);
		expect(position.peek().x).toBeCloseTo(2, 9);
		fire(scene, "pointercancel", 2, 0);
		expect(position.peek()).toEqual({ x: 0, y: 0 });
	});
});

describe("hover and the published pointer", () => {
	it("enter and leave are re-tested when a node moves under a still pointer", () => {
		const scene = mount();
		const hover = track(false);
		const center = trackPoint(0, 0);
		scene.add(
			rect.create({
				center,
				width: 1,
				height: 1,
				fill: "#f00",
				hover,
				cursor: "pointer",
			}),
		);
		frames();
		fire(scene, "pointermove", 0, 0);
		expect(hover.peek()).toBe(true);
		expect((scene.canvas as HTMLCanvasElement).style.cursor).toBe("pointer");
		center.set({ x: 3, y: 0 });
		frames();
		expect(hover.peek()).toBe(false);
		expect((scene.canvas as HTMLCanvasElement).style.cursor).toBe("");
		center.set({ x: 0, y: 0 });
		frames();
		expect(hover.peek()).toBe(true);
	});

	it("scene.pointer publishes the scene point and the node under it", () => {
		const scene = mount();
		const node = scene.add(square(1, 0, { onTap: () => {} }));
		frames();
		expect(scene.pointer.peek()).toBeNull();
		fire(scene, "pointermove", 1, 0.25);
		const at = scene.pointer.peek();
		expect(at?.scene.x).toBeCloseTo(1, 9);
		expect(at?.scene.y).toBeCloseTo(0.25, 9);
		expect(at?.id).toBe(node.id);
		expect(at?.camera).toBe(-1);
		fire(scene, "pointerleave", 1, 0.25);
		expect(scene.pointer.peek()).toBeNull();
	});
});

describe("focus", () => {
	it("tab order is tree order, through insertion and reordering", () => {
		const scene = mount();
		const registry = sceneInternals(scene)?.registry;
		const labelled = (label: string, x: number) =>
			square(x, 0, { label, onTap: () => {} });
		const first = scene.add(labelled("first", -3));
		const x = scene.add(labelled("x", 0));
		const y = scene.add(labelled("y", 1));
		const labels = () => registry?.focusable().map((r) => r.label());
		frames();
		expect(labels()).toEqual(["first", "x", "y"]);
		scene.root.add(labelled("shown", -2), x);
		frames();
		expect(labels()).toEqual(["first", "shown", "x", "y"]);
		scene.root.add(y, x);
		frames();
		expect(labels()).toEqual(["first", "shown", "y", "x"]);
		// A node with only hover is not a tab stop.
		scene.add(square(4, 0, { label: "hover", hover: () => {} }));
		frames();
		expect(labels()).toEqual(["first", "shown", "y", "x"]);
		expect(first.id).toBeGreaterThan(0);
	});

	it("a press focuses the focusable node under it without a ring; a key-moved focus rings", () => {
		const scene = mount();
		const internals = sceneInternals(scene);
		const node = scene.add(square(0, 0, { label: "a", onTap: () => {} }));
		frames();
		const renderer = internals?.renderer;
		const setFocus = vi.spyOn(
			renderer as NonNullable<typeof renderer>,
			"setFocus",
		);
		fire(scene, "pointerdown", 0, 0);
		fire(scene, "pointerup", 0, 0);
		expect(scene.focus.state.peek()).toEqual({
			id: node.id,
			source: "pointer",
		});
		frames();
		expect(setFocus).not.toHaveBeenCalled();
		scene.focus.set(node.id, "keyboard");
		frames();
		expect(setFocus).toHaveBeenLastCalledWith([node.id]);
		// A press on the background clears it.
		fire(scene, "pointerdown", 4, 2);
		fire(scene, "pointerup", 4, 2);
		expect(scene.focus.state.peek().id).toBeNull();
		frames();
		expect(setFocus).toHaveBeenLastCalledWith(null);
	});
});

describe("interaction groups", () => {
	it("members share the group's handlers, their own win key by key, and the group is one tab stop", () => {
		const scene = mount();
		const registry = sceneInternals(scene)?.registry;
		const log: string[] = [];
		const disc = square(0, 0);
		const caption = square(2, 0, { onTap: () => log.push("caption's own") });
		const dot = scene.add(
			interactionGroup.create({
				label: "point A",
				role: "link",
				cursor: "pointer",
				onTap: (e: ScenePointerEvent) => log.push(`group via ${e.id}`),
				children: [disc, caption],
			}),
		);
		frames();
		tap(scene, 0, 0);
		tap(scene, 2, 0);
		expect(log).toEqual([`group via ${disc.id}`, "caption's own"]);
		// One record per member; the first member in tree order carries the stop.
		expect(registry?.records().map((r) => r.id)).toEqual([disc.id, caption.id]);
		expect(registry?.focusable().map((r) => r.id)).toEqual([disc.id]);
		const owner = registry?.find(disc.id);
		expect(owner?.label()).toBe("point A");
		expect(owner?.role()).toBe("link");
		expect(owner?.cursor()).toBe("pointer");
		expect(registry?.find(caption.id)?.label()).toBeNull();
		expect(registry?.membersOf(disc.id).map((r) => r.id)).toEqual([
			disc.id,
			caption.id,
		]);
		// The group's props are live.
		dot.set("label", "point B");
		frames();
		expect(registry?.find(disc.id)?.label()).toBe("point B");
		// The first member leaving hands the stop to the next.
		disc.dispose();
		frames();
		expect(registry?.focusable().map((r) => r.id)).toEqual([caption.id]);
		expect(registry?.find(caption.id)?.label()).toBe("point B");
	});

	it("a node moved out of a group stops being a member", () => {
		const scene = mount();
		const registry = sceneInternals(scene)?.registry;
		const member = square(0);
		scene.add(interactionGroup.create({ onTap: () => {}, children: [member] }));
		frames();
		expect(registry?.records().map((r) => r.id)).toEqual([member.id]);
		scene.add(member);
		frames();
		expect(registry?.records()).toEqual([]);
	});

	it("nested groups are one tab stop, owned through the outermost; the inner label wins", () => {
		const scene = mount();
		const registry = sceneInternals(scene)?.registry;
		const a = square(0);
		const b = square(2);
		scene.add(
			interactionGroup.create({
				label: "outer",
				onTap: () => {},
				children: [
					a,
					interactionGroup.create({ label: "inner", children: [b] }),
				],
			}),
		);
		frames();
		expect(registry?.focusable().map((r) => r.id)).toEqual([a.id]);
		expect(registry?.find(b.id)?.focusOwner()).toBe(a.id);
		expect(registry?.find(b.id)?.handlers().onTap).toBeDefined();
	});
});

describe("panZoom", () => {
	const wheel = (scene: Scene, x: number, y: number, deltaY: number) => {
		// happy-dom's WheelEvent drops the mouse fields, so they are set here.
		const event = new Event("wheel", { cancelable: true });
		const { clientX, clientY } = client(x, y);
		Object.assign(event, { clientX, clientY, deltaX: 0, deltaY, deltaMode: 0 });
		(scene.canvas as HTMLCanvasElement).dispatchEvent(event);
		return event;
	};

	it("the wheel zooms about the cursor and dragging empty space pans", () => {
		const scene = mount();
		const navigation = panZoom(scene);
		frames();
		expect(navigation.units.peek()).toBe(10);
		expect((scene.canvas as HTMLCanvasElement).style.touchAction).toBe("none");
		const event = wheel(scene, 2, 0, -100);
		expect(event.defaultPrevented).toBe(true);
		const units = navigation.units.peek();
		expect(units).toBeLessThan(10);
		// The point under the cursor stays put: center ← at − (at − center)·k.
		expect(navigation.center.peek().x).toBeCloseTo(2 - 2 * (units / 10), 9);
		frames();
		// The scene reads the tracks.
		expect(scene.frame.peek().maxX - scene.frame.peek().minX).toBeCloseTo(
			units,
			9,
		);
		navigation.reset();
		frames();
		expect(navigation.center.peek()).toEqual({ x: 0, y: 0 });
		// Grab at (0, 0), move 100 px right: one unit at 10 units wide.
		fire(scene, "pointerdown", 0, 0);
		fire(scene, "pointermove", 1, 0);
		expect(navigation.center.peek().x).toBeCloseTo(-1, 9);
		fire(scene, "pointerup", 1, 0);
	});

	it("a node's drag wins over the pan, and a node's onWheel over the zoom", () => {
		const scene = mount();
		const navigation = panZoom(scene);
		const position = trackPoint(0, 0);
		const wheels: number[] = [];
		scene.add(
			rect.create({
				center: position,
				width: 1,
				height: 1,
				fill: "#f00",
				onWheel: () => {
					wheels.push(1);
				},
				...draggable(position, { threshold: 0 }),
			}),
		);
		frames();
		fire(scene, "pointerdown", 0, 0);
		fire(scene, "pointermove", 1, 0);
		fire(scene, "pointerup", 1, 0);
		expect(position.peek().x).toBeCloseTo(1, 9);
		expect(navigation.center.peek()).toEqual({ x: 0, y: 0 });
		frames();
		wheel(scene, 1, 0, -100);
		expect(wheels).toEqual([1]);
		expect(navigation.units.peek()).toBe(10);
	});

	it("dispose stops listening and releases the touch claim", () => {
		const scene = mount();
		const navigation = panZoom(scene);
		navigation.dispose();
		frames();
		expect((scene.canvas as HTMLCanvasElement).style.touchAction).toBe("");
		wheel(scene, 0, 0, -100);
		expect(navigation.units.peek()).toBe(10);
	});

	it("a camera's tracks must be passed in", () => {
		const scene = mount();
		expect(() => panZoom(scene, { camera: 0 })).toThrow(TypeError);
	});
});
