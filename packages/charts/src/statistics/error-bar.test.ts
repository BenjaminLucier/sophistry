/**
 * `errorBar`: drawing, reveal (it grows out of its estimate), keyed
 * transitions, series, stagger orders, the clock-driven `transition`, and
 * the axis-kind swap.
 */

import type { CoordinateSystem } from "@sophistry/core";
import { describe, expect, it, vi } from "vitest";
import { bars } from "../bars/bars";
import { chart, chartHandle } from "../chart";
import { scatter } from "../points/scatter";
import { hashRanks } from "../stagger";
import { markItems, mount } from "../test-harness";
import { errorBar } from "./error-bar";
import type { Mounted } from "./test-picture";
import { items, paint, picture, rounded } from "./test-picture";

/** The bars and caps: each `line` item's ends, rounded, with its stroke. */
const segments = (scene: Mounted) =>
	items(scene)
		.filter((item) => !item.closed)
		.map((item) => {
			const points = item.polylines.flat();
			const a = points[0] as { x: number; y: number };
			const b = points[points.length - 1] as { x: number; y: number };
			return {
				x0: rounded(a.x),
				y0: rounded(a.y),
				x1: rounded(b.x),
				y1: rounded(b.y),
				stroke: paint(item.stroke ?? item.spec.style.stroke),
			};
		});
/**
 * The markers, as rounded centres, radii, opacities and reveals, left to right. A disc layer
 * partly revealed is drawn from outlines: its radius is then half its outline's width.
 */
const dots = (scene: Mounted) =>
	items(scene)
		.filter((item) => item.closed)
		.map((item) => {
			const xs = item.polylines.flat().map((p) => p.x);
			return {
				x: rounded(item.center.x),
				y: rounded(item.center.y),
				r: rounded(
					item.spec.shape.kind === "circle"
						? item.radius
						: (Math.max(...xs) - Math.min(...xs)) / 2,
				),
				alpha: rounded(item.alpha),
				progress: rounded(item.progress),
				fill: item.fill,
			};
		})
		.sort((p, q) => p.x - q.x || p.y - q.y);

const coordsOf = (plot: ReturnType<typeof chart.create>) =>
	chartHandle(plot)?.coords as CoordinateSystem;

describe("errorBar", () => {
	it("draws a marker and a capped bar per datum, as two instances nodes", () => {
		const plot = chart.create({
			width: 8,
			height: 4,
			xRange: [0, 4],
			yRange: [0, 10],
			children: [
				errorBar.create({
					data: [
						{ t: 1, v: 5, e: 1 },
						{ t: 2, v: 3, e: [1, 2] },
						{ t: 3, v: 4, e: Number.NaN },
					],
					x: "t",
					y: "v",
					yError: "e",
				}),
			],
		});
		const scene = mount(plot);
		const coords = coordsOf(plot);
		expect(scene.marks()).toHaveLength(2);
		expect(dots(scene)).toHaveLength(3);
		const bars = segments(scene).filter((s) => s.x0 === s.x1);
		expect(bars).toHaveLength(2);
		const second = bars.find(
			(s) => s.x0 === rounded(coords.coordsToPoint(2, 0).x),
		);
		expect(Math.min(second?.y0 ?? 0, second?.y1 ?? 0)).toBeCloseTo(
			coords.coordsToPoint(0, 2).y,
		);
		expect(Math.max(second?.y0 ?? 0, second?.y1 ?? 0)).toBeCloseTo(
			coords.coordsToPoint(0, 5).y,
		);
		// Four caps of the default 0.15.
		const caps = segments(scene).filter((s) => s.y0 === s.y1);
		expect(caps).toHaveLength(4);
		expect(caps[0]?.x1 - (caps[0]?.x0 ?? 0)).toBeCloseTo(0.15);
	});

	it("draws each bar outward from the marker to both ends", () => {
		const plot = chart.create({
			width: 8,
			height: 4,
			xRange: [0, 2],
			yRange: [0, 10],
			axis: { visible: false },
			children: [
				errorBar.create({
					data: [{ t: 1, mean: 5, lo: 2, hi: 4 }],
					x: "t",
					y: "mean",
					yError: (d: { lo: number; hi: number }) => [d.lo, d.hi],
					progress: 0.5,
				}),
			],
		});
		const scene = mount(plot);
		const y = (value: number) => coordsOf(plot).coordsToPoint(0, value).y;
		const [bar, lowCap, highCap] = segments(scene);
		expect(Math.min(bar?.y0 ?? 0, bar?.y1 ?? 0)).toBeCloseTo(y(4));
		expect(Math.max(bar?.y0 ?? 0, bar?.y1 ?? 0)).toBeCloseTo(y(7));
		expect(lowCap?.y0).toBeCloseTo(y(4));
		expect(highCap?.y0).toBeCloseTo(y(7));
		// The marker draws in with its `progress`.
		expect(dots(scene)[0]?.progress).toBeCloseTo(0.5);
		expect(dots(scene)[0]?.alpha).toBeCloseTo(1);
	});

	it("moves markers and bars through the tween bank with `transition`", () => {
		const bars = errorBar.create({
			data: [{ id: "a", x: 1, y: 2, e: 1 }],
			key: "id",
			x: "x",
			y: "y",
			yError: "e",
			transition: { duration: 1, easing: "linear" },
		});
		const plot = chart.create({
			width: 10,
			height: 10,
			xRange: [0, 10],
			yRange: [0, 10],
			children: [bars],
		});
		const scene = mount(plot);
		const markerY = () => dots(scene)[0]?.y ?? Number.NaN;
		const start = markerY();
		bars.set("data", [{ id: "a", x: 1, y: 8, e: 1 }]);
		scene.commit();
		scene.advance(0.5);
		const middle = markerY();
		scene.advance(0.6);
		const end = markerY();
		expect(end - start).toBeCloseTo(6, 6);
		expect(middle).toBeGreaterThan(start + 1);
		expect(middle).toBeLessThan(end - 1);
	});
});

