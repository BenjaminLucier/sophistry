/**
 * What the scene tree hands to the renderer: plain, serializable specs in scene
 * units, with every enclosing transform and theme default already applied, but
 * no camera, canvas size or dpr. The renderer applies those with one
 * `setTransform` per camera, so view changes never rebuild a spec.
 */

import type { Bounds, CurvePath, Point, Polyline } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";

/**
 * One colour at one position along a gradient, `offset` in 0..1.
 *
 * `color` stays a CSS string rather than `../color`'s `Color` deliberately:
 * this type is the *resolved* form `render/paint.ts` hands straight to
 * `CanvasGradient.addColorStop`, which wants a string, and `render/` belongs
 * to another agent — churning this into `Color` would ripple into a file
 * this change is not supposed to touch. `linearGradient`/`radialGradient`
 * in `gradient.ts` already accept `string[]` for their stop colours, so an
 * author who wants to build one from `Color` objects today calls `toCss`
 * first (`linearGradient([toCss(a), toCss(b)])`). The intended
 * follow-up, once `render/paint.ts` is free to change: let `color` accept
 * `ColorInput` here and move the `toCss` call to where the `CanvasGradient`
 * is actually built, so a gradient authored from `Color` constants doesn't
 * round-trip through a string it never needed to be.
 *
 * @category Scene registry & specs
 */
export interface GradientStop {
	/** Position along the gradient, 0..1. */
	offset: number;
	/** CSS colour string. */
	color: string;
}

/**
 * A gradient with both endpoints already in **scene units**.
 *
 * The conversion from the authored descriptor (bounding-box fractions or
 * absolute scene units) happens in `scene/`, like every other unit conversion.
 * A `CanvasGradient`'s coordinates live in the user space in force when it is
 * *painted*, so a gradient in scene units rides the camera's view matrix
 * exactly as the geometry beside it does. One gradient object, N cameras, no
 * per-camera spec pass.
 *
 * @category Scene registry & specs
 */
export interface LinearGradientPaint {
	kind: "linear";
	/** Start point in scene units. */
	from: Point;
	/** End point in scene units. */
	to: Point;
	stops: GradientStop[];
}

/**
 * A radial gradient between two circles, with everything already in scene units.
 *
 * @category Scene registry & specs
 */
export interface RadialGradientPaint {
	kind: "radial";
	/** Centre of the inner circle in scene units. */
	from: Point;
	/** In scene units. */
	fromRadius: number;
	/** Centre of the outer circle in scene units. */
	to: Point;
	/** Radius of the outer circle in scene units. */
	toRadius: number;
	stops: GradientStop[];
}

/**
 * What a fill or a stroke is painted with: a CSS colour, or a gradient.
 *
 * A plain string stays the whole of the common case — nothing in the renderer
 * or in a call site has to know gradients exist until one is used.
 *
 * @category Scene registry & specs
 */
export type Paint = string | LinearGradientPaint | RadialGradientPaint;

/**
 * Colour that varies along the shape's arc length, one entry per equal-length
 * segment of the curve.
 *
 * This is the honest half of "gradient along a curve". Canvas2D cannot vary a
 * stroke's colour within a single `stroke()` call — `strokeStyle` is one value
 * for the whole path — so the only way to follow a curve's *arc length* is to
 * cut the flattened polyline into pieces and stroke each with its own colour.
 * That costs one `stroke()` per colour per polyline and quantises the ramp into
 * `colors.length` bands, where a `Paint` gradient is continuous but follows a
 * straight axis across the shape's extent rather than the curve. Both ship,
 * because they are answers to different questions; see `ShapeProps.strokeAlong`.
 *
 * @category Scene registry & specs
 */
export interface AlongStroke {
	/** CSS colours, spent in order along the curve. */
	colors: string[];
	/**
	 * `"shape"` spends the colour list across every polyline in order, the way
	 * the reveal budget is spent; `"polyline"` restarts it on each one, which is
	 * what a node holding many independent curves wants.
	 */
	scope: "shape" | "polyline";
}

