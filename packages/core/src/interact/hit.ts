/**
 * Picking: which node is under a point. Pure geometry over scene-unit specs, so
 * it needs no transform chain and cannot disagree with the painter. It walks the
 * renderer's z-sorted snapshot backwards; first hit wins.
 *
 * Fills test by non-zero winding (so `Annulus`'s hole is a hole). Invisible
 * geometry never catches the pointer: fill and stroke alphas gate separately, a
 * partly revealed stroke tests only its drawn part, and a node's `clip` gates
 * everything.
 */

import type { Bounds, Point, Polyline } from "../geometry";
import { measure, revealedPolylines } from "../geometry";
import { boundsContain, boundsOf, unionBounds } from "../geometry/bounds";
import { distanceToSegment } from "../geometry/path/cubic";
import { clipBox } from "../spec/clip";
import { labelBox } from "../spec/metrics";
import type {
	ClipRegion,
	DrawSpec,
	ImageSpec,
	ShapeSpec,
	TextSpec,
} from "../spec/types";
import { paintsFill } from "../spec/types";
import { pickMark, pickPixel } from "./pick-items";
import type { HitCandidate, HitOptions } from "./types";

/**
 * Axis-aligned boxes memoised per node, so the cheap rejection that precedes
 * every real test is not itself a walk over the geometry.
 *
 * Keyed on the *identity* of what produced the box — `spec.polylines` for a
 * shape, the spec object for a text run, the hit-area array for an override.
 * That works for the same reason `RevealCache` works in `canvas-renderer.ts`:
 * specs come out of memos, so an unchanged shape hands back the same array
 * reference frame after frame, and a shape that merely changed colour keeps its
 * polylines and therefore its box.
 *
 * The driver owns one of these rather than the module owning a global, so two
 * stages on a page never share a cache keyed by a node id counter they both
 * draw from.
 *
 * @category Interaction plumbing
 */
export interface HitCache {
	/**
	 * Cache key (`id * 2 + (yUp ? 1 : 0)`, see `boxKey`) to the last-measured
	 * box, valid while `source` is the same array or spec. Keyed by the view's
	 * orientation too, so a stage with cameras of both `yUp` values keeps one
	 * entry per orientation instead of overwriting one with the other on every
	 * alternating hit test.
	 */
	boxes: Map<number, { source: object; box: Bounds }>;
	/**
	 * The snapshot the cache was last pruned against. When {@link hitTest} is
	 * handed a different array, entries whose node is no longer in it are
	 * dropped, so a long-lived stage whose nodes come and go does not retain a
	 * box per node it ever drew.
	 */
	snapshot: object | null;
	/**
	 * The interactive specs of the last (`snapshot`, `candidates`) pair, in
	 * z order, so a pointer move walks the handful of candidates rather than
	 * the whole scene. Both arrive as fresh objects whenever they change.
	 */
	walk?: {
		specs: readonly DrawSpec[];
		candidates: ReadonlyMap<number, HitCandidate>;
		list: { spec: DrawSpec; candidate: HitCandidate }[];
	};
}

/** The {@link HitCache.boxes} key for a node under one orientation. */
function boxKey(id: number, yUp: boolean): number {
	return id * 2 + (yUp ? 1 : 0);
}

/**
 * Creates an empty bounding-box cache. Keep one per stage; the pointer driver does.
 *
 * @category Interaction plumbing
 */
export function createHitCache(): HitCache {
	return { boxes: new Map(), snapshot: null };
}

/**
 * Winding number of a closed polygon about `at`.
 *
 * The polyline is treated as closed whether or not its last point repeats its
 * first, so a ring that was closed geometrically (`closePolyline`) and one that
 * was not give the same answer. Sign follows the winding direction; the y-down
 * canvas convention flips it relative to a maths textbook, which is irrelevant
 * here because every caller only asks whether it is zero.
 *
 * @category Bounds & hit math
 */
export function windingNumber(polygon: Polyline, at: Point): number {
	const n = polygon.length;
	if (n < 3) return 0;

	let winding = 0;
	for (let i = 0; i < n; i++) {
		const a = polygon[i];
		const b = polygon[(i + 1) % n];
		// Positive when `at` is left of the directed edge a→b.
		const side = (b.x - a.x) * (at.y - a.y) - (at.x - a.x) * (b.y - a.y);
		if (a.y <= at.y) {
			if (b.y > at.y && side > 0) winding++;
		} else if (b.y <= at.y && side < 0) {
			winding--;
		}
	}
	return winding;
}

