/**
 * The bake step: authored geometry to scene-unit spec data. Folds a shape's
 * local transform onto the enclosing `<Group>`/`<LinearTransform>` chain, maps
 * polylines, curves and gradient frames through it, and resolves theme-defaulted
 * stroke and text styles.
 *
 * Results are in scene units, before the camera, so pan, zoom, resize and dpr
 * never rebuild a spec; with an identity matrix `bakePolylines` passes the
 * producer's arrays through. Each function is the body of one of
 * `ShapeNode`'s granular memos (kept separate so an `opacity` edit doesn't
 * retransform geometry); `bake()` composes them non-reactively for tests.
 */

import { cssColor } from "../color/parse.js";
import type { ColorInput } from "../color/types.js";
import type { Bounds, CurvePath, Point, Polyline } from "../geometry/index.js";
import { boundsOf, centerOf, curvePathToPolyline } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import {
	applyToCurvePath,
	applyToPoint,
	applyToPolyline,
	compose,
	fromTranslationRotationScale,
	scaleFactorOf,
	translate,
} from "../geometry/transform.js";
import { writeLagRatio } from "../geometry/write-phase.js";
import type { Theme } from "../themes/types.js";
import type { PaintFrame, PaintSpec } from "./gradient.js";
import { isGradientSpec, resolvePaint } from "./gradient.js";
import { layoutText } from "./text-layout.js";
import type {
	AlongStroke,
	ClipRegion,
	Paint,
	ShapeSpec,
	StrokeStyle,
	TextFragment,
	TextSpec,
	TextStyle,
} from "./types.js";

/**
 * How a many-piece shape reveals under `progress`, the way Manim writes: pieces
 * in order with a lag, each tracing its outline (in the stroke paint, or the
 * fill paint if there is no stroke) and then filling in as the outline thins.
 * At `progress` 1 the shape draws as it would without this.
 *
 * @category Extending
 */
export interface ShapeWrite {
	/** Index of each piece's first polyline, ascending. A glyph with a counter is one piece of two polylines. */
	pieces: number[];
	/** Manim's `lag_ratio`. Defaults to `writeLagRatio(pieces.length)`, `Write`'s own default. */
	lagRatio?: number;
	/** Width of the outline being traced, in the shape's own units (scaled like `strokeWidth`). */
	outlineWidth: number;
}

/**
 * What a shape definition hands `ShapeNode`: untransformed geometry in the
 * shape's own units.
 *
 * @category Extending
 */
export interface ShapeGeometry {
	/**
	 * Flattened, drawable points. Optional when `curvePaths` is given — the
	 * shape node derives it automatically (`curvePathToPolyline`, default
	 * tolerance) for bounds and hit-testing, which is now this field's only
	 * remaining job wherever native curves exist. A producer supplying neither
	 * field is a bug, not a supported state.
	 */
	polylines?: Polyline[];
	/** Whether each polyline is closed back to its start (and so can be filled). */
	closed: boolean;
	/**
	 * Index of the first polyline that takes part in the fill. Defaults to 0.
	 *
	 * A shape is sometimes part outline and part region: an arrow is a shaft
	 * plus a head, and only the head has area. Filling every polyline turns a
	 * *curved* shaft into a crescent, because closing an arc encloses one. The
	 * straight case hid this — a two-point shaft closes to nothing.
	 */
	fillFrom?: number;
	/**
	 * Reveal the shape as Manim's `Write` reveals a group, piece by piece,
	 * instead of tracing one outline. Optional; see {@link ShapeWrite}.
	 */
	write?: ShapeWrite;
	/**
	 * Native curve geometry, parallel to `polylines` — same subpath count and
	 * order — for a shape component that wants the renderer to draw/reveal its
	 * curves natively (`tracePath`) instead of the flattened run. Optional and
	 * unused by every shape component today; see `ShapeSpec.curvePaths`.
	 */
	curvePaths?: CurvePath[];
	/**
	 * Where the outline sits, as a translation applied before the shape's own
	 * transform. Build the outline about the origin and put its position here
	 * (a circle's centre, a rect's), and moving the shape changes a matrix
	 * instead of rebuilding and re-flattening its outline: the arrays keep their
	 * identity, so every cache keyed on them survives the move. Defaults to none.
	 */
	offset?: Point;
}

/** Flattened `curvePaths` arrays, so a curve outline is flattened once however often it is asked for. */
const flattened = new WeakMap<CurvePath[], Polyline[]>();