/**
 * A shape's fully resolved paint, as the renderer consumes it. Lengths are
 * scene units; the canvas scales them with the view transform it paints under
 * (exact for the similarity transforms a camera is).
 *
 * @category Scene registry & specs
 */
export interface StrokeStyle {
	stroke: Paint;
	/** In scene units — enclosing groups' scale (or the pinned pen) already applied. */
	strokeWidth: number;
	/** Interior paint, or `null` for no fill. */
	fill: Paint | null;
	/** Per-segment stroke colour along the curve; overrides `stroke` when set. */
	along: AlongStroke | null;
	/** 0..1, already multiplied by the enclosing groups' opacity. */
	opacity: number;
	/** 0..1, on top of `opacity`. */
	fillOpacity: number;
	lineCap: CanvasLineCap;
	lineJoin: CanvasLineJoin;
	/** Dash pattern in scene units, or `null` for a solid stroke. */
	dash: number[] | null;
	/** In scene units. */
	dashOffset: number;
}

/**
 * A label's fully resolved text style, in scene units, as the renderer consumes it.
 *
 * @category Scene registry & specs
 */
export interface TextStyle {
	fill: string;
	/** In scene units; the renderer multiplies by the view's scale to get pixels. */
	fontSize: number;
	fontFamily: string;
	fontWeight: string | number;
	italic: boolean;
	align: CanvasTextAlign;
	baseline: CanvasTextBaseline;
	opacity: number;
	/** Extra letter spacing in scene units. */
	letterSpacing: number;
	/**
	 * An outline stroked around the glyphs before they are filled (a halo):
	 * its colour, and its full stroke width in scene units, so it reaches
	 * `width / 2` past the glyphs' edges. Omitted, none.
	 */
	halo?: { color: string; width: number };
}

/**
 * A region a node is painted through, in **scene units**: closed rings under
 * the non-zero winding rule (the canvas default, and so the same rule fills
 * and picking use). Only what falls inside is painted or hit.
 *
 * A spec carries a *list* of these (`ShapeSpec.clip`), one per clipping
 * ancestor, and is painted through their intersection — so a `<Group clip>`
 * nested inside another clips to the overlap of both, the way nested
 * `overflow: hidden` boxes do.
 *
 * Built by `<Group clip>` (`clipRegion` in `scene/core/clip.ts`) and handed down
 * through `SceneSpaceValue.clip`, so every node under one group shares the
 * same array: the renderer installs a clip once for a run of consecutive
 * specs carrying the same list (an identity compare, like the reveal cache).
 *
 * @category Scene registry & specs
 */
export interface ClipRegion {
	/** Closed rings in scene units; a point is inside when their winding number is non-zero. */
	rings: Polyline[];
}

/**
 * Resolved, scene-space draw instruction for one shape node.
 *
 * @category Scene registry & specs
 */
