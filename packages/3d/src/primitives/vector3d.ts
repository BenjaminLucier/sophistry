/**
 * `vector3D`: a projected 3D arrow, a shaft polyline plus a flat filled head
 * triangle in screen space (`fillFrom: 1`), as one piece, so `progress`
 * reveals shaft then head.
 */

import { Invalidate } from "@sophistry/core";
import type { Polyline } from "@sophistry/core/geometry";
import { arrowHeadAt, closePolyline } from "@sophistry/core/geometry";
import type { Point3 } from "@sophistry/core/internal";
import { clipSegment, depthZ, projectPoint, projectScale } from "../project.js";
import type { Shape3DProps } from "../props3d.js";
import { shape3DProps } from "../props3d.js";
import type { ProjectedPiece } from "../shape3d.js";
import { defineShape3D } from "../shape3d.js";

/** @category Primitives */
export interface Vector3DProps extends Shape3DProps {
	/** Tail of the vector, in world units. Defaults to the world origin. */
	from?: Point3;
	/** Tip of the vector, in world units. */
	to: Point3;
	/**
	 * Shaft thickness, in world units: see `curve3D`'s `worldWidth` for why
	 * this is a separate prop from the inherited `strokeWidth` rather than an
	 * overload of it. Defaults to 0.05.
	 */
	worldWidth?: number;
	/**
	 * Head length, in world units, measured back along the shaft.
	 * @default 0.3
	 */
	tipLength?: number;
}

const DEFAULT_FROM: Point3 = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_WORLD_WIDTH = 0.05;
const DEFAULT_TIP_LENGTH = 0.3;

/** A vector's world geometry: its two ends. */
export interface VectorEnds {
	from: Point3;
	to: Point3 | undefined;
}

/**
 * A 3D arrow from `from` to `to`, projected through the enclosing `camera3D`.
 *
 * Colour is `stroke`, else the theme foreground; the head is filled with
 * `fill`, else the stroke colour (as a 2D arrow's closed tip is). Shaft
 * thickness is `worldWidth` and head size is `tipLength`, both in world
 * units and perspective-scaled. If the tip is clipped behind the eye, the
 * head is dropped and only the visible shaft is drawn. `progress` reveals
 * shaft then head. Must be inside a `camera3D`.
 *
 * @example
 * ```ts
 * import { vector3D } from "@sophistry/3d";
 *
 * const arrow = vector3D.create({ to: { x: 1, y: 2, z: 0 }, stroke: "#f80" });
 * ```
 *
 * @see {@link line3D} for a plain segment.
 * @category Primitives
 */
export const vector3D = defineShape3D<Vector3DProps, VectorEnds>({
	name: "Vector3D",
	props: {
		...shape3DProps,
		stroke: { invalidates: Invalidate.UPDATE },
		fill: { invalidates: Invalidate.UPDATE },
		fillOpacity: { default: 1, invalidates: Invalidate.UPDATE },
		from: { default: DEFAULT_FROM, invalidates: Invalidate.GEOMETRY },
		to: { invalidates: Invalidate.GEOMETRY },
		worldWidth: {
			default: DEFAULT_WORLD_WIDTH,
			invalidates: Invalidate.UPDATE,
		},
		tipLength: { default: DEFAULT_TIP_LENGTH, invalidates: Invalidate.UPDATE },
	},
	world: (props) => ({ from: props.from ?? DEFAULT_FROM, to: props.to }),
	project: ({ from, to }, camera, props, theme): ProjectedPiece[] => {
		const stroke = props.stroke ?? theme.palette.foreground;
		const fill = props.fill ?? stroke;
		const fillOpacity = props.fillOpacity ?? 1;
		const empty: ProjectedPiece[] = [
			{
				geometry: { polylines: [], closed: true, fillFrom: 1 },
				z: 0,
				style: { stroke, strokeWidth: 0, fill, fillOpacity },
			},
		];

		// A zero-length vector has no direction, so there's no shaft to draw and
		// no meaningful angle for a head: draw nothing rather than a stray
		// arrowhead pointing along `atan2(0, 0)`.
		if (!to || (from.x === to.x && from.y === to.y && from.z === to.z)) {
			return empty;
		}

		// Trim to the part in front of the eye rather than projecting the raw
		// endpoints: a vector with one end behind the camera would otherwise
		// vanish entirely while most of its length is plainly on screen. See
		// `clipSegment`'s doc.
		const clipped = clipSegment(camera, from, to);
		if (!clipped) return empty;

		const fromP = projectPoint(camera, clipped.from);
		const toP = projectPoint(camera, clipped.to);
		if (!fromP || !toP) return empty;

		// Depth varies along the vector's length; the width wants one number, so
		// the average of the two ends is the usual choice: exact for a vector
		// that runs parallel to the image plane, approximate otherwise, the same
		// trade `Projection.scaleAt` documents.
		const zAvg = (fromP.depth + toP.depth) / 2;
		const lineWidth = projectScale(
			camera,
			props.worldWidth ?? DEFAULT_WORLD_WIDTH,
			zAvg,
		);

		const dx = toP.x - fromP.x;
		const dy = toP.y - fromP.y;
		const shaftLength = Math.hypot(dx, dy);
		const angle = Math.atan2(dy, dx);

		// The head belongs at the *true* tip, and only when the true tip is in
		// front of the eye: a vector clipped at its `to` end has had its tip cut
		// away, so what's left is a bare shaft with nothing to cap.
		const showHead = !clipped.toClipped;
		const tipLength = showHead
			? projectScale(camera, props.tipLength ?? DEFAULT_TIP_LENGTH, toP.depth)
			: 0;

		// Stop the shaft short of the tip so the head sits on top of it rather
		// than swallowing it: the same split the 2D `arrow` makes between its
		// shaft and its tip.
		const trim = Math.min(tipLength, shaftLength);
		const shaftEnd = {
			x: toP.x - Math.cos(angle) * trim,
			y: toP.y - Math.sin(angle) * trim,
		};

		const shaft: Polyline = [fromP, shaftEnd];
		const head: Polyline | null = showHead
			? closePolyline(arrowHeadAt(toP, angle, tipLength))
			: null;

		return [
			{
				geometry: {
					polylines: head ? [shaft, head] : [shaft],
					// The head is closed and filled; the shaft is a plain two-point
					// line, which never reads as an enclosed ring whatever this flag.
					closed: true,
					fillFrom: 1,
				},
				z: depthZ(zAvg),
				depth: { world: [clipped.from, clipped.to], screen: [fromP, toP] },
				style: { stroke, strokeWidth: lineWidth, fill, fillOpacity },
			},
		];
	},
});