/**
 * `geometry.polylines` if the producer gave one, else flattened from
 * `curvePaths` at a single sensible default tolerance. `polylines` is purely
 * an internal derived artifact for bounds/hit-testing wherever `curvePaths`
 * exists — rendering reads `curvePaths` natively — so there is no
 * per-producer tolerance to thread through here. A producer that hands over
 * neither field is a bug, not a supported state, hence the throw rather than
 * a quiet `[]`.
 */
export function derivePolylines(geometry: ShapeGeometry): Polyline[] {
	if (geometry.polylines) return geometry.polylines;
	if (!geometry.curvePaths) {
		throw new Error("Geometry needs polylines or curvePaths.");
	}
	return flattenCurves(geometry.curvePaths);
}

/** `curvePaths` flattened at the default tolerance, cached on the array's identity. */
export function flattenCurves(curvePaths: CurvePath[]): Polyline[] {
	let lines = flattened.get(curvePaths);
	if (!lines) {
		lines = curvePaths.map((c) => curvePathToPolyline(c));
		flattened.set(curvePaths, lines);
	}
	return lines;
}

// ---------------------------------------------------------------------------
// Step 1: the local TRS.
// ---------------------------------------------------------------------------

/**
 * The transform-affecting subset of `ShapeProps` — everything `bakeLocalTransform` reads.
 *
 * @category Baking
 */
export interface LocalTransformInput {
	/**
	 * Translation.
	 * @default 0
	 */
	x?: number;
	/**
	 * Translation.
	 * @default 0
	 */
	y?: number;
	/** Radians, anticlockwise (y up). */
	rotation?: number;
	/**
	 * Uniform scale factor.
	 * @default 1
	 */
	scale?: number;
	/** Pivot for rotation and scale. Defaults to the centre of the shape's box. */
	origin?: Point;
}

/**
 * A shape's own translate/rotate/scale, or `null` for the identity (the common,
 * cheap case). `flatPolylines` is a thunk so the default pivot is only measured
 * under rotation or scale.
 *
 * @param input - The shape's `x`/`y`/`rotation`/`scale`/`origin`.
 * @param placeDelta - The resolved `place` offset, added to `x`/`y`.
 * @param flatPolylines - Thunk returning the shape's polylines, called only to find the default pivot.
 * @param offset - The geometry's own `offset` (see `ShapeGeometry`), applied first.
 * @returns The local matrix, or null when it would be the identity.
 *
 * @category Baking
 */
export function bakeLocalTransform(
	input: LocalTransformInput,
	placeDelta: Point,
	flatPolylines: () => Polyline[],
	offset?: Point,
): Matrix | null {
	const { rotation, scale } = input;
	const ox = offset?.x ?? 0;
	const oy = offset?.y ?? 0;
	const x = (input.x ?? 0) + placeDelta.x;
	const y = (input.y ?? 0) + placeDelta.y;
	const scaled = scale !== undefined && scale !== 1;
	if (!rotation && !scaled) {
		// Pure translation: the pivot cancels out of `fromTranslationRotationScale`, so skip the
		// bounds pass that finds it. Exact `x`/`y`, where the pivoted form
		// would round through `(x + o) - o`.
		const tx = x + ox;
		const ty = y + oy;
		return tx || ty ? translate(tx, ty) : null;
	}
	const lines = flatPolylines();
	// The default pivot is the centre of the shape as placed by its offset.
	const center = lines.some((line) => line.length > 0)
		? centerOf(boundsOf(lines))
		: { x: 0, y: 0 };
	const origin = input.origin ?? { x: center.x + ox, y: center.y + oy };
	const trs = fromTranslationRotationScale({
		x,
		y,
		rotation,
		scaleX: scale,
		origin,
	});
	return ox || oy ? compose(trs, translate(ox, oy)) : trs;
}

// ---------------------------------------------------------------------------
// Step 2: fold the local TRS onto the ambient space.
// ---------------------------------------------------------------------------

/**
 * The local-to-scene matrix for a shape's geometry: the space's accumulated
 * `<Group>` matrix with the shape's own transform on top.
 *
 * @param spaceMatrix - The ambient space's accumulated local-to-scene matrix.
 * @param local - The shape's own matrix from {@link bakeLocalTransform}, or null.
 * @returns The combined matrix.
 *
 * @category Baking
 */
export function bakeMatrix(spaceMatrix: Matrix, local: Matrix | null): Matrix {
	return local ? compose(spaceMatrix, local) : spaceMatrix;
}

