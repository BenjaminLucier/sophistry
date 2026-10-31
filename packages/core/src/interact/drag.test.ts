import { describe, expect, it } from "vitest";
import { track } from "../reactive";
import { draggable } from "./drag";
import { DEFAULT_SLOP } from "./slop";
import type { ScenePointerEvent } from "./types";

function ev(x: number, y: number, id = 1): ScenePointerEvent {
	return {
		native: { clientX: x, clientY: y, target: null },
		pointerId: id,
		canonical: { x, y },
		scene: { x, y },
		local: { x: x / 10, y: y / 10 },
		camera: 0,
		id: 1,
		pick: () => null,
		stopPropagation: () => {},
	} as unknown as ScenePointerEvent;
}

function cell(initial = { x: 0, y: 0 }) {
	let value = initial;
	return {
		peek: () => value,
		set: (v: { x: number; y: number }) => {
			value = v;
		},
	};
}

describe("draggable threshold", () => {
	it("defaults to the driver slop", () => {
		expect(DEFAULT_SLOP).toBe(8);
	});

	it("a press without movement is not a drag and reports so", () => {
		const log: string[] = [];
		const c = cell();
		const { drag } = draggable(c, {
			onDragStart: () => log.push("start"),
			onDragEnd: () => log.push("end"),
		});
		expect(drag.start(ev(100, 100))).toBe(true);
		drag.move(ev(103, 100));
		expect(drag.end(ev(103, 100), false)).toBe(false);
		expect(log).toEqual([]);
		expect(c.peek()).toEqual({ x: 0, y: 0 });
	});

	it("crossing the threshold starts the drag, keeps the grab offset and applies constraints", () => {
		const log: string[] = [];
		const c = cell({ x: 5, y: 5 });
		const { drag } = draggable(c, {
			constrain: "axisX",
			onDragStart: () => log.push("start"),
			onDragEnd: () => log.push("end"),
		});
		drag.start(ev(100, 100));
		drag.move(ev(120, 130));
		expect(log).toEqual(["start"]);
		// origin + (pointer - start), y locked by the constraint
		expect(c.peek()).toEqual({ x: 7, y: 5 });
		expect(drag.end(ev(120, 130), false)).toBe(true);
		expect(log).toEqual(["start", "end"]);
	});

	it("threshold 0 restores press-time start", () => {
		const log: string[] = [];
		const { drag } = draggable(cell(), {
			threshold: 0,
			onDragStart: () => log.push("start"),
			onDragEnd: () => log.push("end"),
		});
		drag.start(ev(0, 0));
		expect(drag.end(ev(0, 0), false)).toBe(true);
		expect(log).toEqual(["start", "end"]);
	});
});

describe("draggable keyboard, cancel and cursor", () => {
	it("a nudge is a whole gesture through the constraint", () => {
		const log: string[] = [];
		const c = cell({ x: 1, y: 1 });
		const { keyboard } = draggable(c, {
			constrain: "axisX",
			step: 0.5,
			onDragStart: () => log.push("start"),
			onDrag: () => log.push("drag"),
			onDragEnd: () => log.push("end"),
		});
		keyboard.nudge({ x: 1, y: 1 }, false);
		expect(c.peek()).toEqual({ x: 1.5, y: 1 });
		keyboard.nudge({ x: -1, y: 0 }, true);
		expect(c.peek().x).toBeCloseTo(1.4, 9);
		expect(log).toEqual(["start", "drag", "end", "start", "drag", "end"]);
	});

	it("a cancelled drag restores the origin exactly and reports it", () => {
		const ended: unknown[] = [];
		const c = cell({ x: 2, y: 3 });
		const { drag } = draggable(c, { onDragEnd: (value) => ended.push(value) });
		drag.start(ev(0, 0));
		drag.move(ev(50, 70));
		expect(c.peek()).toEqual({ x: 7, y: 10 });
		expect(drag.end(ev(50, 70), true)).toBe(true);
		expect(c.peek()).toEqual({ x: 2, y: 3 });
		expect(ended).toEqual([{ x: 2, y: 3 }]);
	});

	it("disabled declines the gesture and the nudge, and its cursor follows the flag", () => {
		const disabled = track(true);
		const c = cell();
		const bag = draggable(c, { disabled });
		expect(bag.drag.start(ev(0, 0))).toBe(false);
		bag.keyboard.nudge({ x: 1, y: 0 }, false);
		expect(c.peek()).toEqual({ x: 0, y: 0 });
		expect(bag.cursor.peek()).toBeUndefined();
		let stale = 0;
		bag.cursor.subscribe(() => stale++);
		disabled.set(false);
		expect(stale).toBe(1);
		expect(bag.cursor.peek()).toBe("grab");
		expect(bag.drag.start(ev(0, 0))).toBe(true);
	});

	it("a second pointer on a handle in hand is declined", () => {
		const { drag } = draggable(cell());
		expect(drag.start(ev(0, 0, 1))).toBe(true);
		expect(drag.start(ev(0, 0, 2))).toBe(false);
	});
});
