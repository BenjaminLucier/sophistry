/**
 * Keyed data transitions (`to` + `blend`) on the guide-like marks: `labels`,
 * `ruleX`/`ruleY`, `tickX`/`tickY`, `rects`, `cells` and the `heatmap`
 * preset over it. Each is a function of one
 * number, so the tests set it and read the scene: both ends against the
 * plain charts, and the middle of each stage. The last block scrubs them
 * all, checking what holds still.
 *
 * A rule, tick or rectangle reveals through its item's `progress` (the full
 * outline, traced that far). The scrub test counts reads of each end's
 * channels (function channels) and checks the frame's steady parts keep
 * their identity.
 */

import type { SceneNode } from "@sophistry/core";
import { UNDER_AXES_Z_INDEX } from "@sophistry/core";
import type { MarksSpec } from "@sophistry/core/internal";
import { describe, expect, it, vi } from "vitest";
import { ruleX, ruleY } from "../bars/rules.js";
import { chart, chartHandle } from "../chart.js";
import { cells } from "../grids/cells.js";
import { heatmap } from "../grids/heatmap.js";
import { labels } from "../points/labels.js";
import { rects } from "../points/rects.js";
import { tickX, tickY } from "../points/ticks.js";
import { markItems, mount, probe } from "../test-harness.js";

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;

/** Moves a keyed layer's `blend` (layers of different kinds share the prop). */
const setBlend = (layer: SceneNode, blend: number) =>
	(layer as unknown as SceneNode<{ blend: number }>).set("blend", blend);

/** The paint order the mark under test is drawn at, so axes and grid are left out. */
const Z = 7;
type Scene = ReturnType<typeof mount>;

/** Whether a spec painted at `z` belongs to the layer under test (fills may paint under the axes). */
const onLayer = (z: number) => z === Z || z === Z + UNDER_AXES_Z_INDEX;
/** The layer's batched items, with the spec's opacity folded in and each item's reveal. */
const own = (scene: Scene) =>
	scene
		.marks()
		.filter((spec: MarksSpec) => onLayer(spec.zIndex))
		.flatMap((spec) =>
			markItems(spec).map((item, i) => ({
				item,
				kind: spec.shape.kind,
				closed:
					spec.shape.kind === "outline"
						? spec.shape.closed
						: spec.shape.kind === "paths"
							? (spec.shape.outlines[i]?.closed ?? false)
							: true,
				progress: rounded(spec.progresses?.[i] ?? 1),
				opacity: rounded(item.alpha * (spec.style?.opacity ?? 1)),
				stroke: item.stroke ?? (spec.style?.stroke as string | undefined),
			})),
		);
/** The layer's segments (line items), as rounded ends, full length, reveal, opacity and colour, in x order. */
const segments = (scene: Scene) =>
	own(scene)
		.filter(({ closed }) => !closed)
		.flatMap(({ item, opacity, stroke, progress }) => {
			const points = item.polylines.flat();
			const a = points[0];
			const b = points[points.length - 1];
			if (!a || !b) return [];
			return [
				{
					x0: rounded(a.x),
					y0: rounded(a.y),
					x1: rounded(b.x),
					y1: rounded(b.y),
					length: rounded(Math.hypot(b.x - a.x, b.y - a.y)),
					progress,
					opacity,
					stroke,
				},
			];
		})
		.sort((p, q) => p.x0 - q.x0 || p.y0 - q.y0);
/** The layer's boxes (rect items, or their outlines while partly revealed), as rounded bounds, fill, opacity and reveal, sorted. */
const boxes = (scene: Scene) =>
	own(scene)
		.filter(({ kind, closed }) => kind !== "circle" && closed)
		.map(({ item, opacity, progress }) => {
			const xs = item.polylines.flat().map((q) => q.x);
			const ys = item.polylines.flat().map((q) => q.y);
			return {
				minX: rounded(Math.min(...xs)),
				maxX: rounded(Math.max(...xs)),
				minY: rounded(Math.min(...ys)),
				maxY: rounded(Math.max(...ys)),
				fill: item.fill,
				opacity,
				progress,
			};
		})
		.sort((p, q) => p.minX - q.minX || p.minY - q.minY);
