/**
 * The Canvas2D renderer. It holds the z-sorted frame of scene-unit specs it
 * was last handed, plus the theme, size, cameras and focus, and paints them on
 * request: under each camera's view matrix (`ctx.setTransform`), so pan, zoom,
 * resize and dpr changes never touch a spec. Text is drawn upright in pixels
 * from its transformed anchor.
 *
 * It owns no frame loop and subscribes to nothing. The scene pushes state in
 * through setters, each of which marks the renderer dirty and asks the host
 * for a paint (`onPaintRequest`); the host calls `paint()` in the paint phase
 * of the shared frame loop (`tween/frame-loop.ts`).
 *
 * Invariant: `RevealCache` and the `Path2D` cache in `paint.ts` key on the
 * **array identity** of a node's `polylines`/`curvePaths`. A spec stage must
 * return the same arrays while its inputs are unchanged; a stray `.map()` or
 * spread silently re-measures every node every frame.
 */

import type {
	ArcTable,
	Bounds,
	CurveArcTable,
	CurvePath,
	Polyline,
} from "../geometry/index.js";
import {
	measure,
	measureCurve,
	revealedPolylines,
	sliceBetween,
	sliceCurveBetween,
} from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import {
	applyToPoint,
	IDENTITY,
	scaleFactorOf,
} from "../geometry/transform.js";
import { isYUp } from "../geometry/view-matrix.js";
import { writePhase } from "../geometry/write-phase.js";
import { boundsOfNodes } from "../interact/hit.js";
import { itemBox } from "../interact/item-order.js";
import { textRotation } from "../spec/bake.js";
import type {
	ClipRegion,
	DrawSpec,
	ShapeSpec,
	StrokeStyle,
	TextSpec,
} from "../spec/types.js";
import { resolveTheme } from "../themes/theme.js";
import type { Theme } from "../themes/types.js";
import type { CameraView } from "./camera.js";
import { cameraMatrix, viewportBox } from "./camera.js";
import { createLayerCache } from "./layer-cache.js";
import type { PaintCache, PathTarget } from "./paint.js";
import {
	applyStrokeStyle,
	createPaintCache,
	curvesPath2D,
	fillCurvePaths,
	fillRings,
	fontString,
	paintsFill,
	ringsPath2D,
	tracePath,
	tracePolyline,
} from "./paint.js";
import type { DeviceRect } from "./paint-items.js";
import {
	drawImageSpec,
	drawMarks,
	mayBeVisible,
	revealedCurves,
	splatMarks,
	visibleBox,
} from "./paint-items.js";

/**
 * Options for {@link createCanvasRenderer}: the canvas and the state the first
 * paint needs. Everything else starts at its default and is set later.
 *
 * @category Renderer & paint
 */
export interface RendererOptions {
	/** The canvas to paint into. Its 2D context is acquired once; sizing its backing store is the caller's job. */
	canvas: HTMLCanvasElement;
	/**
	 * Supplies the background fill, focus-ring colour and default styling.
	 * Defaults to `resolveTheme()`. Change it with `setTheme`.
	 */
	theme?: Theme;
	/**
	 * Backing-store size in device pixels. Defaults to the canvas's own
	 * `width`/`height` at creation. Change it with `setSize`.
	 */
	size?: { width: number; height: number };
	/**
	 * Called whenever the renderer has become dirty and wants `paint()` called
	 * in a paint phase: after any setter that changed something, `invalidate`,
	 * `setVisible(true)`, `dissolve`, and from inside `paint()` itself while a
	 * dissolve is running or the layer cache wants its settle repaint. A
	 * request made from inside `paint()` must be honoured in the **next**
	 * frame, not the one in progress; `requestFrame()` (a bare wake) has
	 * exactly those semantics. Not called while hidden.
	 *
	 * The usual wiring:
	 * `onFrame("paint", () => { if (renderer.needsPaint()) renderer.paint(); }, { awake: false })`
	 * with `onPaintRequest: () => requestFrame()`.
	 */
	onPaintRequest?: () => void;
}

/**
 * Options for {@link Renderer.setFrame}.
 *
 * @category Renderer & paint
 */
export interface SetFrameOptions {
	/**
	 * Whether the frame's *membership* may have changed since the last one
	 * (nodes added or removed), as opposed to specs patched in place. When
	 * true the renderer drops the reveal tables of nodes no longer present,
	 * which costs a pass over the frame; a collector that knows a frame only
	 * patched specs passes false to skip it on ordinary animation frames.
	 *
	 * @default true
	 */
	membershipChanged?: boolean;
}

/**
 * What {@link createCanvasRenderer} returns: an imperative object. Setters
 * compare with what they hold (`===`, or by value for `setSize` and `setDpr`)
 * and only a change marks the renderer dirty.
 *
 * @category Renderer & paint
 */
