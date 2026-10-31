/**
 * Camera maths: several views of one scene in one canvas. A camera is a
 * viewport plus a view matrix over the single scene-unit snapshot, so a second
 * camera costs a second paint pass, not a second scene. The renderer paints
 * through these views and the pointer driver inverts them; the camera list
 * itself (which cameras exist, in tree order) belongs to the scene.
 */

import type { Point } from "../geometry";
import type { Matrix } from "../geometry/transform";
import type { PixelBox } from "../geometry/view-matrix";
import { viewMatrix } from "../geometry/view-matrix";

/**
 * A camera's rectangle of canvas, in **fractions** of the canvas — `{ x: 0.5,
 * y: 0, width: 0.5, height: 1 }` is the right-hand half.
 *
 * Fractions rather than pixels for the same reason scene code works in units:
 * a layout that is right at 800×450 stays right on a retina display and
 * through a resize, with nothing to recompute.
 *
 * @category Stage & cameras
 */
export interface Viewport {
	/** Left edge, as a fraction of canvas width (0 = left). */
	x: number;
	/** Top edge, as a fraction of canvas height (0 = top; y runs down). */
	y: number;
	/** Width as a fraction of canvas width. */
	width: number;
	/** Height as a fraction of canvas height. */
	height: number;
}

/**
 * What one camera sees, resolved for a frame.
 *
 * @category Stage & cameras
 */
export interface CameraView {
	/** Scene units spanning the *viewport's* width. Lower means more zoomed in. */
	units: number;
	/** The scene point at the middle of the viewport. */
	center: Point;
	/** Whether `y` increases upward on screen in this view. */
	yUp: boolean;
	/** The rectangle of canvas this view paints into, in canvas fractions. */
	viewport: Viewport;
	/** Border colour drawn around the viewport, or null for none. */
	border: string | null;
	/** Border width in CSS pixels — chrome, so it does not scale with zoom. */
	borderWidth: number;
	/** Fills the viewport before the scene is painted. Null shows the gutter. */
	background: string | null;
}

/**
 * What a `<Camera>` inherits from its stage: the framing, and the fill it
 * paints before the scene.
 *
 * @category Stage & cameras
 */
export interface CameraDefaults {
	units: number;
	center: Point;
	yUp: boolean;
	/**
	 * The stage's background fill as a CSS colour, or `null` for a transparent
	 * stage (cameras then leave their viewport unfilled too). Omitted, cameras
	 * fall back to the theme background.
	 */
	background?: string | null;
}

/**
 * The whole canvas (`{ x: 0, y: 0, width: 1, height: 1 }`) — the viewport of a stage with no cameras.
 *
 * @category Stage & cameras
 */
export const FULL_VIEWPORT: Viewport = { x: 0, y: 0, width: 1, height: 1 };

/**
 * A viewport's rectangle of the canvas, in device pixels.
 *
 * Rounded, because a viewport edge that lands mid-pixel gives a seam between
 * two panes on one frame and an overlap on the next as the canvas resizes.
 * Painting and picking both go through here so a point one pixel inside a pane
 * cannot be painted by one camera and picked by another.
 *
 * @category Cameras
 */
export function viewportBox(
	viewport: Viewport,
	size: { width: number; height: number },
): PixelBox {
	return {
		x: Math.round(viewport.x * size.width),
		y: Math.round(viewport.y * size.height),
		width: Math.round(viewport.width * size.width),
		height: Math.round(viewport.height * size.height),
	};
}

/**
 * The scene-unit to device-pixel matrix for one camera: what the renderer
 * installs to paint into its viewport, and what the pointer driver inverts.
 * Shared by both so they cannot disagree. `size` is the canvas backing store.
 *
 * @category Renderer & paint
 */
export function cameraMatrix(
	view: CameraView,
	size: { width: number; height: number },
): Matrix {
	const box = viewportBox(view.viewport, size);
	return viewMatrix(box, view.units, view.center, view.yUp);
}

/**
 * Which camera a device-pixel point belongs to, or -1 for none.
 *
 * The **last** registered viewport containing the point wins, because paint
 * order is registration order and the thing painted last is the thing on top.
 * That is what makes a picture-in-picture inset resolve the way it looks:
 * clicking the inset hits the inset, not the full-canvas main view underneath.
 *
 * `at` and `size` are in device pixels; `views` are the resolved camera views.
 *
 * @category Cameras
 */
export function pickCamera(
	views: readonly CameraView[],
	at: Point,
	size: { width: number; height: number },
): number {
	for (let i = views.length - 1; i >= 0; i--) {
		const box = viewportBox(views[i].viewport, size);
		if (box.width <= 0 || box.height <= 0) continue;
		if (
			at.x >= box.x &&
			at.x < box.x + box.width &&
			at.y >= box.y &&
			at.y < box.y + box.height
		) {
			return i;
		}
	}
	return -1;
}

/**
 * Two panes side by side (`"horizontal"`) or stacked (`"vertical"`).
 *
 * The orientation names follow manim-web's `SplitScreenCamera`, where
 * `split: "horizontal"` lays the panes out horizontally — i.e. the dividing
 * line is vertical. `ratio` is the first pane's share.
 *
 * @category Stage & cameras
 */
export function splitViewports(
	orientation: "horizontal" | "vertical" = "horizontal",
	ratio = 0.5,
): [Viewport, Viewport] {
	const r = Math.min(1, Math.max(0, ratio));
	if (orientation === "horizontal") {
		return [
			{ x: 0, y: 0, width: r, height: 1 },
			{ x: r, y: 0, width: 1 - r, height: 1 },
		];
	}
	return [
		{ x: 0, y: 0, width: 1, height: r },
		{ x: 0, y: r, width: 1, height: 1 - r },
	];
}

/** @category Stage & cameras */
export type PipCorner =
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";

/**
 * A full-canvas main view with an inset pinned to one corner.
 *
 * `size` is the inset's share of *each* dimension, so it comes out with the
 * canvas's own aspect ratio; `margin` is the gap between it and the edges, in
 * the same fractions.
 *
 * @category Stage & cameras
 */
export function pictureInPictureViewports(
	corner: PipCorner = "top-right",
	size = 0.3,
	margin = 0.02,
): [Viewport, Viewport] {
	const s = Math.min(1, Math.max(0, size));
	const inset: Viewport = {
		x: corner.endsWith("left") ? margin : 1 - s - margin,
		y: corner.startsWith("top") ? margin : 1 - s - margin,
		width: s,
		height: s,
	};
	return [FULL_VIEWPORT, inset];
}

/**
 * A 2×2 grid, in reading order: top-left, top-right, bottom-left, bottom-right.
 *
 * This is manim-web's `MultiCamera.setupQuadView()`. It carries no opinion
 * about which pane is the overview — that is a property of the cameras you
 * hand it, not of the grid.
 *
 * @category Stage & cameras
 */
export function quadViewports(): [Viewport, Viewport, Viewport, Viewport] {
	return [
		{ x: 0, y: 0, width: 0.5, height: 0.5 },
		{ x: 0.5, y: 0, width: 0.5, height: 0.5 },
		{ x: 0, y: 0.5, width: 0.5, height: 0.5 },
		{ x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
	];
}
