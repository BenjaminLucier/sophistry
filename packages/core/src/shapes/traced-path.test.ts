/**
 * The time-driven shapes: `tracedPath`, `animatedBoundary` and
 * `transformMatchingShapes`.
 */

import { describe, expect, it } from "vitest";
import type { Point, Polyline } from "../geometry";
import { track } from "../reactive";
import { createClock } from "../tween/clock";
import { animatedBoundary } from "./animated-boundary";
import { manualGraph, shapeSpecsOf } from "./test-graph";
import { tracedPath } from "./traced-path";
import {
	type TransformMatchingShapesProps as Shapes,
	transformMatchingShapes,
} from "./transform-matching-shapes";

describe("tracedPath", () => {
	function mount(extra: { dissipatingTime?: number } = {}) {
		const { graph, commit } = manualGraph();
		const point = track<Point>({ x: 0, y: 0 });
		const time = track(0);
		const node = graph.root.add(tracedPath.create({ point, time, ...extra }));
		commit();
		const trail = () => (shapeSpecsOf(node)[0]?.polylines[0] ?? []) as Point[];
		const step = (x: number, t: number) => {
			point.set({ x, y: 0 });
			time.set(t);
			commit();
		};
		return { trail, step, node };
	}

	it("records where the point has been", () => {
		const { trail, step } = mount();
		step(1, 0.1);
		step(2, 0.2);
		expect(trail().map((p) => p.x)).toEqual([0, 1, 2]);
	});

	it("cuts back when time runs backwards, so a scrub does not pile up", () => {
		const { trail, step } = mount();
		step(1, 0.1);
		step(2, 0.2);
		step(3, 0.3);
		step(1.5, 0.15);
		expect(trail().map((p) => p.x)).toEqual([0, 1, 1.5]);
	});

	it("keeps only the last dissipatingTime seconds", () => {
		const { trail, step } = mount({ dissipatingTime: 0.25 });
		for (let i = 1; i <= 10; i++) step(i, i * 0.1);
		const xs = trail().map((p) => p.x);
		expect(xs[xs.length - 1]).toBe(10);
		expect(xs[0]).toBeGreaterThanOrEqual(8);
	});

	it("skips points that have not moved", () => {
		const { trail, step } = mount();
		step(0, 0.1);
		step(0.001, 0.2);
		expect(trail()).toHaveLength(1);
	});

	it("runs on the clock's time without a time prop, and holds a dissipating clock open", () => {
		const clock = createClock();
		let listening = 0;
		const onTick = clock.onTick;
		clock.onTick = (listener) => {
			listening++;
			const stop = onTick(listener);
			return () => {
				listening--;
				stop();
			};
		};
		const { graph, commit } = manualGraph({ clock });
		const point = track<Point>({ x: 0, y: 0 });
		const node = graph.root.add(
			tracedPath.create({ point, dissipatingTime: 0.5 }),
		);
		commit();
		expect(listening).toBe(1);
		for (let i = 1; i <= 10; i++) {
			point.set({ x: i, y: 0 });
			clock.advance(0.1);
			commit();
		}
		const xs = ((shapeSpecsOf(node)[0]?.polylines[0] ?? []) as Point[]).map(
			(p) => p.x,
		);
		expect(xs[xs.length - 1]).toBe(10);
		expect(xs[0]).toBeGreaterThanOrEqual(5);
		node.dispose();
		expect(listening).toBe(0);
	});

	it("passes style props to its stroke", () => {
		const { node, step } = mount();
		node.set("stroke", "#ff0000");
		step(1, 0.1);
		expect(shapeSpecsOf(node)[0]?.style.stroke).toBe("#ff0000");
		expect(shapeSpecsOf(node)[0]?.closed).toBe(false);
	});
});

const square: Point[] = [
	{ x: 0, y: 0 },
	{ x: 1, y: 0 },
	{ x: 1, y: 1 },
	{ x: 0, y: 1 },
	{ x: 0, y: 0 },
];

