import { describe, expect, it } from "vitest";
import { chart } from "../chart";
import { markItems, mount } from "../test-harness";
import {
	beeswarm,
	eventPlot,
	labels,
	links,
	rects,
	rug,
	scatter,
	stem,
	strip,
	tickX,
	tickY,
	vectors,
} from ".";

describe("point marks smoke", () => {
	const rows = [
		{ x: 1, y: 2, g: "a", t: 0 },
		{ x: 2, y: 5, g: "b", t: 1 },
		{ x: 4, y: 3, g: "a", t: 2 },
	];
	const cases: [string, () => import("@sophistry/core").SceneNode][] = [
		[
			"scatter",
			() =>
				scatter.create({
					data: rows,
					x: "x",
					y: "y",
					symbol: (d: { g: string }) => (d.g === "a" ? "circle" : "square"),
				}),
		],
		[
			"scatter time",
			() =>
				scatter.create({
					data: rows,
					x: "x",
					y: "y",
					time: "t",
					key: "g",
					at: 1.5,
					trail: true,
				}),
		],
		["rug", () => rug.create({ data: [1, 2, 3] })],
		["tickX", () => tickX.create({ data: rows, x: "x", y: "g" })],
		["tickY", () => tickY.create({ data: rows, y: "y" })],
		["stem", () => stem.create({ data: [1, 3, 2] })],
		["strip", () => strip.create({ data: rows, value: "y", category: "g" })],
		[
			"beeswarm",
			() => beeswarm.create({ data: rows, value: "y", category: "g" }),
		],
		["labels", () => labels.create({ data: rows, x: "x", y: "y", text: "g" })],
		[
			"links",
			() =>
				links.create({
					data: rows,
					x1: "x",
					y1: "y",
					x2: "y",
					y2: "x",
					arrow: true,
				}),
		],
		[
			"vectors",
			() => vectors.create({ data: rows, x: "x", y: "y", u: "x", v: "y" }),
		],
		["rects", () => rects.create({ data: rows, x1: "x", x2: "y" })],
		["eventPlot", () => eventPlot.create({ data: [[1, 2], [3]] })],
	];
	for (const [name, make] of cases)
		it(name, () => {
			const scene = mount(
				chart.create({ width: 8, height: 4, children: [make()] }),
			);
			const out = scene
				.marks()
				.map((m) => [m.shape.kind, m.count, markItems(m).length]);
			expect(out.length + scene.texts().length).toBeGreaterThan(0);
		});
});
