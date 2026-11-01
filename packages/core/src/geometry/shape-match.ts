/**
 * Pairing shapes by point-cloud similarity (`TransformMatchingShapes`):
 * `matchShapesByPointCloud` decides which `from` shape becomes which `to` shape,
 * and `morphShapes` interpolates matched pairs (`morphRings`) and cross-fades the
 * rest (`crossFade`, shared with `text/morph.ts`).
 *
 * Each shape is described by vertex and ring counts, area and perimeter over its
 * RMS radius, and normalised second moments, so matching ignores translation
 * and uniform scale but not rotation. Pairing is greedy, cheapest first;
 * unrelated shapes with similar descriptors can pair, which `maxCost` refuses.
 */

import { progressIn } from "./lerp.js";
import { morphRings } from "./morph.js";
import { ringArea } from "./path/arclength.js";
import type { Point, Polyline } from "./path/types.js";

/**
 * How far apart the two fades are, as a fraction of the run.
 *
 * 0 is a plain cross-fade, where the two opacities always sum to 1. Staggering
 * reads better on a formula — the old line clears before the new one crowds it
 * — but only up to a point: at a stagger of 1 the two never overlap at all and
 * the midpoint of the transform is an *empty stage*, which is worse than any
 * smudge. This leaves the pair overlapping across the middle third.
 *
 * Shared (along with `crossFade`) by `morphShapes` here and `text/morph.ts`'s
 * `morphLatex` — the sibling strategy that fades unmatched LaTeX parts
 * instead of unmatched shapes — so both use the exact same stagger.
 *
 * @category Morphing & matching
 */
export const FADE_STAGGER = 0.34;

/**
 * Opacity of the leaving and arriving halves of a transform at `t`.
 *
 * The two ramps are offset by {@link FADE_STAGGER} so they overlap only across
 * the middle of the run.
 *
 * @param t - Progress, 0..1.
 * @returns `out` (1 at `t = 0`, reaching 0 before the end) and `in` (0 until `t`
 *   passes the stagger, then rising to 1), each clamped to 0..1.
 *
 * @category Morphing & matching
 */
export function crossFade(t: number): { out: number; in: number } {
	return {
		out: 1 - progressIn(t, 0, 1 - FADE_STAGGER),
		in: progressIn(t, FADE_STAGGER, 1),
	};
}

/**
 * One shape to match — a set of contours, with an optional caller id.
 *
 * @category Morphing & matching
 */
export interface ShapePart {
	/** Stable identity for this shape. Defaults to its index if omitted;
	 * only used to label the sampled output, never read by the matcher. */
	id?: string;
	/** One or more closed contours describing this shape. */
	polylines: Polyline[];
}

/**
 * One part of the in-between group, sampled at some `t`.
 *
 * @category Morphing & matching
 */
export interface MatchedShapePart {
	/** Stable across `t` — the list's shape never changes, only its contents. */
	id: string;
	polylines: Polyline[];
	opacity: number;
	/** What happened to this shape: it moved (possibly reshaping en route to
	 * its match), it left, or it arrived. There is no `"morphed"` role the
	 * way `text/morph.ts`'s `mismatch: "morph"` has one — an unmatched
	 * shape here has, by construction, nothing plausible to become. */
	role: "moved" | "out" | "in";
}

/**
 * Samples the whole transform at `t` in 0..1.
 *
 * @category Morphing & matching
 */
export type ShapeTransform = (t: number) => MatchedShapePart[];

/**
 * Options for {@link matchShapesByPointCloud} and {@link morphShapes}.
 *
 * @category Morphing & matching
 */
export interface MatchShapesOptions {
	/**
	 * Above this descriptor cost, a candidate pair is left unmatched rather
	 * than forced together — see the module doc's honesty section on
	 * coincidental matches. `Infinity` (the default) always matches
	 * everything it can, cheapest pairs first. The cost is a unitless
	 * descriptor distance, so tune it by experiment.
	 *
	 * @default Infinity
	 */
	maxCost?: number;
}

/**
 * The correspondence found by {@link matchShapesByPointCloud}.
 *
 * @category Morphing & matching
 */
export interface ShapeMatch {
	/** Matched `[source, target]` pairs, cheapest first. */
	pairs: [ShapePart, ShapePart][];
	/** Source shapes with no match; these fade out. */
	sourceOnly: ShapePart[];
	/** Target shapes with no match; these fade in. */
	targetOnly: ShapePart[];
}

