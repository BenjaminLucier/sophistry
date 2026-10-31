/**
 * The gridded colour layers (`pcolormesh`, `hist2d`, `hexBin`, `imshow`) and
 * the other covering layers: their batched items, their paint order under
 * the axes, and the reading-order fade.
 */

import type { CoordinateSystem, SceneNode } from "@sophistry/core";
import { axes, UNDER_AXES_Z_INDEX } from "@sophistry/core";
import type { ImageSpec } from "@sophistry/core/internal";
import { cssColor } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import type { ChartProps } from "../chart";
import { chart } from "../chart";
import { scatter } from "../points/scatter";
import {
	GRID_STAGGER_LIMIT,
	gridStagger,
	readingRanks,
	reversedAxes,
} from "../stagger";
import { mount, probe, theme } from "../test-harness";
import { cells } from "./cells";
import { contour } from "./contour";
import { contourF } from "./contour-f";
import { hexBin } from "./hex-bin";
import { hist2d } from "./hist2d";
import { imshow } from "./imshow";
import { pcolormesh } from "./pcolormesh";
import { itemBox, itemCentre, itemsOf } from "./test-support";
import { triContourF } from "./tri-contour";
import { tripcolor } from "./tripcolor";

const grid = [
	[1, 2, 3],
	[4, 5, 6],
];
const xs = [0, 1, 2];
const ys = [0, 1];
const points = [
	{ x: 0.5, y: 0.5, v: 1 },
	{ x: 2.5, y: 0.5, v: 2 },
	{ x: 0.5, y: 1.5, v: 3 },
	{ x: 2.5, y: 1.5, v: 4 },
	{ x: 1.5, y: 1, v: 5 },
];
type Extra = { zIndex?: number; progress?: number; stagger?: number };
const covering: Record<string, (extra: Extra) => SceneNode> = {
	Imshow: (extra) => imshow.create({ values: grid, ...extra }),
	Pcolormesh: (extra) =>
		pcolormesh.create({
			xs: [0, 1, 2, 3],
			ys: [0, 1, 2],
			values: grid,
			...extra,
		}),
	Hist2D: (extra) =>
		hist2d.create({
			data: points,
			x: "x",
			y: "y",
			xBins: 2,
			yBins: 2,
			xRange: [0, 3],
			yRange: [0, 2],
			...extra,
		}),
	HexBin: (extra) =>
		hexBin.create({ data: points, x: "x", y: "y", radius: 0.6, ...extra }),
	ContourF: (extra) =>
		contourF.create({ xs, ys, values: grid, levels: 3, ...extra }),
	TriContourF: (extra) =>
		triContourF.create({
			data: points,
			x: "x",
			y: "y",
			value: "v",
			levels: 3,
			...extra,
		}),
	Tripcolor: (extra) =>
		tripcolor.create({ data: points, x: "x", y: "y", value: "v", ...extra }),
};

const inAxes = (layer: SceneNode) =>
	axes.create({
		xRange: [0, 3, 1],
		yRange: [0, 2, 1],
		width: 6,
		height: 4,
		children: [layer],
	} as never);
const inChart = (layer: SceneNode) =>
	chart.create({
		width: 6,
		height: 4,
		xRange: [0, 3],
		yRange: [0, 2],
		children: [layer],
	});

/** The z of every batched layer and image in a scene. */
function layerZs(scene: ReturnType<typeof mount>): number[] {
	return scene.graph.frame.flatMap((s) =>
		s.kind === "marks" || s.kind === "image" ? [s.zIndex] : [],
	);
}

