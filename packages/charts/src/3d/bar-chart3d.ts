/** A 3D bar chart: one `prism3D` box per datum. */

import type { Prism3DProps } from "@sophistry/3d";
import { prism3D } from "@sophistry/3d";
import type { CompositeContext, SceneNode } from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { ColorChannel, Quantity } from "../data/channels.js";
import {
	colorResolver,
	numberValues,
	resolveQuantity,
} from "../data/channels.js";
import type { BarSlotBox3D } from "../math/3d/bar3d.js";
import { bar3dSlots } from "../math/3d/bar3d.js";
import type { AnyDatum } from "../props.js";
import {
	dataChanged,
	forwardAll,
	forwardChanged,
	forwardedEntries,
	setPoint3,
} from "./forward.js";

/** @category Plots */
export interface BarChart3DProps<T = unknown>
	extends Omit<Prism3DProps, "center" | "width" | "height" | "depth" | "fill"> {
	/** One box per datum. A datum with a non-finite anchor or extent is skipped. */
	data: readonly T[];
	/** x of each box's anchor corner (the box spans `x` to `x + width`): a constant, a key of `T` or `(d, i) => number`. */
	x: Quantity<T>;
	/** y of each box's anchor corner (y is up, so this is the base for upright bars). */
	y: Quantity<T>;
	/** z of each box's anchor corner. A data channel, not the paint order: see `zIndex`. */
	z: Quantity<T>;
	/** Box extent along x, added onto `x`: a constant, a key of `T` or `(d, i) => number`. @default 1 */
	width?: Quantity<T>;
	/** Box extent along y (the bar height), added onto `y`: a constant, a key of `T` or `(d, i) => number`. */
	height: Quantity<T>;
	/** Box extent along z, added onto `z`: a constant, a key of `T` or `(d, i) => number`. @default 1 */
	depth?: Quantity<T>;
	/** One colour for every bar, or `(d, i) => colour` per bar. Wins over `colors`. */
	color?: ColorChannel<T>;
	/** Colours cycled across the bars by index. Defaults to the theme's series colours. */
	colors?: readonly ColorInput[];
}

const NO_DATA: readonly AnyDatum[] = [];

type Props = BarChart3DProps<AnyDatum>;

/** The props handed to every box as they are. */
const forwarded = forwardedEntries(prism3D.descriptor, [
	"center",
	"width",
	"height",
	"depth",
	"fill",
]);
const FORWARDED_KEYS = Object.keys(forwarded) as (keyof Props)[];
const FORWARDED = new Set<keyof Props>(FORWARDED_KEYS);

type BoxNode = ReturnType<typeof prism3D.create>;

/** Writes a slot's box (only what changed, so an unmoved box keeps its faces). */
function placeBox(box: BoxNode, slot: BarSlotBox3D, fill: string): void {
	setPoint3(box, "center", {
		x: (slot.x0 + slot.x1) / 2,
		y: (slot.y0 + slot.y1) / 2,
		z: (slot.z0 + slot.z1) / 2,
	});
	box.set("width", slot.x1 - slot.x0);
	box.set("height", slot.y1 - slot.y0);
	box.set("depth", slot.z1 - slot.z0);
	box.set("fill", fill);
}

/** The boxes for the current data, one per slot, reconciled by position (unkeyed). */
function draw(ctx: CompositeContext<Props>): SceneNode[] {
	const props = ctx.props;
	const data = props.data ?? NO_DATA;
	const theme = ctx.theme;
	const slots = bar3dSlots(
		numberValues(data, resolveQuantity(props.x)),
		numberValues(data, resolveQuantity(props.y)),
		numberValues(data, resolveQuantity(props.z)),
		numberValues(
			data,
			resolveQuantity(props.width, () => 1),
		),
		numberValues(data, resolveQuantity(props.height)),
		numberValues(
			data,
			resolveQuantity(props.depth, () => 1),
		),
	);
	const colorOf = colorResolver(
		props.color,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	return ctx.list("boxes", slots, {
		key: (_slot, index) => index,
		create: (slot) => {
			const box = prism3D.create();
			forwardAll(props, box, FORWARDED_KEYS);
			placeBox(box, slot, colorOf(data[slot.index], slot.index));
			return box;
		},
		update: (box, slot) =>
			placeBox(box, slot, colorOf(data[slot.index], slot.index)),
	});
}

/**
 * A 3D bar chart: one axis-aligned `prism3D` box per datum, anchored at its
 * `(x, y, z)` corner and extending by `(width, height, depth)`; for upright
 * bars set `height` to the values. Every other prop (`light`, `stroke`,
 * `opacity`, `zIndex`, handlers, ...) goes to each box. Render under a
 * `camera3D`.
 *
 * @example
 * ```ts
 * import { camera3D } from "@sophistry/3d";
 * import { barChart3D } from "@sophistry/charts/3d";
 *
 * const sales = [
 * 	{ month: 0, region: 0, total: 3 },
 * 	{ month: 1, region: 0, total: 5 },
 * 	{ month: 0, region: 1, total: 2 },
 * ];
 * camera3D.create({
 * 	children: [
 * 		barChart3D.create({ data: sales, x: "month", y: 0, z: "region", height: "total", width: 0.8, depth: 0.8 }),
 * 	],
 * });
 * ```
 *
 * @category Plots
 */
export const barChart3D = defineComposite<Props>({
	name: "BarChart3D",
	props: {
		...forwarded,
		data: { default: NO_DATA, invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		z: { invalidates: Invalidate.UPDATE },
		width: { default: 1, invalidates: Invalidate.UPDATE },
		height: { invalidates: Invalidate.UPDATE },
		depth: { default: 1, invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => draw(ctx),
	update: (changed, ctx) => {
		forwardChanged(changed, ctx.props, ctx.node.children, FORWARDED);
		return dataChanged(changed, FORWARDED) ? draw(ctx) : undefined;
	},
});
