/**
 * Chart tooltips: the default rows (one per bound channel, each written as
 * the chart's axes and legend write it), the ways to change them (`tooltip`
 * as a template, a function, `{ format, content }`; `chart`'s `tooltip` for
 * every layer or none), where the panel goes (following a hovering pointer,
 * flipped and clamped inside the view; above the datum for a tap or a key),
 * and the shared nearest-x tip with its crosshair.
 *
 * Batched layers have one interactive node; its items' names are `shared.itemLabel(item)` and its handlers take `event.item`.
 * The pointer is a `pointerContext` track provided above the chart, which
 * the chart binds its tooltip overlay to.
 */

import type {
	Readable,
	SceneNode,
	ScenePointer,
	ScenePointerEvent,
	Track,
} from "@sophistry/core";
import { pointerContext, track } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { bars } from "../bars/bars";
import type { ChartHandle, ChartProps } from "../chart";
import { chart, chartHandle } from "../chart";
import { linePlot } from "../curves/line-plot";
import { scatter } from "../points/scatter";
import { mount } from "../test-harness";
import type { TooltipConfig, TooltipField } from "../tooltip";
import {
	createTooltipState,
	nearestX,
	nearestXIndex,
	placeTooltip,
	tooltipText,
} from "../tooltip";

const DAY = 86_400_000;
const JAN_1 = Date.UTC(2024, 0, 1);

/** The handlers and item names a batched layer's interactive node carries. */
interface ItemHandlers {
	onEnter?: (event: ScenePointerEvent) => void;
	onLeave?: (event: ScenePointerEvent) => void;
	onTap?: (event: ScenePointerEvent) => void;
	itemLabel?: (item: number) => string | undefined;
}

/** Reads a prop a node may not have. */
const tryGet = (node: SceneNode, key: string): unknown => {
	try {
		return node.get(key as never);
	} catch {
		return undefined;
	}
};

/** The interactive handlers of the batched node under `layer` (instances' `shared`, or a path batch's own props), or `{}`. */
function itemHandlers(layer: SceneNode): ItemHandlers {
	const of = (node: SceneNode): ItemHandlers | undefined => {
		const shared = tryGet(node, "shared") as ItemHandlers | undefined;
		if (shared && (shared.itemLabel || shared.onEnter)) return shared;
		const own = tryGet(node, "itemLabel");
		if (typeof own === "function")
			return {
				itemLabel: own as ItemHandlers["itemLabel"],
				onEnter: tryGet(node, "onEnter") as ItemHandlers["onEnter"],
				onLeave: tryGet(node, "onLeave") as ItemHandlers["onLeave"],
				onTap: tryGet(node, "onTap") as ItemHandlers["onTap"],
			};
		for (const child of (node as { children?: readonly SceneNode[] })
			.children ?? []) {
			const found = of(child);
			if (found) return found;
		}
		return undefined;
	};
	return of(layer) ?? {};
}

/** Every item's accessible name; empty when the layer has no tooltips. */
function labels(layer: SceneNode, count: number): (string | undefined)[] {
	const { itemLabel } = itemHandlers(layer);
	if (!itemLabel) return [];
	return Array.from({ length: count }, (_, i) => itemLabel(i));
}

/** A 6 × 3 chart under a pointer the test drives, mounted. */
function mountChart(props: Partial<ChartProps>, ...children: SceneNode[]) {
	const view = mount();
	const pointer: Track<ScenePointer | null> = track<ScenePointer | null>(null);
	view.graph.root.provide(
		pointerContext,
		pointer as Readable<ScenePointer | null>,
	);
	const node = chart.create({ width: 6, height: 3, ...props, children });
	view.graph.root.add(node);
	view.commit();
	/** Moves the pointer to `scene` and commits. */
	const point = (scene: Point, id: number | null = 1) => {
		pointer.set({ canonical: { x: 0, y: 0 }, scene, id, camera: -1 });
		view.commit();
	};
	const textSpec = (text: string) =>
		view.texts().find((spec) => spec.text === text);
	return Object.assign(view, {
		node,
		handle: chartHandle(node) as ChartHandle,
		point,
		textSpec,
	});
}