describe("batched gridded layers", () => {
	it("pcolormesh draws one rect per cell, each between its edges, coloured by value", () => {
		const { node: watcher, seen } = probe();
		const scene = mount(
			chart.create({
				width: 6,
				height: 4,
				xRange: [0, 4],
				yRange: [0, 3],
				children: [
					pcolormesh.create({
						xs: [0, 1, 2.5, 4],
						ys: [0, 2, 3],
						values: [
							[1, 2, 3],
							[4, 5, 6],
						],
						ramp: ["#000000", "#ffffff"],
					}),
					watcher,
				],
			}),
		);
		const coords = seen.coords as CoordinateSystem;
		const marks = scene.marks();
		expect(marks).toHaveLength(1);
		expect(marks[0]?.shape.kind).toBe("rect");
		const items = itemsOf(marks);
		expect(items).toHaveLength(6);
		const xEdges = [0, 1, 2.5, 4];
		const yEdges = [0, 2, 3];
		items.forEach((item, i) => {
			const row = Math.floor(i / 3);
			const col = i % 3;
			const a = coords.coordsToPoint(
				xEdges[col] as number,
				yEdges[row] as number,
			);
			const b = coords.coordsToPoint(
				xEdges[col + 1] as number,
				yEdges[row + 1] as number,
			);
			const box = itemBox(item);
			expect(box.minX).toBeCloseTo(Math.min(a.x, b.x), 9);
			expect(box.maxX).toBeCloseTo(Math.max(a.x, b.x), 9);
			expect(box.minY).toBeCloseTo(Math.min(a.y, b.y), 9);
			expect(box.maxY).toBeCloseTo(Math.max(a.y, b.y), 9);
		});
		expect(new Set(items.map((item) => item.fill)).size).toBe(6);
		expect(items[0]?.fill).toBe("rgba(0, 0, 0, 1)");
		expect(items[5]?.fill).toBe("rgba(255, 255, 255, 1)");
	});

	it("hist2d draws a rect per nonempty bin, coloured by count", () => {
		const data = [
			{ x: 0.5, y: 0.5 },
			{ x: 0.6, y: 0.4 },
			{ x: 3.5, y: 2.5 },
			{ x: 2, y: 1 },
		];
		const scene = mount(
			chart.create({
				width: 6,
				height: 4,
				xRange: [0, 4],
				yRange: [0, 3],
				children: [
					hist2d.create({
						data,
						x: "x",
						y: "y",
						xBins: 4,
						yBins: 3,
						xRange: [0, 4],
						yRange: [0, 3],
						ramp: ["#000000", "#ffffff"],
					}),
				],
			}),
		);
		const items = itemsOf(scene.marks());
		expect(items).toHaveLength(3);
		// The bin holding two points is the fullest: the top of the ramp.
		const full = items.filter((item) => item.fill === "rgba(255, 255, 255, 1)");
		expect(full).toHaveLength(1);
		for (const item of items) {
			expect(item.halfWidth * 2).toBeCloseTo(6 / 4, 9);
			expect(item.halfHeight * 2).toBeCloseTo(4 / 3, 9);
		}
	});

	it("tweens a cell's colour through the bank with `transition`", () => {
		const mesh = pcolormesh.create({
			xs: [0, 1],
			ys: [0, 1],
			values: [[1]],
			rampMin: 0,
			rampMax: 10,
			ramp: ["#000000", "#ffffff"],
			transition: { duration: 1, easing: "linear" },
		});
		const scene = mount(inChart(mesh));
		const fill = () => itemsOf(scene.marks())[0]?.fill;
		const before = fill();
		mesh.set("values", [[9]]);
		scene.commit();
		scene.advance(0.5);
		const middle = fill();
		scene.advance(0.6);
		expect(middle).not.toBe(before);
		expect(middle).not.toBe(fill());
	});
});

describe("covering layers paint under the axes", () => {
	for (const [name, build] of Object.entries(covering)) {
		it(`${name}: under axes and chart axes, an explicit z kept`, () => {
			for (const frame of [inAxes, inChart]) {
				const scene = mount(frame(build({})));
				const zs = layerZs(scene);
				expect(zs.length).toBeGreaterThan(0);
				for (const z of zs) expect(z).toBe(UNDER_AXES_Z_INDEX);
				const numbers = scene.texts().map((t) => t.zIndex);
				expect(numbers.length).toBeGreaterThan(0);
				for (const z of numbers) expect(z).toBeGreaterThan(UNDER_AXES_Z_INDEX);
			}
			const pinned = layerZs(mount(inAxes(build({ zIndex: 3 }))));
			expect(pinned.length).toBeGreaterThan(0);
			for (const z of pinned) expect(z).toBe(3);
		});
	}

	it("line contours stay at the default z, like any graph", () => {
		const scene = mount(
			inAxes(contour.create({ xs, ys, values: grid, levels: 3 })),
		);
		const zs = layerZs(scene);
		expect(zs).toEqual([0]);
		expect(itemsOf(scene.marks()).length).toBeGreaterThan(0);
	});
});

/**
 * Every cell's scene centre and reveal: batched items (their fade times
 * their own `progress`), or an
 * image's pixels.
 */
