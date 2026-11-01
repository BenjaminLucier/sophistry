/**
 * `vectorField` and `streamLines`: one node per colour band, arrows and lines
 * from the shared engine, under the axes inside a coordinate system
 * and only following the visible frame when nothing else defines the domain.
 */

import { describe, expect, it } from "vitest";
import type { Bounds, Point } from "../geometry/index.js";
import { polylineToCurvePath, tipPolylines } from "../geometry/index.js";
import type { Readable } from "../reactive/index.js";
import { track } from "../reactive/index.js";
import { frameContext, Invalidate, themeContext } from "../scene/context.js";
import { SceneGraph } from "../scene/graph.js";
import type { ShapeSpec } from "../spec/types.js";
import { axes } from "./axes.js";
import type { CoordinateSystem } from "./coords.js";
import {
	coordsContext,
	createCartesianCoords,
	UNDER_AXES_Z_INDEX,
} from "./coords.js";
import { mount, theme } from "./test-scene.js";
import {
	createFieldEngine,
	fieldHandle,
	streamLines,
	vectorField,
} from "./vector-field.js";

const swirl = (p: Point) => ({ x: -p.y, y: p.x });

function manualGraph(coords?: CoordinateSystem) {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	if (coords) graph.root.provide(coordsContext, coords);
	return { graph, commit: () => graph.commit() };
}

function shapes(graph: SceneGraph): ShapeSpec[] {
	return graph.frame.filter((s): s is ShapeSpec => s.kind === "shape");
}

describe("field layering", () => {
	const plane = (child: ReturnType<typeof vectorField.create>) =>
		axes.create({
			xRange: [-3, 3, 1],
			yRange: [-2, 2, 1],
			width: 6,
			height: 4,
			children: [child],
		});

	it("puts a vectorField's arrows under the axes and their numbers", () => {
		const { graph } = mount(plane(vectorField.create({ function: swirl })));
		const numbers = graph.frame.filter((s) => s.kind === "text");
		const arrows = graph.frame.filter(
			(s) => s.kind === "shape" && s.style.stroke !== undefined && s.zIndex < 0,
		);
		expect(numbers.length).toBeGreaterThan(0);
		expect(arrows.length).toBeGreaterThan(0);
		for (const arrow of arrows) expect(arrow.zIndex).toBe(UNDER_AXES_Z_INDEX);
		for (const label of numbers)
			expect(label.zIndex).toBeGreaterThan(UNDER_AXES_Z_INDEX);
	});

	it("does the same for streamLines", () => {
		const { graph } = mount(
			axes.create({
				xRange: [-3, 3, 1],
				yRange: [-2, 2, 1],
				width: 6,
				height: 4,
				children: [streamLines.create({ function: swirl })],
			}),
		);
		expect(graph.frame.some((s) => s.zIndex === UNDER_AXES_Z_INDEX)).toBe(true);
	});

	it("keeps an explicit z", () => {
		const { graph } = mount(
			plane(vectorField.create({ function: swirl, zIndex: 3 })),
		);
		expect(graph.frame.some((s) => s.zIndex === 3)).toBe(true);
		expect(graph.frame.some((s) => s.zIndex === UNDER_AXES_Z_INDEX)).toBe(
			false,
		);
	});

	it("leaves a field outside any coordinate system at the default z", () => {
		const { graph } = mount(
			vectorField.create({ function: swirl, xRange: [-2, 2], yRange: [-2, 2] }),
		);
		expect(graph.frame.length).toBeGreaterThan(0);
		for (const spec of graph.frame) expect(spec.zIndex).toBe(0);
	});
});