export interface ShapeSpec {
	kind: "shape";
	id: number;
	/** Paint order; higher draws later. Ties paint in tree order (see `compileFrame`). */
	zIndex: number;
	/**
	 * Flattened, drawable points in scene units — always populated. Hand-authored by the
	 * producer's `ShapeGeometry`, or derived from `curvePaths` when the producer
	 * only gave that; either way this field itself never has to know which.
	 */
	polylines: Polyline[];
	/** Whether the outline closes back on itself (and so can be filled). */
	closed: boolean;
	/** Index of the first polyline that takes part in the fill — see `ShapeGeometry`. */
	fillFrom: number;
	/** A Manim-style write reveal, resolved (see `ShapeWrite`); absent for an ordinary trace. */
	write?: {
		/** Index of each piece's first polyline, ascending. */
		pieces: number[];
		lagRatio: number;
		/** In scene units. */
		outlineWidth: number;
	};
	/**
	 * Native curve geometry (scene units), parallel to `polylines` — same subpath count and
	 * order, one `CurvePath` per polyline — for a shape whose producer chose to
	 * hand over unflattened control points instead of (or alongside) the
	 * flattened run. Optional and additive: the renderer falls back to
	 * `polylines` whenever it is absent. A growing set of producers populate it
	 * now (lines, rects, polygons, circles, arcs, béziers, ...); the long-term
	 * direction is for this to be the primary representation and `polylines` to
	 * become a derived fallback rather than something every producer maintains.
	 */
	curvePaths?: CurvePath[];
	/**
	 * The same outline in the shape's own units, with the matrix that places it:
	 * what the renderer actually draws, under `transform`, when present.
	 *
	 * A node that moves, turns or scales — or whose `<Group>` does — changes
	 * only `transform`. Its outline arrays keep their identity, so the cached
	 * `Path2D`, curves and arc-length tables are reused, and nothing is
	 * re-tessellated or re-transformed. `polylines` and `curvePaths` above stay
	 * the scene-unit outline for everything that reads geometry (hit testing,
	 * bounds); on such a spec they are derived from these on first read.
	 *
	 * Only a similarity (rotation, uniform scale, reflection and translation)
	 * is carried this way, since drawing under any other matrix would distort
	 * stroke widths; a shape under a skew or non-uniform scale is baked into
	 * scene units and has no `local`. Gradient endpoints in `style` are in
	 * these local units when `local` is present; lengths (`strokeWidth`,
	 * `dash`, a write's `outlineWidth`) stay in scene units.
	 */
	local?: {
		polylines: Polyline[];
		curvePaths?: CurvePath[];
		/** Local units → scene units. */
		transform: Matrix;
	};
	style: StrokeStyle;
	/** Arc-length reveal, 0..1. */
	progress: number;
	/**
	 * Clip regions from the enclosing `<Group clip>`s, intersected; absent when
	 * nothing clips the node. See {@link ClipRegion}.
	 */
	clip?: readonly ClipRegion[];
}

/**
 * Resolved, scene-space draw instruction for one line of text.
 *
 * Text is the one spec the renderer cannot hand to the canvas under the plain
 * view transform: a y-up view flips the vertical axis, which would paint the
 * glyphs mirrored. The renderer therefore maps `at` through the view matrix
 * itself and draws the glyphs upright in pixels, at `fontSize * viewScale`.
 *
 * @category Scene registry & specs
 */
export interface TextSpec {
	kind: "text";
	id: number;
	/** Paint order; higher draws later. */
	zIndex: number;
	text: string;
	/** Anchor in scene units. */
	at: Point;
	/**
	 * Direction of the baseline in scene space, in radians counter-clockwise in
	 * the scene's own axes (the `rotation` prop, plus any enclosing group's
	 * rotation). The renderer converts it to a canvas angle through the view.
	 */
	rotation: number;
	style: TextStyle;
	/** Left-to-right reveal, 0..1: written glyph by glyph, each glyph fading in whole. */
	progress: number;
	/** Clip regions from the enclosing `<Group clip>`s, as on {@link ShapeSpec.clip}. */
	clip?: readonly ClipRegion[];
}

/**
 * One outline of an `outline` or `paths` {@link MarkShape}, in the item's own
 * units (before {@link MarksSpec.transforms} and {@link MarksSpec.centers}
 * place it).
 *
 * @category Scene registry & specs
 */
export interface MarkOutline {
	/**
	 * The outline flattened. Always present: bounds and picking read it, and
	 * it is what is traced when there are no `curvePaths`.
	 */
	polylines: readonly Polyline[];
	/** Exact curves of the same outline, traced instead of `polylines` when present. */
	curvePaths?: readonly CurvePath[] | null;
	/** Whether the outline is closed: only a closed outline is filled. */
	closed: boolean;
}

/**
 * The outline every item of a {@link MarksSpec} shares.
 *
 * - `circle`: a disc of the item's radius.
 * - `rect`: an axis-aligned box of the item's half-width and half-height.
 * - `polygon`: a closed outline given for a radius of 1, scaled by the item's
 *   radius (a scatter symbol).
 * - `outline`: any outline (open or closed, polylines or curves), shared by
 *   every item and placed per item by {@link MarksSpec.transforms} and
 *   {@link MarksSpec.centers}: what `instances()` emits for a shape whose
 *   outline does not vary per item.
 * - `paths`: one outline per item (`outlines[i]`), placed the same way: a
 *   path batch (pie wedges, ribbons, areas, many line series).
 *
 * For `outline` and `paths`, `extents[i]` is the item's reach: the radius
 * about its centre that holds its whole outline (strokes excluded), read for
 * culling, bounds and coarse picking.
 *
 * @category Scene registry & specs
 */
