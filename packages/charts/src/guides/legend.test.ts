/**
 * `legend` on its own: entries and their swatches, row wrapping, the
 * reveal's stagger, and a keyed transition's fades and moves.
 */

import { describe, expect, it } from "vitest";
import { mount, theme } from "../test-harness";
import type { LegendEntry } from "./legend";
import { legend, measureLegend } from "./legend";

const entries: LegendEntry[] = [
	{ key: "n", label: "North", color: "#ff0000" },
	{ key: "s", label: "South", color: "#0000ff", mark: { line: true } },
	{
		key: "e",
		label: "East",
		color: "#00ff00",
		mark: { line: true, symbol: "circle" },
	},
	{ key: "w", label: "West", color: "#ffff00", mark: { symbol: "square" } },
];
type Scene = ReturnType<typeof mount>;
const labelsOf = (scene: Scene) =>
	scene.texts().map((t) => ({ text: t.text, x: t.at.x, y: t.at.y }));
const fontFamily = theme.defaults.fontFamily;

describe("legend", () => {
	it("draws a swatch of each entry's mark and its name", () => {
		const scene = mount(legend.create({ entries, at: { x: 0, y: 0 } }));
		expect(scene.texts().map((t) => t.text)).toEqual([
			"North",
			"South",
			"East",
			"West",
		]);
		const shapes = scene.shapes();
		// A square, a line, a line and a dot, a square marker.
		expect(shapes).toHaveLength(5);
		expect(shapes[0]?.style.fill).toBe("#ff0000");
		expect(shapes[1]?.closed).toBe(false);
		expect(shapes[2]?.closed).toBe(false);
		expect(shapes[3]?.style.fill).toBe("#00ff00");
		expect(shapes[4]?.style.fill).toBe("#ffff00");
		// Labels sit where the layout puts them, from the top-left corner.
		const layout = measureLegend(entries, { fontFamily });
		expect(labelsOf(scene)[1]).toEqual({
			text: "South",
			x: layout.items[1]?.label.x,
			y: layout.items[1]?.label.y,
		});
	});

	it("writes a title above the entries, in the muted colour", () => {
		const scene = mount(
			legend.create({ entries, at: { x: 1, y: 1 }, title: "Region" }),
		);
		const title = scene.texts()[0];
		expect(title?.text).toBe("Region");
		expect(title?.style.fill).toBe(theme.palette.muted);
	});

	it("lays a row side by side, wrapping at maxWidth", () => {
		const row = measureLegend(entries, { fontFamily, direction: "row" });
		const ys = new Set(row.items.map((item) => item.label.y));
		expect(ys.size).toBe(1);
		const wrapped = measureLegend(entries, {
			fontFamily,
			direction: "row",
			maxWidth: row.width / 2,
		});
		expect(new Set(wrapped.items.map((item) => item.label.y)).size).toBe(
			wrapped.height > row.height ? 2 : 1,
		);
		expect(wrapped.height).toBeGreaterThan(row.height);
		const scene = mount(
			legend.create({
				entries,
				at: { x: 0, y: 0 },
				direction: "row",
				maxWidth: row.width / 2,
			}),
		);
		expect(labelsOf(scene).map((l) => l.y)).toEqual(
			wrapped.items.map((item) => item.label.y),
		);
	});

	it("reveals its entries one after another", () => {
		const node = legend.create({ entries, at: { x: 0, y: 0 }, progress: 0.3 });
		const scene = mount(node);
		const opacities = scene.texts().map((t) => t.style.opacity);
		expect(opacities[0]).toBeCloseTo(0.6);
		expect(opacities).toHaveLength(2);
		expect(scene.texts().map((t) => t.text)).not.toContain("East");
		node.set("progress", 1);
		scene.commit();
		expect(scene.texts().map((t) => t.style.opacity)).toEqual([1, 1, 1, 1]);
	});

	it("fades an exiting entry out and an entering one in, moving the kept ones", () => {
		const both = entries.slice(0, 3);
		const node = legend.create({
			entries: both,
			at: { x: 0, y: 0 },
			transition: {
				from: ["n", "s"],
				to: ["s", "e"],
				exit: 0.25,
				update: 0,
				enter: 0.5,
			},
		});
		const scene = mount(node);
		const opacity = (text: string) =>
			scene.texts().find((t) => t.text === text)?.style.opacity;
		expect(opacity("North")).toBeCloseTo(0.75);
		expect(opacity("South")).toBe(1);
		expect(opacity("East")).toBeCloseTo(0.5);
		// "South" is second at the start and first at the end.
		const start = measureLegend(both.slice(0, 2), { fontFamily });
		const end = measureLegend(both.slice(1), { fontFamily });
		const southY = () => scene.texts().find((t) => t.text === "South")?.at.y;
		expect(southY()).toBeCloseTo(start.items[1]?.label.y as number);
		const nodes = [...node.children];
		node.set("transition", {
			from: ["n", "s"],
			to: ["s", "e"],
			exit: 1,
			update: 0.5,
			enter: 0,
		});
		scene.commit();
		expect(southY()).toBeCloseTo(
			((start.items[1]?.label.y as number) +
				(end.items[0]?.label.y as number)) /
				2,
		);
		// A scrub keeps every node.
		expect(node.children).toEqual(nodes);
		expect(opacity("North")).toBeUndefined();
	});

	it("drops a removed entry's nodes and keeps the rest", () => {
		const node = legend.create({ entries, at: { x: 0, y: 0 } });
		const scene = mount(node);
		const southLabel = node.children[2];
		node.set("entries", entries.slice(1));
		scene.commit();
		expect(scene.texts().map((t) => t.text)).toEqual(["South", "East", "West"]);
		expect(node.children).toContain(southLabel);
	});

	it("hides with visible false", () => {
		const node = legend.create({ entries, at: { x: 0, y: 0 }, title: "T" });
		const scene = mount(node);
		node.set("visible", false);
		scene.commit();
		expect(scene.shapes()).toEqual([]);
		expect(scene.texts()).toEqual([]);
	});
});
