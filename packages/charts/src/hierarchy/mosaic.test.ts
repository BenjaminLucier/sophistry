/**
 * `mosaic` mounted: geometry in scene units,
 * colour by row, labels where they fit, the progress-driven reveal and the
 * tooltips. Segments are rect items of one batched node.
 */

import { describe, expect, it } from "vitest";
import { mount } from "../test-harness.js";
import { mosaic } from "./mosaic.js";
import type { Scene } from "./test-helpers.js";
import {
	boxOfItem,
	items,
	labels,
	mountChart,
	opaque,
	texts,
} from "./test-helpers.js";

type Sale = { region: string; product: string; units: number };

const sales: Sale[] = [
	{ region: "North", product: "Phones", units: 30 },
	{ region: "North", product: "Laptops", units: 10 },
	{ region: "South", product: "Phones", units: 20 },
	{ region: "South", product: "Laptops", units: 40 },
];

const COLORS = ["#ff0000", "#0000ff"];
const common = {
	data: sales,
	x: "region",
	y: "product",
	value: "units",
	colors: COLORS,
	width: 10,
	height: 4,
	padding: 0,
};

const show = (extra: Record<string, unknown> = {}) =>
	mount(mosaic.create({ ...common, ...extra }));
const boxesOf = (scene: Scene) => items(scene).map(boxOfItem);
const heightOf = (b: ReturnType<typeof boxOfItem>) => b.maxY - b.minY;

