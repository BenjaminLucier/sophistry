/**
 * Structural tests for the 3D charts: what each draws (counts, colours,
 * forwarded props), that `z` is data and `zIndex` paint order, that
 * a data update reconciles the drawn nodes by position instead of
 * rebuilding them, and that a camera move only re-projects (the chart's
 * world geometry keeps its identity).
 */

import { camera3D } from "@sophistry/3d";
import type { SceneNode } from "@sophistry/core";
import { frameContext, themeContext, track } from "@sophistry/core";
import { cssColor, SceneGraph, type ShapeSpec } from "@sophistry/core/internal";
import { resolveTheme } from "@sophistry/core/themes";
import { describe, expect, it } from "vitest";
import { barChart3D } from "./bar-chart3d";
import { charts3DDefinitions } from "./definitions";
import { quiver3D } from "./quiver3d";
import { scatter3D } from "./scatter3d";
import { stem3D } from "./stem3d";
import { surfaceGrid3D } from "./surface-grid3d";
import { triSurface3D } from "./tri-surface3d";
import { voxels3D } from "./voxels3d";
import { wireframe3D } from "./wireframe3d";

const theme = resolveTheme({ mode: "dark" });
const EYE = { x: 4, y: 3, z: 5 };

/** A graph committed by hand, with `chart` under a camera at `EYE`. */
function mount(chart: SceneNode) {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	graph.root.provide(
		frameContext,
		track({ minX: -8, minY: -4.5, maxX: 8, maxY: 4.5 }),
	);
	const camera = camera3D.create({ eye: EYE, children: [chart] });
	graph.root.add(camera);
	graph.commit();
	return {
		camera,
		commit: () => graph.commit(),
		/** The shape specs in paint order. */
		shapes: () => graph.frame.filter((s): s is ShapeSpec => s.kind === "shape"),
	};
}

/** The chart's drawn nodes. */
const childrenOf = (chart: SceneNode) =>
	(chart as unknown as { children: readonly SceneNode[] }).children;

/** A drawn node's prop, read loosely. */
const prop = (node: SceneNode, key: string) =>
	(node as SceneNode<Record<string, unknown>>).get(key);

/** A 3D primitive's cached world geometry. */
const worldOf = (node: SceneNode) =>
	(node as unknown as { world: unknown }).world;

const rows = [
	{ x: 0, y: 0, z: 0, h: 1 },
	{ x: 1, y: 0, z: 1, h: 2 },
	{ x: 2, y: 0, z: 2, h: 3 },
];

describe("charts3DDefinitions", () => {
	it("lists every 3D chart by export name, sorted", () => {
		const names = Object.keys(charts3DDefinitions);
		expect(names).toEqual([...names].sort());
		expect(names).toEqual([
			"barChart3D",
			"quiver3D",
			"scatter3D",
			"stem3D",
			"surfaceGrid3D",
			"triSurface3D",
			"voxels3D",
			"wireframe3D",
		]);
		expect(charts3DDefinitions.barChart3D.name).toBe("BarChart3D");
		expect(Object.isFrozen(charts3DDefinitions)).toBe(true);
	});
});