// ---------------------------------------------------------------------------
// Step 3: geometry — polylines and native curves.
// ---------------------------------------------------------------------------

/** Whether `m` leaves every point where it is. */
function isIdentity(m: Matrix): boolean {
	return (
		m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0
	);
}

/**
 * Whether `m` is a similarity — rotation, uniform scale, reflection and
 * translation, nothing that stretches one direction more than another — so a
 * stroke drawn under it keeps an even width. Within a relative tolerance, so
 * a rotation's rounding does not count as a shear.
 *
 * @category Baking
 */
export function isSimilarity(m: Matrix): boolean {
	const xx = m.a * m.a + m.b * m.b;
	const yy = m.c * m.c + m.d * m.d;
	const xy = m.a * m.c + m.b * m.d;
	const scale = Math.max(xx, yy);
	if (!(scale > 0) || !Number.isFinite(scale)) return false;
	return Math.abs(xx - yy) <= 1e-9 * scale && Math.abs(xy) <= 1e-9 * scale;
}

/**
 * Every polyline vertex mapped through `matrix`. With the identity the input
 * array is returned as is, keeping its identity; treat the result as immutable.
 *
 * @param flatPolylines - Polylines in the shape's local units.
 * @param matrix - The matrix from {@link bakeMatrix}.
 * @returns Polylines in scene units.
 *
 * @category Baking
 */
export function bakePolylines(
	flatPolylines: Polyline[],
	matrix: Matrix,
): Polyline[] {
	if (isIdentity(matrix)) return flatPolylines;
	return flatPolylines.map((line) => applyToPolyline(matrix, line));
}

/**
 * The curve form of {@link bakePolylines}; `undefined` when the shape has no
 * `curvePaths`.
 *
 * @param sourceCurvePaths - Curve paths in the shape's local units, if it has any.
 * @param matrix - The matrix from {@link bakeMatrix}.
 * @returns The curve paths in scene units, or undefined.
 *
 * @category Baking
 */
export function bakeCurvePaths(
	sourceCurvePaths: CurvePath[] | undefined,
	matrix: Matrix,
): CurvePath[] | undefined {
	if (!sourceCurvePaths || isIdentity(matrix)) return sourceCurvePaths;
	return sourceCurvePaths.map((path) => applyToCurvePath(matrix, path));
}

// ---------------------------------------------------------------------------
// Step 4: the gradient paint frame.
// ---------------------------------------------------------------------------

/**
 * The frame a `units: "bbox"` gradient resolves against: the shape's own box
 * plus its full matrix. Build it lazily; measuring is a pass over every point.
 *
 * @param flatPolylines - The shape's polylines in local units; their bounds become the gradient box.
 * @param matrix - The shape's full matrix from {@link bakeMatrix}.
 * @returns A {@link PaintFrame} for `resolvePaint`.
 *
 * @category Baking
 */
export function bakePaintFrame(
	flatPolylines: Polyline[],
	matrix: Matrix,
): PaintFrame {
	return {
		box: boundsOf(flatPolylines),
		toScene: (at) => applyToPoint(matrix, at),
		sceneUnitsPerUnit: scaleFactorOf(matrix),
	};
}

// ---------------------------------------------------------------------------
// Step 5: the style — theme defaults and unit scaling for strokes.
// ---------------------------------------------------------------------------

/**
 * `ShapeProps.strokeAlong` as authored: a colour list (spent across the whole
 * node), or a list with an explicit `scope`. Colours may be strings or `Color`s;
 * baking resolves them to the CSS strings of {@link AlongStroke}.
 *
 * @category Baking
 */
export type StrokeAlongInput = readonly ColorInput[] | AlongStrokeInput;

/**
 * The object form of {@link StrokeAlongInput}.
 *
 * @category Baking
 */
export interface AlongStrokeInput {
	/** Colours, spent in order along the curve. */
	colors: readonly ColorInput[];
	/** See {@link AlongStroke.scope}. */
	scope: AlongStroke["scope"];
}

/**
 * The style-affecting subset of `ShapeProps` — everything `bakeStrokeStyle` reads.
 *
 * @category Baking
 */
