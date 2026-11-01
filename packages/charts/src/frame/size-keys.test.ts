/**
 * The chart's size keys:
 * `chart` draws one for a layer that sizes by value (`scatter`'s `size`),
 * hollow reference circles through the layer's own √ scale. Where it goes
 * (with the legend, right or top, with room made under `autosize`), how it
 * reveals (the legend phase), its options, a keyed transition (each end's
 * own scale: exact at both ends, a scrub without re-measuring), the one
 * size scale a chart shares across its sized layers, and one key per scale.
 *
 * The key's circles are real guide nodes (`shapes()`, hollow and closed);
 * the markers are the scatter's batched items (`markItems`). The scrub tests use a
 * spy on the frame's measurement of the keys (`measureSizeKeyExtents`) and
 * identity checks on what the frame derives from the reports
 * (`frame.sizeDomain`).
 */

import type { SceneNode } from "@sophistry/core";
import type { ShapeSpec } from "@sophistry/core/internal";
import { describe, expect, it, vi } from "vitest";
import { chart, chartHandle } from "../chart.js";
import * as sizeLegendModule from "../guides/size-legend.js";
import { bubbleLegendValues, bubbleRadiusScale } from "../math/bubble.js";
import { scatter } from "../points/scatter.js";
import { markItems, mount, probe } from "../test-harness.js";
import type { ChartProps } from "./types.js";

vi.mock("../guides/size-legend.js", async (original) => {
	const actual = await original<typeof import("../guides/size-legend.js")>();
	return {
		...actual,
		measureSizeKeyExtents: vi.fn(actual.measureSizeKeyExtents),
	};
});

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;
const Z = 7;
/** A chart height with room for two stacked keys in one column (the default 4 has not). */
const TALL = 8;

type Scene = ReturnType<typeof mount>;
const circle = (spec: ShapeSpec) => {
	const points = spec.polylines.flat();
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	return {
		x: rounded((minX + maxX) / 2),
		y: rounded((Math.min(...ys) + Math.max(...ys)) / 2),
		r: rounded((maxX - minX) / 2),
		opacity: spec.style.opacity,
	};
};
/** The key's reference circles: hollow, closed guide shapes (the markers are batched). */
const keyCircles = (scene: Scene) =>
	scene
		.shapes()
		.filter(
			(s) =>
				s.closed &&
				s.style.fill === "none" &&
				s.style.stroke !== null &&
				s.polylines.length > 0,
		)
		.map(circle);
/** The batched markers at paint order `z`, as rounded centre and radius, in x order. */
const markersAt = (scene: Scene, z = Z) =>
	scene
		.marks()
		.filter((spec) => spec.zIndex === z)
		.flatMap((spec) =>
			markItems(spec)
				.filter((item) => item.alpha > 0 && item.radius > 0)
				.map((item) => ({
					x: rounded(item.center.x),
					y: rounded(item.center.y),
					r: rounded(item.radius),
				})),
		)
		.sort((p, q) => p.x - q.x);
const radiiAt = (scene: Scene, z: number) =>
	markersAt(scene, z).map((c) => c.r);
const labels = (scene: Scene) =>
	scene
		.texts()
		.map((s) => ({ text: s.text, x: rounded(s.at.x), y: rounded(s.at.y) }));
const textsOf = (scene: Scene) => labels(scene).map((l) => l.text);

const cities = [
	{ name: "a", x: 1, y: 1, pop: 1, region: "n" },
	{ name: "b", x: 2, y: 2, pop: 4, region: "s" },
	{ name: "c", x: 3, y: 3, pop: 16, region: "n" },
];
const later = [
	{ name: "a", x: 1, y: 1, pop: 4, region: "n" },
	{ name: "b", x: 2, y: 2, pop: 4, region: "s" },
	{ name: "d", x: 4, y: 4, pop: 1, region: "s" },
];
type City = (typeof cities)[number];

/** A chart over `layers`; `view()` mounts it and reads its plotting area. */
const chartOf = (layers: SceneNode[], extra: Partial<ChartProps> = {}) =>
	chart.create({
		width: 8,
		height: 4,
		xRange: [0, 5],
		yRange: [0, 5],
		...extra,
		children: layers,
	});
const view = (layers: SceneNode[], extra: Partial<ChartProps> = {}) => {
	const node = chartOf(layers, extra);
	const scene = mount(node);
	const area = chartHandle(node)?.coords.area();
	return { node, scene, area };
};
const bubbles = (extra: Record<string, unknown> = {}) =>
	scatter.create({
		zIndex: Z,
		data: cities,
		x: "x",
		y: "y",
		size: "pop",
		...extra,
	});