describe("barChart3D", () => {
	it("draws one box per finite datum, anchored at its corner", () => {
		const chart = barChart3D.create({
			data: [...rows, { x: Number.NaN, y: 0, z: 0, h: 1 }],
			x: "x",
			y: "y",
			z: "z",
			height: "h",
			width: 0.5,
		});
		mount(chart);
		const boxes = childrenOf(chart);
		expect(boxes).toHaveLength(3);
		expect(boxes.every((box) => box.type === "Prism3D")).toBe(true);
		expect(prop(boxes[1], "center")).toEqual({ x: 1.25, y: 1, z: 1.5 });
		expect(prop(boxes[1], "width")).toBe(0.5);
		expect(prop(boxes[1], "height")).toBe(2);
		expect(prop(boxes[1], "depth")).toBe(1);
	});

	it("cycles the theme's series colours; `color` wins over `colors`", () => {
		const chart = barChart3D.create({
			data: rows,
			x: "x",
			y: "y",
			z: "z",
			height: "h",
		});
		const scene = mount(chart);
		const series = theme.palette.series;
		expect(childrenOf(chart).map((box) => prop(box, "fill"))).toEqual(
			rows.map((_, i) => cssColor(series[i % series.length])),
		);

		chart.set("colors", ["#f00", "#0f0"]);
		// A colour function may return nothing for a datum: the palette applies.
		chart.set("color", ((_d: unknown, i: number) =>
			i === 1 ? "#00f" : undefined) as unknown as (d: unknown) => string);
		scene.commit();
		expect(childrenOf(chart).map((box) => prop(box, "fill"))).toEqual([
			cssColor("#f00"),
			cssColor("#00f"),
			cssColor("#f00"),
		]);
	});

	it("forwards mesh props to every box, also when they change later", () => {
		const chart = barChart3D.create({
			data: rows,
			x: "x",
			y: "y",
			z: "z",
			height: "h",
			light: { ambient: 1 },
		});
		const scene = mount(chart);
		const boxes = childrenOf(chart);
		expect(
			boxes.every(
				(box) => (prop(box, "light") as { ambient?: number })?.ambient === 1,
			),
		).toBe(true);
		const worlds = boxes.map(worldOf);
		chart.set("opacity", 0.5);
		scene.commit();
		expect(childrenOf(chart)).toEqual(boxes);
		expect(boxes.every((box) => prop(box, "opacity") === 0.5)).toBe(true);
		// A forwarded prop does not re-place the boxes.
		expect(boxes.map(worldOf)).toEqual(worlds);
		expect(boxes.map(worldOf).every((w, i) => w === worlds[i])).toBe(true);
	});

	it("reconciles boxes by position on a data update", () => {
		const chart = barChart3D.create({
			data: rows,
			x: "x",
			y: "y",
			z: "z",
			height: "h",
		});
		const scene = mount(chart);
		const [first, second, third] = childrenOf(chart);
		const firstWorld = worldOf(first);

		chart.set("data", [rows[0], { ...rows[1], h: 5 }]);
		scene.commit();
		const next = childrenOf(chart);
		expect(next).toHaveLength(2);
		expect(next[0]).toBe(first);
		expect(next[1]).toBe(second);
		expect(third.disposed).toBe(true);
		expect(prop(second, "height")).toBe(5);
		// The unchanged box kept its faces.
		expect(worldOf(first)).toBe(firstWorld);

		chart.set("data", [...rows, { x: 3, y: 0, z: 3, h: 1 }]);
		scene.commit();
		expect(childrenOf(chart)).toHaveLength(4);
		expect(childrenOf(chart)[0]).toBe(first);
	});

	it("a camera move re-projects without rebuilding the boxes", () => {
		const chart = barChart3D.create({
			data: rows,
			x: "x",
			y: "y",
			z: "z",
			height: "h",
		});
		const scene = mount(chart);
		const boxes = childrenOf(chart);
		const worlds = boxes.map(worldOf);
		const before = scene.shapes().map((s) => s.polylines);
		scene.camera.set("eye", { x: -5, y: 2, z: 4 });
		scene.commit();
		expect(childrenOf(chart)).toEqual(boxes);
		expect(boxes.map(worldOf).every((w, i) => w === worlds[i])).toBe(true);
		expect(scene.shapes().map((s) => s.polylines)).not.toEqual(before);
	});
});

