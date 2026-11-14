/**
 * Painting the batched spec kinds — {@link MarksSpec} and {@link ImageSpec} —
 * and the culling test every kind goes through.
 *
 * Culling works in scene units: the renderer maps its viewport back through
 * the inverse view into a scene-space box once per pass, and a spec whose box
 * misses it is skipped before any canvas call. Boxes are cached on the identity
 * of the geometry they were measured from (the same contract as the `Path2D`
 * cache in `paint.ts`), so a still shape is measured once and a camera move
 * costs one comparison per node.
 */

import { tryParseColor } from "../color/parse.js";
import { arcCurvePath } from "../geometry/arc.js";
import { boundsOf } from "../geometry/bounds.js";
import type { Bounds, CurvePath, Polyline } from "../geometry/index.js";
import { revealedPolylines } from "../geometry/path/arclength.js";
import {
	curveRevealOf,
	polylineRevealOf,
	revealedCurves,
	revealMeasures,
} from "../geometry/path/outline-reveal.js";
import type { Matrix } from "../geometry/transform.js";
import { applyToPoint, invert } from "../geometry/transform.js";
import type {
	DrawSpec,
	ImagePixels,
	ImageSpec,
	MarkOutline,
	MarksSpec,
	ShapeSpec,
} from "../spec/types.js";
import type { PaintCache } from "./paint.js";
import { applyStrokeStyle } from "./paint.js";

/** A rectangle in device pixels. */
export interface DeviceRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * The scene-unit box `view` shows of `viewport`, or null when the view cannot
 * be inverted (a zero-unit stage) — in which case nothing is culled.
 */
export function visibleBox(view: Matrix, viewport: DeviceRect): Bounds | null {
	const inverse = invert(view);
	const corners = [
		applyToPoint(inverse, { x: viewport.x, y: viewport.y }),
		applyToPoint(inverse, { x: viewport.x + viewport.width, y: viewport.y }),
		applyToPoint(inverse, {
			x: viewport.x + viewport.width,
			y: viewport.y + viewport.height,
		}),
		applyToPoint(inverse, { x: viewport.x, y: viewport.y + viewport.height }),
	];
	const box = boundsOf([corners]);
	return Number.isFinite(box.minX + box.maxX + box.minY + box.maxY)
		? box
		: null;
}

const polylineBoxes = new WeakMap<Polyline[], Bounds>();

function polylinesBox(polylines: Polyline[]): Bounds {
	let box = polylineBoxes.get(polylines);
	if (!box) {
		box = boundsOf(polylines);
		polylineBoxes.set(polylines, box);
	}
	return box;
}

const curveBoxes = new WeakMap<CurvePath[], Bounds>();

/**
 * The box of a local outline, without flattening a curve one: the control
 * points of a cubic enclose it, so their box encloses the curve.
 */
function localBox(local: NonNullable<ShapeSpec["local"]>): Bounds {
	const curves = local.curvePaths;
	if (!curves) return polylinesBox(local.polylines);
	let box = curveBoxes.get(curves);
	if (!box) {
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		const take = (p: { x: number; y: number }) => {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		};
		for (const path of curves) {
			take(path.start);
			for (const segment of path.segments) {
				take(segment.c1);
				take(segment.c2);
				take(segment.to);
			}
		}
		box = { minX, minY, maxX, maxY };
		curveBoxes.set(curves, box);
	}
	return box;
}

/** The axis-aligned box around `box`'s four corners under `m`. */
function transformedBox(box: Bounds, m: Matrix): Bounds {
	const xs = [box.minX, box.maxX];
	const ys = [box.minY, box.maxY];
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const x of xs) {
		for (const y of ys) {
			const px = m.a * x + m.c * y + m.e;
			const py = m.b * x + m.d * y + m.f;
			if (px < minX) minX = px;
			if (px > maxX) maxX = px;
			if (py < minY) minY = py;
			if (py > maxY) maxY = py;
		}
	}
	return { minX, minY, maxX, maxY };
}

function overlaps(box: Bounds, visible: Bounds, pad: number): boolean {
	return (
		box.maxX + pad >= visible.minX &&
		box.minX - pad <= visible.maxX &&
		box.maxY + pad >= visible.minY &&
		box.minY - pad <= visible.maxY
	);
}

/**
 * Whether any of `spec` can land inside `visible` (scene units). Conservative:
 * a stroke is padded generously for miter joins, and text by a box guessed
 * from its length rather than measured, so this only ever skips what is
 * certainly off screen.
 */
