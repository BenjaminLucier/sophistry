/**
 * `bars` `labels`: value labels centred inside bars and stacked segments
 * (fit-checked in scene units, contrast-aware), stack totals past each
 * stack's end, `format`, and how they follow reveals and transitions.
 */

import type { SceneNode } from "@sophistry/core";
import type { TextSpec } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import type { ChartHandle, ChartProps } from "../chart";
import { chart as chartDefinition, chartHandle } from "../chart";
import { decimalsOf } from "../math/barLabels";
import type { AnyDatum } from "../props";
import { mount as mountGraph } from "../test-harness";
import type { BarsProps } from "./bars";
import { bars } from "./bars";
import { boxes, specsOf } from "./test-helpers";

type Scene = ReturnType<typeof mountGraph>;

let handle!: ChartHandle;
/** The last mounted `bars` node. */
let layerNode!: SceneNode;
const x = (value: number) => handle.coords.coordsToPoint(value, 0).x;
const y = (value: number) => handle.coords.coordsToPoint(0, value).y;

/** Mounts an 8 × 4 chart with no axes drawn around one `bars`, and keeps its handle. */
function mount(
	chartProps: Partial<ChartProps>,
	barsProps: Partial<BarsProps<AnyDatum>>,
): Scene {
	layerNode = bars.create(barsProps as BarsProps<AnyDatum>);
	const plot = chartDefinition.create({
		width: 8,
		height: 4,
		axis: { visible: false },
		legend: false,
		...chartProps,
		children: [layerNode],
	});
	const scene = mountGraph(plot);
	handle = chartHandle(plot) as ChartHandle;
	return scene;
}

/** The labels drawn (visible), with their text, anchor and opacity. */
const labels = (scene: Scene): TextSpec[] =>
	specsOf(scene.texts(), layerNode).filter(
		(s) => s.style.opacity > 0 && s.progress > 0,
	);
const textOf = (scene: Scene) => labels(scene).map((l) => l.text);
const find = (scene: Scene, text: string) => {
	const found = labels(scene).find((l) => l.text === text);
	if (!found) throw new Error(`no label "${text}" in ${textOf(scene)}`);
	return found;
};

const sales = [
	{ quarter: "Q1", region: "north", units: 3 },
	{ quarter: "Q1", region: "south", units: 5 },
	{ quarter: "Q2", region: "north", units: 4 },
	{ quarter: "Q2", region: "south", units: 2 },
];
type Sale = (typeof sales)[number];

function stacked(
	props: Partial<BarsProps<Sale>> & { chart?: Partial<ChartProps> },
) {
	const { chart: chartProps, ...rest } = props;
	return mount({ yRange: [0, 10], ...chartProps }, {
		data: sales,
		category: "quarter",
		value: "units",
		series: "region",
		layout: "stack",
		...rest,
	} as Partial<BarsProps<AnyDatum>>);
}

describe("decimalsOf", () => {
	it("counts the places a value is written with, exponents included", () => {
		expect(decimalsOf(12)).toBe(0);
		expect(decimalsOf(1.25)).toBe(2);
		expect(decimalsOf(-0.5)).toBe(1);
		// Written in exponent form: places after the point less the exponent.
		expect(decimalsOf(1.5e21)).toBe(0);
		expect(decimalsOf(2e21)).toBe(0);
	});
});