/** A hovering mouse on item `item`, as the driver hands it over. */
const mouse = (item: number) =>
	({
		pointerId: 1,
		native: { pointerType: "mouse" },
		item,
	}) as unknown as ScenePointerEvent;

const fields: TooltipField[] = [
	{ channel: "x", of: "day", value: 2 },
	{ channel: "y", of: (d: { v: number }) => d.v, value: 0.5 },
	{ channel: "series", value: undefined },
];

describe("tooltipText", () => {
	it("true gives a row per bound channel, named by its key, dropping unset ones", () => {
		expect(tooltipText(true, () => fields, {}, 0)).toEqual([
			{ channel: "x", name: "day", value: "2", raw: 2 },
			{ channel: "y", name: "y", value: "0.5", raw: 0.5 },
		]);
	});

	it("formats through the mark's, then the chart's, then the field's own format", () => {
		const state = createTooltipState(() => ({
			all: false,
			format: { x: (v) => `chart ${v}`, y: (v) => `chart ${v}` },
		}));
		const own: TooltipField[] = [
			{ ...(fields[0] as TooltipField), format: (v) => `axis ${v}` },
			{ ...(fields[1] as TooltipField), format: (v) => `axis ${v}` },
		];
		const rows = tooltipText(
			{ format: { y: (v) => `mark ${v}` } },
			() => own,
			{},
			0,
			state,
		);
		expect(rows).toMatchObject([{ value: "chart 2" }, { value: "mark 0.5" }]);
		expect(tooltipText(true, () => own, {}, 0)).toMatchObject([
			{ value: "axis 2" },
			{ value: "axis 0.5" },
		]);
	});

	it("a string is a template over the rows; a function is your text; content rewrites", () => {
		expect(tooltipText("{x} → {y} ({nope})", () => fields, {}, 0)).toBe(
			"2 → 0.5 ({nope})",
		);
		expect(
			tooltipText(
				(_, i) => `#${i}`,
				() => fields,
				{},
				3,
			),
		).toBe("#3");
		expect(
			tooltipText(
				{ content: (rows) => rows.filter((r) => r.channel === "y") },
				() => fields,
				{},
				0,
			),
		).toMatchObject([{ channel: "y" }]);
	});

	it("keeps a mark's sentence as it was, and offers it to a template as {text}", () => {
		expect(tooltipText(true, () => "a: 1", {}, 0)).toBe("a: 1");
		expect(tooltipText("[{text}]", () => "a: 1", {}, 0)).toBe("[a: 1]");
	});

	it("chart tooltip turns every mark on, or off; a mark's own tooltip still wins", () => {
		const on = createTooltipState(() => ({ all: true }));
		const off = createTooltipState(() => false);
		const shared = createTooltipState(
			(): TooltipConfig => ({ all: true, mode: "x" }),
		);
		expect(tooltipText(undefined, () => "a", {}, 0, on)).toBe("a");
		expect(tooltipText(false, () => "a", {}, 0, on)).toBeUndefined();
		expect(tooltipText(true, () => "a", {}, 0, off)).toBeUndefined();
		// The shared tip replaces the marks' own.
		expect(tooltipText(true, () => "a", {}, 0, shared)).toBeUndefined();
		expect(tooltipText(undefined, () => "a", {}, 0)).toBeUndefined();
	});
});