export interface Renderer {
	/**
	 * Hands over the frame to paint: the z-sorted scene-unit specs (see
	 * `compileFrame`). Kept by reference; the caller must not mutate it
	 * afterwards (hand over a new array instead). The same array again is a
	 * no-op.
	 */
	setFrame(specs: readonly DrawSpec[], options?: SetFrameOptions): void;
	/** Sets the theme: background fill, focus-ring colour. */
	setTheme(theme: Theme): void;
	/**
	 * The fill painted over the whole canvas before the scene, as a CSS colour;
	 * `null` only clears it, leaving a transparent canvas the page shows
	 * through; `undefined` (the default) uses the theme background.
	 */
	setBackground(background: string | null | undefined): void;
	/** Backing-store size in device pixels. A zero dimension paints nothing. */
	setSize(size: { width: number; height: number }): void;
	/**
	 * The stage's own view matrix (scene units → device pixels, from the
	 * stage's `units`/`center`/`yUp` and the canvas size). Painted under when
	 * there are no cameras; with cameras each camera's own matrix is used and
	 * this is not consulted. Defaults to the identity.
	 */
	setCanonicalView(view: Matrix): void;
	/**
	 * Views to paint the frame through, in paint order. Empty (the default)
	 * means one view filling the canvas under the canonical view, which is
	 * also the only path that reuses bitmaps between frames.
	 */
	setCameras(views: readonly CameraView[]): void;
	/** Device pixels per CSS pixel, for chrome that should not scale with zoom. Defaults to 1. */
	setDpr(dpr: number): void;
	/**
	 * Ids of the nodes to draw a focus ring around, or null. The ring is drawn
	 * after the frame, from the same specs, so it follows its node.
	 */
	setFocus(ids: readonly number[] | null): void;
	/**
	 * The keyboard's current item within a focused batched node, or null. When
	 * it belongs to a focused node, the ring wraps that item rather than the
	 * whole node.
	 */
	setFocusItem(item: { id: number; item: number } | null): void;
	/**
	 * Forces a full repaint (after a font load, say): drops the bitmap layers
	 * and marks the renderer dirty.
	 */
	invalidate(): void;
	/**
	 * Tells the renderer whether its canvas is on screen. While hidden it paints
	 * nothing (state is still taken in) and asks for no paints; becoming visible
	 * asks for one at once. Renderers start visible.
	 */
	setVisible(visible: boolean): void;
	/**
	 * Cross-fades from the current pixels into whatever is painted next, over
	 * `duration` seconds of wall time (`performance.now`). Paint-only (no clock,
	 * invisible to seek and export); used for reduced-motion jumps.
	 */
	dissolve(duration: number): void;
	/**
	 * The z-sorted specs last handed to `setFrame`: what the next paint draws.
	 * Picking uses the same array. Stable across camera, size and dpr changes.
	 */
	snapshot(): readonly DrawSpec[];
	/** Whether a paint is wanted: something changed since the last `paint()` and the canvas is visible. */
	needsPaint(): boolean;
	/**
	 * Paints now: clears, fills the background, draws the frame under each
	 * camera's view (or the canonical one), then borders, the focus ring and
	 * any running dissolve. Clears the dirty flag. Does nothing visible while
	 * hidden or at a zero size.
	 */
	paint(): void;
	/** Drops caches and bitmap layers; the renderer asks for no more paints. */
	dispose(): void;
}

/**
 * Arc-length tables for one node, kept between frames and keyed on the identity
 * of the node's `polylines` or `curvePaths` (see the module header). Measured in
 * scene units, so camera moves never invalidate them.
 *
 * @category Renderer & paint
 */
export type RevealCache =
	| { kind: "polyline"; source: Polyline[]; tables: ArcTable[]; total: number }
	| {
			kind: "curve";
			source: CurvePath[];
			tables: CurveArcTable[];
			total: number;
	  };

/** The two fields every geometry source's cached entry has in common. */
type RevealEntry<T extends { total: number }> = { tables: T[]; total: number };

function revealFor(
	cache: Map<number, RevealCache>,
	spec: ShapeSpec,
): RevealCache {
	const existing = cache.get(spec.id);
	if (spec.curvePaths) {
		const curvePaths = spec.curvePaths;
		if (existing?.kind === "curve" && existing.source === curvePaths) {
			return existing;
		}
		const tables = curvePaths.map(measureCurve);
		const entry: RevealCache = {
			kind: "curve",
			source: curvePaths,
			tables,
			total: tables.reduce((sum, table) => sum + table.total, 0),
		};
		cache.set(spec.id, entry);
		return entry;
	}

	if (existing?.kind === "polyline" && existing.source === spec.polylines) {
		return existing;
	}
	const tables = spec.polylines.map(measure);
	const entry: RevealCache = {
		kind: "polyline",
		source: spec.polylines,
		tables,
		total: tables.reduce((sum, table) => sum + table.total, 0),
	};
	cache.set(spec.id, entry);
	return entry;
}

/**
 * One geometry representation's stroke operations (polyline or curve), picked
 * once per `drawShape`. Two concrete builders rather than a union keep `T` and
 * `P` linked for the type checker.
 */
interface GeometrySource<T extends { total: number }, P> {
	/** Every part, in spec order — what a progress>=1 stroke draws directly,
	 * with no arc-length table needed. */
	rings: (spec: ShapeSpec) => P[];
	slice: (table: T, from: number, to: number) => P;
	trace: (ctx: PathTarget, piece: P) => void;
	isEmpty: (piece: P) => boolean;
	/**
	 * The fully-revealed stroke as a cached `Path2D`, or null where there is no
	 * `Path2D` to cache (drawing then traces into the context).
	 */
	path: (spec: ShapeSpec) => Path2D | null;
	/** The cached arc-length tables, measuring (and caching) on first access. */
	entry: (spec: ShapeSpec, cache: Map<number, RevealCache>) => RevealEntry<T>;
	/** The pieces a partial reveal draws, per the budget-in-order rule. */
	revealedOf: (tables: T[], total: number, progress: number) => P[];
}

/**
 * The polyline representation's operations. Static: building a closure
 * object per shape per frame per camera was measurable garbage.
 */
