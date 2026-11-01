/**
 * Canvas drawing primitives: the only code that knows how a stroke is put on
 * screen. Draws in the context's current user space, under the view matrix the
 * renderer installed, so `StrokeStyle` lengths are scene units.
 */

import type { CurvePath, Polyline } from "../geometry/index.js";
import { isFinitePoint } from "../geometry/num.js";
import type { Paint, StrokeStyle } from "../spec/types.js";
import { paintsFill } from "../spec/types.js";

/**
 * A tracing target: a live context or a `Path2D`. Both take the same path
 * commands, which is what lets one `trace*` function serve a one-off draw and
 * a cached `Path2D`.
 */
export type PathTarget = CanvasPath;

/**
 * Live `CanvasGradient`s, keyed on the resolved paint that described them.
 *
 * A gradient object can only be made by a context, so it cannot live in a spec;
 * but rebuilding one per node per camera per frame is real work for a scene
 * whose gradients mostly sit still. Specs come out of memos, so an unchanged
 * paint is the *same object* frame after frame and this hits — the same
 * identity check the reveal cache in `canvas-renderer.ts` makes, for the same
 * reason. A paint that changes every frame (a `sheen` driven by a track) misses
 * every frame, which is correct: it is a different gradient every time.
 *
 * Weak, so a node leaving the scene takes its gradients with it, and owned by
 * the renderer rather than by this module, so two canvases never trade gradient
 * objects built against each other's contexts.
 *
 * @category Renderer & paint
 */
export type PaintCache = WeakMap<object, CanvasGradient>;

/**
 * Creates an empty gradient cache. Keep one per canvas and pass it to every paint call.
 *
 * @category Renderer & paint
 */
export function createPaintCache(): PaintCache {
	return new WeakMap();
}

/**
 * A `Paint` as something assignable to `fillStyle`/`strokeStyle`.
 *
 * Degenerate geometry answers with a colour rather than throwing: the canvas
 * gradient constructors are among the few DOM calls that raise on a `NaN`
 * argument, and one shape whose bounds briefly went non-finite should not take
 * the whole paint pass down with it.
 *
 * @param ctx - The context the gradient is created against.
 * @param paint - A CSS colour string or a gradient description.
 * @param cache - Optional gradient cache, keyed on the `paint` object's identity.
 * @returns Something assignable to `fillStyle` or `strokeStyle`.
 *
 * @category Renderer & paint
 */
export function canvasPaint(
	ctx: CanvasRenderingContext2D,
	paint: Paint,
	cache?: PaintCache,
): string | CanvasGradient {
	if (typeof paint === "string") return paint;

	const cached = cache?.get(paint);
	if (cached) return cached;

	const fallback = paint.stops[0]?.color ?? "none";
	if (!isFinitePoint(paint.from) || !isFinitePoint(paint.to)) return fallback;

	let gradient: CanvasGradient;
	if (paint.kind === "linear") {
		gradient = ctx.createLinearGradient(
			paint.from.x,
			paint.from.y,
			paint.to.x,
			paint.to.y,
		);
	} else {
		const r0 = Math.max(0, paint.fromRadius);
		const r1 = Math.max(0, paint.toRadius);
		if (!Number.isFinite(r0) || !Number.isFinite(r1)) return fallback;
		gradient = ctx.createRadialGradient(
			paint.from.x,
			paint.from.y,
			r0,
			paint.to.x,
			paint.to.y,
			r1,
		);
	}

	// Canvas rejects an offset outside 0..1, and reads stops in the order they
	// were added; clamping and forcing the sequence upwards here is what lets
	// `sheen` place a band that runs off the end of its own axis without the
	// caller doing the arithmetic.
	let previous = 0;
	for (const stop of paint.stops) {
		previous = Math.min(1, Math.max(previous, stop.offset || 0));
		gradient.addColorStop(previous, stop.color);
	}

	cache?.set(paint, gradient);
	return gradient;
}

