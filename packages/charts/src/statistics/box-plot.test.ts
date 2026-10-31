/**
 * `boxPlot` and `violinPlot` as presets: what they draw, their reveals
 * and their `series`.
 */

import { describe, expect, it, vi } from "vitest";
import { boxplotStats } from "../math/boxplot";
import { mount } from "../test-harness";
import { boxPlot } from "./box-plot";
import type { Mounted } from "./test-picture";
import { bodies, boxOf, itemBox, items, pathItems } from "./test-picture";
import { violinPlot } from "./violin-plot";

const RANGE = ["#111111", "#222222", "#333333"];

/** Items that paint something. */
const drawn = (scene: Mounted) => items(scene).filter((item) => item.alpha > 0);
const dots = (scene: Mounted) =>
	drawn(scene).filter((item) => item.spec.shape.kind === "circle");

describe("boxPlot", () => {
	const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 30];

	it("draws whiskers, box and median per group as one path batch, outliers as one marks node", () => {
		const scene = mount(
			boxPlot.create({
				data: [sample, [2, 3, 4]],
				width: 4,
				height: 4,
				yRange: [0, 32],
				yAxis: false,
			}),
		);
		const paths = pathItems(scene);
		// Per box: whiskers (four strokes), box, median.
		expect(paths).toHaveLength(6);
		expect(paths[0]?.polylines).toHaveLength(4);
		expect(dots(scene)).toHaveLength(1);
		const stats = boxplotStats(sample);
		if (!stats) throw new Error("stats");
		const unit = 4 / 32;
		const box = boxOf(paths[1]?.polylines ?? []);
		expect(box.minY).toBeCloseTo(-2 + stats.q1 * unit);
		expect(box.maxY).toBeCloseTo(-2 + stats.q3 * unit);
		expect(dots(scene)[0]?.center.y).toBeCloseTo(-2 + 30 * unit);
		expect(dots(scene)[0]?.radius).toBeCloseTo(0.06);
		expect(paths[1]?.spec.style.fillOpacity ?? 0.75).toBeCloseTo(0.75);
	});

	it("follows new data and stays the same nodes", () => {
		const plot = boxPlot.create({
			data: [sample],
			width: 4,
			height: 4,
			yRange: [0, 32],
			yAxis: false,
		});
		const scene = mount(plot);
		const before = scene.marks().map((m) => (m as { id?: unknown }).id);
		plot.set("data", [sample.map((v) => v + 1)]);
		scene.commit();
		expect(scene.marks().map((m) => (m as { id?: unknown }).id)).toEqual(
			before,
		);
		const box = boxOf(pathItems(scene)[1]?.polylines ?? []);
		const stats = boxplotStats(sample.map((v) => v + 1));
		expect(box.minY).toBeCloseTo(-2 + (stats?.q1 ?? 0) * (4 / 32));
	});

	it("yAxis: { visible: false } hides the value axis's numbers, as yAxis: false does", () => {
		for (const plot of [boxPlot, violinPlot]) {
			const words = (
				yAxis: false | { visible: false; numberFontSize: number },
			) =>
				mount(
					plot.create({
						data: [
							{ arm: "a", values: sample },
							{ arm: "b", values: [2, 3, 4] },
						],
						values: "values",
						label: "arm",
						width: 4,
						height: 4,
						yRange: [0, 32],
						yAxis,
					} as never),
				)
					.texts()
					.map((t) => t.text);
			expect(words({ visible: false, numberFontSize: 0.3 })).toEqual([
				"a",
				"b",
			]);
			expect(words(false)).toEqual(["a", "b"]);
		}
	});
});

