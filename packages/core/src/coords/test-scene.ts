/**
 * Test harness for the coordinate systems: a manual scene graph with a theme,
 * and readers over its frame. Not exported from the barrel.
 */

import type { Point } from "../geometry";
import { themeContext } from "../scene/context";
import { SceneGraph } from "../scene/graph";
import type { SceneNode } from "../scene/types";
import type { MarksSpec, ShapeSpec, TextSpec } from "../spec/types";
import { resolveTheme } from "../themes";

export const theme = resolveTheme({ mode: "dark" });

/**
 * The shapes an outline-kind marks spec stands for: item `i` as the
 * `ShapeSpec` the same node would publish on its own (its outline placed by
 * the item's centre and linear part, its opacity and reveal folded in). Lets
 * a test read a batched family (a grid's lines) as the lines it stands for.
 */
function shapesOfMarks(spec: MarksSpec): ShapeSpec[] {
	const { shape } = spec;
	if (shape.kind !== "outline" && shape.kind !== "paths") return [];
	const out: ShapeSpec[] = [];
	for (let i = 0; i < spec.count; i++) {
		const outline = shape.kind === "paths" ? shape.outlines[i] : shape;
		if (!outline) continue;
		const cx = spec.centers[2 * i] as number;
		const cy = spec.centers[2 * i + 1] as number;
		const t = spec.transforms;
		const [a, b, c, d] = t
			? [
					t[4 * i] as number,
					t[4 * i + 1] as number,
					t[4 * i + 2] as number,
					t[4 * i + 3] as number,
				]
			: [1, 0, 0, 1];
		out.push({
			kind: "shape",
			id: spec.id,
			zIndex: spec.zIndex,
			polylines: outline.polylines.map((line) =>
				line.map((p) => ({
					x: cx + a * p.x + c * p.y,
					y: cy + b * p.x + d * p.y,
				})),
			),
			closed: outline.closed,
			fillFrom: 0,
			style: {
				...spec.style,
				opacity:
					spec.style.opacity * (spec.alphas ? (spec.alphas[i] as number) : 1),
			},
			progress:
				spec.progress * (spec.progresses ? (spec.progresses[i] as number) : 1),
			...(spec.clip ? { clip: spec.clip } : {}),
		});
	}
	return out;
}

/** The frame's shapes in paint order, batched outlines read as the shapes they stand for. */
function frameShapes(graph: SceneGraph): ShapeSpec[] {
	return graph.frame.flatMap((s) =>
		s.kind === "shape" ? [s] : s.kind === "marks" ? shapesOfMarks(s) : [],
	);
}

/** A graph committed by hand, with `nodes` added to its root. */
export function mount(...nodes: SceneNode[]) {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	for (const node of nodes) graph.root.add(node);
	graph.commit();
	return {
		graph,
		commit: () => graph.commit(),
		shapes: () => frameShapes(graph),
		texts: () => graph.frame.filter((s): s is TextSpec => s.kind === "text"),
		/** Two-point shapes, as `[a, b]` with the spec. */
		segments: () =>
			frameShapes(graph).flatMap((s) => {
				if (s.polylines.length !== 1) return [];
				const line = s.polylines[0] as Point[];
				const [a, b] = line;
				return line.length === 2 && a && b ? [{ spec: s, a, b }] : [];
			}),
	};
}
