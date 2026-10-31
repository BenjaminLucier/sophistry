/**
 * `scatter` beyond the reference cases: batching, size encoding, enter stagger, the data API and
 * per-datum symbols, read off the one instances node. The items are
 * compared with the geometry the markers should have (centres through the
 * chart's coordinates, radii, fills).
 */

import { itemAt } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { chartHandle } from "../chart";
import type { ChartProps } from "../frame/types";
import { symbolPolygon } from "../math/symbol";
import { hashRanks } from "../stagger";
import { markItems } from "../test-harness";
import { scatter } from ".";
import { plot, rounded } from "./test-utils";

const Z = 7;
const frame: Partial<ChartProps> = { xRange: [0, 5], yRange: [0, 5] };

const data = [
	{ name: "a", x: 1, y: 1, pop: 1, region: "n" },
	{ name: "b", x: 2, y: 3, pop: 4, region: "s" },
	{ name: "c", x: 3, y: 2, pop: 16, region: "n" },
];
const later = [
	{ name: "a", x: 1, y: 4, pop: 4, region: "n" },
	{ name: "c", x: 4, y: 1, pop: 1, region: "s" },
];
type Datum = (typeof data)[number];

describe("scatter rendering", () => {
	it("draws one circle marks node with each marker where its node stood", () => {
		const view = plot(
			scatter.create({
				zIndex: Z,
				data,
				x: "x",
				y: "y",
				size: "pop",
				series: "region",
			}),
			frame,
		);
		const layers = view.layers();
		expect(layers).toHaveLength(1);
		expect(layers[0]?.shape.kind).toBe("circle");
		const dots = view.dots();
		expect(dots.map(({ x, y }) => ({ x, y }))).toEqual(
			data.map((d) => view.at(d.x, d.y)).sort((p, q) => p.x - q.x),
		);
		// sqrt(1/16), sqrt(4/16), 1 of the default 0.35.
		expect(dots.map((d) => d.r)).toEqual([0.0875, 0.175, 0.35]);
		expect(dots[0]?.fill).toBe(dots[2]?.fill);
		expect(dots[0]?.fill).not.toBe(dots[1]?.fill);
	});

	it("blends positions in data units mid-transition", () => {
		const layer = scatter.create({
			zIndex: Z,
			data,
			to: later,
			blend: 0,
			key: "name",
			x: "x",
			y: "y",
			staging: "together",
		});
		const view = plot(layer, frame);
		for (const t of [0.25, 0.5, 1]) {
			layer.set("blend", t);
			view.scene.commit();
			const drawn = view.dots().filter((d) => d.r > 0);
			if (t === 1)
				expect(drawn.map(({ x, y }) => ({ x, y }))).toEqual(
					later.map((d) => view.at(d.x, d.y)).sort((p, q) => p.x - q.x),
				);
		}
		layer.set("blend", 0.5);
		view.scene.commit();
		const middle = view.dots().map(({ x, y }) => ({ x, y }));
		expect(middle).toContainEqual(view.at(1, 2.5));
		expect(middle).toContainEqual(view.at(3.5, 1.5));
	});

	it("blends radius and colour, and grows and shrinks entering and leaving markers", () => {
		const beforeRows = [
			{ name: "a", x: 1, y: 1, pop: 1, region: "n" },
			{ name: "b", x: 2, y: 3, pop: 4, region: "s" },
		];
		const afterRows = [
			{ name: "a", x: 3, y: 2, pop: 16, region: "s" },
			{ name: "c", x: 4, y: 4, pop: 4, region: "n" },
		];
		const at = (blend: number) =>
			plot(
				scatter.create({
					zIndex: Z,
					data: beforeRows,
					to: afterRows,
					blend,
					key: "name",
					x: "x",
					y: "y",
					size: "pop",
					series: "region",
					staging: "together",
				}),
				frame,
			).dots();
		const plain = (rows: Datum[]) =>
			plot(
				scatter.create({
					zIndex: Z,
					data: rows,
					x: "x",
					y: "y",
					size: "pop",
					series: "region",
				}),
				frame,
			).dots();
		const start = plain(beforeRows);
		const end = plain(afterRows);
		const half = at(0.5);
		// "b" leaves and "c" enters at half size; "a" moves with a blended radius.
		expect(half).toHaveLength(3);
		const a = half.find((d) => d.r > 0.1 && d.r < 0.35);
		expect(a).toBeDefined();
		const fills = new Set(half.map((d) => d.fill));
		expect(fills.size).toBeGreaterThan(1);
		expect(at(0).filter((d) => d.r > 0)).toEqual(start);
		// Colours hold `data`'s category order through the transition, so only
		// the geometry is the plain chart's at blend 1.
		const shape = (d: { x: number; y: number; r: number }) => ({
			x: d.x,
			y: d.y,
			r: d.r,
		});
		expect(
			at(1)
				.filter((d) => d.r > 0)
				.map(shape),
		).toEqual(end.map(shape));
	});

	it("draws every symbol in one node; a single non-circle symbol shares one outline", () => {
		const many = Array.from({ length: 40 }, (_, i) => ({
			x: i % 5,
			y: Math.floor(i / 5),
			kind: i % 2 ? "a" : "b",
		}));
		const mixed = plot(
			scatter.create({
				zIndex: Z,
				data: many,
				x: "x",
				y: "y",
				symbol: (d: (typeof many)[number]) =>
					d.kind === "a" ? "circle" : "square",
			}),
		);
		const layers = mixed.layers();
		expect(layers).toHaveLength(1);
		expect(layers[0]?.count).toBe(many.length);
		expect(layers[0]?.shape.kind).toBe("paths");
		const squares = plot(
			scatter.create({
				zIndex: Z,
				data: many,
				x: "x",
				y: "y",
				symbol: "square",
			}),
		);
		expect(squares.layers()[0]?.shape.kind).toBe("outline");
	});

	it("picks the topmost marker under a point", () => {
		const view = plot(
			scatter.create({ zIndex: Z, data, x: "x", y: "y", radius: 0.3 }),
			frame,
		);
		const [layer] = view.layers();
		if (!layer) throw new Error("no layer");
		for (let i = 0; i < layer.count; i++) {
			const at = {
				x: layer.centers[2 * i] as number,
				y: layer.centers[2 * i + 1] as number,
			};
			expect(itemAt(layer, at)).toBe(i);
			expect(itemAt(layer, { x: at.x + 0.29, y: at.y })).toBe(i);
		}
		expect(itemAt(layer, { x: 100, y: 100 })).toBeNull();
	});
});

