/**
 * Gradients in scene terms. `from`/`to` default to fractions of the shape's own
 * bounding box (y up), mapped through the same matrix as its geometry, so a
 * gradient moves with its shape; `units: "scene"` pins it to absolute scene
 * coordinates instead. Resolved gradients are plain objects rebuilt by the style
 * memo; `render/paint.ts` caches the `CanvasGradient`.
 */

import type { ColorInput } from "../color/index.js";
import { cssColor } from "../color/index.js";
import type { Point } from "../geometry/index.js";
import { colorRamp } from "../themes/ramp.js";
import type { GradientStop, Paint } from "./types.js";

/**
 * Where a gradient's endpoints are measured: `"bbox"` for fractions of the
 * shape's own bounding box (moves with the shape), `"scene"` for absolute
 * scene units (fixed on the stage).
 *
 * @category Colour
 */
export type GradientUnits = "bbox" | "scene";

/**
 * An unresolved gradient — what a scene writes. Build one with
 * `linearGradient`, `radialGradient` or `sheen` rather than by hand; the
 * builders are what fill in the defaults this resolver relies on.
 *
 * @category Colour
 */
export interface GradientSpec {
	kind: "gradient";
	type: "linear" | "radial";
	stops: GradientStop[];
	from: Point;
	to: Point;
	/** Radial only. In `units`; for `"bbox"`, a fraction of the box's long side. */
	fromRadius: number;
	toRadius: number;
	units: GradientUnits;
}

/**
 * What `fill` and `stroke` accept: any {@link ColorInput} (a CSS colour string
 * or a `Color` such as `BLUE`), or a gradient. A `Color` is serialised to its
 * CSS string when the style is baked (`bakeStrokeStyle`), so the renderer still
 * only ever sees strings.
 *
 * @category Colour
 */
export type PaintSpec = ColorInput | GradientSpec;

/**
 * Type guard: whether a `fill`/`stroke` value is a gradient rather than a plain
 * colour (a string or a `Color`) or undefined.
 *
 * @param paint - The value to test.
 * @returns True for a {@link GradientSpec}.
 *
 * @category Colour
 */
export function isGradientSpec(
	paint: PaintSpec | undefined,
): paint is GradientSpec {
	return (
		typeof paint === "object" &&
		paint !== null &&
		(paint as GradientSpec).kind === "gradient"
	);
}

/**
 * The paint as a plain colour, for the places that genuinely need a string —
 * a `<Label>`'s `color`, a `<Dot>`'s. A gradient answers with the fallback
 * rather than with its first stop: a caption tinted to match a gradient's low
 * end would be a guess, and a wrong one half the time.
 *
 * @param paint - A colour (string or `Color`), a gradient, or undefined.
 * @param fallback - The colour to return when `paint` is not a plain colour.
 * @returns `paint` as a CSS string if it is a plain colour, otherwise `fallback`.
 *
 * @category Colour
 */
export function flatColor(
	paint: PaintSpec | undefined,
	fallback: string,
): string {
	return paint === undefined || isGradientSpec(paint)
		? fallback
		: cssColor(paint);
}

/** Evenly spaced stops, or `offsets` if the caller placed them. */
function stopsFrom(colors: ColorInput[], offsets?: number[]): GradientStop[] {
	if (colors.length === 0) return [];
	if (colors.length === 1) return [{ offset: 0, color: cssColor(colors[0]) }];
	return colors.map((color, index) => ({
		offset: offsets?.[index] ?? index / (colors.length - 1),
		color: cssColor(color),
	}));
}

/** @category Colour */
export interface LinearGradientOptions {
	/** Start of the axis, in `units`. Defaults to the left-middle of the box. */
	from?: Point;
	/** End of the axis, in `units`. Defaults to the right-middle of the box. */
	to?: Point;
	/**
	 * The axis as an angle instead, in radians, y up — 0 is left to right, π/2
	 * bottom to top. A diameter of the box through its centre, so on a
	 * non-square box the axis is *not* perpendicular to the visual iso-lines;
	 * it is the same convention SVG's `objectBoundingBox` uses, and it is what
	 * makes a gradient survive a shape being stretched.
	 */
	angle?: number;
	/** Stop positions, 0..1. Defaults to evenly spaced. */
	offsets?: number[];
	/** Coordinate space of `from`/`to`: `"bbox"` (fractions of the shape's box, default) or absolute `"scene"` units. */
	units?: GradientUnits;
}

