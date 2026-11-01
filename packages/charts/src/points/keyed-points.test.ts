/**
 * Keyed data transitions (`to` + `blend`) on the per-datum marks beyond
 * `scatter`: `stem`, `rug`, `strip` and `beeswarm`. Each is a function of one number, so the tests
 * set it and read the batched items: both ends against the plain charts,
 * and the middle of each stage.
 */

import type { SceneNode } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import { beeswarm, rug, stem, strip } from "./index.js";
import { plot, rounded } from "./test-utils.js";

const Z = 7;
const before = [
	{ id: "a", x: 1, y: 2 },
	{ id: "b", x: 2, y: 4 },
	{ id: "c", x: 3, y: 6 },
];
const after = [
	{ id: "a", x: 1, y: 8 },
	{ id: "b", x: 4, y: 4 },
	{ id: "d", x: 5, y: 2 },
];
type Row = (typeof before)[number];

describe("keyed transitions on stem", () => {
	const at = (
		blend: number | undefined,
		data: Row[] = before,
		to: Row[] | undefined = after,
	) =>
		plot(
			stem.create({ data, to, blend, key: "id", x: "x", y: "y", zIndex: Z }),
			{ xRange: [0, 6], yRange: [0, 10] },
		);

	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expect(at(0).segments()).toEqual(
			at(undefined, before, undefined).segments(),
		);
		expect(at(0).dots()).toEqual(at(undefined, before, undefined).dots());
		expect(at(1).segments()).toEqual(
			at(undefined, after, undefined).segments(),
		);
		expect(at(1).dots()).toEqual(at(undefined, after, undefined).dots());
	});

	it("shrinks a leaving stem into the baseline, moves a matched one in data units, grows a new one", () => {
		// Exit, update, enter: a third each, eased within.
		const exiting = at(1 / 6);
		const c = exiting.segments().find((s) => s.x0 === exiting.at(3, 0).x);
		expect(c?.y1).toBeCloseTo(exiting.at(3, 3).y);
		const updating = at(0.5);
		expect(updating.segments()).toHaveLength(2);
		const b = updating.segments().find((s) => s.x0 === updating.at(3, 0).x);
		expect(b?.y1).toBeCloseTo(updating.at(3, 4).y);
		const a = updating.segments().find((s) => s.x0 === updating.at(1, 0).x);
		expect(a?.y1).toBeCloseTo(updating.at(1, 5).y);
		const entering = at(5 / 6);
		const d = entering.segments().find((s) => s.x0 === entering.at(5, 0).x);
		expect(d?.y1).toBeCloseTo(entering.at(5, 1).y);
	});
});

