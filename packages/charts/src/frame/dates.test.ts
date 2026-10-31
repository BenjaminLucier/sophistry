/**
 * Native `Date`s and Temporal values on positional channels: read as epoch
 * milliseconds at the channel layer (so every mark and transform sees
 * numbers), a UTC time axis inferred under a `chart` whose axis names no
 * scale, an explicit scale winning, `Date` ends on a fixed range, tips
 * written as dates, keyed transitions between dated rows, and axes on
 * another zone's clock (`timeZone`). Temporal values are hand-built
 * structural fakes: sophistry never needs Temporal itself.
 */

import type { SceneNode } from "@sophistry/core";
import type { Polyline } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { ruleX } from "../bars/rules";
import { bin, group, stack, summarize } from "../bars/transforms";
import type { ChartHandle, ChartProps } from "../chart";
import { chart, chartHandle } from "../chart";
import { linePlot } from "../curves/line-plot";
import { channelValues, numberValues, resolveChannel } from "../data/channels";
import { secondaryY } from "../guides";
import { rects } from "../points/rects";
import { scatter } from "../points/scatter";
import { markItems, mount } from "../test-harness";

type View = ReturnType<typeof mount>;

const DAY = 86_400_000;
/** UTC midnight on 2024-01-01 + `days`, as a `Date` and as epoch ms. */
const day = (days: number) => new Date(Date.UTC(2024, 0, 1 + days));
const ms = (days: number) => day(days).getTime();

const dated = [0, 31, 60, 91].map((d, i) => ({
	t: day(d),
	v: [3, 5, 4, 7][i] as number,
}));
const numeric = dated.map((r) => ({ t: r.t.getTime(), v: r.v }));

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;
const boxOf = (lines: readonly Polyline[]) => {
	const points = lines.flat();
	return [
		Math.min(...points.map((p) => p.x)),
		Math.min(...points.map((p) => p.y)),
		Math.max(...points.map((p) => p.x)),
		Math.max(...points.map((p) => p.y)),
	].map(rounded);
};
/** What a view draws, comparable across mounts: its text, shape boxes and batched items. */
const picture = (view: View) => ({
	texts: view.texts().map((t) => t.text),
	boxes: view
		.shapes()
		.map((s) =>
			boxOf(
				s.polylines.map((line) =>
					Array.isArray(line)
						? line
						: (line as unknown as { points: Polyline }).points,
				),
			),
		),
	items: view.marks().flatMap((spec) =>
		markItems(spec).map((item) => ({
			center: [item.center.x, item.center.y].map(rounded),
			size: [item.halfWidth, item.halfHeight].map(rounded),
			outline: item.polylines.length > 0 ? boxOf(item.polylines) : [],
		})),
	),
});
const words = (view: View) => view.texts().map((t) => t.text);

/** An 8 × 4 chart, mounted, with its handle. */
function plot(props: Partial<ChartProps>, ...children: SceneNode[]) {
	const node = chart.create({ width: 8, height: 4, ...props, children });
	const view = mount(node);
	return Object.assign(view, {
		node,
		handle: chartHandle(node) as ChartHandle,
	});
}

/** The tooltip labels of a batched layer's items (its instances node's `shared.itemLabel`). */
function itemLabels(layer: SceneNode, count: number): (string | undefined)[] {
	const find = (node: SceneNode): SceneNode | undefined => {
		let shared: { itemLabel?: unknown } | undefined;
		try {
			shared = node.get("shared" as never);
		} catch {
			// Not an instances node: no `shared` prop.
		}
		if (typeof shared?.itemLabel === "function") return node;
		for (const child of (node as { children?: readonly SceneNode[] })
			.children ?? []) {
			const hit = find(child);
			if (hit) return hit;
		}
		return undefined;
	};
	const batch = find(layer);
	const shared = batch?.get("shared" as never) as unknown as
		| { itemLabel: (item: number) => string | undefined }
		| undefined;
	return Array.from({ length: count }, (_, i) => shared?.itemLabel(i));
}

