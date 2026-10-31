import { describe, expect, it } from "vitest";
import type { MetricsStyle } from "../spec/metrics";
import { formatDecimal, layoutGlyphs, MINUS } from "./digits";

describe("formatDecimal", () => {
	it("formats a positive number with the default 2 decimal places", () => {
		const f = formatDecimal(3.14762);
		expect(f.text).toBe("3.15");
		expect(f.hasSign).toBe(false);
		expect(f.integerDigits).toBe(1);
		expect(f.numericEnd).toBe(f.text.length);
	});

	it("formats a negative number with the minus sign", () => {
		const f = formatDecimal(-2.5);
		expect(f.text).toBe(`${MINUS}2.50`);
		expect(f.hasSign).toBe(true);
	});

	it("sign adds a plus for non-negative values", () => {
		expect(formatDecimal(5, { sign: true }).text).toBe("+5.00");
		expect(formatDecimal(0, { sign: true }).text).toBe("+0.00");
	});

	it("a small negative value that rounds to zero shows unsigned 0, not -0", () => {
		// -0.001 at 2 decimal places rounds to "0.00" — no sign should appear.
		const f = formatDecimal(-0.001, { decimalPlaces: 2 });
		expect(f.text).toBe("0.00");
		expect(f.hasSign).toBe(false);
	});

	it("a small negative value that rounds to zero still respects sign as +", () => {
		const f = formatDecimal(-0.001, { decimalPlaces: 2, sign: true });
		expect(f.text).toBe("+0.00");
	});

	it("a negative value that rounds to a nonzero magnitude keeps its minus sign", () => {
		const f = formatDecimal(-0.005, { decimalPlaces: 2 });
		// toFixed(2) on 0.005 rounds to "0.01" or "0.00" depending on FP rounding;
		// either way, the sign must agree with whether the rounded body is zero.
		const isZero = f.text.replace(MINUS, "") === "0.00";
		expect(f.hasSign).toBe(!isZero);
	});

	it("decimalPlaces of 0 rounds to an integer with no separator", () => {
		const f = formatDecimal(3.7, { decimalPlaces: 0 });
		expect(f.text).toBe("4");
	});

	it("negative decimalPlaces is clamped to 0", () => {
		expect(formatDecimal(3.7, { decimalPlaces: -2 }).text).toBe("4");
	});

	it("non-integer decimalPlaces is truncated", () => {
		expect(formatDecimal(3.14762, { decimalPlaces: 2.9 }).text).toBe("3.15");
	});

	it("NaN formats as the literal string 'NaN'", () => {
		const f = formatDecimal(Number.NaN);
		expect(f.text).toBe("NaN");
		expect(f.hasSign).toBe(false);
	});

	it("+Infinity and -Infinity format with the infinity symbol", () => {
		expect(formatDecimal(Number.POSITIVE_INFINITY).text).toBe("∞");
		expect(formatDecimal(Number.NEGATIVE_INFINITY).text).toBe(`${MINUS}∞`);
	});

	it("sign affects +Infinity but -Infinity always shows its sign", () => {
		expect(formatDecimal(Number.POSITIVE_INFINITY, { sign: true }).text).toBe(
			"+∞",
		);
	});

	it("groupDigits inserts thousands separators on the integer part only", () => {
		const f = formatDecimal(1234567.891, { groupDigits: true });
		expect(f.text).toBe("1,234,567.89");
	});

	it("groupDigits respects a custom separator", () => {
		const f = formatDecimal(1234.5, { groupDigits: true, groupSeparator: " " });
		expect(f.text).toBe("1 234.50");
	});

	it("groupDigits with fewer than 4 integer digits adds no separator", () => {
		expect(
			formatDecimal(999, { groupDigits: true, decimalPlaces: 0 }).text,
		).toBe("999");
	});

	it("unit is appended verbatim after the number and ellipsis", () => {
		const f = formatDecimal(9.8, { unit: " m/s", decimalPlaces: 1 });
		expect(f.text).toBe("9.8 m/s");
		// numericEnd excludes the unit.
		expect(f.numericEnd).toBe("9.8".length);
	});

	it("ellipsis appends the ellipsis before the unit", () => {
		const f = formatDecimal(9.8, {
			unit: "m",
			ellipsis: true,
			decimalPlaces: 1,
		});
		expect(f.text).toBe("9.8…m");
		expect(f.numericEnd).toBe("9.8".length);
	});

	it("a custom decimal separator and minus sign are honoured", () => {
		const f = formatDecimal(-3.5, { decimalSeparator: ",", minusSign: "-" });
		expect(f.text).toBe("-3,50");
	});

	it("integerDigits counts only the whole-number part, ungrouped", () => {
		const f = formatDecimal(1234.5, { groupDigits: true });
		expect(f.integerDigits).toBe(4);
	});
});

