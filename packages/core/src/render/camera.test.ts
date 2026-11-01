/**
 * Camera maths shared by painting and picking: viewport rectangles in device
 * pixels, the per-camera view matrix, and which camera owns a pixel.
 */

import { describe, expect, it } from "vitest";
import { applyToPoint } from "../geometry/transform.js";
import type { CameraView } from "./camera.js";
import {
	cameraMatrix,
	FULL_VIEWPORT,
	pickCamera,
	pictureInPictureViewports,
	quadViewports,
	splitViewports,
	viewportBox,
} from "./camera.js";

const size = { width: 801, height: 450 };

function view(viewport = FULL_VIEWPORT): CameraView {
	return {
		units: 16,
		center: { x: 0, y: 0 },
		yUp: true,
		viewport,
		border: null,
		borderWidth: 0,
		background: null,
	};
}

describe("viewportBox", () => {
	it("rounds fractions to whole device pixels", () => {
		expect(viewportBox({ x: 0.5, y: 0, width: 0.5, height: 1 }, size)).toEqual({
			x: 401,
			y: 0,
			width: 401,
			height: 450,
		});
	});
});

describe("cameraMatrix", () => {
	it("puts the camera's centre at the middle of its viewport, y up", () => {
		const [, right] = splitViewports("horizontal");
		const m = cameraMatrix({ ...view(right), center: { x: 2, y: 1 } }, size);
		const box = viewportBox(right, size);
		const middle = applyToPoint(m, { x: 2, y: 1 });
		expect(middle.x).toBeCloseTo(box.x + box.width / 2);
		expect(middle.y).toBeCloseTo(box.height / 2);
		// One scene unit up is up the screen.
		expect(applyToPoint(m, { x: 2, y: 2 }).y).toBeLessThan(middle.y);
	});
});

describe("pickCamera", () => {
	it("the last camera containing the point wins, as it paints on top", () => {
		const views = pictureInPictureViewports("top-right").map((v) => view(v));
		expect(pickCamera(views, { x: 700, y: 50 }, size)).toBe(1);
		expect(pickCamera(views, { x: 10, y: 400 }, size)).toBe(0);
	});

	it("returns -1 outside every viewport, and skips empty ones", () => {
		const [left] = splitViewports("horizontal", 0.25);
		expect(pickCamera([view(left)], { x: 700, y: 10 }, size)).toBe(-1);
		const empty = view({ x: 0, y: 0, width: 0, height: 0 });
		expect(pickCamera([empty], { x: 0, y: 0 }, size)).toBe(-1);
	});
});

describe("viewport layouts", () => {
	it("a split clamps its ratio and the quad view tiles the canvas", () => {
		expect(splitViewports("vertical", 2)[1].height).toBe(0);
		const quad = quadViewports();
		expect(quad.reduce((sum, v) => sum + v.width * v.height, 0)).toBe(1);
	});
});