describe("Date channels", () => {
	it("read as epoch milliseconds, by key or by function", () => {
		const rows = [{ t: day(0) }, { t: new Date(Number.NaN) }];
		expect(
			resolveChannel<{ t: Date }, Date>("t")(rows[0] as { t: Date }, 0),
		).toBe(ms(0));
		expect(
			resolveChannel<{ t: Date }, Date>((d) => new Date(d.t))(
				rows[0] as { t: Date },
				0,
			),
		).toBe(ms(0));
		expect(numberValues(rows, "t")).toEqual([ms(0), Number.NaN]);
		// Every channel, keys too: dates key by instant.
		expect(channelValues([{ k: day(1) }], "k")).toEqual([ms(1)]);
		// Strings are not parsed: an ISO string is not a number.
		expect(
			numberValues([{ t: "2024-01-01" }], (d) => d.t as unknown as number),
		).toEqual([Number.NaN]);
	});

	it("make an axis with no scale named a UTC time axis", () => {
		const fromDates = plot(
			{},
			linePlot.create({ data: dated, x: "t", y: "v" }),
		);
		const fromTime = plot(
			{ xAxis: { scale: "utc" } },
			linePlot.create({ data: numeric, x: "t", y: "v" }),
		);
		const fromLinear = plot(
			{},
			linePlot.create({ data: numeric, x: "t", y: "v" }),
		);
		expect(picture(fromDates)).toEqual(picture(fromTime));
		expect(words(fromDates)).not.toEqual(words(fromLinear));
		expect(words(fromDates)).toEqual(expect.arrayContaining(["February"]));
	});

	it("leave a named scale alone", () => {
		const utc = plot(
			{ xAxis: { scale: "time" } },
			scatter.create({ data: dated, x: "t", y: "v" }),
		);
		const utcNumbers = plot(
			{ xAxis: { scale: "time" } },
			scatter.create({ data: numeric, x: "t", y: "v" }),
		);
		expect(picture(utc)).toEqual(picture(utcNumbers));
		const linear = plot(
			{ xAxis: { scale: "linear" } },
			scatter.create({ data: dated, x: "t", y: "v" }),
		);
		const linearNumbers = plot(
			{},
			scatter.create({ data: numeric, x: "t", y: "v" }),
		);
		expect(picture(linear)).toEqual(picture(linearNumbers));
	});

	it("infer time on y, on interval marks, and on a secondary axis", () => {
		const onY = plot({}, scatter.create({ data: dated, x: "v", y: "t" }));
		const onYTime = plot(
			{ yAxis: { scale: "utc" } },
			scatter.create({ data: numeric, x: "v", y: "t" }),
		);
		expect(picture(onY)).toEqual(picture(onYTime));

		const spans = [{ from: day(0), to: day(40), lo: 0, hi: 1 }];
		const withDates = plot(
			{ yRange: [0, 2] },
			rects.create({ data: spans, x1: "from", x2: "to", y1: "lo", y2: "hi" }),
			ruleX.create({ data: [day(20)], x: (d: unknown) => d as Date }),
		);
		const withTime = plot(
			{ yRange: [0, 2], xAxis: { scale: "utc" } },
			rects.create({
				data: spans.map((s) => ({
					...s,
					from: s.from.getTime(),
					to: s.to.getTime(),
				})),
				x1: "from",
				x2: "to",
				y1: "lo",
				y2: "hi",
			}),
			ruleX.create({ data: [ms(20)], x: (d: unknown) => d as number }),
		);
		expect(picture(withDates)).toEqual(picture(withTime));

		const secondary = plot(
			{},
			scatter.create({ data: numeric, x: "v", y: "v" }),
			secondaryY.create({
				children: [scatter.create({ data: dated, x: "v", y: "t" })],
			}),
		);
		const secondaryTime = plot(
			{ y2Axis: { scale: "utc" } },
			scatter.create({ data: numeric, x: "v", y: "v" }),
			secondaryY.create({
				children: [scatter.create({ data: numeric, x: "v", y: "t" })],
			}),
		);
		// The primary y stays linear; only the secondary turns to time.
		expect(picture(secondary)).toEqual(picture(secondaryTime));
	});

	it("refit when the data turns to dates", () => {
		const layer = linePlot.create({
			data: numeric as readonly { t: number | Date; v: number }[],
			x: "t",
			y: "v",
		});
		const view = plot({}, layer);
		const before = words(view);
		layer.set("data", dated);
		view.commit();
		expect(words(view)).not.toEqual(before);
		expect(words(view)).toEqual(expect.arrayContaining(["February"]));
	});

	it("take `Date` ends on a fixed range", () => {
		const withDates = plot(
			{ xRange: [day(0), day(120)] },
			linePlot.create({ data: dated, x: "t", y: "v" }),
		);
		const withNumbers = plot(
			{ xRange: [ms(0), ms(120)], xAxis: { scale: "utc" } },
			linePlot.create({ data: numeric, x: "t", y: "v" }),
		);
		expect(picture(withDates)).toEqual(picture(withNumbers));
	});

	it("move a keyed marker between dated rows in data units", () => {
		const from = [{ id: "a", t: day(0), v: 1 }];
		const to = [{ id: "a", t: day(10), v: 3 }];
		const view = plot(
			{ xRange: [day(0), day(10)], yRange: [0, 4] },
			scatter.create({
				data: from,
				to,
				blend: 0.5,
				key: "id",
				x: "t",
				y: "v",
				radius: 0.1,
			}),
		);
		const [marker] = view.marks().flatMap((spec) => markItems(spec));
		expect(marker).toBeDefined();
		const mid = view.handle.coords.coordsToPoint(ms(5), 2);
		expect(marker?.center.x).toBeCloseTo(mid.x);
		expect(marker?.center.y).toBeCloseTo(mid.y);
	});
});

