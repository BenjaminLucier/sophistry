/**
 * Marks and image nodes: one node per layer, baked through the enclosing
 * space, each stage rerunning only for its own props.
 */

import { describe, expect, it, vi } from "vitest";
import { linearGradient } from "../spec/gradient";
import type { ImageSpec, MarksSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import { Invalidate, themeContext } from "./context";
import { SceneGraph } from "./graph";
import { group } from "./group";
import {
	bakeMarks,
	defineImage,
	defineMarks,
	type ImageProps,
	imageProps,
	type MarksProps,
	marksProps,
} from "./marks";

const theme = resolveTheme({ mode: "dark" });

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	return { graph, commit: () => graph.commit() };
}

interface DotsProps extends MarksProps {
	points: readonly { x: number; y: number }[];
	radius?: number;
	kind?: "circle" | "rect";
}

function dotsDefinition() {
	const marks = vi.fn((props: Readonly<DotsProps>) => {
		const rect = props.kind === "rect";
		const radius = props.radius ?? 0.1;
		return {
			shape: { kind: props.kind ?? "circle" } as const,
			count: props.points.length,
			centers: Float64Array.from(props.points.flatMap((p) => [p.x, p.y])),
			extents: new Float64Array(props.points.length * (rect ? 2 : 1)).fill(
				radius,
			),
			fills: "#f00",
		};
	});
	const dots = defineMarks<DotsProps>({
		name: "Dots",
		props: {
			...marksProps,
			points: { default: [], invalidates: Invalidate.GEOMETRY },
			radius: { default: 0.1, invalidates: Invalidate.GEOMETRY },
			kind: { default: "circle", invalidates: Invalidate.GEOMETRY },
		},
		marks,
	});
	return { dots, marks };
}

const points = [
	{ x: 0, y: 0 },
	{ x: 1, y: 2 },
];

describe("marks node", () => {
	it("publishes one MarksSpec for the layer, in scene units", () => {
		const { dots } = dotsDefinition();
		const { graph, commit } = manualGraph();
		const node = dots.create({ points, radius: 0.5, zIndex: 2 });
		graph.root.add(group.create({ x: 10, scale: 2, children: [node] }));
		commit();
		const spec = node.spec as MarksSpec;
		expect(spec.kind).toBe("marks");
		expect(spec.count).toBe(2);
		expect([...spec.centers]).toEqual([10, 0, 12, 4]);
		expect([...spec.extents]).toEqual([1, 1]);
		expect(spec.bounds).toEqual({ minX: 9, minY: -1, maxX: 13, maxY: 5 });
		expect(spec.zIndex).toBe(2);
		expect(spec.alphas).toBeNull();
		// The stroke defaults to none; its width scales with the space.
		expect(spec.style.stroke).toBe("none");
		expect(spec.style.strokeWidth).toBeCloseTo(
			theme.defaults.strokeWidth * 2,
			9,
		);
		expect(spec.style.fill).toBeNull();
		expect(graph.frame).toEqual([spec]);
	});

	it("at the root hands the definition's arrays over as they are", () => {
		const { dots, marks } = dotsDefinition();
		const { graph, commit } = manualGraph();
		const node = graph.root.add(dots.create({ points }));
		commit();
		const spec = node.spec as MarksSpec;
		const source = marks.mock.results[0]?.value as {
			centers: Float64Array;
			extents: Float64Array;
		};
		expect(spec.centers).toBe(source.centers);
		expect(spec.extents).toBe(source.extents);
		expect(
			bakeMarks(source as never, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }).bounds,
		).toEqual(spec.bounds);
	});

	it("reruns marks only for geometry props; a space move rebakes without it", () => {
		const { dots, marks } = dotsDefinition();
		const { graph, commit } = manualGraph();
		const node = dots.create({ points });
		const parent = graph.root.add(group.create({ children: [node] }));
		commit();
		expect(marks).toHaveBeenCalledTimes(1);
		const first = node.spec as MarksSpec;

		node.set("progress", 0.5);
		commit();
		const revealed = node.spec as MarksSpec;
		expect(revealed.centers).toBe(first.centers);
		expect(revealed.style).toBe(first.style);
		expect(revealed.progress).toBe(0.5);

		parent.set("x", 1);
		commit();
		expect(marks).toHaveBeenCalledTimes(1);
		expect([...(node.spec as MarksSpec).centers]).toEqual([1, 0, 2, 2]);
		// A translation leaves the pen alone, so the style is kept.
		expect((node.spec as MarksSpec).style).toBe(first.style);

		node.set("points", [{ x: 5, y: 5 }]);
		commit();
		expect(marks).toHaveBeenCalledTimes(2);
		expect((node.spec as MarksSpec).count).toBe(1);
	});

	it("restyles for its paints, the theme and the space's opacity", () => {
		const { dots } = dotsDefinition();
		const { graph, commit } = manualGraph();
		const node = dots.create({ points, stroke: "#00f", strokeWidth: 0.1 });
		const parent = graph.root.add(group.create({ children: [node] }));
		commit();
		expect((node.spec as MarksSpec).style.stroke).toBe("#00f");
		parent.set("opacity", 0.5);
		commit();
		expect((node.spec as MarksSpec).style.opacity).toBe(0.5);
		node.set("opacity", 0.5);
		commit();
		expect((node.spec as MarksSpec).style.opacity).toBe(0.25);
	});

	it("a gradient stroke spans the layer's scene box and follows it", () => {
		const { dots } = dotsDefinition();
		const { graph, commit } = manualGraph();
		const node = dots.create({
			points,
			radius: 0,
			stroke: linearGradient(["red", "blue"], {
				from: { x: 0, y: 0 },
				to: { x: 1, y: 0 },
			}),
		});
		const parent = graph.root.add(group.create({ children: [node] }));
		commit();
		const read = () => {
			const stroke = (node.spec as MarksSpec).style.stroke;
			if (typeof stroke === "string" || stroke.kind !== "linear")
				throw new Error("gradient");
			return stroke;
		};
		expect(read().from.x).toBeCloseTo(0, 9);
		expect(read().to.x).toBeCloseTo(1, 9);
		parent.set("x", 3);
		commit();
		expect(read().from.x).toBeCloseTo(3, 9);
	});

	it("rect items scale each half-extent by its own axis", () => {
		const { dots } = dotsDefinition();
		const { graph, commit } = manualGraph();
		const node = dots.create({ points, kind: "rect", radius: 1 });
		graph.root.add(group.create({ scale: 2, scaleY: 3, children: [node] }));
		commit();
		expect([...(node.spec as MarksSpec).extents]).toEqual([2, 3, 2, 3]);
	});

	it("an empty or hidden layer publishes nothing; a handle measures the items", () => {
		const { dots } = dotsDefinition();
		const { graph, commit } = manualGraph();
		const empty = graph.root.add(dots.create({ points: [] }));
		const hidden = graph.root.add(dots.create({ points, visible: false }));
		commit();
		expect(empty.spec).toBeNull();
		expect(hidden.spec).toBeNull();
		expect(hidden.bounds()).toEqual({
			minX: -0.1,
			minY: -0.1,
			maxX: 1.1,
			maxY: 2.1,
		});
		expect(empty.bounds()).toBeNull();
	});

	it("handlers make it interactive like any node", () => {
		const { dots } = dotsDefinition();
		const { graph, commit } = manualGraph();
		const node = graph.root.add(dots.create({ points, onTap: () => {} }));
		commit();
		expect(graph.interactive.has(node)).toBe(true);
	});
});

