import { describe, expect, it } from "vitest";
import type { Point } from "../geometry";
import type { BackgroundPointerEvent } from "../render/pointer";
import type { Animatable } from "../tween/target";
import { panZoomHandlers, pinchFactor } from "./pan-zoom";

function cell<T>(initial: T): Animatable<T> {
	let value = initial;
	return {
		peek: () => value,
		set: (next: T) => {
			value = next;
		},
	};
}

describe("pinchFactor", () => {
	it("targets startUnits * startDistance / distance regardless of current units", () => {
		expect(pinchFactor(10, 100, 200, 10)).toBeCloseTo(0.5);
		// Units already halved by an earlier move: no further change needed.
		expect(pinchFactor(10, 100, 200, 5)).toBeCloseTo(1);
	});
});

describe("panZoomHandlers pinch", () => {
	it("zooms in proportion to the spread, not exponentially across moves", () => {
		const units = cell(10);
		const center = cell<Point>({ x: 0, y: 0 });
		const pointers = new Map<number, Point>();
		// Plain-stage mapping: canonical pixels are device pixels, so the scene
		// point under a pixel depends on the camera as it is right now.
		const toScene = (p: Point): Point => ({
			x: center.peek().x + (p.x - 400) * (units.peek() / 800),
			y: center.peek().y + (p.y - 300) * (units.peek() / 800),
		});
		const h = panZoomHandlers(() => ({ units, center, pointers, toScene }));
		const ev = (
			phase: BackgroundPointerEvent["phase"],
			id: number,
		): BackgroundPointerEvent => ({
			phase,
			pointerId: id,
			native: {} as PointerEvent,
			canonical: pointers.get(id) as Point,
			scene: toScene(pointers.get(id) as Point),
			camera: -1,
		});

		pointers.set(1, { x: 350, y: 300 });
		h.background(ev("down", 1));
		pointers.set(2, { x: 450, y: 300 });
		h.background(ev("down", 2));
		// Fingers spread from 100px to 200px apart in 10 steps, about the middle.
		for (let i = 1; i <= 10; i++) {
			const half = 50 + i * 5;
			pointers.set(1, { x: 400 - half, y: 300 });
			pointers.set(2, { x: 400 + half, y: 300 });
			h.background(ev("move", 2));
			expect(units.peek()).toBeCloseTo(10 * (100 / (2 * half)), 6);
		}
		expect(units.peek()).toBeCloseTo(5, 6);
		expect(center.peek().x).toBeCloseTo(0, 6);
	});
});
