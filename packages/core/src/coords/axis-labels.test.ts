// @vitest-environment happy-dom
/**
 * Anchored labels: `toLocalBounds`, and labels placed beside an axis sharing a
 * baseline whatever their ink (checked
 * against a `numberLine` writing month names): a descender ("Apr", "May") or a
 * lowercase-only name must not move a name off the row.
 *
 * The metrics oracle is given a canvas whose ink depends on the string — a
 * DOM-less fallback measures every string alike, which would hide the bug —
 * installed before anything in this file measures (the oracle is created
 * once per module instance).
 */

import { describe, expect, it } from "vitest";
import { fromTranslationRotationScale, IDENTITY } from "../geometry/index.js";
import { readDelta } from "../spec/layout.js";
import { anchoredLabelPlace, toLocalBounds } from "./axis-labels.js";
import { numberLine } from "./number-line.js";
import { mount } from "./test-scene.js";

const SIZE = 64; // `measureLabel` measures at a fixed reference size.
const fakeContext = {
	font: "",
	letterSpacing: "0px",
	measureText(text: string) {
		const descender = /[gjpqy]/.test(text);
		const capital = /[A-Z0-9]/.test(text);
		return {
			width: text.length * 0.5 * SIZE,
			// Lowercase-only text is shorter: x-height, not cap height.
			actualBoundingBoxAscent: (capital ? 0.7 : 0.5) * SIZE,
			actualBoundingBoxDescent: descender ? 0.2 * SIZE : 0,
		};
	},
};
HTMLCanvasElement.prototype.getContext = (() =>
	fakeContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;

describe("toLocalBounds", () => {
	const box = { minX: 10, minY: 0, maxX: 12, maxY: 1 };

	it("is the identity in an untransformed space", () => {
		expect(toLocalBounds(box, IDENTITY)).toEqual(box);
	});

	it("undoes a group's translation and scale", () => {
		const m = fromTranslationRotationScale({
			x: 10,
			y: 0,
			scaleX: 2,
			scaleY: 2,
		});
		expect(toLocalBounds(box, m)).toEqual({
			minX: 0,
			minY: 0,
			maxX: 1,
			maxY: 0.5,
		});
	});

	it("passes missing boxes through", () => {
		expect(toLocalBounds(undefined, IDENTITY)).toBeUndefined();
		expect(toLocalBounds(null, IDENTITY)).toBeNull();
	});
});

describe("anchoredLabelPlace", () => {
	it("leaves the gap between the anchor and the label's near edge", () => {
		const below = readDelta(
			anchoredLabelPlace(
				{
					text: "10",
					at: { x: 1, y: 0 },
					direction: { x: 0, y: -1 },
					gap: 0.2,
					fontSize: 1,
				},
				"sans-serif",
			),
		);
		// Digits: ascent 0.7, no descender, so the line box is 0.7 tall.
		expect(below.x).toBeCloseTo(1, 9);
		expect(below.y).toBeCloseTo(-0.2 - 0.35, 9);
		const right = readDelta(
			anchoredLabelPlace(
				{
					text: "10",
					at: { x: 0, y: 0 },
					direction: { x: 1, y: 0 },
					gap: 0.2,
					fontSize: 1,
				},
				"sans-serif",
			),
		);
		// Two characters, half an em each: 1 wide.
		expect(right.x).toBeCloseTo(0.2 + 0.5, 9);
		expect(right.y).toBeCloseTo(0, 9);
	});
});

const months = ["Jan", "Feb", "Mar", "Apr", "May", "jun"];

describe("anchored labels share a baseline", () => {
	it("writes an axis's names on one line, descenders or not", () => {
		const scene = mount(
			numberLine.create({
				range: [0, 5, 1],
				length: 8,
				numberOverlap: false,
				tickFormat: (value) => months[value] ?? "",
			}),
		);
		const names = scene.texts().filter((s) => months.includes(s.text));
		expect(names).toHaveLength(months.length);
		const ys = names.map((s) => s.at.y);
		for (const y of ys) expect(y).toBeCloseTo(ys[0] as number, 9);
		// Where a name as tall as the digits always sat: its own ink box (cap
		// height, no descender) under the axis, centred on its anchor.
		const jan = names.find((s) => s.text === "Jan");
		const gap = 0.1 + 0.14;
		const fontSize = 0.3;
		expect(jan?.at.y).toBeCloseTo(-gap - (0.7 * fontSize) / 2, 9);
	});

	it("puts a far-side axis's names on one line too", () => {
		const scene = mount(
			numberLine.create({
				range: [0, 5, 1],
				length: 8,
				numberOverlap: false,
				numberDirection: { x: 0, y: 1 },
				tickFormat: (value) => months[value] ?? "",
			}),
		);
		const ys = scene
			.texts()
			.filter((s) => months.includes(s.text))
			.map((s) => s.at.y);
		expect(ys).toHaveLength(months.length);
		for (const y of ys) expect(y).toBeCloseTo(ys[0] as number, 9);
		expect(ys[0]).toBeGreaterThan(0);
	});
});
