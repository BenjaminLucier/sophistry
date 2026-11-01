/**
 * `pieChart`: keyed transitions (slices morph by value, so the angles always
 * fill the turn), the grow and sweep reveals, label placement, the data API
 * and accessible names. Slices are path batch items, read with `markItems`.
 */

import { describe, expect, it } from "vitest";
import { ringLayout, ringOrder } from "../math/pie.js";
import { mount } from "../test-harness.js";
import { pieChart } from "./pie-chart.js";
import {
	angleOf,
	boxOf,
	filled,
	filledPicture,
	label,
	labelled,
	labels,
	picture,
	turnOf,
} from "./test-helpers.js";

describe("ring layout across a transition", () => {
	it("orders both ends' keys so nothing crosses", () => {
		expect(ringOrder(["a", "x", "b"], ["a", "y", "b"], "from")).toEqual([
			"a",
			"x",
			"y",
			"b",
		]);
		expect(ringOrder(["a", "x", "b"], ["a", "y", "b"], "to")).toEqual([
			"a",
			"x",
			"y",
			"b",
		]);
		expect(ringOrder(["x", "b"], ["y", "b"], "from")).toEqual(["x", "y", "b"]);
		expect(ringOrder(["x", "b"], ["y", "b"], "to")).toEqual(["x", "y", "b"]);
		// Reordered shared keys: each end keeps its own order.
		expect(ringOrder(["a", "b"], ["b", "a"], "from")).toEqual(["a", "b"]);
		expect(ringOrder(["a", "b"], ["b", "a"], "to")).toEqual(["b", "a"]);
	});

	it("blends two orders' angles, every slice keeping its share", () => {
		const orders = { from: ["a", "b"], to: ["b", "a"] };
		const weight = (key: string | number) => (key === "a" ? 1 : 3);
		const half = ringLayout(orders, weight, 0.5);
		const a = half.get("a");
		expect(a?.fraction).toBeCloseTo(0.25);
		expect(a?.offset).toBeCloseTo(0.375);
		expect(ringLayout(orders, weight, 1).get("a")?.offset).toBeCloseTo(0.75);
	});
});

