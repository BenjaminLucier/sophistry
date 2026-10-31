/**
 * A keyed transition whose fitted axis changes kind between its ends (a bar
 * chart's band axis turning into a scatter's continuous one): the two axes
 * cross-fade over the update stage, the plot mapping through the near end's
 * axis until the stage's midpoint and the far end's after it. Both ends are
 * exactly the plain charts; mid-way both axes are drawn, each in its own
 * mapping, faded (the mark families' cases live with their marks).
 *
 * The scrub tests check that what the frame derives from the reports alone
 * keeps its identity through a scrub (`frame.join`, each end's fitted
 * swapping axis in `frame.ends`) while the blend moves the plot.
 */

import type { SceneNode } from "@sophistry/core";
import { UNDER_AXES_Z_INDEX } from "@sophistry/core";
import type { MarksSpec } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { bars } from "../bars/bars";
import { chart, chartHandle } from "../chart";
import { linePlot } from "../curves/line-plot";
import { cells as cellsLayer } from "../grids/cells";
import { scatter } from "../points/scatter";
import { markItems, mount, probe } from "../test-harness";
import type { ChartFrame, ChartProps } from "./types";

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;

/** Moves a keyed layer's `blend` (layers of different kinds share the prop). */
const setBlend = (layer: SceneNode, blend: number) =>
	(layer as unknown as SceneNode<{ blend: number }>).set("blend", blend);
const Z = 7;
type Staging = "staged" | "together";
type Scene = ReturnType<typeof mount>;

const sales = [
	{ id: "a", q: "Q1", n: 3 },
	{ id: "b", q: "Q2", n: 5 },
	{ id: "c", q: "Q3", n: 4 },
];
const points = [
	{ id: "p", x: 12, y: 3 },
	{ id: "q", x: 30, y: 6 },
	{ id: "r", x: 45, y: 2 },
];
type Sale = (typeof sales)[number];
type Pt = (typeof points)[number];

/** Every label, as its text, rounded anchor and opacity, sorted. */
const texts = (scene: Scene) =>
	scene
		.texts()
		.map((s) => ({
			text: s.text,
			x: rounded(s.at.x),
			y: rounded(s.at.y),
			opacity: rounded(s.style.opacity),
		}))
		.sort((p, q) => p.text.localeCompare(q.text) || p.x - q.x || p.y - q.y);

/**
 * Whether a spec painted at `z` belongs to a layer given `zIndex: layer`: at
 * `layer` itself, or at `layer + UNDER_AXES_Z_INDEX` where a mark paints its
 * fills under the axes (bars).
 */
const onLayer = (z: number, layer: number): boolean =>
	z === layer || z === layer + UNDER_AXES_Z_INDEX;
/** The batched items of the marks on layer `z`, with their placed boxes and alpha. */
const itemsAt = (scene: Scene, z: number) =>
	scene
		.marks()
		.filter((spec: MarksSpec) => onLayer(spec.zIndex, z))
		.flatMap((spec) =>
			markItems(spec).map((item) => ({
				item,
				opacity: rounded(item.alpha * (spec.style?.opacity ?? 1)),
			})),
		);
/** Whether an item is drawn at all: some opacity, some size. */
const drawn = ({
	item,
	opacity,
}: ReturnType<typeof itemsAt>[number]): boolean =>
	opacity > 0 &&
	(item.radius > 0 || (item.halfWidth > 0 && item.halfHeight > 0));

/**
 * The swapping x axis at each end of a frame's `ends`: the near end's band
 * scale (by identity) and the far end's fitted range. Both are fitted once
 * per transition; the plot they map into (its area, the other axis) does
 * follow the blend, so `ends` itself is a new object on most frames.
 */
const swapFits = (frame: ChartFrame | null) => ({
	fromBand: frame?.ends?.from.xBand,
	toRange: frame?.ends?.to.coords.xRange(),
});