export type MarkShape =
	| { kind: "circle" }
	| { kind: "rect" }
	| { kind: "polygon"; points: Polyline }
	| ({ kind: "outline" } & MarkOutline)
	| { kind: "paths"; outlines: readonly MarkOutline[] };

/**
 * Many small items of one shape and one stroke style in one node: a dense
 * scatter, a strip of ticks, a grid of cells.
 *
 * One node instead of one per item is what lets a layer of 100k items mount,
 * move and pick in time proportional to the items (with no reactive graph per
 * item): the producer fills typed arrays, the renderer paints them in order and
 * skips the ones off screen, and picking goes through a grid built on demand.
 * Items paint in index order, each filled and then stroked as its own shape
 * would be, so overlapping translucent items blend the way separate nodes do.
 *
 * Every length is in scene units, like a {@link ShapeSpec}'s.
 *
 * @category Scene registry & specs
 */
export interface MarksSpec {
	kind: "marks";
	/** Stable node id. */
	id: number;
	/** Paint order; higher draws later. */
	zIndex: number;
	/** The outline every item has. */
	shape: MarkShape;
	/** How many items; the arrays below hold at least this many. */
	count: number;
	/** Item centres, interleaved: `x0, y0, x1, y1, …`. */
	centers: Float64Array;
	/**
	 * Item sizes: one radius per item for `circle` and `polygon`, a half-width
	 * and half-height per item (interleaved) for `rect`.
	 */
	extents: Float64Array;
	/** Each item's fill, or one fill for all; `"none"` paints no fill. */
	fills: readonly string[] | string;
	/**
	 * Per-item opacity, 0..1, on top of the style's (an entering or leaving
	 * item, a staggered reveal); `null` for all 1.
	 */
	alphas: Float32Array | null;
	/** Stroke and opacity shared by every item; `style.fill` is not read (see `fills`). */
	style: StrokeStyle;
	/** 0..1, scales every item's opacity: the layer's reveal. */
	progress: number;
	/**
	 * The items' union box, strokes excluded, or null when there are none. The
	 * producer knows it for the price of the loop that fills `centers`, and it
	 * lets the renderer skip a layer that is entirely off screen.
	 */
	bounds: Bounds | null;
	/** Clip regions from the enclosing `<Group clip>`s, as on {@link ShapeSpec.clip}. */
	clip?: readonly ClipRegion[];
	/**
	 * `outline` and `paths` only: each item's linear part, four numbers per
	 * item (`a, b, c, d`), so a point `p` of its outline lands at
	 * `(centers[2i] + a·p.x + c·p.y, centers[2i+1] + b·p.x + d·p.y)` in scene
	 * units. Absent or null: the identity. Ignored by the other kinds.
	 */
	transforms?: Float64Array | null;
	/**
	 * Each item's stroke colour, overriding `style.stroke` (whose width, dash
	 * and caps still apply); `"none"` strokes nothing. Absent or null: the
	 * shared stroke. A producer giving it sets `style.stroke` to a colour
	 * other than `"none"` when any item strokes.
	 */
	strokes?: readonly string[] | null;
	/**
	 * Each item's stroke width in scene units, overriding `style.strokeWidth`.
	 * Absent or null: the shared width. A producer giving it sets
	 * `style.strokeWidth` to the widest, so readers that pad by the shared
	 * width (hit pre-tests, bounds) stay conservative.
	 */
	strokeWidths?: Float32Array | null;
	/**
	 * Each item's dash pattern in scene units (null in the list: solid),
	 * overriding `style.dash`; `style.dashOffset` still applies. Absent or
	 * null: the shared dash.
	 */
	dashes?: readonly (readonly number[] | null)[] | null;
	/**
	 * `outline` and `paths` only: each item's arc-length reveal, 0..1, what
	 * a {@link ShapeSpec.progress} is to one shape. A partly revealed item
	 * traces its stroke along its outline (one budget across its subpaths,
	 * spent in order, fading up over its first stroke width of length), and
	 * a closed one fills its whole outline at its fill opacity times its
	 * progress; at 0 it paints nothing. Lengths are measured in the outline's
	 * own units (exact under a similarity `transforms` entry).
	 *
	 * Absent or null: every item fully revealed. Producers give null once
	 * every item is at 1, so a revealed layer paints exactly as one without
	 * reveals (opaque runs, splats). The other kinds ignore it: `instances()`
	 * publishes a circle or rect layer as an `outline` layer while any of its
	 * items is partly revealed.
	 */
	progresses?: Float32Array | null;
	/**
	 * Each item's dash offset in scene units, overriding `style.dashOffset`
	 * (read only where the item has a dash). Absent or null: the shared offset.
	 */
	dashOffsets?: Float32Array | null;
}