/**
 * A linear gradient across `colors`, for a shape's `fill` or `stroke`.
 *
 * By default the axis runs left to right across the shape's own bounding box
 * and moves with the shape. Use `angle` to rotate it, or `from`/`to` with
 * `units: "scene"` to pin it to the stage.
 *
 * @param colors - Stop colours (CSS strings or `Color` values), spread evenly unless `offsets` is given.
 * @param options - Axis, stop offsets and units; see {@link LinearGradientOptions}.
 * @returns A {@link GradientSpec} to pass as `fill` or `stroke`.
 * @category Colour
 */
export function linearGradient(
	colors: ColorInput[],
	options: LinearGradientOptions = {},
): GradientSpec {
	const angled = options.angle !== undefined;
	const half = angled
		? {
				x: Math.cos(options.angle as number) / 2,
				y: Math.sin(options.angle as number) / 2,
			}
		: { x: 0.5, y: 0 };
	return {
		kind: "gradient",
		type: "linear",
		stops: stopsFrom(colors, options.offsets),
		from: options.from ?? { x: 0.5 - half.x, y: 0.5 - half.y },
		to: options.to ?? { x: 0.5 + half.x, y: 0.5 + half.y },
		fromRadius: 0,
		toRadius: 0,
		units: options.units ?? "bbox",
	};
}

/** @category Colour */
export interface RadialGradientOptions {
	/** Centre of the inner circle. Defaults to the box's centre. */
	from?: Point;
	/** Centre of the outer circle. Defaults to `from` — a concentric gradient. */
	to?: Point;
	/**
	 * Radius of the inner circle. In `"bbox"` units, a fraction of the box's long side.
	 * @default 0
	 */
	fromRadius?: number;
	/**
	 * Radius of the outer circle. Defaults to half the box's long side, i.e. the rim of an
	 * inscribed disc.
	 */
	toRadius?: number;
	/** Stop positions, 0..1. Defaults to evenly spaced. */
	offsets?: number[];
	/** Coordinate space of centres and radii: `"bbox"` (default) or absolute `"scene"` units. */
	units?: GradientUnits;
}

/**
 * A radial gradient from `colors[0]` at the centre out to the last colour.
 *
 * Offsetting `from` from `to` is what makes a sphere read as lit rather than as
 * a target: the highlight sits where the inner circle is, and the shading falls
 * off around it.
 *
 * @param colors - Stop colours, centre first.
 * @param options - Centres, radii and units; see {@link RadialGradientOptions}.
 * @returns A {@link GradientSpec} to pass as `fill` or `stroke`.
 * @category Colour
 */
export function radialGradient(
	colors: ColorInput[],
	options: RadialGradientOptions = {},
): GradientSpec {
	const from = options.from ?? { x: 0.5, y: 0.5 };
	return {
		kind: "gradient",
		type: "radial",
		stops: stopsFrom(colors, options.offsets),
		from,
		to: options.to ?? from,
		fromRadius: options.fromRadius ?? 0,
		toRadius: options.toRadius ?? 0.5,
		units: options.units ?? "bbox",
	};
}

/** @category Colour */
export interface SheenOptions {
	/**
	 * How far towards `highlight` the band goes, 0..1. Manim's `sheen_factor`.
	 * @default 0.35
	 */
	factor?: number;
	/**
	 * Direction of the sweep in radians, y up. Manim's `sheen_direction`.
	 * @default Math.PI / 4
	 */
	angle?: number;
	/**
	 * Where the band sits along that direction, 0..1. **This is the animated
	 * one** — hand it a `track()` and the highlight travels. Defaults to 0.5.
	 */
	at?: number;
	/**
	 * Half-width of the band as a fraction of the sweep.
	 * @default 0.35
	 */
	width?: number;
	/** What the band tends towards. Defaults to white. */
	highlight?: ColorInput;
}