/** Bars leaving and points arriving on one track; `undefined` ends draw the plain chart. */
const build = (
	blend: number,
	barEnds: { data: Sale[]; to?: Sale[] },
	dotEnds: { data: Pt[]; to?: Pt[] },
	extra: Partial<ChartProps> = {},
) =>
	chart.create({
		width: 8,
		height: 4,
		...extra,
		children: [
			bars.create({
				zIndex: Z,
				data: barEnds.data,
				to: barEnds.to,
				blend,
				key: "id",
				category: "q",
				value: "n",
			}),
			scatter.create({
				zIndex: Z,
				data: dotEnds.data,
				to: dotEnds.to,
				blend,
				key: "id",
				x: "x",
				y: "y",
			}),
		],
	});
const swapAt = (blend: number, extra: Partial<ChartProps> = {}) =>
	build(blend, { data: sales, to: [] }, { data: [], to: points }, extra);
const backAt = (blend: number, extra: Partial<ChartProps> = {}) =>
	build(blend, { data: [], to: sales }, { data: points, to: [] }, extra);
const barsOnly = (extra: Partial<ChartProps> = {}) =>
	build(0, { data: sales }, { data: [] }, extra);
const dotsOnly = (extra: Partial<ChartProps> = {}) =>
	build(0, { data: [] }, { data: points }, extra);

const snapshot = (node: SceneNode) => {
	const scene = mount(node);
	const handle = chartHandle(node);
	const items = itemsAt(scene, Z);
	return {
		area: handle?.coords.area(),
		xRange: handle?.coords.xRange(),
		texts: texts(scene),
		marks: items
			.filter(drawn)
			.map(({ item, opacity }) => ({
				x: rounded(item.center.x - (item.halfWidth || item.radius)),
				y: rounded(item.center.y - (item.halfHeight || item.radius)),
				opacity,
			}))
			.sort((p, q) => p.x - q.x || p.y - q.y),
		/** Whether any layer item is drawn at all. */
		anyDrawn: items.some(drawn),
		lines: scene
			.shapes()
			.filter((s) => !onLayer(s.zIndex, Z) && s.polylines.length > 0).length,
	};
};
type Snapshot = ReturnType<typeof snapshot>;