/**
 * Whether `at` is inside a set of rings under the non-zero rule — the canvas
 * `fill()` default, and so the only definition of "inside" that agrees with
 * what is on screen.
 *
 * @category Bounds & hit math
 */
export function pointInRings(rings: Polyline[], at: Point): boolean {
	let winding = 0;
	for (const ring of rings) winding += windingNumber(ring, at);
	return winding !== 0;
}

/**
 * Whether `at` is inside every region of a node's clip list (so, painted
 * through it); true when there is no clip. Strict: no slop widens a clip,
 * since a tap just outside the window lands on whatever is behind it.
 *
 * @category Bounds & hit math
 */
export function pointInClip(
	clip: readonly ClipRegion[] | undefined,
	at: Point,
): boolean {
	if (!clip) return true;
	for (const region of clip) if (!pointInRings(region.rings, at)) return false;
	return true;
}

/**
 * Shortest distance from `at` to any segment of a polyline.
 *
 * @category Bounds & hit math
 */
export function distanceToPolyline(line: Polyline, at: Point): number {
	if (line.length === 0) return Number.POSITIVE_INFINITY;
	if (line.length === 1) return Math.hypot(at.x - line[0].x, at.y - line[0].y);

	let best = Number.POSITIVE_INFINITY;
	for (let i = 0; i < line.length - 1; i++) {
		const distance = distanceToSegment(at, line[i], line[i + 1]);
		if (distance < best) best = distance;
	}
	return best;
}

/**
 * Shortest distance from `at` to any of several polylines; infinity for none. Same units as the inputs.
 *
 * @category Bounds & hit math
 */
export function distanceToPolylines(lines: Polyline[], at: Point): number {
	let best = Number.POSITIVE_INFINITY;
	for (const line of lines) {
		const distance = distanceToPolyline(line, at);
		if (distance < best) best = distance;
	}
	return best;
}

// `boundsContain` lives in `geometry/bounds.ts` (so `geometry/` can use it
// too); re-exported here, its public home.
export { boundsContain };

/**
 * A text run's box in scene units, before the run's rotation, hanging off its
 * anchor: `labelBox`, oriented for the view (the same box a `<Label>`'s `ref`
 * handle reports).
 *
 * @param spec - The text spec (scene units).
 * @param yUp - Whether scene `y` increases upward on screen in the view. Defaults to true.
 *
 * @category Interaction plumbing
 */
export function textBoxAt(spec: TextSpec, yUp = true): Bounds {
	const box = labelBox(spec.text, spec.style, yUp);
	return {
		minX: spec.at.x + box.minX,
		minY: spec.at.y + box.minY,
		maxX: spec.at.x + box.maxX,
		maxY: spec.at.y + box.maxY,
	};
}

/** The four corners of a box, in order. */
function cornersOf(box: Bounds): Polyline {
	return [
		{ x: box.minX, y: box.minY },
		{ x: box.maxX, y: box.minY },
		{ x: box.maxX, y: box.maxY },
		{ x: box.minX, y: box.maxY },
	];
}

function rotateAbout(p: Point, origin: Point, radians: number): Point {
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const dx = p.x - origin.x;
	const dy = p.y - origin.y;
	return {
		x: origin.x + dx * cos - dy * sin,
		y: origin.y + dx * sin + dy * cos,
	};
}

/**
 * The node's axis-aligned box in scene units, before any stroke padding, or
 * null when it has no geometry to bound.
 *
 * @param spec - The node's draw spec.
 * @param yUp - Whether scene `y` increases upward on screen in the view; only
 * text depends on it. Defaults to true.
 *
 * @category Interaction plumbing
 */
export function boundsOfSpec(spec: DrawSpec, yUp = true): Bounds | null {
	if (spec.kind === "text") {
		if (!spec.text) return null;
		const box = textBoxAt(spec, yUp);
		if (!spec.rotation) return box;
		// The box hangs off the anchor in on-screen orientation (`textBoxAt`
		// already flipped it for a y-down view); `spec.rotation` then turns it
		// about the anchor in scene axes, the same sense in both orientations.
		return boundsOf([
			cornersOf(box).map((p) => rotateAbout(p, spec.at, spec.rotation)),
		]);
	}
	if (spec.kind === "marks") return spec.bounds;
	if (spec.kind === "image") return imageBounds(spec);
	if (!spec.polylines.some((line) => line.length > 0)) return null;
	return boundsOf(spec.polylines);
}

