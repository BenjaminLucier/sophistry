/**
 * Spheres: `sphere3D`, a projected disc shaded by a radial-gradient highlight,
 * and `dot3D`, the same disc at marker scale with flat paint by default. One
 * piece each, so `progress`, handles and interaction work as on any shape.
 */

import {
	Invalidate,
	isGradientSpec,
	type PaintSpec,
	radialGradient,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import { mixColor, toCss } from "@sophistry/core/color";
import { circlePolyline } from "@sophistry/core/geometry";
import type { Point3 } from "@sophistry/core/internal";
import type { Theme } from "@sophistry/core/themes";
import type { Camera3DValue } from "../context";
import { depthZ, projectPoint, projectScale } from "../project";
import type { Shape3DProps } from "../props3d";
import { shape3DProps } from "../props3d";
import type { ProjectedPiece } from "../shape3d";
import { defineShape3D } from "../shape3d";

/** @category Primitives */
export interface Sphere3DProps extends Shape3DProps {
	/**
	 * World position of the sphere's centre.
	 * @default { x: 0, y: 0, z: 0 }
	 */
	center?: Point3;
	/**
	 * Radius in world units.
	 * @default 1
	 */
	radius?: number;
	/**
	 * Direction the light comes from (any length); the highlight moves toward it.
	 * @default { x: -1, y: 1, z: 1 }
	 */
	light?: Point3;
	/**
	 * How strongly to shade the sphere, from `0` (a flat disc, like a 2D `circle`)
	 * to `1`; `true` is `1`. Fractions fade smoothly, so it can follow a camera move.
	 * Ignored when `fill` is a gradient.
	 * @default true
	 */
	shaded?: boolean | number;
}

/** @category Primitives */
export interface Dot3DProps
	extends Omit<Sphere3DProps, "radius" | "fill" | "shaded"> {
	/**
	 * Radius in world units.
	 * @default 0.08
	 */
	radius?: number;
	/** Marker colour (a mark takes `color`, like the 2D `dot`). Defaults to the theme accent. */
	color?: ColorInput;
	/**
	 * Shading amount, as on `sphere3D`.
	 * @default false
	 */
	shaded?: boolean | number;
}

const DEFAULT_CENTER: Point3 = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_LIGHT: Point3 = Object.freeze({ x: -1, y: 1, z: 1 });
const DEFAULT_DOT_RADIUS = 0.08;

/**
 * A circle's silhouette reads as a sphere at any size a scene actually uses
 * one at, so this doesn't need `segmentsForRadius`'s adaptive count: a fixed
 * ~48 keeps the shading gradient's highlight looking round without paying for
 * the pixel-radius measurement `circle` does for outlines that matter more.
 */
const SEGMENTS = 48;

function normalize(v: Point3): Point3 {
	const length = Math.hypot(v.x, v.y, v.z) || 1;
	return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/**
 * Where the specular highlight sits, in scene units (y up). The highlight
 * moves *toward* the light (a light from the upper left lights the upper-left
 * of the sphere), offset by half the radius: an approximation, not a
 * projection of the light itself. Scaled by `amount` so the highlight
 * coalesces onto the centre as shading fades out.
 *
 * @internal
 */
export function highlightPosition(
	centre: { x: number; y: number },
	rScreen: number,
	light: Point3,
	amount: number,
): { x: number; y: number } {
	return {
		x: centre.x + rScreen * light.x * 0.5 * amount,
		y: centre.y + rScreen * light.y * 0.5 * amount,
	};
}

/** What a sphere's projection reads. */
interface SphereLook {
	center: Point3;
	radius: number;
	fill: PaintSpec | undefined;
	stroke: PaintSpec | undefined;
	fillOpacity: number | undefined;
	light: Point3 | undefined;
	shaded: boolean | number | undefined;
}

/** The one piece a sphere draws: its disc, shaded, in the depth sort. */
function projectSphere(
	look: SphereLook,
	camera: Camera3DValue,
	theme: Theme,
): ProjectedPiece[] {
	// The projected screen-space centre and radius the sphere silhouettes as,
	// shared by the outline and the shading gradient.
	const center = projectPoint(camera, look.center);
	const rScreen = center ? projectScale(camera, look.radius, center.depth) : 0;
	const p = center && rScreen > 0 ? center : null;

	// Matches the 2D `dot`'s default and `meshFaces`' theme fallback.
	const base = look.fill ?? theme.palette.accent;
	let fill: PaintSpec = base;
	// A gradient `fill` wins outright: see `shaded`'s doc.
	if (!isGradientSpec(look.fill) && p) {
		const amount =
			look.shaded === false
				? 0
				: look.shaded === true || look.shaded === undefined
					? 1
					: Math.min(1, Math.max(0, look.shaded));
		// `amount <= 0` keeps `base`: pixel-identical to the shading fading all
		// the way down, a flat 2D `circle`'s exact fill, no gradient built.
		if (amount > 0) {
			const color = base as ColorInput;
			const light = normalize(look.light ?? DEFAULT_LIGHT);
			const highlight = highlightPosition(p, rScreen, light, amount);
			// `units: "scene"`: `from`/`to` and the radii are absolute scene
			// units, not fractions of the shape's own box.
			fill = radialGradient(
				[
					toCss(mixColor(color, "#ffffff", amount)),
					color as string,
					toCss(mixColor(color, "#000000", amount)),
				],
				{
					offsets: [0, 0.3, 1],
					from: highlight,
					to: { x: p.x, y: p.y },
					fromRadius: rScreen * 0.05,
					toRadius: rScreen,
					units: "scene",
				},
			);
		}
	}

	const style = {
		stroke: look.stroke ?? "none",
		fill,
		fillOpacity: look.fillOpacity ?? 1,
	};
	if (!p) {
		return [{ geometry: { polylines: [], closed: true }, z: 0, style }];
	}
	return [
		{
			geometry: {
				polylines: [circlePolyline(p.x, p.y, rScreen, SEGMENTS)],
				closed: true,
			},
			z: depthZ(p.depth),
			// One piece in the camera's depth sort: a disc whose depth range is the
			// sphere's, so it orders against faces by the sphere, not just its centre.
			depth: {
				world: [look.center],
				screen: [p],
				radius: look.radius,
				screenRadius: rScreen,
			},
			style,
		},
	];
}

/** The props a sphere's projection reads, re-projecting on change. */
const sphereLookProps = {
	stroke: { invalidates: Invalidate.UPDATE },
	fillOpacity: { default: 1, invalidates: Invalidate.UPDATE },
	light: { default: DEFAULT_LIGHT, invalidates: Invalidate.UPDATE },
	center: { default: DEFAULT_CENTER, invalidates: Invalidate.UPDATE },
} as const;

/**
 * A sphere, drawn as a projected disc shaded by a radial gradient standing in
 * for a light.
 *
 * The silhouette is always a circle whose radius shrinks with distance from
 * the camera. Its base colour is `fill`, else the theme accent, shaded by a
 * highlight (see `shaded`); a gradient `fill` is painted as given. The outline
 * defaults to none. Must be inside a `camera3D`. Props are bindable; the
 * sphere re-projects when the camera or its props change.
 *
 * @example
 * ```ts
 * import { sphere3D } from "@sophistry/3d";
 *
 * const ball = sphere3D.create({ center: { x: 0, y: 1, z: 0 }, radius: 0.5, fill: "#4af" });
 * ```
 *
 * @see {@link dot3D} for a small flat marker.
 * @category Primitives
 */
export const sphere3D = defineShape3D<Sphere3DProps, null>({
	name: "Sphere3D",
	props: {
		...shape3DProps,
		...sphereLookProps,
		fill: { invalidates: Invalidate.UPDATE },
		radius: { default: 1, invalidates: Invalidate.UPDATE },
		shaded: { default: true, invalidates: Invalidate.UPDATE },
	},
	// A sphere has no world geometry beyond its centre and radius.
	world: () => null,
	project: (_world, camera, props, theme) =>
		projectSphere(
			{
				center: props.center ?? DEFAULT_CENTER,
				radius: props.radius ?? 1,
				fill: props.fill,
				stroke: props.stroke,
				fillOpacity: props.fillOpacity,
				light: props.light,
				shaded: props.shaded,
			},
			camera,
			theme,
		),
});

/**
 * A small, flat marker point in 3D.
 *
 * A `sphere3D` with a default radius of 0.08 world units and `shaded`
 * defaulting to `false`, so it reads like a 2D `dot`, coloured by `color`
 * as a 2D `dot` is. Pass `shaded` to get the sphere's highlight back. Must be
 * inside a `camera3D`.
 *
 * @example
 * ```ts
 * import { dot3D } from "@sophistry/3d";
 *
 * const marker = dot3D.create({ center: { x: 1, y: 2, z: 0 }, color: "gold" });
 * ```
 *
 * @category Primitives
 */
export const dot3D = defineShape3D<Dot3DProps, null>({
	name: "Dot3D",
	props: {
		...shape3DProps,
		...sphereLookProps,
		radius: { default: DEFAULT_DOT_RADIUS, invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		shaded: { default: false, invalidates: Invalidate.UPDATE },
	},
	world: () => null,
	project: (_world, camera, props, theme) =>
		projectSphere(
			{
				center: props.center ?? DEFAULT_CENTER,
				radius: props.radius ?? DEFAULT_DOT_RADIUS,
				fill: props.color as PaintSpec | undefined,
				stroke: props.stroke,
				fillOpacity: props.fillOpacity,
				light: props.light,
				shaded: props.shaded ?? false,
			},
			camera,
			theme,
		),
});