describe("keyed transitions on errorBar", () => {
	const ebBefore = [
		{ id: "a", x: 1, y: 2, e: 1 },
		{ id: "b", x: 2, y: 4, e: Number.NaN },
		{ id: "c", x: 3, y: 6, e: 1 },
	];
	const ebAfter = [
		{ id: "a", x: 1, y: 8, e: 2 },
		{ id: "b", x: 4, y: 4, e: 1 },
		{ id: "d", x: 5, y: 2, e: 1 },
	];
	const build = (
		blend: number | undefined,
		data = ebBefore,
		to: typeof ebAfter | undefined = ebAfter,
	) => {
		const plot = chart.create({
			width: 8,
			height: 4,
			xRange: [0, 6],
			yRange: [0, 10],
			children: [
				errorBar.create({
					data,
					to,
					blend,
					key: "id",
					x: "x",
					y: "y",
					yError: "e",
				}),
			],
		});
		return { scene: mount(plot), plot };
	};
	/** The main (vertical) bars, left to right. */
	const bars = (scene: Mounted) =>
		segments(scene)
			.filter((s) => s.x0 === s.x1 && s.y0 !== s.y1)
			.sort((p, q) => p.x0 - q.x0);
	const visibleDots = (scene: Mounted) =>
		dots(scene).filter((d) => d.alpha > 0);

	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		const at0 = build(0).scene;
		const plain0 = build(undefined, ebBefore, undefined).scene;
		expect(segments(at0).sort((p, q) => p.x0 - q.x0 || p.y0 - q.y0)).toEqual(
			segments(plain0).sort((p, q) => p.x0 - q.x0 || p.y0 - q.y0),
		);
		expect(visibleDots(at0)).toEqual(visibleDots(plain0));
		const at1 = build(1).scene;
		const plain1 = build(undefined, ebAfter, undefined).scene;
		expect(segments(at1).sort((p, q) => p.x0 - q.x0 || p.y0 - q.y0)).toEqual(
			segments(plain1).sort((p, q) => p.x0 - q.x0 || p.y0 - q.y0),
		);
		expect(visibleDots(at1)).toEqual(visibleDots(plain1));
	});

	it("draws a leaving bar back into its marker, moves a matched one's ends in data units, grows a new one", () => {
		const at = (blend: number) => {
			const { scene, plot } = build(blend);
			const coords = coordsOf(plot);
			const p = (x: number, y: number) => {
				const q = coords.coordsToPoint(x, y);
				return { x: rounded(q.x), y: rounded(q.y) };
			};
			return { bars: bars(scene), p };
		};
		const span = (bar: { y0: number; y1: number } | undefined) =>
			bar ? [Math.min(bar.y0, bar.y1), Math.max(bar.y0, bar.y1)] : [];
		const exiting = at(1 / 6);
		const c = exiting.bars.find((s) => s.x0 === exiting.p(3, 0).x);
		expect(span(c)[0]).toBeCloseTo(exiting.p(3, 5.5).y);
		expect(span(c)[1]).toBeCloseTo(exiting.p(3, 6.5).y);
		const updating = at(0.5);
		// "a": y 2 → 8 with ± 1 → ± 2; "b": a bar grows out of the marker.
		const a = updating.bars.find((s) => s.x0 === updating.p(1, 0).x);
		expect(span(a)[0]).toBeCloseTo(updating.p(1, 3.5).y);
		expect(span(a)[1]).toBeCloseTo(updating.p(1, 6.5).y);
		const b = updating.bars.find((s) => s.x0 === updating.p(3, 0).x);
		expect(span(b)[0]).toBeCloseTo(updating.p(3, 3.5).y);
		expect(span(b)[1]).toBeCloseTo(updating.p(3, 4.5).y);
		const entering = at(5 / 6);
		const d = entering.bars.find((s) => s.x0 === entering.p(5, 0).x);
		expect(span(d)[0]).toBeCloseTo(entering.p(5, 1.5).y);
		expect(span(d)[1]).toBeCloseTo(entering.p(5, 2.5).y);
	});

	it("scrubs blends without warnings, with series and both bars", () => {
		const messages: string[] = [];
		for (const level of ["warn", "error"] as const)
			vi.spyOn(console, level).mockImplementation((...args) => {
				messages.push(`${level}: ${args.map(String).join(" ")}`);
			});
		try {
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
			const node = errorBar.create({
				data: before.map((d, i) => ({ ...d, e: i, s: i % 2 ? "p" : "q" })),
				to: after.map((d, i) => ({
					...d,
					e: i === 1 ? Number.NaN : 1,
					s: i % 2 ? "p" : "r",
				})),
				blend: 0,
				key: "id",
				x: "x",
				y: "y",
				yError: "e",
				xError: (d: { e: number }) => d.e / 2,
				series: "s",
				stagger: 0.3,
			});
			const scene = mount(
				chart.create({ width: 8, height: 4, children: [node] }),
			);
			for (const t of [0.1, 0.3, 0.5, 0.7, 0.9, 1, 0.4, 0, 1]) {
				node.set("blend", t);
				scene.commit();
			}
			expect(messages).toEqual([]);
		} finally {
			vi.restoreAllMocks();
		}
	});
});

