/**
 * `numberLine`: its node structure (line, majors, minors, numbers, children),
 * `tickFormat` (a built-in formatter name or a function of
 * `(value, decimalPlaces?)`), the
 * coordinate system it publishes, and range changes.
 */

import { describe, expect, it } from "vitest";
import { defineComposite } from "../scene/composite";
import { Invalidate } from "../scene/context";
import { circle } from "../shapes/circle";
import { imaginaryTick } from "./complex-plane";
import type { CoordinateSystem } from "./coords";
import {
	coordsContext,
	coordsOf,
	coordsReadable,
	requireCoords,
} from "./coords";
import type { NumberLineProps } from "./number-line";
import { numberLine, unitInterval } from "./number-line";
import { mount } from "./test-scene";

function labels(props: Partial<NumberLineProps>): string[] {
	const scene = mount(
		numberLine.create({ range: [0, 6, 2], length: 6, ...props }),
	);
	return scene.texts().map((spec) => spec.text);
}

describe("numberLine descriptor", () => {
	it("is a named composite taking children", () => {
		expect(numberLine.name).toBe("NumberLine");
		expect(numberLine.kind).toBe("composite");
		expect(numberLine.container).toBe(true);
		expect(numberLine.descriptor.range.invalidates).toBe(Invalidate.UPDATE);
		expect(numberLine.descriptor.stroke.invalidates).toBe(Invalidate.UPDATE);
		// The children bind to the phases: a reveal never reruns the layout.
		expect(numberLine.descriptor.progress.invalidates).toBe(Invalidate.NONE);
		expect(numberLine.descriptor.tipShape.default).toBe("triangle");
		expect("x" in numberLine.descriptor).toBe(false);
	});
});

describe("numberLine structure", () => {
	it("is a line, then majors, minors and numbers, then the children", () => {
		const child = circle.create({ radius: 0.1 });
		const node = numberLine.create({
			range: [0, 4, 1],
			length: 4,
			minorTickCount: 1,
			children: [child],
		});
		mount(node);
		const types = node.children.map((c) => c.type);
		expect(types[0]).toBe("Line");
		// 5 majors, 4 minors, 5 numbers.
		expect(types.slice(1, 10)).toEqual(Array(9).fill("Line"));
		expect(types.slice(10, 15)).toEqual(Array(5).fill("Label"));
		expect(node.children.at(-1)).toBe(child);
	});

	it("draws an arrow with `tip`, swapping the line node", () => {
		const node = numberLine.create({ range: [0, 4, 1], length: 4, tip: true });
		const { commit } = mount(node);
		expect(node.children[0]?.type).toBe("Arrow");
		node.set("tip", false);
		commit();
		expect(node.children[0]?.type).toBe("Line");
	});

	it("centres the range midpoint and bakes rotation into the geometry", () => {
		const scene = mount(
			numberLine.create({
				range: [0, 4, 1],
				length: 4,
				center: { x: 1, y: 1 },
				rotation: Math.PI / 2,
				ticks: false,
				numbers: false,
			}),
		);
		const [axis] = scene.segments();
		expect(axis?.a.x).toBeCloseTo(1);
		expect(axis?.a.y).toBeCloseTo(-1);
		expect(axis?.b.x).toBeCloseTo(1);
		expect(axis?.b.y).toBeCloseTo(3);
	});

	it("spends progress line, ticks, numbers", () => {
		const node = numberLine.create({
			range: [0, 2, 1],
			length: 2,
			progress: 0.5,
		});
		const scene = mount(node);
		const [axis, tick] = scene.shapes();
		expect(axis?.progress).toBe(1);
		expect(tick?.progress).toBeCloseTo(0.5);
		// Numbers fade in whole once their phase starts; not yet.
		expect(scene.texts()).toHaveLength(0);
		node.set("progress", 5 / 6);
		scene.commit();
		expect(scene.texts().every((t) => t.progress === 1)).toBe(true);
		expect(scene.texts()[0]?.style.opacity).toBeCloseTo(0.5);
	});
});