describe("vectorField and the visible frame", () => {
	function mountField(ranges: boolean) {
		const half = track(4);
		let frameReads = 0;
		const frame: Readable<Bounds> = {
			peek: () => {
				frameReads++;
				const h = half.peek();
				return { minX: -h, minY: -h, maxX: h, maxY: h };
			},
			subscribe: (onStale) => half.subscribe(onStale),
		};
		const { graph, commit } = manualGraph();
		graph.root.provide(frameContext, frame);
		graph.root.add(
			vectorField.create({
				function: (p) => ({ x: p.y, y: -p.x }),
				xRange: ranges ? [-2, 2] : undefined,
				yRange: ranges ? [-2, 2] : undefined,
			}),
		);
		commit();
		return { graph, commit, half, reads: () => frameReads };
	}

	it("does not read the frame at all when both ranges are given", () => {
		const t = mountField(true);
		expect(t.reads()).toBe(0);
		const before = JSON.stringify(shapes(t.graph));
		t.half.set(1);
		t.commit();
		expect(t.reads()).toBe(0);
		expect(JSON.stringify(shapes(t.graph))).toBe(before);
	});

	it("without ranges it follows the visible frame (documented behaviour)", () => {
		const t = mountField(false);
		expect(t.reads()).toBeGreaterThan(0);
		const before = JSON.stringify(shapes(t.graph));
		t.half.set(1);
		t.commit();
		expect(JSON.stringify(shapes(t.graph))).not.toBe(before);
	});
});

describe("vectorField", () => {
	const coords = createCartesianCoords({
		xRange: [-3, 3],
		yRange: [-2, 2],
		width: 6,
		height: 4,
		center: { x: 0, y: 0 },
	});

	it("is a composite whose field props rerun update and whose style props bind", () => {
		expect(vectorField.name).toBe("VectorField");
		expect(vectorField.kind).toBe("composite");
		expect(vectorField.descriptor.function.invalidates).toBe(Invalidate.UPDATE);
		expect(vectorField.descriptor.stroke.invalidates).toBe(Invalidate.UPDATE);
		expect(vectorField.descriptor.strokeWidth.invalidates).toBe(
			Invalidate.NONE,
		);
		expect(vectorField.descriptor.bands.default).toBe(10);
	});

	it("draws one node per band, shafts then heads, coloured by the engine", () => {
		const { graph, commit } = manualGraph(coords);
		graph.root.add(vectorField.create({ function: swirl }));
		commit();
		const engine = createFieldEngine(
			{ function: swirl },
			{ coords, frame: () => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 }), theme },
		);
		const bands = shapes(graph);
		expect(bands).toHaveLength(10);
		expect(bands.map((band) => band.style.stroke)).toEqual(engine.bandColors());
		// Every arrow is a shaft plus a two-stroke vee head; the swirl's
		// magnitude grows outward, so the outermost band is not empty.
		const total = bands.reduce((sum, band) => sum + band.fillFrom, 0);
		const arrows = engine
			.lattice()
			.points.filter((p) => Math.hypot(p.x, p.y) > 0).length;
		expect(total).toBe(arrows);
		expect(bands.at(-1)?.fillFrom).toBeGreaterThan(0);
	});

	it("centres each arrow on its cell's sample: shaft its length, head a third of it", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(
			vectorField.create({
				function: () => ({ x: 1, y: 0 }),
				xRange: [0, 1],
				yRange: [0, 1],
				columns: 2,
				stroke: "#ffffff",
				maxLength: 0.5,
			}),
		);
		commit();
		const [band] = shapes(graph);
		expect(shapes(graph)).toHaveLength(1);
		// Ticks at 0, 0.5, 1: the first sample is the first cell's centre,
		// (0.25, 0.25), and its arrow runs half its length either side.
		const shaft = polylineToCurvePath(
			[
				{ x: 0, y: 0.25 },
				{ x: 0.5, y: 0.25 },
			],
			false,
		);
		const head = tipPolylines("vee", { x: 0.5, y: 0.25 }, 0, 0.5 * 0.34);
		expect(band?.curvePaths?.[0]).toEqual(shaft);
		expect(
			band?.curvePaths?.slice(
				band.fillFrom,
				band.fillFrom + head.curvePaths.length,
			),
		).toEqual(head.curvePaths);
	});

	it("re-samples for a new coordinate system and keeps its band nodes", () => {
		const { graph, commit } = manualGraph(coords);
		const node = graph.root.add(vectorField.create({ function: swirl }));
		commit();
		const children = [...node.children];
		const before = JSON.stringify(shapes(graph));
		graph.root.provide(
			coordsContext,
			createCartesianCoords({
				xRange: [-3, 3],
				yRange: [-2, 2],
				width: 3,
				height: 2,
				center: { x: 0, y: 0 },
			}),
		);
		commit();
		expect(JSON.stringify(shapes(graph))).not.toBe(before);
		expect(node.children).toEqual(children);
	});

	it("passes style through without re-sampling", () => {
		const { graph, commit } = manualGraph(coords);
		let calls = 0;
		const node = graph.root.add(
			vectorField.create({
				function: (p) => {
					calls++;
					return swirl(p);
				},
			}),
		);
		commit();
		const sampled = calls;
		node.set("progress", 0.5);
		node.set("strokeWidth", 0.2);
		commit();
		expect(calls).toBe(sampled);
		for (const band of shapes(graph)) expect(band.progress).toBe(0.5);
	});

	it("hands back vectors and flow lines in scene units", () => {
		const { graph, commit } = manualGraph(
			createCartesianCoords({
				xRange: [-3, 3],
				yRange: [-2, 2],
				width: 12,
				height: 8,
				center: { x: 0, y: 0 },
			}),
		);
		const node = graph.root.add(vectorField.create({ function: swirl }));
		commit();
		const handle = fieldHandle(node);
		const vector = handle.vectorAt({ x: 1, y: 0 });
		expect(vector.x).toBeCloseTo(0, 9);
		expect(vector.y).toBeCloseTo(2, 9);
		const at = handle.toScene({ x: 1, y: 1 });
		expect(at.x).toBeCloseTo(2, 9);
		expect(at.y).toBeCloseTo(2, 9);
		expect(handle.domain()).toEqual({ minX: -3, maxX: 3, minY: -2, maxY: 2 });
		const line = handle.streamlineAt(
			{ x: 1, y: 0 },
			{ virtualTime: 1, steps: 10 },
		);
		expect(line).toHaveLength(11);
		for (const p of line)
			expect(Math.hypot(p.x / 2, p.y / 2)).toBeCloseTo(1, 3);
	});

	it("is one node with a plain stroke and no ramp", () => {
		const { graph, commit } = manualGraph(coords);
		graph.root.add(vectorField.create({ function: swirl, stroke: "#ff0000" }));
		commit();
		expect(shapes(graph)).toHaveLength(1);
	});
});

