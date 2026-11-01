/** A 3D vector field: one `vector3D` arrow per datum. */

import type { Vector3DProps } from "@sophistry/3d";
import { vector3D } from "@sophistry/3d";
import type { CompositeContext, SceneNode } from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { Channel, ColorChannel } from "../data/channels.js";
import { numberValues, resolveColor } from "../data/channels.js";
import type { QuiverVector3 } from "../math/3d/quiver3d.js";
import { quiverVectors } from "../math/3d/quiver3d.js";
import type { AnyDatum } from "../props.js";
import {
	dataChanged,
	forwardAll,
	forwardChanged,
	forwardedEntries,
	setPoint3,
} from "./forward.js";

/** @category Plots */
export interface Quiver3DProps<T = unknown>
	extends Omit<Vector3DProps, "from" | "to" | "stroke" | "fill"> {
	/** One arrow per datum. A datum with a non-finite component is skipped. */
	data: readonly T[];
	/** World x of the arrow's tail, a key of `T` or `(d, i) => number`. */
	x: Channel<T, number>;
	/** World y of the arrow's tail. */
	y: Channel<T, number>;
	/** World z of the arrow's tail. A data channel, not the paint order: see `zIndex`. */
	z: Channel<T, number>;
	/** x component of the arrow's direction, in world units (before `scale`). */
	u: Channel<T, number>;
	/** y component of the arrow's direction. */
	v: Channel<T, number>;
	/** z component of the arrow's direction. */
	w: Channel<T, number>;
	/** Multiplies `(u, v, w)` before it becomes the drawn arrow. @default 1 */
	scale?: number;
	/** Arrow colour: one constant, or `(d, i) => colour` per arrow. */
	color?: ColorChannel<T>;
}

const NO_DATA: readonly AnyDatum[] = [];

type Props = Quiver3DProps<AnyDatum>;

/** The props handed to every arrow as they are. */
const forwarded = forwardedEntries(vector3D.descriptor, [
	"from",
	"to",
	"stroke",
	"fill",
]);
const FORWARDED_KEYS = Object.keys(forwarded) as (keyof Props)[];
const FORWARDED = new Set<keyof Props>(FORWARDED_KEYS);

type ArrowNode = ReturnType<typeof vector3D.create>;

/** Writes an entry's arrow: tail at the origin, tip at origin plus vector. */
function placeArrow(
	arrow: ArrowNode,
	entry: QuiverVector3,
	stroke: string | undefined,
): void {
	arrow.set("stroke", stroke);
	setPoint3(arrow, "from", entry.origin);
	setPoint3(arrow, "to", {
		x: entry.origin.x + entry.vector.x,
		y: entry.origin.y + entry.vector.y,
		z: entry.origin.z + entry.vector.z,
	});
}

/** The arrows for the current data, reconciled by position (unkeyed). */
function draw(ctx: CompositeContext<Props>): SceneNode[] {
	const props = ctx.props;
	const data = props.data ?? NO_DATA;
	const vectors = quiverVectors(
		numberValues(data, props.x),
		numberValues(data, props.y),
		numberValues(data, props.z),
		numberValues(data, props.u),
		numberValues(data, props.v),
		numberValues(data, props.w),
		{ scale: props.scale },
	);
	const colorOf = resolveColor(props.color);
	const strokeOf = (entry: QuiverVector3) =>
		colorOf?.(data[entry.index], entry.index);
	return ctx.list("arrows", vectors, {
		key: (_entry, index) => index,
		create: (entry) => {
			// `to` is required: placed for real just below.
			const arrow = vector3D.create({ to: entry.origin });
			forwardAll(props, arrow, FORWARDED_KEYS);
			placeArrow(arrow, entry, strokeOf(entry));
			return arrow;
		},
		update: (arrow, entry) => placeArrow(arrow, entry, strokeOf(entry)),
	});
}

/**
 * A 3D vector field: one `vector3D` arrow per datum, its tail at `(x, y, z)`
 * and its tip at that point plus `(u, v, w) * scale` (lengths not
 * normalised). Every other prop (`worldWidth`, `tipLength`, `opacity`,
 * `zIndex`, handlers, ...) goes to each arrow. Render under a `camera3D`.
 *
 * @example
 * ```ts
 * import { camera3D } from "@sophistry/3d";
 * import { quiver3D } from "@sophistry/charts/3d";
 *
 * const field = [
 * 	{ x: 0, y: 0, z: 0, u: 1, v: 0, w: 0 },
 * 	{ x: 1, y: 0, z: 0, u: 0, v: 1, w: 0 },
 * ];
 * camera3D.create({
 * 	children: [
 * 		quiver3D.create({ data: field, x: "x", y: "y", z: "z", u: "u", v: "v", w: "w", scale: 0.5 }),
 * 	],
 * });
 * ```
 *
 * @category Plots
 */
export const quiver3D = defineComposite<Props>({
	name: "Quiver3D",
	props: {
		...forwarded,
		data: { default: NO_DATA, invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		z: { invalidates: Invalidate.UPDATE },
		u: { invalidates: Invalidate.UPDATE },
		v: { invalidates: Invalidate.UPDATE },
		w: { invalidates: Invalidate.UPDATE },
		scale: { default: 1, invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => draw(ctx),
	update: (changed, ctx) => {
		forwardChanged(changed, ctx.props, ctx.node.children, FORWARDED);
		return dataChanged(changed, FORWARDED) ? draw(ctx) : undefined;
	},
});