describe("animatedBoundary", () => {
	function mount() {
		const { graph, commit } = manualGraph();
		const time = track(0);
		const node = graph.root.add(
			animatedBoundary.create({
				points: square,
				time,
				colors: ["#ff0000", "#00ff00", "#0000ff"],
				cycleRate: 1,
				drawEasing: "linear",
				fadeEasing: "linear",
				strokeWidth: 0.1,
			}),
		);
		commit();
		return {
			shapes: () => shapeSpecsOf(node),
			at: (t: number) => {
				time.set(t);
				commit();
			},
		};
	}

	it("draws round in the first colour, with nothing fading yet", () => {
		const { shapes, at } = mount();
		at(0.25);
		const drawn = shapes();
		expect(drawn).toHaveLength(1);
		expect(drawn[0]?.style.stroke).toBe("#ff0000");
		expect(drawn[0]?.progress).toBeCloseTo(0.25, 9);
	});

	it("next cycle: the next colour draws backwards while the last thins away", () => {
		const { shapes, at } = mount();
		at(1.25);
		const [fading, growing] = shapes();
		if (!fading || !growing) throw new Error("expected two strokes");
		expect(growing.style.stroke).toBe("#00ff00");
		expect(growing.progress).toBeCloseTo(0.25, 9);
		// Drawn from the end: the first point is where the outline ends going backwards.
		expect((growing.polylines[0] as Polyline)[1]).toEqual({ x: 0, y: 1 });
		expect(fading.style.stroke).toBe("#ff0000");
		expect(fading.style.strokeWidth).toBeCloseTo(0.075, 9);
	});

	it("cycles the colours round", () => {
		const { shapes, at } = mount();
		at(3.5);
		expect(shapes().map((s) => s.style.stroke)).toEqual(["#0000ff", "#ff0000"]);
	});
});

describe("animatedBoundary on the clock's own time", () => {
	it("keeps the clock running with nothing playing, and lets go on dispose", () => {
		const clock = createClock();
		let listening = 0;
		const onTick = clock.onTick;
		clock.onTick = (listener) => {
			listening++;
			const stop = onTick(listener);
			return () => {
				listening--;
				stop();
			};
		};
		const { graph, commit } = manualGraph({ clock });
		const node = graph.root.add(
			animatedBoundary.create({
				points: square,
				cycleRate: 1,
				drawEasing: "linear",
			}),
		);
		commit();
		expect(listening).toBe(1);
		clock.advance(0.4);
		commit();
		expect(shapeSpecsOf(node)[0]?.progress).toBeCloseTo(0.4, 9);
		node.dispose();
		expect(listening).toBe(0);
	});
});

const unitSquare = (x: number): Polyline => [
	{ x, y: 0 },
	{ x: x + 1, y: 0 },
	{ x: x + 1, y: 1 },
	{ x, y: 1 },
];

describe("transformMatchingShapes", () => {
	it("uses `blend`, not `progress` (type-level pin)", () => {
		const shapes = (props: Shapes) => props;
		expect(shapes({ from: [], to: [], blend: 0.5 }).blend).toBe(0.5);
		// @ts-expect-error `progress` is the reveal prop, not a morph blend
		shapes({ from: [], to: [], progress: 1 });
	});

	it("moves each part to its match as blend goes from 0 to 1, keeping its node", () => {
		const { graph, commit } = manualGraph();
		const blend = track(0);
		const node = graph.root.add(
			transformMatchingShapes.create({
				from: [{ polylines: [unitSquare(0)] }],
				to: [{ polylines: [unitSquare(3)] }],
				blend,
				fill: "#ff0000",
			}),
		);
		commit();
		const [start] = shapeSpecsOf(node);
		if (!start) throw new Error("expected a part");
		expect(start.style.fill).toBe("#ff0000");
		expect(start.style.stroke).toBe("#ff0000");
		expect(start.closed).toBe(true);
		const startX = Math.min(...start.polylines.flat().map((p) => p.x));
		expect(startX).toBeCloseTo(0, 6);
		const part = (
			node.children[0] as unknown as { children: readonly unknown[] }
		).children[0];
		blend.set(1);
		commit();
		const [end] = shapeSpecsOf(node);
		const endX = Math.min(...(end?.polylines.flat() ?? []).map((p) => p.x));
		expect(endX).toBeCloseTo(3, 6);
		expect(
			(node.children[0] as unknown as { children: readonly unknown[] })
				.children[0],
		).toBe(part);
	});

	it("applies transform props to the wrapping group", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			transformMatchingShapes.create({
				from: [{ polylines: [unitSquare(0)] }],
				to: [{ polylines: [unitSquare(0)] }],
				x: 2,
			}),
		);
		commit();
		const [part] = shapeSpecsOf(node);
		const minX = Math.min(...(part?.polylines.flat() ?? []).map((p) => p.x));
		expect(minX).toBeCloseTo(2, 6);
	});
});