describe("keyed transitions on strip and beeswarm", () => {
	// Categories come and go (A, B → A, B, C), and so do series (p, q → p, r),
	// so a dodged dot's sub-band depends on the end.
	const stripBefore = [
		{ id: "a", g: "A", s: "p", v: 2 },
		{ id: "b", g: "A", s: "q", v: 4 },
		{ id: "c", g: "B", s: "q", v: 6 },
		{ id: "e", g: "B", s: "p", v: 5 },
	];
	const stripAfter = [
		{ id: "a", g: "B", s: "p", v: 8 },
		{ id: "b", g: "A", s: "r", v: 4 },
		{ id: "d", g: "C", s: "r", v: 3 },
		{ id: "e", g: "B", s: "p", v: 7 },
	];
	type StripRow = (typeof stripBefore)[number];
	const stripAt = (
		blend: number | undefined,
		data: StripRow[] = stripBefore,
		to: StripRow[] | undefined = stripAfter,
		options: { dodge?: boolean; width?: number } = {},
	) =>
		plot(
			strip.create({
				data,
				to,
				blend,
				key: "id",
				category: "g",
				value: "v",
				series: "s",
				dodge: options.dodge ?? true,
				width: options.width,
				zIndex: Z,
			}),
			{ yRange: [0, 10], color: { domain: ["p", "q", "r"] } },
		);

	it("a dodged strip is exactly `data` at blend 0", () => {
		expect(stripAt(0).dots()).toEqual(
			stripAt(undefined, stripBefore, undefined).dots(),
		);
	});

	it("a dodged strip is exactly `to` at blend 1", () => {
		// needs frame: transition fit (the band axis takes `to`'s categories at blend 1)
		expect(stripAt(1).dots()).toEqual(
			stripAt(undefined, stripAfter, undefined).dots(),
		);
	});

	// The categories change across the transition (A, B → A, B, C): the band
	// axis stages its domain through `frame.join`.
	it("shrinks a leaving dot in place, slides a matched one between bands, grows a new one", () => {
		// needs frame: frame.join staging of a band axis's categories
		const at = (blend: number) =>
			stripAt(blend, stripBefore, stripAfter, { dodge: false, width: 0 });
		const r = 0.07;
		const exiting = at(1 / 6);
		const y = (v: number) => exiting.at(0, v).y;
		const centre = (view: ReturnType<typeof at>, g: string) => {
			const band = view.handle()?.xBand;
			return view
				.coords()
				.coordsToPoint(
					(band?.start(g) ?? Number.NaN) + (band?.bandwidth ?? 0) / 2,
					0,
				).x;
		};
		const c = exiting.dots().find((d) => d.y === y(6));
		expect(c?.x).toBeCloseTo(centre(exiting, "B"));
		expect(c?.r).toBeCloseTo(r / 2);
		expect(c?.alpha).toBeCloseTo(0.5);
		const updating = at(0.5);
		expect(updating.dots()).toHaveLength(3);
		const a = updating.dots().find((d) => d.y === y(5));
		expect(a?.r).toBeCloseTo(r);
		expect(a?.x).toBeCloseTo(
			(centre(updating, "A") + centre(updating, "B")) / 2,
		);
		const entering = at(5 / 6);
		const d = entering.dots().find((p) => p.y === y(3));
		expect(d?.x).toBeCloseTo(centre(entering, "C"));
		expect(d?.r).toBeCloseTo(r / 2);
	});

	it("a dodged dot changing series slides to its new sub-band", () => {
		// needs frame: frame.join staging of a band axis's categories
		const updating = stripAt(0.5, stripBefore, stripAfter, { width: 0 });
		const y = (v: number) => updating.at(0, v).y;
		const sub = (g: string, slot: number) => {
			const band = updating.handle()?.xBand;
			const start = band?.start(g) ?? Number.NaN;
			const w = band?.bandwidth ?? 0;
			return updating.coords().coordsToPoint(start + w * (slot + 0.5) * 0.5, 0)
				.x;
		};
		expect(updating.dots().find((d) => d.y === y(4))?.x).toBeCloseTo(
			sub("A", 1),
		);
		expect(updating.dots().find((d) => d.y === y(5))?.x).toBeCloseTo(
			(sub("A", 0) + sub("B", 0)) / 2,
		);
	});

	it("a beeswarm moves each dot halfway between its two packings", () => {
		const from = [5, 5, 5, 1].map((v, i) => ({ id: `k${i}`, v }));
		const to = [2, 4, 6, 8].map((v, i) => ({ id: `k${i}`, v }));
		const swarm = (
			data: typeof from,
			target: typeof from | undefined,
			blend: number | undefined,
		) =>
			plot(
				beeswarm.create({
					data,
					to: target,
					blend,
					key: "id",
					value: "v",
					orientation: "horizontal",
					radius: 0.2,
					gap: 0,
					zIndex: Z,
				}),
				{ xRange: [0, 10] },
			);
		const centres = (view: ReturnType<typeof swarm>) =>
			view.scene.marks().flatMap((spec) =>
				spec.zIndex === Z
					? Array.from({ length: spec.count }, (_, i) => ({
							x: spec.centers[2 * i] as number,
							y: spec.centers[2 * i + 1] as number,
						}))
					: [],
			);
		const a = centres(swarm(from, undefined, undefined));
		const b = centres(swarm(to, undefined, undefined));
		expect(new Set(a.map((p) => rounded(p.y))).size).toBeGreaterThan(1);
		expect(new Set(b.map((p) => rounded(p.y))).size).toBe(1);
		const mid = centres(swarm(from, to, 0.5));
		expect(mid).toHaveLength(4);
		mid.forEach((p, i) => {
			expect(p.x).toBeCloseTo(((a[i]?.x ?? 0) + (b[i]?.x ?? 0)) / 2);
			expect(p.y).toBeCloseTo(((a[i]?.y ?? 0) + (b[i]?.y ?? 0)) / 2);
		});
		expect(centres(swarm(from, to, 0))).toEqual(a);
		expect(centres(swarm(from, to, 1))).toEqual(b);
	});
});