/**
 * Adds a polyline to the current canvas path (it does not stroke or fill).
 * Fewer than two points adds nothing; `closed` joins the last point to the first.
 *
 * @category Renderer & paint
 */
export function tracePolyline(
	ctx: PathTarget,
	points: Polyline,
	closed = false,
): void {
	if (points.length < 2) return;
	ctx.moveTo(points[0].x, points[0].y);
	for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
	if (closed) ctx.closePath();
}

/**
 * Adds a `CurvePath` to the current path natively — one `bezierCurveTo` per
 * segment, straight or curved alike (see `CurveSegment`'s doc comment for why
 * a straight run's control points make that exact, not an approximation).
 * This is the accelerated counterpart to `tracePolyline`: no flattening, the
 * curve reaches the canvas as a curve.
 *
 * @category Renderer & paint
 */
export function tracePath(ctx: PathTarget, path: CurvePath): void {
	if (path.segments.length === 0) return;
	ctx.moveTo(path.start.x, path.start.y);
	for (const segment of path.segments) {
		ctx.bezierCurveTo(
			segment.c1.x,
			segment.c1.y,
			segment.c2.x,
			segment.c2.y,
			segment.to.x,
			segment.to.y,
		);
	}
	if (path.closed) ctx.closePath();
}

// `fontString` lives beside the metrics oracle so measuring and painting
// share one font shorthand.
export { fontString } from "../spec/metrics.js";

/**
 * Applies dash, cap, join, alpha, and width from `style` to `ctx`. Assumes the caller saved state.
 *
 * @category Renderer & paint
 */
export function applyStrokeStyle(
	ctx: CanvasRenderingContext2D,
	style: StrokeStyle,
	cache?: PaintCache,
): void {
	ctx.strokeStyle = canvasPaint(ctx, style.stroke, cache);
	// Scene units, so the floor is only there to keep a non-positive width from
	// being silently ignored by the canvas (callers skip zero-width strokes).
	ctx.lineWidth = Math.max(1e-6, style.strokeWidth);
	ctx.lineCap = style.lineCap;
	ctx.lineJoin = style.lineJoin;
	ctx.globalAlpha = style.opacity;
	if (style.dash && style.dash.length > 0) {
		ctx.setLineDash(style.dash);
		ctx.lineDashOffset = style.dashOffset;
	} else {
		ctx.setLineDash([]);
	}
}

export { paintsFill } from "../spec/types.js";

/**
 * Fills every ring as a single path (non-zero winding), scaling the style's
 * opacity by `fillOpacity`. Does nothing without a fill or at zero opacity.
 *
 * @param fillPath - A prebuilt `Path2D` of the same rings (see
 * `ringsPath2D`); filled instead of re-tracing them when given.
 *
 * @category Renderer & paint
 */
export function fillRings(
	ctx: CanvasRenderingContext2D,
	polylines: Polyline[],
	style: StrokeStyle,
	fillOpacity: number,
	cache?: PaintCache,
	fillPath?: Path2D | null,
): void {
	if (!paintsFill(style.fill) || fillOpacity <= 0) return;
	ctx.save();
	ctx.fillStyle = canvasPaint(ctx, style.fill, cache);
	ctx.globalAlpha = style.opacity * fillOpacity;
	if (fillPath) {
		ctx.fill(fillPath);
	} else {
		ctx.beginPath();
		for (const line of polylines) tracePolyline(ctx, line, true);
		ctx.fill();
	}
	ctx.restore();
}

/**
 * `fillRings`' curve-native counterpart — every `CurvePath` traced with
 * `tracePath` instead of flattened first. A fill always closes its ring
 * regardless of the source's own `closed` flag (the same thing `fillRings`
 * does by always passing `closed = true` to `tracePolyline`), so this closes
 * the canvas path itself rather than trusting `tracePath`'s `path.closed`.
 *
 * @param fillPath - A prebuilt `Path2D` of the same paths (see `curvesPath2D`).
 *
 * @category Renderer & paint
 */