describe("an axis that changes kind across a keyed transition", () => {
	const variants: [string, Partial<ChartProps>][] = [
		["the default chart", {}],
		["a grid, under autosize contain", { grid: true, autosize: "contain" }],
	];
	for (const [name, extra] of variants) {
		it(`${name}: each end is exactly its plain chart, both ways`, () => {
			expect(snapshot(swapAt(0, extra))).toEqual(snapshot(barsOnly(extra)));
			expect(snapshot(swapAt(1, extra))).toEqual(snapshot(dotsOnly(extra)));
			expect(snapshot(backAt(0, extra))).toEqual(snapshot(dotsOnly(extra)));
			expect(snapshot(backAt(1, extra))).toEqual(snapshot(barsOnly(extra)));
		});
	}

	it("cross-fades the two axes over the update stage, mapping through one at a time", () => {
		const names = (s: Snapshot) =>
			s.texts.filter((t) => t.text.startsWith("Q"));
		const numbers = (s: Snapshot, value: string) =>
			s.texts.filter((t) => t.text === value);
		// Exit [0, 1/3], update [1/3, 2/3], enter [2/3, 1].
		const early = snapshot(swapAt(0.4));
		const late = snapshot(swapAt(0.6));
		// Before the midpoint the plot maps through the band axis (slots 0..3),
		// after it through the scatter's fitted range.
		expect(early.xRange?.slice(0, 2)).toEqual([0, 3]);
		expect(late.xRange?.[0]).toBe(10);
		for (const snap of [early, late]) {
			// Both axes drawn: the category names and the far end's numbers.
			expect(names(snap)).toHaveLength(3);
			expect(numbers(snap, "30").length).toBeGreaterThan(0);
		}
		// The near end's axis fades out as the far end's fades in.
		const nameFade = (s: Snapshot) => names(s)[0]?.opacity as number;
		const numberFade = (s: Snapshot) => numbers(s, "30")[0]?.opacity as number;
		expect(nameFade(early)).toBeGreaterThan(nameFade(late));
		expect(numberFade(early)).toBeLessThan(numberFade(late));
		expect(nameFade(early) + numberFade(early)).toBeCloseTo(1, 6);
		expect(nameFade(late) + numberFade(late)).toBeCloseTo(1, 6);
		// The names stay where the band axis put them, through its own mapping.
		const plain = snapshot(barsOnly());
		expect(names(early).map((t) => t.x)).toEqual(names(plain).map((t) => t.x));
		expect(names(late).map((t) => t.x)).toEqual(names(plain).map((t) => t.x));
		// Neither layer is visible at the switch: the bars have left, the
		// points not yet arrived.
		expect(early.anyDrawn).toBe(false);
	});

	it("scrubs without re-deriving the frame's steady parts", () => {
		const layers = [
			bars.create({
				data: sales,
				to: [],
				blend: 0,
				key: "id",
				category: "q",
				value: "n",
			}),
			scatter.create({
				data: [],
				to: points,
				blend: 0,
				key: "id",
				x: "x",
				y: "y",
			}),
		];
		const { node: watcher, seen } = probe();
		const scene = mount(
			chart.create({
				width: 8,
				height: 4,
				grid: true,
				children: [...layers, watcher],
			}),
		);
		const join = seen.frame?.join;
		const fits = swapFits(seen.frame);
		expect(join).toBeDefined();
		expect(seen.frame?.ends?.x).toBe(true);
		expect(fits.fromBand).toBeDefined();
		const ranges = new Set<string>();
		for (const t of [0.1, 0.2, 0.35, 0.45, 0.55, 0.65, 0.8, 1, 0.5, 0, 1]) {
			for (const layer of layers) setBlend(layer, t);
			scene.commit();
			// The stages and each end's plot are the reports', not the blend's.
			expect(seen.frame?.join).toBe(join);
			expect(swapFits(seen.frame).fromBand).toBe(fits.fromBand);
			expect(swapFits(seen.frame).toRange).toEqual(fits.toRange);
			ranges.add(String(seen.coords?.xRange()));
		}
		// ... while the plot does switch axes; and scrubbed to the end, the
		// guides are the plain end chart's (the axes swapped node kinds in
		// their slots and back).
		expect(ranges.size).toBeGreaterThan(1);
		expect(texts(scene)).toEqual(snapshot(dotsOnly({ grid: true })).texts);
	});
});

/*
 * Marks that stay across the change: dots and a line drawn at the bars'
 * slots (`x` = slot middle) at one end and on the number line at the
 * other, while the bars leave. Each end's datum maps through its own
 * end's plot (`frame.ends`, `endSpace`) and the two blend in scene units
 * on the update stage, so nothing jumps at the stage's midpoint.
 */
