/**
 * The unstructured-grid charts: `tripcolor`, `triContour` and `triContourF`,
 * mounted in a `chart` — extent reporting, geometry in scene units, colour
 * (and the ramp they report), the progress-driven reveals and the tooltip —
 * plus the grid `contour`/`contourF`'s matching level stagger.
 */

import type { SceneNode } from "@sophistry/core";
import { axes } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { cssColor } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import {
	tricontourBands,
	tricontourLines,
	tripcolorFaces,
} from "../math/tricontour";
import type { MarkItem } from "../test-harness";
import { mount } from "../test-harness";
import { contour } from "./contour";
import { contourF } from "./contour-f";
import { itemsOf, inChart as mountChart, recorder } from "./test-support";
import { triContour, triContourF } from "./tri-contour";
import { tripcolor } from "./tripcolor";

type Sample = { x: number; y: number; v: number };

// A 6 × 5 lattice over [0, 5] × [0, 4], nudged so the Delaunay mesh is
// unique; v = x + 2y.
const samples: Sample[] = [];
for (let j = 0; j < 5; j++) {
	for (let i = 0; i < 6; i++) {
		const nudge = (i + j) % 3 === 0 && i > 0 && i < 5 ? 0.01 : 0;
		samples.push({ x: i + nudge, y: j, v: i + nudge + 2 * j });
	}
}
const xs = samples.map((s) => s.x);
const ys = samples.map((s) => s.y);
const vs = samples.map((s) => s.v);

/** Mounts `layer` in a 5 × 4 chart over exactly the data's box, no axes. */
function inChart(layer: SceneNode, progress?: number) {
	return mountChart(
		{
			width: 5,
			height: 4,
			xRange: [0, 5],
			yRange: [0, 4],
			axis: { visible: false },
			progress,
		},
		layer,
	);
}

/** The batched items of a scene, with their whole reveal. */
const drawn = (scene: ReturnType<typeof inChart>) => itemsOf(scene.marks());
const lineOf = (item: MarkItem): Point[] => item.polylines[0] ?? [];

describe("tripcolor", () => {
	it("fits a fitted chart to the points' extent", () => {
		const scene = mountChart(
			{ width: 5, height: 4 },
			tripcolor.create({ data: samples, x: "x", y: "y", value: "v" }),
		);
		const [x0, x1] = scene.handle().coords.xRange();
		const [y0, y1] = scene.handle().coords.yRange();
		expect(x0).toBeLessThanOrEqual(0);
		expect(x1).toBeGreaterThanOrEqual(5);
		expect(y0).toBeLessThanOrEqual(0);
		expect(y1).toBeGreaterThanOrEqual(4);
	});

	it("draws one face per triangle, coloured through the ramp by its mean value", () => {
		const faces = tripcolorFaces(xs, ys, vs);
		const scene = inChart(
			tripcolor.create({
				data: samples,
				x: "x",
				y: "y",
				value: "v",
				ramp: ["#000000", "#ffffff"],
			}),
		);
		const items = drawn(scene);
		expect(scene.marks()).toHaveLength(1);
		expect(items).toHaveLength(faces.length);
		// The chart maps data 1:1 around the origin: x - 2.5, y - 2.
		const first = lineOf(items[0] as MarkItem);
		expect(first[0]?.x).toBeCloseTo((faces[0]?.points[0]?.x as number) - 2.5);
		expect(first[0]?.y).toBeCloseTo((faces[0]?.points[0]?.y as number) - 2);
		// The lowest-valued face is the darkest.
		const lowest = faces.reduce(
			(best, f, i) => (f.value < (faces[best]?.value as number) ? i : best),
			0,
		);
		expect(items[lowest]?.fill).toBe("rgba(0, 0, 0, 1)");
	});

	it("uses the caller's triangles", () => {
		const scene = inChart(
			tripcolor.create({
				data: samples,
				x: "x",
				y: "y",
				value: "v",
				triangles: [
					[0, 1, 6],
					[1, 7, 6],
				],
			}),
		);
		expect(drawn(scene)).toHaveLength(2);
	});

	it("reveals as a diagonal wave from the top-left, a pure function of progress", () => {
		const at = (progress: number) =>
			drawn(
				inChart(
					tripcolor.create({
						data: samples,
						x: "x",
						y: "y",
						value: "v",
						progress,
					}),
				),
			);
		expect(at(0)).toHaveLength(0);
		const half = at(0.5);
		const faces = tripcolorFaces(xs, ys, vs);
		expect(half.length).toBeGreaterThan(0);
		expect(half.length).toBeLessThan(faces.length);
		// Every visible face sits nearer the top-left than every fading one.
		const score = (item: MarkItem) => {
			const pts = lineOf(item);
			const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
			const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
			return cx / 5 - cy / 4;
		};
		const opaque = half.filter((s) => s.progress === 1).map(score);
		const fading = half.filter((s) => s.progress < 1).map(score);
		expect(opaque.length).toBeGreaterThan(0);
		expect(Math.max(...opaque)).toBeLessThanOrEqual(Math.min(...fading) + 1e-9);
		expect(at(1).every((s) => s.progress === 1)).toBe(true);
	});

	it("waits for the frame under a chart's progress", () => {
		const scene = inChart(
			tripcolor.create({ data: samples, x: "x", y: "y", value: "v" }),
			0.4,
		);
		expect(drawn(scene)).toHaveLength(0);
	});

	it("names each face by its value for the tooltip", () => {
		const scene = mountChart(
			{ width: 5, height: 4, xRange: [0, 5], yRange: [0, 4] },
			tripcolor.create({
				data: samples,
				x: "x",
				y: "y",
				value: "v",
				tooltip: true,
				triangles: [[0, 1, 6]],
			}),
		);
		// The path batch node: the layer's only child.
		const layer = findType(scene.graph.root, "PathBatch");
		const itemLabel = layer?.get("itemLabel" as never) as
			| ((item: number) => string | undefined)
			| undefined;
		// (0 + 1 + 2) / 3
		expect(itemLabel?.(0)).toBe("1");
	});
});