export function fillCurvePaths(
	ctx: CanvasRenderingContext2D,
	curvePaths: CurvePath[],
	style: StrokeStyle,
	fillOpacity: number,
	cache?: PaintCache,
	fillPath?: Path2D | null,
): void {
	if (!paintsFill(style.fill) || fillOpacity <= 0) return;
	ctx.save();
	ctx.fillStyle = canvasPaint(ctx, style.fill, cache);
	ctx.globalAlpha = style.opacity * fillOpacity;
	if (fillPath) {
		ctx.fill(fillPath);
	} else {
		ctx.beginPath();
		for (const path of curvePaths) {
			tracePath(ctx, path);
			ctx.closePath();
		}
		ctx.fill();
	}
	ctx.restore();
}

// ---------------------------------------------------------------------------
// Path2D cache.
// ---------------------------------------------------------------------------

/**
 * What `Path2D`s are built for one geometry array. Keyed in the cache by the
 * identity of the `polylines`/`curvePaths` array a spec carries, and — like the
 * reveal cache's tables — valid exactly as long as that array is.
 *
 * Because specs are in scene units and the camera is applied by
 * `setTransform`, that identity does not change when the camera moves or the
 * canvas resizes: a `Path2D` built once serves every frame, and every camera,
 * until the shape's own geometry changes.
 */
interface PathEntry {
	/** The fully-revealed stroke path (rings as given). */
	stroke?: Path2D;
	/** Fill paths by `fillFrom` (rings closed). */
	fill: Map<number, Path2D>;
}

const pathCache = new WeakMap<object, PathEntry>();

function entryFor(geometry: object): PathEntry {
	let entry = pathCache.get(geometry);
	if (!entry) {
		entry = { fill: new Map() };
		pathCache.set(geometry, entry);
	}
	return entry;
}

/** Whether this environment can build cached `Path2D`s (happy-dom and Node cannot). */
export function hasPath2D(): boolean {
	return typeof Path2D !== "undefined";
}

/**
 * A cached `Path2D` for a polyline geometry array, or `null` where `Path2D`
 * does not exist (callers then trace into the context as before).
 *
 * @param polylines - The spec's `polylines` array; its identity is the cache key.
 * @param fillFrom - `undefined` for the stroke path (rings traced open, as the
 * stroke does); a number for the fill path (rings from that index, closed).
 */
export function ringsPath2D(
	polylines: Polyline[],
	fillFrom?: number,
): Path2D | null {
	if (!hasPath2D()) return null;
	const entry = entryFor(polylines);
	if (fillFrom === undefined) {
		if (!entry.stroke) {
			const path = new Path2D();
			for (const line of polylines) tracePolyline(path, line);
			entry.stroke = path;
		}
		return entry.stroke;
	}
	let path = entry.fill.get(fillFrom);
	if (!path) {
		path = new Path2D();
		for (let i = fillFrom; i < polylines.length; i++) {
			tracePolyline(path, polylines[i], true);
		}
		entry.fill.set(fillFrom, path);
	}
	return path;
}

/** `ringsPath2D`'s curve-native counterpart, keyed on the `curvePaths` array. */
export function curvesPath2D(
	curvePaths: CurvePath[],
	fillFrom?: number,
): Path2D | null {
	if (!hasPath2D()) return null;
	const entry = entryFor(curvePaths);
	if (fillFrom === undefined) {
		if (!entry.stroke) {
			const path = new Path2D();
			for (const piece of curvePaths) tracePath(path, piece);
			entry.stroke = path;
		}
		return entry.stroke;
	}
	let path = entry.fill.get(fillFrom);
	if (!path) {
		path = new Path2D();
		for (let i = fillFrom; i < curvePaths.length; i++) {
			tracePath(path, curvePaths[i]);
			path.closePath();
		}
		entry.fill.set(fillFrom, path);
	}
	return path;
}
