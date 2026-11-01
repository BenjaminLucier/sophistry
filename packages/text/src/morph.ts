/**
 * `morphLatex`: one formula into another, as Manim's `TransformMatchingTex`.
 * Parts match on `(kind, char)` (kept on each glyph by `outline.ts`), ties broken
 * by distance and size; matched parts move, leftovers fade, or with
 * `mismatch: "morph"` reshape into their nearest partner through `morphRings`.
 */

import type {
	Point,
	Polyline,
	RingsInterpolator,
} from "@sophistry/core/geometry";
import { centerOf, morphRings } from "@sophistry/core/geometry";
import {
	crossFade,
	FADE_STAGGER,
	lerpPolyline,
	unionBounds,
} from "@sophistry/core/internal";
import type { PlacedLatex, PlacedPart } from "./placed.js";

// The fade choreography is shared with `morphShapes`, so it lives beside it in
// `geometry/shape-match.ts`; re-exported here, where `text/` has always had it.
export { crossFade, FADE_STAGGER };

/**
 * One part of the in-between formula, sampled at some `t`.
 *
 * @category Morphing & matching
 */
export interface MorphedPart {
	/** Stable across `t` — the list's shape never changes, only its contents. */
	id: string;
	/** Closed contours at this `t`, in scene units, y-up. */
	polylines: Polyline[];
	/** 0..1. Always 1 for `"moved"` and `"morphed"`; cross-fades for `"out"` and `"in"`. */
	opacity: number;
	/** Glyph, rule or SVG piece, as on the source part. */
	kind: PlacedPart["kind"];
	/** Source character, if the part is a glyph. */
	char?: string;
	/**
	 * What happened to this part: `"moved"` travelled to its match, `"morphed"`
	 * was reshaped into a different glyph (only with `mismatch: "morph"`),
	 * `"out"` is leaving and `"in"` is arriving.
	 */
	role: "moved" | "morphed" | "out" | "in";
}

/**
 * Samples the whole transform at `t` in 0..1 (clamped), returning every part in play.
 *
 * @category Morphing & matching
 */
export type LatexMorph = (t: number) => MorphedPart[];

/**
 * Matching rules for {@link morphLatex} and `MathTransform`.
 *
 * @category Morphing & matching
 */
export interface LatexMorphOptions {
	/**
	 * Force a correspondence the characters do not imply — Manim's `key_map`.
	 * Keys and values are source and target characters: `{ "2": "\\pi" }` reads
	 * as "the 2 becomes the π" and makes that pair *move* rather than cross-fade.
	 */
	keyMap?: Record<string, string>;
	/**
	 * What to do with parts that exist on only one side. `"fade"` is Manim's
	 * behaviour and the default; `"morph"` pairs leftovers up by proximity and
	 * reshapes each into its partner, which is more spectacle and less
	 * legibility. See the note at the top of this file.
	 *
	 * @default "fade"
	 */
	mismatch?: "fade" | "morph";
}

function keyOf(part: PlacedPart, keyMap?: Record<string, string>): string {
	const char = part.char ?? "";
	return `${part.kind}|${keyMap?.[char] ?? char}`;
}

interface Pairing {
	pairs: [PlacedPart, PlacedPart][];
	sourceOnly: PlacedPart[];
	targetOnly: PlacedPart[];
}

/**
 * How much a size mismatch costs against distance, with distance in ems.
 * A script is about 0.7 the size of the text around it, which costs
 * `150 * ln(0.7)^2`, about 19, the same as a move of about 4.5 ems. So a
 * superscript `2` goes to the superscript `2` across a formula rather than
 * stepping next door into a full-size one: a part keeps its role (exponent,
 * coefficient, limit) unless the move to keep it is much longer.
 */
const SIZE_WEIGHT = 150;

function heightOf(part: PlacedPart): number {
	return Math.max(part.box.maxY - part.box.minY, 1e-9);
}

/**
 * Greedy nearest-neighbour matching within one key.
 *
 * Cheapest-first rather than in order, because "the second `x` in the source"
 * and "the second `x` in the target" are not the same `x` once a term has moved
 * across an equals sign. The cost is distance plus a size mismatch (see
 * {@link SIZE_WEIGHT}), so of two `2`s the superscript goes to the superscript.
 * Buckets hold a handful of parts, so the quadratic scan is free next to the
 * typesetting that produced them.
 *
 * @param em - Length of one em in the parts' units, to make distance and size comparable.
 */