export function mayBeVisible(spec: DrawSpec, visible: Bounds): boolean {
	switch (spec.kind) {
		case "shape": {
			const { style } = spec;
			const width = Math.max(0, style.strokeWidth);
			// A miter can reach `miterLimit / 2` widths past the path (10 by
			// default); round and bevel joins stay within half a width.
			const pad = width * (style.lineJoin === "miter" ? 5 : 0.5);
			// A local outline's box is measured once, in its own units, and only
			// its corners go through the matrix: a moving node costs four points.
			const box = spec.local
				? transformedBox(localBox(spec.local), spec.local.transform)
				: polylinesBox(spec.polylines);
			return overlaps(box, visible, pad);
		}
		case "text": {
			const { fontSize, halo } = spec.style;
			// Generous: the widest glyphs run about one em, plus room for the
			// anchor's alignment, rotation and a halo.
			const box = spec.box;
			const reach =
				(box
					? Math.max(
							Math.abs(box.minX),
							Math.abs(box.maxX),
							Math.abs(box.minY),
							Math.abs(box.maxY),
						) * Math.SQRT2
					: fontSize * (spec.text.length + 2)) + (halo ? halo.width : 0);
			return (
				spec.at.x + reach >= visible.minX &&
				spec.at.x - reach <= visible.maxX &&
				spec.at.y + reach >= visible.minY &&
				spec.at.y - reach <= visible.maxY
			);
		}
		case "marks": {
			if (!spec.bounds) return false;
			const width = Math.max(
				0,
				spec.style.strokeWidth,
				widestOf(spec.strokeWidths),
			);
			return overlaps(spec.bounds, visible, width);
		}
		case "image":
			return overlaps(imageBox(spec), visible, 0);
	}
}

/** The box around an image's four mapped corners. */
function imageBox(spec: ImageSpec): Bounds {
	const { origin: o, xAxis: a, yAxis: b } = spec;
	const xs = [o.x, o.x + a.x, o.x + b.x, o.x + a.x + b.x];
	const ys = [o.y, o.y + a.y, o.y + b.y, o.y + a.y + b.y];
	return {
		minX: Math.min(...xs),
		maxX: Math.max(...xs),
		minY: Math.min(...ys),
		maxY: Math.max(...ys),
	};
}

/** The largest per-item stroke width, cached on the array (0 for none). */
const widest = new WeakMap<Float32Array, number>();

function widestOf(widths: Float32Array | null | undefined): number {
	if (!widths) return 0;
	let max = widest.get(widths);
	if (max === undefined) {
		max = 0;
		for (let i = 0; i < widths.length; i++)
			if (widths[i] > max) max = widths[i];
		widest.set(widths, max);
	}
	return max;
}

/** Adds item `i`'s outline to the current path. */
function traceItem(
	ctx: CanvasRenderingContext2D,
	spec: MarksSpec,
	i: number,
	x: number,
	y: number,
	unit: Polyline | null,
): void {
	const { shape, extents } = spec;
	if (shape.kind === "rect") {
		const hw = extents[2 * i];
		const hh = extents[2 * i + 1];
		ctx.rect(x - hw, y - hh, hw * 2, hh * 2);
		return;
	}
	const r = extents[i];
	if (unit) {
		ctx.moveTo(x + unit[0].x * r, y + unit[0].y * r);
		for (let k = 1; k < unit.length; k++) {
			ctx.lineTo(x + unit[k].x * r, y + unit[k].y * r);
		}
		ctx.closePath();
		return;
	}
	// The circle shape's own outline (four cubics), not `arc`: the canvas
	// rasterises the two differently, and an item must paint the pixels its
	// shape would.
	const start = UNIT_CIRCLE.start;
	ctx.moveTo(x + start.x * r, y + start.y * r);
	for (const { c1, c2, to } of UNIT_CIRCLE.segments) {
		ctx.bezierCurveTo(
			x + c1.x * r,
			y + c1.y * r,
			x + c2.x * r,
			y + c2.y * r,
			x + to.x * r,
			y + to.y * r,
		);
	}
	ctx.closePath();
}

/** The unit circle as the `circle` shape traces it, scaled per item by `traceItem`. */
const UNIT_CIRCLE: CurvePath = arcCurvePath(0, 0, 1, 0, Math.PI * 2);

/**
 * Paints a marks node: every item in index order, filled then stroked, the way
 * the same items as separate shapes would paint. Items outside `visible` are
 * skipped. Each item is its own path and `fill()`: tracing a run of items into
 * one path looks cheaper but is not (the canvas fills a lone circle or rect on
 * a fast analytic path, and a long path slower than the sum of its parts) and
 * it rasterises edges differently from the single shapes these stand in for,
 * which shows as a faint difference in every dot's outline.
 */
