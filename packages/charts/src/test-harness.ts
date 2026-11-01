/**
 * Test harness for chart components: a hand-committed scene graph with a
 * theme, readers over its frame, and a manual clock for transitions. Not
 * exported from the package entry.
 */

import type { ContextKey, CoordinateSystem, SceneNode } from "@sophistry/core";
import {
	clockContext,
	coordsContext,
	createClock,
	defineComposite,
	reducedMotionContext,
	themeContext,
	track,
} from "@sophistry/core";
import type { Point, Polyline } from "@sophistry/core/geometry";
import type { MarksSpec, ShapeSpec, TextSpec } from "@sophistry/core/internal";
import { SceneGraph } from "@sophistry/core/internal";
import { resolveTheme } from "@sophistry/core/themes";
import { chartContext } from "./context.js";
import type { ChartFrame } from "./frame/types.js";

export const theme = resolveTheme({ mode: "dark" });

/**
 * The shapes an outline-kind marks spec stands for: item `i` as the `ShapeSpec`
 * the same node would publish on its own (outline placed, opacity and reveal
 * folded in), so a test can read a batched family (a grid's lines) as the
 * lines it replaces.
 */
function shapesOfMarks(spec: MarksSpec): ShapeSpec[] {
	if (spec.shape.kind !== "outline" && spec.shape.kind !== "paths") return [];
	return markItems(spec).map((item, i) => ({
		kind: "shape",
		id: spec.id,
		zIndex: spec.zIndex,
		polylines: item.polylines,
		closed: closedOf(spec, i),
		fillFrom: 0,
		style: { ...spec.style, opacity: spec.style.opacity * item.alpha },
		progress: spec.progress * (spec.progresses?.[i] ?? 1),
		...(spec.clip ? { clip: spec.clip } : {}),
	}));
}

/** Whether item `i` of an outline-kind marks spec is a closed outline. */
function closedOf(spec: MarksSpec, i: number): boolean {
	const shape = spec.shape;
	if (shape.kind === "outline") return shape.closed;
	if (shape.kind === "paths") return shape.outlines[i]?.closed ?? false;
	return true;
}

/**
 * A graph committed by hand, with `nodes` added to its root and a manual
 * clock in context (`advance(seconds)` steps it and commits).
 */
export function mount(...nodes: SceneNode[]) {
	const graph = new SceneGraph({ schedule: () => {} });
	const clock = createClock({ reducedMotion: "no-preference" });
	graph.root.provide(themeContext, theme);
	graph.root.provide(clockContext, clock);
	graph.root.provide(reducedMotionContext, track(false));
	for (const node of nodes) graph.root.add(node);
	graph.commit();
	return {
		graph,
		clock,
		commit: () => graph.commit(),
		/** Steps the clock by `seconds` and commits. */
		advance(seconds: number) {
			clock.advance(seconds);
			graph.commit();
		},
		shapes: () => graph.frame.filter((s): s is ShapeSpec => s.kind === "shape"),
		/** The shapes the batched outline layers (a grid's lines) stand for. */
		batchedShapes: () =>
			graph.frame.flatMap((s) => (s.kind === "marks" ? shapesOfMarks(s) : [])),
		texts: () => graph.frame.filter((s): s is TextSpec => s.kind === "text"),
		marks: () => graph.frame.filter((s): s is MarksSpec => s.kind === "marks"),
	};
}

/** One item of a batched layer, decoded from its `MarksSpec`, in scene units. */
export interface MarkItem {
	/** Item centre. */
	center: Point;
	/** Radius (circle, polygon marks), or `{ halfWidth, halfHeight }` read from a rect mark. */
	radius: number;
	halfWidth: number;
	halfHeight: number;
	/** Fill (`"none"` for none). */
	fill: string;
	/** Per-item stroke, when the spec has per-item strokes. */
	stroke?: string;
	/** Per-item opacity (1 when the spec has none). */
	alpha: number;
	/** The outline, placed in scene units (outline, paths and rect marks; empty for circles). */
	polylines: Polyline[];
}

/** The items of a marks spec, decoded (outline transforms applied). */
export function markItems(spec: MarksSpec): MarkItem[] {
	const out: MarkItem[] = [];
	const shape = spec.shape;
	for (let i = 0; i < spec.count; i++) {
		const cx = spec.centers[2 * i] as number;
		const cy = spec.centers[2 * i + 1] as number;
		const fill =
			typeof spec.fills === "string" ? spec.fills : (spec.fills[i] as string);
		let polylines: Polyline[] = [];
		let radius = 0;
		let halfWidth = 0;
		let halfHeight = 0;
		if (shape.kind === "circle" || shape.kind === "polygon") {
			radius = spec.extents[i] as number;
			halfWidth = radius;
			halfHeight = radius;
		} else if (shape.kind === "rect") {
			halfWidth = spec.extents[2 * i] as number;
			halfHeight = spec.extents[2 * i + 1] as number;
			polylines = [
				[
					{ x: cx - halfWidth, y: cy - halfHeight },
					{ x: cx + halfWidth, y: cy - halfHeight },
					{ x: cx + halfWidth, y: cy + halfHeight },
					{ x: cx - halfWidth, y: cy + halfHeight },
				],
			];
		} else {
			const lines =
				shape.kind === "outline"
					? shape.polylines
					: (shape.outlines[i]?.polylines ?? []);
			const t = spec.transforms;
			const [a, b, c, d] = t
				? [
						t[4 * i] as number,
						t[4 * i + 1] as number,
						t[4 * i + 2] as number,
						t[4 * i + 3] as number,
					]
				: [1, 0, 0, 1];
			polylines = lines.map((line) =>
				line.map((p) => ({
					x: cx + a * p.x + c * p.y,
					y: cy + b * p.x + d * p.y,
				})),
			);
		}
		out.push({
			center: { x: cx, y: cy },
			radius,
			halfWidth,
			halfHeight,
			fill,
			...(spec.strokes ? { stroke: spec.strokes[i] as string } : {}),
			alpha: spec.alphas ? (spec.alphas[i] as number) : 1,
			polylines,
		});
	}
	return out;
}

/**
 * A node to put among a chart's children that records what the chart
 * provides: its coordinate system and frame, re-read on every change.
 */
export function probe() {
	const seen: { coords: CoordinateSystem | null; frame: ChartFrame | null } = {
		coords: null,
		frame: null,
	};
	const read = (ctx: { context<T>(key: ContextKey<T>): T }) => {
		seen.coords = ctx.context(coordsContext);
		seen.frame = ctx.context(chartContext);
	};
	const node = defineComposite<object>({
		name: "Probe",
		props: {},
		setup: (ctx) => {
			read(ctx);
			return [];
		},
		update: (_changed, ctx) => {
			read(ctx);
			return undefined;
		},
	}).create({});
	return { node, seen };
}