export interface StrokeStyleInput {
	/** Outline colour or gradient. Defaults to the theme foreground. */
	stroke?: PaintSpec;
	/** Outline width. Defaults to the theme's stroke width. */
	strokeWidth?: number;
	/** Fill colour or gradient. No fill when omitted. */
	fill?: PaintSpec;
	/** Per-arc-length colours; see `ShapeProps.strokeAlong`. */
	strokeAlong?: StrokeAlongInput;
	/**
	 * Opacity, 0..1.
	 * @default 1
	 */
	opacity?: number;
	/**
	 * Fill opacity, 0..1.
	 * @default 1
	 */
	fillOpacity?: number;
	/** Dash pattern in scene units. */
	dash?: number[];
	/**
	 * Dash offset.
	 * @default 0
	 */
	dashOffset?: number;
	/** Defaults to `"round"`. */
	lineCap?: CanvasLineCap;
	/** Defaults to `"round"`. */
	lineJoin?: CanvasLineJoin;
}

/**
 * Theme-defaulted stroke style, in scene units. `strokeWidth`, `dash` and
 * `dashOffset` are multiplied by `penScale`: normally the groups' scale, or
 * `space.penScale()` where the pen is pinned (`<LinearTransform>`).
 *
 * @param input - Authored style props.
 * @param theme - Supplies default stroke colour and width.
 * @param penScale - Scene units per authored unit, used for widths and dashes.
 * @param spaceOpacity - Opacity inherited from enclosing groups, multiplied into `opacity`.
 * @param paintFrame - Thunk building the gradient frame, called only if a gradient is present.
 * @param lengthScale - The space's `lengthScale`: the theme's default width, a scene value, is divided by it.
 * @returns The scene-space style.
 *
 * @category Baking
 */
export function bakeStrokeStyle(
	input: StrokeStyleInput,
	theme: Theme,
	penScale: number,
	spaceOpacity: number,
	paintFrame: () => PaintFrame,
	lengthScale = 1,
): StrokeStyle {
	let frame: PaintFrame | null = null;
	const resolve = (paint: PaintSpec | undefined): Paint | null => {
		if (paint === undefined) return null;
		if (!isGradientSpec(paint)) return cssColor(paint);
		if (!frame) frame = paintFrame();
		return resolvePaint(paint, frame);
	};

	const along = input.strokeAlong;
	const alongStroke = (): AlongStroke | null => {
		if (!along) return null;
		if (Array.isArray(along))
			return { colors: along.map(cssColor), scope: "shape" };
		const spec = along as AlongStrokeInput;
		return { colors: spec.colors.map(cssColor), scope: spec.scope };
	};
	return {
		stroke: resolve(input.stroke) ?? theme.palette.foreground,
		strokeWidth:
			(input.strokeWidth ?? theme.defaults.strokeWidth / lengthScale) *
			penScale,
		fill: resolve(input.fill),
		along: alongStroke(),
		opacity: (input.opacity ?? 1) * spaceOpacity,
		fillOpacity: input.fillOpacity ?? 1,
		lineCap: input.lineCap ?? "round",
		lineJoin: input.lineJoin ?? "round",
		dash: input.dash ? input.dash.map((d) => d * penScale) : null,
		dashOffset: (input.dashOffset ?? 0) * penScale,
	};
}

// ---------------------------------------------------------------------------
// Step 5, text's sibling.
// ---------------------------------------------------------------------------

/** The font weight text gets when none is given. */
export const DEFAULT_FONT_WEIGHT = 500;

/** A halo's default width, as a fraction of the font size. */
const HALO_WIDTH = 0.25;

/**
 * An outline stroked around a label's glyphs, under their fill: a halo that
 * keeps text readable over a busy background (a heatmap, a map, a dense
 * plot), as matplotlib's `withStroke` path effect and Observable Plot's
 * text `stroke` do.
 *
 * @category Text & numbers
 */
export interface TextHalo {
	/** The halo's colour. Defaults to the theme's background. */
	color?: ColorInput;
	/**
	 * The outline's full stroke width, in scene units (half of it shows past the glyphs). Defaults
	 * to a quarter of the font size.
	 */
	width?: number;
}

/**
 * The style-affecting subset of `<Text>`'s props — everything `bakeTextStyle` reads.
 *
 * @category Baking
 */
export interface TextStyleInput {
	/** Text colour. Defaults to the theme foreground. */
	fill?: ColorInput;
	/** Font size. Defaults to the theme's font size. */
	fontSize?: number;
	/** Defaults to the theme's font family. */
	fontFamily?: string;
	/** Defaults to 500. */
	fontWeight?: string | number;
	/** Defaults to false. */
	italic?: boolean;
	/** Defaults to `"center"`. */
	align?: CanvasTextAlign;
	/** Defaults to `"middle"`. */
	baseline?: CanvasTextBaseline;
	/**
	 * Opacity, 0..1.
	 * @default 1
	 */
	opacity?: number;
	/**
	 * Extra spacing between characters.
	 * @default 0
	 */
	letterSpacing?: number;
	/**
	 * A background-coloured outline: `true` for the defaults, or a {@link TextHalo}. Defaults to
	 * none.
	 */
	halo?: boolean | TextHalo;
}