const POLYLINE_SOURCE: GeometrySource<ArcTable, Polyline> = {
	rings: (spec) => spec.polylines,
	slice: sliceBetween,
	trace: tracePolyline,
	isEmpty: (piece) => piece.length < 2,
	path: (spec) => ringsPath2D(spec.polylines),
	entry: (spec, cache) => revealFor(cache, spec) as RevealEntry<ArcTable>,
	revealedOf: revealedPolylines,
};

/** The curve-native representation's operations; only for specs with `curvePaths`. */
const CURVE_SOURCE: GeometrySource<CurveArcTable, CurvePath> = {
	rings: (spec) => spec.curvePaths as CurvePath[],
	slice: sliceCurveBetween,
	trace: tracePath,
	isEmpty: (piece) => piece.segments.length === 0,
	path: (spec) => curvesPath2D(spec.curvePaths as CurvePath[]),
	entry: (spec, cache) => revealFor(cache, spec) as RevealEntry<CurveArcTable>,
	revealedOf: revealedCurves,
};

/**
 * The stroke half of `drawShape`, written once against `GeometrySource<T, P>`
 * instead of twice (or three times, counting `strokeAlongBands`'s former
 * private copy of this same `curvePaths ?` check) against the concrete
 * representations. Assumes the caller has already checked the shape actually
 * strokes and has called `applyStrokeStyle` — this only adds path data and
 * calls `stroke()`.
 */
function drawStroke<T extends { total: number }, P>(
	ctx: CanvasRenderingContext2D,
	spec: ShapeSpec,
	src: GeometrySource<T, P>,
	cache: Map<number, RevealCache>,
): void {
	if (spec.style.along && spec.style.along.colors.length > 0) {
		strokeAlongBands(
			ctx,
			spec,
			src.entry(spec, cache),
			src.slice,
			src.trace,
			src.isEmpty,
		);
		return;
	}

	if (spec.progress >= 1) {
		// Fully revealed: the stroke is the whole geometry, which is the same
		// path every frame — and every camera — until the shape changes, so it
		// is built once as a `Path2D` and handed to the canvas.
		const path = src.path(spec);
		if (path) {
			ctx.stroke(path);
			return;
		}
		ctx.beginPath();
		for (const piece of src.rings(spec)) src.trace(ctx, piece);
		ctx.stroke();
		return;
	}

	// One budget across the whole shape, spent in order: a multi-part shape
	// draws part by part the way you'd draw it — an arrow's shaft, then its
	// head — rather than every part growing at once. For the polyline
	// representation this is `revealedPolylines`, also shared with
	// `interact/hit.ts`'s "how much of this outline is actually on screen"
	// — see that function's doc comment for why the two must never compute
	// a different answer. The curve representation has no such second
	// caller (yet); see `revealedCurves`'s doc comment for why it is not
	// pulled up to sit beside `revealedPolylines` on that basis alone.
	const entry = src.entry(spec, cache);
	ctx.beginPath();
	for (const piece of src.revealedOf(entry.tables, entry.total, spec.progress))
		src.trace(ctx, piece);
	// Shorter than it is wide, a stroke is all cap: a round-capped one would
	// paint a dot a stroke-width across before it has any length. It fades up
	// over its first stroke-width of length instead.
	const drawn = entry.total * spec.progress;
	const width = spec.style.strokeWidth;
	if (drawn > 0 && drawn < width) {
		const alpha = ctx.globalAlpha;
		ctx.globalAlpha = alpha * (drawn / width);
		ctx.stroke();
		ctx.globalAlpha = alpha;
		return;
	}
	ctx.stroke();
}

/**
 * Strokes a shape one arc-length band per colour (`strokeAlong`): N `stroke()`
 * calls, since `strokeStyle` is one value per call. Adjacent pieces share their
 * boundary point so round caps hide the seams (butt caps on sharp bends may
 * show a hairline), dashes restart per piece, and the reveal budget is spent
 * before the bands are clipped to it.
 */
function strokeAlongBands<T extends { total: number }, P>(
	ctx: CanvasRenderingContext2D,
	spec: ShapeSpec,
	entry: { tables: T[]; total: number },
	slice: (table: T, from: number, to: number) => P,
	trace: (ctx: PathTarget, piece: P) => void,
	isEmpty: (piece: P) => boolean,
): void {
	const { colors, scope } = spec.style.along as NonNullable<
		ShapeSpec["style"]["along"]
	>;
	const perPolyline = scope === "polyline";
	if (entry.total <= 0) return;

	let budget = entry.total * spec.progress;
	let travelled = 0;

	for (const table of entry.tables) {
		if (budget <= 0) break;
		const revealed = table.total === 0 ? 0 : Math.min(1, budget / table.total);
		const offset = travelled;
		budget -= table.total;
		travelled += table.total;
		if (table.total === 0 || revealed <= 0) continue;

		// Where this polyline sits in the colour list's own 0..1 — its whole
		// span when the list restarts per polyline, its share of the shape's
		// total arc length when the list is spent across the node.
		const spanFrom = perPolyline ? 0 : offset / entry.total;
		const spanTo = perPolyline ? 1 : travelled / entry.total;
		const span = spanTo - spanFrom;
		if (span <= 0) continue;

		for (let i = 0; i < colors.length; i++) {
			const from = (i / colors.length - spanFrom) / span;
			const to = ((i + 1) / colors.length - spanFrom) / span;
			if (from >= revealed) break;
			if (to <= 0) continue;
			const piece = slice(table, from, Math.min(to, revealed));
			if (isEmpty(piece)) continue;
			ctx.strokeStyle = colors[i];
			ctx.beginPath();
			trace(ctx, piece);
			ctx.stroke();
		}
	}
}

