/**
 * A web font that loads after text was measured (the
 * metrics cache drops the fallback font's box, and the scene re-runs what
 * measured). That is one `fontLoads` subscription per scene graph,
 * started by the first text node: on a load the root provides a new
 * `fontEpochContext`, text nodes rerun their geometry (their handle box
 * re-measures), label layouts and composites that called `measuresText`
 * re-lay out, and the graph's `onFontLoad` (the scene's
 * `renderer.invalidate()`) runs. A graph without text never subscribes.
 *
 * Uses a fake `document` (fonts + a canvas whose advance the test controls),
 * installed before any module measures, so the metrics oracle picks it up.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TextSpec } from "../spec/types.js";

const fonts = new EventTarget();
let advance = 10;
const canvasContext = {
	font: "",
	measureText: (text: string) => ({ width: text.length * advance }),
};
vi.stubGlobal("document", {
	fonts,
	createElement: () => ({ getContext: () => canvasContext }),
	// What the theme layer reads for the page's colour mode.
	documentElement: { dataset: {} },
});

afterAll(() => {
	vi.unstubAllGlobals();
});

/** Reports a finished font load, as `document.fonts` does. */
function loadFont(nextAdvance: number): void {
	advance = nextAdvance;
	fonts.dispatchEvent(new Event("loadingdone"));
}

let modules: {
	metrics: typeof import("../spec/metrics.js");
	context: typeof import("../scene/context.js");
	graph: typeof import("../scene/graph.js");
	text: typeof import("../scene/text.js");
	composite: typeof import("../scene/composite.js");
	fonts: typeof import("../scene/fonts.js");
	circle: typeof import("../shapes/circle.js");
	themes: typeof import("../themes/index.js");
	decimal: typeof import("./decimal-number.js");
};

beforeAll(async () => {
	modules = {
		metrics: await import("../spec/metrics.js"),
		context: await import("../scene/context.js"),
		graph: await import("../scene/graph.js"),
		text: await import("../scene/text.js"),
		composite: await import("../scene/composite.js"),
		fonts: await import("../scene/fonts.js"),
		circle: await import("../shapes/circle.js"),
		themes: await import("../themes/index.js"),
		decimal: await import("./decimal-number.js"),
	};
});

/** A graph committed by hand, counting scheduled commits and font-load callbacks. */
function manualGraph() {
	let scheduled = 0;
	let fontLoadsHeard = 0;
	const graph = new modules.graph.SceneGraph({
		schedule: () => {
			scheduled++;
		},
		onFontLoad: () => {
			fontLoadsHeard++;
		},
	});
	graph.root.provide(
		modules.context.themeContext,
		modules.themes.resolveTheme({ mode: "dark" }),
	);
	return {
		graph,
		commit: () => graph.commit(),
		scheduled: () => scheduled,
		fontLoadsHeard: () => fontLoadsHeard,
	};
}

