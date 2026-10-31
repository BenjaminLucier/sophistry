/**
 * The segment and dot marks: `rug`, `strip`, `beeswarm`, `tickX` / `tickY`,
 * `stem`, `eventPlot`, plus `rects`, `labels`, `links` / `vectors`. Read off
 * the batched items.
 */

import type { SceneNode } from "@sophistry/core";
import { linearGradient, UP } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import type { ChartProps } from "../frame/types";
import { hashRanks } from "../stagger";
import { markItems } from "../test-harness";
import {
	beeswarm,
	eventPlot,
	labels,
	links,
	rects,
	rug,
	stem,
	strip,
	tickX,
	tickY,
	vectors,
} from ".";
import { plot, rounded } from "./test-utils";

const Z = 7;
const frame: Partial<ChartProps> = { xRange: [0, 5], yRange: [0, 5] };
const rows = [
	{ id: "a", v: 1, g: "p" },
	{ id: "b", v: 2.5, g: "q" },
	{ id: "c", v: 4, g: "p" },
];
const later = [
	{ id: "a", v: 3, g: "q" },
	{ id: "c", v: 2, g: "p" },
	{ id: "d", v: 4.5, g: "q" },
];
const length = (s: { x0: number; y0: number; x1: number; y1: number }) =>
	Math.hypot(s.x1 - s.x0, s.y1 - s.y0);

/** The instances node a point mark draws through. */
const batchOf = (layer: SceneNode, index = 0) =>
	(layer as unknown as { children: SceneNode[] }).children[index] as SceneNode<{
		shared: {
			itemLabel?: (item: number) => string | undefined;
			label?: string;
		};
	}>;

describe("rug", () => {
	it("stands ticks on the x axis, drawn up out of it as far as the reveal", () => {
		const view = plot(
			rug.create({ zIndex: Z, data: [1, 3], length: 0.2, progress: 0.5 }),
			{
				yRange: [0, 4],
			},
		);
		const [first, second] = view.segments();
		expect(first?.x0).toBeCloseTo(view.at(1, 0).x);
		expect(first?.y0).toBeCloseTo(view.at(0, 0).y);
		// Traced out of the axis half way (the item's `progress`).
		expect(first?.y1).toBeCloseTo(view.at(0, 0).y + 0.1);
		expect(view.layers()[0]?.progresses?.[0]).toBeCloseTo(0.5);
		expect(second?.x0).toBeCloseTo(view.at(3, 0).x);
		const [lo, hi] = view.coords().xRange();
		expect(lo).toBeLessThanOrEqual(1);
		expect(hi).toBeGreaterThanOrEqual(3);
		expect(view.layers()[0]?.style.opacity).toBeCloseTo(0.7);
	});

	it("staggers ticks in value order", () => {
		const view = plot(
			rug.create({ zIndex: Z, data: [4, 1, 2.5], progress: 0.5, stagger: 0.5 }),
			frame,
		);
		const reach = view.segments().map(length);
		// Ranks 1 → 0, 2.5 → 1, 4 → 2: done, half way, not begun.
		expect(reach).toHaveLength(2);
		expect(reach[0]).toBeCloseTo(0.18);
		expect(reach[1]).toBeCloseTo(0.09);
	});

	it('runs along y with `axis: "y"` through a keyed transition', () => {
		const at = (blend: number) =>
			plot(
				rug.create({
					zIndex: Z,
					data: rows,
					to: later,
					blend,
					key: "id",
					value: "v",
					axis: "y",
					staging: "together",
				}),
				frame,
			);
		const half = at(0.5);
		const a = half.segments().find((s) => s.y0 === half.at(0, 2).y);
		expect(a).toBeDefined();
		expect(a?.x1).toBeCloseTo((a?.x0 ?? 0) + 0.18 / 2 + 0.09, 1);
	});

	it("reads each tick's tooltip per item", () => {
		const layer = rug.create({
			data: rows,
			value: "v",
			series: "g",
			tooltip: true,
		});
		plot(layer, frame);
		const shared = batchOf(layer).get("shared");
		expect(shared.label).toBe("Rug, 3 ticks");
		expect(shared.itemLabel?.(0)).toBe("v: 1, g: p");
	});
});