describe("quiver3D", () => {
	const field = [
		{ x: 0, y: 0, z: 0, u: 1, v: 0, w: 0 },
		{ x: 1, y: 0, z: 0, u: 0, v: 1, w: 0 },
		{ x: 0, y: 1, z: 0, u: 0, v: 0, w: Number.NaN },
	];

	it("draws an arrow per finite datum, tip at origin + vector * scale", () => {
		const chart = quiver3D.create({
			data: field,
			x: "x",
			y: "y",
			z: "z",
			u: "u",
			v: "v",
			w: "w",
			scale: 2,
			color: (_d: unknown, i: number) => (i === 0 ? "#f00" : "#0f0"),
			tipLength: 0.2,
		});
		mount(chart);
		const arrows = childrenOf(chart);
		expect(arrows).toHaveLength(2);
		expect(arrows.every((arrow) => arrow.type === "Vector3D")).toBe(true);
		expect(prop(arrows[1], "from")).toEqual({ x: 1, y: 0, z: 0 });
		expect(prop(arrows[1], "to")).toEqual({ x: 1, y: 2, z: 0 });
		expect(prop(arrows[0], "stroke")).toBe(cssColor("#f00"));
		expect(prop(arrows[1], "stroke")).toBe(cssColor("#0f0"));
		expect(prop(arrows[0], "tipLength")).toBe(0.2);
	});

	it("reconciles arrows on a data update and keeps them on a camera move", () => {
		const chart = quiver3D.create({
			data: field,
			x: "x",
			y: "y",
			z: "z",
			u: "u",
			v: "v",
			w: "w",
		});
		const scene = mount(chart);
		const arrows = childrenOf(chart);
		const worlds = arrows.map(worldOf);
		scene.camera.set("eye", { x: 0, y: 6, z: 3 });
		scene.commit();
		expect(arrows.map(worldOf).every((w, i) => w === worlds[i])).toBe(true);

		chart.set("scale", 3);
		scene.commit();
		expect(childrenOf(chart)).toEqual(arrows);
		expect(prop(arrows[0], "to")).toEqual({ x: 3, y: 0, z: 0 });
	});
});

describe("scatter3D", () => {
	it("draws a marker per finite point with per-datum radius and colour", () => {
		const chart = scatter3D.create({
			data: [
				{ x: 0, y: 0, z: 0, size: 0.1 },
				{ x: 1, y: Number.POSITIVE_INFINITY, z: 0, size: 0.2 },
				{ x: 1, y: 1, z: 1, size: 0.3 },
			],
			x: "x",
			y: "y",
			z: "z",
			radius: "size",
			color: "#4af",
			shaded: true,
		});
		mount(chart);
		const dots = childrenOf(chart);
		expect(dots).toHaveLength(2);
		expect(dots.every((dot) => dot.type === "Dot3D")).toBe(true);
		expect(dots.map((dot) => prop(dot, "radius"))).toEqual([0.1, 0.3]);
		expect(prop(dots[1], "center")).toEqual({ x: 1, y: 1, z: 1 });
		expect(prop(dots[0], "color")).toBe(cssColor("#4af"));
		expect(prop(dots[0], "shaded")).toBe(true);
	});

	it("leaves radius and colour to dot3D's defaults when unset", () => {
		const chart = scatter3D.create({
			data: [{ x: 0, y: 0, z: 0 }],
			x: "x",
			y: "y",
			z: "z",
		});
		mount(chart);
		const [dot] = childrenOf(chart);
		expect(prop(dot, "radius")).toBe(0.08);
		expect(prop(dot, "color")).toBeUndefined();
	});

	it("reconciles markers on a data update and keeps them on a camera move", () => {
		const chart = scatter3D.create({
			data: [
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1 },
			],
			x: "x",
			y: "y",
			z: "z",
		});
		const scene = mount(chart);
		const dots = childrenOf(chart);
		scene.camera.set("eye", { x: 6, y: 1, z: 0 });
		scene.commit();
		expect(childrenOf(chart)).toEqual(dots);

		chart.set("data", [{ x: 2, y: 0, z: 0 }]);
		scene.commit();
		expect(childrenOf(chart)).toEqual([dots[0]]);
		expect(dots[1].disposed).toBe(true);
		expect(prop(dots[0], "center")).toEqual({ x: 2, y: 0, z: 0 });
	});
});

