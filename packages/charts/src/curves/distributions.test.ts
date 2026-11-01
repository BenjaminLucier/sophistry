/**
 * `density` and `regressionPlot`: the KDE area and line, its reveals
 * (`"x"` behind one clip front, `"grow"` out of zero), ridgelines,
 * `commonNorm`, `rowScale`, the horizontal orientation; the fit with its
 * confidence band, its reveal, and LOESS with `robust`.
 *
 * A curve mark is one path batch: per group a
 * closed fill item, then the open line, sharing one spec (so one clip).
 */

import type { SceneNode } from "@sophistry/core";
import { clipBounds } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import type { ChartHandle, ChartProps } from "../chart.js";
import { chart, chartHandle } from "../chart.js";
import { gaussianKde } from "../math/violin.js";
import { mount } from "../test-harness.js";
import { density } from "./density.js";
import { regressionPlot } from "./regression.js";
import type { CurveItem } from "./test-items.js";
import { curveItems } from "./test-items.js";

let handle!: ChartHandle;
function draw(
	layers: SceneNode[],
	props: Partial<ChartProps> = {},
): CurveItem[] {
	const plot = chart.create({
		width: 8,
		height: 4,
		axis: { visible: false },
		...props,
		children: layers,
	});
	const scene = mount(plot);
	handle = chartHandle(plot) as ChartHandle;
	return curveItems(scene.marks()).filter(
		(item) => item.points.length > 0 && item.opacity > 0,
	);
}
const x = (value: number) => handle.coords.coordsToPoint(value, 0).x;
const y = (value: number) => handle.coords.coordsToPoint(0, value).y;
const boxOf = (item: CurveItem | undefined) => {
	const points = item?.points ?? [];
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	return {
		minX: Math.min(...xs),
		maxX: Math.max(...xs),
		minY: Math.min(...ys),
		maxY: Math.max(...ys),
	};
};

const sample = [2.1, 2.4, 3.0, 3.1, 3.3, 3.8, 4.0, 4.2, 5.5, 6.1];