describe("Date transforms", () => {
	// Distinct `Date` objects for the same instant group together.
	const rows = [
		{ t: day(0), z: "a", n: 1 },
		{ t: day(0), z: "b", n: 2 },
		{ t: day(1), z: "a", n: 3 },
		{ t: day(1), z: "b", n: 4 },
	];

	it("stack, group and summarize by instant", () => {
		const stacked = stack(rows, { x: "t", y: "n", z: "z" });
		expect(stacked.map((r) => [r.x, r.y1, r.y2])).toEqual([
			[ms(0), 0, 1],
			[ms(0), 1, 3],
			[ms(1), 0, 3],
			[ms(1), 3, 7],
		]);
		expect(
			group(rows, { by: "t", y: "n", reduce: "sum" }).map((r) => [r.x, r.y]),
		).toEqual([
			[ms(0), 3],
			[ms(1), 7],
		]);
		expect(summarize(rows, { x: "t", y: "n" }).map((r) => [r.x, r.y])).toEqual([
			[ms(0), 1.5],
			[ms(1), 3.5],
		]);
	});

	it("bin dates in spans of milliseconds", () => {
		const bins = bin(rows, { x: "t", binCount: 2 });
		expect(bins.map((b) => [b.x1, b.x2, b.y])).toEqual([
			[ms(0), ms(0) + DAY / 2, 2],
			[ms(0) + DAY / 2, ms(1), 2],
		]);
	});
});

describe("Date tips", () => {
	it("write a dated datum through the inferred time axis", () => {
		const layer = scatter.create({
			data: dated.slice(0, 2),
			x: "t",
			y: "v",
			tooltip: true,
		});
		plot({}, layer);
		expect(itemLabels(layer, 2)).toEqual([
			"t: Jan 1, 2024, v: 3",
			"t: Feb 1, 2024, v: 5",
		]);
	});
});