/** The box around an image's four mapped corners. */
function imageBounds(spec: ImageSpec): Bounds {
	const { origin: o, xAxis: a, yAxis: b } = spec;
	return boundsOf([
		[
			o,
			{ x: o.x + a.x, y: o.y + a.y },
			{ x: o.x + a.x + b.x, y: o.y + a.y + b.y },
			{ x: o.x + b.x, y: o.y + b.y },
		],
	]);
}

/**
 * Which item of a batched node is under `at`: a marks node's item index, an
 * image node's pixel (`row * width + column`), or null — always null for a
 * shape or text node, which is one item.
 *
 * The pointer driver hands this to handlers as `event.item`, so one node can
 * stand for many hover targets.
 *
 * @param spec - The node's spec.
 * @param at - The point, in scene units.
 * @param slop - Extra reach in scene units. Defaults to 0.
 *
 * @category Interaction plumbing
 */
export function itemAt(spec: DrawSpec, at: Point, slop = 0): number | null {
	if (spec.kind === "marks") return pickMark(spec, at, slop);
	if (spec.kind === "image") return pickPixel(spec, at);
	return null;
}

/**
 * Indexes a snapshot by node id, for repeated {@link boundsOfNodes} queries
 * against one snapshot. Built in one pass; if an id appears twice the later
 * (topmost) spec wins.
 */
export function indexSpecs(specs: readonly DrawSpec[]): Map<number, DrawSpec> {
	const index = new Map<number, DrawSpec>();
	for (const spec of specs) index.set(spec.id, spec);
	return index;
}

/**
 * The union of several nodes' boxes (clipped by each node's clip), or null when
 * none drew anything. The focus ring and accessibility mirror both use it.
 *
 * @param ids - Node ids to include.
 * @param specs - The renderer's snapshot, or an `indexSpecs` index of it (build
 *   the index once when asking repeatedly).
 * @param yUp - Whether scene `y` increases upward in the view; only text depends
 *   on it. Defaults to true.
 *
 * @category Interaction plumbing
 */
export function boundsOfNodes(
	ids: readonly number[],
	specs: readonly DrawSpec[] | ReadonlyMap<number, DrawSpec>,
	yUp = true,
): Bounds | null {
	let box: Bounds | null = null;
	let found: Iterable<DrawSpec>;
	if (Array.isArray(specs)) {
		const wanted = new Set(ids);
		found = specs.filter((spec) => wanted.has(spec.id));
	} else {
		const index = specs as ReadonlyMap<number, DrawSpec>;
		const hits: DrawSpec[] = [];
		for (const id of ids) {
			const spec = index.get(id);
			if (spec) hits.push(spec);
		}
		found = hits;
	}
	for (const spec of found) {
		const bounds = boundsOfSpec(spec, yUp);
		// What is on screen: a clipped node's ring hugs the part left showing.
		const own = bounds && clipBox(bounds, spec.clip);
		if (!own) continue;
		box = box ? unionBounds(box, own) : own;
	}
	return box;
}

/** The rings that take part in the fill — `drawShape`'s `fillFrom` slice. */
function fillRingsOf(spec: ShapeSpec): Polyline[] {
	return spec.fillFrom > 0
		? spec.polylines.slice(spec.fillFrom)
		: spec.polylines;
}

/**
 * The part of a shape's outline that has actually been drawn.
 *
 * The budget itself — one arc-length allowance across the whole node, spent
 * polyline by polyline in order — is `geometry/path/arclength.ts`'s `revealedPolylines`,
 * shared with `canvas-renderer.ts`'s `drawShape` so the two can never compute
 * a different answer for "how much of this shape is on screen". Only the
 * measuring is duplicated here rather than shared: `interact/` may not import
 * `render/`, so the renderer's per-node `RevealCache` is out of reach, and the
 * cost only lands on a pointer event over a partly revealed shape — a case
 * rare enough that measuring on demand beats keeping a second table cache
 * alive.
 */