/**
 * The font subset of a {@link TextStyle} — what the metrics oracle measures
 * with — resolved against the theme by {@link bakeTextFont}.
 *
 * @category Baking
 */
export type TextFont = Pick<
	TextStyle,
	"fontSize" | "fontFamily" | "fontWeight" | "italic" | "letterSpacing"
>;

/**
 * The font half of {@link bakeTextStyle}, for producers that only measure:
 * theme defaults filled in, `fontSize`/`letterSpacing` times `unitScale`.
 *
 * @param input - Authored font, in scene units.
 * @param theme - Supplies the default size and family.
 * @param unitScale - Scene units per authored unit. Defaults to 1.
 * @param lengthScale - The space's `lengthScale`: the theme's default size is divided by it.
 * @returns The resolved font.
 *
 * @category Baking
 */
export function bakeTextFont(
	input: Pick<
		TextStyleInput,
		"fontSize" | "fontFamily" | "fontWeight" | "italic" | "letterSpacing"
	>,
	theme: Theme,
	unitScale = 1,
	lengthScale = 1,
): TextFont {
	return {
		fontSize:
			(input.fontSize ?? theme.defaults.fontSize / lengthScale) * unitScale,
		fontFamily: input.fontFamily ?? theme.defaults.fontFamily,
		fontWeight: input.fontWeight ?? DEFAULT_FONT_WEIGHT,
		italic: input.italic ?? false,
		letterSpacing: (input.letterSpacing ?? 0) * unitScale,
	};
}

/**
 * Theme-defaulted text style in scene units, with `fontSize` and
 * `letterSpacing` multiplied by `unitScale` (the enclosing groups' scale).
 *
 * @param input - Authored text style.
 * @param theme - Supplies default colour, size and font.
 * @param unitScale - Scene units per authored unit.
 * @param spaceOpacity - Opacity inherited from enclosing groups.
 * @param lengthScale - The space's `lengthScale`: the theme's default size is divided by it.
 * @returns The scene-space `TextStyle`.
 *
 * @category Baking
 */
export function bakeTextStyle(
	input: TextStyleInput,
	theme: Theme,
	unitScale: number,
	spaceOpacity: number,
	lengthScale = 1,
): TextStyle {
	const style: TextStyle = {
		fill: cssColor(input.fill ?? theme.palette.foreground),
		...bakeTextFont(input, theme, unitScale, lengthScale),
		align: input.align ?? "center",
		baseline: input.baseline ?? "middle",
		opacity: (input.opacity ?? 1) * spaceOpacity,
	};
	const halo = input.halo;
	if (halo) {
		const own = halo === true ? {} : halo;
		style.halo = {
			color: cssColor(own.color ?? theme.palette.background),
			width:
				(own.width ??
					(input.fontSize ?? theme.defaults.fontSize / lengthScale) *
						HALO_WIDTH) * unitScale,
		};
	}
	return style;
}

/**
 * The angle a matrix sends a baseline direction to. Producers use it with the
 * groups' matrix (so a rotated group turns its text); the renderer uses it with
 * the view matrix.
 *
 * @param matrix - A scene-space or view matrix.
 * @param rotation - Radians, in the matrix's source space. Defaults to 0.
 * @returns The baseline's angle in the matrix's target space, in radians.
 */
export function textRotation(matrix: Matrix, rotation = 0): number {
	const x = Math.cos(rotation);
	const y = Math.sin(rotation);
	const angle = Math.atan2(
		matrix.b * x + matrix.d * y,
		matrix.a * x + matrix.c * y,
	);
	// `|| 0` folds -0 (an identity matrix at rotation 0) to 0.
	return angle || 0;
}

/**
 * One styled run of a text block, its style already baked.
 *
 * @category Baking
 */
export interface TextBlockRun {
	text: string;
	style: TextStyle;
	underline?: boolean;
	strikethrough?: boolean;
	/** A CSS colour behind the run. */
	highlight?: string;
}