describe("stem3D", () => {
	const heights = [
		{ x: -1, y: 1.5, z: 0 },
		{ x: 1, y: 0.7, z: 1 },
	];

	it("draws a drop line then a marker per point", () => {
		const chart = stem3D.create({
			data: heights,
			x: "x",
			y: "y",
			z: "z",
			baseline: -1,
			markerRadius: 0.12,
			color: "#4af",
			worldWidth: 0.02,
		});
		mount(chart);
		const nodes = childrenOf(chart);
		expect(nodes.map((node) => node.type)).toEqual([
			"Line3D",
			"Dot3D",
			"Line3D",
			"Dot3D",
		]);
		expect(prop(nodes[0], "from")).toEqual({ x: -1, y: -1, z: 0 });
		expect(prop(nodes[0], "to")).toEqual({ x: -1, y: 1.5, z: 0 });
		expect(prop(nodes[0], "stroke")).toBe(cssColor("#4af"));
		expect(prop(nodes[0], "worldWidth")).toBe(0.02);
		expect(prop(nodes[1], "center")).toEqual({ x: -1, y: 1.5, z: 0 });
		expect(prop(nodes[1], "radius")).toBe(0.12);
		expect(prop(nodes[1], "color")).toBe(cssColor("#4af"));
	});

	it("reconciles stems on a data update and keeps them on a camera move", () => {
		const chart = stem3D.create({ data: heights, x: "x", y: "y", z: "z" });
		const scene = mount(chart);
		const nodes = childrenOf(chart);
		const worlds = nodes.map(worldOf);
		scene.camera.set("eye", { x: 2, y: 5, z: 6 });
		scene.commit();
		expect(nodes.map(worldOf).every((w, i) => w === worlds[i])).toBe(true);

		chart.set("data", [heights[0]]);
		scene.commit();
		expect(childrenOf(chart)).toEqual(nodes.slice(0, 2));
		expect(nodes[2].disposed && nodes[3].disposed).toBe(true);
	});
});

describe("wireframe3D", () => {
	const xs = [
		[0, 1, 2],
		[0, 1, 2],
	];
	const ys = [
		[0, 0.5, 0],
		[0.5, 1, 0.5],
	];
	const zs = [
		[0, 0, 0],
		[1, 1, 1],
	];

	it("draws every row and column as segments, rows first", () => {
		const chart = wireframe3D.create({ xs, ys, zs, stroke: "#4af" });
		mount(chart);
		const lines = childrenOf(chart);
		// Rows: 2 * (3 - 1); columns: 3 * (2 - 1).
		expect(lines).toHaveLength(7);
		expect(prop(lines[0], "from")).toEqual({ x: 0, y: 0, z: 0 });
		expect(prop(lines[0], "to")).toEqual({ x: 1, y: 0.5, z: 0 });
		expect(prop(lines[4], "to")).toEqual({ x: 0, y: 0.5, z: 1 });
		expect(lines.every((line) => prop(line, "stroke") === "#4af")).toBe(true);
	});

	it("throws on mismatched grids", () => {
		const chart = wireframe3D.create({ xs, ys: [[0]], zs });
		expect(() => mount(chart)).toThrow(/row count/);
	});
});

describe("surfaceGrid3D", () => {
	const grid = (lift: number) => ({
		xs: [
			[0, 1, 2],
			[0, 1, 2],
		],
		ys: [
			[0, lift, 0],
			[lift, 1, lift],
		],
		zs: [
			[0, 0, 0],
			[1, 1, 1],
		],
	});

	it("is one mesh of (rows - 1) * (cols - 1) quads", () => {
		const surface = surfaceGrid3D.create({ ...grid(0.5), fill: "#4af" });
		const scene = mount(surface);
		expect(surface.world).toHaveLength(2);
		expect(scene.shapes().length).toBeGreaterThan(0);
	});

	it("rebuilds its faces on a grid change, never on a camera move", () => {
		const surface = surfaceGrid3D.create(grid(0.5));
		const scene = mount(surface);
		const world = surface.world;
		scene.camera.set("eye", { x: -4, y: 4, z: 3 });
		scene.commit();
		expect(surface.world).toBe(world);
		surface.update(grid(0.8));
		scene.commit();
		expect(surface.world).not.toBe(world);
		expect(surface.world[0].points[1].y).toBe(0.8);
	});
});

describe("triSurface3D", () => {
	const samples = [
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 0.5, z: 0 },
		{ x: 0, y: 0.8, z: 1 },
		{ x: 1, y: 0.2, z: 1 },
	];

	it("triangulates over (x, z) with y as height", () => {
		const surface = triSurface3D.create({
			data: samples,
			x: "x",
			y: "y",
			z: "z",
		});
		mount(surface);
		expect(surface.world).toHaveLength(2);
		const heights = surface.world.flatMap((face) =>
			face.points.map((p) => p.y),
		);
		expect(new Set(heights)).toEqual(new Set([0, 0.5, 0.8, 0.2]));
	});

	it("drops triangles with a non-finite height; keeps faces on a camera move", () => {
		const surface = triSurface3D.create({
			data: [samples[0], samples[1], samples[2], { ...samples[3], y: NaN }],
			x: "x",
			y: "y",
			z: "z",
		});
		const scene = mount(surface);
		expect(surface.world).toHaveLength(1);
		const world = surface.world;
		scene.camera.set("eye", { x: 1, y: 6, z: 2 });
		scene.commit();
		expect(surface.world).toBe(world);
	});
});