describe("strip and beeswarm", () => {
	const runs = [
		{ arm: "control", ms: 212 },
		{ arm: "control", ms: 240 },
		{ arm: "control", ms: 225 },
		{ arm: "treated", ms: 181 },
		{ arm: "treated", ms: 199 },
		{ arm: "treated", ms: 199 },
	];

	it("a strip jitters each dot inside its category's band, the same every time", () => {
		const centres = () => {
			const view = plot(
				strip.create({
					zIndex: Z,
					data: runs,
					category: "arm",
					value: "ms",
					width: 0.8,
				}),
			);
			const spec = view.layers()[0];
			const items = spec ? markItems(spec) : [];
			return { view, items: items.map((item) => item.center) };
		};
		const { view, items: first } = centres();
		const band = view.handle()?.xBand;
		expect(band?.domain).toEqual(["control", "treated"]);
		first.forEach((c, i) => {
			const arm = (runs[i] as { arm: string }).arm;
			const start = band?.start(arm) ?? 0;
			const centre = start + (band?.bandwidth ?? 0) / 2;
			const half = (band?.bandwidth ?? 0) * 0.4;
			const at = view.coords().pointToCoords(c).x;
			expect(at).toBeGreaterThanOrEqual(centre - half - 1e-9);
			expect(at).toBeLessThanOrEqual(centre + half + 1e-9);
			expect(c.y).toBeCloseTo(
				view.coords().coordsToPoint(0, (runs[i] as { ms: number }).ms).y,
			);
		});
		expect(centres().items).toEqual(first);
	});

	it("a beeswarm packs equal values side by side without overlap", () => {
		const view = plot(
			beeswarm.create({
				zIndex: Z,
				data: runs,
				category: "arm",
				value: "ms",
				radius: 0.1,
				gap: 0,
			}),
		);
		const items = markItems(view.layers()[0] as never);
		const [a, b] = [items[4], items[5]];
		expect(Math.abs((a?.center.x ?? 0) - (b?.center.x ?? 0))).toBeCloseTo(
			0.2,
			2,
		);
		expect(a?.center.y).toBeCloseTo(b?.center.y ?? Number.NaN);
	});

	it("dots appear in place: radius and opacity grow with the reveal, in value order", () => {
		const view = plot(
			beeswarm.create({
				zIndex: Z,
				data: [5, 1, 9],
				progress: 0.5,
				stagger: 0.5,
				radius: 0.2,
			}),
			{ yRange: [0, 10] },
		);
		// Ranks: 5 → 1, 1 → 0, 9 → 2. At 0.5 with spread 0.5: 1 is done, 5 is
		// half way, 9 has not started (not drawn).
		const items = markItems(view.layers()[0] as never);
		expect(items).toHaveLength(2);
		expect(items[0]?.radius).toBeCloseTo(0.1);
		expect(items[0]?.alpha).toBeCloseTo(0.5);
		expect(items[1]?.radius).toBeCloseTo(0.2);
	});

	it("matches a horizontal strip through a keyed transition at both ends", () => {
		const at = (
			blend: number | undefined,
			data = rows,
			to: typeof later | undefined = later,
		) =>
			plot(
				strip.create({
					zIndex: Z,
					data,
					to,
					blend,
					key: "id",
					value: "v",
					orientation: "horizontal",
				}),
				frame,
			).dots();
		expect(at(0)).toEqual(at(undefined, rows, undefined));
		expect(at(1)).toEqual(at(undefined, later, undefined));
	});

	it("reads each dot's tooltip per item", () => {
		const layer = strip.create({
			data: rows,
			value: "v",
			series: "g",
			tooltip: true,
		});
		plot(layer, frame);
		const shared = batchOf(layer).get("shared");
		expect(shared.label).toBe("Strip, 3 dots");
		expect(shared.itemLabel?.(1)).toBe("g: q, v: 2.5");
	});
});

