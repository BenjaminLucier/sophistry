/**
 * Dots, themed defaults and `Color` inputs.
 *
 * Default colours come from the active theme's tokens, not literals in a
 * definition; a `Color` works wherever a CSS string does (baking serialises
 * it); and a labelled dot's text follows the disc's `place` and `progress`.
 */

import { describe, expect, it } from "vitest";
import {
	BLUE as BLUE_HEX,
	GREEN as GREEN_HEX,
	parseColor,
	RED as RED_HEX,
	toCss,
} from "../color";
import { arcCurvePath, boundsOf, centerOf } from "../geometry";
import { Invalidate, themeContext } from "../scene/context";
import { label } from "../scene/text";
import {
	flatColor,
	isGradientSpec,
	linearGradient,
	resolvePaint,
} from "../spec/gradient";
import { NO_SHIFT, shiftBy } from "../spec/layout";
import type { TextSpec } from "../spec/types";
import { colorRamp, definePalette, resolveTheme } from "../themes";
import {
	annotationDot,
	dot,
	LABELED_DOT_FONT_SIZE,
	type LabeledDotProps,
	labeledDot,
	labeledDotRadius,
} from "./dot";
import { line } from "./line";
import { rect } from "./rect";
import {
	darkTheme,
	expectBaked,
	manualGraph,
	shapeSpec,
	shapeSpecsOf,
	textSpecsOf,
} from "./test-graph";

describe("dot", () => {
	it("is a circle of 0.09 about its centre, filled and ringed in its colour", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			dot.create({ center: { x: 1, y: 2 }, color: "#ff0000" }),
		);
		commit();
		expect(dot.descriptor.center.invalidates).toBe(Invalidate.TRANSFORM);
		expect(dot.descriptor.color.instanceable).toBe(true);
		expectBaked(
			node,
			{
				closed: true,
				curvePaths: [
					{ ...arcCurvePath(0, 0, 0.09, 0, Math.PI * 2), closed: true },
				],
			},
			{ fill: "#ff0000", stroke: "#ff0000", strokeWidth: 0 },
			{ x: 1, y: 2 },
		);
	});

	it("moves without rebuilding its outline", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(dot.create({}));
		commit();
		const curves = shapeSpec(node).local?.curvePaths;
		node.set("center", { x: 3, y: 3 });
		commit();
		expect(shapeSpec(node).local?.curvePaths).toBe(curves);
	});

	it("annotationDot is bigger, with a foreground ring", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(annotationDot.create({}));
		commit();
		const style = shapeSpec(node).style;
		expect(style.fill).toBe(darkTheme.palette.accent);
		expect(style.stroke).toBe(darkTheme.palette.foreground);
		expect(style.strokeWidth).toBeCloseTo(0.05);
		expect(node.width()).toBeCloseTo(0.09 * 1.3 * 2, 2);
	});
});

describe("themed defaults", () => {
	for (const mode of ["dark", "light"] as const) {
		const theme = resolveTheme({ mode });
		const { palette } = theme;

		it(`${mode}: a bare dot is filled with the accent`, () => {
			const { graph, commit } = manualGraph({ theme });
			const node = graph.root.add(dot.create({ center: { x: 0, y: 0 } }));
			commit();
			expect(shapeSpec(node).style.fill).toBe(palette.accent);
		});

		it(`${mode}: a bare line strokes with the foreground`, () => {
			const { graph, commit } = manualGraph({ theme });
			const node = graph.root.add(
				line.create({ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }),
			);
			commit();
			expect(shapeSpec(node).style.stroke).toBe(palette.foreground);
		});
	}

	it("an explicit colour still wins", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			dot.create({ center: { x: 0, y: 0 }, color: "#123456" }),
		);
		commit();
		expect(shapeSpec(node).style.fill).toBe("#123456");
	});

	it("follows a theme change", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(dot.create({}));
		commit();
		const light = resolveTheme({ mode: "light" });
		graph.root.provide(themeContext, light);
		commit();
		expect(shapeSpec(node).style.fill).toBe(light.palette.accent);
	});
});

const BLUE = parseColor(BLUE_HEX);
const RED = parseColor(RED_HEX);
const GREEN = parseColor(GREEN_HEX);