describe("font-load invalidation", () => {
	it("re-measures a label's handle and reruns its geometry on loadingdone", () => {
		advance = 10;
		const { graph, commit, scheduled, fontLoadsHeard } = manualGraph();
		try {
			const node = graph.root.add(
				modules.text.text.create({ text: "ab", fontSize: 1 }),
			);
			commit();
			const width = node.width();
			expect(width).toBeGreaterThan(0);
			// The real font arrives: the cached fallback box is still served...
			advance = 15;
			expect(node.width()).toBe(width);
			// ...until the font set reports the load.
			const before = scheduled();
			const refreshes = graph.stats.refreshes;
			loadFont(15);
			expect(scheduled()).toBe(before + 1);
			expect(fontLoadsHeard()).toBe(1);
			commit();
			expect(graph.stats.refreshes).toBe(refreshes + 1);
			expect(node.width()).toBeCloseTo(width * 1.5, 9);
		} finally {
			graph.dispose();
		}
	});

	it("re-lays out a decimal number's glyphs and re-wraps text", () => {
		advance = 10;
		const { graph, commit } = manualGraph();
		try {
			const number = graph.root.add(
				modules.decimal.decimalNumber.create({
					value: 12,
					decimalPlaces: 0,
					fontSize: 1,
				}),
			);
			const text = "alpha beta gamma";
			const font = {
				fontSize: 0.4,
				fontFamily: modules.themes.resolveTheme({ mode: "dark" }).defaults
					.fontFamily,
				fontWeight: 500,
				italic: false,
				letterSpacing: 0,
			};
			// Wide enough for two words at the fallback's advance, not at the web font's.
			const measure =
				modules.metrics.measureLabel("alpha beta", font).width * 1.1;
			const block = graph.root.add(
				modules.text.text.create({
					text,
					width: measure,
					fontSize: 0.4,
				}),
			);
			const lines = () =>
				new Set((block.spec as TextSpec).fragments?.map((f) => f.offset.y))
					.size;
			commit();
			const numberWidth = number.width();
			expect(lines()).toBe(2);

			loadFont(20);
			commit();
			expect(number.width()).toBeCloseTo(numberWidth * 2, 9);
			expect(lines()).toBe(3);
		} finally {
			graph.dispose();
		}
	});

	it("subscribes once per graph, lazily, and stops with the graph", () => {
		const subscribe = vi.spyOn(modules.metrics.fontLoads, "subscribe");
		try {
			const shapes = manualGraph();
			shapes.graph.root.add(modules.circle.circle.create({ radius: 1 }));
			shapes.commit();
			// No text, no subscription.
			expect(subscribe).not.toHaveBeenCalled();

			const { graph, commit, fontLoadsHeard } = manualGraph();
			for (let i = 0; i < 5; i++) {
				graph.root.add(modules.text.text.create({ text: `n${i}` }));
			}
			graph.root.add(modules.decimal.decimalNumber.create({ value: 1 }));
			graph.root.add(modules.text.text.create({ text: "p\nq" }));
			commit();
			expect(subscribe).toHaveBeenCalledTimes(1);

			const shapesScheduled = shapes.scheduled();
			loadFont(11);
			expect(fontLoadsHeard()).toBe(1);
			// The text-free graph heard nothing and has nothing to do.
			expect(shapes.scheduled()).toBe(shapesScheduled);
			expect(shapes.fontLoadsHeard()).toBe(0);

			graph.dispose();
			loadFont(12);
			expect(fontLoadsHeard()).toBe(1);
			shapes.graph.dispose();
		} finally {
			subscribe.mockRestore();
		}
	});

	it("reruns only text: shapes beside it are not refreshed", () => {
		const { graph, commit } = manualGraph();
		try {
			for (let i = 0; i < 10; i++) {
				graph.root.add(modules.circle.circle.create({ radius: i + 1 }));
			}
			graph.root.add(modules.text.text.create({ text: "only me" }));
			commit();
			const frame = graph.frame;
			const refreshes = graph.stats.refreshes;
			loadFont(13);
			commit();
			expect(graph.stats.refreshes).toBe(refreshes + 1);
			// Nothing a spec carries changed: the frame is kept, the renderer
			// repaints through `onFontLoad`.
			expect(graph.frame).toBe(frame);
		} finally {
			graph.dispose();
		}
	});

	it("reruns a composite's update when it measures text, with the key in `changed`", () => {
		const { graph, commit } = manualGraph();
		const { defineComposite } = modules.composite;
		const { fontEpochContext, measuresText } = modules.fonts;
		const measuredChanges: unknown[][] = [];
		let plainUpdates = 0;
		const measured = defineComposite<{ text?: string }>({
			name: "Measured",
			props: { text: { default: "", invalidates: 64 } },
			setup: (ctx) => {
				measuresText(ctx);
				return [];
			},
			update: (changed) => {
				measuredChanges.push([...changed]);
				return undefined;
			},
		});
		const plain = defineComposite<{ text?: string }>({
			name: "Plain",
			props: { text: { default: "", invalidates: 64 } },
			setup: () => [],
			update: () => {
				plainUpdates++;
				return undefined;
			},
		});
		try {
			graph.root.add(measured.create());
			graph.root.add(plain.create());
			commit();
			loadFont(14);
			commit();
			expect(measuredChanges).toEqual([[fontEpochContext]]);
			expect(plainUpdates).toBe(0);
		} finally {
			graph.dispose();
		}
	});
});
