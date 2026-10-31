/**
 * The self-contained KPI and part-to-whole charts: `gauge`, `waffle` and
 * `radialBarChart`. Geometry, reveal (progress 0 / partial / 1, scrubbing
 * back), sweep direction, readouts, legends and tips. Arcs are path batch items,
 * waffle cells are instances, read with `markItems`. Tooltip panels outside
 * a chart are the frame's overlay; the tests read the
 * accessible names and per-item labels instead.
 */

import type { Polyline } from "@sophistry/core/geometry";
import type { TextSpec } from "@sophistry/core/internal";
import { cssColor } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { GAUGE_START_ANGLE } from "../math/gauge";
import { mount } from "../test-harness";
import { type GaugeProps, gauge } from "./gauge";
import { radialBarChart } from "./radial-bar-chart";
import type { Scene } from "./test-helpers";
import { boxOf, items, reach } from "./test-helpers";
import { waffle } from "./waffle";

const RED = cssColor("#ff0000");
const GREEN = cssColor("#00ff00");
const BLUE = cssColor("#0000ff");
const GREY = cssColor("#888888");

/** Every outline filled with `color`: shapes and batched items alike. */
const filledWith = (scene: Scene, color: string): Polyline[][] => [
	...scene
		.shapes()
		.filter((s) => s.style.fill === color)
		.map((s) => s.polylines as Polyline[]),
	...items(scene)
		.filter((s) => s.fill === color)
		.map((s) => s.polylines),
];
/** The text of every text spec drawn at `fontSize`, in paint order. */
const textAt = (scene: Scene, fontSize: number) =>
	scene
		.texts()
		.filter((s) => Math.abs(s.style.fontSize - fontSize) < 1e-9)
		.map((s) => s.text)
		.join("");
const texts = (scene: Scene) => scene.texts().map((s) => s.text);
const get = (node: unknown, key: string) =>
	(node as { get(key: string): unknown }).get(key);

const showGauge = (props: Partial<GaugeProps>) =>
	mount(gauge.create({ value: 72, color: RED, trackColor: GREEN, ...props }));