describe("errorBar series", () => {
	const RANGE = ["#111111", "#222222"];
	const rows = [
		{ t: 1, v: 2, g: "a", e: 0.5 },
		{ t: 2, v: 3, g: "b", e: 0.5 },
		{ t: 3, v: 1, g: "a", e: 0.5 },
	];

	it("colours marker and bars per series", () => {
		const plot = chart.create({
			width: 8,
			height: 4,
			axis: { visible: false },
			color: { range: RANGE },
			legend: false,
			children: [
				errorBar.create({
					data: rows,
					x: "t",
					y: "v",
					yError: "e",
					series: "g",
				}),
			],
		});
		const scene = mount(plot);
		expect(chartHandle(plot)?.colorDomain()).toEqual(["a", "b"]);
		expect(dots(scene).map((d) => d.fill)).toEqual([
			"#111111",
			"#222222",
			"#111111",
		]);
		// Each point's bar and two caps share its colour.
		const strokes = segments(scene).map((s) => s.stroke);
		expect(strokes).toHaveLength(9);
		expect(strokes.filter((s) => s === paint("#111111"))).toHaveLength(6);
	});

	it("color or stroke override the series", () => {
		const plot = chart.create({
			width: 8,
			height: 4,
			axis: { visible: false },
			children: [
				errorBar.create({
					data: rows,
					x: "t",
					y: "v",
					series: "g",
					color: "#fedcba",
				}),
				errorBar.create({
					data: rows,
					x: "t",
					y: "v",
					series: "g",
					stroke: "#abcdef",
				}),
			],
		});
		const scene = mount(plot);
		expect(chartHandle(plot)?.colorDomain()).toEqual([]);
		const fills = dots(scene).map((d) => d.fill);
		expect(fills.filter((f) => f === "#fedcba")).toHaveLength(3);
		expect(fills.filter((f) => f === "#abcdef")).toHaveLength(3);
	});
});