describe("placeTooltip", () => {
	const frame = { minX: -8, minY: -4.5, maxX: 8, maxY: 4.5 };
	const size = { width: 2, height: 1 };

	it("centres the panel just above the point", () => {
		const box = placeTooltip(size, { x: 0, y: 0 }, frame, "above", 0.2);
		expect(box).toEqual({ minX: -1, maxX: 1, minY: 0.2, maxY: 1.2 });
	});

	it("flips below near the top and is kept inside the sides", () => {
		const box = placeTooltip(size, { x: 7.8, y: 4 }, frame, "above", 0.2);
		expect(box.maxY).toBeCloseTo(3.8);
		expect(box.maxX).toBe(8);
	});

	it("beside the point, flips to the left near the right edge", () => {
		expect(placeTooltip(size, { x: 0, y: 0 }, frame, "right", 0.2).minX).toBe(
			0.2,
		);
		expect(placeTooltip(size, { x: 7, y: 0 }, frame, "right", 0.2).maxX).toBe(
			6.8,
		);
	});
});

describe("nearestX", () => {
	it("takes every point at the scene x nearest the pointer", () => {
		const row = { channel: "y", name: "", value: "" };
		const at = (x: number, y: number) => ({ at: { x, y }, x: `${x}`, row });
		const found = nearestX([at(0, 1), at(1, 2), at(1, 5), at(3, 0)], 1.4);
		expect(found?.x).toBe(1);
		expect(found?.points).toHaveLength(2);
		expect(nearestX([], 0)).toBeUndefined();
	});

	it("answers as a scan over every point does: ties, gaps and the group", () => {
		const row = { channel: "y", name: "", value: "" };
		// Repeated xs, an x within a hair of another, non-finite positions.
		const xs = [2, 0, 1, 1 + 1e-7, 3, 1, Number.NaN, 2, 5, -1, 4, 3];
		const ys = [1, 2, Number.NaN, 4, 5, 6, 7, Infinity, 9, 0, 1, 2];
		const points = xs.map((x, i) => ({
			at: { x, y: ys[i] as number },
			x: `${i}`,
			row,
		}));
		const scan = (x: number) => {
			let best: number | undefined;
			for (const point of points) {
				if (!Number.isFinite(point.at.x) || !Number.isFinite(point.at.y))
					continue;
				if (best === undefined || Math.abs(point.at.x - x) < Math.abs(best - x))
					best = point.at.x;
			}
			if (best === undefined) return undefined;
			const at = best;
			return {
				x: at,
				points: points.filter((point) => Math.abs(point.at.x - at) < 1e-6),
			};
		};
		const query = nearestXIndex(points);
		for (const x of [-5, -1, -0.5, 0, 0.5, 1, 1.5, 2.5, 3.5, 4.5, 9, NaN]) {
			expect(query(x)).toEqual(scan(x));
		}
		expect(query(Infinity)).toEqual(scan(Infinity));
		expect(nearestXIndex([])(0)).toBeUndefined();
	});
});

const days = [
	{ day: JAN_1, temp: 3, kind: "low" },
	{ day: JAN_1 + DAY, temp: 7.25, kind: "low" },
	{ day: JAN_1, temp: 9, kind: "high" },
	{ day: JAN_1 + DAY, temp: 12, kind: "high" },
];