describe("keyed transitions on rug", () => {
	const rugBefore = [
		{ id: "a", v: 1 },
		{ id: "b", v: 2 },
		{ id: "c", v: 3 },
	];
	const rugAfter = [
		{ id: "a", v: 4 },
		{ id: "b", v: 2 },
		{ id: "d", v: 5 },
	];
	const at = (
		blend: number | undefined,
		data = rugBefore,
		to: typeof rugAfter | undefined = rugAfter,
	) =>
		plot(rug.create({ data, to, blend, key: "id", value: "v", zIndex: Z }), {
			xRange: [0, 6],
			yRange: [0, 4],
		});
	const length = (s: { x0: number; y0: number; x1: number; y1: number }) =>
		Math.hypot(s.x1 - s.x0, s.y1 - s.y0);

	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expect(at(0).segments()).toEqual(
			at(undefined, rugBefore, undefined).segments(),
		);
		expect(at(1).segments()).toEqual(
			at(undefined, rugAfter, undefined).segments(),
		);
	});

	it("draws a leaving tick back into the axis, slides a matched one, draws a new one out", () => {
		const exiting = at(1 / 6);
		const c = exiting.segments().find((s) => s.x0 === exiting.at(3, 0).x);
		expect(c && length(c)).toBeCloseTo(0.18 / 2);
		const updating = at(0.5);
		expect(updating.segments().map((s) => s.x0)).toEqual([
			updating.at(2, 0).x,
			updating.at(2.5, 0).x,
		]);
		const entering = at(5 / 6);
		const d = entering.segments().find((s) => s.x0 === entering.at(5, 0).x);
		expect(d && length(d)).toBeCloseTo(0.18 / 2);
	});

	it("keeps a tick's item by key when the data reorders", () => {
		const layer = rug.create({
			data: rugBefore,
			key: "id",
			value: "v",
			zIndex: Z,
		});
		const view = plot(layer, { xRange: [0, 6], yRange: [0, 4] });
		const instances = (
			layer as unknown as {
				children: { keyAt(i: number): unknown; indexOf(k: unknown): number }[];
			}
		).children[0];
		const before = instances?.keyAt(0);
		layer.set("data", [...rugBefore].reverse());
		view.scene.commit();
		// The same key is kept (one item per key, reordered with the data).
		expect(instances?.indexOf(before)).toBe(2);
	});
});

describe("keyed per-datum marks under a scrub", () => {
	it("blend back and forth without errors, every frame exact", () => {
		const layers: SceneNode<{ blend?: number }>[] = [
			stem.create({
				data: before.map((d, i) => ({ ...d, s: i % 2 ? "p" : "q" })),
				to: after.map((d, i) => ({ ...d, s: i % 2 ? "p" : "r" })),
				blend: 0,
				key: "id",
				x: "x",
				y: "y",
				series: "s",
				stagger: 0.3,
			}),
			strip.create({
				data: [
					{ id: "a", g: "A", s: "p", v: 2 },
					{ id: "b", g: "A", s: "q", v: 4 },
					{ id: "c", g: "B", s: "q", v: 6 },
				],
				to: [
					{ id: "a", g: "B", s: "p", v: 8 },
					{ id: "b", g: "A", s: "r", v: 4 },
					{ id: "d", g: "C", s: "r", v: 3 },
				],
				blend: 0,
				key: "id",
				category: "g",
				value: "v",
				series: "s",
				dodge: true,
				stagger: 0.3,
				tooltip: true,
			}),
			beeswarm.create({
				data: [5, 5, 5, 1, 3].map((v, i) => ({ id: i, v, g: "x" })),
				to: [2, 4, 6, 8, 8, 8].map((v, i) => ({
					id: i,
					v,
					g: i % 2 ? "x" : "y",
				})),
				blend: 0,
				key: "id",
				category: "g",
				value: "v",
				orientation: "horizontal",
			}),
			rug.create({
				data: before.map((d, i) => ({ ...d, s: i % 2 ? "p" : "q" })),
				to: after.map((d, i) => ({ ...d, s: i % 2 ? "p" : "r" })),
				blend: 0,
				key: "id",
				value: "x",
				series: "s",
				stagger: 0.3,
			}),
		];
		const views = layers.map((layer) => plot(layer));
		const first = views.map((view) => [view.segments(), view.dots()]);
		for (const t of [0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1, 0.5, 0.15, 0]) {
			layers.forEach((layer, i) => {
				layer.set("blend", t);
				views[i]?.scene.commit();
			});
		}
		// Back at 0: exactly the frame first drawn.
		views.forEach((view, i) => {
			expect([view.segments(), view.dots()]).toEqual(first[i]);
		});
	});
});