describe("numberLine coordinates", () => {
	it("publishes a system whose y is always 0", () => {
		const node = numberLine.create({ range: [-2, 2], length: 8 });
		const coords = coordsOf(node) as CoordinateSystem;
		expect(coords.coordsToPoint(1, 5)).toEqual({ x: 2, y: 0 });
		expect(coords.pointToCoords({ x: 2, y: 3 })).toEqual({ x: 1, y: 0 });
		expect(coords.yRange()).toEqual([0, 0]);
		expect(coords.crossing()).toEqual({ x: 0, y: 0 });
		expect(coords.area()).toEqual({ minX: -4, minY: 0, maxX: 4, maxY: 0 });
	});

	it("re-provides a new system on a range change and moves dependents", () => {
		const seen: CoordinateSystem[] = [];
		const marker = defineComposite<object>({
			name: "Marker",
			props: {},
			setup: (ctx) => {
				const coords = requireCoords(ctx, "Marker");
				seen.push(coords);
				return [
					circle.create({ radius: 0.1, center: coords.coordsToPoint(1) }),
				];
			},
			update: (changed, ctx) => {
				if (!changed.has(coordsContext)) return undefined;
				const coords = requireCoords(ctx, "Marker");
				seen.push(coords);
				const [dot] = ctx.node.children;
				dot?.set("center" as never, coords.coordsToPoint(1) as never);
				return undefined;
			},
		});
		const dependent = marker.create();
		const node = numberLine.create({
			range: [0, 2],
			length: 2,
			numbers: false,
			ticks: false,
			children: [dependent],
		});
		const readable = coordsReadable(node);
		const scene = mount(node);
		const before = readable.peek();
		expect(seen).toHaveLength(1);
		// An unrelated prop keeps the system.
		node.set("stroke", "#f00");
		scene.commit();
		expect(readable.peek()).toBe(before);
		expect(seen).toHaveLength(1);
		node.set("range", [0, 4]);
		scene.commit();
		expect(readable.peek()).not.toBe(before);
		expect(seen).toHaveLength(2);
		expect(dependent.children[0]?.get("center" as never)).toEqual({
			x: -0.5,
			y: 0,
		});
	});

	it("requireCoords throws outside a coordinate system", () => {
		const lonely = defineComposite<object>({
			name: "Lonely",
			props: {},
			setup: (ctx) => {
				requireCoords(ctx, "Lonely");
				return [];
			},
		});
		expect(() => mount(lonely.create())).toThrow(
			/<Lonely> must be rendered inside/,
		);
	});
});

describe("numberLine range transitions", () => {
	it("cross-fades numbers by value and maps through the blend", () => {
		const node = numberLine.create({
			range: { from: [0, 4, 1], to: [0, 8, 2], t: 0.5 },
			length: 6,
		});
		const scene = mount(node);
		expect(coordsOf(node)?.xRange()).toEqual([0, 6]);
		const byText = new Map(scene.texts().map((t) => [t.text, t]));
		// On both ends: full strength. Only on the old end: half faded.
		expect(byText.get("2")?.style.opacity ?? 1).toBeCloseTo(1);
		expect(byText.get("3")?.style.opacity).toBeCloseTo(0.5);
	});
});

describe("unitInterval", () => {
	it("is a number line over [0, 1] with a tick every 0.25", () => {
		const scene = mount(unitInterval.create({ length: 4 }));
		expect(scene.texts().map((t) => t.text)).toEqual([
			"0",
			"0.25",
			"0.5",
			"0.75",
			"1",
		]);
	});
});

describe("numberLine tickFormat", () => {
	it("defaults to plain numbers", () => {
		expect(labels({})).toEqual(["0", "2", "4", "6"]);
	});

	it("takes a built-in formatter name", () => {
		expect(labels({ range: [0, 3000, 1000], tickFormat: "si" })).toEqual([
			"0",
			"1k",
			"2k",
			"3k",
		]);
		const pi = labels({
			range: [0, 2 * Math.PI, Math.PI / 2],
			tickFormat: "piMultiple",
		});
		expect(pi).toEqual(["0", "π/2", "π", "3π/2", "2π"]);
	});

	it("takes a function, and passes decimalPlaces through", () => {
		expect(labels({ tickFormat: (v) => `${v}%` })).toEqual([
			"0%",
			"2%",
			"4%",
			"6%",
		]);
		expect(
			labels({
				decimalPlaces: 1,
				tickFormat: (v, places) => `${v.toFixed(places)}!`,
			}),
		).toEqual(["0.0!", "2.0!", "4.0!", "6.0!"]);
	});

	it("a time scale ticks on the calendar and writes dates", () => {
		expect(
			labels({
				range: [Date.UTC(2024, 0, 1), Date.UTC(2024, 3, 1)],
				scale: "utc",
			}),
		).toEqual(["2024", "February", "March", "April"]);
	});

	it("an explicit tickFormat still wins over the scale's own", () => {
		expect(
			labels({
				range: [Date.UTC(2024, 0, 1), Date.UTC(2024, 3, 1)],
				scale: "utc",
				tickFormat: (v) => String(new Date(v).getUTCMonth()),
			}),
		).toEqual(["0", "1", "2", "3"]);
	});

	it("imaginaryTick is a tick formatter", () => {
		expect(imaginaryTick(1)).toBe("i");
		expect(imaginaryTick(-1)).toBe("-i");
		expect(imaginaryTick(2)).toBe("2i");
		expect(imaginaryTick(0)).toBe("0");
		expect(labels({ range: [0, 2, 1], tickFormat: imaginaryTick })).toEqual([
			"0",
			"i",
			"2i",
		]);
	});
});