describe("voxels3D", () => {
	it("culls the faces two filled voxels share", () => {
		const single = voxels3D.create({ values: [[[true]]] });
		mount(single);
		expect(single.world).toHaveLength(6);
		const pair = voxels3D.create({ values: [[[true]], [[true]]] });
		mount(pair);
		expect(pair.world).toHaveLength(10);
	});

	it("rebuilds on a values change, never on a camera move", () => {
		const voxels = voxels3D.create({ values: [[[true]]] });
		const scene = mount(voxels);
		const world = voxels.world;
		scene.camera.set("eye", { x: 3, y: -2, z: 5 });
		scene.commit();
		expect(voxels.world).toBe(world);
		voxels.set("values", [[[true, true]]]);
		scene.commit();
		expect(voxels.world).toHaveLength(10);
	});
});

describe("3D charts: z is data, zIndex is paint order", () => {
	const data = [{ x: 0, y: 0, z: 3 }];
	const grids = {
		xs: [
			[0, 1],
			[0, 1],
		],
		ys: [
			[0, 0],
			[0, 0],
		],
		zs: [
			[3, 3],
			[4, 4],
		],
	};
	const charts: [string, (zIndex?: number) => SceneNode][] = [
		[
			"scatter3D",
			(zIndex) => scatter3D.create({ data, x: "x", y: "y", z: "z", zIndex }),
		],
		[
			"barChart3D",
			(zIndex) =>
				barChart3D.create({ data, x: "x", y: "y", z: "z", height: 1, zIndex }),
		],
		[
			"quiver3D",
			(zIndex) =>
				quiver3D.create({
					data,
					x: "x",
					y: "y",
					z: "z",
					u: () => 1,
					v: () => 1,
					w: () => 0,
					zIndex,
				}),
		],
		[
			"stem3D",
			(zIndex) =>
				stem3D.create({
					data: [{ x: 0, y: 1, z: 3 }],
					x: "x",
					y: "y",
					z: "z",
					zIndex,
				}),
		],
		["wireframe3D", (zIndex) => wireframe3D.create({ ...grids, zIndex })],
		[
			"surfaceGrid3D",
			// Seen from above so the one-sided face shows.
			(zIndex) => surfaceGrid3D.create({ ...grids, zIndex }),
		],
		[
			"voxels3D",
			(zIndex) =>
				voxels3D.create({ values: [[[false, false, false, true]]], zIndex }),
		],
		[
			"triSurface3D",
			(zIndex) =>
				triSurface3D.create({
					data: [
						{ x: 0, y: 0, z: 3 },
						{ x: 1, y: 0, z: 3 },
						{ x: 0, y: 0, z: 4 },
					],
					x: "x",
					y: "y",
					z: "z",
					zIndex,
				}),
		],
	];

	for (const [name, make] of charts) {
		it(`${name} forwards zIndex to the drawn nodes and ignores z for it`, () => {
			const zs = mount(make(7))
				.shapes()
				.map((s) => s.zIndex);
			expect(zs.length).toBeGreaterThan(0);
			expect(zs.every((z) => z === 7)).toBe(true);
			const defaults = mount(make())
				.shapes()
				.map((s) => s.zIndex);
			expect(defaults.length).toBeGreaterThan(0);
			expect(defaults).not.toContain(3);
		});
	}

	it("a zIndex set later reaches the drawn nodes already there", () => {
		const chart = scatter3D.create({ data, x: "x", y: "y", z: "z" });
		const scene = mount(chart);
		chart.set("zIndex", 4);
		scene.commit();
		expect(scene.shapes().every((s) => s.zIndex === 4)).toBe(true);
	});
});