/** Every label at `Z` or `Z + 1`, as its text, rounded anchor, colour and opacity. */
const texts = (scene: Scene) =>
	scene
		.texts()
		.filter((s) => s.zIndex === Z || s.zIndex === Z + 1)
		.map((s) => ({
			text: s.text,
			x: rounded(s.at.x),
			y: rounded(s.at.y),
			color: s.style.fill,
			opacity: rounded(s.style.opacity),
		}))
		.sort((a, b) => a.x - b.x || a.y - b.y || a.text.localeCompare(b.text));

/** Mounts a chart and hands back its scene and a data point → scene point reader, rounded. */
const view = (node: SceneNode) => {
	const scene = mount(node);
	const p = (x: number, y: number) => {
		const q = chartHandle(node)?.coords.coordsToPoint(x, y) ?? { x: 0, y: 0 };
		return { x: rounded(q.x), y: rounded(q.y) };
	};
	return { scene, p };
};

const before = [
	{ id: "a", x: 1, y: 2, name: "A" },
	{ id: "b", x: 2, y: 4, name: "B" },
	{ id: "c", x: 3, y: 6, name: "C" },
];
const after = [
	{ id: "a", x: 1, y: 8, name: "A2" },
	{ id: "b", x: 4, y: 4, name: "B" },
	{ id: "d", x: 5, y: 2, name: "D" },
];
type Row = (typeof before)[number];

describe("keyed transitions on labels", () => {
	const plot = (
		blend: number | undefined,
		data: Row[] = before,
		to: Row[] | undefined = after,
	) =>
		chart.create({
			width: 8,
			height: 4,
			xRange: [0, 6],
			yRange: [0, 10],
			children: [
				labels.create({
					data,
					to,
					blend,
					key: "id",
					x: "x",
					y: "y",
					text: "name",
					color: (d: Row) => (d.id === "a" ? "#ff0000" : "#0000ff"),
					zIndex: Z,
				}),
			],
		});

	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expect(texts(view(plot(0)).scene)).toEqual(
			texts(view(plot(undefined, before, undefined)).scene),
		);
		expect(texts(view(plot(1)).scene)).toEqual(
			texts(view(plot(undefined, after, undefined)).scene),
		);
	});

	it("fades a leaving label out, slides a matched one in data units, fades a new one in", () => {
		const at = (blend: number) => {
			const { scene, p } = view(plot(blend));
			return { labels: texts(scene), p };
		};
		// Exit, update, enter: a third each, eased within.
		const exiting = at(1 / 6).labels;
		expect(exiting.find((l) => l.text === "C")?.opacity).toBeCloseTo(0.5);
		const updating = at(0.5);
		expect(updating.labels).toHaveLength(2);
		// a: y 2 → 8; b: x 2 → 4. Halfway in data units.
		expect(updating.labels[0]).toMatchObject(updating.p(1, 5));
		expect(updating.labels[1]).toMatchObject(updating.p(3, 4));
		// The text switches halfway through the update.
		const early = at(0.45);
		expect(early.labels.find((l) => l.x === early.p(1, 0).x)?.text).toBe("A");
		const late = at(0.55);
		expect(late.labels.find((l) => l.x === late.p(1, 0).x)?.text).toBe("A2");
		const entering = at(5 / 6).labels;
		expect(entering.find((l) => l.text === "D")?.opacity).toBeCloseTo(0.5);
	});

	it("keeps a label's node by key when the data reorders", () => {
		const layer = labels.create({
			data: before,
			key: "id",
			x: "x",
			y: "y",
			text: "name",
			zIndex: Z,
		});
		const scene = mount(
			chart.create({
				width: 8,
				height: 4,
				xRange: [0, 6],
				yRange: [0, 10],
				children: [layer],
			}),
		);
		/** The node under `layer` whose text is `text`. */
		const nodeOf = (text: string): SceneNode | undefined => {
			const walk = (node: SceneNode): SceneNode | undefined => {
				const children =
					(node as { children?: readonly SceneNode[] }).children ?? [];
				for (const child of children) {
					if (
						child.type === "Label" &&
						(child as SceneNode<{ text: string }>).get("text") === text
					)
						return child;
					const found = walk(child);
					if (found) return found;
				}
				return undefined;
			};
			return walk(layer);
		};
		const first = nodeOf("A");
		expect(first).toBeDefined();
		layer.set("data", [...before].reverse());
		scene.commit();
		expect(nodeOf("A")).toBe(first);
	});
});