describe("density", () => {
	it("draws the KDE, and the chart fits its x span and peak with zero", () => {
		const kde = gaussianKde(sample);
		const peak = Math.max(...kde.map((p) => p.density));
		const [area, line] = draw([density.create({ data: sample })]).map(boxOf);
		expect(line?.maxY).toBeCloseTo(y(peak));
		expect(area?.minY).toBeCloseTo(y(0));
		expect(line?.minX).toBeCloseTo(x(kde[0]?.x as number));
		const [lo, hi] = handle.coords.yRange();
		expect(lo).toBeLessThanOrEqual(0);
		expect(hi).toBeGreaterThanOrEqual(peak);
	});

	it("reveals along x behind one clip front", () => {
		const kde = gaussianKde(sample);
		const middle =
			((kde[0]?.x as number) + (kde[kde.length - 1]?.x as number)) / 2;
		const [area, line] = draw([
			density.create({ data: sample, progress: 0.5 }),
		]);
		expect(area?.clip).toBe(line?.clip);
		expect(clipBounds(area?.clip)?.maxX).toBeCloseTo(x(middle));
	});

	it('reveal="grow" raises the curve out of zero instead', () => {
		const peak = Math.max(...gaussianKde(sample).map((p) => p.density));
		const [area, line] = draw(
			[density.create({ data: sample, reveal: "grow", progress: 0.5 })],
			{ yRange: [0, 1] },
		);
		expect(area?.clip).toBeUndefined();
		expect(boxOf(line).maxY).toBeCloseTo(y(peak / 2));
	});

	it("ridgelines: each curve stands on its row's band, rising rowHeight slots", () => {
		const [aArea, aLine, bArea, bLine] = draw([
			density.create({ data: [1, 2, 2, 3], row: "a", rowHeight: 1 }),
			density.create({ data: [4, 5, 5, 6], row: "b", rowHeight: 1 }),
		]).map(boxOf) as ReturnType<typeof boxOf>[];
		const band = handle.yBand;
		expect(band?.domain).toEqual(["a", "b"]);
		const pitch = Math.abs(y(1) - y(0));
		const [a0, a1] = [y(band?.start("a") ?? 0), y((band?.start("a") ?? 0) + 1)];
		expect(aArea?.minY).toBeCloseTo(Math.min(a0, a1));
		expect((aLine?.maxY as number) - (aArea?.minY as number)).toBeCloseTo(
			pitch,
		);
		// "a" reads first, so it sits above "b".
		expect(aArea?.minY).toBeGreaterThan(bArea?.minY as number);
		expect((bLine?.maxY as number) - (bArea?.minY as number)).toBeCloseTo(
			pitch,
		);
	});

	// Two groups, one three times the size of the other.
	const lopsided = [
		...[1, 2, 2, 3].map((v) => ({ v, g: "few" })),
		...[4, 5, 5, 6, 4.5, 5.5, 5, 5.2, 4.8, 5.1, 4.9, 5].map((v) => ({
			v,
			g: "many",
		})),
	];
	const peakOf = (values: number[]) =>
		Math.max(...gaussianKde(values).map((p) => p.density));
	const few = lopsided.filter((d) => d.g === "few").map((d) => d.v);
	const many = lopsided.filter((d) => d.g === "many").map((d) => d.v);

	it("commonNorm scales each category's curve by its share of the data", () => {
		const peaks = (commonNorm: boolean) =>
			draw(
				[density.create({ data: lopsided, x: "v", series: "g", commonNorm })],
				{ legend: false, yRange: [0, 2] },
			)
				.filter((s) => !s.closed)
				.map((line) => boxOf(line).maxY);
		const own = peaks(false);
		expect(own[0]).toBeCloseTo(y(peakOf(few)));
		expect(own[1]).toBeCloseTo(y(peakOf(many)));
		const common = peaks(true);
		expect(common[0]).toBeCloseTo(y(peakOf(few) * 0.25));
		expect(common[1]).toBeCloseTo(y(peakOf(many) * 0.75));
	});

	it('rowScale="shared" gives every ridge one scale; a number pins it', () => {
		const heights = (rowScale?: "shared" | number) => {
			const all = draw(
				[
					density.create({
						data: lopsided,
						x: "v",
						series: "g",
						row: true,
						rowHeight: 1,
						rowScale,
					}),
				],
				{ legend: false },
			);
			const rise = (k: number) =>
				boxOf(all[2 * k + 1]).maxY - boxOf(all[2 * k]).minY;
			return { pitch: Math.abs(y(1) - y(0)), few: rise(0), many: rise(1) };
		};
		const own = heights();
		expect(own.few).toBeCloseTo(own.pitch);
		expect(own.many).toBeCloseTo(own.pitch);
		const shared = heights("shared");
		const tallest = Math.max(peakOf(few), peakOf(many));
		expect(shared.many).toBeCloseTo((own.pitch * peakOf(many)) / tallest);
		expect(shared.few).toBeCloseTo((own.pitch * peakOf(few)) / tallest);
		const pinned = heights(2);
		expect(pinned.few).toBeCloseTo((own.pitch * peakOf(few)) / 2);
	});

	it('orientation="horizontal" puts the values up y, the density along x', () => {
		const kde = gaussianKde(sample);
		const peak = Math.max(...kde.map((p) => p.density));
		const [area, line] = draw([
			density.create({ data: sample, orientation: "horizontal" }),
		]).map(boxOf);
		expect(line?.maxX).toBeCloseTo(x(peak));
		expect(area?.minX).toBeCloseTo(x(0));
		expect(line?.minY).toBeCloseTo(y(kde[0]?.x as number));
		expect(line?.maxY).toBeCloseTo(y(kde[kde.length - 1]?.x as number));
		const [lo, hi] = handle.coords.xRange();
		expect(lo).toBeLessThanOrEqual(0);
		expect(hi).toBeGreaterThanOrEqual(peak);
	});

	it("a vertical density sweeps in bottom to top behind one front", () => {
		const kde = gaussianKde(sample);
		const middle =
			((kde[0]?.x as number) + (kde[kde.length - 1]?.x as number)) / 2;
		const [area, line] = draw([
			density.create({
				data: sample,
				orientation: "horizontal",
				progress: 0.5,
			}),
		]);
		expect(area?.clip).toBe(line?.clip);
		const box = clipBounds(area?.clip);
		expect(box?.maxY).toBeCloseTo(y(middle));
		expect(box?.minY).toBeLessThan(y(kde[0]?.x as number));
		expect(box?.maxX).toBeGreaterThan(boxOf(line).maxX);
		expect(box?.minX).toBeLessThan(boxOf(area).minX);
	});

	it("vertical ridgelines stand on a band x axis, rising to the right", () => {
		const [area, line] = draw(
			[
				density.create({
					data: lopsided,
					x: "v",
					series: "g",
					row: true,
					rowHeight: 1,
					orientation: "horizontal",
				}),
			],
			{ legend: false },
		).map(boxOf);
		const band = handle.xBand;
		expect(band?.domain).toEqual(["few", "many"]);
		const left = Math.min(
			x(band?.start("few") ?? 0),
			x((band?.start("few") ?? 0) + 1),
		);
		expect(area?.minX).toBeCloseTo(left);
		expect((line?.maxX as number) - (area?.minX as number)).toBeCloseTo(
			Math.abs(x(1) - x(0)),
		);
	});
});