describe("marks that stay across an axis's change of kind", () => {
	const BARS = 7;
	const DOTS = 8;
	const LINE = 9;
	/** The dots at the bars' slots: one per bar, on its top. */
	const onBars = sales.map((d, i) => ({ id: d.id, x: i + 0.5, y: d.n }));
	/** The same dots on a number line spanning 0, so the y axis stands at 0 there. */
	const spread = [
		{ id: "a", x: -20, y: 3 },
		{ id: "b", x: 15, y: 6 },
		{ id: "c", x: 40, y: 2 },
	];
	type Dot = (typeof onBars)[number];
	const view = (
		blend: number,
		ends: {
			bars: { data: Sale[]; to?: Sale[] };
			dots: { data: Dot[]; to?: Dot[] };
		},
		staging?: Staging,
	) =>
		chart.create({
			width: 8,
			height: 4,
			yLabel: "n",
			xLabel: "x",
			children: [
				bars.create({
					zIndex: BARS,
					data: ends.bars.data,
					to: ends.bars.to,
					blend,
					staging,
					key: "id",
					category: "q",
					value: "n",
				}),
				scatter.create({
					zIndex: DOTS,
					data: ends.dots.data,
					to: ends.dots.to,
					blend,
					staging,
					key: "id",
					x: "x",
					y: "y",
				}),
				linePlot.create({
					zIndex: LINE,
					data: ends.dots.data,
					to: ends.dots.to,
					blend,
					staging,
					x: "x",
					y: "y",
				}),
			],
		});
	const away = (blend: number, staging?: Staging) =>
		view(
			blend,
			{ bars: { data: sales, to: [] }, dots: { data: onBars, to: spread } },
			staging,
		);
	const back = (blend: number, staging?: Staging) =>
		view(
			blend,
			{ bars: { data: [], to: sales }, dots: { data: spread, to: onBars } },
			staging,
		);
	const plainBars = () =>
		view(0, { bars: { data: sales }, dots: { data: onBars } });
	const plainSpread = () =>
		view(0, { bars: { data: [] }, dots: { data: spread } });

	const state = (node: SceneNode) => {
		const scene = mount(node);
		const at = (z: number) =>
			itemsAt(scene, z)
				.filter(drawn)
				.map(({ item, opacity }) => ({
					x: rounded(item.center.x),
					y: rounded(item.center.y),
					opacity,
				}))
				.sort((p, q) => p.x - q.x || p.y - q.y);
		const linePoints = itemsAt(scene, LINE)
			.filter(({ opacity }) => opacity > 0)
			.flatMap(({ item }) => item.polylines.flat());
		const line = linePoints.length
			? [
					Math.min(...linePoints.map((p) => p.x)),
					Math.min(...linePoints.map((p) => p.y)),
					Math.max(...linePoints.map((p) => p.x)),
					Math.max(...linePoints.map((p) => p.y)),
				].map(rounded)
			: [];
		const all = texts(scene);
		const two = all.filter((t) => t.text === "2");
		return {
			area: chartHandle(node)?.coords.area(),
			bars: at(BARS),
			dots: at(DOTS),
			line,
			texts: all,
			/** Where the y axis's "2" stands: it moves with the axis. */
			yNumber: two.length ? Math.min(...two.map((t) => t.x)) : undefined,
		};
	};

	it("each end is exactly its plain chart, both ways and under both stagings", () => {
		for (const staging of ["staged", "together"] as const) {
			expect(state(away(0, staging))).toEqual(state(plainBars()));
			expect(state(away(1, staging))).toEqual(state(plainSpread()));
			expect(state(back(0, staging))).toEqual(state(plainSpread()));
			expect(state(back(1, staging))).toEqual(state(plainBars()));
		}
	});

	it("moves the dots and the line in scene units, with no jump at the midpoint", () => {
		const start = state(plainBars());
		const end = state(plainSpread());
		const jump = (a: { x: number }[], b: { x: number }[]) =>
			Math.max(...a.map((p, i) => Math.abs(p.x - (b[i]?.x as number))));
		const whole = jump(start.dots, end.dots);
		expect(whole).toBeGreaterThan(1);
		for (const staging of ["staged", "together"] as const) {
			// Either side of the update stage's midpoint (staged: the update
			// is the middle third, after the exits).
			const [before, after] =
				staging === "staged" ? [0.665, 0.669] : [0.495, 0.505];
			const a = state(away(before, staging));
			const b = state(away(after, staging));
			expect(jump(a.dots, b.dots)).toBeLessThan(whole / 20);
			// The line too: its box barely moves across the midpoint.
			expect(a.line).toHaveLength(4);
			const lineJump = Math.max(
				...a.line.map((value, i) => Math.abs(value - (b.line[i] as number))),
			);
			expect(lineJump).toBeLessThan(whole / 20);
		}
		// Halfway through the update, every dot is between its two places.
		const mid = state(away(0.5, "together"));
		mid.dots.forEach((dot, i) => {
			const from = start.dots[i]?.x as number;
			const to = end.dots[i]?.x as number;
			expect(dot.x).toBeGreaterThan(Math.min(from, to));
			expect(dot.x).toBeLessThan(Math.max(from, to));
		});
	});

	it('draws leaving bars through their own end under "together", past the midpoint', () => {
		const start = state(plainBars());
		const late = state(away(0.6, "together"));
		// Still leaving (fading), at the band axis's places, not gone at the switch.
		expect(late.bars).toHaveLength(3);
		late.bars.forEach((bar, i) => {
			expect(bar.opacity).toBeGreaterThan(0);
			expect(Math.abs(bar.x - (start.bars[i]?.x as number))).toBeLessThan(0.5);
		});
		// And arriving ones before it, at their own end's places.
		const early = state(back(0.4, "together"));
		expect(early.bars).toHaveLength(3);
		early.bars.forEach((bar, i) => {
			expect(Math.abs(bar.x - (start.bars[i]?.x as number))).toBeLessThan(0.5);
		});
	});

	it("slides the axis crossing the swapping one between its two places", () => {
		const start = state(plainBars()).yNumber as number;
		const end = state(plainSpread()).yNumber as number;
		// The number line spans 0, so the y axis stands inside the plot there.
		expect(end - start).toBeGreaterThan(1);
		const near = state(away(0.495, "together")).yNumber as number;
		const far = state(away(0.505, "together")).yNumber as number;
		expect(Math.abs(far - near)).toBeLessThan((end - start) / 20);
		const quarter = state(away(0.25, "together")).yNumber as number;
		expect(quarter).toBeGreaterThan(start);
		expect(quarter).toBeLessThan(near);
	});

	it("scrubs without re-deriving the frame's steady parts", () => {
		const layers = [
			bars.create({
				data: sales,
				to: [],
				blend: 0,
				key: "id",
				category: "q",
				value: "n",
			}),
			scatter.create({
				data: onBars,
				to: spread,
				blend: 0,
				key: "id",
				x: "x",
				y: "y",
			}),
			linePlot.create({ data: onBars, to: spread, blend: 0, x: "x", y: "y" }),
		];
		const { node: watcher, seen } = probe();
		const scene = mount(
			chart.create({
				width: 8,
				height: 4,
				grid: true,
				children: [...layers, watcher],
			}),
		);
		const join = seen.frame?.join;
		const fits = swapFits(seen.frame);
		expect(seen.frame?.ends?.x).toBe(true);
		for (const t of [0.1, 0.2, 0.35, 0.45, 0.55, 0.65, 0.8, 1, 0.5, 0, 1]) {
			for (const layer of layers) setBlend(layer, t);
			scene.commit();
			expect(seen.frame?.join).toBe(join);
			expect(swapFits(seen.frame).fromBand).toBe(fits.fromBand);
			expect(swapFits(seen.frame).toRange).toEqual(fits.toRange);
		}
	});
});

