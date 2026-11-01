/**
 * `radarChart`: keyed transitions (polygons morph vertex by vertex; series
 * that come and go grow out of or shrink into the centre, or sweep), keyed
 * axes (fold, turn, unfold), the grow and sweep reveals and their stagger,
 * and where axis names sit. The series are path batch items, whole outlines;
 * a swept series is clipped by a clip group: the shared sweep
 * wedge while the reveal plays, and a wedge of its own coming or going or
 * staggered), so "clipped" reads as "its spec carries a clip region".
 */

import type { Polyline } from "@sophistry/core/geometry";
import type { ShapeSpec } from "@sophistry/core/internal";
import { DEFAULT_FONT_WEIGHT, measureLabel } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { chart, chartHandle } from "../chart.js";
import { radarLabelOffset } from "../math/radar.js";
import { hashRanks } from "../stagger.js";
import { mount } from "../test-harness.js";
import { radarChart } from "./radar-chart.js";
import type { Scene } from "./test-helpers.js";
import {
	angleOf,
	boxOf,
	filled,
	label,
	labelled,
	labels,
	picture,
	rounded,
	shapePicture,
} from "./test-helpers.js";

/** The series polygons' filled parts. */
const polygons = (scene: Scene) =>
	filled(scene).filter((s) => s.fillOpacity === 0.25);
/** The series polygons under a clip group: their specs' clip regions, in nesting order. */
const clipped = (scene: Scene) =>
	polygons(scene).filter((s) => (s.spec.clip?.length ?? 0) > 0);
/** The box of the clip region innermost over a series polygon. */
const clipBox = (item: { spec: { clip?: readonly { rings: Polyline[] }[] } }) =>
	boxOf(item.spec.clip?.[item.spec.clip.length - 1]?.rings ?? []);
/** The spokes: two-point open lines. */
const spokes = (scene: Scene) =>
	scene
		.shapes()
		.filter((s: ShapeSpec) => !s.closed && s.polylines.flat().length === 2);

describe("keyed transitions on radarChart", () => {
	const before = [
		{ team: "a", v: [2, 2, 2, 2] },
		{ team: "b", v: [4, 1, 4, 1] },
	];
	const after = [
		{ team: "a", v: [4, 4, 4, 4] },
		{ team: "c", v: [1, 3, 1, 3] },
	];
	type Row = { team: string; v: number[] };
	const radar = (
		data: Row[],
		to: Row[] | undefined,
		blend?: number,
		extra: Record<string, unknown> = {},
	) =>
		radarChart.create({
			data,
			to,
			blend,
			axisValues: "v",
			key: "team",
			series: "team",
			axisLabels: ["N", "E", "S", "W"],
			...extra,
		});

	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		for (const extra of [{}, { reveal: "sweep", progress: 0.8 }]) {
			const start = mount(radar(before, after, 0, extra));
			const plainStart = mount(radar(before, undefined, 0, extra));
			expect(picture(start)).toEqual(picture(plainStart));
			const end = mount(radar(before, after, 1, extra));
			const plainEnd = mount(radar(after, undefined, 0, extra));
			expect(picture(end)).toEqual(picture(plainEnd));
		}
	});

	it("moves each vertex along its axis in data units", () => {
		const scene = mount(
			radar([before[0] as Row], [after[0] as Row], 0.5, {
				staging: "together",
				maxValue: 4,
			}),
		);
		const [polygon] = polygons(scene);
		expect(polygon && boxOf(polygon).maxX).toBeCloseTo(0.75);
		expect(polygon && boxOf(polygon).maxY).toBeCloseTo(0.75);
	});

	it("grows an entering series out of the centre and shrinks a leaving one into it", () => {
		const at = (blend: number) =>
			polygons(mount(radar(before, after, blend, { maxValue: 4 })));
		const exiting = at(1 / 6);
		expect(exiting).toHaveLength(2);
		expect(Math.min(...exiting.map((s) => boxOf(s).maxX))).toBeCloseTo(0.125);
		expect(at(0.5)).toHaveLength(1);
		const entering = at(5 / 6);
		expect(entering).toHaveLength(2);
		expect(Math.min(...entering.map((s) => boxOf(s).maxX))).toBeCloseTo(0.375);
	});

	it('with reveal="sweep", sweeps a series in and out on its own', () => {
		const scene = mount(
			radar(before, after, 1 / 6, { reveal: "sweep", maxValue: 4 }),
		);
		// b, the leaving one, clipped to its own wedge; a whole.
		expect(clipped(scene)).toHaveLength(1);
		expect(polygons(scene)).toHaveLength(2);
	});

	it("reports both ends' series to a frame", () => {
		const plot = chart.create({
			width: 4,
			height: 4,
			xRange: [-2, 2],
			yRange: [-2, 2],
			children: [radar(before, after, 0.5)],
		});
		mount(plot);
		expect(chartHandle(plot)?.colorDomain()).toEqual(["a", "b", "c"]);
	});
});