export function drawMarks(
	ctx: CanvasRenderingContext2D,
	spec: MarksSpec,
	paints: PaintCache,
	visible: Bounds | null,
): void {
	const { style, count, centers, extents, fills, alphas, shape } = spec;
	const base = style.opacity * spec.progress;
	if (!(base > 0) || count === 0) return;
	if (
		shape.kind === "outline" ||
		shape.kind === "paths" ||
		spec.strokes ||
		spec.strokeWidths ||
		spec.dashes ||
		spec.progresses ||
		spec.dashOffsets
	) {
		drawItemMarks(ctx, spec, paints, visible);
		return;
	}
	const strokes =
		style.stroke !== "none" && style.strokeWidth > 0 && style.opacity > 0;
	const constant = typeof fills === "string" ? fills : null;
	if (!strokes && (constant === "none" || constant === "")) return;
	const fillAlpha = base * style.fillOpacity;
	const rect = shape.kind === "rect";
	const unit =
		shape.kind === "polygon" && shape.points.length > 1 ? shape.points : null;
	const pad = strokes ? style.strokeWidth : 0;

	ctx.save();
	if (strokes) applyStrokeStyle(ctx, style, paints);
	let lastFill: string | null = null;
	let lastAlpha = -1;

	for (let i = 0; i < count; i++) {
		const x = centers[2 * i];
		const y = centers[2 * i + 1];
		const ex = rect ? extents[2 * i] : extents[i];
		const ey = rect ? extents[2 * i + 1] : ex;
		if (!(ex >= 0 && ey >= 0) || !Number.isFinite(x) || !Number.isFinite(y))
			continue;
		if (
			visible &&
			(x + ex + pad < visible.minX ||
				x - ex - pad > visible.maxX ||
				y + ey + pad < visible.minY ||
				y - ey - pad > visible.maxY)
		)
			continue;
		const own = alphas ? alphas[i] : 1;
		if (!(own > 0)) continue;

		const fill = constant ?? (fills as readonly string[])[i];
		const paintsItem = !!fill && fill !== "none" && fillAlpha * own > 0;
		if (!paintsItem && !strokes) continue;

		ctx.beginPath();
		traceItem(ctx, spec, i, x, y, unit);
		if (paintsItem) {
			if (fill !== lastFill) {
				ctx.fillStyle = fill;
				lastFill = fill;
			}
			const alpha = fillAlpha * own;
			if (alpha !== lastAlpha) {
				ctx.globalAlpha = alpha;
				lastAlpha = alpha;
			}
			ctx.fill();
		}
		if (strokes) {
			const alpha = base * own;
			if (alpha !== lastAlpha) {
				ctx.globalAlpha = alpha;
				lastAlpha = alpha;
			}
			ctx.stroke();
		}
	}
	ctx.restore();
}

/**
 * Adds one polyline to the current path, each point placed by an item's linear
 * part (`a b c d`, column-major as in a `Matrix`) and centre (`x`, `y`).
 */
function tracePlacedPolyline(
	ctx: CanvasRenderingContext2D,
	line: Polyline,
	closed: boolean,
	a: number,
	b: number,
	c: number,
	d: number,
	x: number,
	y: number,
): void {
	if (line.length < 2) return;
	ctx.moveTo(
		x + a * line[0].x + c * line[0].y,
		y + b * line[0].x + d * line[0].y,
	);
	for (let k = 1; k < line.length; k++) {
		const p = line[k];
		ctx.lineTo(x + a * p.x + c * p.y, y + b * p.x + d * p.y);
	}
	if (closed) ctx.closePath();
}

/**
 * Adds one curve path to the current path, placed as
 * {@link tracePlacedPolyline} places a polyline: an affine map carries a
 * cubic's control points exactly.
 */
function tracePlacedCurve(
	ctx: CanvasRenderingContext2D,
	path: CurvePath,
	a: number,
	b: number,
	c: number,
	d: number,
	x: number,
	y: number,
): void {
	if (path.segments.length === 0) return;
	const s = path.start;
	ctx.moveTo(x + a * s.x + c * s.y, y + b * s.x + d * s.y);
	for (const segment of path.segments) {
		const { c1, c2, to } = segment;
		ctx.bezierCurveTo(
			x + a * c1.x + c * c1.y,
			y + b * c1.x + d * c1.y,
			x + a * c2.x + c * c2.y,
			y + b * c2.x + d * c2.y,
			x + a * to.x + c * to.y,
			y + b * to.x + d * to.y,
		);
	}
	if (path.closed) ctx.closePath();
}