describe("tickX and tickY", () => {
	it("tickX spans its band on a categorical y axis (a strip plot)", () => {
		const view = plot(
			tickX.create({
				zIndex: Z,
				data: [
					{ v: 1, g: "a" },
					{ v: 2, g: "b" },
				],
				x: "v",
				y: "g",
			}),
		);
		const band = view.handle()?.yBand;
		expect(band?.domain).toEqual(["a", "b"]);
		const [first] = view.segments();
		const start = band?.start("a") ?? 0;
		const ys = [start, start + (band?.bandwidth ?? 0)].map(
			(v) => view.coords().coordsToPoint(0, v).y,
		);
		expect(Math.min(first?.y0 ?? 0, first?.y1 ?? 0)).toBeCloseTo(
			Math.min(...ys),
		);
		expect(Math.max(first?.y0 ?? 0, first?.y1 ?? 0)).toBeCloseTo(
			Math.max(...ys),
		);
	});

	it("tickX sits on the x axis as a rug without a y", () => {
		const view = plot(tickX.create({ zIndex: Z, data: [3], length: 0.4 }), {
			xRange: [0, 10],
			yRange: [0, 4],
		});
		const [tick] = view.segments();
		expect(Math.abs((tick?.y1 ?? 0) - (tick?.y0 ?? 0))).toBeCloseTo(0.4);
		expect(((tick?.y1 ?? 0) + (tick?.y0 ?? 0)) / 2).toBeCloseTo(
			view.at(0, 0).y,
		);
	});

	it("draws from the low end as far as the reveal, and is each end's chart through a transition", () => {
		const half = plot(
			tickY.create({ zIndex: Z, data: [1, 2], length: 0.4, progress: 0.5 }),
			frame,
		);
		for (const s of half.segments()) expect(length(s)).toBeCloseTo(0.2);
		const at = (
			blend: number | undefined,
			data = rows,
			to: typeof later | undefined = later,
		) =>
			plot(
				tickX.create({ zIndex: Z, data, to, blend, key: "id", x: "v" }),
				frame,
			).segments();
		expect(at(0)).toEqual(at(undefined, rows, undefined));
		expect(at(1)).toEqual(at(undefined, later, undefined));
	});

	it("reads each tick's tooltip per item", () => {
		const layer = tickX.create({ data: rows, x: "v", y: "g", tooltip: true });
		plot(layer, frame);
		expect(batchOf(layer).get("shared").itemLabel?.(0)).toBe("g: p, v: 1");
	});
});

describe("stem", () => {
	it("lines grow from the baseline, the marker riding the tip", () => {
		const view = plot(
			stem.create({ zIndex: Z, data: [4, -4], progress: 0.5 }),
			{
				xRange: [0, 2],
				yRange: [-4, 4],
			},
		);
		const [lines, heads] = view.layers();
		expect(lines?.shape.kind).toBe("paths");
		// Partly revealed discs are drawn from their outlines.
		expect(heads?.shape.kind).toBe("outline");
		const [up, down] = view.segments();
		expect(up?.y0).toBeCloseTo(view.at(0, 0).y);
		expect(up?.y1).toBeCloseTo(view.at(0, 2).y);
		expect(down?.y1).toBeCloseTo(view.at(0, -2).y);
		const markers = markItems(heads as never);
		expect(markers[0]?.center.y).toBeCloseTo(view.at(0, 2).y);
		expect(markers[1]?.center.y).toBeCloseTo(view.at(0, -2).y);
		// The marker reveals as it rides the tip, at full opacity.
		expect(heads?.progresses?.[0]).toBeCloseTo(0.5);
		expect((markers[0]?.alpha ?? 0) * (heads?.style.opacity ?? 0)).toBeCloseTo(
			1,
		);
	});

	it("stagger goes in x order, not data order", () => {
		const view = plot(
			stem.create({
				zIndex: Z,
				data: [
					{ at: 2, v: 4 },
					{ at: 0, v: 4 },
				],
				x: "at",
				y: "v",
				progress: 0.5,
				stagger: 0.5,
			}),
			{ xRange: [0, 2], yRange: [0, 4] },
		);
		const lines = view.segments();
		expect(lines).toHaveLength(1);
		expect(lines[0]?.x0).toBeCloseTo(view.at(0, 0).x);
		expect(lines[0]?.y1).toBeCloseTo(view.at(0, 4).y);
	});

	it("fades in place, at full height, when the y axis has no zero", () => {
		const view = plot(stem.create({ zIndex: Z, data: [3, 4], progress: 0.5 }), {
			xRange: [0, 2],
			yRange: [2, 5],
		});
		const [first] = view.segments();
		expect(first?.y1).toBeCloseTo(view.at(0, 3).y);
		expect(first?.alpha).toBeCloseTo(0.5);
	});

	it("passes a gradient stroke through (one node per stem); color wins when set", () => {
		const gradient = linearGradient(["red", "blue"]);
		const view = plot(
			stem.create({ zIndex: Z, data: [1, 2], stroke: gradient }),
			frame,
		);
		expect(view.layers()).toHaveLength(0);
		const lines = view.scene
			.shapes()
			.filter((s) => s.zIndex === Z && !s.closed);
		expect(lines).toHaveLength(2);
		expect(typeof lines[0]?.style.stroke).toBe("object");
		const colored = plot(
			stem.create({
				zIndex: Z,
				data: [1, 2],
				stroke: gradient,
				color: "#00ff00",
			}),
			frame,
		);
		expect(colored.segments().map((s) => s.stroke)).toContain("#00ff00");
	});
});