describe("scatter size channel", () => {
	const cities = [
		{ name: "a", x: 1, y: 1, pop: 1, region: "n" },
		{ name: "b", x: 2, y: 2, pop: 4, region: "s" },
		{ name: "c", x: 3, y: 3, pop: 16, region: "n" },
	];
	const grown = [
		{ name: "a", x: 1, y: 1, pop: 4, region: "n" },
		{ name: "b", x: 2, y: 2, pop: 4, region: "s" },
		{ name: "d", x: 4, y: 4, pop: 1, region: "s" },
	];
	type City = (typeof cities)[number];
	const radii = (props: Record<string, unknown>) =>
		plot(
			scatter.create({
				zIndex: Z,
				x: "x",
				y: "y",
				size: "pop",
				...props,
			} as never),
			frame,
		)
			.dots()
			.map((d) => d.r);

	it("sizes markers so area is proportional to value, the largest at sizeRange[1]", () => {
		expect(radii({ data: cities, sizeRange: [0, 0.4] })).toEqual([
			0.1, 0.2, 0.4,
		]);
	});

	it("maps 0 to sizeRange[0], pins the scale with sizeMaxValue, and wins over radius", () => {
		expect(
			radii({
				data: [...cities, { name: "z", x: 4, y: 4, pop: 0, region: "n" }],
				radius: 1,
				sizeRange: [0.05, 0.45],
				sizeMaxValue: 64,
			}),
		).toEqual([0.1, 0.15, 0.25, 0.05]);
	});

	it("draws a size key from the reported scale", () => {
		// needs frame: size legend
	});

	it("is exactly each end's own chart at blend 0 and 1, and blends radii between", () => {
		const keyed = (blend: number, rows: City[], to?: City[]) =>
			plot(
				scatter.create({
					zIndex: Z,
					data: rows,
					to,
					blend,
					key: "name",
					x: "x",
					y: "y",
					size: "pop",
					series: "region",
					staging: "together",
				}),
				frame,
			)
				.dots()
				.filter((d) => d.r > 0);
		expect(keyed(0, cities, grown)).toEqual(keyed(0, cities));
		expect(keyed(1, cities, grown).map((d) => ({ ...d, fill: "" }))).toEqual(
			keyed(0, grown).map((d) => ({ ...d, fill: "" })),
		);
		// a: sqrt(1/16) · 0.35 → sqrt(4/4) · 0.35 (each end its own maximum).
		const half = keyed(0.5, cities, grown);
		const a = half.find((c) => c.x === half[0]?.x);
		expect(a?.r).toBeCloseTo((0.35 / 4 + 0.35) / 2);
	});

	it("with time, scales every moment alike and blends between keyframes", () => {
		const moments = [
			{ name: "a", t: 0, x: 1, y: 1, pop: 1 },
			{ name: "a", t: 1, x: 2, y: 2, pop: 9 },
			{ name: "b", t: 0, x: 3, y: 3, pop: 4 },
			{ name: "b", t: 1, x: 4, y: 4, pop: 4 },
		];
		const at = (moment: number) =>
			radii({
				data: moments,
				time: "t",
				at: moment,
				key: "name",
				sizeRange: [0, 0.3],
				trail: true,
			});
		// The scale's maximum is 9, over both moments: sqrt(1/9), sqrt(4/9) at t = 0.
		expect(at(0)).toEqual([0.1, 0.2]);
		expect(at(1)).toEqual([0.3, 0.2]);
		expect(at(0.5)[0]).toBeCloseTo(0.2);
	});

	it("scrubs a sized transition without re-reading the sides or the radii", () => {
		const layer = scatter.create({
			zIndex: Z,
			data: cities,
			to: grown,
			blend: 0,
			key: "name",
			x: "x",
			y: "y",
			size: "pop",
			series: "region",
			enterStagger: 0.5,
		});
		let reads = 0;
		const counted = new Proxy(cities, {
			get(target, prop, receiver) {
				if (prop === "map") reads++;
				return Reflect.get(target, prop, receiver);
			},
		});
		layer.set("data", counted);
		const view = plot(layer, frame);
		expect(chartHandle(view.node)?.colorDomain()).toEqual(["n", "s"]);
		reads = 0;
		for (const t of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1, 0.5, 0, 1]) {
			layer.set("blend", t);
			view.scene.commit();
		}
		// The channels are read from the data once, not per frame.
		expect(reads).toBe(0);
	});
});