/**
 * Adds an `outline`/`paths` item's outline to the current path: each point
 * (or curve control point, which an affine map carries exactly) placed by
 * the item's linear part and centre.
 */
function traceOutline(
	ctx: CanvasRenderingContext2D,
	outline: MarkOutline,
	transforms: Float64Array | null | undefined,
	i: number,
	x: number,
	y: number,
): void {
	const a = transforms ? transforms[4 * i] : 1;
	const b = transforms ? transforms[4 * i + 1] : 0;
	const c = transforms ? transforms[4 * i + 2] : 0;
	const d = transforms ? transforms[4 * i + 3] : 1;
	const curves = outline.curvePaths;
	if (curves && curves.length > 0) {
		for (const path of curves) tracePlacedCurve(ctx, path, a, b, c, d, x, y);
		return;
	}
	for (const line of outline.polylines)
		tracePlacedPolyline(ctx, line, outline.closed, a, b, c, d, x, y);
}

/* ---------------------------------------------------------------- reveals */

/**
 * Adds the revealed part of a partly revealed item's outline to the current
 * path — one arc-length budget across its subpaths, spent in order, as
 * `drawStroke` reveals a shape — placed as {@link traceOutline} places the
 * whole. Returns the length drawn in scene units: the outline-unit length
 * times the item's scale (exact under a similarity).
 */
function traceRevealed(
	ctx: CanvasRenderingContext2D,
	outline: MarkOutline,
	progress: number,
	transforms: Float64Array | null | undefined,
	i: number,
	x: number,
	y: number,
): number {
	const a = transforms ? transforms[4 * i] : 1;
	const b = transforms ? transforms[4 * i + 1] : 0;
	const c = transforms ? transforms[4 * i + 2] : 0;
	const d = transforms ? transforms[4 * i + 3] : 1;
	const curves = outline.curvePaths;
	let total: number;
	if (curves && curves.length > 0) {
		const entry = curveRevealOf(curves);
		total = entry.total;
		for (const piece of revealedCurves(entry.tables, total, progress))
			tracePlacedCurve(ctx, piece, a, b, c, d, x, y);
	} else {
		const entry = polylineRevealOf(outline.polylines);
		total = entry.total;
		// Revealed pieces are open, as a shape's are: a fully spent closed
		// polyline already ends on its first point.
		for (const piece of revealedPolylines(entry.tables, total, progress))
			tracePlacedPolyline(ctx, piece, false, a, b, c, d, x, y);
	}
	return total * progress * Math.sqrt(Math.abs(a * d - b * c));
}

/**
 * `drawMarks` for layers whose items each have their own outline or stroke:
 * the `outline` and `paths` kinds (an outline placed per item by
 * `transforms` and `centers`; only closed outlines are filled), and any kind
 * with per-item `strokes`, `strokeWidths`, `dashes`, `dashOffsets` or
 * `progresses`. Same order and culling as the plain path.
 *
 * A partly revealed item paints as `drawShape` paints a shape at that
 * progress: a closed outline fills whole at its fill opacity times its
 * progress, the stroke traces only the revealed length (fading up over its
 * first stroke width).
 */