/** The first node of `type` under `node`, depth first. */
function findType(node: SceneNode, type: string): SceneNode | undefined {
	if (node.type === type) return node;
	for (const child of (node as { children?: readonly SceneNode[] }).children ??
		[]) {
		const found = findType(child, type);
		if (found) return found;
	}
	return undefined;
}

describe("triContour", () => {
	it("draws every iso-line, straight for a linear field", () => {
		const lines = tricontourLines(xs, ys, vs, [3, 7]);
		const scene = inChart(
			triContour.create({
				data: samples,
				x: "x",
				y: "y",
				value: "v",
				levels: [3, 7],
				stroke: "#123456",
			}),
		);
		const items = drawn(scene);
		for (const item of items) expect(item.stroke).toBe(cssColor("#123456"));
		expect(items).toHaveLength(lines.length);
		for (const [k, item] of items.entries()) {
			for (const p of lineOf(item)) {
				// Back to data: x + 2.5, y + 2; x + 2y = level.
				expect(p.x + 2.5 + 2 * (p.y + 2)).toBeCloseTo(
					lines[k]?.level as number,
					6,
				);
			}
		}
	});

	it("reveals level by level, lowest first, each line drawing along its length", () => {
		const whole = drawn(
			inChart(
				triContour.create({
					data: samples,
					x: "x",
					y: "y",
					value: "v",
					levels: [2, 5, 8],
					stroke: "#123456",
				}),
			),
		);
		const items = drawn(
			inChart(
				triContour.create({
					data: samples,
					x: "x",
					y: "y",
					value: "v",
					levels: [2, 5, 8],
					stroke: "#123456",
					progress: 0.4,
				}),
			),
		);
		// stagger 0.5 over 3 levels: starts at 0, 0.25, 0.5; at 0.4 the first
		// is 80% drawn, the second 30%, the third hidden. Each is the whole
		// line, traced to its reveal.
		expect(items).toHaveLength(2);
		expect(items[0]?.reveal).toBeCloseTo(0.8);
		expect(items[1]?.reveal).toBeCloseTo(0.3);
		items.forEach((item, k) => {
			expect(lineOf(item)).toEqual(lineOf(whole[k] as MarkItem));
		});
	});
});

describe("triContourF", () => {
	it("fills one item per band, its pieces one outline", () => {
		const bands = tricontourBands(xs, ys, vs, [0, 4, 8, 13]);
		const items = drawn(
			inChart(
				triContourF.create({
					data: samples,
					x: "x",
					y: "y",
					value: "v",
					levels: [0, 4, 8, 13],
				}),
			),
		);
		expect(items).toHaveLength(3);
		items.forEach((item, i) => {
			expect(item.polylines).toHaveLength(bands[i]?.polygons.length as number);
		});
		// The ramp runs low to high: distinct colours per band.
		expect(new Set(items.map((s) => s.fill)).size).toBe(3);
	});

	it("fades the bands in lowest first", () => {
		const items = drawn(
			inChart(
				triContourF.create({
					data: samples,
					x: "x",
					y: "y",
					value: "v",
					levels: [0, 4, 8, 13],
					progress: 0.4,
				}),
			),
		);
		expect(items).toHaveLength(2);
		expect(items[0]?.progress).toBeCloseTo(0.8);
		expect(items[1]?.progress).toBeCloseTo(0.3);
	});
});