describe("mosaic", () => {
	it("tiles the box: widths by column total, heights by share in the column", () => {
		const all = boxesOf(show());
		expect(all).toHaveLength(4);
		const [na, nb, sa, sb] = all as [
			(typeof all)[0],
			(typeof all)[0],
			(typeof all)[0],
			(typeof all)[0],
		];
		// North is 40% of the width, South 60%.
		expect(na.minX).toBeCloseTo(-5);
		expect(na.maxX).toBeCloseTo(-1);
		expect(sa.minX).toBeCloseTo(-1);
		expect(sa.maxX).toBeCloseTo(5);
		// Phones (the first row) at the bottom: 75% of North, 1/3 of South.
		expect(na.minY).toBeCloseTo(-2);
		expect(na.maxY).toBeCloseTo(1);
		expect(nb.minY).toBeCloseTo(1);
		expect(nb.maxY).toBeCloseTo(2);
		expect(sa.maxY - sa.minY).toBeCloseTo(4 / 3);
		expect(sb.maxY).toBeCloseTo(2);
	});

	it("honours center, padding and the column / row order", () => {
		const b = boxesOf(
			show({
				center: { x: 1, y: 1 },
				padding: 0.2,
				columns: ["South"],
				rows: ["Laptops"],
			}),
		);
		// South first, Laptops at its bottom.
		expect(b[0]?.minX).toBeCloseTo(-4);
		expect(b[0]?.minY).toBeCloseTo(-1);
		expect((b[1]?.minY as number) - (b[0]?.maxY as number)).toBeCloseTo(0.2);
		// The North column starts one gap after South ends.
		expect((b[2]?.minX as number) - (b[0]?.maxX as number)).toBeCloseTo(0.2);
		expect(b[3]?.maxX).toBeCloseTo(6);
		expect(b[3]?.maxY).toBeCloseTo(3);
	});

	it("colours by row, the same in every column; `color` wins", () => {
		const [red, blue] = COLORS.map(opaque);
		expect(items(show()).map((item) => opaque(item.fill))).toEqual([
			red,
			blue,
			red,
			blue,
		]);
		const custom = show({
			// Returning nothing falls back to the row colour.
			color: (d: Sale) => (d.region === "South" ? "#00ff00" : undefined),
		});
		const green = opaque("#00ff00");
		expect(items(custom).map((item) => opaque(item.fill))).toEqual([
			red,
			blue,
			green,
			green,
		]);
	});

	it("counts data when `value` is omitted, and skips data with no category", () => {
		const rows = [
			{ g: "A", k: "p" },
			{ g: "A", k: "p" },
			{ g: "A", k: "q" },
			{ g: "B", k: "p" },
			{ g: undefined, k: "q" },
		];
		const b = boxesOf(
			mount(
				mosaic.create({
					data: rows,
					x: "g",
					y: "k",
					width: 4,
					height: 3,
					padding: 0,
				}),
			),
		);
		expect(b).toHaveLength(3);
		expect((b[0]?.maxX as number) - (b[0]?.minX as number)).toBeCloseTo(3);
		expect(heightOf(b[0] as (typeof b)[0])).toBeCloseTo(2);
	});

	it("writes column names, shares and segment names where they fit", () => {
		const scene = show({ shares: true });
		expect(texts(scene)).toEqual(
			expect.arrayContaining([
				"North",
				"South",
				"40%",
				"60%",
				"Phones",
				"Laptops",
			]),
		);
		// Column names sit under the mosaic, centred on their column.
		const north = labels(scene).find((t) => t.text === "North");
		expect(north?.at.y).toBeLessThan(-2);
		expect(north?.at.x).toBeCloseTo(-3);
		const share = labels(scene).find((t) => t.text === "40%");
		expect(share?.at.y).toBeLessThan(north?.at.y ?? 0);
		expect(texts(show({ width: 0.4, height: 0.3 }))).toEqual([]);
		expect(texts(show({ labels: false, columnLabels: false }))).toEqual([]);
	});

	it("reveals column names first, then grows columns left to right from the bottom", () => {
		const chart = mosaic.create({ ...common, progress: 0 });
		const scene = mount(chart);
		expect(scene.graph.frame).toEqual([]);
		const at = (progress: number) => {
			chart.set("progress" as never, progress as never);
			scene.commit();
		};
		at(0.1);
		expect(items(scene)).toEqual([]);
		const names = labels(scene).filter((t) =>
			["North", "South"].includes(t.text),
		);
		expect(names).toHaveLength(2);
		for (const n of names) expect(n.style.opacity).toBeCloseTo(0.5);

		// Halfway through the data reveal: North (first) is ahead of South.
		at(0.2 + 0.8 * 0.5);
		const mid = boxesOf(scene);
		const north = mid.filter((b) => b.maxX <= -1 + 1e-9);
		const south = mid.filter((b) => b.minX >= -1 - 1e-9);
		// North finished; South is only starting (its turn begins at 0.5).
		expect(north.map(heightOf)).toEqual([expect.closeTo(3), expect.closeTo(1)]);
		for (const b of south) expect(heightOf(b)).toBeCloseTo(0, 6);

		at(0.2 + 0.8 * 0.75);
		const growing = boxesOf(scene).filter((b) => b.minX >= -1 - 1e-9);
		// South at t = 0.5: a valid stack of value × 0.5, standing on the bottom.
		expect(growing).toHaveLength(2);
		const [sa, sb] = growing as [(typeof growing)[0], (typeof growing)[0]];
		expect(sa.minY).toBeCloseTo(-2);
		expect(sa.maxY - sa.minY).toBeCloseTo((4 / 3) * 0.5);
		expect(sb.minY).toBeCloseTo(sa.maxY);
		expect(sb.maxY).toBeCloseTo(-2 + 2);
		// Widths are final.
		expect(sa.maxX - sa.minX).toBeCloseTo(6);

		// South at t = 0.75: its names are half faded in.
		at(0.9);
		const fading = labels(scene).filter(
			(t) => t.at.x > -1 && (t.text === "Phones" || t.text === "Laptops"),
		);
		expect(fading).toHaveLength(2);
		for (const l of fading) expect(l.style.opacity).toBeCloseTo(0.5);

		at(1);
		expect(boxesOf(scene).map(heightOf)).toEqual([
			expect.closeTo(3),
			expect.closeTo(1),
			expect.closeTo(4 / 3),
			expect.closeTo(8 / 3),
		]);
		// Scrubbing back is the same frame as playing forward.
		at(0.2 + 0.8 * 0.75);
		expect(
			boxesOf(scene)
				.filter((b) => b.minX >= -1 - 1e-9)
				.map(heightOf),
		).toEqual([expect.closeTo(2 / 3), expect.closeTo(4 / 3)]);
	});

	it("names segments with column, row, value and share of the column", () => {
		const t = mountChart(mosaic.create({ ...common, tooltip: true }));
		expect(t.names()).toContain("North · Phones: 30 (75% of North)");
		expect(t.names()).toContain("South · Laptops: 40 (67% of South)");
		const custom = mountChart(
			mosaic.create({
				...common,
				tooltip: (d: Sale, i: number) => `#${i} ${d.product}`,
			}),
		);
		expect(custom.names()).toContain("#3 Laptops");
	});

	it("draws nothing for empty or all-zero data, or when hidden", () => {
		expect(show({ data: [] }).graph.frame).toEqual([]);
		expect(
			show({ data: sales.map((s) => ({ ...s, units: 0 })) }).graph.frame,
		).toEqual([]);
		expect(show({ visible: false }).graph.frame).toEqual([]);
	});

	it("updates in place through progress, width and data", () => {
		const chart = mosaic.create({
			...common,
			shares: true,
			tooltip: true,
			progress: 0,
		});
		const scene = mount(chart);
		for (const p of [0.1, 0.3, 0.6, 1, 1, 0.4, 0, 1]) {
			chart.set("progress" as never, p as never);
			scene.commit();
		}
		chart.set("width" as never, 6 as never);
		scene.commit();
		chart.set(
			"data" as never,
			[...sales, { region: "East", product: "Tablets", units: 25 }] as never,
		);
		scene.commit();
		expect(items(scene)).toHaveLength(5);
		chart.set("data" as never, sales.slice(0, 1) as never);
		chart.set("progress" as never, 0.5 as never);
		scene.commit();
		expect(items(scene).length).toBeLessThanOrEqual(1);
	});
});