function drawItemMarks(
	ctx: CanvasRenderingContext2D,
	spec: MarksSpec,
	paints: PaintCache,
	visible: Bounds | null,
): void {
	const { style, count, centers, extents, fills, alphas, shape } = spec;
	const { transforms, strokes, strokeWidths, dashes } = spec;
	const { progresses, dashOffsets } = spec;
	const base = style.opacity * spec.progress;
	const constant = typeof fills === "string" ? fills : null;
	const fillAlpha = base * style.fillOpacity;
	const rect = shape.kind === "rect";
	const unit =
		shape.kind === "polygon" && shape.points.length > 1 ? shape.points : null;
	const single: MarkOutline | null = shape.kind === "outline" ? shape : null;
	const outlines = shape.kind === "paths" ? shape.outlines : null;
	const sharedStrokes = style.stroke !== "none" && style.opacity > 0;

	ctx.save();
	applyStrokeStyle(ctx, style, paints);
	let lastStroke: string | null = null;
	let lastWidth = style.strokeWidth;
	let lastDash: readonly number[] | null | undefined = style.dash;
	// What `applyStrokeStyle` left: the shared offset where there is a shared
	// dash, else unknown (NaN, so the first item with a dash sets it).
	let lastDashOffset =
		style.dash && style.dash.length > 0 ? style.dashOffset : Number.NaN;
	let lastFill: string | null = null;
	let lastAlpha = -1;

	for (let i = 0; i < count; i++) {
		const x = centers[2 * i];
		const y = centers[2 * i + 1];
		const ex = rect ? extents[2 * i] : extents[i];
		const ey = rect ? extents[2 * i + 1] : ex;
		if (!(ex >= 0 && ey >= 0) || !Number.isFinite(x) || !Number.isFinite(y))
			continue;
		const stroke = strokes ? strokes[i] : null;
		const width = strokeWidths ? strokeWidths[i] : style.strokeWidth;
		const strokesItem =
			(strokes
				? !!stroke && stroke !== "none" && style.opacity > 0
				: sharedStrokes) && width > 0;
		const pad = strokesItem ? width : 0;
		if (
			visible &&
			(x + ex + pad < visible.minX ||
				x - ex - pad > visible.maxX ||
				y + ey + pad < visible.minY ||
				y - ey - pad > visible.maxY)
		)
			continue;
		const own = alphas ? alphas[i] : 1;
		if (!(own > 0)) continue;
		const outline = outlines ? outlines[i] : single;
		if ((outlines || single) && !outline) continue;
		// Only an outline reveals; at 0 the item paints nothing.
		const reveal = progresses && outline ? Math.min(1, progresses[i]) : 1;
		if (!(reveal > 0)) continue;
		const partial = reveal < 1;

		const fill = constant ?? (fills as readonly string[])[i];
		// The fill comes up with the reveal, as a shape's does.
		const itemFillAlpha = fillAlpha * own * reveal;
		const paintsItem =
			(!outline || outline.closed) &&
			!!fill &&
			fill !== "none" &&
			itemFillAlpha > 0;
		if (!paintsItem && !strokesItem) continue;

		// A partly revealed stroke traces its own path below, so the whole
		// outline is only traced when something fills or strokes all of it.
		if (paintsItem || !partial) {
			ctx.beginPath();
			if (outline) traceOutline(ctx, outline, transforms, i, x, y);
			else traceItem(ctx, spec, i, x, y, unit);
		}
		if (paintsItem) {
			if (fill !== lastFill) {
				ctx.fillStyle = fill;
				lastFill = fill;
			}
			const alpha = itemFillAlpha;
			if (alpha !== lastAlpha) {
				ctx.globalAlpha = alpha;
				lastAlpha = alpha;
			}
			ctx.fill();
		}
		if (strokesItem) {
			if (stroke !== null && stroke !== lastStroke) {
				ctx.strokeStyle = stroke;
				lastStroke = stroke;
			}
			if (width !== lastWidth) {
				ctx.lineWidth = Math.max(1e-6, width);
				lastWidth = width;
			}
			if (dashes) {
				const dash = dashes[i] ?? null;
				if (dash !== lastDash) {
					ctx.setLineDash(dash && dash.length > 0 ? (dash as number[]) : []);
					lastDash = dash;
				}
			}
			if (dashOffsets) {
				const dash = dashes ? (dashes[i] ?? null) : style.dash;
				const offset = dashOffsets[i];
				if (dash && dash.length > 0 && offset !== lastDashOffset) {
					ctx.lineDashOffset = offset;
					lastDashOffset = offset;
				}
			}
			let alpha = base * own;
			if (partial && outline) {
				ctx.beginPath();
				const drawn = traceRevealed(ctx, outline, reveal, transforms, i, x, y);
				// Shorter than it is wide, a stroke is all cap: it fades up over
				// its first stroke width of length, as a shape's does.
				if (drawn > 0 && drawn < width) alpha *= drawn / width;
			}
			if (alpha !== lastAlpha) {
				ctx.globalAlpha = alpha;
				lastAlpha = alpha;
			}
			ctx.stroke();
		}
	}
	ctx.restore();
}

/**
 * Uploaded bitmaps, one per `ImagePixels` object. Any canvas can draw any
 * other canvas, so unlike gradients these are shared between renderers.
 */
const bitmaps = new WeakMap<ImagePixels, CanvasImageSource>();

function bitmapFor(
	pixels: ImagePixels,
	ctx: CanvasRenderingContext2D,
): CanvasImageSource | null {
	const cached = bitmaps.get(pixels);
	if (cached) return cached;
	if (typeof ImageData === "undefined") return null;
	const { width, height } = pixels;
	let surface: OffscreenCanvas | HTMLCanvasElement | null = null;
	if (typeof OffscreenCanvas !== "undefined") {
		surface = new OffscreenCanvas(width, height);
	} else {
		const doc = (ctx.canvas as HTMLCanvasElement | undefined)?.ownerDocument;
		if (doc) {
			surface = doc.createElement("canvas");
			surface.width = width;
			surface.height = height;
		}
	}
	const target = surface?.getContext("2d") as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null
		| undefined;
	if (!surface || !target) return null;
	target.putImageData(
		new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, width, height),
		0,
		0,
	);
	bitmaps.set(pixels, surface);
	return surface;
}

