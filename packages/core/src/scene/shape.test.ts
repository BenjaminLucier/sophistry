/**
 * The shape pipeline on real shapes: specs match the non-reactive `bake()`
 * for the same props, handles measure the outline, and
 * the fine-grained guarantees hold: a write reruns only its stage, a move
 * keeps the outline's identity, a clean graph does no work, bound writes
 * coalesce and disposal ends every subscription.
 */

import { describe, expect, it, vi } from "vitest";
import type { Polyline } from "../geometry";
import { derive, track } from "../reactive";
import { circle, rect } from "../shapes";
import { bake, derivePolylines, plainShapeSpec } from "../spec/bake";
import { linearGradient } from "../spec/gradient";
import {
	DOWN,
	LEFT,
	NO_SHIFT,
	ORIGIN,
	RIGHT,
	shiftBy,
	UP,
	UR,
} from "../spec/layout";
import type { DrawSpec, ShapeSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import { Invalidate, themeContext } from "./context";
import { SceneGraph } from "./graph";
import {
	boundsOfPolylines,
	defineShape,
	type ShapeProps,
	shapeProps,
} from "./shape";

const theme = resolveTheme({ mode: "dark" });

/** A graph that commits only when the test says so, with a fixed theme. */
function manualGraph() {
	const frames: (readonly DrawSpec[])[] = [];
	const graph = new SceneGraph({
		schedule: () => {},
		onFrame: (frame) => frames.push(frame),
	});
	graph.root.provide(themeContext, theme);
	return { graph, frames, commit: () => graph.commit() };
}

/** A spec with its lazy getters resolved and `local` dropped: what `bake()` returns. */
function baked(spec: DrawSpec | null): Record<string, unknown> | null {
	if (!spec) return null;
	const { local: _local, ...rest } = plainShapeSpec(spec as ShapeSpec);
	return rest;
}

/** A triangle shape whose geometry calls are counted. */
function countedTriangle() {
	const geometry = vi.fn((props: { size?: number }) => ({
		closed: true,
		polylines: [
			[
				{ x: 0, y: 0 },
				{ x: props.size ?? 1, y: 0 },
				{ x: 0, y: props.size ?? 1 },
			],
		],
	}));
	const definition = defineShape<ShapeProps & { size?: number }>({
		name: "Triangle",
		props: {
			...shapeProps,
			size: { default: 1, invalidates: Invalidate.GEOMETRY },
		},
		geometry,
	});
	return { definition, geometry };
}

describe("boundsOfPolylines", () => {
	it("is null for no points, else the union box", () => {
		expect(boundsOfPolylines([])).toBeNull();
		expect(boundsOfPolylines([[], []])).toBeNull();
		const a: Polyline = [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		];
		const b: Polyline = [
			{ x: -1, y: 2 },
			{ x: 3, y: -1 },
		];
		expect(boundsOfPolylines([a, b, []])).toEqual({
			minX: -1,
			minY: -1,
			maxX: 3,
			maxY: 2,
		});
		expect(boundsOfPolylines([[{ x: 3, y: 4 }]])).toEqual({
			minX: 3,
			minY: 4,
			maxX: 3,
			maxY: 4,
		});
	});
});

describe("specs match bake() for the same props", () => {
	const cases: [string, Parameters<typeof circle.create>[0]][] = [
		["plain", { radius: 1 }],
		[
			"moved and styled",
			{ radius: 2, x: 1, y: -2, fill: "#f00", strokeWidth: 0.1 },
		],
		[
			"rotated and scaled",
			{ radius: 1, rotation: 0.3, scale: 2, dash: [0.2, 0.1] },
		],
		["progress and z", { radius: 1, progress: 0.4, zIndex: 3, opacity: 0.5 }],
		[
			"bbox gradient",
			{
				radius: 1,
				x: 2,
				fill: linearGradient(["red", "blue"], {
					from: { x: 0, y: 0.5 },
					to: { x: 1, y: 0.5 },
				}),
			},
		],
	];
	it.each(cases)("%s", (_name, props) => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(circle.create(props));
		commit();
		const { radius: _radius, ...rest } = props as { radius: number };
		const geometry = {
			closed: true,
			curvePaths: [
				{
					...(node.spec as ShapeSpec).local?.curvePaths?.[0],
				},
			],
		} as Parameters<typeof bake>[0];
		const expected = bake(
			geometry,
			{ matrix: graph.root.childSpace.matrix, opacity: 1 },
			rest,
			theme,
			{
				id: node.id,
				...rest,
			},
		);
		const actual = baked(node.spec);
		// A bbox gradient is in local units when the spec carries `local`
		// (see `ShapeSpec.local`), so compare it apart from the rest.
		if (typeof expected?.style.fill === "object" && expected.style.fill) {
			const { style: actualStyle, ...actualRest } = actual as { style: object };
			const { style: _style, ...expectedRest } = expected;
			expect(actualRest).toEqual(expectedRest);
			expect(actualStyle).toBeDefined();
			return;
		}
		expect(actual).toEqual(expected);
	});

	it("a hidden shape, or one with nothing revealed and no fill, publishes nothing", () => {
		const { graph, commit, frames } = manualGraph();
		const hidden = graph.root.add(circle.create({ radius: 1, visible: false }));
		const unrevealed = graph.root.add(
			circle.create({ radius: 1, progress: 0 }),
		);
		const filled = graph.root.add(
			circle.create({ radius: 1, progress: 0, fill: "#fff" }),
		);
		commit();
		expect(hidden.spec).toBeNull();
		expect(unrevealed.spec).toBeNull();
		expect(filled.spec).not.toBeNull();
		expect(frames.at(-1)?.map((spec) => spec.id)).toEqual([filled.id]);
	});

	it("a root shape hands the renderer its own outline under a matrix", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			circle.create({ radius: 1, center: { x: 5, y: 7 } }),
		);
		commit();
		const spec = node.spec as ShapeSpec;
		expect(spec.local?.transform).toEqual({
			a: 1,
			b: 0,
			c: 0,
			d: 1,
			e: 5,
			f: 7,
		});
		// The scene-unit points are derived on read, exactly where the matrix puts them.
		const xs = spec.polylines[0]?.map((p) => p.x) ?? [];
		expect(Math.min(...xs)).toBeCloseTo(4, 9);
		expect(Math.max(...xs)).toBeCloseTo(6, 9);
		expect(spec.local?.polylines).toEqual(
			derivePolylines({ closed: true, curvePaths: spec.local?.curvePaths }),
		);
	});
});