function onScreen(scene: ReturnType<typeof mount>) {
	const cells = itemsOf(scene.marks()).map((item) => ({
		...itemCentre(item),
		progress: item.progress * item.reveal,
	}));
	for (const spec of scene.graph.frame) {
		if (spec.kind !== "image") continue;
		const image = spec as ImageSpec;
		const { width, height, data } = image.pixels;
		for (let row = 0; row < height; row++) {
			for (let col = 0; col < width; col++) {
				const alpha = (data[4 * (row * width + col) + 3] as number) / 255;
				if (alpha === 0 && image.progress > 0) continue;
				const u = (col + 0.5) / width;
				const v = (row + 0.5) / height;
				cells.push({
					x: image.origin.x + u * image.xAxis.x + v * image.yAxis.x,
					y: image.origin.y + u * image.xAxis.y + v * image.yAxis.y,
					progress: alpha * image.progress * image.opacity,
				});
			}
		}
	}
	return cells;
}

describe("gridded layers fade in reading order", () => {
	it("ranks the top row first, each row left to right; a reversed axis from its far end", () => {
		const cells = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
		];
		expect(readingRanks(cells)).toEqual([2, 3, 0, 1]);
		expect(readingRanks(cells, { y: true })).toEqual([0, 1, 2, 3]);
		expect(readingRanks(cells, { x: true })).toEqual([3, 2, 1, 0]);
		expect(reversedAxes([0, 3], [2, 0])).toEqual({ x: false, y: true });
	});

	it("defaults to a 0.5 stagger, one fade for big grids, the given one always", () => {
		expect(gridStagger(undefined, 12)).toBe(0.5);
		expect(gridStagger(undefined, GRID_STAGGER_LIMIT + 1)).toBe(0);
		expect(gridStagger(0.2, GRID_STAGGER_LIMIT + 1)).toBe(0.2);
		expect(gridStagger(0, 12)).toBe(0);
	});

	const layers = ["Imshow", "Pcolormesh", "Hist2D", "HexBin"] as const;
	const at = (name: (typeof layers)[number], extra: Extra) =>
		onScreen(
			mount(
				chart.create({
					width: 6,
					height: 4,
					xRange: [0, 3],
					yRange: [0, 3],
					children: [covering[name]?.(extra) as SceneNode],
				}),
			),
		);

	for (const name of layers) {
		it(`${name}: the top row ahead of the bottom, left ahead of right`, () => {
			const cells = at(name, { progress: 0.5 });
			expect(cells.length).toBeGreaterThan(1);
			const order = [...cells].sort((a, b) => b.y - a.y || a.x - b.x);
			// Reading order is reveal order: progress never rises along it.
			for (let i = 1; i < order.length; i++)
				expect(order[i]?.progress).toBeLessThanOrEqual(
					(order[i - 1]?.progress as number) + 1e-9,
				);
			expect(order[0]?.progress).toBeGreaterThan(
				order[order.length - 1]?.progress as number,
			);
			// Whole at the end; together with `stagger: 0`.
			for (const cell of at(name, { progress: 1 }))
				expect(cell.progress).toBeCloseTo(1, 2);
			for (const cell of at(name, { progress: 0.5, stagger: 0 }))
				expect(cell.progress).toBeCloseTo(0.5, 2);
		});

		it(`${name}: a reversed y (or x) axis still fades top row first, left to right`, () => {
			const frames = [
				(layer: SceneNode) =>
					chart.create({
						width: 6,
						height: 4,
						xRange: [0, 3],
						yRange: [0, 2],
						yAxis: { reverse: true },
						children: [layer],
					}),
				(layer: SceneNode) =>
					axes.create({
						xRange: [3, 0, 1],
						yRange: [0, 2, 1],
						width: 6,
						height: 4,
						children: [layer],
					} as never),
			];
			for (const frame of frames) {
				const order = onScreen(
					mount(frame(covering[name]?.({ progress: 0.5 }) as SceneNode)),
				).sort((a, b) => b.y - a.y || a.x - b.x);
				expect(order.length).toBeGreaterThan(1);
				for (let i = 1; i < order.length; i++)
					expect(order[i]?.progress).toBeLessThanOrEqual(
						(order[i - 1]?.progress as number) + 1e-9,
					);
				expect(order[0]?.progress).toBeGreaterThan(
					order[order.length - 1]?.progress as number,
				);
			}
		});
	}
});