describe("regressionPlot", () => {
	const points = [1, 2, 3, 4, 5, 6].map((h, i) => ({
		h,
		s: 50 + 5 * h + ([1, -1, 0.5, -0.5, 1, -1][i] as number),
	}));

	it("draws the fitted line with its band, over the data's x span", () => {
		const [band, line] = draw([
			regressionPlot.create({ data: points, x: "h", y: "s" }),
		]).map(boxOf);
		expect(line?.minX).toBeCloseTo(x(1));
		expect(line?.maxX).toBeCloseTo(x(6));
		expect(band?.maxY).toBeGreaterThan(line?.maxY as number);
		expect(band?.minY).toBeLessThan(line?.minY as number);
	});

	it("reveals line and band behind one front along x; level 0 draws no band", () => {
		const items = draw([
			regressionPlot.create({ data: points, x: "h", y: "s", progress: 0.4 }),
			regressionPlot.create({
				data: points,
				x: "h",
				y: "s",
				method: "loess",
				level: 0,
			}),
		]);
		const [band, line, smooth] = items;
		expect(band?.clip).toBe(line?.clip);
		expect(clipBounds(band?.clip)?.maxX).toBeCloseTo(x(1 + 0.4 * 5));
		expect(smooth?.clip).toBeUndefined();
		expect(items).toHaveLength(3);
	});

	it("LOESS draws its standard-error band, and robust keeps an outlier out of it", () => {
		const noisy = Array.from({ length: 30 }, (_, i) => ({
			h: i,
			s:
				i / 2 +
				([0.3, -0.2, 0.1, -0.3, 0.2][i % 5] as number) +
				(i === 15 ? 25 : 0),
		}));
		const widths = (robust: boolean) => {
			const [band, line] = draw(
				[
					regressionPlot.create({
						data: noisy,
						x: "h",
						y: "s",
						method: "loess",
						bandwidth: 0.5,
						robust,
					}),
				],
				{ yRange: [-5, 45] },
			) as [CurveItem, CurveItem];
			expect(band.closed).toBe(true);
			expect(line.closed).toBe(false);
			// The smooth at h = 15, read off the line's points.
			const at15 = line.points.reduce((best, p) =>
				Math.abs(p.x - x(15)) < Math.abs(best.x - x(15)) ? p : best,
			);
			return { band: boxOf(band).maxY - boxOf(band).minY, at15: at15.y };
		};
		const plain = widths(false);
		const robust = widths(true);
		expect(plain.band).toBeGreaterThan(robust.band);
		expect(Math.abs(robust.at15 - y(7.5))).toBeLessThan(
			Math.abs(plain.at15 - y(7.5)),
		);
	});
});