describe("colour bar", () => {
	it("tripcolor and triContourF report their ramp and cover the plot", () => {
		for (const layer of [
			tripcolor.create({
				data: samples,
				x: "x",
				y: "y",
				value: "v",
				ramp: "viridis",
				rampMin: 0,
				rampMax: 20,
			}),
			triContourF.create({
				data: samples,
				x: "x",
				y: "y",
				value: "v",
				ramp: "viridis",
			}),
		]) {
			const { node, reports } = recorder(
				axes.create({
					xRange: [0, 5, 1],
					yRange: [0, 4, 1],
					width: 5,
					height: 4,
					children: [layer],
				} as never),
			);
			mount(node);
			const [report] = reports();
			expect(report?.covers).toBe(true);
			expect(report?.ramp).toBeDefined();
		}
	});

	it("tripcolor's ramp spans rampMin..rampMax", () => {
		const { node, reports } = recorder(
			axes.create({
				xRange: [0, 5, 1],
				yRange: [0, 4, 1],
				width: 5,
				height: 4,
				children: [
					tripcolor.create({
						data: samples,
						x: "x",
						y: "y",
						value: "v",
						rampMin: 0,
						rampMax: 20,
					}),
				],
			} as never),
		);
		mount(node);
		expect(reports()[0]?.ramp?.domain).toEqual([0, 20]);
	});

	it("<Chart colorbar> draws the bar for these layers with ticks over rampMin..rampMax", () => {
		const gradientBars = (scene: ReturnType<typeof mount>) =>
			scene
				.shapes()
				.filter(
					(s) =>
						typeof s.style.fill === "object" &&
						s.style.fill !== null &&
						"stops" in s.style.fill,
				);
		for (const layer of [
			tripcolor.create({
				data: samples,
				x: "x",
				y: "y",
				value: "v",
				ramp: "viridis",
				rampMin: 0,
				rampMax: 20,
			}),
			triContourF.create({
				data: samples,
				x: "x",
				y: "y",
				value: "v",
				ramp: "viridis",
			}),
		]) {
			const scene = mountChart(
				{ width: 5, height: 4, xRange: [0, 5], yRange: [0, 4], colorbar: true },
				layer,
			);
			expect(gradientBars(scene)).toHaveLength(1);
		}
		const scene = mountChart(
			{ width: 5, height: 4, xRange: [0, 5], yRange: [0, 4], colorbar: true },
			tripcolor.create({
				data: samples,
				x: "x",
				y: "y",
				value: "v",
				rampMin: 0,
				rampMax: 20,
			}),
		);
		expect(scene.texts().map((t) => t.text)).toEqual(
			expect.arrayContaining(["0", "20"]),
		);
	});
});

describe("grid contour and contourF stagger", () => {
	// The same plane as the samples, on a grid: v = x + 2y.
	const gx = [0, 1, 2, 3, 4, 5];
	const gy = [0, 1, 2, 3, 4];
	const grid = gy.map((y) => gx.map((x) => x + 2 * y));
	const lines = (extra: Record<string, unknown>) =>
		drawn(
			inChart(
				contour.create({
					xs: gx,
					ys: gy,
					values: grid,
					levels: [2, 5, 8],
					stroke: "#123456",
					...extra,
				}),
			),
		);

	it("contour draws every level at once by default", () => {
		const whole = lines({});
		const items = lines({ progress: 0.4 });
		expect(items).toHaveLength(3);
		items.forEach((item, k) => {
			expect(item.reveal).toBeCloseTo(0.4);
			expect(lineOf(item)).toEqual(lineOf(whole[k] as MarkItem));
		});
	});

	it("contour with stagger reveals level by level, like triContour", () => {
		const whole = lines({});
		const items = lines({ progress: 0.4, stagger: 0.5 });
		// Same schedule as triContour's: 80%, 30%, not started.
		expect(items).toHaveLength(2);
		expect(items[0]?.reveal).toBeCloseTo(0.8);
		expect(items[1]?.reveal).toBeCloseTo(0.3);
		items.forEach((item, k) => {
			expect(lineOf(item)).toEqual(lineOf(whole[k] as MarkItem));
		});
	});

	it("contourF with stagger fades the bands in lowest first, like triContourF", () => {
		const bands = (extra: Record<string, unknown>) =>
			inChart(
				contourF.create({
					xs: gx,
					ys: gy,
					values: grid,
					levels: [0, 4, 8, 13],
					progress: 0.4,
					...extra,
				}),
			);
		const staggered = bands({ stagger: 0.5 });
		const fills = drawn(staggered);
		expect(fills).toHaveLength(2);
		expect(fills[0]?.progress).toBeCloseTo(0.8);
		expect(fills[1]?.progress).toBeCloseTo(0.3);
		expect(staggered.marks()[0]?.progress).toBe(1);

		// Unstaggered, every band has the layer's reveal as its
		// `progress`: the fill comes up with it.
		const plain = bands({});
		const unstaggered = drawn(plain);
		expect(unstaggered).toHaveLength(3);
		for (const item of unstaggered) {
			expect(item.progress).toBe(1);
			expect(item.reveal).toBeCloseTo(0.4);
		}
	});
});