/**
 * Paints an image node: its bitmap drawn under the view, through the spec's
 * affine frame, so pan and zoom move it without re-uploading a pixel.
 */
export function drawImageSpec(
	ctx: CanvasRenderingContext2D,
	spec: ImageSpec,
): void {
	const alpha = spec.opacity * spec.progress;
	const { width, height } = spec.pixels;
	if (!(alpha > 0) || width === 0 || height === 0) return;
	const bitmap = bitmapFor(spec.pixels, ctx);
	if (!bitmap) return;
	const { origin: o, xAxis: a, yAxis: b } = spec;
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.imageSmoothingEnabled = spec.smoothing;
	ctx.transform(a.x / width, a.y / width, b.x / height, b.y / height, o.x, o.y);
	ctx.drawImage(bitmap, 0, 0);
	ctx.restore();
}

/* ------------------------------------------------------------------ splat */

/** A marks layer splats when it has at least this many items… */
const SPLAT_MIN_ITEMS = 1000;
/** …none of them wider than this in device pixels (radius, or half-extent). */
const SPLAT_MAX_RADIUS = 4;

/** A fill as 0..255 channels, plus its alpha 0..1. Null for unparsable or `"none"`. */
interface SplatColor {
	r: number;
	g: number;
	b: number;
	a: number;
}

const colors = new Map<string, SplatColor | null>();

function colorOf(fill: string): SplatColor | null {
	let parsed = colors.get(fill);
	if (parsed !== undefined) return parsed;
	parsed = null;
	if (fill && fill !== "none") {
		const color = tryParseColor(fill);
		if (color) parsed = { r: color.r, g: color.g, b: color.b, a: color.a };
	}
	if (colors.size > 4096) colors.clear();
	colors.set(fill, parsed);
	return parsed;
}

/**
 * Packs premultiplied channels as one `ImageData` pixel read through a
 * `Uint32Array`: little-endian, so red is the low byte. Every engine this
 * library supports runs little-endian.
 */