/**
 * RGBA pixels, row by row from the top: an `ImageData`'s shape without needing
 * a DOM to build one.
 *
 * @category Scene registry & specs
 */
export interface ImagePixels {
	width: number;
	height: number;
	/** `width * height * 4` bytes, RGBA, unpremultiplied. */
	data: Uint8ClampedArray;
}

/**
 * A raster laid onto the scene: a heatmap or image whose cells are pixels.
 *
 * The pixel grid is mapped by an affine frame, so a y-up stage, an enclosing
 * rotated `<Group>` and a non-square aspect all come for free: pixel corner
 * `(0, 0)` lands at `origin`, the far end of the first row at `origin + xAxis`,
 * the bottom of the first column at `origin + yAxis`. Panning or zooming only
 * changes the transform the bitmap is drawn under; the pixels are uploaded once
 * per `pixels` object (identity, like the `Path2D` cache).
 *
 * @category Scene registry & specs
 */
export interface ImageSpec {
	kind: "image";
	/** Stable node id. */
	id: number;
	/** Paint order; higher draws later. */
	zIndex: number;
	pixels: ImagePixels;
	/** Where pixel corner `(0, 0)` lands, in scene units. */
	origin: Point;
	/** The scene displacement spanning the image's full width. */
	xAxis: Point;
	/** The scene displacement spanning the image's full height. */
	yAxis: Point;
	/** Interpolate between pixels when magnified; `false` keeps crisp cells. */
	smoothing: boolean;
	/** 0..1. */
	opacity: number;
	/** 0..1, scales `opacity`: the layer's reveal. */
	progress: number;
	/** Clip regions from the enclosing `<Group clip>`s, as on {@link ShapeSpec.clip}. */
	clip?: readonly ClipRegion[];
}

/**
 * Anything the renderer can paint: a shape, a line of text, a batch of marks
 * or an image.
 *
 * @category Scene registry & specs
 */
export type DrawSpec = ShapeSpec | TextSpec | MarksSpec | ImageSpec;

/**
 * Something that can say what to draw right now: an id plus a spec reader.
 * What {@link compileFrame} reads; the scene graph's nodes satisfy it.
 *
 * Named `SpecSource` rather than `SceneNode` so it does not collide with the
 * scene graph's node type. Order is the order the sources are handed over in.
 *
 * @category Scene registry & specs
 */
export interface SpecSource {
	id: number;
	/** Returns null when the node is hidden or has nothing to draw. */
	spec: () => DrawSpec | null;
}

/**
 * Whether a style's `fill` paints anything: not `null`, `""` or `"none"`. The
 * renderer and hit testing both ask this, so what is hittable is what is
 * painted. (`"none"` handed to `ctx.fillStyle` is an invalid colour the canvas
 * ignores, so the fill would come out in whatever paint was set last.)
 *
 * @category Renderer & paint
 */
export function paintsFill(
	fill: StrokeStyle["fill"] | undefined,
): fill is NonNullable<StrokeStyle["fill"]> {
	return !!fill && fill !== "none";
}