describe("axis text over a covering layer has a halo", () => {
	const background = cssColor(theme.palette.background);
	/** Every text spec's halo, with its text. */
	const halos = (scene: ReturnType<typeof mount>) =>
		scene.texts().map((s) => ({ text: s.text, halo: s.style.halo }));
	const withLine = (extra: Partial<ChartProps> = {}) =>
		chart.create({
			width: 6,
			height: 4,
			xRange: [-1, 3],
			yRange: [-1, 2],
			xLabel: "x",
			yLabel: "y",
			...extra,
			children: [
				scatter.create({
					data: [
						{ x: 0, y: 0 },
						{ x: 1, y: 1 },
					],
					x: "x",
					y: "y",
				}),
			],
		});

	for (const [name, build] of Object.entries(covering)) {
		it(`${name}: numbers and titles get one in the background colour`, () => {
			const scene = mount(
				chart.create({
					width: 6,
					height: 4,
					xRange: [0, 3],
					yRange: [0, 2],
					xLabel: "x",
					yLabel: "y",
					children: [build({})],
				}),
			);
			const all = halos(scene);
			expect(all.length).toBeGreaterThan(2);
			for (const { halo } of all) {
				expect(halo).toMatchObject({ color: background });
				expect((halo as { width: number }).width).toBeGreaterThan(0);
			}
		});
	}

	it("is off without a covering layer, and an axis's labelHalo wins either way", () => {
		for (const { halo } of halos(mount(withLine())))
			expect(halo).toBeUndefined();
		// Asked for over plain marks: a quarter of the font size wide.
		const asked = halos(mount(withLine({ axis: { numberHalo: true } })));
		const numbers = asked.filter((t) => t.text !== "x" && t.text !== "y");
		expect(numbers.length).toBeGreaterThan(0);
		for (const { halo } of numbers)
			expect((halo as { width: number }).width).toBeCloseTo(0.3 * 0.25);
		// Switched off on x over a covering layer: y keeps its own.
		const scene = mount(
			chart.create({
				width: 6,
				height: 4,
				xRange: [10, 13],
				yRange: [0, 5],
				xAxis: { numberHalo: false },
				yAxis: { numberHalo: { color: "#ff0000", width: 0.1 } },
				xLabel: "x",
				yLabel: "y",
				children: [covering.Imshow?.({}) as SceneNode],
			}),
		);
		const byText = new Map(halos(scene).map((t) => [t.text, t.halo]));
		expect(byText.get("x")).toBeUndefined();
		expect(byText.get("12")).toBeUndefined();
		expect(byText.get("y")).toEqual({ color: "#ff0000", width: 0.1 });
		expect(byText.get("4")).toEqual({ color: "#ff0000", width: 0.1 });
	});

	it("leaves the numbers of an axis coloured by hand to their own contrast", () => {
		const scene = mount(
			chart.create({
				width: 6,
				height: 4,
				xRange: [10, 13],
				yRange: [0, 5],
				axis: { stroke: "#ffffff" },
				xLabel: "x",
				children: [covering.Imshow?.({}) as SceneNode],
			}),
		);
		const byText = new Map(halos(scene).map((t) => [t.text, t.halo]));
		expect(byText.get("12")).toBeUndefined();
		expect(byText.get("4")).toBeUndefined();
		// The title is in the theme's ink, so it keeps its halo.
		expect(byText.get("x")).toMatchObject({ color: background });
		const asked = mount(
			chart.create({
				width: 6,
				height: 4,
				xRange: [10, 13],
				yRange: [0, 5],
				axis: { stroke: "#ffffff", numberHalo: { color: "#000000" } },
				children: [covering.Imshow?.({}) as SceneNode],
			}),
		);
		const dark = new Map(halos(asked).map((t) => [t.text, t.halo]));
		expect(dark.get("12")).toMatchObject({ color: "#000000" });
	});

	it("band axes' names get it too, and axes takes numberHalo", () => {
		const scene = mount(
			chart.create({
				width: 6,
				height: 3,
				children: [
					cells.create({
						data: [
							{ c: "a", r: "x", n: 1 },
							{ c: "b", r: "x", n: 2 },
						],
						x: "c",
						y: "r",
						value: "n",
					}),
				],
			}),
		);
		const names = halos(scene).filter((t) => ["a", "b", "x"].includes(t.text));
		expect(names.length).toBe(3);
		for (const { halo } of names)
			expect(halo).toMatchObject({ color: background });
		const plain = mount(
			axes.create({
				xRange: [0, 3, 1],
				yRange: [0, 2, 1],
				width: 6,
				height: 4,
				axis: { numberHalo: true },
				xLabel: "x",
			} as never),
		);
		const all = halos(plain);
		expect(all.length).toBeGreaterThan(2);
		for (const { halo } of all)
			expect(halo).toMatchObject({ color: background });
	});
});