/**
 * A shape mid-write (see `ShapeWrite`): Manim's `DrawBorderThenFill` per
 * piece, each piece at its own point of the lagged write. A piece fills and
 * then strokes before the next one paints, as Manim draws a submobject.
 */
function drawWrite<T extends { total: number }, P>(
	ctx: CanvasRenderingContext2D,
	spec: ShapeSpec,
	src: GeometrySource<T, P>,
	cache: Map<number, RevealCache>,
	paints: PaintCache,
	fill: (rings: P[], opacity: number) => void,
): void {
	const { style } = spec;
	const write = spec.write as NonNullable<ShapeSpec["write"]>;
	const { tables } = src.entry(spec, cache);
	const rings = src.rings(spec);
	const { pieces } = write;
	// Manim's outline colour: the stroke when the shape has one, else its fill.
	const strokes = style.stroke !== "none" && style.strokeWidth > 0;
	const outline = strokes ? style.stroke : (style.fill ?? style.stroke);
	const finalWidth = strokes ? style.strokeWidth : 0;

	for (let i = 0; i < pieces.length; i++) {
		const phase = writePhase(spec.progress, i, pieces.length, write.lagRatio);
		// Pieces start in order, so once one has not started none after it has.
		if (phase.border <= 0) break;
		const start = pieces[i];
		const end = i + 1 < pieces.length ? pieces[i + 1] : tables.length;

		if (phase.fill > 0 && paintsFill(style.fill) && spec.closed) {
			const from = Math.max(start, spec.fillFrom);
			if (from < end) {
				fill(rings.slice(from, end), style.fillOpacity * phase.fill);
			}
		}

		const width =
			write.outlineWidth + (finalWidth - write.outlineWidth) * phase.fill;
		if (width <= 0 || outline === "none") continue;
		ctx.save();
		applyStrokeStyle(
			ctx,
			{ ...style, stroke: outline, strokeWidth: width },
			paints,
		);
		ctx.beginPath();
		if (phase.border >= 1) {
			for (let r = start; r < end; r++) src.trace(ctx, rings[r]);
		} else {
			const run = tables.slice(start, end);
			const total = run.reduce((sum, table) => sum + table.total, 0);
			for (const piece of src.revealedOf(run, total, phase.border)) {
				src.trace(ctx, piece);
			}
		}
		ctx.stroke();
		ctx.restore();
	}
}

/** Each style with its lengths divided by a scale, by scale: see {@link localView}. */
const scaledStyles = new WeakMap<
	StrokeStyle,
	{ scale: number; style: StrokeStyle }
>();

function scaledStyle(style: StrokeStyle, scale: number): StrokeStyle {
	if (scale === 1) return style;
	const cached = scaledStyles.get(style);
	if (cached && cached.scale === scale) return cached.style;
	const scaled: StrokeStyle = {
		...style,
		strokeWidth: style.strokeWidth / scale,
		dash: style.dash ? style.dash.map((d) => d / scale) : null,
		dashOffset: style.dashOffset / scale,
	};
	scaledStyles.set(style, { scale, style: scaled });
	return scaled;
}

/** The local spec {@link localView} is currently presenting. */
let presented: {
	spec: ShapeSpec;
	local: NonNullable<ShapeSpec["local"]>;
} | null = null;

/**
 * One reused object: {@link drawShape} only reads a spec while drawing it, and
 * keeps nothing of it but the arrays it keys its caches on, so presenting
 * every local spec through the same object costs no allocation per shape per
 * frame.
 */
const scratch = {
	kind: "shape" as const,
	id: 0,
	zIndex: 0,
	get polylines() {
		// A getter: a curve outline is drawn from its curves and flattened only
		// if something here needs points.
		return (presented as NonNullable<typeof presented>).local.polylines;
	},
	closed: false,
	fillFrom: 0,
	write: undefined as ShapeSpec["write"],
	curvePaths: undefined as ShapeSpec["curvePaths"],
	style: undefined as unknown as StrokeStyle,
	progress: 1,
};

/**
 * A spec with local geometry (`ShapeSpec.local`) as {@link drawShape} draws it
 * under its transform: the outline in its own units, and every length the
 * style gives in scene units divided by the transform's scale, so the stroke
 * comes out the width asked for.
 */
function localView(
	spec: ShapeSpec,
	local: NonNullable<ShapeSpec["local"]>,
): ShapeSpec {
	const scale = scaleFactorOf(local.transform) || 1;
	presented = { spec, local };
	scratch.id = spec.id;
	scratch.zIndex = spec.zIndex;
	scratch.closed = spec.closed;
	scratch.fillFrom = spec.fillFrom;
	scratch.write = spec.write
		? { ...spec.write, outlineWidth: spec.write.outlineWidth / scale }
		: undefined;
	scratch.curvePaths = local.curvePaths;
	scratch.style = scaledStyle(spec.style, scale);
	scratch.progress = spec.progress;
	return scratch as unknown as ShapeSpec;
}