type RuleRow = { id: string; x: number; low?: number; top?: number };
const ruleBefore: RuleRow[] = [
	{ id: "a", x: 1, top: 3 },
	{ id: "b", x: 2 },
	{ id: "c", x: 3, low: 1, top: 4 },
];
const ruleAfter: RuleRow[] = [
	{ id: "a", x: 1, top: 7 },
	{ id: "b", x: 4, low: 2 },
	{ id: "d", x: 5, top: 5 },
];
describe("keyed transitions on ruleX and ruleY", () => {
	const plot = (
		blend: number | undefined,
		data: RuleRow[] = ruleBefore,
		to: RuleRow[] | undefined = ruleAfter,
	) =>
		chart.create({
			width: 8,
			height: 4,
			xRange: [0, 6],
			yRange: [0, 10],
			children: [
				ruleX.create({
					data,
					to,
					blend,
					key: "id",
					x: "x",
					y1: "low",
					y2: "top",
					zIndex: Z,
				}),
			],
		});

	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expect(segments(view(plot(0)).scene)).toEqual(
			segments(view(plot(undefined, ruleBefore, undefined)).scene),
		);
		expect(segments(view(plot(1)).scene)).toEqual(
			segments(view(plot(undefined, ruleAfter, undefined)).scene),
		);
		const horizontal = (
			blend: number | undefined,
			data: number[],
			to?: number[],
		) =>
			chart.create({
				width: 8,
				height: 4,
				xRange: [0, 6],
				yRange: [0, 10],
				children: [ruleY.create({ data, to, blend, zIndex: Z })],
			});
		expect(segments(view(horizontal(1, [2, 4], [5])).scene)).toEqual(
			segments(view(horizontal(undefined, [5])).scene),
		);
	});

	it("draws a leaving rule back, stretches a matched one in data units (from the plot's edge), draws a new one out", () => {
		const at = (blend: number) => {
			const { scene, p } = view(plot(blend));
			return { segments: segments(scene), p };
		};
		// Half drawn: the whole rule, traced half way (`progress` 0.5).
		const exiting = at(1 / 6);
		const c = exiting.segments.find((s) => s.x0 === exiting.p(3, 0).x);
		expect(c?.length).toBeCloseTo(exiting.p(3, 4).y - exiting.p(3, 1).y);
		expect(c?.progress).toBeCloseTo(0.5);
		const updating = at(0.5);
		const { p } = updating;
		expect(updating.segments).toHaveLength(2);
		// a: from the bottom edge, top 3 → 7.
		const a = updating.segments.find((s) => s.x0 === p(1, 0).x);
		expect(a?.y0).toBeCloseTo(p(1, 0).y);
		expect(a?.y1).toBeCloseTo(p(1, 5).y);
		// b: x 2 → 4; low edge 0 (the plot's) → 2; top stays at the plot's.
		const b = updating.segments.find((s) => s.x0 === p(3, 0).x);
		expect(b?.y0).toBeCloseTo(p(3, 1).y);
		expect(b?.y1).toBeCloseTo(p(3, 10).y);
		const entering = at(5 / 6);
		const d = entering.segments.find((s) => s.x0 === entering.p(5, 0).x);
		expect(d?.length).toBeCloseTo(entering.p(5, 5).y - entering.p(5, 0).y);
		expect(d?.progress).toBeCloseTo(0.5);
	});
});

const tickBefore = [
	{ id: "a", v: 1, g: "p" },
	{ id: "b", v: 2, g: "q" },
	{ id: "c", v: 3, g: "p" },
];
const tickAfter = [
	{ id: "a", v: 4, g: "q" },
	{ id: "b", v: 2, g: "q" },
	{ id: "d", v: 5, g: "r" },
];
type TickRow = (typeof tickBefore)[number];

