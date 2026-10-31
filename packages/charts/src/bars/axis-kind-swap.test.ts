/**
 * The bar family's keyed marks across an axis's change of kind: bars at one end (a band x axis), scatter
 * dots on a number line at the other, and the mark under test (`ruleX`,
 * `ruleY`, `histogram`) moving between the two. Each end's datum maps
 * through its own end's plot (`frame.ends`, `endSpace`) and the two blend in
 * scene units on the update stage, so nothing jumps at the midpoint.
 *
 * Most of this needs the full frame's `frame.ends`; those cases are skipped
 */

import type { SceneNode } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import { chart } from "../chart";
import { scatter } from "../points/scatter";
import { markItems, mount } from "../test-harness";
import { bars } from "./bars";
import { histogram } from "./histogram";
import { ruleX, ruleY } from "./rules";

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;
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
const onBars: Dot[] = sales.map((d, i) => ({ id: d.id, x: i + 0.5, y: d.n }));

const extentOf = (data: Dot[]): [number, number] | undefined =>
	data.length > 0
		? [
				Math.min(...data.map((d) => d.x)) - 1,
				Math.max(...data.map((d) => d.x)) + 1,
			]
		: undefined;

interface Case {
	name: string;
	layer: (
		ends: { data: Dot[]; to?: Dot[] },
		blend: number,
		staging: Staging | undefined,
	) => SceneNode;
	stays?: true;
}

const cases: Case[] = [
	{
		name: "RuleX",
		layer: (e, blend, staging) =>
			ruleX.create({
				data: e.data,
				to: e.to,
				blend,
				staging,
				key: "id",
				x: "x",
			}),
	},
	{
		name: "RuleY",
		layer: (e, blend, staging) =>
			ruleY.create({
				data: e.data,
				to: e.to,
				blend,
				staging,
				key: "id",
				y: "y",
				x1: (d: Dot) => d.x - 0.25,
				x2: (d: Dot) => d.x + 0.25,
			}),
	},
	{
		name: "Histogram",
		stays: true,
		layer: (e, blend, staging) =>
			histogram.create({
				data: e.data,
				to: e.to,
				blend,
				staging,
				value: "x",
				binCount: 3,
				range: extentOf(e.data),
				toRange: e.to ? extentOf(e.to) : undefined,
			}),
	},
];

/** The chart: bars, the dots that make the far end's number line, and the mark. */
function view(
	mark: Case,
	blend: number,
	ends: {
		bars: { data: Sale[]; to?: Sale[] };
		dots: { data: Dot[]; to?: Dot[] };
		mark: { data: Dot[]; to?: Dot[] };
	},
	staging?: Staging,
) {
	const layer = mark.layer(ends.mark, blend, staging);
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
	// The mark's drawn items, as boxes with opacity.
	const ids = new Set([
		layer.id,
		...(layer as unknown as { children: SceneNode[] }).children.map(
			(c) => c.id,
		),
	]);
	return scene
		.marks()
		.filter((spec) => ids.has(spec.id))
		.flatMap((spec) =>
			markItems(spec).map((item) => {
				const points = item.polylines.flat();
				const xs = points.length ? points.map((p) => p.x) : [item.center.x];
				const ys = points.length ? points.map((p) => p.y) : [item.center.y];
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

const endsOf = () => ({ a: onBars, b: spread });
const plainA = (mark: Case) =>
	view(mark, 0, {
		bars: { data: sales },
		dots: { data: [] },
		mark: { data: endsOf().a },
	});
const plainB = (mark: Case) =>
	view(mark, 0, {
		bars: { data: [] },
		dots: { data: spread },
		mark: { data: endsOf().b },
	});
const away = (mark: Case, blend: number, staging?: Staging) =>
	view(
		mark,
		blend,
		{
			bars: { data: sales, to: [] },
			dots: { data: [], to: spread },
			mark: { data: endsOf().a, to: endsOf().b },
		},
		staging,
	);
const back = (mark: Case, blend: number, staging?: Staging) =>
	view(
		mark,
		blend,
		{
			bars: { data: [], to: sales },
			dots: { data: spread, to: [] },
			mark: { data: endsOf().b, to: endsOf().a },
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

describe("keyed marks across an axis's change of kind", () => {
	for (const mark of cases) {
		describe(mark.name, () => {
			it("each end is exactly its plain chart, both ways and under both stagings", () => {
				const a = plainA(mark);
				const b = plainB(mark);
				expect(a.length).toBeGreaterThan(0);
				for (const staging of ["staged", "together"] as const) {
					expect(away(mark, 0, staging)).toEqual(a);
					expect(away(mark, 1, staging)).toEqual(b);
					expect(back(mark, 0, staging)).toEqual(b);
					expect(back(mark, 1, staging)).toEqual(a);
				}
			});

			it("moves in scene units, with no jump at the update's midpoint", () => {
				const start = plainA(mark);
				const end = plainB(mark);
				const whole = jump(start, end);
				expect(whole).toBeGreaterThan(0.25);
				for (const staging of ["staged", "together"] as const) {
					const [before, after] =
						staging === "staged" ? [0.665, 0.669] : [0.495, 0.505];
					expect(
						jump(away(mark, before, staging), away(mark, after, staging)),
					).toBeLessThan(whole / 20);
				}
				const mid = away(mark, 0.5, "together");
				mid.forEach((m, i) => {
					const lo = Math.min(start[i]?.minX ?? 0, end[i]?.minX ?? 0);
					const hi = Math.max(start[i]?.minX ?? 0, end[i]?.minX ?? 0);
					expect(m.minX).toBeGreaterThanOrEqual(lo - 1e-6);
					expect(m.minX).toBeLessThanOrEqual(hi + 1e-6);
				});
			});

			if (mark.stays) return;
			it('leaves through its own end and arrives through its own under "together"', () => {
				const start = plainA(mark);
				const leaving = view(
					mark,
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
					expect(Math.abs(m.minX - (start[i]?.minX ?? 0))).toBeLessThan(0.05);
				});
				const arriving = view(
					mark,
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
					expect(Math.abs(m.minX - (start[i]?.minX ?? 0))).toBeLessThan(0.05);
				});
			});
		});
	}

	it("draws the plain end charts (the swap's fixtures mount)", () => {
		for (const mark of cases) {
			expect(plainA(mark).length).toBeGreaterThan(0);
			expect(plainB(mark).length).toBeGreaterThan(0);
		}
	});
});