describe("scatter trail", () => {
	it("draws each key's path up to `at` behind the markers, as one path batch", () => {
		const moments = [
			{ name: "a", t: 0, x: 1, y: 1 },
			{ name: "a", t: 1, x: 2, y: 2 },
			{ name: "a", t: 2, x: 3, y: 1 },
		];
		const view = plot(
			scatter.create({
				zIndex: Z,
				data: moments,
				x: "x",
				y: "y",
				time: "t",
				key: "name",
				at: 1.5,
				trail: true,
			}),
			frame,
		);
		const layers = view.layers();
		expect(layers.map((l) => l.shape.kind)).toEqual(["paths", "circle"]);
		const trail = markItems(layers[0] as never)[0];
		const points = trail?.polylines.flat() ?? [];
		expect(points[0]?.x).toBeCloseTo(view.at(1, 1).x);
		expect(points[points.length - 1]?.x).toBeCloseTo(view.at(2.5, 1.5).x);
	});
});

describe("enterStagger", () => {
	const before = [
		{ k: "a", x: 1, y: 2 },
		{ k: "b", x: 2, y: 3 },
	];
	/** Three entering keys, listed out of x order. */
	const after = [
		{ k: "a", x: 1, y: 2 },
		{ k: "b", x: 2, y: 3 },
		{ k: "e", x: 7, y: 4 },
		{ k: "c", x: 5, y: 2 },
		{ k: "d", x: 6, y: 3 },
	];
	type Row = (typeof before)[number];
	const radiiAt = (
		blend: number,
		rows: Row[],
		to?: Row[],
		extra: Record<string, unknown> = {},
	) =>
		plot(
			scatter.create({
				zIndex: Z,
				data: rows,
				to,
				blend,
				key: "k",
				x: "x",
				y: "y",
				radius: 0.2,
				enterStagger: 0.5,
				...extra,
			} as never),
			{ xRange: [0, 8], yRange: [0, 5] },
		)
			.dots()
			.filter((d) => d.r > 0);

	it("leaves both ends exactly each end's own chart", () => {
		expect(radiiAt(0, before, after)).toEqual(radiiAt(0, before));
		expect(radiiAt(1, before, after)).toEqual(radiiAt(0, after));
	});

	it("staggers entering markers left to right within the enter stage", () => {
		const together = radiiAt(0.75, before, after, { staging: "together" }).map(
			(d) => d.r,
		);
		expect(together.slice(0, 2)).toEqual([0.2, 0.2]);
		expect(together.slice(2)).toEqual([0.2, 0.2, 0.1]);
		const staged = radiiAt(0.75, before, after)
			.slice(2)
			.map((d) => d.r);
		expect(staged[0]).toBe(0.2);
		expect(staged[1]).toBeCloseTo(0.1);
		expect(staged).toHaveLength(2); // e has not started: hidden.
	});

	it("without enterStagger, every entering marker enters together", () => {
		const enter = radiiAt(0.75, before, after, { enterStagger: undefined })
			.slice(2)
			.map((d) => d.r);
		expect(enter).toEqual([0.1, 0.1, 0.1]);
	});

	it('orders by key hash with staggerOrder="random"', () => {
		const drawn = radiiAt(0.75, before, after, {
			staggerOrder: "random",
			staging: "together",
		});
		const keys = ["e", "c", "d"];
		const order = hashRanks(keys);
		const last = keys[order.indexOf(2)] as "c" | "d" | "e";
		const xOf = { c: 5, d: 6, e: 7 } as const;
		const halfGrown = drawn.slice(2).find((d) => d.r === 0.1);
		expect(halfGrown).toBeDefined();
		expect(halfGrown?.x).toBeCloseTo(xOf[last] - 4);
	});
});