describe("keyed transitions on tickX and tickY", () => {
	const plot = (
		blend: number | undefined,
		data: TickRow[] = tickBefore,
		to: TickRow[] | undefined = tickAfter,
	) =>
		chart.create({
			width: 8,
			height: 4,
			xRange: [0, 6],
			children: [
				tickX.create({
					data,
					to,
					blend,
					key: "id",
					x: "v",
					y: "g",
					zIndex: Z,
				}),
			],
		});

	it("is exactly `data` at blend 0 and exactly `to` at blend 1, rows on a blending band axis", () => {
		expect(segments(view(plot(0)).scene)).toEqual(
			segments(view(plot(undefined, tickBefore, undefined)).scene),
		);
		expect(segments(view(plot(1)).scene)).toEqual(
			segments(view(plot(undefined, tickAfter, undefined)).scene),
		);
		const rug = (blend: number | undefined, data: number[], to?: number[]) =>
			chart.create({
				width: 8,
				height: 4,
				yRange: [0, 10],
				children: [tickY.create({ data, to, blend, zIndex: Z })],
			});
		expect(segments(view(rug(0, [2, 4], [5])).scene)).toEqual(
			segments(view(rug(undefined, [2, 4])).scene),
		);
		expect(segments(view(rug(1, [2, 4], [5])).scene)).toEqual(
			segments(view(rug(undefined, [5])).scene),
		);
	});

	it("draws a leaving tick back, slides a matched one in data units and across rows, draws a new one out", () => {
		const plainStart = segments(
			view(plot(undefined, tickBefore, undefined)).scene,
		);
		const plainEnd = segments(
			view(plot(undefined, tickAfter, undefined)).scene,
		);
		const at = (blend: number) => {
			const node = plot(blend);
			const scene = mount(node);
			const x = (v: number) =>
				rounded(chartHandle(node)?.coords.coordsToPoint(v, 0).x ?? 0);
			return { segments: segments(scene), x };
		};
		const fullLength = plainStart[0]?.length as number;
		// Half drawn: the whole tick, traced half way (`progress` 0.5).
		const exiting = at(1 / 6);
		const leaving = exiting.segments.find((s) => s.x0 === exiting.x(3));
		expect(leaving?.length).toBeCloseTo(fullLength);
		expect(leaving?.progress).toBeCloseTo(0.5);
		const updating = at(0.5);
		const { x } = updating;
		expect(updating.segments.map((s) => s.x0)).toEqual([x(2), x(2.5)]);
		// a moves from row p to row q: halfway, it stands in neither alone.
		const a = updating.segments.find((s) => s.x0 === x(2.5));
		const a0 = plainStart.find((s) => s.x0 === x(1));
		const a1 = plainEnd.find((s) => s.x0 === x(4));
		expect(a && a0 && a1).toBeTruthy();
		expect(a?.y0).not.toBeCloseTo(a0?.y0 ?? Number.NaN);
		expect(a?.y0).not.toBeCloseTo(a1?.y0 ?? Number.NaN);
		const entering = at(5 / 6);
		const arriving = entering.segments.find((s) => s.x0 === entering.x(5));
		expect(arriving?.length).toBeCloseTo(fullLength);
		expect(arriving?.progress).toBeCloseTo(0.5);
	});
});

type SpanRow = {
	id: string;
	x1?: number;
	x2?: number;
	y1?: number;
	y2?: number;
};
const spanBefore: SpanRow[] = [
	{ id: "a", x1: 1, x2: 2 },
	{ id: "b", x1: 3, x2: 4, y1: 1, y2: 2 },
];
const spanAfter: SpanRow[] = [
	{ id: "a", x1: 2, x2: 4 },
	{ id: "c", y1: 3, y2: 5 },
];

