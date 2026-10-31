/**
 * `Shape3DProps`: `ShapeProps` minus the 2D placement props (`x`, `y`,
 * `rotation`, `scale`, `origin`, `place`), since a 3D primitive is placed by its
 * world-space props before projection. Style, reveal and interaction props are
 * the same fields, forwarded to the projected pieces unchanged.
 *
 * Colour follows the 2D rule: meshes take `fill`, lines take `stroke`, and only
 * `dot3D` and the 3D charts take `color`.
 */

import {
	Invalidate,
	type PropsDescriptor,
	type ShapeProps,
	shapeProps,
} from "@sophistry/core";

/**
 * Style, reveal and interaction props shared by the 3D shapes: everything a
 * 2D shape accepts (`stroke`, `fill`, `opacity`, `progress`, `visible`,
 * pointer handlers, ...) except placement. Position a 3D shape with its own
 * world-space props (`center`, `from`/`to`, ...), not `x`/`y`.
 *
 * @category Math & helpers
 */
export interface Shape3DProps
	extends Omit<
		ShapeProps,
		"x" | "y" | "rotation" | "scale" | "origin" | "place"
	> {}

const {
	x: _x,
	y: _y,
	rotation: _rotation,
	scale: _scale,
	origin: _origin,
	place: _place,
	...shared
} = shapeProps;

/**
 * Descriptor entries for every {@link Shape3DProps} key, to spread into a 3D
 * primitive's own descriptor (see `defineShape3D`).
 *
 * Paints, reveal and interaction props are forwarded to every projected
 * piece, so they invalidate the forwarding stages (`STYLE`, `SPEC`,
 * `INTERACTION`) and never re-project. `zIndex` re-projects (`UPDATE`): an
 * explicit `zIndex` takes the primitive out of the camera's depth sort. A
 * primitive whose `project` reads one of these props (a mesh shades its
 * `fill`, a sphere defaults its `stroke`) overrides that entry with
 * `Invalidate.UPDATE`.
 *
 * @category Extending
 */
export const shape3DProps: PropsDescriptor<Shape3DProps> = Object.freeze({
	...shared,
	zIndex: { invalidates: Invalidate.UPDATE },
});