describe("errorBar stagger orders", () => {
	const keys = ["a", "b", "c", "d", "e", "f"];
	const rows = keys.map((id, i) => ({ id, x: i + 1, y: 3, e: 0.5 }));
	const hashed = hashRanks(keys);
	/** Each point's reach (marker opacity plus bar length), left to right. */
	const reach = (order?: "random") => {
		const scene = mount(
			chart.create({
				width: 8,
				height: 4,
				xRange: [0, 7],
				yRange: [0, 6],
				children: [
					errorBar.create({
						data: rows,
						key: "id",
						x: "x",
						y: "y",
						yError: "e",
						stagger: 0.8,
						staggerOrder: order,
						progress: 0.5,
					}),
				],
			}),
		);
		const bars = segments(scene).filter((s) => s.x0 === s.x1);
		return dots(scene).map((d) => {
			const bar = bars.find((s) => s.x0 === d.x);
			return d.alpha * d.progress + (bar ? Math.abs(bar.y1 - bar.y0) : 0);
		});
	};

	it("reveals by position by default, by key hash under `random`, the same on every mount", () => {
		const positional = reach();
		for (let i = 1; i < positional.length; i++)
			expect(positional[i]).toBeLessThanOrEqual(
				(positional[i - 1] as number) + 1e-9,
			);
		const random = reach("random");
		expect(random).toHaveLength(keys.length);
		const byHash = keys
			.map((_, i) => ({
				rank: hashed[i] as number,
				reach: random[i] as number,
			}))
			.sort((p, q) => p.rank - q.rank);
		for (let i = 1; i < byHash.length; i++)
			expect(byHash[i]?.reach).toBeLessThanOrEqual(
				(byHash[i - 1]?.reach ?? 0) + 1e-9,
			);
		expect(byHash[0]?.reach).toBeGreaterThan(
			byHash[byHash.length - 1]?.reach ?? 0,
		);
		expect(random).not.toEqual(positional);
		expect(reach("random")).toEqual(random);
	});

	const before = [
		{ id: "a", x: 1, y: 2 },
		{ id: "b", x: 2, y: 3 },
	];
	const after = [
		...before,
		{ id: "e", x: 5, y: 4 },
		{ id: "c", x: 3, y: 2 },
		{ id: "d", x: 4, y: 3 },
	];
	const withStagger = (
		blend: number | undefined,
		data: typeof before,
		to: typeof before | undefined,
	) =>
		mount(
			chart.create({
				width: 8,
				height: 4,
				xRange: [0, 6],
				yRange: [0, 6],
				children: [
					errorBar.create({
						data,
						to,
						blend,
						key: "id",
						x: "x",
						y: "y",
						yError: () => 0.4,
						enterStagger: 0.6,
					}),
				],
			}),
		);

	it("enterStagger: both ends are exactly each end's own chart", () => {
		expect(picture(withStagger(0, before, after))).toEqual(
			picture(withStagger(undefined, before, undefined)),
		);
		expect(picture(withStagger(1, before, after))).toEqual(
			picture(withStagger(undefined, after, undefined)),
		);
	});
});