describe("box and violin reveals", () => {
	// The data half of the preset's progress is at 0.25 at 0.625.
	const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 30];

	it("a box opens out of its median before its whiskers reach out", () => {
		const scene = mount(
			boxPlot.create({
				data: [sample],
				width: 4,
				height: 4,
				yRange: [0, 32],
				yAxis: false,
				baseline: false,
				progress: 0.625,
			}),
		);
		// Box and median only: whiskers, caps and the outlier have not begun.
		const visible = drawn(scene);
		expect(visible).toHaveLength(2);
		const [box, median] = visible.map(itemBox) as [
			ReturnType<typeof itemBox>,
			ReturnType<typeof itemBox>,
		];
		const stats = boxplotStats(sample);
		if (!stats) throw new Error("the sample has stats");
		const { q1, q3, median: middle } = stats;
		const unit = 4 / 32; // scene units per data unit
		// Halfway open: each edge half-way from the median to its quartile.
		expect(box.maxY - box.minY).toBeCloseTo(((q3 - q1) * unit) / 2);
		expect(median.minY).toBeCloseTo(-2 + middle * unit);
		expect(box.minY).toBeCloseTo(-2 + ((middle + q1) / 2) * unit);
	});

	it("outliers come last", () => {
		const at = (progress: number) =>
			mount(
				boxPlot.create({
					data: [sample],
					width: 4,
					height: 4,
					yRange: [0, 32],
					yAxis: false,
					baseline: false,
					progress,
				}),
			);
		// Data half at 0.8: whiskers out, outlier not yet. (The four
		// whisker strokes are one item.)
		expect(drawn(at(0.9))).toHaveLength(3);
		expect(dots(at(0.9))).toHaveLength(0);
		expect(drawn(at(1))).toHaveLength(4);
		expect(dots(at(1))).toHaveLength(1);
	});

	it("a violin widens out of its centre line", () => {
		const build = (progress: number) =>
			mount(
				violinPlot.create({
					data: [sample.slice(0, 9)],
					width: 4,
					height: 4,
					yRange: [0, 10],
					yAxis: false,
					median: false,
					progress,
				}),
			);
		const [half] = drawn(build(0.75)).map(itemBox);
		const [full] = drawn(build(1)).map(itemBox);
		if (!half || !full) throw new Error("both draw");
		expect(half.maxX - half.minX).toBeCloseTo((full.maxX - full.minX) / 2);
		expect(half.minY).toBeCloseTo(full.minY);
		expect(half.maxY).toBeCloseTo(full.maxY);
	});

	it("a staggered box plot opens left to right", () => {
		const scene = mount(
			boxPlot.create({
				data: [sample, sample, sample],
				width: 6,
				height: 4,
				yRange: [0, 32],
				yAxis: false,
				stagger: 0.6,
				progress: 0.75,
			}),
		);
		const heights = bodies(scene).map((item) => {
			const box = itemBox(item);
			return box.maxY - box.minY;
		});
		expect(heights.length).toBeGreaterThanOrEqual(2);
		for (let i = 1; i < heights.length; i++)
			expect(heights[i]).toBeLessThanOrEqual((heights[i - 1] as number) + 1e-9);
	});
});