describe("inside labels", () => {
	it("are off by default: no labels at all", () => {
		const scene = stacked({});
		expect(textOf(scene)).toEqual([]);
	});

	it("centre each stacked segment's own value in it", () => {
		const scene = stacked({ labels: { position: "inside" } });
		expect(textOf(scene).sort()).toEqual(["2", "3", "4", "5"]);
		const south = find(scene, "5");
		const box = boxes(scene.marks()).find(
			(b) => Math.abs(b.maxY - y(8)) < 1e-6,
		);
		expect(box).toBeDefined();
		if (!box) return;
		expect(south.at.x).toBeCloseTo((box.minX + box.maxX) / 2);
		expect(south.at.y).toBeCloseTo((y(3) + y(8)) / 2);
	});

	it("is the default position of the options form", () => {
		const scene = stacked({ labels: {} });
		expect(find(scene, "3").at.y).toBeCloseTo((y(0) + y(3)) / 2);
	});

	it("write in whichever of foreground and background reads on the fill", () => {
		const scene = stacked({
			labels: { position: "inside" },
			color: "#ffff00",
		});
		const dark = find(scene, "3").style.fill;
		const onBlack = stacked({
			labels: { position: "inside" },
			color: "#000000",
			fillOpacity: 1,
		});
		expect(find(onBlack, "3").style.fill).not.toBe(dark);
	});

	it("lay out along x when horizontal", () => {
		const scene = mount(
			{ xRange: [0, 10] },
			{
				data: sales,
				category: "quarter",
				value: "units",
				series: "region",
				layout: "stack",
				orientation: "horizontal",
				labels: { position: "inside" },
			},
		);
		const south = find(scene, "5");
		expect(south.at.x).toBeCloseTo((x(3) + x(8)) / 2);
	});

	it("hide on a segment too small for them, unless overflow is shown", () => {
		const data = [
			{ quarter: "Q1", region: "north", units: 9.9 },
			{ quarter: "Q1", region: "south", units: 0.1 },
			{ quarter: "Q1", region: "west", units: 0 },
		];
		const at = (overflow?: "hide" | "show") =>
			mount(
				{ yRange: [0, 10] },
				{
					data,
					category: "quarter",
					value: "units",
					series: "region",
					layout: "stack",
					labels: { position: "inside", overflow },
				},
			);
		expect(textOf(at())).toEqual(["9.9"]);
		// Forced: the small one shows; the zero-length one never does.
		expect(textOf(at("show")).sort()).toEqual(["0.1", "9.9"]);
	});

	it("normalized stacks write shares as percents; format overrides", () => {
		const scene = stacked({
			offset: "normalize",
			labels: { position: "inside" },
			chart: { yRange: [0, 1] },
		});
		expect(textOf(scene).sort()).toEqual(["33.3%", "37.5%", "62.5%", "66.7%"]);
		const fixed = stacked({
			offset: "normalize",
			labels: { position: "inside", format: ".0%" },
			chart: { yRange: [0, 1] },
		});
		expect(textOf(fixed).sort()).toEqual(["33%", "38%", "63%", "67%"]);
	});

	it("diverging stacks centre their negative segments below zero", () => {
		const likert = [
			{ quarter: "A", region: "disagree", units: -3 },
			{ quarter: "A", region: "agree", units: 5 },
		];
		const scene = mount(
			{ yRange: [-5, 5] },
			{
				data: likert,
				category: "quarter",
				value: "units",
				series: "region",
				layout: "stack",
				labels: { position: "inside" },
			},
		);
		expect(find(scene, "-3").at.y).toBeCloseTo((y(0) + y(-3)) / 2);
		expect(find(scene, "5").at.y).toBeCloseTo((y(0) + y(5)) / 2);
	});

	it("work in grouped (dodged) bars too", () => {
		const scene = stacked({
			layout: "dodge",
			labels: { position: "inside" },
		});
		expect(find(scene, "5").at.y).toBeCloseTo((y(0) + y(5)) / 2);
	});
});

describe("stack totals", () => {
	it("write each stack's total past its end", () => {
		const scene = stacked({ labels: { total: true } });
		expect(textOf(scene).sort()).toEqual(["2", "3", "4", "5", "6", "8"]);
		expect(find(scene, "8").at.y).toBeGreaterThan(y(8));
		expect(find(scene, "6").at.y).toBeGreaterThan(y(6));
	});

	it('position "none" leaves only the totals, formatted', () => {
		const scene = stacked({
			labels: { position: "none", total: true, format: ".1f" },
		});
		expect(textOf(scene).sort()).toEqual(["6.0", "8.0"]);
	});

	it("give a diverging stack a total each way", () => {
		const data = [
			{ quarter: "A", region: "n1", units: -3 },
			{ quarter: "A", region: "n2", units: -1 },
			{ quarter: "A", region: "p", units: 5 },
		];
		const scene = mount(
			{ yRange: [-6, 6] },
			{
				data,
				category: "quarter",
				value: "units",
				series: "region",
				layout: "stack",
				labels: { position: "none", total: true },
			},
		);
		expect(textOf(scene).sort()).toEqual(["-4", "5"]);
		expect(find(scene, "-4").at.y).toBeLessThan(y(-4));
		expect(find(scene, "5").at.y).toBeGreaterThan(y(5));
	});
});

describe("labels through reveals and transitions", () => {
	it("count up and ride the stack mid-reveal; a segment not yet big enough has none", () => {
		const scene = stacked({
			labels: { position: "inside", total: true },
			progress: 0.5,
		});
		// The whole stack at value × 0.5: Q1 is 1.5 + 2.5 (written at the
		// rest value's places, "2" and "3"), totals 4 and 3.
		expect(textOf(scene).sort()).toEqual(["1", "2", "2", "3", "3", "4"]);
		const centres = labels(scene)
			.filter((l) => l.text === "3")
			.map((l) => l.at.y);
		expect(centres.some((c) => Math.abs(c - (y(1.5) + y(4)) / 2) < 1e-6)).toBe(
			true,
		);
		expect(find(scene, "4").at.y).toBeGreaterThan(y(4));
		// At a sliver of the reveal the segments are too short for their labels.
		const early = stacked({
			labels: { position: "inside" },
			progress: 0.03,
		});
		expect(textOf(early)).toEqual([]);
	});

	it("mid-blend, centres in the blended segment and blends the number", () => {
		const after = [
			{ quarter: "Q1", region: "north", units: 5 },
			{ quarter: "Q1", region: "south", units: 5 },
			{ quarter: "Q2", region: "north", units: 4 },
			{ quarter: "Q2", region: "south", units: 2 },
		];
		const scene = stacked({
			labels: { position: "inside", total: true },
			to: after,
			blend: 0.5,
			staging: "together",
		});
		// north in Q1 goes 3 → 5: halfway, 4, from 0 to 4.
		const north = labels(scene).filter((l) => l.text === "4");
		expect(north.some((l) => Math.abs(l.at.y - (y(0) + y(4)) / 2) < 1e-6)).toBe(
			true,
		);
		// The Q1 total blends 8 → 10.
		expect(textOf(scene)).toContain("9");
	});
});