describe("eventPlot", () => {
	it("draws ticks in x order across rows", () => {
		const view = plot(
			eventPlot.create({
				zIndex: Z,
				data: [
					[1, 9],
					[5, 3],
				],
				progress: 0.5,
				stagger: 0.6,
			}),
			{ width: 6, height: 3, xRange: [0, 10], yRange: [-1, 2] },
		);
		// Starts at 0, 0.2, 0.4 and 0.6 of the reveal: the last has not begun.
		const ticks = view.segments().sort((a, b) => a.x0 - b.x0);
		expect(ticks).toHaveLength(3);
		for (let i = 1; i < ticks.length; i++)
			expect(length(ticks[i] as never)).toBeLessThan(
				length(ticks[i - 1] as never),
			);
		const plain = plot(
			eventPlot.create({ zIndex: Z, data: [[1, 9]], progress: 0.5 }),
			{
				width: 6,
				height: 3,
				xRange: [0, 10],
				yRange: [-1, 2],
			},
		);
		const full = 0.8 * (3 / 3);
		for (const s of plain.segments())
			expect(length(s)).toBeCloseTo(full / 2, 6);
	});
});

describe("rects, labels, links", () => {
	it("an x-only rect is a full-height span, behind the data", () => {
		const view = plot(
			rects.create({ data: [{ a: 2, b: 4 }], x1: "a", x2: "b" }),
			{ yRange: [0, 4] },
			-1,
		);
		const [layer] = view.layers();
		expect(layer?.shape.kind).toBe("rect");
		const [item] = markItems(layer as never);
		const area = view.coords().area();
		expect((item?.center.y ?? 0) - (item?.halfHeight ?? 0)).toBeCloseTo(
			area.minY,
		);
		expect((item?.center.y ?? 0) + (item?.halfHeight ?? 0)).toBeCloseTo(
			area.maxY,
		);
		expect((item?.center.x ?? 0) - (item?.halfWidth ?? 0)).toBeCloseTo(
			view.at(2, 0).x,
		);
		expect(layer?.style.opacity).toBe(1);
	});

	it("labels place text at data positions, beside them with a direction", () => {
		const centred = plot(
			labels.create({
				data: [{ x: 1, y: 2, name: "peak" }],
				x: "x",
				y: "y",
				text: "name",
			}),
			{ xRange: [0, 4], yRange: [0, 4] },
		);
		const [text] = centred.scene.texts().filter((t) => t.text === "peak");
		expect(text).toBeDefined();
		const beside = plot(
			labels.create({
				data: [{ x: 1, y: 2, name: "peak" }],
				x: "x",
				y: "y",
				text: "name",
				direction: UP,
			}),
			{ xRange: [0, 4], yRange: [0, 4] },
		);
		expect(beside.scene.texts().map((t) => t.text)).toContain("peak");
	});

	it("a vector's tip counts towards the fitted range", () => {
		const view = plot(
			vectors.create({
				data: [{ x: 0, y: 0, u: 9, v: 3 }],
				x: "x",
				y: "y",
				u: "u",
				v: "v",
			}),
		);
		expect(view.coords().xRange()[1]).toBeGreaterThanOrEqual(9);
		expect(view.coords().yRange()[1]).toBeGreaterThanOrEqual(3);
	});

	it("links categories on band axes", () => {
		const view = plot(
			links.create({
				zIndex: Z,
				data: [{ a: "x", b: 1, c: "y", d: 3 }],
				x1: "a",
				y1: "b",
				x2: "c",
				y2: "d",
				arrow: true,
			}),
		);
		expect(view.handle()?.xBand?.domain).toEqual(["x", "y"]);
		expect(view.layers().length).toBeGreaterThan(0);
	});
});