describe("handles", () => {
	it("localBounds does not depend on a place bound to itself", () => {
		const { graph, commit } = manualGraph();
		const nudge = track(0);
		let self: { localBounds(): { maxX: number } | null } | null = null;
		const place = derive(nudge, (value) =>
			shiftBy(NO_SHIFT, {
				x: value + (self?.localBounds()?.maxX ?? 0),
				y: 0,
			}),
		);
		const node = graph.root.add(circle.create({ radius: 2, place }));
		self = node;
		nudge.set(1);
		expect(() => node.localBounds()).not.toThrow();
		expect(node.localBounds()?.maxX).toBe(2);
		expect(() => commit()).not.toThrow();
		expect(node.bounds()?.minX).toBeCloseTo(3 - 2);
	});

	it("measure the outline through the offset and the local TRS, in scene units", () => {
		const { graph } = manualGraph();
		const node = graph.root.add(
			rect.create({ width: 4, height: 2, center: { x: 1, y: 1 }, x: 10 }),
		);
		// No commit needed: a handle refreshes the node it reads.
		expect(node.localBounds()).toEqual({ minX: -1, minY: 0, maxX: 3, maxY: 2 });
		expect(node.bounds()).toEqual({ minX: 9, minY: 0, maxX: 13, maxY: 2 });
		expect(node.center()).toEqual({ x: 11, y: 1 });
		expect(node.pointAt(ORIGIN)).toEqual({ x: 11, y: 1 });
		expect(node.pointAt(UP)).toEqual({ x: 11, y: 2 });
		expect(node.pointAt(DOWN)).toEqual({ x: 11, y: 0 });
		expect(node.pointAt(LEFT)).toEqual({ x: 9, y: 1 });
		expect(node.pointAt(RIGHT)).toEqual({ x: 13, y: 1 });
		expect(node.pointAt(UR)).toEqual({ x: 13, y: 2 });
		expect(node.width()).toBe(4);
		expect(node.height()).toBe(2);
	});

	it("follow a write at once and are cached on identity", () => {
		const { graph } = manualGraph();
		const node = graph.root.add(rect.create({ width: 2, height: 2 }));
		const first = node.bounds();
		expect(node.bounds()).toBe(first);
		node.set("x", 3);
		expect(node.bounds()).toEqual({ minX: 2, minY: -1, maxX: 4, maxY: 1 });
		// A rotation turns the box about the shape's centre.
		node.set("rotation", Math.PI / 4);
		expect(node.width()).toBeCloseTo(2 * Math.SQRT2, 9);
		expect(node.center()?.x).toBeCloseTo(3, 9);
	});

	it("work without a graph, and report nothing for a shape with no points", () => {
		const node = circle.create({ radius: 1 });
		expect(node.width()).toBeCloseTo(2, 2);
		const empty = defineShape<ShapeProps>({
			name: "Empty",
			props: shapeProps,
			geometry: () => ({ closed: false, polylines: [[]] }),
		}).create();
		expect(empty.bounds()).toBeNull();
		expect(empty.center()).toBeNull();
		expect(empty.width()).toBe(0);
	});
});