describe("gauge", () => {
	it("draws a track and a value arc, and writes the readout", () => {
		const scene = showGauge({ unit: "%" });
		expect(filledWith(scene, GREEN)).toHaveLength(1);
		expect(filledWith(scene, RED)).toHaveLength(1);
		expect(textAt(scene, 0.36)).toBe("72%");
		expect(texts(scene)).toEqual(expect.arrayContaining(["0", "100"]));
	});

	it("sweeps clockwise from the start: 50 of 0..100 reaches 12 o'clock", () => {
		const scene = showGauge({ value: 50 });
		const [arc] = filledWith(scene, RED);
		expect(reach(arc ?? [], GAUGE_START_ANGLE)).toBeCloseTo(
			(2 * Math.PI) / 3,
			2,
		);
		const box = boxOf(arc ?? []);
		expect(box.maxY).toBeCloseTo(1, 2);
		expect(box.maxX).toBeLessThan(0.01);
		const [track] = filledWith(scene, GREEN);
		expect(reach(track ?? [], GAUGE_START_ANGLE)).toBeCloseTo(
			(4 * Math.PI) / 3,
			2,
		);
	});

	it("clamps the arc to [min, max] but writes the true value", () => {
		const over = showGauge({ value: 150 });
		const [arc] = filledWith(over, RED);
		const [track] = filledWith(over, GREEN);
		expect(reach(arc ?? [], GAUGE_START_ANGLE)).toBeCloseTo(
			reach(track ?? [], GAUGE_START_ANGLE),
			3,
		);
		expect(textAt(over, 0.36)).toBe("150");
		expect(filledWith(showGauge({ value: -20 }), RED)).toHaveLength(0);
	});

	it("honours min, max and decimalPlaces", () => {
		const scene = showGauge({ value: 3.25, min: 2, max: 4, decimalPlaces: 2 });
		const [arc] = filledWith(scene, RED);
		expect(reach(arc ?? [], GAUGE_START_ANGLE)).toBeCloseTo(
			((4 * Math.PI) / 3) * 0.625,
			2,
		);
		expect(textAt(scene, 0.36)).toBe("3.25");
	});

	it("colours the value arc by the band it falls in, and draws the bands", () => {
		const scene = mount(
			gauge.create({
				value: 72,
				trackColor: GREY,
				bands: [
					{ to: 60, color: GREEN },
					{ to: 85, color: BLUE },
					{ to: 100, color: RED },
				],
			}),
		);
		expect(filledWith(scene, GREEN)).toHaveLength(1);
		expect(filledWith(scene, RED)).toHaveLength(1);
		expect(filledWith(scene, BLUE)).toHaveLength(2);
		const [band] = filledWith(scene, RED);
		expect(reach(band ?? [], GAUGE_START_ANGLE)).toBeCloseTo(
			(4 * Math.PI) / 3,
			2,
		);
	});

	it("draws a needle when asked", () => {
		// Track, value arc, needle line, hub.
		expect(showGauge({ needle: true }).shapes()).toHaveLength(4);
	});

	it("reveals the frame first, then sweeps and counts up in step", () => {
		const node = gauge.create({
			value: 72,
			color: RED,
			trackColor: GREEN,
			unit: "%",
			progress: 0,
		});
		const scene = mount(node);
		const set = (progress: number) => {
			node.set("progress", progress);
			scene.commit();
		};
		expect(scene.shapes()).toHaveLength(0);
		expect(scene.texts()).toHaveLength(0);

		set(0.15);
		expect(filledWith(scene, GREEN)).toHaveLength(1);
		expect(filledWith(scene, RED)).toHaveLength(0);
		expect(textAt(scene, 0.36)).toBe("");
		expect(
			reach(filledWith(scene, GREEN)[0] ?? [], GAUGE_START_ANGLE),
		).toBeCloseTo(((4 * Math.PI) / 3) * 0.5, 2);

		// Halfway through the data phase, eased out: 72 × (1 − 0.5³) = 63.
		set(0.65);
		expect(textAt(scene, 0.36)).toBe("63%");
		const partial = reach(filledWith(scene, RED)[0] ?? [], GAUGE_START_ANGLE);
		expect(partial).toBeCloseTo(((4 * Math.PI) / 3) * 0.72 * 0.875, 2);

		set(1);
		expect(textAt(scene, 0.36)).toBe("72%");
		const percent = () =>
			scene.texts().find((s: TextSpec) => s.text === "%")?.at;
		const settled = percent();

		// Scrubbing back gives the same frame, and the readout keeps its width.
		set(0.65);
		expect(textAt(scene, 0.36)).toBe("63%");
		expect(
			reach(filledWith(scene, RED)[0] ?? [], GAUGE_START_ANGLE),
		).toBeCloseTo(partial, 6);
		set(0.32);
		expect(textAt(scene, 0.36)).toMatch(/^\d%$/);
		expect(percent()).toEqual(settled);
	});

	it("names the value arc with its label and value", () => {
		const node = gauge.create({
			value: 72.4,
			label: "CPU",
			unit: "%",
			tooltip: true,
		});
		const scene = mount(node);
		expect(textAt(scene, 0.36)).toBe("72%");
		const arc = node.children.find(
			(child) => get(child, "label") === "CPU: 72%",
		);
		expect(arc).toBeDefined();
		expect(typeof get(arc, "onEnter")).toBe("function");
	});

	it("shows the value arc's tip on hover", () => {
		const node = gauge.create({
			value: 72.4,
			label: "CPU",
			unit: "%",
			tooltip: true,
		});
		const scene = mount(node);
		expect(texts(scene)).not.toContain("CPU: 72%");
		const arc = node.children.find(
			(child) => get(child, "label") === "CPU: 72%",
		);
		(get(arc, "onEnter") as (event: unknown) => void)({ pointerId: -1 });
		scene.commit();
		expect(texts(scene)).toContain("CPU: 72%");
	});
});