describe("streamLines", () => {
	const coords = createCartesianCoords({
		xRange: [-3, 3],
		yRange: [-2, 2],
		width: 6,
		height: 4,
		center: { x: 0, y: 0 },
	});

	it("integrates lines that stay on the swirl's circles, one node per band", () => {
		const { graph, commit } = manualGraph(coords);
		graph.root.add(streamLines.create({ function: swirl, noise: 0 }));
		commit();
		const bands = shapes(graph);
		expect(bands).toHaveLength(10);
		const lines = bands.flatMap((band) => band.polylines);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			const radius = Math.hypot(line[0]?.x ?? 0, line[0]?.y ?? 0);
			for (const p of line) expect(Math.hypot(p.x, p.y)).toBeCloseTo(radius, 2);
		}
	});

	it("cuts lines at band boundaries with colorAlong, sharing the cut vertex", () => {
		const { graph, commit } = manualGraph(coords);
		const radial = (p: Point) => ({ x: p.x, y: p.y });
		graph.root.add(
			streamLines.create({
				function: radial,
				seeds: [{ x: 0.1, y: 0 }],
				virtualTime: 3,
				colorAlong: true,
			}),
		);
		commit();
		const pieces = shapes(graph).flatMap((band) => band.polylines);
		expect(pieces.length).toBeGreaterThan(1);
		const sorted = pieces.sort((a, b) => (a[0]?.x ?? 0) - (b[0]?.x ?? 0));
		for (let i = 1; i < sorted.length; i++) {
			expect(sorted[i]?.[0]).toEqual(sorted[i - 1]?.at(-1));
		}
	});

	it("draws empty bands for a field that does not move", () => {
		const { graph, commit } = manualGraph(coords);
		graph.root.add(streamLines.create({ function: () => ({ x: 0, y: 0 }) }));
		commit();
		for (const band of shapes(graph)) expect(band.polylines).toHaveLength(0);
	});
});