function drawnPolylines(spec: ShapeSpec): Polyline[] {
	if (spec.progress >= 1) return spec.polylines;
	if (spec.progress <= 0) return [];

	const tables = spec.polylines.map(measure);
	const total = tables.reduce((sum, table) => sum + table.total, 0);
	return revealedPolylines(tables, total, spec.progress);
}

function cachedBox(
	id: number,
	source: object,
	yUp: boolean,
	compute: () => Bounds | null,
	cache: HitCache | undefined,
): Bounds | null {
	if (!cache) return compute();
	const key = boxKey(id, yUp);
	const existing = cache.boxes.get(key);
	if (existing && existing.source === source) return existing.box;
	const box = compute();
	if (box) cache.boxes.set(key, { source, box });
	else cache.boxes.delete(key);
	return box;
}

/**
 * Tests a hit area that has replaced the node's geometry.
 *
 * The registry hands these over as polygons in scene units — a `Bounds`
 * arrives as its four transformed corners, so a hit area inside a rotated
 * `<Group>` rotates with it instead of degrading to a fattened AABB. An open
 * polyline still works as a fat line, which is what makes one a usable target
 * for a hairline.
 */
function hitArea(area: Polyline, at: Point, slop: number): boolean {
	if (pointInRings([area], at)) return true;
	return distanceToPolyline(area, at) <= slop;
}

function hitShape(
	spec: ShapeSpec,
	candidate: HitCandidate,
	at: Point,
	slop: number,
): boolean {
	const { style } = spec;
	const all = candidate.pointerEvents === "all";

	// `"all"` is the enclosed region whether or not there is a fill: an
	// outline-only shape becomes a solid target. `"painted"` asks whether the
	// fill is really on screen — an invisible one must not catch the pointer.
	if (spec.closed) {
		const painted =
			paintsFill(style.fill) &&
			style.opacity * style.fillOpacity * spec.progress > 0;
		if ((all || painted) && pointInRings(fillRingsOf(spec), at)) return true;
	}

	const strokeVisible =
		style.stroke !== "none" && style.strokeWidth > 0 && style.opacity > 0;
	if (!all && !strokeVisible) return false;

	// Under `"all"` the outline is a target at its full extent regardless of
	// how much of it has been revealed; under `"painted"` only the drawn part is.
	const lines = all ? spec.polylines : drawnPolylines(spec);
	const reach = Math.max(0, style.strokeWidth) / 2 + slop;
	return distanceToPolylines(lines, at) <= reach;
}

/**
 * Tests one spec. Exported so a caller can ask about a node it already has in
 * hand — a drop target check, say — without walking the snapshot.
 *
 * @param spec - The node's draw spec, in scene units.
 * @param candidate - Its hit mode and optional hit area (scene units).
 * @param at - The point to test, in scene units.
 * @param slop - Extra reach in scene units. Defaults to 0.
 * @param cache - Optional box cache.
 * @param yUp - Whether scene `y` increases upward on screen in the view `at`
 * came through; only text depends on it. Defaults to true.
 *
 * @category Interaction plumbing
 */
export function hitSpec(
	spec: DrawSpec,
	candidate: HitCandidate,
	at: Point,
	slop = 0,
	cache?: HitCache,
	yUp = true,
): boolean {
	if (candidate.pointerEvents === "none") return false;
	if (!pointInClip(spec.clip, at)) return false;

	if (candidate.hitArea) {
		// The registry converts every declared area into scene units, and a
		// `Bounds` into its four transformed corners, so the polygon branch is
		// what actually runs; the box branch survives for a caller assembling
		// candidates by hand.
		const area = candidate.hitArea;
		if (!Array.isArray(area)) return boundsContain(area, at, slop);
		if (area.length < 2) return false;
		const box = cachedBox(spec.id, area, yUp, () => boundsOf([area]), cache);
		if (!box || !boundsContain(box, at, slop)) return false;
		return hitArea(area, at, slop);
	}

	const source =
		spec.kind === "shape"
			? spec.polylines
			: spec.kind === "marks"
				? spec.centers
				: spec;
	const box = cachedBox(
		spec.id,
		source,
		yUp,
		() => boundsOfSpec(spec, yUp),
		cache,
	);
	if (!box) return false;

	const pad =
		slop +
		(spec.kind === "shape" || spec.kind === "marks"
			? Math.max(0, spec.style.strokeWidth) / 2
			: 0);
	if (!boundsContain(box, at, pad)) return false;

	if (spec.kind === "image") {
		return spec.opacity * spec.progress > 0 && pickPixel(spec, at) !== null;
	}

	// `"bounds"` asks for the box and nothing finer, so the pre-pass above *is*
	// the whole test. The one thing a box cannot say is whether the node is
	// actually on screen, and an invisible node must not catch the pointer under
	// any `pointerEvents` value — so that check, and only that check, remains.
	if (candidate.pointerEvents === "bounds") return spec.style.opacity > 0;

	if (spec.kind === "marks") {
		if (!(spec.style.opacity * spec.progress > 0)) return false;
		return pickMark(spec, at, slop) !== null;
	}

	if (spec.kind === "text") {
		// Canvas2D cannot report a glyph outline, so there is nothing finer than
		// the box to test — `"painted"` degrades to `"bounds"` for text, which is
		// also the answer a tap target wants.
		if (spec.style.opacity <= 0) return false;
		return hitTextBox(spec, at, slop, yUp);
	}

	return hitShape(spec, candidate, at, slop);
}