function drawShape(
	ctx: CanvasRenderingContext2D,
	spec: ShapeSpec,
	cache: Map<number, RevealCache>,
	paints: PaintCache,
	view: Matrix,
): void {
	const local = spec.local;
	if (local) {
		// The outline in its own units under its own matrix: a node that only
		// moved hands over the same arrays, so its `Path2D` and reveal tables are
		// the cached ones. The view is put back rather than saved and restored,
		// which would copy the whole context state per shape.
		const t = local.transform;
		ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f);
		drawShape(ctx, localView(spec, local), cache, paints, view);
		ctx.setTransform(view.a, view.b, view.c, view.d, view.e, view.f);
		return;
	}
	const { style } = spec;

	if (spec.write && spec.progress < 1) {
		// Mid-write the pieces each stand somewhere different, so the whole
		// pass is per piece; once written the shape draws as any other.
		if (spec.progress <= 0 || style.opacity <= 0) return;
		if (spec.curvePaths) {
			drawWrite(ctx, spec, CURVE_SOURCE, cache, paints, (rings, opacity) =>
				fillCurvePaths(ctx, rings, style, opacity, paints),
			);
		} else {
			drawWrite(ctx, spec, POLYLINE_SOURCE, cache, paints, (rings, opacity) =>
				fillRings(ctx, rings, style, opacity, paints),
			);
		}
		return;
	}

	if (paintsFill(style.fill) && spec.closed) {
		// The fill comes up with the reveal, so `draw` on a filled shape reads
		// as one gesture rather than a block appearing under a growing line.
		// Resolved here rather than through `POLYLINE_SOURCE`/`CURVE_SOURCE` below:
		// a fill needs only the raw rings and the matching paint function, never
		// an arc-length table, so a shape that only fills (`style.stroke ===
		// "none"`) should not pay for a `measure`/`measureCurve` pass — the same
		// laziness the pre-collapse code got from checking `stroke === "none"`
		// before ever calling `revealFor`.
		// The fill ignores the stroke reveal, so its `Path2D` (where there is
		// one) is built once per geometry array, like the stroke's.
		// With a cached `Path2D` the rings are never traced, so they are only
		// sliced (an allocation per frame) when there is no path to fill.
		if (spec.curvePaths) {
			const path = curvesPath2D(spec.curvePaths, spec.fillFrom);
			fillCurvePaths(
				ctx,
				path || spec.fillFrom <= 0
					? spec.curvePaths
					: spec.curvePaths.slice(spec.fillFrom),
				style,
				style.fillOpacity * spec.progress,
				paints,
				path,
			);
		} else {
			const path = ringsPath2D(spec.polylines, spec.fillFrom);
			fillRings(
				ctx,
				path || spec.fillFrom <= 0
					? spec.polylines
					: spec.polylines.slice(spec.fillFrom),
				style,
				style.fillOpacity * spec.progress,
				paints,
				path,
			);
		}
	}

	if (style.stroke === "none" || style.strokeWidth <= 0 || style.opacity <= 0) {
		return;
	}

	ctx.save();
	applyStrokeStyle(ctx, style, paints);

	// The one remaining representation branch in `drawShape`: which concrete
	// `GeometrySource` `drawStroke` runs against. Along-stroke and plain
	// stroke both run through `drawStroke`, so this is the one call site that
	// has to know the two representations exist at all.
	if (spec.curvePaths) drawStroke(ctx, spec, CURVE_SOURCE, cache);
	else drawStroke(ctx, spec, POLYLINE_SOURCE, cache);

	ctx.restore();
}

/**
 * Options for {@link paintSpecs}.
 *
 * @category Renderer & paint
 */
export interface PaintSpecsOptions {
	/** The device-pixel rectangle being painted; specs wholly outside it are skipped. */
	viewport?: DeviceRect;
	/** First index of `specs` to paint. @default 0 */
	from?: number;
	/** One past the last index of `specs` to paint. Defaults to `specs.length`. */
	to?: number;
}

/**
 * Paints a z-sorted frame of specs: the execution half of the pipeline, usable
 * without a renderer (tests, other backends). The caller must already have set
 * `view` as the context transform; it is passed again for text, which is drawn
 * upright in pixels. Honours each spec's `clip`. Doesn't clear or fill a
 * background; restores context state on return.
 *
 * @param ctx - The canvas context to draw on, with `view` already set.
 * @param specs - The frame's specs, already z-sorted (see `compileFrame`).
 * @param cache - Per-node arc-length tables for partial reveals; keep it between calls.
 * @param paints - Gradient cache; keep it between calls.
 * @param view - The scene to device-pixel matrix in force. Defaults to the identity.
 * @param options - `viewport`: the device-pixel rectangle being painted; specs
 *   entirely outside it are skipped (omitted: nothing is culled). `from`/`to`:
 *   the slice of `specs` to paint, for layering one frame over a cached prefix.
 *
 * @category Renderer & paint
 */
export function paintSpecs(
	ctx: CanvasRenderingContext2D,
	specs: readonly DrawSpec[],
	cache: Map<number, RevealCache>,
	paints: PaintCache,
	view: Matrix = IDENTITY,
	options: PaintSpecsOptions = {},
): void {
	const visible = options.viewport ? visibleBox(view, options.viewport) : null;
	const end = Math.min(specs.length, options.to ?? specs.length);
	// The clip in force, installed once for a run of consecutive specs that
	// carry the same list: every node under one `<Group clip>` shares its
	// array by identity, so a clipped chart of a thousand marks is one
	// save/clip/restore, not a thousand.
	let active: readonly ClipRegion[] | undefined;
	for (let index = options.from ?? 0; index < end; index++) {
		const spec = specs[index];
		if (visible && !mayBeVisible(spec, visible)) continue;
		const clip = spec.clip && spec.clip.length > 0 ? spec.clip : undefined;
		if (clip !== active) {
			if (active) ctx.restore();
			active = clip;
			if (clip) {
				ctx.save();
				applyClip(ctx, clip);
			}
		}
		switch (spec.kind) {
			case "shape":
				drawShape(ctx, spec, cache, paints, view);
				break;
			case "text":
				drawText(ctx, spec, view);
				break;
			case "marks":
				if (!options.viewport || !splatMarks(ctx, spec, view, options.viewport))
					drawMarks(ctx, spec, paints, visible);
				break;
			case "image":
				drawImageSpec(ctx, spec);
				break;
		}
	}
	if (active) ctx.restore();
}