const thirds = [
	{ name: "A", n: 1 },
	{ name: "B", n: 1 },
	{ name: "C", n: 1 },
];

/** One box per cell filled with `color`. */
const cellsOf = (scene: Scene, color: string) =>
	items(scene)
		.filter((s) => s.fill === color)
		.map((s) => boxOf(s.polylines));
const centreOf = (b: {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}) => [
	Math.round(((b.minX + b.maxX) / 2) * 1e6) / 1e6,
	Math.round(((b.minY + b.maxY) / 2) * 1e6) / 1e6,
];

describe("waffle", () => {
	it("colours exactly rows × columns cells by largest remainder", () => {
		const scene = mount(
			waffle.create({
				data: thirds,
				value: "n",
				colors: [RED, GREEN, BLUE],
				track: false,
			}),
		);
		expect(cellsOf(scene, RED)).toHaveLength(34);
		expect(cellsOf(scene, GREEN)).toHaveLength(33);
		expect(cellsOf(scene, BLUE)).toHaveLength(33);
		// One instances node for every cell, not one node per cell.
		expect(scene.marks()).toHaveLength(1);
		expect(scene.shapes()).toHaveLength(0);
	});

	it("fills row by row from the bottom-left", () => {
		const scene = mount(
			waffle.create({
				data: [5, 3],
				rows: 2,
				columns: 4,
				cellSize: 1,
				gap: 0,
				colors: [RED, BLUE],
				track: false,
			}),
		);
		expect(cellsOf(scene, RED).map(centreOf)).toEqual([
			[-1.5, -0.5],
			[-0.5, -0.5],
			[0.5, -0.5],
			[1.5, -0.5],
			[-1.5, 0.5],
		]);
		expect(cellsOf(scene, BLUE).map(centreOf)).toEqual([
			[-0.5, 0.5],
			[0.5, 0.5],
			[1.5, 0.5],
		]);
	});

	it("fits square cells into width × height", () => {
		const scene = mount(
			waffle.create({
				data: [1],
				rows: 2,
				columns: 4,
				width: 8,
				height: 2,
				gap: 0,
				center: { x: 1, y: 1 },
				colors: [RED],
				track: false,
			}),
		);
		const cells = cellsOf(scene, RED);
		expect(cells).toHaveLength(8);
		const first = cells[0] as { minX: number; maxX: number };
		expect(first.maxX - first.minX).toBeCloseTo(1);
		expect(Math.min(...cells.map((b) => b.minX))).toBeCloseTo(-1);
		expect(Math.max(...cells.map((b) => b.maxY))).toBeCloseTo(2);
	});

	it("reveals the grid, then the cells in fill order, and scrubs back", () => {
		const node = waffle.create({
			data: thirds,
			value: "n",
			colors: [RED, GREEN, BLUE],
			trackColor: GREY,
			cellSize: 0.3,
			progress: 0,
		});
		const scene = mount(node);
		const set = (progress: number) => {
			node.set("progress", progress);
			scene.commit();
		};
		expect(scene.marks()).toHaveLength(0);

		set(0.15);
		expect(cellsOf(scene, GREY)).toHaveLength(100);
		expect(cellsOf(scene, RED)).toHaveLength(0);

		const counts = () => [
			cellsOf(scene, RED).length,
			cellsOf(scene, GREEN).length,
			cellsOf(scene, BLUE).length,
		];
		set(0.5);
		const half = counts();
		const shown = (half[0] ?? 0) + (half[1] ?? 0) + (half[2] ?? 0);
		expect(shown).toBeGreaterThan(0);
		expect(shown).toBeLessThan(100);
		expect(half).toEqual([
			Math.min(shown, 34),
			Math.min(Math.max(shown - 34, 0), 33),
			Math.max(shown - 67, 0),
		]);
		// The newest cells are still growing: a smooth fill, not a count.
		const sides = [...cellsOf(scene, RED), ...cellsOf(scene, GREEN)].map(
			(b) => b.maxX - b.minX,
		);
		expect(sides[0]).toBeCloseTo(0.3);
		expect(sides[sides.length - 1]).toBeLessThan(0.3);

		set(0.8);
		const later = counts();
		expect((later[0] ?? 0) + (later[1] ?? 0) + (later[2] ?? 0)).toBeGreaterThan(
			shown,
		);
		set(0.5);
		expect(counts()).toEqual(half);
		set(1);
		expect(counts()).toEqual([34, 33, 33]);
	});

	it("writes a legend whose percentages sum to 100", () => {
		const scene = mount(
			waffle.create({ data: thirds, value: "n", label: "name", legend: true }),
		);
		expect(texts(scene)).toEqual(["A 34%", "B 33%", "C 33%"]);
	});

	it("lays a right-hand legend out beside the grid", () => {
		const scene = mount(
			waffle.create({
				data: thirds,
				value: "n",
				label: "name",
				legend: true,
				legendPosition: "right",
				cellSize: 0.2,
				gap: 0,
			}),
		);
		const legend = scene.texts();
		expect(legend).toHaveLength(3);
		for (const text of legend) expect(text.at.x).toBeGreaterThan(1);
		expect(legend[0]?.at.y).toBeGreaterThan(legend[1]?.at.y ?? 0);
	});

	it("names each cell with label: value (pct)", () => {
		const node = waffle.create({
			data: [
				{ name: "Yes", n: 62 },
				{ name: "No", n: 38 },
			],
			value: "n",
			label: "name",
			cellSize: 1,
			gap: 0,
			tooltip: true,
		});
		mount(node);
		const cells = node.children[1];
		const shared = get(cells, "shared") as {
			itemLabel: (item: number) => string;
		};
		const itemLabel = shared.itemLabel;
		expect(itemLabel(0)).toBe("Yes: 62 (62%)");
		expect(itemLabel(99)).toBe("No: 38 (38%)");
	});

	it("tips the cell under the pointer, flipped inside the view", () => {
		const node = waffle.create({
			data: [
				{ name: "Yes", n: 62 },
				{ name: "No", n: 38 },
			],
			value: "n",
			label: "name",
			cellSize: 1,
			gap: 0,
			tooltip: true,
		});
		const scene = mount(node);
		const shared = get(node.children[1], "shared") as {
			onEnter: (event: unknown) => void;
		};
		// The top-right cell (item 99: column 9, row 9) is centred on (4.5, 4.5).
		shared.onEnter({ pointerId: -1, item: 99 });
		scene.commit();
		const tooltip = scene.texts().find((s) => s.text === "No: 38 (38%)");
		expect(tooltip?.at.x).toBeCloseTo(4.5);
		// Above the cell would leave the view (its top is at 5, the view's at
		// 4.5), so the tip flips below the point it is about, inside the view.
		expect(tooltip?.at.y).toBeLessThan(5);
		expect(tooltip?.at.y).toBeGreaterThan(3.5);
	});

	it("draws only the empty grid when nothing is positive", () => {
		const scene = mount(
			waffle.create({ data: [0, 0], trackColor: GREY, colors: [RED, BLUE] }),
		);
		expect(cellsOf(scene, GREY)).toHaveLength(100);
		expect(cellsOf(scene, RED)).toHaveLength(0);
	});
});