describe("chart size key", () => {
	it("draws a circle per round value through the layer's own scale", () => {
		const { scene } = view([bubbles()]);
		const key = keyCircles(scene);
		const radii = bubbleRadiusScale([5, 10, 15], {
			minRadius: 0,
			maxRadius: 0.35,
			maxValue: 16,
		}).map(rounded);
		expect(key.map((c) => c.r)).toEqual(radii);
		expect(textsOf(scene)).toEqual(
			expect.arrayContaining(["pop", "5", "10", "15"]),
		);
		// One centre line, smallest on top.
		expect(new Set(key.map((c) => c.x)).size).toBe(1);
		expect(key[0]?.y).toBeGreaterThan(key[2]?.y as number);
		// A marker as big as a reference circle stands for that value.
		const big = view([bubbles()], { sizeLegend: { values: [16] } }).scene;
		expect(keyCircles(big).map((c) => c.r)).toEqual([markersAt(big)[2]?.r]);
	});

	it("sits right of the plot, with room made for it under autosize", () => {
		const without = view([bubbles()], { sizeLegend: false }).area;
		const { scene, area } = view([bubbles()]);
		if (!without || !area) throw new Error("no chart");
		expect(area.maxX - area.minX).toBeLessThan(without.maxX - without.minX);
		const key = keyCircles(scene);
		for (const c of key) expect(c.x - c.r).toBeGreaterThan(area.maxX);
		// Plot and key together span the chart's 8 units.
		expect(Math.max(...key.map((c) => c.x + c.r))).toBeLessThanOrEqual(
			4 + 1e-9,
		);
	});

	it('goes above the plot with legend="top", under the colour legend', () => {
		const { scene, area } = view([bubbles({ series: "region" })], {
			legend: "top",
		});
		if (!area) throw new Error("no chart");
		const key = keyCircles(scene);
		expect(key.length).toBe(3);
		for (const c of key) expect(c.y - c.r).toBeGreaterThan(area.maxY);
		// Side by side, in a row.
		expect(new Set(key.map((c) => c.y)).size).toBe(1);
		const names = labels(scene).filter((l) => l.text === "n" || l.text === "s");
		expect(names.length).toBe(2);
		for (const name of names)
			expect(name.y).toBeGreaterThan(Math.max(...key.map((c) => c.y + c.r)));
	});

	it("stacks under the colour legend on the right", () => {
		const { scene } = view([bubbles({ series: "region" })]);
		const key = keyCircles(scene);
		const names = labels(scene).filter((l) => l.text === "n" || l.text === "s");
		expect(names.length).toBe(2);
		const top = Math.max(...key.map((c) => c.y + c.r));
		for (const name of names) expect(name.y).toBeGreaterThan(top);
	});

	it("moves beside the legend when stacking would reach the x title's corner", () => {
		const regions = ["n", "s", "e", "w", "x", "y"];
		const many = regions.map((region, i) => ({
			name: region,
			x: i % 5,
			y: 1 + (i % 4),
			pop: 4 * (i + 1),
			region,
		}));
		const placed = (height: number) => {
			const { scene } = view(
				[
					scatter.create({
						zIndex: Z,
						data: many,
						x: "x",
						y: "y",
						size: "pop",
						series: "region",
					}),
				],
				{ height, xLabel: "income" },
			);
			const key = keyCircles(scene);
			const names = labels(scene).filter((l) => regions.includes(l.text));
			return {
				keyLeft: Math.min(...key.map((c) => c.x - c.r)),
				keyTop: Math.max(...key.map((c) => c.y + c.r)),
				namesRight: Math.max(...names.map((l) => l.x)),
				namesBottom: Math.min(...names.map((l) => l.y)),
			};
		};
		// Tall: stacked, the key under the names.
		const tall = placed(8);
		expect(tall.keyTop).toBeLessThan(tall.namesBottom);
		// Short: side by side, the key right of the names and level with them.
		const short = placed(3.5);
		expect(short.keyLeft).toBeGreaterThan(short.namesRight);
		expect(short.keyTop).toBeGreaterThan(short.namesBottom);
	});

	it("is opt-out, and only drawn for a sized layer", () => {
		const plain = view([
			scatter.create({ zIndex: Z, data: cities, x: "x", y: "y" }),
		]).scene;
		expect(keyCircles(plain)).toEqual([]);
		for (const extra of [{ sizeLegend: false }, { legend: false }] as const) {
			expect(keyCircles(view([bubbles()], extra).scene)).toEqual([]);
		}
	});

	it("takes a title, values and a format", () => {
		const { scene } = view([bubbles()], {
			sizeLegend: {
				title: "People",
				values: [2, 8],
				format: (v: number) => `${v}k`,
			},
		});
		expect(textsOf(scene)).toEqual(
			expect.arrayContaining(["People", "2k", "8k"]),
		);
		expect(textsOf(scene)).not.toContain("pop");
		expect(keyCircles(scene)).toHaveLength(2);
		const untitled = view([bubbles()], { sizeLegend: { title: "" } }).scene;
		expect(textsOf(untitled)).not.toContain("pop");
	});

	it("reveals with the legend, after the data", () => {
		const at = (progress: number) =>
			keyCircles(view([bubbles()], { progress }).scene);
		expect(at(0.85)).toEqual([]);
		const partway = at(0.95);
		expect(partway.length).toBeGreaterThan(0);
		expect(partway[0]?.opacity).toBeLessThan(1);
		for (const c of at(1)) expect(c.opacity).toBe(1);
	});
});