/* ---------------------------------------------------- staggerOrder="random" */

describe('staggerOrder="random"', () => {
	const keys = ["a", "b", "c", "d", "e", "f"];
	const data = keys.map((id, i) => ({ id, x: i + 1, y: 3 }));
	const hashed = hashRanks(keys);

	it("is not the position order for these keys (so the tests below mean something)", () => {
		expect(hashed).not.toEqual(keys.map((_, i) => i));
	});

	/** Each datum's reach (radius or length plus alpha), by where it stands along `axis`. */
	const reachBy = (layer: SceneNode, axis: "x" | "y") => {
		const view = plot(layer, { xRange: [0, 7], yRange: [0, 7] });
		const out = new Map<number, number>();
		const add = (at: number, value: number) =>
			out.set(rounded(at), (out.get(rounded(at)) ?? 0) + value);
		for (const spec of view.layers())
			markItems(spec).forEach((item, i) => {
				// A partly revealed item reaches as far as its trace (a disc: its fill comes up with it).
				const progress = spec.progresses?.[i] ?? 1;
				const disc = spec.shape.kind === "outline" && spec.shape.closed;
				const points = disc ? [] : item.polylines.flat();
				const size =
					points.length > 1
						? Math.hypot(
								(points[points.length - 1]?.x ?? 0) - (points[0]?.x ?? 0),
								(points[points.length - 1]?.y ?? 0) - (points[0]?.y ?? 0),
							) * progress
						: disc
							? (spec.extents[i] as number)
							: item.radius;
				const at =
					points.length > 1
						? (points[0] as { x: number; y: number })
						: item.center;
				add(
					axis === "x" ? at.x : at.y,
					size + item.alpha * (disc ? progress : 1),
				);
			});
		return [...out].sort((p, q) => p[0] - q[0]).map(([, r]) => r);
	};
	const cases: Record<
		string,
		{ build: (order?: "random") => SceneNode; axis: "x" | "y" }
	> = {
		Stem: {
			axis: "x",
			build: (order) =>
				stem.create({
					zIndex: Z,
					data,
					key: "id",
					x: "x",
					y: "y",
					stagger: 0.8,
					staggerOrder: order,
					progress: 0.5,
				}),
		},
		Strip: {
			axis: "y",
			build: (order) =>
				strip.create({
					zIndex: Z,
					data,
					key: "id",
					value: "x",
					stagger: 0.8,
					staggerOrder: order,
					progress: 0.5,
				}),
		},
		Beeswarm: {
			axis: "y",
			build: (order) =>
				beeswarm.create({
					zIndex: Z,
					data,
					key: "id",
					value: "x",
					stagger: 0.8,
					staggerOrder: order,
					progress: 0.5,
				}),
		},
	};
	for (const [name, { build, axis }] of Object.entries(cases)) {
		it(`${name}: reveals by key hash, the same on every mount`, () => {
			const positional = reachBy(build(), axis);
			for (let i = 1; i < positional.length; i++)
				expect(positional[i]).toBeLessThanOrEqual(
					(positional[i - 1] ?? 0) + 1e-9,
				);
			const random = reachBy(build("random"), axis);
			expect(random).not.toEqual(positional);
			// Each drawn datum no further than one ranked before it.
			expect(reachBy(build("random"), axis)).toEqual(random);
		});
	}
});