const goals = [
	{ goal: "Move", pct: 100 },
	{ goal: "Stand", pct: 50 },
];

describe("radialBarChart", () => {
	const radial = (progress?: number) =>
		mount(
			radialBarChart.create({
				data: goals,
				value: "pct",
				label: "goal",
				maxValue: 100,
				radius: 2,
				colors: [RED, BLUE],
				trackColor: GREY,
				progress,
			}),
		);

	it("puts the first datum on the outermost ring", () => {
		const scene = radial();
		const outer = boxOf(filledWith(scene, RED)[0] ?? []);
		const inner = boxOf(filledWith(scene, BLUE)[0] ?? []);
		expect(outer.maxY).toBeCloseTo(2, 2);
		expect(inner.maxY).toBeLessThan(outer.maxY);
	});

	it("sweeps clockwise from 12 o'clock, ∝ value over 270°", () => {
		const scene = radial();
		const top = Math.PI / 2;
		expect(reach(filledWith(scene, RED)[0] ?? [], top)).toBeCloseTo(
			(3 * Math.PI) / 2,
			2,
		);
		const half = filledWith(scene, BLUE)[0] ?? [];
		expect(reach(half, top)).toBeCloseTo((3 * Math.PI) / 4, 2);
		expect(boxOf(half).minX).toBeGreaterThan(-1e-6);
		const tracks = filledWith(scene, GREY);
		expect(tracks).toHaveLength(2);
		for (const track of tracks)
			expect(reach(track, top)).toBeCloseTo((3 * Math.PI) / 2, 2);
	});

	it("writes each name at its ring's start, left of 12 o'clock", () => {
		const names = radial().texts();
		expect(names.map((n) => n.text)).toEqual(["Move", "Stand"]);
		for (const name of names) expect(name.at.x).toBeLessThan(0);
		expect(names[0]?.at.y).toBeGreaterThan(names[1]?.at.y ?? 0);
	});

	it("shows the frame first, then staggers outer → inner", () => {
		expect(radial(0).marks()).toHaveLength(0);

		const frame = radial(0.1);
		expect(filledWith(frame, GREY)).toHaveLength(2);
		expect(filledWith(frame, RED)).toHaveLength(0);
		expect(texts(frame)).toEqual(["Move", "Stand"]);

		const node = radialBarChart.create({
			data: [100, 100],
			maxValue: 100,
			colors: [RED, BLUE],
			progress: 0.4,
		});
		const scene = mount(node);
		const top = Math.PI / 2;
		const outer = reach(filledWith(scene, RED)[0] ?? [], top);
		const inner = filledWith(scene, BLUE)[0];
		expect(inner ? reach(inner, top) : 0).toBeLessThan(outer);
		expect(outer).toBeLessThan((3 * Math.PI) / 2);

		node.set("progress", 1);
		scene.commit();
		node.set("progress", 0.4);
		scene.commit();
		expect(reach(filledWith(scene, RED)[0] ?? [], top)).toBeCloseTo(outer, 6);
	});

	it("names each ring with label: value", () => {
		const node = radialBarChart.create({
			data: goals,
			value: "pct",
			label: "goal",
			tooltip: true,
		});
		mount(node);
		const bars = node.children[1];
		const itemLabel = get(bars, "itemLabel") as (item: number) => string;
		expect([itemLabel(0), itemLabel(1)]).toEqual(["Move: 100", "Stand: 50"]);
	});
});

describe("all three under a playing reveal", () => {
	it("mount and animate together without throwing", () => {
		const nodes = [
			gauge.create({
				value: 72,
				center: { x: -4, y: 0 },
				label: "CPU",
				unit: "%",
				needle: true,
				bands: [{ to: 60 }, { to: 85 }, { to: 100 }],
				progress: 0,
				tooltip: true,
			}),
			waffle.create({
				data: thirds,
				value: "n",
				label: "name",
				legend: true,
				progress: 0,
				tooltip: true,
			}),
			radialBarChart.create({
				data: goals,
				value: "pct",
				label: "goal",
				center: { x: 4, y: 0 },
				progress: 0,
				tooltip: true,
			}),
		];
		const scene = mount(...nodes);
		for (const p of [0.1, 0.3, 0.6, 1]) {
			for (const node of nodes)
				(node as unknown as { set(key: string, value: number): void }).set(
					"progress",
					p,
				);
			scene.commit();
		}
		expect(scene.marks().length).toBeGreaterThan(0);
	});
});
