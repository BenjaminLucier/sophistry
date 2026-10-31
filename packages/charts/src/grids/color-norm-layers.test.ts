/**
 * Log and diverging colour norms across the colour-mapped layers: each
 * layer's colours and the ramp it reports for the frame's colour bar read
 * one mapping, so a value's colour on the layer is the colour at its place
 * on the bar (the bar's own tick
 * placement waits for the frame's colour bar).
 */

import type { SceneNode } from "@sophistry/core";
import { axes } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import type { ImageSpec } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import type { RampExtent } from "../frame/types";
import { mount } from "../test-harness";
import { cells } from "./cells";
import { contour } from "./contour";
import { contourF } from "./contour-f";
import { hexBin } from "./hex-bin";
import { hist2d } from "./hist2d";
import { imshow } from "./imshow";
import { pcolormesh } from "./pcolormesh";
import { inChart, itemBox, itemsOf, recorder } from "./test-support";
import { tripcolor } from "./tripcolor";

/** A ramp that writes its input into the colour, so a fill reads back as `t`. */
const probe = (t: number) =>
	`rgb(${Math.round(Math.min(1, Math.max(0, t)) * 1000) / 4}, 0, 7)`;
/** A fill made by {@link probe}, back to its `t`. */
const tOf = (fill: unknown): number => {
	const match = /rgba?\(\s*([\d.]+)/.exec(String(fill));
	return match ? (Number(match[1]) * 4) / 1000 : Number.NaN;
};

/** The colour bar's gradient rectangle's box. */
function barOf(scene: ReturnType<typeof mount>) {
	const bar = scene
		.shapes()
		.find(
			(s) =>
				typeof s.style.fill === "object" &&
				s.style.fill !== null &&
				"stops" in s.style.fill,
		);
	if (!bar) throw new Error("no colour bar");
	const points = bar.polylines.flatMap((line) => {
		const raw = line as unknown;
		return (
			Array.isArray(raw) ? raw : (raw as { points: Point[] }).points
		) as Point[];
	});
	return {
		minX: Math.min(...points.map((p) => p.x)),
		maxX: Math.max(...points.map((p) => p.x)),
		minY: Math.min(...points.map((p) => p.y)),
		maxY: Math.max(...points.map((p) => p.y)),
	};
}
/** Where a tick number sits along a vertical bar, 0 (bottom) to 1 (top). */
function tickAt(scene: ReturnType<typeof mount>, text: string): number {
	const bar = barOf(scene);
	const at = scene
		.texts()
		.find((t) => t.text === text && t.at.x > bar.maxX)?.at;
	if (!at) throw new Error(`no tick "${text}"`);
	return (at.y - bar.minY) / (bar.maxY - bar.minY);
}

/** Mounts `layer` in plain axes under a recorder: the layer's report and the scene. */
function reported(layer: SceneNode, xRange: [number, number] = [0, 5]) {
	const { node, reports } = recorder(
		axes.create({
			xRange: [xRange[0], xRange[1], 1],
			yRange: [0, 1, 1],
			width: 6,
			height: 3,
			children: [layer],
		} as never),
	);
	const scene = mount(node);
	return { scene, ramp: reports()[0]?.ramp as RampExtent };
}

/** Where a value sits on a reported ramp, 0..1 (its scale, else linear over its domain). */
const placeOn = (ramp: RampExtent, value: number) =>
	ramp.scale
		? ramp.scale.toUnit(value)
		: (value - ramp.domain[0]) / (ramp.domain[1] - ramp.domain[0]);

/** An image's pixels' `t`s, row by row, transparent ones left out. */
function pixelTs(scene: ReturnType<typeof mount>): number[] {
	const image = scene.graph.frame.find((s) => s.kind === "image") as
		| ImageSpec
		| undefined;
	if (!image) throw new Error("no image");
	const out: number[] = [];
	const { data } = image.pixels;
	for (let i = 0; i < data.length; i += 4)
		if ((data[i + 3] as number) > 0) out.push(((data[i] as number) * 4) / 1000);
	return out;
}

describe("log norm", () => {
	it("imshow rampScale='log': cells and the reported ramp's decades agree", () => {
		const { scene, ramp } = reported(
			imshow.create({
				values: [[1, 10, 100, 1000, 0]],
				ramp: probe,
				rampScale: "log",
				xRange: [0, 5],
				yRange: [0, 1],
			}),
		);
		// The zero cell is missing under a log norm.
		const ts = pixelTs(scene);
		expect(ts).toHaveLength(4);
		// The 256-step table: within a step and a rounding of the exact colour.
		[0, 1 / 3, 2 / 3, 1].forEach((want, i) => {
			expect(Math.abs((ts[i] as number) - want)).toBeLessThan(0.008);
		});
		expect(placeOn(ramp, 10)).toBeCloseTo(1 / 3, 2);
		expect(placeOn(ramp, 100)).toBeCloseTo(2 / 3, 2);
	});

	const data = [
		...Array.from({ length: 100 }, () => ({ x: 0.5, y: 0.5 })),
		...Array.from({ length: 10 }, () => ({ x: 1.5, y: 0.5 })),
		{ x: 2.5, y: 0.5 },
	];

	it("hist2d and hexBin rampScale='log' span the drawn counts", () => {
		const hist = reported(
			hist2d.create({
				data,
				x: "x",
				y: "y",
				xBins: 3,
				yBins: 1,
				xRange: [0, 3],
				yRange: [0, 1],
				ramp: probe,
				rampScale: "log",
			}),
			[0, 3],
		);
		const ts = itemsOf(hist.scene.marks())
			.map((s) => tOf(s.fill))
			.sort((a, b) => a - b);
		expect(ts).toEqual([0, 0.5, 1]);
		expect(placeOn(hist.ramp, 10)).toBeCloseTo(0.5, 2);
		const hex = reported(
			hexBin.create({
				data,
				x: "x",
				y: "y",
				radius: 0.3,
				ramp: probe,
				rampScale: "log",
			}),
			[0, 3],
		);
		expect(
			itemsOf(hex.scene.marks())
				.map((s) => tOf(s.fill))
				.sort((a, b) => a - b),
		).toEqual([0, 0.5, 1]);
	});

	it("hist2d rampMin lifts the emptiest drawn cell off the ramp's floor; hexBin rampMax clamps", () => {
		const hist = reported(
			hist2d.create({
				data,
				x: "x",
				y: "y",
				xBins: 3,
				yBins: 1,
				xRange: [0, 3],
				yRange: [0, 1],
				ramp: probe,
				rampScale: "log",
				rampMin: 0.1,
			}),
			[0, 3],
		);
		const ts = itemsOf(hist.scene.marks())
			.map((s) => tOf(s.fill))
			.sort((a, b) => a - b);
		expect(ts[0]).toBeCloseTo(1 / 3, 2);
		expect(ts[1]).toBeCloseTo(2 / 3, 2);
		expect(ts[2]).toBeCloseTo(1, 2);
		expect(placeOn(hist.ramp, 1)).toBeCloseTo(1 / 3, 2);
		// Linear, with only `rampMax`: 0 stays the low end, the fullest cell clamps.
		const hex = reported(
			hexBin.create({
				data,
				x: "x",
				y: "y",
				radius: 0.3,
				ramp: probe,
				rampMax: 50,
			}),
			[0, 3],
		);
		const hexTs = itemsOf(hex.scene.marks())
			.map((s) => tOf(s.fill))
			.sort((a, b) => a - b);
		expect(hexTs[0]).toBeCloseTo(0.02, 2);
		expect(hexTs[1]).toBeCloseTo(0.2, 2);
		expect(hexTs[2]).toBeCloseTo(1, 2);
	});

	it("contourF rampScale='log' spaces a count of levels in decades and colours by them", () => {
		const { scene, ramp } = reported(
			contourF.create({
				xs: [0, 1, 2, 3],
				ys: [0, 1],
				values: [
					[1, 10, 100, 1000],
					[1, 10, 100, 1000],
				],
				levels: 4,
				rampScale: "log",
				ramp: probe,
			}),
			[0, 3],
		);
		// Three bands (1–10, 10–100, 100–1000), one per column: their middles
		// along the norm sit at 1/6, 1/2 and 5/6.
		const bands = itemsOf(scene.marks()).sort(
			(a, b) => itemBox(a).minX - itemBox(b).minX,
		);
		expect(bands).toHaveLength(3);
		expect(tOf(bands[0]?.fill)).toBeCloseTo(1 / 6, 2);
		expect(tOf(bands[1]?.fill)).toBeCloseTo(1 / 2, 2);
		expect(tOf(bands[2]?.fill)).toBeCloseTo(5 / 6, 2);
		expect(placeOn(ramp, 100)).toBeCloseTo(2 / 3, 2);
	});

	it("contour rampScale='log' traces geometric levels", () => {
		const { scene } = reported(
			contour.create({
				xs: [0, 1, 2, 3],
				ys: [0, 1],
				values: [
					[1, 10, 100, 1000],
					[1, 10, 100, 1000],
				],
				levels: 2,
				rampScale: "log",
				ramp: probe,
			}),
			[0, 3],
		);
		// Levels 10 and 100: on the second and third columns.
		const ts = itemsOf(scene.marks())
			.map((s) => tOf(s.stroke))
			.sort((a, b) => a - b);
		expect(ts[0]).toBeCloseTo(1 / 3, 2);
		expect(ts[1]).toBeCloseTo(2 / 3, 2);
	});
});

describe("diverging norm (rampMidpoint)", () => {
	it("cells rampMidpoint: an asymmetric two-slope domain", () => {
		const data = [
			{ c: "a", v: -2 },
			{ c: "b", v: 0 },
			{ c: "c", v: 5 },
			{ c: "d", v: 10 },
		];
		const scene = inChart(
			{ width: 6, height: 3, colorbar: true },
			cells.create({
				data,
				x: "c",
				y: () => "r",
				value: "v",
				ramp: probe,
				rampMidpoint: 0,
				rampMin: -2,
				rampMax: 10,
			}),
		);
		const ts = itemsOf(scene.marks())
			.sort((a, b) => itemBox(a).minX - itemBox(b).minX)
			.map((s) => tOf(s.fill));
		expect(ts).toEqual([0, 0.5, 0.75, 1]);
	});

	it("cells rampMidpoint: the colour bar's centre sits mid-bar", () => {
		const scene = inChart(
			{ width: 6, height: 3, colorbar: true },
			cells.create({
				data: [
					{ c: "a", v: -2 },
					{ c: "b", v: 0 },
					{ c: "c", v: 5 },
					{ c: "d", v: 10 },
				],
				x: "c",
				y: () => "r",
				value: "v",
				ramp: probe,
				rampMidpoint: 0,
				rampMin: -2,
				rampMax: 10,
			}),
		);
		expect(tickAt(scene, "0")).toBeCloseTo(0.5, 2);
		expect(tickAt(scene, "-2")).toBeCloseTo(0, 2);
		expect(tickAt(scene, "5")).toBeCloseTo(0.75, 2);
	});

	it("pcolormesh rampMidpoint with no rampMin/rampMax is symmetric about the centre", () => {
		const { scene, ramp } = reported(
			pcolormesh.create({
				xs: [0, 1, 2],
				ys: [0, 1],
				values: [[-2, 8]],
				ramp: probe,
				rampMidpoint: 0,
			}),
			[0, 2],
		);
		const ts = itemsOf(scene.marks())
			.sort((a, b) => itemBox(a).minX - itemBox(b).minX)
			.map((s) => tOf(s.fill));
		expect(ts).toEqual([0.375, 1]);
		// The domain is −8..8: −5 sits 3/16 up the bar.
		expect(placeOn(ramp, -5)).toBeCloseTo(3 / 16, 2);
		expect(placeOn(ramp, 0)).toBeCloseTo(0.5, 2);
	});

	it("tripcolor rampMidpoint reports its centred scale", () => {
		const { scene, ramp } = reported(
			tripcolor.create({
				data: [
					{ x: 0, y: 0, v: -1 },
					{ x: 1, y: 0, v: -1 },
					{ x: 0, y: 1, v: -1 },
					{ x: 1, y: 1, v: 9 },
				],
				x: "x",
				y: "y",
				value: "v",
				ramp: probe,
				rampMidpoint: 0,
				rampMin: -1,
				rampMax: 9,
			}),
			[0, 1],
		);
		expect(placeOn(ramp, 0)).toBeCloseTo(0.5, 2);
		const ts = itemsOf(scene.marks()).map((s) => tOf(s.fill));
		expect(ts.length).toBeGreaterThan(0);
		for (const t of ts) expect(t).toBeGreaterThanOrEqual(0);
	});
});

describe("defaults", () => {
	it("no norm keeps the linear colours and reports a linear ramp", () => {
		const { scene, ramp } = reported(
			imshow.create({
				values: [[0, 5, 10]],
				ramp: probe,
				xRange: [0, 3],
				yRange: [0, 1],
			}),
			[0, 3],
		);
		const ts = pixelTs(scene);
		[0, 0.5, 1].forEach((want, i) => {
			expect(Math.abs((ts[i] as number) - want)).toBeLessThan(0.008);
		});
		expect(ramp.scale).toBeUndefined();
		expect(ramp.domain).toEqual([0, 10]);
	});
});