describe("boxPlot series and violinPlot series", () => {
	// Two arms × two sexes, each a small sample.
	const trials = ["control", "treated"].flatMap((arm, a) =>
		["f", "m"].map((sex, b) => ({
			arm,
			sex,
			scores: [1, 2, 3, 4, 5, 6, 7].map((v) => v + 3 * a + b),
		})),
	);
	/** Box or violin bodies in the scale's colours, tall enough to be bodies, left to right. */
	const coloured = (scene: Mounted) =>
		bodies(scene).filter((item) => {
			const box = itemBox(item);
			return RANGE.includes(item.fill) && box.maxY - box.minY > 0.5;
		});
	const centreX = (item: Parameters<typeof itemBox>[0]) => {
		const box = itemBox(item);
		return (box.minX + box.maxX) / 2;
	};
	const widthOf = (item: Parameters<typeof itemBox>[0]) => {
		const box = itemBox(item);
		return box.maxX - box.minX;
	};
	const texts = (scene: Mounted) => scene.texts().map((s) => s.text);

	for (const [name, plot] of [
		["boxPlot", boxPlot],
		["violinPlot", violinPlot],
	] as const) {
		it(`${name}: colours by series through \`colors\`; the axis names each arm once`, () => {
			const scene = mount(
				plot.create({
					data: trials,
					values: "scores",
					label: "arm",
					series: "sex",
					colors: RANGE,
					width: 6,
					height: 4,
				} as never),
			);
			expect(coloured(scene).map((item) => item.fill)).toEqual([
				"#111111",
				"#222222",
				"#111111",
				"#222222",
			]);
			expect(texts(scene).filter((w) => w === "control")).toHaveLength(1);
		});

		// needs frame: legend
		it(`${name}: names the series in a legend`, () => {
			const scene = mount(
				plot.create({
					data: trials,
					values: "scores",
					label: "arm",
					series: "sex",
					colors: RANGE,
					width: 6,
					height: 4,
				} as never),
			);
			expect(texts(scene)).toEqual(expect.arrayContaining(["f", "m"]));
		});

		it(`${name}: with names, a slot's groups stand side by side, half as wide`, () => {
			const dodged = mount(
				plot.create({
					data: trials,
					values: "scores",
					label: "arm",
					series: "sex",
					colors: RANGE,
					legend: false,
					width: 6,
					height: 4,
				} as never),
			);
			const [cf, cm, tf, tm] = coloured(dodged);
			if (!cf || !cm || !tf || !tm) throw new Error("four bodies");
			expect(centreX(cf)).toBeLessThan(centreX(cm));
			expect(centreX(cm)).toBeLessThan(centreX(tf));
			expect(centreX(tf)).toBeLessThan(centreX(tm));
			// The pair is centred on its slot: the arms' centres are 3 apart
			// in a 6-wide plot of two slots.
			expect((centreX(cf) + centreX(cm)) / 2 + 3).toBeCloseTo(
				(centreX(tf) + centreX(tm)) / 2,
			);
			const plain = mount(
				plot.create({
					data: trials.slice(0, 2),
					values: "scores",
					colors: RANGE,
					width: 6,
					height: 4,
				} as never),
			);
			// Undodged, each group has a whole slot (of two, as the pair above).
			const [solo] = bodies(plain).filter((item) => {
				const box = itemBox(item);
				return box.maxY - box.minY > 0.5;
			});
			if (!solo) throw new Error("a body");
			expect(widthOf(cf)).toBeLessThan(widthOf(solo) * 0.5 + 1e-6);
			expect(widthOf(cf)).toBeGreaterThan(widthOf(solo) * 0.4);
		});

		it(`${name}: color overrides the series`, () => {
			const scene = mount(
				plot.create({
					data: trials,
					values: "scores",
					label: "arm",
					series: "sex",
					color: "#abcdef",
					width: 6,
					height: 4,
				} as never),
			);
			expect(texts(scene)).not.toContain("f");
			expect(
				bodies(scene).filter((item) => item.fill === "#abcdef").length,
			).toBeGreaterThanOrEqual(4);
		});

		it(`${name}: without a series, nothing changes`, () => {
			const scene = mount(
				plot.create({
					data: trials,
					values: "scores",
					label: "arm",
					colors: RANGE,
					width: 8,
					height: 4,
				} as never),
			);
			// One slot per datum, names repeated, colours by index.
			expect(texts(scene).filter((w) => w === "control")).toHaveLength(2);
			expect(coloured(scene).map((item) => item.fill)).toEqual([
				"#111111",
				"#222222",
				"#333333",
				"#111111",
			]);
		});
	}

	it("box and violin plots with a series scrub and update without warnings", () => {
		const messages: string[] = [];
		for (const level of ["warn", "error"] as const)
			vi.spyOn(console, level).mockImplementation((...args) => {
				messages.push(`${level}: ${args.map(String).join(" ")}`);
			});
		try {
			const rows = (shift: number) =>
				["a", "b"].flatMap((arm) =>
					["f", "m"].map((sex, k) => ({
						arm,
						sex,
						scores: [1, 2, 3, 5, 8].map((v) => v + k + shift),
					})),
				);
			const common = {
				values: "scores",
				label: "arm",
				series: "sex",
				width: 6,
				height: 4,
				progress: 0,
			};
			const box = boxPlot.create({ ...common, data: rows(0), stagger: 0.4 });
			const violin = violinPlot.create({ ...common, data: rows(0) });
			const scene = mount(box, violin);
			for (const p of [0.2, 0.5, 0.7, 0.9, 1, 0.6, 0, 1]) {
				box.set("progress", p);
				violin.set("progress", p);
				scene.commit();
			}
			for (const k of [1, 2, 3]) {
				box.set("data", rows(k));
				violin.set("data", rows(k));
				scene.commit();
			}
			expect(messages).toEqual([]);
			expect(bodies(scene).length).toBe(8);
		} finally {
			vi.restoreAllMocks();
		}
	});
});