/* ------------------------------------------------------------ enterStagger */

describe("enterStagger on the keyed marks", () => {
	const before = [
		{ id: "a", x: 1, y: 2 },
		{ id: "b", x: 2, y: 3 },
	];
	const after = [
		{ id: "a", x: 1, y: 2 },
		{ id: "b", x: 2, y: 3 },
		{ id: "e", x: 5, y: 4 },
		{ id: "c", x: 3, y: 2 },
		{ id: "d", x: 4, y: 3 },
	];
	type Row = (typeof before)[number];
	type Build = (
		blend: number | undefined,
		data: Row[],
		to: Row[] | undefined,
	) => SceneNode;
	const common = { zIndex: Z, key: "id", enterStagger: 0.6 } as const;
	const marks: Record<string, Build> = {
		Stem: (blend, data, to) =>
			stem.create({ ...common, data, to, blend, x: "x", y: "y" }),
		Strip: (blend, data, to) =>
			strip.create({ ...common, data, to, blend, value: "x" }),
		Beeswarm: (blend, data, to) =>
			beeswarm.create({ ...common, data, to, blend, value: "x" }),
		Rug: (blend, data, to) =>
			rug.create({ ...common, data, to, blend, value: "x" }),
		Rects: (blend, data, to) =>
			rects.create({
				...common,
				data,
				to,
				blend,
				x1: "x",
				x2: (d: Row) => d.x + 0.5,
				y1: () => 0,
				y2: "y",
			}),
	};
	const picture = (layer: SceneNode) => {
		const view = plot(layer, { xRange: [0, 6], yRange: [0, 6] });
		return [view.dots(), view.segments()];
	};
	for (const [name, build] of Object.entries(marks)) {
		it(`${name}: both ends are exactly each end's own chart`, () => {
			expect(picture(build(0, before, after))).toEqual(
				picture(build(undefined, before, undefined)),
			);
			expect(picture(build(1, before, after))).toEqual(
				picture(build(undefined, after, undefined)),
			);
		});
	}

	it("Labels: both ends are exactly each end's own chart", () => {
		const texts = (
			blend: number | undefined,
			data: Row[],
			to: Row[] | undefined,
		) =>
			plot(
				labels.create({
					...common,
					data,
					to,
					blend,
					x: "x",
					y: "y",
					text: "id",
				}),
				{
					xRange: [0, 6],
					yRange: [0, 6],
				},
			)
				.scene.texts()
				.filter((t) => t.zIndex === Z)
				.map((t) => t.text)
				.sort();
		expect(texts(0, before, after)).toEqual(
			texts(undefined, before, undefined),
		);
		expect(texts(1, before, after)).toEqual(texts(undefined, after, undefined));
	});

	it("Stem: entering stems grow one after another, left to right where they land", () => {
		const stems = (layer: SceneNode) =>
			plot(layer, { xRange: [0, 6], yRange: [0, 6] })
				.segments()
				.map(length);
		const ordered = stems(
			stem.create({
				zIndex: Z,
				data: before,
				to: after,
				blend: 0.75,
				key: "id",
				x: "x",
				y: "y",
				enterStagger: 0.5,
				staging: "together",
			}),
		);
		const whole = stems(
			stem.create({ zIndex: Z, data: after, x: "x", y: "y" }),
		);
		// together: at 3/4, c (x 3) and d (x 4) are done and e (x 5) half grown,
		// though `to` lists e first.
		expect(ordered).toHaveLength(5);
		expect(ordered[2]).toBeCloseTo(whole[2] ?? 0);
		expect(ordered[3]).toBeCloseTo(whole[3] ?? 0);
		expect(ordered[4]).toBeLessThan(whole[4] ?? 0);
	});
});

describe("across an axis's change of kind", () => {
	it("rug, strip, tickX and stem move from a band axis's slots to a number line", () => {
		// needs frame: frame.ends (axis-kind swap)
	});
});
