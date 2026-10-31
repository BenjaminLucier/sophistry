/**
 * Keyed data transitions (`to` + `blend`) on the marks that draw a
 * statistic rather than a datum: `boxPlot` and `violinPlot` (groups joined
 * by name and series, their statistics blended). Each is a function of one
 * number, so the tests set it and read the scene; the last block scrubs both
 * back and forth.
 */

import type { Range } from "@sophistry/core/geometry";
import { describe, expect, it, vi } from "vitest";
import { boxplotStats } from "../math/boxplot";
import { mount } from "../test-harness";
import { boxPlot } from "./box-plot";
import type { Mounted } from "./test-picture";
import {
	bodies,
	boxOf,
	itemBox,
	items,
	label,
	pathItems,
	picture,
} from "./test-picture";
import { violinPlot } from "./violin-plot";

const opacityOf = (scene: Mounted, text: string) =>
	label(scene, text)?.style.opacity;

describe("keyed transitions on boxPlot and violinPlot", () => {
	const before = [
		{ arm: "a", values: [1, 2, 3, 4, 5, 6, 7, 20] },
		{ arm: "b", values: [3, 4, 4, 5, 6, 6, 7] },
		{ arm: "c", values: [8, 9, 10, 10, 11, 12] },
	];
	const after = [
		{ arm: "b", values: [6, 7, 8, 8, 9, 10, 11] },
		{ arm: "a", values: [2, 3, 4, 5, 6, 7, 8, 1, 24] },
		{ arm: "d", values: [12, 13, 14, 15, 15, 16] },
	];

	for (const [name, plot] of [
		["boxPlot", boxPlot],
		["violinPlot", violinPlot],
	] as const) {
		const build = (
			blend: number | undefined,
			data: typeof before,
			to: typeof before | undefined,
			extra: Record<string, unknown> = {},
		) =>
			mount(
				plot.create({
					data,
					to,
					blend,
					values: "values",
					label: "arm",
					width: 6,
					height: 4,
					...extra,
				} as never),
			);

		it(`${name}: is exactly \`data\` at blend 0, axes included`, () => {
			expect(picture(build(0, before, after))).toEqual(
				picture(build(undefined, before, undefined)),
			);
		});

		// needs frame: layer transition fitting (band axis and value axis move to `to`'s on the update stage)
		it(`${name}: is exactly \`to\` at blend 1, axes included`, () => {
			expect(picture(build(1, before, after))).toEqual(
				picture(build(undefined, after, undefined)),
			);
		});

		it(`${name}: dodged by series, is exactly \`data\` at blend 0`, () => {
			const rows = [
				{ arm: "x", sex: "f", values: [1, 2, 3, 4, 5] },
				{ arm: "x", sex: "m", values: [2, 3, 4, 5, 6] },
				{ arm: "y", sex: "f", values: [4, 5, 6, 7, 8] },
				{ arm: "y", sex: "m", values: [5, 6, 7, 8, 9] },
			];
			const next = [rows[0], rows[2], rows[3]] as typeof rows;
			const extra = { series: "sex", colors: ["#111111", "#222222"] };
			expect(picture(build(0, rows, next, extra))).toEqual(
				picture(build(undefined, rows, undefined, extra)),
			);
		});

		it(`${name}: dodged by series, is exactly \`to\` at blend 1`, () => {
			const rows = [
				{ arm: "x", sex: "f", values: [1, 2, 3, 4, 5] },
				{ arm: "x", sex: "m", values: [2, 3, 4, 5, 6] },
				{ arm: "y", sex: "f", values: [4, 5, 6, 7, 8] },
				{ arm: "y", sex: "m", values: [5, 6, 7, 8, 9] },
			];
			const next = [rows[0], rows[2], rows[3]] as typeof rows;
			const extra = { series: "sex", colors: ["#111111", "#222222"] };
			expect(picture(build(1, rows, next, extra))).toEqual(
				picture(build(undefined, next, undefined, extra)),
			);
		});

		// needs frame: band axis category fades across a keyed transition (frame.join staging)
		it(`${name}: fades a leaving group's name, and a new one's in`, () => {
			// Exit, update (with the axes), enter: a third each.
			const exiting = build(1 / 6, before, after);
			expect(opacityOf(exiting, "c")).toBeCloseTo(0.5);
			expect(opacityOf(exiting, "a")).toBe(1);
			const entering = build(5 / 6, before, after);
			expect(opacityOf(entering, "d")).toBeCloseTo(0.5);
			expect(label(entering, "c")).toBeUndefined();
		});
	}

	/** 4 scene units over [0, 20]: data y to scene y. */
	const sceneY = (value: number) => -2 + (value * 4) / 20;
	const fixed: { yRange: Range; yAxis: boolean } = {
		yRange: [0, 20],
		yAxis: false,
	};

	it("boxPlot: moves the quartiles and median halfway on the update, in data units", () => {
		// Same groups at both ends, values only: the update is the whole blend.
		const moved = before.map((d) => ({
			...d,
			values: d.values.map((v) => v * 1.5),
		}));
		const scene = mount(
			boxPlot.create({
				data: before,
				to: moved,
				blend: 0.5,
				values: "values",
				label: "arm",
				width: 6,
				height: 4,
				...fixed,
				baseline: false,
			}),
		);
		const boxes = bodies(scene).map(itemBox);
		expect(boxes).toHaveLength(3);
		before.forEach((group, i) => {
			const a = boxplotStats(group.values);
			const b = boxplotStats((moved[i] as typeof group).values);
			if (!a || !b) throw new Error("every group has stats");
			expect(boxes[i]?.minY).toBeCloseTo(sceneY((a.q1 + b.q1) / 2));
			expect(boxes[i]?.maxY).toBeCloseTo(sceneY((a.q3 + b.q3) / 2));
		});
		// The outlier (20 → 30) moves with its box, still whole.
		const dots = items(scene).filter(
			(item) => item.spec.shape.kind === "circle",
		);
		const top = Math.max(...dots.map((d) => d.center.y));
		expect(top).toBeCloseTo(sceneY(25));
		expect(dots.every((d) => d.alpha === 1)).toBe(true);
	});

	it("boxPlot: slides a dodged box to its new sub-slot when its neighbour leaves", () => {
		const rows = [
			{ arm: "x", sex: "f", values: [1, 2, 3, 4, 5] },
			{ arm: "x", sex: "m", values: [2, 3, 4, 5, 6] },
		];
		const width = (blend: number) => {
			const scene = mount(
				boxPlot.create({
					data: rows,
					to: [rows[0]],
					blend,
					values: "values",
					label: "arm",
					series: "sex",
					colors: ["#111111", "#222222"],
					width: 6,
					height: 4,
					...fixed,
				}),
			);
			const f = bodies(scene).find((item) => item.fill === "#111111");
			if (!f) throw new Error("the f box draws");
			const box = itemBox(f);
			return box.maxX - box.minX;
		};
		// Exit, then update: f widens from half its slot to all of it.
		const half = width(0);
		const whole = width(1);
		expect(whole).toBeGreaterThan(half * 1.9);
		expect(width(0.75)).toBeCloseTo((half + whole) / 2);
	});

	it("violinPlot: moves the median halfway and keeps a valid, symmetric outline", () => {
		const moved = before.map((d) => ({
			...d,
			values: d.values.map((v) => v + 4),
		}));
		const scene = mount(
			violinPlot.create({
				data: before.slice(1, 2),
				to: moved.slice(1, 2),
				blend: 0.5,
				values: "values",
				label: "arm",
				width: 6,
				height: 4,
				...fixed,
			}),
		);
		const median = (values: number[]) => {
			const sorted = [...values].sort((p, q) => p - q);
			const mid = Math.floor(sorted.length / 2);
			return sorted.length % 2
				? (sorted[mid] as number)
				: ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
		};
		const paths = pathItems(scene);
		const tick = paths.find((item) => item.fill === "none");
		const body = paths.find((item) => item.fill !== "none");
		if (!tick || !body) throw new Error("a body and a tick draw");
		expect(boxOf(tick.polylines).minY).toBeCloseTo(
			sceneY(
				(median((before[1] as { values: number[] }).values) +
					median((moved[1] as { values: number[] }).values)) /
					2,
			),
		);
		const points = body.polylines.flat();
		const box = boxOf(body.polylines);
		const centre = (box.minX + box.maxX) / 2;
		// The ring runs down one side and back up the other: mirrored about its centre.
		const n = points.length;
		for (let i = 0; i < n / 2; i++) {
			const p = points[i] as { x: number; y: number };
			const q = points[n - 1 - i] as { x: number; y: number };
			expect(p.y).toBeCloseTo(q.y);
			expect(p.x - centre).toBeCloseTo(centre - q.x);
			expect(p.x).toBeGreaterThanOrEqual(centre - 1e-9);
		}
	});
});

