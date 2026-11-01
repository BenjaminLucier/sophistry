import { describe, expect, it } from "vitest";
import { chart } from "../chart.js";
import { mount } from "../test-harness.js";
import { stackPlot } from "./stack-plot.js";

const genres = ["jazz", "folk", "rock", "soul", "funk"];
const rows = Array.from({ length: 5 }, (_, week) => ({
	week,
	jazz: 1 + week,
	folk: 2,
	rock: 5,
	soul: 1,
	funk: 0.5,
}));

/** The legend's names, top to bottom. */
const legendOf = (extra: Record<string, unknown>) =>
	mount(
		chart.create({
			width: 8,
			height: 4,
			children: [
				stackPlot.create({
					data: rows,
					x: "week",
					y: genres,
					series: genres,
					...extra,
				} as never),
			],
		}),
	)
		.texts()
		.filter((t) => genres.includes(t.text))
		.sort((a, b) => b.at.y - a.at.y)
		.map((t) => t.text);

describe("a stack's legend", () => {
	it("lists the top band first, so it reads down as the stack does", () => {
		expect(legendOf({})).toEqual(["funk", "soul", "rock", "folk", "jazz"]);
	});

	it("follows the stack's own order (a streamgraph's inside-out)", () => {
		const listed = legendOf({ offset: "wiggle", order: "insideOut" });
		expect(listed).not.toEqual(genres);
		expect([...listed].sort()).toEqual([...genres].sort());
	});
});
