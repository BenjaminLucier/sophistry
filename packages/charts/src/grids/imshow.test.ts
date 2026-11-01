/**
 * `imshow` drawn as one image: the pixels carry the colours the cells would
 * have, the image lands where the cells would, a non-linear axis falls back
 * to cells, and scrubbing a reveal or a neighbour's blend rebuilds nothing
 * Also `hexCorners`.
 */

import type { CoordinateSystem } from "@sophistry/core";
import { tryParseColor } from "@sophistry/core/color";
import type { ImageSpec } from "@sophistry/core/internal";
import { resolveColormap } from "@sophistry/core/themes";
import { describe, expect, it } from "vitest";
import { chart } from "../chart.js";
import { scatter } from "../points/scatter.js";
import { mount, probe } from "../test-harness.js";
import { hexCorners } from "./hex-bin.js";
import { imshow } from "./imshow.js";
import { itemBox, itemsOf } from "./test-support.js";

const values = [
	[0, 1, 2],
	[3, 4, Number.NaN],
];

const images = (scene: ReturnType<typeof mount>): ImageSpec[] =>
	scene.graph.frame.flatMap((s) =>
		s.kind === "image" ? [s as ImageSpec] : [],
	);

describe("imshow as an image", () => {
	it("colours each pixel as its cell, NaN transparent, row 0 at the top", () => {
		const { node: watcher, seen } = probe();
		const scene = mount(
			chart.create({
				width: 6,
				height: 4,
				xRange: [0, 3],
				yRange: [0, 2],
				children: [imshow.create({ values, ramp: "viridis" }), watcher],
			}),
		);
		const [spec] = images(scene);
		if (!spec) throw new Error("no image");
		expect(spec.pixels.width).toBe(3);
		expect(spec.pixels.height).toBe(2);
		const coords = seen.coords as CoordinateSystem;
		const viridis = resolveColormap("viridis");
		values.forEach((line, row) => {
			line.forEach((value, col) => {
				if (!Number.isFinite(value)) return;
				// The cell's centre (row 0 at the top), through the image's frame.
				const mid = coords.coordsToPoint(col + 0.5, 2 - row - 0.5);
				const { origin: o, xAxis: a, yAxis: b } = spec;
				const det = a.x * b.y - a.y * b.x;
				const u = ((mid.x - o.x) * b.y - (mid.y - o.y) * b.x) / det;
				const v = (a.x * (mid.y - o.y) - a.y * (mid.x - o.x)) / det;
				expect(Math.floor(u * 3)).toBe(col);
				expect(Math.floor(v * 2)).toBe(row);
				const at = 4 * (row * 3 + col);
				const want = tryParseColor(viridis(value / 4));
				// The 256-step table is within one step of the exact ramp colour.
				for (const [k, channel] of (["r", "g", "b"] as const).entries())
					expect(
						Math.abs(
							(spec.pixels.data[at + k] as number) - (want?.[channel] ?? 0),
						),
					).toBeLessThanOrEqual(3);
			});
		});
		// Row 1, column 2 is NaN: no pixel.
		expect(spec.pixels.data[4 * (1 * 3 + 2) + 3]).toBe(0);
		// Row 0 is the top: the image's first row sits above its last.
		expect(spec.yAxis.y).toBeLessThan(0);
	});

	it("draws cells under a log axis, where an image would misplace them", () => {
		const scene = mount(
			chart.create({
				width: 6,
				height: 4,
				xRange: [1, 1000],
				yRange: [0, 2],
				xAxis: { scale: "log" },
				children: [imshow.create({ values, xRange: [1, 1000] })],
			}),
		);
		expect(images(scene)).toHaveLength(0);
		const cells = itemsOf(scene.marks());
		expect(cells).toHaveLength(5);
		// Equal data columns on a log axis: the first spans the most decades.
		const widths = cells
			.slice(0, 3)
			.map((c) => itemBox(c).maxX - itemBox(c).minX);
		expect(widths[0]).toBeGreaterThan(widths[1] as number);
		expect(widths[1]).toBeGreaterThan(widths[2] as number);
	});

	it("draws cells with a stroke", () => {
		const scene = mount(
			chart.create({
				width: 6,
				height: 4,
				xRange: [0, 3],
				yRange: [0, 2],
				children: [
					imshow.create({ values, stroke: "#ffffff", strokeWidth: 0.01 }),
				],
			}),
		);
		expect(images(scene)).toHaveLength(0);
		expect(itemsOf(scene.marks())).toHaveLength(5);
	});

	it("keeps its pixels while a reveal scrubs past the stagger, and while a neighbour blends", () => {
		const layer = imshow.create({
			values: [
				[1, 2, 3],
				[4, 5, 6],
			],
			xRange: [0, 10],
			yRange: [0, 10],
			stagger: 0,
		});
		const before = [
			{ name: "a", x: 1, y: 1 },
			{ name: "b", x: 9, y: 9 },
		];
		const after = [
			{ name: "a", x: 9, y: 1 },
			{ name: "b", x: 1, y: 9 },
		];
		const dots = scatter.create({
			data: before,
			to: after,
			blend: 0,
			key: "name",
			x: "x",
			y: "y",
		});
		const scene = mount(
			chart.create({
				width: 8,
				height: 4,
				xRange: [0, 10],
				yRange: [0, 10],
				children: [layer, dots],
			}),
		);
		const pixels = images(scene)[0]?.pixels;
		expect(pixels).toBeDefined();
		for (const t of [0.1, 0.3, 0.6, 1, 0.5, 0]) {
			dots.set("blend", t);
			layer.set("progress", t);
			scene.commit();
			const [spec] = images(scene);
			expect(spec?.pixels).toBe(pixels);
			expect(spec?.progress).toBeCloseTo(t, 9);
		}
	});

	it("a staggered reveal writes each pixel's share of the fade, and the plain pixels at the end", () => {
		const layer = imshow.create({ values: [[1, 2, 3]], progress: 0.5 });
		const scene = mount(
			chart.create({
				width: 6,
				height: 4,
				xRange: [0, 3],
				yRange: [0, 1],
				children: [layer],
			}),
		);
		const faded = images(scene)[0]?.pixels.data as Uint8ClampedArray;
		const alphas = [3, 7, 11].map((i) => faded[i] as number);
		expect(alphas[0]).toBeGreaterThan(alphas[2] as number);
		layer.set("progress", 1);
		scene.commit();
		const whole = images(scene)[0]?.pixels.data as Uint8ClampedArray;
		expect([3, 7, 11].map((i) => whole[i])).toEqual([255, 255, 255]);
		layer.set("progress", 1);
		scene.commit();
		expect(images(scene)[0]?.pixels.data).toBe(whole);
	});
});

describe("hexCorners", () => {
	it("is a pointy-top hexagon of the data-space radius on both axes", () => {
		const corners = hexCorners(1, 2, 0.5);
		expect(corners).toHaveLength(6);
		expect(corners[0]?.x).toBeCloseTo(1);
		expect(corners[0]?.y).toBeCloseTo(2.5);
		for (const c of corners)
			expect(Math.hypot(c.x - 1, c.y - 2)).toBeCloseTo(0.5);
	});

	it("neighbouring cells share corners in data space, so any axis scale tiles", () => {
		const r = 1;
		const a = hexCorners(0, 0, r);
		const b = hexCorners(Math.sqrt(3) * r, 0, r);
		const shared = a.filter((p) =>
			b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9),
		);
		expect(shared).toHaveLength(2);
	});
});