describe("keyed statistics under animation", () => {
	it("scrubs blends without warnings or errors, statistics read once", () => {
		const messages: string[] = [];
		for (const level of ["warn", "error"] as const)
			vi.spyOn(console, level).mockImplementation((...args) => {
				messages.push(`${level}: ${args.map(String).join(" ")}`);
			});
		try {
			const groups = [
				{ arm: "a", sex: "f", values: [1, 2, 3, 4, 5, 6, 20] },
				{ arm: "a", sex: "m", values: [2, 3, 4, 5, 6] },
				{ arm: "b", sex: "f", values: [4, 5, 6, 7, 8] },
			];
			const groups2 = [
				{ arm: "a", sex: "f", values: [3, 4, 5, 6, 7, -9] },
				{ arm: "b", sex: "f", values: [5, 6, 7, 8, 9, 10] },
				{ arm: "c", sex: "m", values: [7, 8, 9, 10] },
			];
			let reads = 0;
			const values = (d: { values: number[] }) => {
				reads++;
				return d.values;
			};
			const common = {
				data: groups,
				to: groups2,
				blend: 0,
				values,
				label: "arm",
				series: "sex",
				stagger: 0.3,
				width: 6,
				height: 4,
			};
			const box = boxPlot.create(common);
			const violin = violinPlot.create(common);
			const scene = mount(box, violin);
			const first = reads;
			for (const t of [
				0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1, 0.5, 0.15, 0, 1,
			]) {
				box.set("blend", t);
				violin.set("blend", t);
				scene.commit();
			}
			expect(messages).toEqual([]);
			// A blend reads no sample again.
			expect(reads).toBe(first);
		} finally {
			vi.restoreAllMocks();
		}
	});
});

describe("enterStagger on boxPlot", () => {
	const before = [
		{ id: "a", v: 2 },
		{ id: "b", v: 3 },
	];
	const after = [
		...before,
		{ id: "e", v: 4 },
		{ id: "c", v: 2 },
		{ id: "d", v: 3 },
	];
	const samples = (rows: typeof before) =>
		rows.map((row) => ({ ...row, samples: [row.v, row.v + 1, row.v + 2] }));
	const build = (
		blend: number | undefined,
		data: typeof before,
		to: typeof before | undefined,
	) =>
		mount(
			boxPlot.create({
				width: 6,
				height: 3,
				data: samples(data),
				to: to && samples(to),
				blend,
				values: "samples",
				label: "id",
				enterStagger: 0.6,
			}),
		);

	it("blend 0 is exactly `data`'s own chart", () => {
		expect(picture(build(0, before, after))).toEqual(
			picture(build(undefined, before, undefined)),
		);
	});

	// needs frame: layer transition fitting (the band axis gains `to`'s categories)
	it("blend 1 is exactly `to`'s own chart", () => {
		expect(picture(build(1, before, after))).toEqual(
			picture(build(undefined, after, undefined)),
		);
	});
});
