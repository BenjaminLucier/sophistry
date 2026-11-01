/** A 3D scatter plot: one `dot3D` per point. */

import type { Dot3DProps } from "@sophistry/3d";
import { dot3D } from "@sophistry/3d";
import type { CompositeContext, SceneNode } from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { Channel, ColorChannel, Quantity } from "../data/channels.js";
import {
	numberValues,
	resolveColor,
	resolveQuantity,
} from "../data/channels.js";
import type { ScatterPoint3 } from "../math/3d/scatter3d.js";
import { scatterPoints3 } from "../math/3d/scatter3d.js";
import type { AnyDatum } from "../props.js";
import {
	dataChanged,
	forwardAll,
	forwardChanged,
	forwardedEntries,
	setPoint3,
} from "./forward.js";

/** @category Plots */
export interface Scatter3DProps<T = unknown>
	extends Omit<Dot3DProps, "center" | "radius" | "color"> {
	/** One marker per datum. A datum with a non-finite coordinate is skipped. */
	data: readonly T[];
	/** World x, a key of `T` or `(d, i) => number`. */
	x: Channel<T, number>;
	/** World y (up), a key of `T` or `(d, i) => number`. */
	y: Channel<T, number>;
	/** World z, a key of `T` or `(d, i) => number`. A data channel, not the paint order: see `zIndex`. */
	z: Channel<T, number>;
	/** World-unit marker radius: a constant, a key of `T` or `(d, i) => number`. @default 0.08 */
	radius?: Quantity<T>;
	/** Marker colour: one constant, or `(d, i) => colour` per marker. */
	color?: ColorChannel<T>;
}

const NO_DATA: readonly AnyDatum[] = [];

type Props = Scatter3DProps<AnyDatum>;

/** The props handed to every marker as they are. */
const forwarded = forwardedEntries(dot3D.descriptor, [
	"center",
	"radius",
	"color",
]);
const FORWARDED_KEYS = Object.keys(forwarded) as (keyof Props)[];
const FORWARDED = new Set<keyof Props>(FORWARDED_KEYS);

type DotNode = ReturnType<typeof dot3D.create>;

/** The markers for the current data, reconciled by position (unkeyed). */
function draw(ctx: CompositeContext<Props>): SceneNode[] {
	const props = ctx.props;
	const data = props.data ?? NO_DATA;
	const radiusOf = resolveQuantity(props.radius);
	const colorOf = resolveColor(props.color);
	const points = scatterPoints3(
		numberValues(data, props.x),
		numberValues(data, props.y),
		numberValues(data, props.z),
	);
	const place = (dot: DotNode, point: ScatterPoint3) => {
		const datum = data[point.index];
		setPoint3(dot, "center", { x: point.x, y: point.y, z: point.z });
		dot.set("radius", radiusOf?.(datum, point.index));
		dot.set("color", colorOf?.(datum, point.index));
	};
	return ctx.list("markers", points, {
		key: (_point, index) => index,
		create: (point) => {
			const dot = dot3D.create();
			forwardAll(props, dot, FORWARDED_KEYS);
			place(dot, point);
			return dot;
		},
		update: place,
	});
}

/**
 * A 3D scatter plot: one `dot3D` marker per finite `(x, y, z)`; `radius` and
 * `color` may vary per datum. Every other prop (`shaded`, `stroke`,
 * `opacity`, `zIndex`, handlers, ...) goes to each marker. Render under a
 * `camera3D`.
 *
 * @example
 * ```ts
 * import { camera3D } from "@sophistry/3d";
 * import { scatter3D } from "@sophistry/charts/3d";
 *
 * const samples = [
 * 	{ x: 0, y: 1, z: 0 },
 * 	{ x: 1, y: 0.5, z: -1 },
 * ];
 * camera3D.create({
 * 	children: [scatter3D.create({ data: samples, x: "x", y: "y", z: "z", radius: 0.1 })],
 * });
 * ```
 *
 * @category Plots
 */
export const scatter3D = defineComposite<Props>({
	name: "Scatter3D",
	props: {
		...forwarded,
		data: { default: NO_DATA, invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		z: { invalidates: Invalidate.UPDATE },
		radius: { default: 0.08, invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => draw(ctx),
	update: (changed, ctx) => {
		forwardChanged(changed, ctx.props, ctx.node.children, FORWARDED);
		return dataChanged(changed, FORWARDED) ? draw(ctx) : undefined;
	},
});