/**
 * Narrows the context's clip to every region in `clip`, one `clip()` per
 * region — Canvas2D intersects successive clips, which is exactly the
 * nesting rule. Traced in scene units under the view transform already in
 * force, so the clip lands in the same place as the geometry it cuts; the
 * canvas keeps it in device space, so `drawText`'s own `setTransform` does
 * not move it. Non-zero winding, like fills and picking.
 */
function applyClip(
	ctx: CanvasRenderingContext2D,
	clip: readonly ClipRegion[],
): void {
	for (const region of clip) {
		ctx.beginPath();
		for (const ring of region.rings) {
			if (ring.length === 0) continue;
			ctx.moveTo(ring[0].x, ring[0].y);
			for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
			ctx.closePath();
		}
		ctx.clip();
	}
}

/**
 * Draws one text run upright, in pixels, at the view-mapped anchor (a y-up view
 * would otherwise mirror glyphs); size and letter spacing are scaled by the
 * view.
 */
function drawText(
	ctx: CanvasRenderingContext2D,
	spec: TextSpec,
	view: Matrix,
): void {
	const { style } = spec;
	const scale = scaleFactorOf(view);
	if (!(scale > 0)) return;
	ctx.save();

	const anchor = applyToPoint(view, spec.at);
	const rotation = textRotation(view, spec.rotation);
	let at = anchor;
	if (rotation) {
		const cos = Math.cos(rotation);
		const sin = Math.sin(rotation);
		ctx.setTransform(cos, sin, -sin, cos, anchor.x, anchor.y);
		at = { x: 0, y: 0 };
	} else {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
	}

	// All font state is set before anything is measured: `measureText` reports
	// the width under the *current* font, letter spacing and alignment, so
	// measuring first would clip the wrong box for spaced or non-left text.
	ctx.font = fontString(style, scale);
	ctx.textAlign = style.align;
	ctx.textBaseline = style.baseline;
	ctx.fillStyle = style.fill;
	ctx.globalAlpha = style.opacity;
	if (style.letterSpacing) {
		ctx.letterSpacing = `${style.letterSpacing * scale}px`;
	}

	// A halo is stroked first, under the fill, so it widens the glyphs only
	// outward: the text stays its own weight over a knocked-out background.
	const halo = style.halo;
	const paint = () => {
		if (halo && halo.width > 0) {
			ctx.strokeStyle = halo.color;
			ctx.lineWidth = halo.width * scale;
			ctx.lineJoin = "round";
			ctx.strokeText(spec.text, at.x, at.y);
		}
		ctx.fillText(spec.text, at.x, at.y);
	};

	if (spec.progress >= 1) {
		paint();
		ctx.restore();
		return;
	}
	// Nothing of the text is revealed yet.
	if (!(spec.progress > 0)) {
		ctx.restore();
		return;
	}
	// Canvas2D can't trim a glyph outline, so the text is written on glyph by
	// glyph in the reading direction: those already written whole, the one
	// being written faded in whole, in its own clip. A clip edge cut through a
	// glyph would read as another letter ("h" as "l", "30" as "3").
	const width = ctx.measureText(spec.text).width;
	const height = style.fontSize * scale * 2;
	const left =
		style.align === "center"
			? at.x - width / 2
			: style.align === "right" || style.align === "end"
				? at.x - width
				: at.x;
	const glyphs = Array.from(spec.text);
	const reached = width * spec.progress;
	let done = 0;
	let edge = 0;
	for (let i = 1; i <= glyphs.length; i++) {
		const next = ctx.measureText(glyphs.slice(0, i).join("")).width;
		if (next > reached) {
			edge = next;
			break;
		}
		done = next;
		edge = next;
	}
	const clipped = (from: number, to: number, alpha: number) => {
		if (!(to > from) || !(alpha > 0)) return;
		ctx.save();
		ctx.globalAlpha = style.opacity * alpha;
		ctx.beginPath();
		ctx.rect(left + from, at.y - height, to - from, height * 2);
		ctx.clip();
		paint();
		ctx.restore();
	};
	clipped(0, done, 1);
	clipped(done, edge, (reached - done) / (edge - done));
	ctx.restore();
}

/**
 * Creates the Canvas2D renderer for a scene. It holds state handed to it
 * through setters and paints when `paint()` is called; see {@link Renderer}.
 * Throws if the canvas has no 2D context.
 *
 * @param options - See {@link RendererOptions}.
 * @returns A {@link Renderer}.
 *
 * @example
 * ```ts
 * import { createCanvasRenderer } from "@sophistry/core/internal";
 * import { resolveTheme } from "@sophistry/core/themes";
 *
 * const canvas = document.createElement("canvas");
 * canvas.width = 800;
 * canvas.height = 450;
 * const renderer = createCanvasRenderer({ canvas, theme: resolveTheme() });
 * renderer.setFrame([]);
 * renderer.paint();
 * ```
 *
 * @category Renderer & paint
 */