interface BitmapProps extends ImageProps {
	width?: number;
}

describe("image node", () => {
	const pixels = { width: 2, height: 1, data: new Uint8ClampedArray(8) };
	const bitmap = defineImage<BitmapProps>({
		name: "Bitmap",
		props: {
			...imageProps,
			width: { default: 2, invalidates: Invalidate.GEOMETRY },
		},
		image: (props) => ({
			pixels,
			origin: { x: 0, y: 1 },
			xAxis: { x: props.width ?? 2, y: 0 },
			yAxis: { x: 0, y: -1 },
		}),
	});

	it("maps the raster's frame through the space", () => {
		const { graph, commit } = manualGraph();
		const node = bitmap.create({ opacity: 0.5, smoothing: true });
		graph.root.add(
			group.create({ x: 1, scale: 2, opacity: 0.5, children: [node] }),
		);
		commit();
		const spec = node.spec as ImageSpec;
		expect(spec).toMatchObject({
			kind: "image",
			pixels,
			origin: { x: 1, y: 2 },
			xAxis: { x: 4, y: 0 },
			yAxis: { x: 0, y: -2 },
			smoothing: true,
			opacity: 0.25,
			progress: 1,
			zIndex: 0,
		});
		expect(node.bounds()).toEqual({ minX: 1, minY: 0, maxX: 5, maxY: 2 });
	});

	it("keeps its spec for an unchanged frame, and rebuilds it on a move", () => {
		const { graph, commit } = manualGraph();
		const node = bitmap.create();
		const parent = graph.root.add(group.create({ children: [node] }));
		commit();
		const first = node.spec;
		parent.set("opacity", 1);
		commit();
		expect(node.spec).toBe(first);
		parent.set("x", 2);
		commit();
		expect((node.spec as ImageSpec).origin).toEqual({ x: 2, y: 1 });
		expect((node.spec as ImageSpec).pixels).toBe(pixels);
		node.set("visible", false);
		commit();
		expect(graph.frame).toEqual([]);
	});
});