describe("size key across a keyed transition", () => {
	const keyed = (blend: number, data: City[], to?: City[]) => [
		scatter.create({
			zIndex: Z,
			data,
			to,
			blend,
			key: "name",
			x: "x",
			y: "y",
			size: "pop",
		}),
	];
	const snapshot = (layers: SceneNode[], extra: Partial<ChartProps> = {}) => {
		const { scene, area } = view(layers, extra);
		return {
			key: keyCircles(scene),
			labels: labels(scene),
			markers: markersAt(scene),
			area,
		};
	};

	it("is exactly each end's own key (and chart) at blend 0 and 1", () => {
		expect(snapshot(keyed(0, cities, later))).toEqual(
			snapshot(keyed(0, cities)),
		);
		expect(snapshot(keyed(1, cities, later))).toEqual(
			snapshot(keyed(0, later)),
		);
	});

	it("fades the start's values out on the exit, the end's in on the enter", () => {
		// cities: max 16 (5, 10, 15); later: max 4 (2, 4); no value shared.
		// c exits and d enters: the stages are thirds.
		const radii = (list: { r: number }[]) => list.map((c) => c.r);
		const start = keyCircles(view(keyed(0, cities)).scene);
		const end = keyCircles(view(keyed(0, later)).scene);
		const exiting = keyCircles(view(keyed(1 / 6, cities, later)).scene);
		expect(radii(exiting)).toEqual(radii(start));
		for (const c of exiting) {
			expect(c.opacity).toBeGreaterThan(0);
			expect(c.opacity).toBeLessThan(1);
		}
		// Through the update both lists are out of sight; then the end's fade in.
		expect(keyCircles(view(keyed(0.5, cities, later)).scene)).toEqual([]);
		const entering = keyCircles(view(keyed(5 / 6, cities, later)).scene);
		expect(radii(entering)).toEqual(radii(end));
		for (const c of entering) expect(c.opacity).toBeLessThan(1);
		const pinned = (blend: number) => [
			scatter.create({
				zIndex: Z,
				data: cities,
				to: later,
				blend,
				key: "name",
				x: "x",
				y: "y",
				size: "pop",
				sizeMaxValue: 16,
			}),
		];
		// Pinned, one scale: the key never moves.
		const a = snapshot(pinned(0));
		const b = snapshot(pinned(0.5));
		expect(b.key).toEqual(a.key);
		expect(b.area).toEqual(a.area);
	});

	it("blends a value both ends show toward the far scale", () => {
		const r = (blend: number) =>
			keyCircles(
				view(
					[
						scatter.create({
							zIndex: Z,
							data: cities,
							to: later,
							blend,
							key: "name",
							x: "x",
							y: "y",
							size: "pop",
							staging: "together",
						}),
					],
					{ sizeLegend: { values: [4] } },
				).scene,
			)[0]?.r ?? Number.NaN;
		// 4 of 16 is half the largest radius; 4 of 4 the whole of it.
		expect(r(0)).toBeCloseTo(0.175);
		expect(r(1)).toBeCloseTo(0.35);
		expect(r(0.5)).toBeCloseTo((0.175 + 0.35) / 2);
	});

	it("scrubs without re-measuring the key", () => {
		const keyedLayer = scatter.create({
			data: cities,
			to: later,
			blend: 0,
			key: "name",
			x: "x",
			y: "y",
			size: "pop",
			series: "region",
		});
		const revealed = chartOf(
			[scatter.create({ data: cities, x: "x", y: "y", size: "pop" })],
			{ progress: 0, legend: "top" },
		);
		const scene = mount(chartOf([keyedLayer]), revealed);
		const measure = vi.mocked(sizeLegendModule.measureSizeKeyExtents);
		expect(measure).toHaveBeenCalled();
		measure.mockClear();
		const seen: number[][] = [];
		for (const t of [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.65, 0, 1]) {
			keyedLayer.set("blend", t);
			revealed.set("progress", t);
			scene.commit();
			seen.push(keyCircles(scene).map((c) => c.opacity));
		}
		// The key's scales, values and layouts are measured once per
		// transition (and once per chart under a reveal): a scrub only
		// places and fades them.
		expect(measure).not.toHaveBeenCalled();
		expect(new Set(seen.map(String)).size).toBeGreaterThan(1);
	});
});