/*
 * The frame around a change of kind: a band axis crossing the swapping one
 * at `position: "zero"` slides with the crossing, and the y axis's origin
 * "0", hidden where both axes show a "0" through the origin, fades by the
 * far end's rule instead of popping when the plot switches axes.
 */
describe("the frame's crossing and origin across a change of kind", () => {
	/** Cells on two band axes, then horizontal bars: x turns continuous, spanning 0. */
	const cellRows = [
		{ id: "a", c: "u", g: "A" },
		{ id: "b", c: "v", g: "B" },
		{ id: "c", c: "w", g: "C" },
	];
	const values = [
		{ id: "a", g: "A", n: -20 },
		{ id: "b", g: "B", n: 15 },
		{ id: "c", g: "C", n: 40 },
	];
	type Cell = (typeof cellRows)[number];
	type Value = (typeof values)[number];
	const gridLayers = (
		blend: number,
		ends: { cells: Cell[]; cellsTo?: Cell[]; bars: Value[]; barsTo?: Value[] },
		staging?: Staging,
	) => [
		cellsLayer.create({
			data: ends.cells,
			to: ends.cellsTo,
			blend,
			staging,
			key: "id",
			x: "c",
			y: "g",
		}),
		bars.create({
			data: ends.bars,
			to: ends.barsTo,
			blend,
			staging,
			key: "id",
			category: "g",
			value: "n",
			orientation: "horizontal",
		}),
	];
	const grid = (
		blend: number,
		ends: { cells: Cell[]; cellsTo?: Cell[]; bars: Value[]; barsTo?: Value[] },
		staging?: Staging,
	) =>
		chart.create({
			width: 8,
			height: 4,
			yAxis: { position: "zero" },
			children: gridLayers(blend, ends, staging),
		});
	const across = (blend: number, staging?: Staging) =>
		grid(
			blend,
			{ cells: cellRows, cellsTo: [], bars: [], barsTo: values },
			staging,
		);
	const plainCells = () => grid(0, { cells: cellRows, bars: [] });
	const plainBars = () => grid(0, { cells: [], bars: values });
	/** Where the band y axis's names stand (their common x), and every text. */
	const names = (node: SceneNode) => {
		const all = texts(mount(node));
		const own = all.filter((t) => ["A", "B", "C"].includes(t.text));
		return { at: own.length ? own[0]?.x : undefined, own, all };
	};

	it('a band axis at "zero": each end is its plain chart, and it slides with no jump', () => {
		expect(names(across(0)).all).toEqual(names(plainCells()).all);
		expect(names(across(1)).all).toEqual(names(plainBars()).all);
		const start = names(plainCells()).at as number;
		const end = names(plainBars()).at as number;
		// The number line spans 0, so the names stand inside the plot there.
		expect(end - start).toBeGreaterThan(1);
		for (const staging of ["staged", "together"] as const) {
			// Staged, the update (the middle third) is eased: steepest at its midpoint.
			const [before, after] =
				staging === "staged" ? [0.499, 0.501] : [0.495, 0.505];
			const a = names(across(before, staging));
			const b = names(across(after, staging));
			expect(Math.abs((b.at as number) - (a.at as number))).toBeLessThan(
				(end - start) / 20,
			);
			// One line: every name on it.
			expect(new Set(a.own.map((t) => t.x)).size).toBe(1);
		}
		const quarter = names(across(0.25, "together")).at as number;
		expect(quarter).toBeGreaterThan(start);
		expect(quarter).toBeLessThan(end);
	});

	/** Bars on a band x, then dots on a number line spanning 0: the y "0" is hidden at the end. */
	const onBars = sales.map((d, i) => ({ id: d.id, x: i + 0.5, y: d.n }));
	const spread = [
		{ id: "a", x: -20, y: 3 },
		{ id: "b", x: 15, y: 6 },
		{ id: "c", x: 40, y: 2 },
	];
	const awayLayers = (blend: number, staging?: Staging) => [
		bars.create({
			data: sales,
			to: [],
			blend,
			staging,
			key: "id",
			category: "q",
			value: "n",
		}),
		scatter.create({
			data: onBars,
			to: spread,
			blend,
			staging,
			key: "id",
			x: "x",
			y: "y",
		}),
	];
	/** The "0"s: the y axis's (level with the plot's bottom, y = 0) and the x axis's (under it). */
	const zeros = (blend: number) => {
		const node = chart.create({
			width: 8,
			height: 4,
			children: awayLayers(blend, "together"),
		});
		const scene = mount(node);
		const bottom = chartHandle(node)?.coords.area().minY as number;
		const all = texts(scene).filter((t) => t.text === "0");
		const y = all.filter((t) => Math.abs(t.y - bottom) < 1e-6);
		const x = all.filter((t) => Math.abs(t.y - bottom) >= 1e-6);
		return { y: y[0], x: x[0], count: y.length };
	};

	it('fades the y axis\'s origin "0" through the swap instead of popping at the midpoint', () => {
		// Plain ends: shown beside the band axis, hidden at the origin.
		expect(zeros(0).y?.opacity).toBe(1);
		expect(zeros(1).count).toBe(0);
		const a = zeros(0.495);
		const b = zeros(0.505);
		expect(a.count).toBe(1);
		expect(b.count).toBe(1);
		expect(
			Math.abs((a.y?.opacity as number) - (b.y?.opacity as number)),
		).toBeLessThan(0.05);
		expect(Math.abs((a.y?.x as number) - (b.y?.x as number))).toBeLessThan(0.1);
		// It fades as the x axis's "0" (where it would stand) fades in, and
		// further as the x line arrives through its own spot: never more than
		// the rest of the way.
		for (const t of [0.25, 0.495, 0.505, 0.75]) {
			const own = zeros(t);
			expect(
				(own.y?.opacity as number) + (own.x?.opacity as number),
			).toBeLessThanOrEqual(1 + 1e-9);
		}
		expect(zeros(0.25).y?.opacity).toBeGreaterThan(
			zeros(0.75).y?.opacity as number,
		);
	});

	it("keeps a swapping y axis's origin \"0\" hidden all through, and fades x's out as its line arrives", () => {
		const both = [
			{ id: "a", x: -2, y: -4 },
			{ id: "b", x: 3, y: 5 },
			{ id: "c", x: 5, y: 2 },
		];
		let last = Number.POSITIVE_INFINITY;
		for (const t of [0, 0.25, 0.495, 0.505, 0.75, 1]) {
			const scene = mount(
				chart.create({
					width: 8,
					height: 4,
					children: [
						bars.create({
							data: sales,
							to: [],
							blend: t,
							staging: "together",
							key: "id",
							category: "q",
							value: "n",
							orientation: "horizontal",
						}),
						scatter.create({
							data: [],
							to: both,
							blend: t,
							staging: "together",
							key: "id",
							x: "x",
							y: "y",
						}),
					],
				}),
			);
			// At most the x axis's "0": the y axis's never shows at its continuous
			// end. At that end the y line runs on below 0, through x's, so x's
			// fades out as the end comes in, with no jump, and is gone there.
			const zeros = texts(scene).filter((s) => s.text === "0");
			expect(zeros.length).toBeLessThanOrEqual(1);
			const opacity = zeros[0]?.opacity ?? 0;
			expect(opacity).toBeLessThanOrEqual(last);
			if (t > 0 && t < 1) expect(last - opacity).toBeLessThan(0.3);
			last = opacity;
		}
		expect(last).toBe(0);
	});

	it("scrubs without re-deriving either end's plot", () => {
		const first = awayLayers(0);
		const second = gridLayers(0, {
			cells: cellRows,
			cellsTo: [],
			bars: [],
			barsTo: values,
		});
		const watchers = [probe(), probe()];
		const scene = mount(
			chart.create({
				width: 8,
				height: 4,
				children: [...first, (watchers[0] as ReturnType<typeof probe>).node],
			}),
			chart.create({
				width: 8,
				height: 4,
				yAxis: { position: "zero" },
				children: [...second, (watchers[1] as ReturnType<typeof probe>).node],
			}),
		);
		expect(watchers.every((w) => w.seen.frame?.ends?.x)).toBe(true);
		const fits = watchers.map((w) => swapFits(w.seen.frame));
		const joins = watchers.map((w) => w.seen.frame?.join);
		for (const t of [0.1, 0.2, 0.35, 0.45, 0.55, 0.65, 0.8, 1, 0.5, 0, 1]) {
			for (const layer of [...first, ...second]) setBlend(layer, t);
			scene.commit();
			watchers.forEach((w, i) => {
				expect(w.seen.frame?.join).toBe(joins[i]);
				expect(swapFits(w.seen.frame).fromBand).toBe(fits[i]?.fromBand);
				expect(swapFits(w.seen.frame).toRange).toEqual(fits[i]?.toRange);
			});
		}
	});
});
