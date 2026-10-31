/**
 * Test helpers for the curve marks: the items of a path batch spec, decoded
 * back into scene units (outlines placed, paints resolved). Not exported
 * from the package entry.
 */

import type { CurvePath, Point, Polyline } from "@sophistry/core/geometry";
import type {
	ClipRegion,
	MarkOutline,
	MarksSpec,
} from "@sophistry/core/internal";

/** One drawn item of a curve mark, in scene units. */
export interface CurveItem {
	closed: boolean;
	/** The fill (`"none"` for none). */
	fill: string;
	/** The stroke: the item's own, else the spec's shared one. */
	stroke: string;
	strokeWidth: number;
	/** Shared opacity × the item's own × the spec's progress. */
	opacity: number;
	fillOpacity: number;
	/** The item's own arc-length reveal (1 when the spec has none). */
	progress: number;
	zIndex: number;
	/** Placed polylines (flattened curves for curved items). */
	polylines: Polyline[];
	/** Placed curves, when the item has them. */
	curvePaths: CurvePath[] | null;
	/** Every point of `polylines`, in order. */
	points: Point[];
	/** The spec's clip (from the mark's sweep, or the chart's). */
	clip: readonly ClipRegion[] | undefined;
}

/** Every item of every `paths` marks spec in `marks`, in paint order. */
export function curveItems(marks: readonly MarksSpec[]): CurveItem[] {
	const out: CurveItem[] = [];
	for (const spec of marks) {
		if (spec.shape.kind !== "paths") continue;
		const outlines = spec.shape.outlines as readonly MarkOutline[];
		for (let i = 0; i < spec.count; i++) {
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
			const place = (p: Point): Point => ({
				x: cx + a * p.x + c * p.y,
				y: cy + b * p.x + d * p.y,
			});
			const outline = outlines[i] as MarkOutline;
			const polylines = outline.polylines.map((line) => line.map(place));
			const curvePaths = outline.curvePaths
				? outline.curvePaths.map((path) => ({
						start: place(path.start),
						segments: path.segments.map((s) => ({
							c1: place(s.c1),
							c2: place(s.c2),
							to: place(s.to),
						})),
						closed: path.closed,
					}))
				: null;
			const fill =
				typeof spec.fills === "string" ? spec.fills : (spec.fills[i] as string);
			const stroke = spec.strokes
				? (spec.strokes[i] as string)
				: (spec.style.stroke as string);
			out.push({
				closed: outline.closed,
				fill,
				stroke,
				strokeWidth: spec.strokeWidths
					? (spec.strokeWidths[i] as number)
					: spec.style.strokeWidth,
				opacity:
					spec.style.opacity *
					(spec.alphas ? (spec.alphas[i] as number) : 1) *
					spec.progress,
				fillOpacity: spec.style.fillOpacity,
				progress: spec.progresses ? (spec.progresses[i] as number) : 1,
				zIndex: spec.zIndex,
				polylines,
				curvePaths,
				points: polylines.flat(),
				clip: spec.clip,
			});
		}
	}
	return out;
}

/** Rounds to 6 decimals (and turns -0 into 0), for comparing drawings across mounts. */
export const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;

/** A drawing comparable across mounts: each item's look and rounded points, sorted. */
export function drawing(items: readonly CurveItem[]): string[] {
	return items
		.filter((item) => item.points.length > 0 && item.opacity > 0)
		.map((item) =>
			JSON.stringify({
				closed: item.closed,
				fill: item.fill,
				stroke: item.closed ? undefined : item.stroke,
				opacity: rounded(item.opacity),
				fillOpacity: item.closed ? rounded(item.fillOpacity) : undefined,
				points: item.points.map((p) => [rounded(p.x), rounded(p.y)]),
			}),
		)
		.sort();
}

/** Whether two curve paths agree to `tolerance` in every knot and control point. */
export function closeCurves(
	a: CurvePath,
	b: CurvePath,
	tolerance = 1e-9,
): boolean {
	const near = (p: Point, q: Point) =>
		Math.abs(p.x - q.x) <= tolerance && Math.abs(p.y - q.y) <= tolerance;
	return (
		a.closed === b.closed &&
		a.segments.length === b.segments.length &&
		near(a.start, b.start) &&
		a.segments.every((s, i) => {
			const t = b.segments[i] as CurvePath["segments"][number];
			return near(s.c1, t.c1) && near(s.c2, t.c2) && near(s.to, t.to);
		})
	);
}

/** The items a scene's curve marks draw at paint order `layer` (or that order under the axes). */
export function itemsAt(
	marks: readonly MarksSpec[],
	layer: number,
): CurveItem[] {
	return curveItems(marks).filter(
		(item) =>
			item.zIndex === layer || Math.abs(item.zIndex - (layer - 0.5)) < 1e-12,
	);
}
