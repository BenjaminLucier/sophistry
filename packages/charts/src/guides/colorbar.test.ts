/**
 * `colorbar` on its own: the bar, its ticks and numbers through the axes'
 * machinery, the title, the horizontal layout, the reveal and the width a
 * frame reserves for it.
 */

import { describe, expect, it } from "vitest";
import { mount, theme } from "../test-harness";
import { colorbar, colorbarWidth } from "./colorbar";

const fontFamily = theme.defaults.fontFamily;

describe("colorbar", () => {
	it("draws a gradient bar with a tick and a number per round value", () => {
		const scene = mount(
			colorbar.create({ domain: [0, 100], at: { x: 0, y: 0 } }),
		);
		const [bar, ...ticks] = scene.shapes();
		expect(typeof bar?.style.fill).not.toBe("string");
		expect(bar?.style.stroke).toBe(theme.palette.border);
		const numbers = scene.texts();
		expect(numbers.map((t) => t.text)).toEqual([
			"0",
			"20",
			"40",
			"60",
			"80",
			"100",
		]);
		expect(ticks).toHaveLength(numbers.length);
		// Vertical: low at the bottom, numbers right of the bar, 3 long.
		expect(numbers[0]?.at.y).toBeCloseTo(0);
		expect(numbers.at(-1)?.at.y).toBeCloseTo(3);
		expect(numbers[0]?.at.x).toBeCloseTo(0.22 + 0.08 + 0.24 * 0.4);
		expect(numbers[0]?.style.align).toBe("left");
	});

	it("takes a title, a tick count and a format", () => {
		const scene = mount(
			colorbar.create({
				domain: [0, 1],
				at: { x: 0, y: 0 },
				label: "Share",
				ticks: 2,
				tickFormat: "percent",
			}),
		);
		const texts = scene.texts();
		expect(texts.at(-1)?.text).toBe("Share");
		expect(texts.at(-1)?.at.y).toBeCloseTo(3 + 0.24 * 0.9);
		expect(texts.slice(0, -1).every((t) => t.text.endsWith("%"))).toBe(true);
	});

	it("lies horizontal, numbers centred below the bar", () => {
		const scene = mount(
			colorbar.create({
				domain: [0, 10],
				at: { x: 1, y: 2 },
				orientation: "horizontal",
				length: 4,
				label: "Heat",
			}),
		);
		const texts = scene.texts();
		const numbers = texts.slice(0, -1);
		expect(numbers[0]?.at.x).toBeCloseTo(1);
		expect(numbers.at(-1)?.at.x).toBeCloseTo(5);
		expect(numbers[0]?.style.align).toBe("center");
		expect(numbers[0]?.at.y).toBeCloseTo(
			2 - 0.22 - 0.08 - 0.24 * 0.4 - 0.24 * 0.45,
		);
		expect(texts.at(-1)?.at).toEqual({ x: 1 + 4 + 0.12, y: 2 - 0.11 });
	});

	it("fades the bar in, then its numbers, keeping its nodes", () => {
		const node = colorbar.create({
			domain: [0, 100],
			at: { x: 0, y: 0 },
			progress: 0.25,
		});
		const scene = mount(node);
		expect(scene.shapes()).toHaveLength(1);
		expect(scene.shapes()[0]?.style.opacity).toBeCloseTo(0.5);
		expect(scene.texts()).toEqual([]);
		const nodes = [...node.children];
		node.set("progress", 0.75);
		scene.commit();
		expect(scene.texts()[0]?.style.opacity).toBeCloseTo(0.5);
		expect(node.children).toEqual(nodes);
		node.set("visible", false);
		scene.commit();
		expect(scene.shapes()).toEqual([]);
	});

	it("gets log ticks on a log scale", () => {
		const scene = mount(
			colorbar.create({ domain: [1, 1000], at: { x: 0, y: 0 }, scale: "log" }),
		);
		expect(scene.texts().map((t) => t.text)).toEqual([
			"1",
			"10",
			"100",
			"1000",
		]);
	});

	it("measures its width: the bar, ticks and widest number, or the title", () => {
		const bare = colorbarWidth({ domain: [0, 100] }, fontFamily);
		expect(bare).toBeGreaterThan(0.22 + 0.08);
		const titled = colorbarWidth(
			{ domain: [0, 100], label: "A very long colour bar title" },
			fontFamily,
		);
		expect(titled).toBeGreaterThan(bare);
		expect(colorbarWidth({ domain: [1, 1] }, fontFamily)).toBe(0.22);
	});
});