describe("keyed axes on radarChart", () => {
	const four = [
		{ team: "a", v: [2, 2, 2, 2] },
		{ team: "b", v: [4, 1, 4, 1] },
	];
	const three = [
		{ team: "a", v: [4, 4, 4] },
		{ team: "b", v: [1, 3, 1] },
	];
	type Row = { team: string; v: number[] };
	const radar = (
		data: Row[],
		to: Row[] | undefined,
		blend?: number,
		extra: Record<string, unknown> = {},
	) =>
		radarChart.create({
			data,
			to,
			blend,
			axisValues: "v",
			key: "team",
			series: "team",
			maxValue: 4,
			...extra,
		});
	const named = {
		axisLabels: ["N", "E", "S", "W"],
		toAxisLabels: ["N", "E", "W"],
	};

	it("is exactly `data` at blend 0 and exactly `to` at blend 1 when the axes change, by name or by position", () => {
		for (const [extra, plainTo] of [
			[named, { axisLabels: ["N", "E", "W"] }],
			[{}, {}],
			[
				{ ...named, reveal: "sweep", progress: 0.8 },
				{ axisLabels: ["N", "E", "W"], reveal: "sweep", progress: 0.8 },
			],
		] as const) {
			const start = mount(radar(four, three, 0, extra));
			const plainStart = mount(
				radar(four, undefined, 0, { ...extra, toAxisLabels: undefined }),
			);
			expect(picture(start)).toEqual(picture(plainStart));
			const end = mount(radar(four, three, 1, extra));
			const plainEnd = mount(radar(three, undefined, 0, plainTo));
			expect(picture(end)).toEqual(picture(plainEnd));
		}
	});

	it("folds a leaving axis away, turns the others, and unfolds an entering one", () => {
		const at = (blend: number) => mount(radar(four, three, blend, named));
		const exiting = at(0.25);
		expect(label(exiting, "S")?.style.opacity).toBeCloseTo(0.5);
		const [a] = polygons(exiting).filter(
			(s) => boxOf(s).maxX < 0.6 && boxOf(s).maxY < 0.6,
		);
		expect(a).toBeDefined();
		expect(a && boxOf(a).minY).toBeCloseTo(-0.25);
		const updating = at(0.75);
		expect(label(updating, "S")).toBeUndefined();
		const spokeAngles = spokes(updating).map((s) => {
			const tip = s.polylines.flat()[1] as { x: number; y: number };
			return Math.atan2(tip.y, tip.x);
		});
		expect(
			spokeAngles.some((angle) => Math.abs(angle + Math.PI / 12) < 1e-9),
		).toBe(true);
		expect(angleOf(label(updating, "E"))).toBeLessThan(0);
		expect(label(updating, "E")?.at.x).toBeGreaterThan(Math.cos(Math.PI / 12));
		const growing = mount(
			radar(three, four, 0.75, {
				axisLabels: ["N", "E", "W"],
				toAxisLabels: ["N", "E", "S", "W"],
			}),
		);
		expect(label(growing, "S")?.style.opacity).toBeCloseTo(0.5);
	});

	it("without names, joins axes by position: one more axis enters, it does not switch halfway", () => {
		const five = four.map((d) => ({ ...d, v: [...d.v, 3] }));
		const scene = mount(radar(four, five, 0.75));
		const lines = spokes(scene);
		expect(lines).toHaveLength(5);
		expect(lines.map((s) => rounded(s.style.opacity)).sort()).toEqual([
			0.225, 0.45, 0.45, 0.45, 0.45,
		]);
	});

	it("scrubs to the same frames, and the grid holds still when no axis moves", () => {
		const node = radar(four, three, 0, named);
		const scene = mount(node);
		const at = (t: number) => {
			node.set("blend", t);
			scene.commit();
			return picture(scene);
		};
		const seen = new Map<number, unknown>();
		for (const t of [0.1, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) seen.set(t, at(t));
		for (const t of [0.45, 0.1, 0.9]) expect(at(t)).toEqual(seen.get(t));

		// Series that change while the axes hold: the grid's nodes keep their points.
		const still = radar(
			four,
			[four[0] as Row, { team: "c", v: [1, 3, 1, 3] }],
			0,
			{
				axisLabels: ["N", "E", "S", "W"],
			},
		);
		const stillScene = mount(still);
		const grid = () =>
			still.children
				.filter((child) => child.type === "Polygon" || child.type === "Line")
				.map((child) =>
					child.type === "Polygon"
						? (child as unknown as { get(k: string): unknown }).get("points")
						: (child as unknown as { get(k: string): unknown }).get("to"),
				);
		const first = grid();
		for (const t of [0.2, 0.5, 0.8, 1]) {
			still.set("blend", t);
			stillScene.commit();
			const now = grid();
			now.forEach((value, i) => {
				expect(value).toBe(first[i]);
			});
		}
	});
});

describe("radarChart reveals", () => {
	it("draws its grid first, then sweeps the series in whole", () => {
		const half = mount(
			radarChart.create({
				data: [[3, 4, 5, 2]],
				maxValue: 5,
				progress: 0.5,
				reveal: "sweep",
			}),
		);
		// Frame done, nothing of the data shown yet.
		expect(polygons(half)).toHaveLength(0);
		const grid = half.shapes();
		expect(grid.length).toBeGreaterThan(0);
		for (const line of grid) expect(line.progress).toBe(1);

		const mid = mount(
			radarChart.create({
				data: [[3, 4, 5, 2]],
				maxValue: 5,
				progress: 0.75,
				reveal: "sweep",
			}),
		);
		// Half a turn clockwise from 12 o'clock: the whole polygon, clipped to the right half.
		const [polygon] = polygons(mid);
		expect(polygon && boxOf(polygon).minX).toBeCloseTo(-0.4);
		expect(polygon && boxOf(polygon).maxX).toBeCloseTo(0.8);
		expect(clipped(mid)).toHaveLength(1);
		expect(polygon && clipBox(polygon).minX).toBeCloseTo(0);

		const done = mount(
			radarChart.create({ data: [[3, 4, 5, 2]], maxValue: 5 }),
		);
		expect(clipped(done)).toHaveLength(0);
		expect(polygons(done)).toHaveLength(1);
	});

	it("grows each polygon out of the centre by default", () => {
		const mid = mount(
			radarChart.create({ data: [[5, 5, 5, 5]], maxValue: 5, progress: 0.75 }),
		);
		const [polygon] = polygons(mid);
		expect(clipped(mid)).toHaveLength(0);
		const box = boxOf(polygon ?? []);
		expect(box.maxX).toBeCloseTo(0.5);
		expect(box.minX).toBeCloseTo(-0.5);
		expect(box.maxY).toBeCloseTo(0.5);
		expect(box.minY).toBeCloseTo(-0.5);
	});
});

describe("radarChart stagger", () => {
	const square = [
		[4, 4, 4, 4],
		[4, 4, 4, 4],
	];

	it("grows series one after another in data order", () => {
		const scene = mount(
			radarChart.create({
				data: square,
				maxValue: 4,
				progress: 0.875,
				stagger: 0.5,
				colors: ["#ff0000", "#0000ff"],
			}),
		);
		const [first, second] = ["#ff0000", "#0000ff"].map((fill) =>
			polygons(scene).find((s) => s.fill === fill),
		);
		expect(first && boxOf(first).maxX).toBeCloseTo(1);
		expect(second && boxOf(second).maxX).toBeCloseTo(0.5);
		const early = mount(
			radarChart.create({
				data: square,
				maxValue: 4,
				progress: 0.6,
				stagger: 0.5,
			}),
		);
		expect(polygons(early)).toHaveLength(1);
	});

	it('with reveal="sweep", gives each series its own wedge', () => {
		const scene = mount(
			radarChart.create({
				data: square,
				maxValue: 4,
				progress: 0.85,
				stagger: 0.5,
				reveal: "sweep",
			}),
		);
		// The first is whole; the second is still under its own wedge.
		expect(polygons(scene)).toHaveLength(2);
		expect(clipped(scene)).toHaveLength(1);
	});

	it('staggerOrder="random": grows its series in key-hash order', () => {
		const teams = ["a", "b", "c", "d", "e", "f"];
		const order = hashRanks(teams);
		expect(order).not.toEqual(teams.map((_, i) => i));
		const colors = [
			"#ff0000",
			"#00ff00",
			"#0000ff",
			"#ffff00",
			"#00ffff",
			"#ff00ff",
		];
		const scene = mount(
			radarChart.create({
				data: teams.map((team) => ({ team, v: [4, 4, 4, 4] })),
				axisValues: "v",
				key: "team",
				maxValue: 4,
				progress: 0.8,
				stagger: 0.6,
				staggerOrder: "random",
				colors,
			}),
		);
		const size = (fill: string) => {
			const spec = polygons(scene).find((s) => s.fill === fill);
			return spec ? boxOf(spec).maxX : 0;
		};
		const byHash = teams
			.map((_, i) => ({
				rank: order[i] as number,
				size: size(colors[i] as string),
			}))
			.sort((p, q) => p.rank - q.rank);
		for (let i = 1; i < byHash.length; i++)
			expect((byHash[i] as { size: number }).size).toBeLessThanOrEqual(
				(byHash[i - 1] as { size: number }).size + 1e-9,
			);
		expect((byHash[0] as { size: number }).size).toBeGreaterThan(
			(byHash[byHash.length - 1] as { size: number }).size,
		);
	});

	it("enterStagger: both ends are exactly each end's own chart", () => {
		type Row = { id: string; v: number };
		const rows: Row[] = [
			{ id: "a", v: 2 },
			{ id: "b", v: 3 },
		];
		const more: Row[] = [
			...rows,
			{ id: "e", v: 4 },
			{ id: "c", v: 2 },
			{ id: "d", v: 3 },
		];
		const values = (list: Row[]) =>
			list.map((row) => ({ ...row, values: [row.v, 2, 3] }));
		const build = (blend: number | undefined, data: Row[], to?: Row[]) =>
			mount(
				radarChart.create({
					data: values(data),
					to: to && values(to),
					blend,
					axisValues: "values",
					key: "id",
					maxValue: 5,
					enterStagger: 0.6,
				}),
			);
		expect(picture(build(0, rows, more))).toEqual(
			picture(build(undefined, rows)),
		);
		expect(picture(build(1, rows, more))).toEqual(
			picture(build(undefined, more)),
		);
	});
});

describe("radarChart axis names", () => {
	const names = ["N", "Camera", "S", "Craftsmanship"];
	const gap = 0.12;
	const fontSize = 0.28;
	const style = (fontFamily: string) => ({
		fontSize,
		fontFamily,
		fontWeight: DEFAULT_FONT_WEIGHT,
		italic: false,
		letterSpacing: 0,
	});

	it("anchors each name by the side facing the chart, clear of the ring", () => {
		const scene = mount(
			radarChart.create({ data: [[1, 2, 3, 4]], axisLabels: names, radius: 2 }),
		);
		const family = labels(scene)[0]?.style.fontFamily ?? "";
		const width = (text: string) => measureLabel(text, style(family)).width;
		const m = measureLabel("0123456789", style(family));
		const h = m.ascent + m.descent;
		const byText = new Map(labels(scene).map((l) => [l.text, l.at]));
		const n = byText.get("N");
		expect(n?.x).toBeCloseTo(0);
		expect(n && n.y - h / 2).toBeCloseTo(2 + gap);
		const camera = byText.get("Camera");
		expect(camera && camera.x - width("Camera") / 2).toBeCloseTo(2 + gap);
		expect(camera?.y).toBeCloseTo(0);
		const s = byText.get("S");
		expect(s && s.y + h / 2).toBeCloseTo(-2 - gap);
		const craft = byText.get("Craftsmanship");
		expect(craft && craft.x + width("Craftsmanship") / 2).toBeCloseTo(-2 - gap);
	});

	it("places a diagonal name by its inner corner, and blends near vertical", () => {
		const size = { width: 1, height: 0.3 };
		const diagonal = radarLabelOffset(Math.PI / 4, size, 0.1);
		expect(diagonal.x - 0.5).toBeCloseTo(0.1 * Math.SQRT1_2);
		expect(diagonal.y - 0.15).toBeCloseTo(0.1 * Math.SQRT1_2);
		const left = radarLabelOffset(Math.PI / 2 + 1e-6, size, 0.1);
		const right = radarLabelOffset(Math.PI / 2 - 1e-6, size, 0.1);
		expect(Math.abs(left.x - right.x)).toBeLessThan(1e-4);
		expect(radarLabelOffset(Math.PI / 2, size, 0.1).x).toBeCloseTo(0);
		expect(radarLabelOffset(Math.PI / 2 - Math.PI / 24, size, 0).x).toBeCloseTo(
			(Math.sin(Math.PI / 24) / Math.sin(Math.PI / 12)) * 0.5,
		);
	});

	it("labelGap moves the names out", () => {
		const scene = mount(
			radarChart.create({
				data: [[1, 2, 3, 4]],
				axisLabels: names,
				radius: 2,
				labelGap: 0.5,
			}),
		);
		const family = labels(scene)[0]?.style.fontFamily ?? "";
		const m = measureLabel("0123456789", style(family));
		const n = labels(scene).find((l) => l.text === "N");
		expect(n && n.at.y - (m.ascent + m.descent) / 2).toBeCloseTo(2.5);
	});

	it("scrubs a staggered reveal to the same frames", () => {
		const node = radarChart.create({
			data: [
				[1, 2, 3],
				[3, 2, 1],
			],
			axisLabels: ["A", "B", "C"],
			progress: 0,
			stagger: 0.5,
		});
		const scene = mount(node);
		const at = (p: number) => {
			node.set("progress", p);
			scene.commit();
			return { picture: picture(scene), labels: labelled(scene) };
		};
		const half = at(0.7);
		at(1);
		at(0);
		expect(at(0.7)).toEqual(half);
		expect(shapePicture(scene).length).toBeGreaterThan(0);
	});
});