describe("one size scale per chart", () => {
	// Two sized layers: cities (max 16) and towns (max 64).
	const towns = [
		{ name: "t", x: 2, y: 4, pop: 64 },
		{ name: "u", x: 4, y: 1, pop: 9 },
	];
	type Town = (typeof towns)[number];
	const TOWNS = Z + 1;
	const both = (
		extra: Partial<ChartProps> = {},
		own: Record<string, unknown> = {},
		other: Record<string, unknown> = {},
	) =>
		view(
			[
				scatter.create({
					zIndex: Z,
					data: cities,
					x: "x",
					y: "y",
					size: "pop",
					...own,
				}),
				scatter.create({
					zIndex: TOWNS,
					data: towns,
					x: "x",
					y: "y",
					size: "pop",
					...other,
				}),
			],
			extra,
		).scene;
	const scaled = (values: number[], maxValue: number) =>
		bubbleRadiusScale(values, { maxRadius: 0.35, maxValue }).map(rounded);

	it("scales every sized layer to the greatest value any of them has, and keys that scale", () => {
		const scene = both();
		expect(radiiAt(scene, Z)).toEqual(scaled([1, 4, 16], 64));
		expect(radiiAt(scene, TOWNS)).toEqual(scaled([64, 9], 64));
		// The key reads for both layers: the shared maximum's round values.
		const values = bubbleLegendValues(64);
		expect(keyCircles(scene).map((c) => c.r)).toEqual(scaled(values, 64));
		expect(textsOf(scene)).toEqual(expect.arrayContaining(values.map(String)));
		// One layer alone is scaled to its own data, as it always was.
		const alone = view([bubbles()]).scene;
		expect(markersAt(alone).map((m) => m.r)).toEqual(scaled([1, 4, 16], 16));
	});

	it('opts out with scales={ size: "independent" }, and a pinned layer keeps its own scale', () => {
		// Tall enough for the two keys to stack in one column.
		const own = both({ scales: { size: "independent" }, height: TALL });
		expect(radiiAt(own, Z)).toEqual(scaled([1, 4, 16], 16));
		expect(radiiAt(own, TOWNS)).toEqual(scaled([64, 9], 64));
		// Each layer draws on its own scale, so each gets its own key,
		// top-down in layer order.
		const ownKeys = keyCircles(own).sort((p, q) => q.y - p.y);
		expect(ownKeys.map((c) => c.r)).toEqual([
			...scaled(bubbleLegendValues(16), 16),
			...scaled(bubbleLegendValues(64), 64),
		]);
		// A pin wins for its layer; its value joins the shared maximum.
		const pinned = both({}, { sizeMaxValue: 100 });
		expect(radiiAt(pinned, Z)).toEqual(scaled([1, 4, 16], 100));
		expect(radiiAt(pinned, TOWNS)).toEqual(scaled([64, 9], 100));
		const small = both({}, {}, { sizeMaxValue: 20 });
		expect(radiiAt(small, TOWNS)).toEqual(scaled([64, 9], 20));
		expect(radiiAt(small, Z)).toEqual(scaled([1, 4, 16], 20));
	});

	it("through a keyed transition: each end is that end's plain chart, key included", () => {
		// u grows from 9 to 36 on the one shared scale (64 at both ends).
		const grown = towns.map((d) => ({ ...d, pop: d.name === "u" ? 36 : 64 }));
		const keyed = (blend: number, a: Town[], b?: Town[]) => [
			scatter.create({
				zIndex: Z,
				data: cities,
				to: b ? later : undefined,
				blend,
				key: "name",
				x: "x",
				y: "y",
				size: "pop",
			}),
			scatter.create({
				zIndex: TOWNS,
				data: a,
				to: b,
				blend,
				key: "name",
				x: "x",
				y: "y",
				size: "pop",
			}),
		];
		const plainEnd = () => [
			scatter.create({
				zIndex: Z,
				data: later,
				key: "name",
				x: "x",
				y: "y",
				size: "pop",
			}),
			scatter.create({
				zIndex: TOWNS,
				data: grown,
				key: "name",
				x: "x",
				y: "y",
				size: "pop",
			}),
		];
		const snap = (layers: SceneNode[]) => {
			const { scene, area } = view(layers);
			return {
				key: keyCircles(scene),
				labels: labels(scene),
				cities: radiiAt(scene, Z),
				towns: radiiAt(scene, TOWNS),
				area,
			};
		};
		expect(snap(keyed(0, towns, grown))).toEqual(snap(keyed(0, towns)));
		expect(snap(keyed(1, towns, grown))).toEqual(snap(plainEnd()));
		// Mid-way (half the update: c exits and d enters, so thirds), each
		// town's radius is halfway between its two ends' on the shared scale.
		const mid = snap(keyed(0.5, towns, grown));
		const [r9, r36] = scaled([9, 36], 64) as [number, number];
		expect(mid.towns).toEqual([0.35, rounded((r9 + r36) / 2)]);
	});

	it("an end with nothing to size has no key there: it fades out with its title, and its room goes", () => {
		const none = cities.map((d) => ({ ...d, pop: 0 }));
		const keyed = (blend: number, to?: City[]) => [
			scatter.create({
				zIndex: Z,
				data: cities,
				to,
				blend,
				key: "name",
				x: "x",
				y: "y",
				size: "pop",
			}),
		];
		const snap = (layers: SceneNode[], extra: Partial<ChartProps> = {}) => {
			const { scene, area } = view(layers, extra);
			return { key: keyCircles(scene), labels: labels(scene), area };
		};
		const fit = { autosize: "fit" } as const;
		const plainNone = snap([
			scatter.create({
				zIndex: Z,
				data: none,
				key: "name",
				x: "x",
				y: "y",
				size: "pop",
			}),
		]);
		expect(plainNone.key).toEqual([]);
		expect(snap(keyed(1, none), fit)).toEqual(plainNone);
		expect(snap(keyed(0, none), fit)).toEqual(snap(keyed(0), fit));
		const mid = snap(keyed(0.5, none), fit);
		expect(mid.key.length).toBeGreaterThan(0);
		for (const c of mid.key) expect(c.opacity).toBeLessThan(1);
		// The plot widens as the key's room goes.
		const start = snap(keyed(0), fit).area?.maxX as number;
		expect(mid.area?.maxX).toBeGreaterThan(start);
		expect(mid.area?.maxX).toBeLessThan(plainNone.area?.maxX as number);
	});

	it("scrubs two sized layers' transition without re-reading the shared scale", () => {
		const grown = towns.map((d) => ({ ...d, pop: d.pop * 2 }));
		const layers = [
			scatter.create({
				data: cities,
				to: later,
				blend: 0,
				key: "name",
				x: "x",
				y: "y",
				size: "pop",
			}),
			scatter.create({
				data: towns,
				to: grown,
				blend: 0,
				key: "name",
				x: "x",
				y: "y",
				size: "pop",
			}),
		];
		const { node: watcher, seen } = probe();
		const scene = mount(chartOf([...layers, watcher]));
		const domain = seen.frame?.sizeDomain;
		expect(domain).toEqual({ from: 64, to: 128 });
		const measure = vi.mocked(sizeLegendModule.measureSizeKeyExtents);
		measure.mockClear();
		for (const t of [0.1, 0.3, 0.5, 0.7, 0.9, 1, 0.4, 0, 1]) {
			for (const layer of layers) layer.set("blend", t);
			scene.commit();
			// The shared scale is the reports' (both ends'), not the blend's.
			expect(seen.frame?.sizeDomain).toBe(domain);
		}
		expect(measure).not.toHaveBeenCalled();
	});
});