describe("keyed transitions on pieChart", () => {
	const before = [
		{ name: "a", v: 2 },
		{ name: "b", v: 1 },
		{ name: "c", v: 1 },
	];
	const after = [
		{ name: "a", v: 1 },
		{ name: "b", v: 3 },
		{ name: "d", v: 4 },
	];
	type Row = { name: string; v: number };
	const pie = (
		data: Row[],
		to: Row[] | undefined,
		blend?: number,
		extra: Record<string, unknown> = {},
	) =>
		mount(
			pieChart.create({
				data,
				to,
				blend,
				value: "v",
				label: "name",
				innerRadius: 0.3,
				...extra,
			}),
		);

	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		for (const extra of [{}, { reveal: "sweep", progress: 0.6 }]) {
			const start = pie(before, after, 0, extra);
			const plainStart = pie(before, undefined, 0, extra);
			expect(filledPicture(start)).toEqual(filledPicture(plainStart));
			expect(labelled(start)).toEqual(labelled(plainStart));
			const end = pie(before, after, 1, extra);
			const plainEnd = pie(after, undefined, 0, extra);
			expect(filledPicture(end)).toEqual(filledPicture(plainEnd));
			expect(labelled(end)).toEqual(labelled(plainEnd));
		}
		// Reordered: the ends are still the plain charts.
		const reordered = [after[2], after[0], after[1]] as Row[];
		expect(filledPicture(pie(before, reordered, 1))).toEqual(
			filledPicture(pie(reordered, undefined)),
		);
	});

	it("blends values in data space: the angles follow the values", () => {
		const scene = pie(
			[
				{ name: "a", v: 1 },
				{ name: "b", v: 1 },
			],
			[
				{ name: "a", v: 3 },
				{ name: "b", v: 1 },
			],
			0.5,
			{ staging: "together", label: undefined, key: "name" },
		);
		// a is 2 of 3 halfway: its percentage and its label's angle say so.
		expect(labels(scene).map((s) => s.text)).toEqual(["67%", "33%"]);
		expect(turnOf(angleOf(label(scene, "67%")))).toBeCloseTo(1 / 3);
	});

	it("closes a leaving slice, then updates, then opens an entering one in place", () => {
		const from = [
			{ name: "a", v: 1 },
			{ name: "b", v: 1 },
			{ name: "c", v: 2 },
		];
		const to = [
			{ name: "a", v: 1 },
			{ name: "n", v: 2 },
			{ name: "b", v: 1 },
		];
		// Exit, update, enter: a third each, eased within.
		const exiting = pie(from, to, 1 / 6);
		const c = label(exiting, "c");
		expect(c?.style.opacity).toBeCloseTo(0.5);
		expect(turnOf(angleOf(c))).toBeCloseTo(2 / 3 + 1 / 6);
		expect(label(exiting, "n")).toBeUndefined();

		const updating = pie(from, to, 0.5);
		expect(labels(updating).map((s) => s.text)).toEqual(["a", "b"]);
		expect(turnOf(angleOf(label(updating, "b")))).toBeCloseTo(0.75);

		const entering = pie(from, to, 5 / 6);
		const n = label(entering, "n");
		expect(n?.style.opacity).toBeCloseTo(0.5);
		expect(turnOf(angleOf(n))).toBeCloseTo(1 / 3 + 1 / 6);
		expect(turnOf(angleOf(label(entering, "b")))).toBeCloseTo(2 / 3 + 1 / 6);
	});

	it("scrubs a blend back and forth: each frame is a function of blend", () => {
		const node = pieChart.create({
			data: [
				{ k: "a", v: 2 },
				{ k: "b", v: 1 },
				{ k: "c", v: 3 },
			],
			to: [
				{ k: "c", v: 1 },
				{ k: "a", v: 2 },
				{ k: "d", v: 2 },
			],
			blend: 0,
			value: "v",
			label: "k",
			reveal: "sweep",
		});
		const scene = mount(node);
		const at = (t: number) => {
			node.set("blend", t);
			scene.commit();
			return picture(scene);
		};
		const pictures = new Map<number, unknown>();
		for (const t of [0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1])
			pictures.set(t, at(t));
		for (const t of [0.45, 0.1, 0.9]) expect(at(t)).toEqual(pictures.get(t));
	});

	it("enterStagger: both ends are exactly each end's own chart", () => {
		const rows = [
			{ id: "a", v: 2 },
			{ id: "b", v: 3 },
		];
		const more = [...rows, { id: "e", v: 4 }, { id: "c", v: 2 }];
		const build = (blend: number | undefined, data: object[], to?: object[]) =>
			mount(
				pieChart.create({
					data,
					to,
					blend,
					value: "v",
					label: "id",
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

describe('pieChart reveal="sweep" sweeps clockwise', () => {
	it("uncovers the slices in data order", () => {
		const scene = mount(
			pieChart.create({
				data: [1, 1, 2],
				progress: 0.5,
				reveal: "sweep",
				labels: false,
			}),
		);
		const slices = filled(scene);
		// Halfway round: the first two (a quarter each) are whole, the third not begun.
		expect(slices).toHaveLength(2);
		for (const slice of slices) expect(slice.progress).toBe(1);
		const first = boxOf(slices[0]?.polylines ?? []);
		expect(first.minX).toBeCloseTo(0);
		expect(first.minY).toBeCloseTo(0);
		expect(first.maxX).toBeCloseTo(1);
	});

	it("labels fade in over the end of their slice's fill", () => {
		const scene = mount(
			pieChart.create({ data: [1, 1], progress: 0.4, reveal: "sweep" }),
		);
		const texts = labels(scene);
		expect(texts).toHaveLength(1);
		expect(texts[0]?.style.opacity).toBeCloseTo(0.5);
	});
});

describe("pieChart grows its slices together", () => {
	it("opens every slice at once, each pushed round by the ones before", () => {
		const scene = mount(
			pieChart.create({ data: [1, 1, 2], progress: 0.5, labels: false }),
		);
		const slices = filled(scene);
		expect(slices).toHaveLength(3);
		const first = boxOf(slices[0]?.polylines ?? []);
		expect(first.minX).toBeCloseTo(0);
		expect(first.minY).toBeCloseTo(0);
		expect(first.maxX).toBeCloseTo(Math.SQRT1_2);
		const last = boxOf(slices[2]?.polylines ?? []);
		expect(last.minX).toBeCloseTo(0);
		expect(last.minY).toBeCloseTo(-1);
	});

	it("labels fade in over the end of the grow and ride round with the slices", () => {
		const scene = mount(pieChart.create({ data: [1, 1], progress: 0.8 }));
		const texts = labels(scene);
		expect(texts).toHaveLength(2);
		for (const text of texts) expect(text.style.opacity).toBeCloseTo(0.5);
	});
});

describe("pieChart label placement", () => {
	const placed = (innerRadius: number | undefined) =>
		labels(
			mount(
				pieChart.create({
					data: [
						{ name: "a", v: 3 },
						{ name: "b", v: 1 },
					],
					value: "v",
					label: "name",
					radius: 2,
					innerRadius,
				}),
			),
		).map((spec) => Math.hypot(spec.at.x, spec.at.y));

	it("puts a plain pie's labels 0.65 of the way out", () => {
		for (const at of placed(undefined)) expect(at).toBeCloseTo(1.3);
	});

	it("centres a doughnut's labels in its ring once the hole is half the radius", () => {
		for (const at of placed(1)) expect(at).toBeCloseTo(1.5);
		for (const at of placed(1.4)) expect(at).toBeCloseTo(1.7);
	});

	it("blends between the two for a smaller hole", () => {
		for (const at of placed(0.5)) expect(at).toBeCloseTo(0.5 + 1.5 * 0.575);
	});
});

describe("pieChart data API", () => {
	const data = [
		{ lang: "rust", share: 1 },
		{ lang: "go", share: 3 },
	];

	it("labels slices from a label channel, else by percentage", () => {
		const texts = (scene: ReturnType<typeof mount>) =>
			labels(scene).map((s) => s.text);
		expect(
			texts(mount(pieChart.create({ data, value: "share", label: "lang" }))),
		).toEqual(["rust", "go"]);
		expect(texts(mount(pieChart.create({ data, value: "share" })))).toEqual([
			"25%",
			"75%",
		]);
	});

	it("ariaLabel names each slice; without it slices are not exposed", () => {
		const named = pieChart.create({
			data,
			value: "share",
			label: "lang",
			ariaLabel: "Languages",
		});
		mount(named);
		const wedges = named.children[0] as unknown as {
			get(key: string): unknown;
		};
		const itemLabel = wedges.get("itemLabel") as (i: number) => string;
		expect([itemLabel(0), itemLabel(1)]).toEqual([
			"Languages: rust",
			"Languages: go",
		]);
		expect(wedges.get("label")).toBe("Languages");
		const plain = pieChart.create({ data, value: "share", label: "lang" });
		mount(plain);
		const bare = plain.children[0] as unknown as { get(key: string): unknown };
		expect(bare.get("itemLabel")).toBeUndefined();
		expect(bare.get("label")).toBeUndefined();
	});

	it("number[] data is the values", () => {
		expect(
			labels(mount(pieChart.create({ data: [1, 1] }))).map((s) => s.text),
		).toEqual(["50%", "50%"]);
	});

	it("draws one path batch for every slice", () => {
		const scene = mount(pieChart.create({ data: [1, 2, 3, 4] }));
		expect(scene.marks()).toHaveLength(1);
		expect(filled(scene)).toHaveLength(4);
	});
});