function matchWithin(
	source: PlacedPart[],
	target: PlacedPart[],
	em: number,
): [PlacedPart, PlacedPart][] {
	const candidates: { from: number; to: number; cost: number }[] = [];
	for (let i = 0; i < source.length; i++) {
		const a = centerOf(source[i].box);
		for (let j = 0; j < target.length; j++) {
			const b = centerOf(target[j].box);
			const scale = Math.log(heightOf(source[i]) / heightOf(target[j]));
			candidates.push({
				from: i,
				to: j,
				cost:
					((a.x - b.x) ** 2 + (a.y - b.y) ** 2) / em ** 2 +
					SIZE_WEIGHT * scale ** 2,
			});
		}
	}
	candidates.sort((a, b) => a.cost - b.cost);

	const takenFrom = new Set<number>();
	const takenTo = new Set<number>();
	const pairs: [PlacedPart, PlacedPart][] = [];
	for (const candidate of candidates) {
		if (takenFrom.has(candidate.from) || takenTo.has(candidate.to)) continue;
		takenFrom.add(candidate.from);
		takenTo.add(candidate.to);
		pairs.push([source[candidate.from], target[candidate.to]]);
	}
	return pairs;
}

/**
 * A formula's em, estimated from its glyphs: the tallest glyph box is close
 * to one em in any formula with a capital, a digit or a tall letter.
 */
function emOf(...formulas: PlacedLatex[]): number {
	let em = 0;
	for (const formula of formulas) {
		for (const part of formula.parts) {
			if (part.kind === "glyph") em = Math.max(em, heightOf(part));
		}
	}
	return em || 1;
}

function bucket(
	parts: PlacedPart[],
	keyMap?: Record<string, string>,
): Map<string, PlacedPart[]> {
	const buckets = new Map<string, PlacedPart[]>();
	for (const part of parts) {
		const key = keyOf(part, keyMap);
		const existing = buckets.get(key);
		if (existing) existing.push(part);
		else buckets.set(key, [part]);
	}
	return buckets;
}

/** Splits both formulas into moved pairs and leftovers. */
function pairUp(
	from: PlacedLatex,
	to: PlacedLatex,
	keyMap?: Record<string, string>,
): Pairing {
	// Only the source is rewritten by the key map, so `{ "2": "\\pi" }` pulls a
	// source `2` into the target's `π` bucket rather than the two rewriting past
	// each other.
	const em = emOf(from, to);
	const sourceBuckets = bucket(from.parts, keyMap);
	const targetBuckets = bucket(to.parts);

	const pairs: [PlacedPart, PlacedPart][] = [];
	const matchedSource = new Set<PlacedPart>();
	const matchedTarget = new Set<PlacedPart>();

	for (const [key, source] of sourceBuckets) {
		const target = targetBuckets.get(key);
		if (!target) continue;
		for (const pair of matchWithin(source, target, em)) {
			pairs.push(pair);
			matchedSource.add(pair[0]);
			matchedTarget.add(pair[1]);
		}
	}

	return {
		pairs,
		sourceOnly: from.parts.filter((part) => !matchedSource.has(part)),
		targetOnly: to.parts.filter((part) => !matchedTarget.has(part)),
	};
}

/** True when two rings can be lerped vertex for vertex with no resampling. */
function congruent(a: Polyline[], b: Polyline[]): boolean {
	return (
		a.length === b.length &&
		a.every((line, index) => line.length === b[index].length)
	);
}

/**
 * The morph for one pair of parts.
 *
 * The fast path is the common one and it is exact: the same character at two
 * sizes flattens to the same vertices (`outline.ts` flattens relative to the
 * type size), so there is nothing to solve. Otherwise (a pair the key map
 * forced together, the same character in two faces, a leftover reshaped by
 * `mismatch: "morph"`) `morphRings` pairs outline with outline and counter
 * with counter, each keeping its winding so a counter stays a hole, and grows
 * or shrinks a contour with no partner.
 */
function pairMorph(from: PlacedPart, to: PlacedPart): RingsInterpolator {
	if (congruent(from.polylines, to.polylines)) {
		// `lerpPolyline` (`geometry/lerp.ts`) is the canonical
		// matched-vertex lerp; `congruent` above is exactly the precondition
		// it's strict about (equal length), already checked.
		const rings = from.polylines.map((line, index) =>
			lerpPolyline(line, to.polylines[index]),
		);
		return (t) => rings.map((ring) => ring(t));
	}
	return morphRings(from.polylines, to.polylines);
}

/** Centre of the box around some parts. */
function centerOfAll(parts: PlacedPart[]): Point {
	const box = unionBounds(...parts.map((part) => part.box));
	return box ? centerOf(box) : { x: Number.NaN, y: Number.NaN };
}