describe("keyed transitions on rects", () => {
	const plot = (
		blend: number | undefined,
		data: SpanRow[] = spanBefore,
		to: SpanRow[] | undefined = spanAfter,
	) =>
		chart.create({
			width: 8,
			height: 4,
			xRange: [0, 6],
			yRange: [0, 10],
			children: [
				rects.create({
					data,
					to,
					blend,
					key: "id",
					x1: "x1",
					x2: "x2",
					y1: "y1",
					y2: "y2",
					color: (d: SpanRow) => (d.id === "a" ? "#ff0000" : "#0000ff"),
					zIndex: Z,
				}),
			],
		});

	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expect(boxes(view(plot(0)).scene)).toEqual(
			boxes(view(plot(undefined, spanBefore, undefined)).scene),
		);
		expect(boxes(view(plot(1)).scene)).toEqual(
			boxes(view(plot(undefined, spanAfter, undefined)).scene),
		);
	});

	it("fades a leaving span out, moves a matched one's edges in data units, fades a new one in", () => {
		const at = (blend: number) => {
			const { scene, p } = view(plot(blend));
			return { boxes: boxes(scene), p };
		};
		// A rectangle's presence is its reveal: its outline traced, its fill coming up (`progress`).
		const exiting = at(1 / 6);
		expect(
			exiting.boxes.find((r) => r.minX === exiting.p(3, 0).x)?.progress,
		).toBeCloseTo(0.5);
		const updating = at(0.5);
		const shown = updating.boxes.filter((r) => r.opacity > 0 && r.progress > 0);
		expect(shown).toHaveLength(1);
		expect(shown[0]?.minX).toBeCloseTo(updating.p(1.5, 0).x);
		expect(shown[0]?.maxX).toBeCloseTo(updating.p(3, 0).x);
		const entering = at(5 / 6);
		const c = entering.boxes.find((r) => r.minY === entering.p(0, 3).y);
		expect(c?.progress).toBeCloseTo(0.5);
	});
});

const days = ["Mon", "Tue"];
const slots = ["am", "pm"];
const load = days.flatMap((day, i) =>
	slots.map((slot, j) => ({ day, slot, n: (i + 1) * (j + 2) })),
);
const nextLoad = [
	...load
		.filter((d) => d.day !== "Mon" || d.slot !== "am")
		.map((d) => ({ ...d, n: d.n + 3 })),
	{ day: "Wed", slot: "am", n: 1 },
	{ day: "Wed", slot: "pm", n: 9 },
];
type Cell = (typeof load)[number];

describe("keyed transitions on cells and heatmap", () => {
	const plot = (
		blend: number | undefined,
		data: Cell[] = load,
		to: Cell[] | undefined = nextLoad,
	) =>
		chart.create({
			width: 6,
			height: 3,
			children: [
				cells.create({
					data,
					to,
					blend,
					x: "day",
					y: "slot",
					value: "n",
					ramp: "viridis",
					labels: true,
					zIndex: Z,
				}),
			],
		});
	/** Only what is drawn: a leaving or entering cell may stay at opacity 0. */
	const shownBoxes = (scene: Scene) =>
		boxes(scene).filter((cell) => cell.opacity > 0);

	it("is exactly `data` at blend 0 and exactly `to` at blend 1, on blending band axes", () => {
		const start = view(plot(0)).scene;
		const plainStart = view(plot(undefined, load, undefined)).scene;
		expect(boxes(start)).toEqual(boxes(plainStart));
		expect(texts(start)).toEqual(texts(plainStart));
		const end = view(plot(1)).scene;
		const plainEnd = view(plot(undefined, nextLoad, undefined)).scene;
		expect(boxes(end)).toEqual(boxes(plainEnd));
		expect(texts(end)).toEqual(texts(plainEnd));
		const preset = (blend: number | undefined, data: Cell[], to?: Cell[]) =>
			heatmap.create({
				data,
				to,
				blend,
				x: "day",
				y: "slot",
				value: "n",
				width: 6,
				height: 3,
				zIndex: Z,
			});
		const presetEnd = boxes(view(preset(1, load, nextLoad)).scene);
		expect(presetEnd).toHaveLength(nextLoad.length);
		expect(presetEnd).toEqual(boxes(view(preset(undefined, nextLoad)).scene));
	});

	it("fades a leaving cell, blends a matched cell's colour through each end's ramp, fades a new one in", () => {
		const exiting = shownBoxes(view(plot(1 / 6)).scene);
		// Mon·am leaves: half faded, the rest whole.
		expect(exiting.map((c) => c.opacity).sort()).toEqual([0.5, 1, 1, 1]);
		const start = boxes(view(plot(undefined, load, undefined)).scene);
		const end = boxes(view(plot(undefined, nextLoad, undefined)).scene);
		const updating = shownBoxes(view(plot(0.5)).scene);
		expect(updating).toHaveLength(3);
		// Each matched cell's fill is its own blend, read through each end's
		// ramp: Mon·pm (0.25 → 0.625 of the way) and Tue·am (0.5 → 0.75) are
		// neither end's colour; Tue·pm tops both ramps, so it holds.
		const fills = (list: typeof start) => new Set(list.map((c) => c.fill));
		const between = updating.filter(
			(cell) => !fills(start).has(cell.fill) && !fills(end).has(cell.fill),
		);
		expect(between).toHaveLength(2);
		const entering = shownBoxes(view(plot(5 / 6)).scene);
		expect(entering.filter((c) => c.opacity === 0.5)).toHaveLength(2);
	});

	it("a heatmap refuses `to` with `cluster`", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(() =>
				mount(
					heatmap.create({
						data: load,
						to: nextLoad,
						x: "day",
						y: "slot",
						value: "n",
						cluster: true,
						width: 6,
						height: 3,
					}),
				),
			).toThrow(/cluster/);
		} finally {
			error.mockRestore();
		}
	});
});