export function createCanvasRenderer(options: RendererOptions): Renderer {
	const ctx = options.canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D context unavailable.");

	const cache = new Map<number, RevealCache>();
	const paints = createPaintCache();
	let currentSpecs: readonly DrawSpec[] = [];
	let currentTheme = options.theme ?? resolveTheme();
	let currentBackground: string | null | undefined;
	let currentSize = options.size ?? {
		width: options.canvas.width ?? 0,
		height: options.canvas.height ?? 0,
	};
	let currentCameras: readonly CameraView[] = [];
	let currentView: Matrix = IDENTITY;
	let currentDpr = 1;
	let currentFocus: readonly number[] | null = null;
	let currentItem: { id: number; item: number } | null = null;
	let hidden = false;
	let disposed = false;
	/** Something changed since the last paint (starts true: nothing is painted yet). */
	let dirty = true;

	/**
	 * A running dissolve: the frame being faded out, and when it started.
	 * `surface` is kept between dissolves so a burst of jumps reuses it.
	 */
	let fading: {
		start: number;
		duration: number;
		width: number;
		height: number;
	} | null = null;
	let surface: HTMLCanvasElement | null = null;
	const clockNow = () =>
		typeof performance !== "undefined" ? performance.now() : Date.now();

	/**
	 * The focus ring, in **CSS pixels**.
	 *
	 * Its width and its gap are chrome, so they do not scale with the camera's
	 * zoom — the same argument the camera border makes, and the same reason a
	 * ring drawn in scene units would be a hairline in a zoomed-out pane and a
	 * slab in a magnified inset. The box comes in scene units, so the *position*
	 * goes through the view matrix and only the weight is held back.
	 */
	/**
	 * The focused nodes' union box in scene units, measured once per paint per
	 * view from the frame about to be painted — so a ring can never lag the
	 * geometry it wraps. `yUp` is the view's, which only a text run's box
	 * depends on.
	 */
	const focusBox = (yUp: boolean): Bounds | null => {
		if (!currentFocus) return null;
		const item = currentItem;
		if (item && currentFocus.includes(item.id)) {
			const spec = currentSpecs.find((own) => own.id === item.id);
			const box = spec ? itemBox(spec, item.item) : null;
			if (box) return box;
		}
		return boundsOfNodes(currentFocus, currentSpecs, yUp);
	};

	const paintFocusRing = (m: Matrix, box: Bounds | null) => {
		if (!box) return;
		const a = applyToPoint(m, { x: box.minX, y: box.minY });
		const b = applyToPoint(m, { x: box.maxX, y: box.maxY });
		const width = 2 * currentDpr;
		const gap = 3 * currentDpr;
		const left = Math.min(a.x, b.x) - gap;
		const top = Math.min(a.y, b.y) - gap;
		const w = Math.abs(b.x - a.x) + gap * 2;
		const h = Math.abs(b.y - a.y) + gap * 2;

		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
		ctx.lineWidth = width;
		ctx.strokeStyle = currentTheme.palette.accent;
		ctx.strokeRect(left, top, w, h);
		ctx.restore();
	};

	/**
	 * The frame, under `view`: the matrix is installed here (scene units →
	 * device pixels) and the same specs are drawn through it.
	 */
	const drawSnapshot = (view: Matrix, viewport: DeviceRect) => {
		ctx.setTransform(view.a, view.b, view.c, view.d, view.e, view.f);
		paintSpecs(ctx, currentSpecs, cache, paints, view, { viewport });
	};

	/**
	 * One camera's pass over the shared frame.
	 *
	 * Specs are in scene units, so painting them into this camera's viewport is
	 * just installing the camera's own view matrix and drawing. Stroke widths
	 * and font sizes ride along inside that transform, which is the point: a
	 * camera at twice the zoom draws twice as thick a line, the way a magnifying
	 * glass does, rather than a hairline over enormous geometry.
	 */
	const paintCamera = (view: CameraView, width: number, height: number) => {
		const size = { width, height };
		const box = viewportBox(view.viewport, size);
		if (box.width <= 0 || box.height <= 0) return;

		const m = cameraMatrix(view, size);

		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.beginPath();
		ctx.rect(box.x, box.y, box.width, box.height);
		ctx.clip();
		if (view.background) {
			ctx.fillStyle = view.background;
			ctx.fillRect(box.x, box.y, box.width, box.height);
		}
		drawSnapshot(m, box);
		// Inside the clip: a focused node half outside this pane gets half a ring
		// rather than one drawn across its neighbour. It is painted in *every*
		// camera that shows the node, because it is focused in each of them — the
		// mirror element has to choose one pane, but the ring is only a picture.
		paintFocusRing(m, focusBox(view.yUp));
		ctx.restore();

		// The border is drawn after the clip is released and inset by half its
		// own width, so it reads as the full weight asked for rather than the
		// half of it that would fall inside the viewport.
		if (view.border && view.borderWidth > 0) {
			const w = view.borderWidth * currentDpr;
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.lineWidth = w;
			ctx.strokeStyle = view.border;
			ctx.strokeRect(
				box.x + w / 2,
				box.y + w / 2,
				Math.max(0, box.width - w),
				Math.max(0, box.height - w),
			);
			ctx.restore();
		}
	};

	const paint = () => {
		dirty = false;
		if (hidden || disposed) return;
		const { width, height } = currentSize;
		if (width === 0 || height === 0) return;

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalAlpha = 1;
		ctx.setLineDash([]);
		const fill =
			currentBackground === undefined
				? currentTheme.palette.background
				: currentBackground;
		const background = (target: CanvasRenderingContext2D) => {
			target.setTransform(1, 0, 0, 1, 0, 0);
			target.clearRect(0, 0, width, height);
			if (fill) {
				target.fillStyle = fill;
				target.fillRect(0, 0, width, height);
			}
		};

		if (currentCameras.length === 0) {
			// The single-view path reuses bitmaps between frames where the
			// picture allows (see `layer-cache.ts`); several cameras paint the
			// one frame several ways, so they always paint in full.
			const viewport = { x: 0, y: 0, width, height };
			const specs = currentSpecs;
			layers.paint(ctx, {
				specs,
				view: currentView,
				width,
				height,
				key: [currentTheme, fill],
				background,
				draw: (target, from, to) =>
					paintSpecs(target, specs, cache, paints, currentView, {
						viewport,
						from,
						to,
					}),
			});
			paintFocusRing(currentView, focusBox(isYUp(currentView)));
		} else {
			background(ctx);
			for (const view of currentCameras) paintCamera(view, width, height);
		}
		paintDissolve(width, height);
	};

	/** Lays the frame being dissolved over the one just painted, and keeps frames coming until it is gone. */
	const paintDissolve = (width: number, height: number) => {
		if (!fading || !surface) return;
		const elapsed = (clockNow() - fading.start) / 1000;
		const left = 1 - elapsed / fading.duration;
		if (left <= 0 || fading.width !== width || fading.height !== height) {
			fading = null;
			return;
		}
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalAlpha = left;
		ctx.drawImage(surface, 0, 0);
		ctx.restore();
		// Another paint next frame, at a lower opacity (see `onPaintRequest`:
		// a request from inside `paint()` lands in the next frame).
		schedule();
	};

	const dissolve = (duration: number) => {
		if (hidden || disposed || !(duration > 0)) return;
		const { width, height } = currentSize;
		if (width === 0 || height === 0) return;
		if (fading && clockNow() - fading.start < fading.duration * 1000) return;
		if (!surface) {
			const doc = options.canvas.ownerDocument;
			surface = doc ? doc.createElement("canvas") : null;
		}
		const copy = surface?.getContext("2d");
		if (!surface || !copy) return;
		if (surface.width !== width) surface.width = width;
		if (surface.height !== height) surface.height = height;
		copy.setTransform(1, 0, 0, 1, 0, 0);
		copy.clearRect(0, 0, width, height);
		copy.drawImage(options.canvas, 0, 0);
		fading = { start: clockNow(), duration, width, height };
		schedule();
	};

	/** Marks the renderer dirty and asks the host for a paint. */
	const schedule = () => {
		if (disposed) return;
		dirty = true;
		if (hidden) return;
		options.onPaintRequest?.();
	};

	const layers = createLayerCache({
		surface: (width, height) => {
			const doc = options.canvas.ownerDocument;
			const canvas = doc?.createElement?.("canvas");
			const target = canvas?.getContext("2d");
			if (!canvas || !target) return null;
			canvas.width = width;
			canvas.height = height;
			return { canvas, ctx: target };
		},
		repaint: schedule,
	});

	return {
		setFrame(specs, frameOptions = {}) {
			if (specs === currentSpecs) return;
			currentSpecs = specs;
			// Drop reveal tables of nodes that left the scene. Only a membership
			// change can strand one (a patch swaps specs of nodes already present),
			// so the scene-sized set is not built on ordinary animation frames.
			if (frameOptions.membershipChanged ?? true) {
				const live = new Set(specs.map((spec) => spec.id));
				for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
			}
			schedule();
		},
		setTheme(theme) {
			if (theme === currentTheme) return;
			currentTheme = theme;
			schedule();
		},
		setBackground(background) {
			if (background === currentBackground) return;
			currentBackground = background;
			schedule();
		},
		setSize(size) {
			if (
				size.width === currentSize.width &&
				size.height === currentSize.height
			)
				return;
			currentSize = { width: size.width, height: size.height };
			schedule();
		},
		setCanonicalView(view) {
			if (view === currentView) return;
			currentView = view;
			schedule();
		},
		setCameras(views) {
			if (views === currentCameras) return;
			currentCameras = views;
			schedule();
		},
		setDpr(dpr) {
			if (dpr === currentDpr) return;
			currentDpr = dpr;
			schedule();
		},
		setFocus(ids) {
			if (ids === currentFocus) return;
			currentFocus = ids;
			schedule();
		},
		setFocusItem(item) {
			if (
				item === currentItem ||
				(item &&
					currentItem &&
					item.id === currentItem.id &&
					item.item === currentItem.item)
			)
				return;
			currentItem = item;
			schedule();
		},
		// A forced repaint (a web font arriving, say) can change pixels no spec
		// changed for, so it starts from nothing.
		invalidate() {
			layers.reset();
			schedule();
		},
		setVisible(visible) {
			if (hidden === !visible) return;
			hidden = !visible;
			// Whatever changed while hidden was never drawn, so showing is a repaint.
			if (visible) schedule();
			else fading = null;
		},
		dissolve,
		snapshot: () => currentSpecs,
		needsPaint: () => dirty && !hidden && !disposed,
		paint,
		dispose() {
			disposed = true;
			dirty = false;
			fading = null;
			surface = null;
			cache.clear();
			layers.reset();
		},
	};
}