/**
 * A text run's box, tested in the run's own rotated frame and trimmed to the
 * `progress` wipe — the same left-to-right clip `drawText` paints through.
 */
function hitTextBox(
	spec: TextSpec,
	at: Point,
	slop: number,
	yUp: boolean,
): boolean {
	const local = spec.rotation ? rotateAbout(at, spec.at, -spec.rotation) : at;
	const box = textBoxAt(spec, yUp);
	const revealed =
		spec.progress >= 1
			? box
			: { ...box, maxX: box.minX + (box.maxX - box.minX) * spec.progress };
	return boundsContain(revealed, local, slop);
}

/** Drops cached boxes of nodes absent from `specs`, once per distinct snapshot. */
function pruneCache(cache: HitCache, specs: readonly DrawSpec[]): void {
	if (cache.snapshot === specs) return;
	cache.snapshot = specs;
	if (cache.boxes.size === 0) return;
	const live = new Set<number>();
	for (const spec of specs) live.add(spec.id);
	for (const key of cache.boxes.keys()) {
		if (!live.has(Math.floor(key / 2))) cache.boxes.delete(key);
	}
}

/**
 * The topmost node under `at`, or null.
 *
 * `specs` must be the renderer's z-sorted snapshot; only ids present in
 * `candidates` are considered, which is what keeps this a walk over the handful
 * of interactive nodes rather than over the scene.
 *
 * @param specs - The z-sorted snapshot; later entries are on top.
 * @param candidates - Interactive nodes by id, from the registry.
 * @param at - The point to test, in scene units.
 * @param options - `slop` (scene units), `exclude` (a node id), `cache` and `yUp`.
 * @returns The topmost hit node's id, or `null`.
 *
 * @category Interaction plumbing
 */
export function hitTest(
	specs: readonly DrawSpec[],
	candidates: ReadonlyMap<number, HitCandidate>,
	at: Point,
	options: HitOptions = {},
): number | null {
	if (candidates.size === 0) return null;
	if (options.cache) pruneCache(options.cache, specs);
	const slop = options.slop ?? 0;
	const exclude = options.exclude ?? null;
	const yUp = options.yUp ?? true;

	const list = interactiveSpecs(specs, candidates, options.cache);
	for (let i = list.length - 1; i >= 0; i--) {
		const { spec, candidate } = list[i];
		if (spec.id === exclude) continue;
		if (options.accept && !options.accept(spec.id)) continue;
		if (hitSpec(spec, candidate, at, slop, options.cache, yUp)) return spec.id;
	}
	return null;
}

/** `specs` that have a candidate, in z order; cached per input pair. */
function interactiveSpecs(
	specs: readonly DrawSpec[],
	candidates: ReadonlyMap<number, HitCandidate>,
	cache: HitCache | undefined,
): { spec: DrawSpec; candidate: HitCandidate }[] {
	const walk = cache?.walk;
	if (walk && walk.specs === specs && walk.candidates === candidates)
		return walk.list;
	const list: { spec: DrawSpec; candidate: HitCandidate }[] = [];
	for (const spec of specs) {
		const candidate = candidates.get(spec.id);
		if (candidate) list.push({ spec, candidate });
	}
	if (cache) cache.walk = { specs, candidates, list };
	return list;
}