describe("errorBar across an axis's change of kind", () => {
	// Bars at one end (a band x axis), scatter dots on a number line at the
	// other, and the error bars moving between the two.
	type Staging = "staged" | "together";
	const sales = [
		{ id: "a", q: "Q1", n: 3 },
		{ id: "b", q: "Q2", n: 5 },
		{ id: "c", q: "Q3", n: 4 },
	];
	type Sale = (typeof sales)[number];
	/** Dots on a number line spanning 0: the far end's continuous x axis. */
	const spread = [
		{ id: "a", x: -20, y: 3 },
		{ id: "b", x: 15, y: 6 },
		{ id: "c", x: 40, y: 2 },
	];
	type Dot = (typeof spread)[number];
	/** The same keys at the bars' slots (`x` = slot middle), on their tops. */
	const onBars: Dot[] = sales.map((d, i) => ({
		id: d.id,
		x: i + 0.5,
		y: d.n,
	}));

	/** The error bars' drawn items, as boxes with opacity. */
	function view(
		blend: number,
		ends: {
			bars: { data: Sale[]; to?: Sale[] };
			dots: { data: Dot[]; to?: Dot[] };
			mark: { data: Dot[]; to?: Dot[] };
		},
		staging?: Staging,
	) {
		const layer = errorBar.create({
			data: ends.mark.data,
			to: ends.mark.to,
			blend,
			staging,
			key: "id",
			x: "x",
			y: "y",
			yError: () => 1,
		});
		const scene = mount(
			chart.create({
				width: 8,
				height: 4,
				children: [
					bars.create({
						data: ends.bars.data,
						to: ends.bars.to,
						blend,
						staging,
						key: "id",
						category: "q",
						value: "n",
					}),
					scatter.create({
						data: ends.dots.data,
						to: ends.dots.to,
						blend,
						staging,
						key: "id",
						x: "x",
						y: "y",
					}),
					layer,
				],
			}),
		);
		const ids = new Set([layer.id, ...layer.children.map((c) => c.id)]);
		return scene
			.marks()
			.filter((spec) => ids.has(spec.id))
			.flatMap((spec) =>
				markItems(spec).map((item) => {
					const points = item.polylines.flat();
					const xs = points.length
						? points.map((p) => p.x)
						: [item.center.x - item.radius, item.center.x + item.radius];
					const ys = points.length
						? points.map((p) => p.y)
						: [item.center.y - item.radius, item.center.y + item.radius];
					return {
						minX: rounded(Math.min(...xs)),
						maxX: rounded(Math.max(...xs)),
						minY: rounded(Math.min(...ys)),
						maxY: rounded(Math.max(...ys)),
						opacity: rounded(item.alpha * spec.style.opacity),
					};
				}),
			);
	}
	type Mark = ReturnType<typeof view>[number];
	const plainA = () =>
		view(0, {
			bars: { data: sales },
			dots: { data: [] },
			mark: { data: onBars },
		});
	const plainB = () =>
		view(0, {
			bars: { data: [] },
			dots: { data: spread },
			mark: { data: spread },
		});
	const away = (blend: number, staging?: Staging) =>
		view(
			blend,
			{
				bars: { data: sales, to: [] },
				dots: { data: [], to: spread },
				mark: { data: onBars, to: spread },
			},
			staging,
		);
	const back = (blend: number, staging?: Staging) =>
		view(
			blend,
			{
				bars: { data: [], to: sales },
				dots: { data: spread, to: [] },
				mark: { data: spread, to: onBars },
			},
			staging,
		);
	/** The largest move of any box edge between two frames' marks, element by element. */
	const jump = (a: Mark[], b: Mark[]) => {
		expect(a.length).toBe(b.length);
		return Math.max(
			...a.flatMap((p, i) => {
				const q = b[i] as Mark;
				return [
					Math.abs(p.minX - q.minX),
					Math.abs(p.maxX - q.maxX),
					Math.abs(p.minY - q.minY),
					Math.abs(p.maxY - q.maxY),
				];
			}),
		);
	};

	it("each end is exactly its plain chart, and moves in scene units with no jump at the update's midpoint", () => {
		const a = plainA();
		const b = plainB();
		expect(a.length).toBeGreaterThan(0);
		for (const staging of ["staged", "together"] as const) {
			expect(away(0, staging)).toEqual(a);
			expect(away(1, staging)).toEqual(b);
			expect(back(0, staging)).toEqual(b);
			expect(back(1, staging)).toEqual(a);
		}
		const whole = jump(a, b);
		expect(whole).toBeGreaterThan(0.25);
		for (const staging of ["staged", "together"] as const) {
			// Either side of the update stage's midpoint (staged: the update
			// follows the bars' exit, from 1/3 to the end).
			const [before, after] =
				staging === "staged" ? [0.665, 0.669] : [0.495, 0.505];
			expect(jump(away(before, staging), away(after, staging))).toBeLessThan(
				whole / 20,
			);
		}
		// Halfway through the update, every mark is between its two places.
		away(0.5, "together").forEach((m, i) => {
			const lo = Math.min(a[i]?.minX ?? 0, b[i]?.minX ?? 0);
			const hi = Math.max(a[i]?.minX ?? 0, b[i]?.minX ?? 0);
			expect(m.minX).toBeGreaterThanOrEqual(lo - 1e-6);
			expect(m.minX).toBeLessThanOrEqual(hi + 1e-6);
		});
	});

	it('leaves through its own end and arrives through its own under "together"', () => {
		const start = plainA();
		const centre = (m: Mark) => (m.minX + m.maxX) / 2;
		// Leaving past the midpoint: still drawn where the band axis drew it.
		const leaving = view(
			0.6,
			{
				bars: { data: sales, to: [] },
				dots: { data: [], to: spread },
				mark: { data: onBars, to: [] },
			},
			"together",
		);
		expect(leaving.length).toBe(start.length);
		leaving.forEach((m, i) => {
			expect(Math.abs(centre(m) - centre(start[i] as Mark))).toBeLessThan(0.05);
		});
		// Arriving before it: already where the band axis will draw it.
		const arriving = view(
			0.4,
			{
				bars: { data: [], to: sales },
				dots: { data: spread, to: [] },
				mark: { data: [], to: onBars },
			},
			"together",
		);
		expect(arriving.length).toBe(start.length);
		arriving.forEach((m, i) => {
			expect(Math.abs(centre(m) - centre(start[i] as Mark))).toBeLessThan(0.05);
		});
	});
});
