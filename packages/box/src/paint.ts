/**
 * What a box paints: its background, a rounded rectangle over the border
 * box, and its border, a ring between the border box and the padding box
 * with a width per side, as CSS draws them.
 *
 * Both are drawn in the box's own frame: origin at the border box's top
 * left, y running down. Corner radii are given as on screen (top left
 * first, clockwise) and turned into the outline's order here, since a
 * rounded rectangle names its corners for y running up.
 */

import type { ShapeProps } from "@sophistry/core";
import { defineShape, Invalidate, shapeProps } from "@sophistry/core";
import type { CornerRadii, CornerRadius } from "@sophistry/core/geometry";
import {
	resolveCornerRadii,
	roundedRectCurvePath,
} from "@sophistry/core/geometry";
import type { Edges } from "@sophistry/layout";

/**
 * Corner radii as on screen in a frame whose y runs down, in the order a
 * rounded rectangle takes them (it names corners for y running up).
 */
export function frameRadii(radii: CornerRadii): CornerRadii {
	const [topLeft, topRight, bottomRight, bottomLeft] = radii;
	return [bottomLeft, bottomRight, topRight, topLeft];
}

/** One radius for every corner, or the four given. */
export function cornerList(
	radius: CornerRadius | readonly CornerRadius[] | undefined,
): CornerRadii {
	if (radius === undefined) return [0, 0, 0, 0];
	if (Array.isArray(radius)) return radius as unknown as CornerRadii;
	const one = radius as CornerRadius;
	return [one, one, one, one];
}

/** @internal */
export interface BorderProps extends ShapeProps {
	width: number;
	height: number;
	/** Border width per side. */
	widths: Edges<number>;
	/** The border box's corner radii, as on screen, top left first. */
	radii: CornerRadii;
}

/**
 * A box's border: the border box less the padding box. The inner corners
 * are the outer radii less the border widths beside them, as in CSS.
 *
 * @internal
 */
export const boxBorder = defineShape<BorderProps>({
	name: "BoxBorder",
	props: {
		...shapeProps,
		width: { invalidates: Invalidate.GEOMETRY },
		height: { invalidates: Invalidate.GEOMETRY },
		widths: { invalidates: Invalidate.GEOMETRY },
		radii: { invalidates: Invalidate.GEOMETRY },
	},
	geometry: (props) => {
		const { width, height, widths } = props;
		const outer = resolveCornerRadii(width, height, props.radii);
		const [topLeft, topRight, bottomRight, bottomLeft] = outer;
		const inner: CornerRadii = [
			{
				x: Math.max(0, topLeft.x - widths.left),
				y: Math.max(0, topLeft.y - widths.top),
			},
			{
				x: Math.max(0, topRight.x - widths.right),
				y: Math.max(0, topRight.y - widths.top),
			},
			{
				x: Math.max(0, bottomRight.x - widths.right),
				y: Math.max(0, bottomRight.y - widths.bottom),
			},
			{
				x: Math.max(0, bottomLeft.x - widths.left),
				y: Math.max(0, bottomLeft.y - widths.bottom),
			},
		];
		const innerWidth = Math.max(0, width - widths.left - widths.right);
		const innerHeight = Math.max(0, height - widths.top - widths.bottom);
		const curvePaths = [
			roundedRectCurvePath(0, 0, width, height, frameRadii(outer)),
		];
		if (innerWidth > 0 && innerHeight > 0) {
			curvePaths.push(
				roundedRectCurvePath(
					widths.left,
					widths.top,
					innerWidth,
					innerHeight,
					frameRadii(inner),
					{ reverse: true },
				),
			);
		}
		return { closed: true, curvePaths };
	},
});