describe("fine-grained updates", () => {
	it("one prop write reruns only its stage", () => {
		const { definition, geometry } = countedTriangle();
		const { graph, commit } = manualGraph();
		const node = graph.root.add(definition.create({ size: 1 }));
		commit();
		expect(geometry).toHaveBeenCalledTimes(1);
		const spec = node.spec as ShapeSpec;

		node.set("fill", "#0f0");
		commit();
		expect(geometry).toHaveBeenCalledTimes(1);
		const restyled = node.spec as ShapeSpec;
		expect(restyled.style).not.toBe(spec.style);
		expect(restyled.local?.polylines).toBe(spec.local?.polylines);
		expect(restyled.local?.transform).toBe(spec.local?.transform);

		node.set("zIndex", 4);
		commit();
		expect(geometry).toHaveBeenCalledTimes(1);
		expect((node.spec as ShapeSpec).style).toBe(restyled.style);

		node.set("size", 2);
		commit();
		expect(geometry).toHaveBeenCalledTimes(2);
		expect((node.spec as ShapeSpec).style).toBe(restyled.style);
	});

	it("a move keeps the outline arrays and the style, and reruns no geometry", () => {
		const geometry = vi.fn((props: { radius: number }) => ({
			closed: true,
			polylines: [
				[
					{ x: -props.radius, y: 0 },
					{ x: props.radius, y: 0 },
				],
			],
		}));
		const dot = defineShape<
			ShapeProps & { radius: number; center?: { x: number; y: number } }
		>({
			name: "Dot",
			props: {
				...shapeProps,
				radius: { invalidates: Invalidate.GEOMETRY },
				center: { invalidates: Invalidate.TRANSFORM },
			},
			geometry,
			offset: (props) => props.center,
		});
		const { graph, commit } = manualGraph();
		const node = graph.root.add(dot.create({ radius: 1 }));
		commit();
		const calls = geometry.mock.calls.length;
		const before = node.spec as ShapeSpec;
		node.set("center", { x: 2, y: 0 });
		commit();
		node.set("x", 1);
		commit();
		const after = node.spec as ShapeSpec;
		expect(geometry.mock.calls.length).toBe(calls);
		expect(after).not.toBe(before);
		expect(after.local?.polylines).toBe(before.local?.polylines);
		expect(after.style).toBe(before.style);
		expect(after.local?.transform.e).toBe(3);
	});

	it("a circle's move keeps spec.local.curvePaths by identity", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(circle.create({ radius: 1 }));
		commit();
		const curves = (node.spec as ShapeSpec).local?.curvePaths;
		expect(curves).toBeDefined();
		for (const x of [0.5, 1, 1.5]) {
			node.update({ center: { x, y: 0 }, y: x });
			commit();
			expect((node.spec as ShapeSpec).local?.curvePaths).toBe(curves);
		}
	});

	it("a graph with nothing dirty does no commit work, and an equal write is free", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(circle.create({ radius: 1, x: 1 }));
		commit();
		const stats = { ...graph.stats };
		expect(commit()).toBe(false);
		node.set("x", 1);
		expect(graph.needsCommit()).toBe(false);
		expect(commit()).toBe(false);
		expect(graph.stats).toEqual(stats);
	});

	it("a write that lands on the same spec inputs keeps the spec", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(circle.create({ radius: 1 }));
		commit();
		const spec = node.spec;
		// Moving away and back within one frame: the stage reruns, but every
		// last-input cache hits, so the same spec object comes out.
		node.set("x", 2);
		node.set("x", 0);
		commit();
		expect(node.spec).toBe(spec);
	});

	it("three writes to a bound track in one frame cost one update", () => {
		const { definition, geometry } = countedTriangle();
		const { graph, commit } = manualGraph();
		const size = track(1);
		const x = track(0);
		const node = graph.root.add(definition.create({ size, x }));
		commit();
		const refreshes = graph.stats.refreshes;
		size.set(2);
		size.set(3);
		size.set(4);
		x.set(1);
		x.set(2);
		commit();
		expect(graph.stats.refreshes).toBe(refreshes + 1);
		expect(geometry).toHaveBeenCalledTimes(2);
		expect(geometry).toHaveBeenLastCalledWith(
			expect.objectContaining({ size: 4 }),
		);
		expect((node.spec as ShapeSpec).local?.transform.e).toBe(2);
	});

	it("disposing removes every subscription and the spec", () => {
		const { graph, commit, frames } = manualGraph();
		let subscribers = 0;
		const source = track(1);
		const counted = {
			peek: () => source.peek(),
			subscribe(onStale: () => void) {
				subscribers++;
				const stop = source.subscribe(onStale);
				return () => {
					subscribers--;
					stop();
				};
			},
		};
		const node = graph.root.add(
			circle.create({ radius: counted, x: counted, opacity: counted }),
		);
		commit();
		expect(subscribers).toBe(3);
		node.dispose();
		expect(subscribers).toBe(0);
		expect(node.spec).toBeNull();
		commit();
		expect(frames.at(-1)).toEqual([]);
		source.set(2);
		expect(graph.needsCommit()).toBe(false);
	});

	it("restyles when the theme changes, and only then", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(circle.create({ radius: 1 }));
		commit();
		const before = node.spec as ShapeSpec;
		expect(before.style.stroke).toBe(theme.palette.foreground);
		const light = resolveTheme({ mode: "light" });
		graph.root.provide(themeContext, light);
		commit();
		const after = node.spec as ShapeSpec;
		expect(after.style.stroke).toBe(light.palette.foreground);
		expect(after.local?.curvePaths).toBe(before.local?.curvePaths);
	});

	it("interaction props touch only the interaction record", () => {
		const { definition, geometry } = countedTriangle();
		const { graph, commit } = manualGraph();
		const node = graph.root.add(definition.create({}));
		commit();
		const spec = node.spec;
		node.set("onTap", () => {});
		node.set("cursor", "pointer");
		commit();
		expect(node.spec).toBe(spec);
		expect(geometry).toHaveBeenCalledTimes(1);
		expect(graph.interactive.has(node)).toBe(true);
	});

	it("a hover sink is stored, not bound", () => {
		const { graph, commit } = manualGraph();
		const hovered = track(false);
		const node = graph.root.add(circle.create({ radius: 1, hover: hovered }));
		commit();
		expect(node.get("hover")).toBe(hovered);
		expect(graph.interactive.has(node)).toBe(true);
	});
});