const style: MetricsStyle = {
	fontSize: 16,
	fontFamily: "sans-serif",
	fontWeight: 400,
	italic: false,
	letterSpacing: 0,
};

describe("layoutGlyphs", () => {
	it("lays out one slot per character", () => {
		const run = layoutGlyphs("3.14", style);
		expect(run.slots).toHaveLength(4);
		expect(run.slots.map((s) => s.char)).toEqual(["3", ".", "1", "4"]);
		expect(run.width).toBeGreaterThan(0);
	});

	it("tabular mode gives every digit the same advance width", () => {
		const run = layoutGlyphs("1234567890", style, { tabular: true });
		const digitSlots = run.slots.filter((s) => s.kind === "digit");
		const advances = new Set(digitSlots.map((s) => s.advance));
		expect(advances.size).toBe(1);
	});

	it("non-tabular mode may give digits different advances (no forced equality)", () => {
		const run = layoutGlyphs("1", style, { tabular: false });
		expect(run.slots).toHaveLength(1);
		// Just confirms it doesn't throw and produces a sane width.
		expect(run.slots[0].advance).toBeGreaterThan(0);
	});

	it("assigns place values around the decimal point within the numeric body", () => {
		const text = "12.34";
		const run = layoutGlyphs(text, style, { numericEnd: text.length });
		const places = run.slots.map((s) => s.place);
		// "1"=tens(1), "2"=units(0), "."=undefined, "3"=tenths(-1), "4"=hundredths(-2)
		expect(places).toEqual([1, 0, undefined, -1, -2]);
	});

	it("does not assign place values to a unit suffix outside numericEnd", () => {
		const text = "9.8m/s2";
		const numericEnd = "9.8".length;
		const run = layoutGlyphs(text, style, { numericEnd });
		const unitDigit = run.slots.find((s) => s.index === text.length - 1);
		expect(unitDigit?.char).toBe("2");
		expect(unitDigit?.place).toBeUndefined();
	});

	it("padDigits prepends blank reserved digit slots", () => {
		const run = layoutGlyphs("5", style, { padDigits: 2 });
		expect(run.slots).toHaveLength(3);
		expect(run.slots[0]).toMatchObject({ index: -1, char: "", kind: "digit" });
		expect(run.slots[1]).toMatchObject({ index: -1, char: "", kind: "digit" });
		expect(run.slots[2]).toMatchObject({ index: 0, char: "5" });
	});

	it("padSign prepends a blank reserved sign slot", () => {
		const run = layoutGlyphs("5", style, { padSign: true });
		expect(run.slots).toHaveLength(2);
		expect(run.slots[0]).toMatchObject({ index: -1, char: "", kind: "sign" });
	});

	it("padSign and padDigits together reserve room in sign-then-digits order", () => {
		const run = layoutGlyphs("5", style, { padSign: true, padDigits: 1 });
		expect(run.slots.map((s) => s.kind)).toEqual(["sign", "digit", "digit"]);
	});

	it("padSign/padDigits are no-ops when tabular is false", () => {
		const run = layoutGlyphs("5", style, {
			padSign: true,
			padDigits: 2,
			tabular: false,
		});
		expect(run.slots).toHaveLength(1);
	});

	it("slots are centred left-to-right with increasing centre positions", () => {
		const run = layoutGlyphs("123", style);
		const centres = run.slots.map((s) => s.center);
		expect(centres[0]).toBeLessThan(centres[1]);
		expect(centres[1]).toBeLessThan(centres[2]);
	});

	it("letterSpacing widens the total run", () => {
		const spaced = layoutGlyphs("123", { ...style, letterSpacing: 5 });
		const tight = layoutGlyphs("123", style);
		expect(spaced.width).toBeGreaterThan(tight.width);
	});

	it("an empty string produces zero width and no slots", () => {
		const run = layoutGlyphs("", style);
		expect(run.slots).toHaveLength(0);
		expect(run.width).toBe(0);
	});

	it("sign characters ('+', '-', minus sign) are classed as 'sign'", () => {
		const run = layoutGlyphs(`+${MINUS}-`, style);
		expect(run.slots.every((s) => s.kind === "sign")).toBe(true);
	});

	it("non-digit, non-sign characters (a unit suffix) are classed as 'other'", () => {
		const run = layoutGlyphs("m", style);
		expect(run.slots[0].kind).toBe("other");
	});
});