describe("a Color where a CSS string is accepted", () => {
	const blue = toCss(BLUE);

	it("shape fill and stroke bake to CSS strings", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			rect.create({ width: 1, height: 1, fill: BLUE, stroke: RED }),
		);
		commit();
		expect(shapeSpec(node).style.fill).toBe(blue);
		expect(shapeSpec(node).style.stroke).toBe(toCss(RED));
	});

	it("strings still pass through untouched", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			rect.create({ width: 1, height: 1, fill: "#123456" }),
		);
		commit();
		expect(shapeSpec(node).style.fill).toBe("#123456");
	});

	it("dot color and line strokeAlong accept a Color", () => {
		const { graph, commit } = manualGraph();
		const disc = graph.root.add(
			dot.create({ center: { x: 0, y: 0 }, color: BLUE }),
		);
		const along = graph.root.add(
			line.create({
				from: { x: 0, y: 0 },
				to: { x: 1, y: 0 },
				strokeAlong: [BLUE, "red", GREEN],
			}),
		);
		const scoped = graph.root.add(
			line.create({
				from: { x: 0, y: 0 },
				to: { x: 1, y: 0 },
				strokeAlong: { colors: [BLUE, RED], scope: "polyline" },
			}),
		);
		commit();
		expect(shapeSpec(disc).style.fill).toBe(blue);
		expect(shapeSpec(along).style.along).toEqual({
			colors: [blue, "red", toCss(GREEN)],
			scope: "shape",
		});
		expect(shapeSpec(scoped).style.along).toEqual({
			colors: [blue, toCss(RED)],
			scope: "polyline",
		});
	});

	it("label color bakes to a string fill", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(label.create({ text: "x", color: BLUE }));
		commit();
		expect((node.spec as TextSpec).style.fill).toBe(blue);
	});

	it("gradients keep working next to Color paints", () => {
		const gradient = linearGradient([BLUE, "red"]);
		expect(isGradientSpec(gradient)).toBe(true);
		expect(isGradientSpec(BLUE)).toBe(false);
		expect(isGradientSpec("red")).toBe(false);
		expect(isGradientSpec(undefined)).toBe(false);
		expect(gradient.stops[0]?.color).toBe(blue);
		const frame = {
			box: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
			toScene: (point: { x: number; y: number }) => point,
			sceneUnitsPerUnit: 1,
		};
		expect(resolvePaint(BLUE, frame)).toBe(blue);
		expect(flatColor(BLUE, "none")).toBe(blue);
		expect(flatColor(gradient, "none")).toBe("none");
	});

	it("colour ramps, and palettes defined from Colors", () => {
		expect(colorRamp([BLUE])(0.5)).toBe(blue);
		expect(colorRamp([RED, BLUE])(0)).toBe(toCss(RED));
		const palette = definePalette({
			name: "mine",
			dark: {
				background: RED,
				foreground: "#fff",
				accent: BLUE,
				series: [BLUE, GREEN],
			},
		});
		const { palette: tokens } = resolveTheme({ palette, mode: "dark" });
		expect(tokens.background).toBe(toCss(RED));
		expect(tokens.accent).toBe(blue);
		expect(tokens.series).toEqual([blue, toCss(GREEN)]);
		for (const value of [tokens.muted, tokens.grid, ...tokens.ramp]) {
			expect(typeof value).toBe("string");
		}
	});
});

describe("labeledDot", () => {
	function specsOf(props: LabeledDotProps) {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(labeledDot.create(props));
		commit();
		return {
			node,
			commit,
			shape: shapeSpecsOf(node)[0],
			text: textSpecsOf(node)[0] ?? null,
		};
	}

	it("moves the text with `place`", () => {
		const { shape, text } = specsOf({
			text: "A",
			center: { x: 1, y: 0 },
			place: shiftBy(NO_SHIFT, { x: 2, y: -1 }),
		});
		if (!shape || !text) throw new Error("expected a disc and a label");
		const disc = centerOf(boundsOf(shape.polylines));
		expect(disc.x).toBeCloseTo(3);
		expect(disc.y).toBeCloseTo(-1);
		expect(text.at.x).toBeCloseTo(3);
		expect(text.at.y).toBeCloseTo(-1);
	});

	it("reveals the text with `progress`", () => {
		const half = specsOf({ text: "A", progress: 0.5 });
		expect(half.shape?.progress).toBe(0.5);
		expect(half.text?.progress).toBe(0.5);
		// Undrawn: the text is hidden along with the disc.
		expect(specsOf({ text: "A", progress: 0 }).text).toBeNull();
	});

	it("grows the disc to fit its text, and refits on new text", () => {
		const { node, commit, shape } = specsOf({ text: "1" });
		const radius = labeledDotRadius("1", {}, 1, darkTheme.defaults.fontFamily);
		const width = shape ? boundsOf(shape.polylines) : null;
		expect(width && (width.maxX - width.minX) / 2).toBeCloseTo(radius, 3);
		node.set("text", "1000");
		commit();
		const wider = shapeSpecsOf(node)[0];
		const box = wider ? boundsOf(wider.polylines) : null;
		expect(box && (box.maxX - box.minX) / 2).toBeGreaterThan(radius);
		expect(textSpecsOf(node)[0]?.text).toBe("1000");
	});

	it("writes the text in the background colour at the default size", () => {
		const { text } = specsOf({ text: "B" });
		expect(text?.style.fill).toBe(darkTheme.palette.background);
		expect(LABELED_DOT_FONT_SIZE).toBe(0.28);
	});

	it("passes handlers to the disc", () => {
		const { graph, commit } = manualGraph();
		const onTap = () => {};
		const node = graph.root.add(labeledDot.create({ text: "A", onTap }));
		commit();
		const disc = node.children[0] as ReturnType<typeof dot.create>;
		expect(disc.get("onTap")).toBe(onTap);
		const next = () => {};
		node.set("onTap", next);
		commit();
		expect(disc.get("onTap")).toBe(next);
	});
});