/**
 * Lays out runs into a block anchored the way one line of text is: `align`
 * places the block across the anchor (and each line within the block),
 * `baseline` places it vertically, `"alphabetic"` putting the first line's
 * baseline on the anchor.
 *
 * @param runs - The runs, in scene units.
 * @param options - Wrap width (scene units), line height multiple, align and baseline.
 * @returns The fragments and the block's box, relative to the anchor, y up on screen.
 *
 * @category Baking
 */
export function bakeTextBlock(
	runs: readonly TextBlockRun[],
	options: {
		width?: number;
		lineHeight?: number;
		/** Pixels per scene unit, the size the text is measured at. */
		pixelsPerUnit?: number;
		align: CanvasTextAlign;
		/** Where lines sit within the block. Defaults to `align`. */
		textAlign?: CanvasTextAlign;
		baseline: CanvasTextBaseline;
	},
): { fragments: TextFragment[]; box: Bounds } {
	const layout = layoutText(
		runs.map((run) => ({ text: run.text, font: run.style })),
		{
			width: options.width,
			lineHeight: options.lineHeight,
			align: options.textAlign ?? options.align,
			pixelsPerUnit: options.pixelsPerUnit,
		},
	);
	const { width, height } = layout;
	const left =
		options.align === "left" || options.align === "start"
			? 0
			: options.align === "right" || options.align === "end"
				? -width
				: -width / 2;
	let top: number;
	switch (options.baseline) {
		case "top":
		case "hanging":
			top = 0;
			break;
		case "middle":
			top = height / 2;
			break;
		case "bottom":
		case "ideographic":
			top = height;
			break;
		default:
			top = layout.firstBaseline;
	}
	const fragments = layout.fragments.map((laid): TextFragment => {
		const run = runs[laid.run] as TextBlockRun;
		const fragment: TextFragment = {
			text: laid.text,
			offset: { x: left + laid.x, y: top - laid.baseline },
			style: { ...run.style, align: "left", baseline: "alphabetic" },
			width: laid.width,
		};
		if (run.underline) fragment.underline = true;
		if (run.strikethrough) fragment.strikethrough = true;
		if (run.highlight) fragment.highlight = run.highlight;
		return fragment;
	});
	return {
		fragments,
		box: { minX: left, minY: top - height, maxX: left + width, maxY: top },
	};
}

/**
 * Assembles a `TextSpec`, or `null` when there is nothing to draw (empty text,
 * `progress <= 0`). `at` is already in scene units.
 *
 * @param options - Id, text, scene-unit anchor `at`, `rotation` (radians), baked `style`, and optional `zIndex`/`progress`.
 * @returns The spec, or null when there is nothing to draw.
 *
 * @category Baking
 */
export function bakeTextSpec(options: {
	id: number;
	zIndex?: number;
	text: string;
	at: Point;
	/** Radians, in the space of `matrix`. */
	rotation?: number;
	/** The ambient local-to-scene (group chain) matrix; folded into the rotation. Omitted: used as is. */
	matrix?: Matrix;
	style: TextStyle;
	progress?: number;
	/** The enclosing clip regions (`SceneSpaceValue.clip`), if any. */
	clip?: readonly ClipRegion[];
	/** A laid-out block from {@link bakeTextBlock}, for rich or wrapped text. */
	block?: { fragments: readonly TextFragment[]; box: Bounds };
}): TextSpec | null {
	if (!options.text) return null;
	const progress = options.progress ?? 1;
	if (progress <= 0) return null;
	return {
		kind: "text",
		id: options.id,
		zIndex: options.zIndex ?? 0,
		text: options.text,
		at: options.at,
		rotation: options.matrix
			? textRotation(options.matrix, options.rotation)
			: (options.rotation ?? 0),
		style: options.style,
		progress: Math.min(1, progress),
		...(options.clip ? { clip: options.clip } : {}),
		...(options.block
			? { fragments: options.block.fragments, box: options.block.box }
			: {}),
	};
}

// ---------------------------------------------------------------------------
// Step 6: assemble the ShapeSpec.
// ---------------------------------------------------------------------------

/**
 * A shape's {@link ShapeWrite} as the renderer takes it: the lag resolved to
 * its default and the outline width in scene units.
 *
 * @param write - The authored write, if any.
 * @param penScale - What `strokeWidth` is scaled by, so the outline scales with it.
 * @returns The resolved write, or undefined.
 *
 * @category Baking
 */
export function resolveWrite(
	write: ShapeWrite | undefined,
	penScale: number,
): ShapeSpec["write"] {
	if (!write || write.pieces.length === 0) return undefined;
	return {
		pieces: write.pieces,
		lagRatio: write.lagRatio ?? writeLagRatio(write.pieces.length),
		outlineWidth: write.outlineWidth * penScale,
	};
}