/** How far the leaving parts travel over the run: to the arriving parts' centre. */
function driftBetween(leaving: PlacedPart[], arriving: PlacedPart[]): Point {
	if (leaving.length === 0 || arriving.length === 0) return { x: 0, y: 0 };
	const from = centerOfAll(leaving);
	const to = centerOfAll(arriving);
	return { x: to.x - from.x, y: to.y - from.y };
}

/**
 * Builds the transform. Do this once, outside the frame loop — the returned
 * function is what runs per frame.
 *
 * At `t = 0` the result is exactly `from` and at `t = 1` exactly `to`, so this
 * composes with an ordinary `valueTo` on a track and needs no settling pass.
 * `<MathTransform>` wraps this for the common case; call it directly to draw
 * the parts yourself.
 *
 * @param from - Starting formula, from `createLatex`.
 * @param to - Ending formula, from `createLatex`.
 * @param options - Character `keyMap` and `mismatch` strategy.
 * @returns A function from progress (0..1) to the parts to draw.
 *
 * @category Morphing & matching
 */
export function morphLatex(
	from: PlacedLatex,
	to: PlacedLatex,
	options: LatexMorphOptions = {},
): LatexMorph {
	const { pairs, sourceOnly, targetOnly } = pairUp(from, to, options.keyMap);

	const moved = pairs.map(([source, target], index) => ({
		id: `moved:${index}:${source.char ?? source.kind}`,
		kind: source.kind,
		char: source.char,
		morph: pairMorph(source, target),
	}));

	// Leftovers, optionally paired off for a real morph. Whatever is left after
	// that still fades, so the two strategies compose rather than exclude.
	const morphed: {
		id: string;
		kind: PlacedPart["kind"];
		char?: string;
		morph: RingsInterpolator;
	}[] = [];
	let fadingOut = sourceOnly;
	let fadingIn = targetOnly;

	if (options.mismatch === "morph" && sourceOnly.length && targetOnly.length) {
		const paired = matchWithin(sourceOnly, targetOnly, emOf(from, to));
		const usedSource = new Set(paired.map(([source]) => source));
		const usedTarget = new Set(paired.map(([, target]) => target));
		for (const [source, target] of paired) {
			morphed.push({
				id: `morphed:${morphed.length}`,
				kind: source.kind,
				char: source.char,
				morph: pairMorph(source, target),
			});
		}
		fadingOut = sourceOnly.filter((part) => !usedSource.has(part));
		fadingIn = targetOnly.filter((part) => !usedTarget.has(part));
	}

	// Manim's `FadeOut(fade_source, target_position=fade_target)`: what leaves
	// drifts toward where the new parts arrive as it fades, so the two read as
	// one replacing the other rather than as two unrelated fades. What arrives
	// fades in where it lands.
	const drift = driftBetween(fadingOut, fadingIn);

	return (t) => {
		const clamped = Math.min(1, Math.max(0, t));
		const dx = drift.x * clamped;
		const dy = drift.y * clamped;
		const parts: MorphedPart[] = [];

		for (const entry of moved) {
			parts.push({
				id: entry.id,
				kind: entry.kind,
				char: entry.char,
				role: "moved",
				opacity: 1,
				polylines: entry.morph(clamped),
			});
		}

		for (const entry of morphed) {
			parts.push({
				id: entry.id,
				kind: entry.kind,
				char: entry.char,
				role: "morphed",
				opacity: 1,
				polylines: entry.morph(clamped),
			});
		}

		// The old formula mostly clears before the new one crowds it, but the two
		// keep an overlap across the middle so the transform never bottoms out at
		// a blank stage.
		const fade = crossFade(clamped);
		for (let i = 0; i < fadingOut.length; i++) {
			parts.push({
				id: `out:${i}`,
				kind: fadingOut[i].kind,
				char: fadingOut[i].char,
				role: "out",
				opacity: fade.out,
				polylines:
					dx === 0 && dy === 0
						? fadingOut[i].polylines
						: fadingOut[i].polylines.map((line) =>
								line.map((p) => ({ x: p.x + dx, y: p.y + dy })),
							),
			});
		}

		for (let i = 0; i < fadingIn.length; i++) {
			parts.push({
				id: `in:${i}`,
				kind: fadingIn[i].kind,
				char: fadingIn[i].char,
				role: "in",
				opacity: fade.in,
				polylines: fadingIn[i].polylines,
			});
		}

		return parts;
	};
}