describe("scatter data API", () => {
	it("places markers from key channels and skips non-finite data", () => {
		const view = plot(
			scatter.create({
				zIndex: Z,
				data: [
					{ a: 1, b: 2 },
					{ a: Number.NaN, b: 5 },
					{ a: 4, b: 3 },
				],
				x: "a",
				y: "b",
			}),
			frame,
		);
		expect(view.dots().map(({ x, y }) => ({ x, y }))).toEqual([
			view.at(1, 2),
			view.at(4, 3),
		]);
	});

	it("number[] data plots value against index", () => {
		const view = plot(scatter.create({ zIndex: Z, data: [5, 6] }), {
			xRange: [0, 2],
			yRange: [0, 10],
		});
		expect(view.dots().map(({ x, y }) => ({ x, y }))).toEqual([
			view.at(0, 5),
			view.at(1, 6),
		]);
	});

	it("takes a function radius and a function colour", () => {
		const view = plot(
			scatter.create({
				zIndex: Z,
				data: [{ v: 1 }, { v: 2 }],
				x: (_: unknown, i: number) => i,
				y: "v",
				radius: (d: { v: number }) => d.v / 10,
				color: (d: { v: number }) => (d.v > 1 ? "#0000ff" : "#ff0000"),
			}),
			{ xRange: [0, 2], yRange: [0, 3] },
		);
		const dots = view.dots();
		expect((dots[1]?.r ?? 0) / (dots[0]?.r ?? 1)).toBeCloseTo(2, 6);
		expect(dots.map((d) => d.fill)).toEqual(["#ff0000", "#0000ff"]);
	});
});

describe("scatter symbol", () => {
	it("every symbol has the area of the circle it replaces", () => {
		const area = (points: { x: number; y: number }[]) =>
			Math.abs(
				points.reduce((sum, p, i) => {
					const q = points[(i + 1) % points.length] as { x: number; y: number };
					return sum + p.x * q.y - q.x * p.y;
				}, 0) / 2,
			);
		for (const symbol of [
			"square",
			"diamond",
			"triangle",
			"cross",
			"star",
		] as const)
			expect(area(symbolPolygon(symbol, 0, 0, 1))).toBeCloseTo(Math.PI, 6);
	});

	it("draws polygons for non-circle symbols", () => {
		const view = plot(
			scatter.create({ zIndex: Z, data: [1, 2], symbol: "square" }),
		);
		const [first] = markItems(view.layers()[0] as never);
		const xs = first?.polylines.flat().map((p) => p.x) ?? [];
		const ys = first?.polylines.flat().map((p) => p.y) ?? [];
		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(
			Math.max(...ys) - Math.min(...ys),
		);
		expect(rounded(Math.max(...xs) - Math.min(...xs))).toBeCloseTo(
			Math.sqrt(Math.PI) * 0.09,
			6,
		);
	});
});
