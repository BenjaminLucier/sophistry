/**
 * The scene-unit → device-pixel *view matrix*: the one place camera framing
 * (`units`/`center`/`yUp`) and canvas size become a transform. The renderer
 * installs it with `ctx.setTransform` per camera, and the pointer driver
 * inverts it — specs themselves never see it.
 *
 * Pure matrix math, so it lives in `geometry/`: `scene/`'s `<SceneSpace>` and
 * `render/`'s `camera.ts` both need it, and `scene/` may not import `render/`.
 */

import type { Point } from "./path/types.js";
import type { Matrix } from "./transform.js";
import { compose, scale as scaleMatrix, translate } from "./transform.js";

/**
 * A rectangle of the canvas, in device pixels.
 *
 * @category Renderer & paint
 */
export interface PixelBox {
	/** Left edge in device pixels. */
	x: number;
	/** Top edge in device pixels. */
	y: number;
	/** Width in device pixels. */
	width: number;
	/** Height in device pixels. */
	height: number;
}

/**
 * The scene-unit → device-pixel matrix for a view of the scene.
 *
 * A "view" is a rectangle of canvas plus what it is looking at: `units` across
 * its width, `center` at its middle. `<SceneSpace>` is the case where that
 * rectangle is the whole canvas; a camera is the case where it is a viewport.
 * Both go through here so the two can never drift apart — an inconsistency
 * between the stage's framing and a camera's would show up as the scene sliding
 * under the viewport rather than as an obvious error.
 *
 * One scene unit is `box.width / units` pixels in both axes, so a scene is
 * never stretched. With `yUp` the y axis is flipped so larger `y` is higher on
 * screen. A zero-width box falls back to a scale of 1.
 *
 * @param box - The rectangle of canvas to draw into, in device pixels.
 * @param units - Scene units spanning `box.width`.
 * @param center - The scene point placed at the middle of `box`.
 * @param yUp - Maths convention (y up) when true; canvas convention when false.
 * @returns The affine matrix from scene units to device pixels.
 *
 * @category Renderer & paint
 */
export function viewMatrix(
	box: PixelBox,
	units: number,
	center: Point,
	yUp: boolean,
): Matrix {
	const s = box.width > 0 ? box.width / units : 1;
	const flip = yUp ? -1 : 1;
	return compose(
		compose(
			translate(box.x + box.width / 2, box.y + box.height / 2),
			scaleMatrix(s, s * flip),
		),
		translate(-center.x, -center.y),
	);
}

/**
 * Whether a view matrix puts scene `y` *up* on screen (the maths convention).
 * Device `y` runs down, so that is a matrix that flips orientation.
 *
 * @param view - A scene → device view matrix.
 * @returns True when increasing scene `y` moves up the screen.
 *
 * @category Renderer & paint
 */
export function isYUp(view: Matrix): boolean {
	return view.a * view.d - view.b * view.c < 0;
}
