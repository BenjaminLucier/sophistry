/**
 * Specs are in scene units, and nothing about the camera reaches them.
 *
 * The scene root hands its children the identity space; the renderer applies
 * the view matrix at paint time. The visible box (`frameContext`) is a
 * `Readable` the root provides, which only the nodes that bind to it follow.
 * There is no `createScene` here: the tests provide the frame and theme on a
 * bare `SceneGraph`'s root themselves, the way the scene does.
 */

import { describe, expect, it } from "vitest";
import type { Bounds } from "../geometry/index.js";
import { linearMap } from "../geometry/transform.js";
import { derive, track } from "../reactive/index.js";
import { circle, rect } from "../shapes/index.js";
import { linearGradient, radialGradient } from "../spec/gradient.js";
import type { DrawSpec, ShapeSpec, TextSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { defineComposite } from "./composite.js";
import { BaseContainer } from "./container.js";
import { frameContext, themeContext } from "./context.js";
import { SceneGraph } from "./graph.js";
import { group } from "./group.js";
import { definePrimitive } from "./primitive.js";
import { text } from "./text.js";
import type { SceneNode, Space } from "./types.js";

const theme = resolveTheme({ mode: "dark" });

interface View {
	size: { width: number; height: number };
	units: number;
	center: { x: number; y: number };
}

/** The visible box for a view, as the scene computes it. */
function frameOf({ size, units, center }: View): Bounds {
	const { width, height } = size;
	const heightUnits =
		width > 0 && height > 0 ? (height * units) / width : (units * 9) / 16;
	return {
		minX: center.x - units / 2,
		minY: center.y - heightUnits / 2,
		maxX: center.x + units / 2,
		maxY: center.y + heightUnits / 2,
	};
}

/** A graph whose root provides a theme and a frame following `view`. */
function mount(children: SceneNode[], initial?: Partial<View>) {
	const view = track<View>({
		size: { width: 800, height: 450 },
		units: 16,
		center: { x: 0, y: 0 },
		...initial,
	});
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	const frame = derive(view, frameOf);
	graph.root.provide(frameContext, frame);
	graph.root.setChildren(children);
	graph.commit();
	const setView = (change: Partial<View>) =>
		view.set({ ...view.peek(), ...change });
	return { graph, frame, setView, commit: () => graph.commit() };
}

/**
 * A container handing its children a fixed matrix and pen: a stand-in for
 * `linearTransform`.
 */
class FixedSpace extends BaseContainer<{ children?: readonly SceneNode[] }> {
	fixed!: Space;
	override get childSpace(): Space {
		return this.fixed;
	}
}
function linearTransform(space: Partial<Space>, children: SceneNode[]) {
	const node = definePrimitive<{ children?: readonly SceneNode[] }, FixedSpace>(
		{
			name: "LinearTransform",
			container: true,
			props: { children: { kind: "children", invalidates: 0 } },
			node: (definition) => new FixedSpace(definition),
		},
	).create();
	node.fixed = {
		matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		opacity: 1,
		clip: undefined,
		penScale: undefined,
		yUp: true,
		lengthScale: 1,
		...space,
	};
	node.setChildren(children);
	return node;
}

const specOf = (node: SceneNode) =>
	(node as unknown as { spec: DrawSpec }).spec;
const shapeOf = (node: SceneNode) => specOf(node) as ShapeSpec;

describe("camera, size and frame never reach a spec", () => {
	it("a spec, its outline and the frame keep their identity through view and yUp changes", () => {
		const box = rect.create({ width: 1, height: 1 });
		const drawables: SceneNode[] = [
			circle.create({ center: { x: 1, y: 2 }, radius: 3, fill: "#ff0000" }),
			text.create({ text: "hi", x: 1, y: 1 }),
			box,
		];
		const t = mount([
			drawables[0] as SceneNode,
			drawables[1] as SceneNode,
			group.create({ x: 2, scale: 2, children: [box] }),
		]);
		const before = drawables.map(specOf);
		const outlines = before.map((spec) =>
			spec.kind === "shape" ? [spec.local?.curvePaths, spec.polylines] : [],
		);
		const frame = t.graph.frame;

		t.setView({ units: 4 });
		t.setView({ center: { x: 5, y: -3 } });
		t.setView({ size: { width: 1920, height: 1080 } });
		// Nothing binds to the frame, so nothing is even dirty.
		expect(t.graph.needsCommit()).toBe(false);
		t.graph.setYUp(false);
		t.commit();

		drawables.forEach((node, i) => {
			const spec = specOf(node);
			expect(spec).toBe(before[i]);
			if (spec.kind === "shape") {
				expect(spec.local?.curvePaths).toBe(outlines[i]?.[0]);
				expect(spec.polylines).toBe(outlines[i]?.[1]);
			}
		});
		expect(t.graph.frame).toBe(frame);
	});

	it("(harness check) a spec that does depend on a prop is rebuilt", () => {
		const radius = track(1);
		const node = circle.create({ radius });
		const t = mount([node]);
		const before = shapeOf(node);
		radius.set(2);
		t.commit();
		expect(shapeOf(node)).not.toBe(before);
		expect(shapeOf(node).local?.curvePaths).not.toBe(before.local?.curvePaths);
	});

	it("only what binds to the frame follows the canvas and the units", () => {
		let updates = 0;
		const pinned = defineComposite<object>({
			name: "PinnedToEdge",
			props: {},
			setup: (ctx) => {
				const frame = ctx.context(frameContext);
				const x = derive(frame, (box) => {
					updates++;
					return box.maxX - 1;
				});
				return [circle.create({ radius: 0.5, x })];
			},
		});
		const still = circle.create({ radius: 1 });
		const edge = pinned.create();
		const t = mount([still, edge], {
			units: 16,
			size: { width: 800, height: 400 },
		});
		expect(t.frame.peek()).toEqual({ minX: -8, minY: -4, maxX: 8, maxY: 4 });
		const dot = edge.children[0] as SceneNode;
		expect(shapeOf(dot).local?.transform.e).toBe(7);
		const stillSpec = shapeOf(still);

		t.setView({ units: 8, center: { x: 1, y: 1 } });
		t.commit();
		expect(t.frame.peek()).toEqual({ minX: -3, minY: -1, maxX: 5, maxY: 3 });
		expect(shapeOf(dot).local?.transform.e).toBe(4);
		expect(shapeOf(still)).toBe(stillSpec);

		t.setView({ size: { width: 800, height: 800 } });
		t.commit();
		expect(t.frame.peek()).toEqual({ minX: -3, minY: -3, maxX: 5, maxY: 5 });
		expect(updates).toBeGreaterThan(0);
	});

	it("a node outside any scene reads the default frame", () => {
		const node = circle.create({ radius: 1 });
		expect(node.context(frameContext).peek()).toEqual({
			minX: -8,
			minY: -4.5,
			maxX: 8,
			maxY: 4.5,
		});
	});
});

describe("geometry and ink are in scene units", () => {
	it("a root shape's geometry is the definition's own, placed by its matrix alone", () => {
		const node = circle.create({ center: { x: 1, y: 2 }, radius: 3 });
		mount([node]);
		const spec = shapeOf(node);
		const xs = spec.polylines[0]?.map((p) => p.x) ?? [];
		const ys = spec.polylines[0]?.map((p) => p.y) ?? [];
		expect(Math.min(...xs)).toBeCloseTo(-2, 5);
		expect(Math.max(...xs)).toBeCloseTo(4, 5);
		expect(Math.min(...ys)).toBeCloseTo(-1, 5);
		expect(Math.max(...ys)).toBeCloseTo(5, 5);
	});

	it("stroke width, dash and dash offset are the authored scene units at the root", () => {
		const node = circle.create({
			radius: 1,
			strokeWidth: 0.07,
			dash: [0.2, 0.1],
			dashOffset: 0.05,
		});
		mount([node]);
		const { style } = shapeOf(node);
		expect(style.strokeWidth).toBeCloseTo(0.07, 9);
		expect(style.dash).toEqual([0.2, 0.1]);
		expect(style.dashOffset).toBeCloseTo(0.05, 9);
	});

	it("falls back to the theme's stroke width unscaled by any pixel factor", () => {
		const node = circle.create({ radius: 1 });
		mount([node]);
		expect(shapeOf(node).style.strokeWidth).toBeCloseTo(
			theme.defaults.strokeWidth,
			9,
		);
	});

	it("a scaled group thickens ink with its geometry, and the local TRS adds on top", () => {
		const node = circle.create({
			radius: 1,
			x: 1,
			strokeWidth: 0.1,
			dash: [0.2, 0.1],
			dashOffset: 0.1,
		});
		mount([group.create({ x: 10, scale: 3, children: [node] })]);
		const spec = shapeOf(node);
		expect(spec.style.strokeWidth).toBeCloseTo(0.3, 9);
		expect(spec.style.dash?.[0]).toBeCloseTo(0.6, 9);
		expect(spec.style.dash?.[1]).toBeCloseTo(0.3, 9);
		expect(spec.style.dashOffset).toBeCloseTo(0.3, 9);
		// Circle at 0 + x=1, through scale 3 and x=10: centre at 13, radius 3.
		const xs = spec.polylines[0]?.map((p) => p.x) ?? [];
		expect(Math.min(...xs)).toBeCloseTo(10, 4);
		expect(Math.max(...xs)).toBeCloseTo(16, 4);
	});

	it("a linear map bakes into the vertices but a pinned pen keeps the ink as authored", () => {
		const node = rect.create({
			width: 2,
			height: 2,
			strokeWidth: 0.1,
			dash: [0.5],
		});
		mount([
			linearTransform(
				{
					matrix: linearMap([
						[3, 0],
						[0, 1],
					]),
					penScale: 1,
				},
				[node],
			),
		]);
		const spec = shapeOf(node);
		// A non-uniform scale is baked, not drawn under a matrix.
		expect(spec.local).toBeUndefined();
		const xs = spec.polylines[0]?.map((p) => p.x) ?? [];
		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6, 5);
		expect(spec.style.strokeWidth).toBeCloseTo(0.1, 9);
		expect(spec.style.dash).toEqual([0.5]);
	});

	it("without a pinned pen the map's scale reaches the ink", () => {
		const node = rect.create({ width: 1, height: 1, strokeWidth: 0.1 });
		mount([
			linearTransform(
				{
					matrix: linearMap([
						[2, 0],
						[0, 2],
					]),
				},
				[node],
			),
		]);
		expect(shapeOf(node).style.strokeWidth).toBeCloseTo(0.2, 9);
	});

	it("text size, spacing and anchor are scene units scaled only by groups", () => {
		const node = text.create({
			text: "x",
			x: 1,
			fontSize: 0.5,
			letterSpacing: 0.1,
		});
		mount([group.create({ scale: 2, x: 1, children: [node] })]);
		const spec = specOf(node) as TextSpec;
		expect(spec.at).toEqual({ x: 3, y: 0 });
		expect(spec.style.fontSize).toBeCloseTo(1, 9);
		expect(spec.style.letterSpacing).toBeCloseTo(0.2, 9);
	});

	it("a bbox gradient rides the shape's own box and TRS", () => {
		const node = rect.create({
			width: 4,
			height: 2,
			x: 10,
			fill: linearGradient(["red", "blue"], {
				from: { x: 0, y: 0.5 },
				to: { x: 1, y: 0.5 },
			}),
		});
		mount([node]);
		const spec = shapeOf(node);
		const { fill } = spec.style;
		if (!fill || typeof fill === "string" || fill.kind !== "linear") {
			throw new Error("expected a linear gradient");
		}
		// Drawn from local geometry, so the gradient is in local units and rides
		// the same transform: the box is x in [-2, 2] there, and through x = 10
		// the axis lands at 8 to 12 at y = 0.
		const m = spec.local?.transform;
		if (!m) throw new Error("expected local geometry");
		const toScene = (p: { x: number; y: number }) => ({
			x: m.a * p.x + m.c * p.y + m.e,
			y: m.b * p.x + m.d * p.y + m.f,
		});
		expect(toScene(fill.from).x).toBeCloseTo(8, 9);
		expect(toScene(fill.to).x).toBeCloseTo(12, 9);
		expect(toScene(fill.from).y).toBeCloseTo(0, 9);
	});

	it("a bbox gradient follows a new outline, baked under a skew", () => {
		const width = track(4);
		const node = rect.create({
			width,
			height: 2,
			fill: linearGradient(["red", "blue"], {
				from: { x: 0, y: 0.5 },
				to: { x: 1, y: 0.5 },
			}),
		});
		const t = mount([
			linearTransform(
				{
					matrix: linearMap([
						[1, 0.5],
						[0, 1],
					]),
				},
				[node],
			),
		]);
		const read = () => {
			const { fill } = shapeOf(node).style;
			if (!fill || typeof fill === "string" || fill.kind !== "linear") {
				throw new Error("expected a linear gradient");
			}
			return fill;
		};
		expect(shapeOf(node).local).toBeUndefined();
		expect(read().from.x).toBeCloseTo(-2, 9);
		width.set(6);
		t.commit();
		expect(read().from.x).toBeCloseTo(-3, 9);
		expect(read().to.x).toBeCloseTo(3, 9);
	});

	it("a scene-units gradient is passed through untouched, even inside a group and a moved shape", () => {
		const node = circle.create({
			radius: 1,
			x: 2,
			fill: radialGradient(["red", "blue"], {
				units: "scene",
				from: { x: 1, y: 2 },
				to: { x: 3, y: 4 },
				fromRadius: 0.5,
				toRadius: 2,
			}),
		});
		mount([group.create({ scale: 5, x: 3, children: [node] })]);
		const { fill } = shapeOf(node).style;
		if (!fill || typeof fill === "string" || fill.kind !== "radial") {
			throw new Error("expected a radial gradient");
		}
		expect(fill.from).toEqual({ x: 1, y: 2 });
		expect(fill.to).toEqual({ x: 3, y: 4 });
		expect(fill.fromRadius).toBe(0.5);
		expect(fill.toRadius).toBe(2);
	});

	it("a handle's bounds are in scene units through a group, and a view change moves none of it", () => {
		const node = rect.create({ width: 2, height: 1 });
		const t = mount([group.create({ x: 4, scale: 2, children: [node] })]);
		const bounds = node.bounds();
		expect(bounds?.minX).toBeCloseTo(2, 9);
		expect(bounds?.maxX).toBeCloseTo(6, 9);
		expect(bounds?.minY).toBeCloseTo(-1, 9);
		expect(bounds?.maxY).toBeCloseTo(1, 9);
		t.setView({ units: 2, center: { x: 9, y: 9 } });
		t.commit();
		expect(node.bounds()).toBe(bounds);
	});
});