/*
 * Layers drawing different radii (`sizeRange`) on the one shared maximum: one
 * key per distinct scale, stacked top-down in layer order, each titled by
 * its own layer's `size` channel and drawn through its own radii.
 */
describe("a size key per scale", () => {
	const homes = [
		{ name: "h", x: 2, y: 4, people: 64 },
		{ name: "k", x: 4, y: 1, people: 9 },
	];
	type Home = (typeof homes)[number];
	const HOMES = Z + 1;
	const WIDE: [number, number] = [0, 0.6];
	const twoLayers = (
		ends: { data?: Home[]; to?: Home[]; blend?: number } = {},
	) => [
		scatter.create({
			zIndex: Z,
			data: cities,
			to: ends.to ? cities : undefined,
			blend: ends.blend,
			key: "name",
			x: "x",
			y: "y",
			size: "pop",
		}),
		scatter.create({
			zIndex: HOMES,
			data: ends.data ?? homes,
			to: ends.to,
			blend: ends.blend,
			key: "name",
			x: "x",
			y: "y",
			size: "people",
			sizeRange: WIDE,
		}),
	];
	const two = (extra: Partial<ChartProps> = {}) => view(twoLayers(), extra);
	const values = bubbleLegendValues(64);
	const radii = (range: [number, number]) =>
		bubbleRadiusScale(values, {
			minRadius: range[0],
			maxRadius: range[1],
			maxValue: 64,
		}).map(rounded);
	/** The keys' circles, top-down, and each title's height. */
	const keys = (scene: Scene) => ({
		circles: keyCircles(scene).sort((p, q) => q.y - p.y),
		titles: labels(scene).filter(
			(l) => l.text === "pop" || l.text === "people",
		),
	});
	/** One end of a stack whose first key's layer arrives: `data` → `to` for the first layer. */
	const arriving = (blend: number, data: City[], to?: City[]) => [
		scatter.create({
			zIndex: Z,
			data,
			to,
			blend,
			key: "name",
			x: "x",
			y: "y",
			size: "pop",
		}),
		scatter.create({
			zIndex: HOMES,
			data: homes,
			to: to ? homes : undefined,
			blend,
			key: "name",
			x: "x",
			y: "y",
			size: "people",
			sizeRange: WIDE,
		}),
	];
	const snap = (layers: SceneNode[], extra: Partial<ChartProps>) => {
		const { scene, area } = view(layers, extra);
		return { ...keys(scene), labels: labels(scene), area };
	};

	it("draws one key per sizeRange, each through its own radii and titled by its channel", () => {
		const { scene, area } = two({ height: TALL });
		const { circles, titles } = keys(scene);
		expect(circles.map((c) => c.r)).toEqual([
			...radii([0, 0.35]),
			...radii(WIDE),
		]);
		// The second key under the first, both right of the plot, in its room.
		expect(titles.map((t) => t.text)).toEqual(["pop", "people"]);
		const [pop, people] = titles as [
			(typeof titles)[number],
			(typeof titles)[number],
		];
		const first = circles.slice(0, values.length);
		const second = circles.slice(values.length);
		expect(people.y).toBeLessThan(Math.min(...first.map((c) => c.y - c.r)));
		expect(Math.max(...second.map((c) => c.y + c.r))).toBeLessThan(people.y);
		expect(pop.y).toBeGreaterThan(people.y);
		if (!area) throw new Error("no chart");
		for (const c of circles) expect(c.x - c.r).toBeGreaterThan(area.maxX);
		expect(Math.max(...circles.map((c) => c.x + c.r))).toBeLessThanOrEqual(
			4 + 1e-9,
		);
		// The wider key widens the room the keys take.
		const lone = view(
			[
				scatter.create({
					zIndex: Z,
					data: cities,
					x: "x",
					y: "y",
					size: "pop",
				}),
			],
			{ height: TALL },
		).area;
		expect(area.maxX).toBeLessThan(lone?.maxX as number);
		// Same radii, one key: the shared scale's.
		const same = view([
			scatter.create({ zIndex: Z, data: cities, x: "x", y: "y", size: "pop" }),
			scatter.create({
				zIndex: HOMES,
				data: homes,
				x: "x",
				y: "y",
				size: "people",
			}),
		]).scene;
		expect(keyCircles(same)).toHaveLength(values.length);
	});

	it('stacks the keys\' rows above the plot with legend="top", and titles only the first with a given title', () => {
		const { scene, area } = two({
			legend: "top",
			sizeLegend: { title: "Size" },
		});
		if (!area) throw new Error("no chart");
		const { circles } = keys(scene);
		expect(circles).toHaveLength(2 * values.length);
		for (const c of circles) expect(c.y - c.r).toBeGreaterThan(area.maxY);
		// Each key one row; the second row under the first.
		const rows = [...new Set(circles.map((c) => c.y))];
		expect(rows).toHaveLength(2);
		expect(textsOf(scene)).toEqual(expect.arrayContaining(["Size", "people"]));
		expect(textsOf(scene)).not.toContain("pop");
	});

	it("reveals both keys in the legend phase", () => {
		const at = (progress: number) => keyCircles(two({ progress }).scene);
		expect(at(0.85)).toEqual([]);
		expect(at(0.95).length).toBeGreaterThan(values.length);
		const whole = at(1);
		expect(whole).toHaveLength(2 * values.length);
		for (const c of whole) expect(c.opacity).toBe(1);
	});

	it("a key that one end lacks: each end is its plain chart, and the stack moves continuously", () => {
		// The first key's layer arrives, so the second key slides down to
		// make room for it while the first fades in above.
		const extra = { autosize: "fit", height: TALL } as const;
		const keyed = (blend: number) => snap(arriving(blend, [], cities), extra);
		const start = snap(arriving(0, []), extra);
		const end = snap(arriving(0, cities), extra);
		expect(keyed(0)).toEqual(start);
		expect(keyed(1)).toEqual(end);
		const peopleAt = (s: typeof start) =>
			s.titles.find((t) => t.text === "people")?.y as number;
		const whole = peopleAt(start) - peopleAt(end);
		expect(whole).toBeGreaterThan(0.5);
		// The update stage runs from 0 to 2/3 (no exits, then the enters);
		// either side of its midpoint the second key barely moves, and it is
		// between its two places.
		const a = keyed(0.33);
		const b = keyed(0.34);
		expect(Math.abs(peopleAt(b) - peopleAt(a))).toBeLessThan(whole / 20);
		expect(peopleAt(a)).toBeLessThan(peopleAt(start));
		expect(peopleAt(a)).toBeGreaterThan(peopleAt(end));
		// Its circles keep their size, and the arriving key is fading in.
		expect(a.circles.filter((c) => c.opacity === 1).map((c) => c.r)).toEqual(
			radii(WIDE),
		);
	});

	describe("a stack taller than the plot", () => {
		/** The keys' circles and titles, split into the stack's columns by the second title's x. */
		const columns = (scene: Scene) => {
			const { circles, titles } = keys(scene);
			const pop = titles.find((t) => t.text === "pop");
			const people = titles.find((t) => t.text === "people");
			if (!pop || !people) throw new Error("no titles");
			const left = circles.filter((c) => c.x < people.x);
			const right = circles.filter((c) => c.x >= people.x);
			return { circles, pop, people, left, right };
		};

		it("flows the second key into a column beside the first, within the plot's height", () => {
			const { scene, area } = two();
			if (!area) throw new Error("no chart");
			const { circles, pop, people, left, right } = columns(scene);
			// Each key its own column, both from the top, each through its own radii.
			expect(left.map((c) => c.r)).toEqual(radii([0, 0.35]));
			expect(right.map((c) => c.r)).toEqual(radii(WIDE));
			expect(people.y).toBe(pop.y);
			expect(Math.min(...right.map((c) => c.x - c.r))).toBeGreaterThan(
				Math.max(...left.map((c) => c.x + c.r)),
			);
			// Inside the plot's height, right of it, inside the footprint.
			for (const c of circles) {
				expect(c.y + c.r).toBeLessThanOrEqual(area.maxY + 1e-9);
				expect(c.y - c.r).toBeGreaterThanOrEqual(area.minY - 1e-9);
				expect(c.x - c.r).toBeGreaterThan(area.maxX);
			}
			expect(Math.max(...circles.map((c) => c.x + c.r))).toBeLessThanOrEqual(
				4 + 1e-9,
			);
			// `autosize` makes room for both columns: the plot is narrower than
			// under the same keys stacked in one column (a taller chart).
			const stacked = two({ height: TALL }).area;
			expect(area.maxX).toBeLessThan((stacked?.maxX as number) - 0.5);
		});

		it('flows under autosize="contain", and beside a colour legend', () => {
			const contained = two({ autosize: "contain" }).scene;
			const { circles, left, right } = columns(contained);
			expect(left.length).toBe(values.length);
			expect(right.length).toBe(values.length);
			for (const c of circles) {
				expect(c.x + c.r).toBeLessThanOrEqual(4 + 1e-9);
				expect(Math.abs(c.y) + c.r).toBeLessThanOrEqual(2 + 1e-9);
			}
			// With a colour legend the size keys stand beside it, still in
			// two columns within the plot's height.
			const { scene: legended, area } = view([
				scatter.create({
					zIndex: Z,
					data: cities,
					x: "x",
					y: "y",
					size: "pop",
					series: "region",
				}),
				scatter.create({
					zIndex: HOMES,
					data: homes,
					x: "x",
					y: "y",
					size: "people",
					sizeRange: WIDE,
				}),
			]);
			if (!area) throw new Error("no chart");
			const own = columns(legended);
			const names = labels(legended).filter(
				(l) => l.text === "n" || l.text === "s",
			);
			expect(names).toHaveLength(2);
			const legendRight = Math.max(...names.map((l) => l.x));
			expect(own.right.length).toBe(values.length);
			for (const c of own.circles) {
				expect(c.x - c.r).toBeGreaterThan(legendRight);
				expect(c.y - c.r).toBeGreaterThanOrEqual(area.minY - 1e-9);
			}
		});

		it("a key that one end lacks: each end is its plain chart, and the other moves to the next column", () => {
			// The first key's layer arrives: alone at the start the second key
			// heads the first column; at the end it is pushed to the second.
			const people = (s: {
				titles: { text: string; x: number; y: number }[];
			}) => {
				const title = s.titles.find((t) => t.text === "people");
				if (!title) throw new Error("no title");
				return title;
			};
			for (const autosize of ["fit", "pad"] as const) {
				const extra = { autosize };
				const keyed = (blend: number) =>
					snap(arriving(blend, [], cities), extra);
				const start = snap(arriving(0, []), extra);
				const end = snap(arriving(0, cities), extra);
				expect(keyed(0)).toEqual(start);
				expect(keyed(1)).toEqual(end);
				expect(people(end).y).toBeCloseTo(people(start).y, 6);
				const a = keyed(0.33);
				const b = keyed(0.34);
				// Its circles keep their size while the arriving key fades in.
				expect(
					a.circles.filter((c) => c.opacity === 1).map((c) => c.r),
				).toEqual(radii(WIDE));
				if (autosize === "fit") {
					// The stack's right edge holds the footprint's, so the second
					// key stays put while the plot gives up a column's room for
					// the first: continuously, with no jump at the update's midpoint.
					expect(people(end).x).toBeCloseTo(people(start).x, 6);
					const room =
						(start.area?.maxX as number) - (end.area?.maxX as number);
					expect(room).toBeGreaterThan(0.5);
					const edge = (s: typeof a) => s.area?.maxX as number;
					expect(Math.abs(edge(b) - edge(a))).toBeLessThan(room / 20);
					expect(edge(a)).toBeLessThan(edge(start));
					expect(edge(a)).toBeGreaterThan(edge(end));
				} else {
					// Without room made, the plot holds still and the second key
					// slides right by a column, with no jump at the midpoint.
					expect(end.area).toEqual(start.area);
					const whole = people(end).x - people(start).x;
					expect(whole).toBeGreaterThan(0.5);
					expect(Math.abs(people(b).x - people(a).x)).toBeLessThan(whole / 20);
					expect(people(a).x).toBeGreaterThan(people(start).x);
					expect(people(a).x).toBeLessThan(people(end).x);
				}
			}
		});
	});

	it("scrubs the stack without re-measuring it", () => {
		const grown = homes.map((d) => ({ ...d, people: d.people * 2 }));
		const layers = [
			scatter.create({
				data: cities,
				to: later,
				blend: 0,
				key: "name",
				x: "x",
				y: "y",
				size: "pop",
			}),
			scatter.create({
				data: homes,
				to: grown,
				blend: 0,
				key: "name",
				x: "x",
				y: "y",
				size: "people",
				sizeRange: WIDE,
			}),
		];
		const { node: watcher, seen } = probe();
		const scene = mount(chartOf([...layers, watcher]));
		const domain = seen.frame?.sizeDomain;
		const measure = vi.mocked(sizeLegendModule.measureSizeKeyExtents);
		expect(measure).toHaveBeenCalled();
		measure.mockClear();
		const frames: string[] = [];
		for (const t of [0.1, 0.3, 0.5, 0.7, 0.9, 1, 0.4, 0, 1]) {
			for (const layer of layers) layer.set("blend", t);
			scene.commit();
			expect(seen.frame?.sizeDomain).toBe(domain);
			frames.push(JSON.stringify(keyCircles(scene)));
		}
		expect(measure).not.toHaveBeenCalled();
		// The keys do follow the transition's stages.
		expect(new Set(frames).size).toBeGreaterThan(1);
	});
});