/**
 * Pure assembly of the final `ShapeSpec` from already-baked pieces — nothing left to convert.
 *
 * @param options - Id, optional `zIndex` (default 0), baked polylines and style, `closed`, `progress`, and optional `fillFrom`/`write`/`curvePaths`/`clip`.
 * @returns The `ShapeSpec` the renderer paints.
 *
 * @category Baking
 */
export function bakeShapeSpec(options: {
	id: number;
	zIndex?: number;
	polylines: Polyline[];
	closed: boolean;
	fillFrom?: number;
	write?: ShapeSpec["write"];
	curvePaths?: CurvePath[];
	style: StrokeStyle;
	progress: number;
	clip?: readonly ClipRegion[];
	/**
	 * Local geometry and its matrix (see `ShapeSpec.local`). When given,
	 * `polylines` and `curvePaths` are ignored and derived from it on first
	 * read instead.
	 */
	local?: NonNullable<ShapeSpec["local"]>;
}): ShapeSpec {
	if (options.local) return localShapeSpec(options, options.local);
	return {
		kind: "shape",
		id: options.id,
		zIndex: options.zIndex ?? 0,
		polylines: options.polylines,
		closed: options.closed,
		fillFrom: options.fillFrom ?? 0,
		...(options.write ? { write: options.write } : {}),
		...(options.curvePaths ? { curvePaths: options.curvePaths } : {}),
		style: options.style,
		progress: options.progress,
		...(options.clip ? { clip: options.clip } : {}),
	};
}

/**
 * A spec drawn from local geometry: `polylines` and `curvePaths` are getters
 * that bake the outline into scene units the first time something reads them
 * (a hover, a focus ring), once per spec. Most frames read neither, since the
 * renderer draws `local` under its transform.
 */
/**
 * A plain copy of a shape spec with its lazily baked `polylines` and
 * `curvePaths` resolved into own properties, for comparing, logging or
 * serialising specs. (A spec carrying local geometry keeps those two on its
 * prototype, so a spread or `JSON.stringify` would miss them.)
 *
 * @param spec - Any shape spec.
 * @returns An own-property copy; `curvePaths` only when the spec has curves.
 * @category Baking
 */
export function plainShapeSpec(spec: ShapeSpec): ShapeSpec {
	const copy: ShapeSpec = { ...spec, polylines: spec.polylines };
	const curvePaths = spec.curvePaths;
	if (curvePaths) copy.curvePaths = curvePaths;
	return copy;
}

function localShapeSpec(
	options: Parameters<typeof bakeShapeSpec>[0],
	local: NonNullable<ShapeSpec["local"]>,
): ShapeSpec {
	return new LocalShapeSpec(options, local);
}

/**
 * A spec carrying local geometry, with its scene-unit `polylines` and
 * `curvePaths` baked on first read.
 *
 * A class rather than an object literal with getters (plus a
 * `defineProperty` for `curvePaths`): the literal cost a few hundred
 * nanoseconds per spec and left every spec a dictionary-mode object, which
 * then slowed every read the collector and renderer make. Here the getters
 * live on the prototype, so a spec is a plain fast object built once per
 * changed shape per frame. The getters are inherited rather than own
 * properties: read them directly, don't spread or serialise a spec to get
 * them.
 */
class LocalShapeSpec implements ShapeSpec {
	readonly kind = "shape";
	readonly id: number;
	readonly zIndex: number;
	readonly closed: boolean;
	readonly fillFrom: number;
	// `declare`d: an optional class field would otherwise be defined as an
	// own `undefined`, and `"clip" in spec` means "this node is clipped".
	declare readonly write?: ShapeSpec["write"];
	readonly local: NonNullable<ShapeSpec["local"]>;
	readonly style: StrokeStyle;
	readonly progress: number;
	declare readonly clip?: readonly ClipRegion[];
	#polylines: Polyline[] | undefined;
	#curvePaths: CurvePath[] | undefined;

	constructor(
		options: Parameters<typeof bakeShapeSpec>[0],
		local: NonNullable<ShapeSpec["local"]>,
	) {
		this.id = options.id;
		this.zIndex = options.zIndex ?? 0;
		this.closed = options.closed;
		this.fillFrom = options.fillFrom ?? 0;
		this.local = local;
		this.style = options.style;
		this.progress = options.progress;
		// Present only when given, so equality checks see the same keys.
		if (options.write) this.write = options.write;
		if (options.clip) this.clip = options.clip;
	}

