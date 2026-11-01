/**
 * `raster.ts`'s batch projection: the affine fast path must agree with
 * `coordsToPoint` wherever it is taken, and must not be taken where the
 * coordinates are not affine over the data (a log axis, a clamped one).
 */

import { createCartesianCoords } from "@sophistry/core";
import type { Range } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { affineFrame, projectPoints, projectRun } from "./raster.js";

const coordsOf = (
	xRange: Range,
	extra: Partial<Parameters<typeof createCartesianCoords>[0]> = {},
) =>
	createCartesianCoords({
		xRange,
		yRange: [0, 10],
		width: 8,
		height: 4,
		center: { x: 1, y: -2 },
		...extra,
	});

const xs = [1, 2.5, 7, 100, 0.5, 9];
const ys = [0, 3, 9, 4, 10, 1];

describe("projectPoints", () => {
	const check = (coords: ReturnType<typeof coordsOf>) => {
		const out = new Float64Array(xs.length * 2);
		projectPoints(coords, xs, ys, out);
		xs.forEach((x, i) => {
			const want = coords.coordsToPoint(x, ys[i]);
			expect(out[2 * i]).toBeCloseTo(want.x, 9);
			expect(out[2 * i + 1]).toBeCloseTo(want.y, 9);
		});
		const run = projectRun(
			coords,
			Array.from({ length: 40 }, (_, i) => ({ x: xs[i % 6], y: ys[i % 6] })),
		);
		run.forEach((at, i) => {
			const want = coords.coordsToPoint(xs[i % 6], ys[i % 6]);
			expect(at.x).toBeCloseTo(want.x, 9);
			expect(at.y).toBeCloseTo(want.y, 9);
		});
	};

	it("matches coordsToPoint under linear axes", () => check(coordsOf([0, 10])));
	it("matches coordsToPoint under a reversed axis", () =>
		check(coordsOf([10, 0])));
	it("falls back under a log axis", () => {
		const coords = coordsOf([0.5, 100], { xScale: "log" });
		expect(affineFrame(coords, 1, 0, 10, 10)).toBeNull();
		check(coords);
	});
	it("falls back under a clamped axis whose data runs past it", () =>
		check(coordsOf([0, 10], { xClamp: true })));
});