describe("chart tips", () => {
	it("writes each channel as its axis and the legend do", () => {
		const layer = scatter.create({
			data: days.slice(0, 2),
			x: "day",
			y: "temp",
			series: "kind",
			tooltip: true,
		});
		mountChart(
			{
				xAxis: { scale: "utc" },
				yAxis: { tickFormat: ".1f" },
				color: { label: (key) => String(key).toUpperCase() },
			},
			layer,
		);
		expect(labels(layer, 2)).toEqual([
			"day: Jan 1, 2024, temp: 3.0, kind: LOW",
			"day: Jan 2, 2024, temp: 7.3, kind: LOW",
		]);
	});

	it("names a bar's category as its band axis does", () => {
		const layer = bars.create({
			data: [
				{ q: 1, n: 4 },
				{ q: 2, n: 6 },
			],
			category: "q",
			value: "n",
			tooltip: true,
		});
		mountChart({ xAxis: { categoryLabel: (key) => `Q${key}` } }, layer);
		expect(labels(layer, 2)).toEqual(["q: Q1, n: 4", "q: Q2, n: 6"]);
	});

	it("tooltip on the chart turns on every layer's; false turns them off", () => {
		const on = scatter.create({ data: days.slice(0, 1), x: "day", y: "temp" });
		mountChart({ tooltip: { format: { y: (v) => `${v}°` } } }, on);
		expect(labels(on, 1)).toEqual([`day: ${JAN_1}, temp: 3°`]);
		const off = scatter.create({
			data: days.slice(0, 1),
			x: "day",
			y: "temp",
			tooltip: true,
		});
		mountChart({ tooltip: false }, off);
		expect(labels(off, 1)).toEqual([]);
		expect(itemHandlers(off).onEnter).toBeUndefined();
	});

	it("a hovered tooltip follows the pointer; a tap stands above the datum", () => {
		const layer = scatter.create({
			data: [{ x: 5, y: 5 }],
			x: "x",
			y: "y",
			tooltip: "at {x}",
		});
		const view = mountChart({ xRange: [0, 10], yRange: [0, 10] }, layer);
		view.point({ x: -1, y: -1 });
		itemHandlers(layer).onEnter?.(mouse(0));
		view.commit();
		const first = view.textSpec("at 5");
		expect(first?.at.x).toBeCloseTo(-1);
		expect(first?.at.y).toBeGreaterThan(-1);
		view.point({ x: 1, y: -0.5 });
		expect(view.textSpec("at 5")?.at.x).toBeCloseTo(1);
		itemHandlers(layer).onLeave?.(mouse(0));
		view.commit();
		expect(view.textSpec("at 5")).toBeUndefined();
		// A tap (or Enter on the focused marker) opens it over the marker,
		// wherever the pointer is: the marker is at the plot's centre.
		itemHandlers(layer).onTap?.({
			pointerId: -1,
			item: 0,
		} as unknown as ScenePointerEvent);
		view.commit();
		expect(view.textSpec("at 5")?.at.x).toBeCloseTo(0);
		expect(view.textSpec("at 5")?.at.y).toBeGreaterThan(0);
	});

	it('anchor: "datum" keeps a hovered tooltip over its datum', () => {
		const layer = scatter.create({
			data: [{ x: 5, y: 5 }],
			x: "x",
			y: "y",
			tooltip: "here",
		});
		const view = mountChart(
			{ xRange: [0, 10], yRange: [0, 10], tooltip: { anchor: "datum" } },
			layer,
		);
		view.point({ x: -2, y: -1 });
		itemHandlers(layer).onEnter?.(mouse(0));
		view.commit();
		expect(view.textSpec("here")?.at.x).toBeCloseTo(0);
	});

	it('mode: "x" shares one tooltip for every line at the nearest x, with a crosshair', () => {
		const dots = scatter.create({
			data: days,
			x: "day",
			y: "temp",
			tooltip: true,
		});
		const view = mountChart(
			{
				xAxis: { scale: "utc" },
				tooltip: { mode: "x", format: { y: (v) => `${v} °C` } },
			},
			linePlot.create({ data: days, x: "day", y: "temp", series: "kind" }),
			dots,
		);
		// The marks' own tips are off: the shared tip answers instead.
		expect(labels(dots, 4).filter(Boolean)).toHaveLength(0);
		const before = view.shapes().length;
		// Just short of the second day.
		view.point(view.handle.coords.coordsToPoint(JAN_1 + 0.8 * DAY, 8), null);
		const shown = view.texts().map((t) => t.text);
		expect(shown).toContain("Jan 2, 2024");
		expect(shown).toEqual(
			expect.arrayContaining(["low", "7.25 °C", "high", "12 °C", "temp"]),
		);
		expect(shown).not.toContain("Jan 1, 2024");
		// A crosshair, a dot per point, a panel and its swatches.
		expect(view.shapes().length).toBeGreaterThan(before + 3);
		// Off the plot, nothing.
		view.point({ x: 7, y: 0 }, null);
		expect(view.texts().map((t) => t.text)).not.toContain("Jan 2, 2024");
	});
});