const pack = (r: number, g: number, b: number, a: number): number =>
	((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

/**
 * Source-over, in 8-bit premultiplied RGBA — what a canvas itself stores —
 * of a colour at `a` (coverage times opacity, 0..1) onto pixel `at`.
 */
function blend(
	pixels: Uint32Array,
	at: number,
	color: SplatColor,
	opaque: number,
	a: number,
): void {
	if (a >= 1) {
		// Fully covered by an opaque item: one store, nothing underneath survives.
		pixels[at] = opaque;
		return;
	}
	const under = pixels[at];
	const keep = 1 - a;
	pixels[at] = pack(
		(color.r * a + (under & 255) * keep + 0.5) | 0,
		(color.g * a + ((under >>> 8) & 255) * keep + 0.5) | 0,
		(color.b * a + ((under >>> 16) & 255) * keep + 0.5) | 0,
		(255 * a + (under >>> 24) * keep + 0.5) | 0,
	);
}

/**
 * One disc's antialiased coverage: distance-based, a ramp one pixel wide at
 * the rim. Row by row: the pixels whose centres lie within `radius - 0.5` are
 * fully covered, so each row's interior is one run of plain stores for an
 * opaque item, and only the few rim pixels at its ends are shaded one at a time.
 */
function splatDisc(
	pixels: Uint32Array,
	width: number,
	height: number,
	cx: number,
	cy: number,
	radius: number,
	color: SplatColor,
	opaque: number,
	alpha: number,
): void {
	const inner = radius - 0.5;
	const outer = radius + 0.5;
	const inner2 = inner > 0 ? inner * inner : -1;
	const outer2 = outer * outer;
	const py0 = Math.max(0, Math.floor(cy - outer));
	const py1 = Math.min(height - 1, Math.floor(cy + outer));
	for (let py = py0; py <= py1; py++) {
		const dy = py + 0.5 - cy;
		const dy2 = dy * dy;
		if (dy2 >= outer2) continue;
		const row = py * width;
		// Pixel centres x + 0.5 within `outer` of cx on this row: [first, last].
		const span = Math.sqrt(outer2 - dy2);
		const first = Math.max(0, Math.ceil(cx - span - 0.5));
		const last = Math.min(width - 1, Math.floor(cx + span - 0.5));
		// …and within `inner`: the fully covered run, [solid0, solid1].
		let solid0 = last + 1;
		let solid1 = last;
		if (dy2 < inner2) {
			const core = Math.sqrt(inner2 - dy2);
			solid0 = Math.max(first, Math.ceil(cx - core - 0.5));
			solid1 = Math.min(last, Math.floor(cx + core - 0.5));
		}
		for (let px = first; px <= last; px++) {
			if (px === solid0 && solid0 <= solid1) {
				// A plain loop: runs are a few pixels, where `fill`'s call costs
				// more than the stores.
				if (alpha >= 1)
					for (let x = row + solid0, end = row + solid1; x <= end; x++)
						pixels[x] = opaque;
				else
					for (let x = solid0; x <= solid1; x++)
						blend(pixels, row + x, color, opaque, alpha);
				px = solid1;
				continue;
			}
			const dx = px + 0.5 - cx;
			const cover = outer - Math.sqrt(dx * dx + dy2);
			if (cover > 0)
				blend(pixels, row + px, color, opaque, (cover > 1 ? 1 : cover) * alpha);
		}
	}
}

/** One box's exact coverage: its overlap with each pixel, per axis. */
function splatBox(
	pixels: Uint32Array,
	width: number,
	height: number,
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	color: SplatColor,
	opaque: number,
	alpha: number,
): void {
	const px0 = Math.max(0, Math.floor(cx - rx));
	const px1 = Math.min(width - 1, Math.ceil(cx + rx));
	const py0 = Math.max(0, Math.floor(cy - ry));
	const py1 = Math.min(height - 1, Math.ceil(cy + ry));
	for (let py = py0; py <= py1; py++) {
		const coverY = Math.min(py + 1, cy + ry) - Math.max(py, cy - ry);
		if (coverY <= 0) continue;
		const row = py * width;
		for (let px = px0; px <= px1; px++) {
			const coverX = Math.min(px + 1, cx + rx) - Math.max(px, cx - rx);
			if (coverX > 0)
				blend(pixels, row + px, color, opaque, coverX * coverY * alpha);
		}
	}
}

/** One scratch raster, grown as needed and reused by every splat. */
let scratch: {
	surface: OffscreenCanvas | HTMLCanvasElement;
	ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
	image: ImageData;
	pixels: Uint32Array;
} | null = null;

function scratchFor(
	width: number,
	height: number,
	ctx: CanvasRenderingContext2D,
): NonNullable<typeof scratch> | null {
	if (
		scratch &&
		scratch.image.width === width &&
		scratch.image.height === height
	)
		return scratch;
	if (typeof ImageData === "undefined") return null;
	let surface: OffscreenCanvas | HTMLCanvasElement | null = null;
	if (typeof OffscreenCanvas !== "undefined") {
		surface = new OffscreenCanvas(width, height);
	} else {
		const doc = (ctx.canvas as HTMLCanvasElement | undefined)?.ownerDocument;
		if (doc) {
			surface = doc.createElement("canvas");
			surface.width = width;
			surface.height = height;
		}
	}
	const target = surface?.getContext("2d") as
		| OffscreenCanvasRenderingContext2D
		| CanvasRenderingContext2D
		| null
		| undefined;
	if (!surface || !target) return null;
	const image = new ImageData(width, height);
	scratch = {
		surface,
		ctx: target,
		image,
		pixels: new Uint32Array(image.data.buffer),
	};
	return scratch;
}

/**
 * Paints a dense layer of tiny unstroked discs or boxes by rasterising them
 * here, into one buffer, and drawing that once — rather than one path and one
 * `fill()` per item. At a few device pixels across, a canvas spends far longer
 * per item on path setup than on pixels, on the GPU as much as in software:
 * 100k such items are about 50 ms a frame as paths in GPU Chrome, and a few
 * as a splat.
 *
 * Items blend source-over in index order, in 8-bit premultiplied RGBA as the
 * canvas itself composites, with an antialiased coverage (exact for boxes;
 * distance-based for discs), so the picture is the one the paths draw to
 * within a level of antialiasing. A fully covered pixel of an opaque item is
 * a single store. Returns false, having drawn nothing, whenever the layer does
 * not qualify (rotated or skewed view, strokes, any kind but `circle` and
 * `rect`, per-item strokes, transforms or reveals, large items, no offscreen
 * canvas), and the caller paints paths.
 */
export function splatMarks(
	ctx: CanvasRenderingContext2D,
	spec: MarksSpec,
	view: Matrix,
	viewport: DeviceRect,
): boolean {
	const { style, count, centers, extents, fills, alphas, shape } = spec;
	if (
		count < SPLAT_MIN_ITEMS ||
		(shape.kind !== "circle" && shape.kind !== "rect")
	)
		return false;
	if (style.stroke !== "none" && style.strokeWidth > 0) return false;
	// Per-item strokes, placement or reveals are paths' business.
	if (
		spec.strokes ||
		spec.strokeWidths ||
		spec.dashes ||
		spec.dashOffsets ||
		spec.progresses ||
		spec.transforms
	)
		return false;
	if (view.b !== 0 || view.c !== 0) return false;
	if (!spec.bounds) return false;
	const sx = view.a;
	const sy = view.d;
	const rect = shape.kind === "rect";
	if (!rect && Math.abs(Math.abs(sx) - Math.abs(sy)) > 1e-9 * Math.abs(sx))
		return false;
	let widest = 0;
	for (let i = 0; i < extents.length; i++)
		if (extents[i] > widest) widest = extents[i];
	if (widest * Math.max(Math.abs(sx), Math.abs(sy)) > SPLAT_MAX_RADIUS)
		return false;

	// The device box the layer can touch, clipped to what is being painted.
	const bx0 = view.a * spec.bounds.minX + view.e;
	const bx1 = view.a * spec.bounds.maxX + view.e;
	const by0 = view.d * spec.bounds.minY + view.f;
	const by1 = view.d * spec.bounds.maxY + view.f;
	const left = Math.max(viewport.x, Math.floor(Math.min(bx0, bx1)) - 1);
	const top = Math.max(viewport.y, Math.floor(Math.min(by0, by1)) - 1);
	const right = Math.min(
		viewport.x + viewport.width,
		Math.ceil(Math.max(bx0, bx1)) + 1,
	);
	const bottom = Math.min(
		viewport.y + viewport.height,
		Math.ceil(Math.max(by0, by1)) + 1,
	);
	const width = right - left;
	const height = bottom - top;
	if (width <= 0 || height <= 0) return true;
	const target = scratchFor(width, height, ctx);
	if (!target) return false;

	const { pixels, image } = target;
	pixels.fill(0);
	const base = style.opacity * style.fillOpacity * spec.progress;
	const constant = typeof fills === "string" ? colorOf(fills) : null;
	const ax = Math.abs(sx);
	const ay = Math.abs(sy);
	let lastColor: SplatColor | null = null;
	let lastFill: string | null = null;
	let lastFillColor: SplatColor | null = null;
	let opaque = 0;

	for (let i = 0; i < count; i++) {
		let color = constant;
		if (typeof fills !== "string") {
			// Neighbouring items mostly share a fill: skip the lookup for them.
			const fill = fills[i];
			if (fill !== lastFill) {
				lastFill = fill;
				lastFillColor = colorOf(fill);
			}
			color = lastFillColor;
		}
		if (!color) continue;
		const alpha = base * color.a * (alphas ? alphas[i] : 1);
		if (!(alpha > 0)) continue;
		if (color !== lastColor) {
			lastColor = color;
			opaque = pack(color.r, color.g, color.b, 255);
		}
		const cx = sx * centers[2 * i] + view.e - left;
		const cy = sy * centers[2 * i + 1] + view.f - top;
		if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
		if (rect) {
			const rx = extents[2 * i] * ax;
			const ry = extents[2 * i + 1] * ay;
			if (rx >= 0 && ry >= 0)
				splatBox(pixels, width, height, cx, cy, rx, ry, color, opaque, alpha);
		} else {
			const radius = extents[i] * ax;
			if (radius >= 0)
				splatDisc(pixels, width, height, cx, cy, radius, color, opaque, alpha);
		}
	}

	// `ImageData` is straight alpha: only partly transparent pixels need their
	// colour divided back out; empty and opaque ones are already right.
	for (let at = 0; at < pixels.length; at++) {
		const value = pixels[at];
		const a = value >>> 24;
		if (a === 0 || a === 255) continue;
		const scale = 255 / a;
		pixels[at] = pack(
			Math.min(255, ((value & 255) * scale + 0.5) | 0),
			Math.min(255, (((value >>> 8) & 255) * scale + 0.5) | 0),
			Math.min(255, (((value >>> 16) & 255) * scale + 0.5) | 0),
			a,
		);
	}
	target.ctx.putImageData(image, 0, 0);
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalAlpha = 1;
	ctx.drawImage(target.surface, left, top);
	ctx.restore();
	return true;
}

// The tables are shared with picking (`interact/pick-items.ts`), so they live
// in `geometry/path/outline-reveal.ts`; re-exported for the renderer's tests.
export { revealedCurves, revealMeasures };