/**
 * Manim's sheen: a lighter band laid across a shape.
 *
 * There is no sheen *mechanism* here, and there deliberately isn't one. A sheen
 * is a gradient whose stops are a function of a number, and this framework's
 * whole position is that a reactive prop replaces an animation wrapper — so
 * `fill={sheen(color, { at: t() })}` with `t` driven by `valueTo` is Manim's
 * `sheen_factor` plus its animation, built out of parts that already existed.
 * The function is a convenience for spelling the three stops, nothing more.
 *
 * @param base - The shape's colour; everything outside the band stays this colour.
 * @param options - Band position, width, strength and direction; see {@link SheenOptions}.
 * @returns A {@link GradientSpec} to pass as `fill` or `stroke`.
 * @category Colour
 */
export function sheen(
	base: ColorInput,
	options: SheenOptions = {},
): GradientSpec {
	const at = options.at ?? 0.5;
	const width = options.width ?? 0.35;
	const lit = colorRamp([
		cssColor(base),
		cssColor(options.highlight ?? "#ffffff"),
	])(options.factor ?? 0.35);
	return linearGradient([base, base, lit, base, base], {
		angle: options.angle ?? Math.PI / 4,
		offsets: [0, at - width, at, at + width, 1],
	});
}

/**
 * What a shape knows about itself when its paint is resolved.
 *
 * @category Scene registry & specs
 */
export interface PaintFrame {
	/** The shape's own geometry box, in its local (pre-transform) units. */
	box: { minX: number; minY: number; maxX: number; maxY: number };
	/** Local units to scene units, including the shape's own TRS. */
	toScene: (at: Point) => Point;
	/** Scene units per local unit, for radii. */
	sceneUnitsPerUnit: number;
}

/**
 * Resolves an authored paint into the scene-space one the renderer paints.
 *
 * A *fraction* of the bounding box is lerped in the shape's own (y-up)
 * orientation before it is mapped, so `{ y: 1 }` names the top of the box
 * here as everywhere else in the API; the view's y flip is the renderer's
 * business. A `units: "scene"` gradient is already in the space specs live in,
 * so its points and radii pass through untouched.
 *
 * Used by `ShapeNode`; scene authors do not normally call it.
 *
 * @param paint - A colour (string or `Color`), gradient, or undefined.
 * @param frame - The shape's box and local-to-scene mapping; see {@link PaintFrame}.
 * @returns The scene-space paint, or null when `paint` is undefined.
 */
export function resolvePaint(
	paint: PaintSpec | undefined,
	frame: PaintFrame,
): Paint | null {
	if (paint === undefined) return null;
	if (!isGradientSpec(paint)) return cssColor(paint);

	const inBbox = paint.units === "bbox";
	const { box } = frame;
	let width = box.maxX - box.minX;
	let height = box.maxY - box.minY;
	// A box with no extent at all has no fractions to take, so a bbox gradient
	// over one collapses to its first stop rather than to a NaN endpoint.
	if (inBbox && !(width > 0 || height > 0)) {
		return paint.stops[0]?.color ?? "none";
	}
	// A box flat along one axis (a vertical or horizontal line) would map every
	// fraction on that axis to a single point, giving a gradient whose endpoints
	// coincide, which paints nothing. Give the flat axis the other's extent,
	// centred on the shape, so a gradient along the shape's length still runs.
	let originX = box.minX;
	let originY = box.minY;
	if (inBbox) {
		if (!(width > 0)) {
			width = height;
			originX = box.minX - width / 2;
		} else if (!(height > 0)) {
			height = width;
			originY = box.minY - height / 2;
		}
	}

	const place = (at: Point): Point =>
		inBbox
			? frame.toScene({
					x: originX + at.x * width,
					y: originY + at.y * height,
				})
			: at;

	if (paint.type === "linear") {
		return {
			kind: "linear",
			from: place(paint.from),
			to: place(paint.to),
			stops: paint.stops,
		};
	}

	// A radius has no direction, so a box that is twice as wide as it is tall
	// has no single "fraction of the box" to scale it by. The long side is the
	// choice that makes the default `toRadius: 0.5` reach the rim of a circle,
	// which is the shape a radial gradient is nearly always on.
	const reference = inBbox ? Math.max(width, height) : 1;
	const scale = inBbox ? frame.sceneUnitsPerUnit : 1;
	return {
		kind: "radial",
		from: place(paint.from),
		fromRadius: paint.fromRadius * reference * scale,
		to: place(paint.to),
		toRadius: paint.toRadius * reference * scale,
		stops: paint.stops,
	};
}