interface ShapeDescriptor {
	vertexCount: number;
	ringCount: number;
	area: number;
	perimeter: number;
	ixx: number;
	iyy: number;
	ixy: number;
}

function centroidOf(polylines: Polyline[]): Point {
	let sx = 0;
	let sy = 0;
	let n = 0;
	for (const line of polylines) {
		for (const p of line) {
			sx += p.x;
			sy += p.y;
			n++;
		}
	}
	return n === 0 ? { x: 0, y: 0 } : { x: sx / n, y: sy / n };
}

function ringPerimeter(line: Polyline): number {
	let length = 0;
	for (let i = 0; i < line.length; i++) {
		const a = line[i];
		const b = line[(i + 1) % line.length];
		length += Math.hypot(b.x - a.x, b.y - a.y);
	}
	return length;
}

/**
 * The similarity key described in the module doc: counts, plus
 * area/perimeter/second-moments normalised by the point cloud's own RMS
 * radius so the result is translation- and scale-invariant.
 */
function describeShape(part: ShapePart): ShapeDescriptor {
	const points = part.polylines.flat();
	const vertexCount = points.length;
	const ringCount = part.polylines.length;
	if (vertexCount === 0) {
		return {
			vertexCount: 0,
			ringCount,
			area: 0,
			perimeter: 0,
			ixx: 0,
			iyy: 0,
			ixy: 0,
		};
	}

	const centroid = centroidOf(part.polylines);
	let sumSq = 0;
	for (const p of points) {
		sumSq += (p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2;
	}
	// The normalising radius that makes every other feature scale-invariant.
	// Falls back to 1 for a degenerate (single-point) cloud, where there is
	// no meaningful scale to divide by.
	const scale = Math.sqrt(sumSq / vertexCount) || 1;

	let area = 0;
	let perimeter = 0;
	for (const line of part.polylines) {
		area += ringArea(line);
		perimeter += ringPerimeter(line);
	}

	let ixx = 0;
	let iyy = 0;
	let ixy = 0;
	for (const p of points) {
		const dx = (p.x - centroid.x) / scale;
		const dy = (p.y - centroid.y) / scale;
		ixx += dx * dx;
		iyy += dy * dy;
		ixy += dx * dy;
	}
	ixx /= vertexCount;
	iyy /= vertexCount;
	ixy /= vertexCount;

	return {
		vertexCount,
		ringCount,
		area: Math.abs(area) / (scale * scale),
		perimeter: perimeter / scale,
		ixx,
		iyy,
		ixy,
	};
}

/**
 * Weighted squared distance between two descriptors. Ring-count mismatches
 * are weighted heaviest (a shape gaining or losing a hole is a strong signal
 * something else is going on), moments next (they're what separates a
 * square from a diamond of the same area), then area/perimeter/vertex count.
 * These weights are a starting point, not a calibrated model — there is no
 * ground truth for "how much does a hole matter relative to elongation"
 * short of eyeballing the result on real scenes.
 */
function descriptorCost(a: ShapeDescriptor, b: ShapeDescriptor): number {
	const vertexPenalty = (a.vertexCount - b.vertexCount) ** 2;
	const ringPenalty = (a.ringCount - b.ringCount) ** 2 * 4;
	const areaPenalty = (a.area - b.area) ** 2;
	const perimeterPenalty = (a.perimeter - b.perimeter) ** 2;
	const momentPenalty =
		(a.ixx - b.ixx) ** 2 + (a.iyy - b.iyy) ** 2 + (a.ixy - b.ixy) ** 2 * 2;
	return (
		vertexPenalty +
		ringPenalty +
		areaPenalty +
		perimeterPenalty +
		momentPenalty * 4
	);
}

/**
 * The correspondence half: pairs `source` shapes to `target` shapes by
 * point-cloud similarity, greedy cheapest-first (ties broken by scan order,
 * which is fixed for a given input — so this is deterministic run to run),
 * leaving whatever is left over in `sourceOnly`/`targetOnly`. See the module
 * doc for the descriptor this ranks on and its honest failure modes.
 *
 * @param source - Shapes before the transform.
 * @param target - Shapes after the transform.
 * @param options - Cost cutoff.
 * @returns The pairs and the leftovers on each side.
 *
 * @category Morphing & matching
 */
export function matchShapesByPointCloud(
	source: ShapePart[],
	target: ShapePart[],
	options: MatchShapesOptions = {},
): ShapeMatch {
	const maxCost = options.maxCost ?? Number.POSITIVE_INFINITY;
	const sourceDescriptors = source.map(describeShape);
	const targetDescriptors = target.map(describeShape);

	const candidates: { from: number; to: number; cost: number }[] = [];
	for (let i = 0; i < source.length; i++) {
		for (let j = 0; j < target.length; j++) {
			const cost = descriptorCost(sourceDescriptors[i], targetDescriptors[j]);
			if (cost <= maxCost) candidates.push({ from: i, to: j, cost });
		}
	}
	// Stable sort, so ties keep their (source, target) scan order — the same
	// two inputs always pair the same way, which is what "deterministic"
	// means for an animation a caller re-renders every frame.
	candidates.sort((a, b) => a.cost - b.cost);

	const takenFrom = new Set<number>();
	const takenTo = new Set<number>();
	const pairs: [ShapePart, ShapePart][] = [];
	for (const candidate of candidates) {
		if (takenFrom.has(candidate.from) || takenTo.has(candidate.to)) continue;
		takenFrom.add(candidate.from);
		takenTo.add(candidate.to);
		pairs.push([source[candidate.from], target[candidate.to]]);
	}

	return {
		pairs,
		sourceOnly: source.filter((_, i) => !takenFrom.has(i)),
		targetOnly: target.filter((_, j) => !takenTo.has(j)),
	};
}

/**
 * Builds a shape-matching transform (once, outside the frame loop): exactly
 * `from` at 0 and `to` at 1. Matches arbitrary contours by similarity, so
 * coincidental matches are possible.
 *
 * @param from - Shapes before the transform.
 * @param to - Shapes after the transform.
 * @param options - Cost cutoff.
 * @returns A function from progress (0..1, clamped) to the parts to draw.
 *
 * @example
 * ```ts
 * import { morphShapes } from "@sophistry/core/geometry";
 *
 * const box = (halfWidth: number) => [
 *   { x: -halfWidth, y: -1 },
 *   { x: halfWidth, y: -1 },
 *   { x: halfWidth, y: 1 },
 *   { x: -halfWidth, y: 1 },
 * ];
 * const sample = morphShapes(
 *   [{ polylines: [box(1)] }],
 *   [{ polylines: [box(2)] }],
 * );
 *
 * // Halfway: one part per matched pair, plus fading unmatched shapes.
 * for (const part of sample(0.5)) {
 *   console.log(part.polylines.length, "rings at opacity", part.opacity);
 * }
 * ```
 *
 * @category Morphing & matching
 */
export function morphShapes(
	from: ShapePart[],
	to: ShapePart[],
	options: MatchShapesOptions = {},
): ShapeTransform {
	const { pairs, sourceOnly, targetOnly } = matchShapesByPointCloud(
		from,
		to,
		options,
	);

	const moved = pairs.map(([source, target], index) => ({
		id: source.id ?? `moved:${index}`,
		// Outlines to outlines and counters to counters, each keeping its
		// winding, a contour with no partner shrinking or growing: nothing
		// about point-cloud similarity implies a shared ring or vertex count.
		morph: morphRings(source.polylines, target.polylines),
	}));

	return (t) => {
		const clamped = Math.min(1, Math.max(0, t));
		const parts: MatchedShapePart[] = [];

		for (const entry of moved) {
			parts.push({
				id: entry.id,
				role: "moved",
				opacity: 1,
				polylines: entry.morph(clamped),
			});
		}

		const fade = crossFade(clamped);
		for (let i = 0; i < sourceOnly.length; i++) {
			parts.push({
				id: sourceOnly[i].id ?? `out:${i}`,
				role: "out",
				opacity: fade.out,
				polylines: sourceOnly[i].polylines,
			});
		}
		for (let i = 0; i < targetOnly.length; i++) {
			parts.push({
				id: targetOnly[i].id ?? `in:${i}`,
				role: "in",
				opacity: fade.in,
				polylines: targetOnly[i].polylines,
			});
		}

		return parts;
	};
}