describe("keyed guide marks under a scrub", () => {
	it("scrubs blends without warnings, reading each end's channels once and keeping the frames' steady parts", () => {
		const messages: string[] = [];
		const spies = (["warn", "error"] as const).map((level) =>
			vi.spyOn(console, level).mockImplementation((...args) => {
				messages.push(`${level}: ${args.map(String).join(" ")}`);
			}),
		);
		try {
			/** Reads of the labels' `x` channel. */
			let reads = 0;
			const countedX = (d: Row) => {
				reads++;
				return d.x;
			};
			const first = [
				labels.create({
					data: before,
					to: after,
					blend: 0,
					key: "id",
					x: countedX,
					y: "y",
					text: "name",
					stagger: 0.3,
				}),
				ruleX.create({
					data: ruleBefore,
					to: ruleAfter,
					blend: 0,
					key: "id",
					x: "x",
					y1: "low",
					y2: "top",
					tooltip: true,
				}),
				rects.create({
					data: spanBefore,
					to: spanAfter,
					blend: 0,
					key: "id",
					x1: "x1",
					x2: "x2",
					y1: "y1",
					y2: "y2",
				}),
			];
			const second = [
				tickX.create({
					data: tickBefore,
					to: tickAfter,
					blend: 0,
					key: "id",
					x: "v",
					y: "g",
					tooltip: true,
				}),
				labels.create({
					data: tickBefore,
					to: tickAfter,
					blend: 0,
					key: "id",
					x: "v",
					y: "g",
					text: "id",
				}),
			];
			const third = [
				cells.create({
					data: load,
					to: nextLoad,
					blend: 0,
					x: "day",
					y: "slot",
					value: "n",
					labels: true,
					tooltip: true,
				}),
			];
			const watchers = [probe(), probe(), probe()];
			const charts = [
				chart.create({
					width: 8,
					height: 4,
					children: [...first, (watchers[0] as ReturnType<typeof probe>).node],
				}),
				chart.create({
					width: 8,
					height: 4,
					children: [...second, (watchers[1] as ReturnType<typeof probe>).node],
				}),
				chart.create({
					width: 6,
					height: 3,
					colorbar: true,
					children: [...third, (watchers[2] as ReturnType<typeof probe>).node],
				}),
			];
			const scene = mount(...charts);
			const joins = watchers.map((w) => w.seen.frame?.join);
			const scales = watchers.map((w) => w.seen.frame?.colorScale);
			expect(joins.every((join) => join !== undefined)).toBe(true);
			expect(reads).toBeGreaterThan(0);
			reads = 0;
			const layers = [...first, ...second, ...third];
			for (const t of [0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1, 0.5, 0, 1]) {
				for (const layer of layers) setBlend(layer, t);
				scene.commit();
				// What the frames derive from the layers' reports holds still
				// while only the blend moves.
				watchers.forEach((w, i) => {
					expect(w.seen.frame?.join).toBe(joins[i]);
					expect(w.seen.frame?.colorScale).toBe(scales[i]);
				});
			}
			expect(messages).toEqual([]);
			// Each end's channels are read once, not per frame.
			expect(reads).toBe(0);
		} finally {
			for (const spy of spies) spy.mockRestore();
		}
	});
});