	get polylines(): Polyline[] {
		this.#polylines ??= bakePolylines(
			this.local.polylines,
			this.local.transform,
		);
		return this.#polylines;
	}

	get curvePaths(): CurvePath[] | undefined {
		const source = this.local.curvePaths;
		if (!source) return undefined;
		this.#curvePaths ??= bakeCurvePaths(source, this.local.transform);
		return this.#curvePaths;
	}
}

// ---------------------------------------------------------------------------
// The full pipeline, non-reactive.
// ---------------------------------------------------------------------------

/**
 * A snapshot of the ambient space `bake()` needs — the non-reactive counterpart of `SceneSpaceValue`.
 *
 * @category Baking
 */
export interface BakeSpace {
	/** Local units → scene units, accumulated through every enclosing `<Group>`. No camera. */
	matrix: Matrix;
	/** Overrides `scaleFactorOf(matrix)` for stroke/dash conversion — see `SceneSpaceValue.penScale`. */
	penScale?: number;
	/** Opacity inherited from enclosing groups, 0..1. */
	opacity: number;
	/** Clip regions from enclosing `<Group clip>`s, in scene units. Omitted: none. */
	clip?: readonly ClipRegion[];
}

/**
 * The transform inputs to {@link bake}: a shape's local TRS plus a resolved `place` offset.
 *
 * @category Baking
 */
export interface BakeTransform {
	/** Translation in scene units. */
	x?: number;
	/** Translation in scene units. */
	y?: number;
	/** Radians, anticlockwise (y up). */
	rotation?: number;
	/** Uniform scale factor. */
	scale?: number;
	/** Pivot. Defaults to the centre of the shape's box. */
	origin?: Point;
	/** A resolved `Placement` delta (`readDelta(props.place)`), already unwrapped — `bake()` takes no `Placement` itself, since unwrapping one is the job via `scene/core/internal.ts`. */
	place?: Point;
}

/**
 * The whole bake pipeline, composed and run once without reactivity:
 * `bakeLocalTransform`, `bakeMatrix`, `bakePolylines`/`bakeCurvePaths`,
 * `bakeStrokeStyle`, `bakeShapeSpec`. `ShapeNode` runs the same steps as
 * separate memos; this is for tests and non-reactive producers.
 *
 * @param geometry - Shape geometry.
 * @param space - The ambient transform and opacity; see {@link BakeSpace}.
 * @param style - Authored stroke and fill style.
 * @param theme - Supplies style defaults.
 * @param options - Node `id`, `zIndex`, `progress` (0..1, default 1), `visible`, and the local transform.
 * @returns The scene-space spec, or null when hidden or fully unrevealed with no fill.
 *
 * @category Baking
 */
export function bake(
	geometry: ShapeGeometry,
	space: BakeSpace,
	style: StrokeStyleInput,
	theme: Theme,
	options: {
		id: number;
		zIndex?: number;
		progress?: number;
		visible?: boolean;
	} & BakeTransform,
): ShapeSpec | null {
	if (options.visible === false) return null;

	const flat = derivePolylines(geometry);
	const placeDelta = options.place ?? { x: 0, y: 0 };
	const local = bakeLocalTransform(
		{
			x: options.x,
			y: options.y,
			rotation: options.rotation,
			scale: options.scale,
			origin: options.origin,
		},
		placeDelta,
		() => flat,
	);
	const matrix = bakeMatrix(space.matrix, local);
	const polylines = bakePolylines(flat, matrix);
	const curvePaths = bakeCurvePaths(geometry.curvePaths, matrix);
	const penScale = space.penScale ?? scaleFactorOf(matrix);
	const resolvedStyle = bakeStrokeStyle(
		style,
		theme,
		penScale,
		space.opacity,
		() => bakePaintFrame(flat, matrix),
	);

	const progress = options.progress ?? 1;
	if (progress <= 0 && (resolvedStyle.fillOpacity <= 0 || !resolvedStyle.fill))
		return null;

	return bakeShapeSpec({
		id: options.id,
		zIndex: options.zIndex,
		polylines,
		closed: geometry.closed,
		fillFrom: geometry.fillFrom,
		write: resolveWrite(geometry.write, penScale),
		curvePaths,
		style: resolvedStyle,
		progress: Math.min(1, Math.max(0, progress)),
		clip: space.clip,
	});
}
