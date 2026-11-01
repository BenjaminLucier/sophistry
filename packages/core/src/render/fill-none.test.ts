/**
 * `fill: "none"` is a real fill value (a closed outline with no interior), not
 * a colour: handed to `ctx.fillStyle` the canvas would ignore it and fill in
 * whatever paint was set last, covering what lies underneath.
 */

import { describe, expect, it } from "vitest";
import { fillRings, paintsFill } from "./paint.js";

function recorder() {
	const calls: string[] = [];
	const ctx = new Proxy(
		{},
		{
			get: (_, key) =>
				key === "fill" ? () => calls.push("fill") : () => undefined,
			set: () => true,
		},
	) as unknown as CanvasRenderingContext2D;
	return { ctx, calls };
}

const square = [
	{ x: 0, y: 0 },
	{ x: 1, y: 0 },
	{ x: 1, y: 1 },
	{ x: 0, y: 0 },
];
const style = (fill: string | undefined) =>
	({
		fill,
		stroke: "#000",
		strokeWidth: 0.05,
		opacity: 1,
		fillOpacity: 1,
		lineCap: "round",
		lineJoin: "round",
		dash: null,
		dashOffset: 0,
		along: null,
	}) as unknown as Parameters<typeof fillRings>[2];

describe('fill "none"', () => {
	it("paints no fill", () => {
		const { ctx, calls } = recorder();
		fillRings(ctx, [square], style("none"), 1);
		expect(calls).toEqual([]);
	});

	it("still fills a colour", () => {
		const { ctx, calls } = recorder();
		fillRings(ctx, [square], style("#123456"), 0.5);
		expect(calls).toEqual(["fill"]);
	});

	it("paintsFill reads none and nothing as no fill", () => {
		expect(paintsFill("none")).toBe(false);
		expect(paintsFill(undefined)).toBe(false);
		expect(paintsFill("#fff")).toBe(true);
	});
});