const NY = "America/New_York";
const instant = (at: number) => ({
	epochMilliseconds: at,
	[Symbol.toStringTag]: "Temporal.Instant" as const,
});
const plainDate = (year: number, month: number, d: number) => ({
	year,
	month,
	day: d,
	[Symbol.toStringTag]: "Temporal.PlainDate" as const,
});

describe("Temporal channels", () => {
	it("read instants and zoned date-times by their epoch milliseconds", () => {
		const zoned = dated.map((r) => ({
			t: {
				epochMilliseconds: r.t.getTime(),
				[Symbol.toStringTag]: "Temporal.ZonedDateTime" as const,
			},
			v: r.v,
		}));
		expect(numberValues(zoned, "t")).toEqual(numeric.map((r) => r.t));
		const fromTemporal = plot(
			{},
			linePlot.create({ data: zoned, x: "t", y: "v" }),
		);
		const fromDates = plot(
			{},
			linePlot.create({ data: dated, x: "t", y: "v" }),
		);
		expect(picture(fromTemporal)).toEqual(picture(fromDates));
		const instants = plot(
			{ xRange: [instant(ms(0)), instant(ms(120))] },
			scatter.create({ data: dated, x: "t", y: "v" }),
		);
		const numbers = plot(
			{ xRange: [ms(0), ms(120)], xAxis: { scale: "utc" } },
			scatter.create({ data: numeric, x: "t", y: "v" }),
		);
		expect(picture(instants)).toEqual(picture(numbers));
	});

	it("place plain dates at midnight in the axis's zone", () => {
		const days = [plainDate(2024, 3, 9), plainDate(2024, 3, 12)];
		// Outside a chart, and on a UTC axis: UTC midnight.
		expect(numberValues(days, (d) => d)).toEqual([
			Date.UTC(2024, 2, 9),
			Date.UTC(2024, 2, 12),
		]);
		const zoned = plot(
			{ xAxis: { timeZone: NY } },
			scatter.create({
				data: days,
				x: (d: unknown) => d as never,
				y: (_d: unknown, i: number) => i,
			}),
		);
		const asInstants = plot(
			{ xAxis: { scale: "utc", timeZone: NY } },
			scatter.create({
				data: [Date.UTC(2024, 2, 9, 5), Date.UTC(2024, 2, 12, 4)],
				x: (d: unknown) => d as number,
				y: (_d: unknown, i: number) => i,
			}),
		);
		expect(picture(zoned)).toEqual(picture(asInstants));
	});
});

describe("Time zone axes", () => {
	const week = [0, 1, 2, 3, 4, 5].map((i) => ({
		// Midnight in New York, 2024-03-08 + i: across the spring change.
		t: new Date(Date.UTC(2024, 2, 8 + i, i < 2 ? 5 : 4)),
		v: i,
	}));

	it("tick and label on the zone's midnights", () => {
		const ny = plot(
			{ xAxis: { timeZone: NY, nice: false } },
			scatter.create({ data: week, x: "t", y: "v" }),
		);
		expect(words(ny)).toEqual(
			expect.arrayContaining(["Sat 09", "Mar 10", "Mon 11"]),
		);
		// In UTC the same instants sit off midnight, so the ticks differ.
		const utc = plot(
			{ xAxis: { nice: false } },
			scatter.create({ data: week, x: "t", y: "v" }),
		);
		expect(picture(utc)).not.toEqual(picture(ny));
	});

	it("write tips on the zone's clock", () => {
		const rows = [
			{ t: new Date(Date.UTC(2024, 0, 1, 5)), v: 1 },
			{ t: new Date(Date.UTC(2024, 6, 4, 13, 30)), v: 2 },
		];
		const layer = scatter.create({
			data: rows,
			x: "t",
			y: "v",
			tooltip: true,
		});
		plot({ xAxis: { timeZone: NY } }, layer);
		expect(itemLabels(layer, 2)).toEqual([
			"t: Jan 1, 2024, v: 1",
			"t: Jul 4, 2024, 09:30, v: 2",
		]);
	});
});
