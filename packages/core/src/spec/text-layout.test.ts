import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetricsStyle } from "./metrics.js";
import { layoutText, resetTextMeasuring } from "./text-layout.js";

const font: MetricsStyle = {
	fontSize: 10,
	fontFamily: "sans-serif",
	fontWeight: 400,
	italic: false,
	letterSpacing: 0,
};
const bold: MetricsStyle = { ...font, fontWeight: 700 };

/** A 2D context whose every character is half an em wide. */
class HalfEmContext {
	font = "10px sans-serif";
	letterSpacing = "0px";
	measureText(text: string) {
		const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10);
		return { width: [...text].length * size * 0.5 };
	}
}

class StubCanvas {
	getContext() {
		return new HalfEmContext();
	}
}

const texts = (layout: ReturnType<typeof layoutText>) =>
	layout.fragments.map((fragment) => fragment.text);

describe("layoutText without a canvas", () => {
	beforeEach(() => resetTextMeasuring());

	it("keeps one line when no width is given", () => {
		const layout = layoutText([{ text: "one two three", font }]);
		expect(layout.lineCount).toBe(1);
		expect(texts(layout)).toEqual(["one two three"]);
		expect(layout.width).toBeCloseTo(layout.contentWidth);
	});

	it("breaks at newlines, keeping empty lines", () => {
		const layout = layoutText([{ text: "a\n\nb", font }]);
		expect(layout.lineCount).toBe(3);
		expect(layout.height).toBeCloseTo(3 * 13);
		expect(layout.fragments[1]?.baseline).toBeCloseTo(
			(layout.fragments[0]?.baseline ?? 0) + 26,
		);
	});

	it("wraps at spaces across runs", () => {
		const runs = [
			{ text: "aaa ", font },
			{ text: "bb", font: bold },
			{ text: "b cc", font },
		];
		const word = 3 * font.fontSize * 0.52;
		const layout = layoutText(runs, { width: word * 2.5 });
		// "bbb" crosses two runs and stays whole.
		expect(texts(layout)).toEqual(["aaa ", "bb", "b", "cc"]);
		expect(layout.lineCount).toBe(2);
		expect(layout.fragments[3]?.x).toBe(0);
	});
});

describe("layoutText with a canvas", () => {
	beforeEach(() => {
		vi.stubGlobal("OffscreenCanvas", StubCanvas);
		resetTextMeasuring();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		resetTextMeasuring();
	});

	it("measures in the runs' unit", () => {
		const layout = layoutText([
			{ text: "abcd", font: { ...font, fontSize: 0.4 } },
		]);
		expect(layout.contentWidth).toBeCloseTo(0.8);
		expect(layout.height).toBeCloseTo(0.52);
	});

	it("wraps, aligns and positions fragments", () => {
		const layout = layoutText(
			[
				{ text: "one ", font },
				{ text: "two", font: bold },
				{ text: " three", font },
			],
			{ width: 40, align: "center" },
		);
		// "one two" is 35 wide; "three" goes to the next line.
		expect(layout.lineCount).toBe(2);
		const [one, two, three] = layout.fragments;
		expect(one?.text).toBe("one");
		expect(two?.run).toBe(1);
		expect(two?.x).toBeCloseTo(2.5 + 20);
		expect(three?.text).toBe("three");
		expect(three?.x).toBeCloseTo((40 - 25) / 2);
		expect(three?.baseline).toBeCloseTo((one?.baseline ?? 0) + 13);
		expect(layout.width).toBe(40);
	});

	it("makes a line as tall as its largest font", () => {
		const layout = layoutText([
			{ text: "small ", font },
			{ text: "BIG", font: { ...font, fontSize: 20 } },
		]);
		expect(layout.height).toBeCloseTo(26);
		// Line box 26, glyphs 20, ascent 16: baseline at 3 + 16.
		expect(layout.firstBaseline).toBeCloseTo(19);
	});
});

describe("layoutText with inline runs", () => {
	beforeEach(() => {
		vi.stubGlobal("OffscreenCanvas", StubCanvas);
		resetTextMeasuring();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		resetTextMeasuring();
	});

	it("places an inline run like a word, and grows its line to hold it", () => {
		const layout = layoutText([
			{ text: "let ", font },
			{ inline: { width: 30, ascent: 20, descent: 5 } },
			{ text: " be", font },
		]);
		expect(layout.lineCount).toBe(1);
		const [, inline, after] = layout.fragments;
		expect(inline?.run).toBe(1);
		expect(inline?.x).toBeCloseTo(20);
		expect(inline?.width).toBeCloseTo(30);
		expect(after?.x).toBeCloseTo(50 + 5);
		// Taller than the text's 13: 20 above the baseline, 5 below.
		expect(layout.height).toBeCloseTo(25);
		expect(layout.firstBaseline).toBeCloseTo(20);
	});

	it("wraps before an inline run that does not fit", () => {
		const layout = layoutText(
			[
				{ text: "aaaa ", font },
				{ inline: { width: 30, ascent: 8, descent: 2 } },
			],
			{ width: 40 },
		);
		expect(layout.lineCount).toBe(2);
		expect(layout.fragments[1]?.x).toBe(0);
	});
});

describe("layoutText with inline runs and no canvas", () => {
	beforeEach(() => resetTextMeasuring());

	it("keeps an inline run beside the text it touches", () => {
		const layout = layoutText([
			{ text: "x", font },
			{ inline: { width: 30, ascent: 8, descent: 2 } },
			{ text: ".", font },
		]);
		expect(layout.fragments.map((f) => f.run)).toEqual([0, 1, 2]);
		expect(layout.fragments[1]?.width).toBe(30);
	});
});
