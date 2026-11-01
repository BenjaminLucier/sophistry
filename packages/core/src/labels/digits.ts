/**
 * Formatting a number and laying its characters out in fixed-width slots, for
 * `decimalNumber`. Canvas fonts cannot request tabular figures, so every digit
 * gets the widest digit's advance and is centred in its slot; a changing number
 * then holds still, and each character is addressable. Kerning is discarded,
 * which is exact for digits and signs but would be wrong for prose.
 */

import type { MetricsStyle } from "../spec/metrics.js";
import { measureLabel } from "../spec/metrics.js";

/**
 * U+2212. A hyphen is not a minus sign, and at this size you can tell.
 *
 * @category Scene registry & specs
 */
export const MINUS = "−";

const DIGITS = "0123456789";

/**
 * How {@link formatDecimal} writes a number: precision, sign, unit and separators.
 *
 * @category Scene registry & specs
 */
export interface NumberFormat {
	/**
	 * Fixed, not significant — Manim's `num_decimal_places`.
	 * @default 2
	 */
	decimalPlaces?: number;
	/** Show `+` on non-negative values, as Manim's `include_sign` does. */
	sign?: boolean;
	/**
	 * Appended verbatim, so it carries its own spacing: `unit=" m"`, `unit="°"`.
	 * A separate mobject with a buff in Manim; here it is part of the string and
	 * therefore part of the reveal.
	 */
	unit?: string;
	/** Trailing `…`, for a value being shown truncated. */
	ellipsis?: boolean;
	/** Thousands separators — Manim's `group_with_commas`. */
	groupDigits?: boolean;
	/** Defaults to `,`. */
	groupSeparator?: string;
	/** Defaults to `.`. */
	decimalSeparator?: string;
	/** Defaults to `−` (U+2212). */
	minusSign?: string;
}

/**
 * What `formatDecimal` produced, plus where the number part of it ends.
 *
 * @category Scene registry & specs
 */
export interface FormattedNumber {
	/** The full string to draw: sign, digits, separators, ellipsis and unit. */
	text: string;
	/**
	 * Length of the numeric body — everything before the unit and the ellipsis.
	 *
	 * Place values are only assigned within it, so `unit="m/s2"` does not put a
	 * `2` in the hundredths column.
	 */
	numericEnd: number;
	/** How many digits sit left of the separator, for `minIntegerDigits`. */
	integerDigits: number;
	/** Whether a sign character was emitted at all. */
	hasSign: boolean;
}

function groupInteger(digits: string, separator: string): string {
	let out = "";
	for (let i = 0; i < digits.length; i++) {
		if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
		out += digits[i];
	}
	return out;
}

/**
 * A number as the string that will be drawn.
 *
 * Sign is decided from the *rounded* magnitude rather than from the input, so
 * a value of −0.001 at two decimal places reads `0.00` rather than `−0.00` —
 * which is not a number anyone means. `NaN`, `Infinity` and `-Infinity` are
 * written as `NaN`, `∞` and `−∞`.
 *
 * @param value - The number to write.
 * @param format - Decimal places, sign, unit and separators; see {@link NumberFormat}.
 * @returns The text plus the bookkeeping {@link layoutGlyphs} needs.
 * @category Scene registry & specs
 */
export function formatDecimal(
	value: number,
	format: NumberFormat = {},
): FormattedNumber {
	const minus = format.minusSign ?? MINUS;
	const decimalSeparator = format.decimalSeparator ?? ".";

	if (!Number.isFinite(value)) {
		const text = Number.isNaN(value)
			? "NaN"
			: value > 0
				? format.sign
					? "+∞"
					: "∞"
				: `${minus}∞`;
		return { text, numericEnd: text.length, integerDigits: 0, hasSign: false };
	}

	const places = Math.max(0, Math.trunc(format.decimalPlaces ?? 2));
	const body = Math.abs(value).toFixed(places);
	const negative = value < 0 && Number(body) !== 0;
	const sign = negative ? minus : format.sign ? "+" : "";

	const dot = body.indexOf(".");
	const whole = dot === -1 ? body : body.slice(0, dot);
	const fraction = dot === -1 ? "" : body.slice(dot + 1);

	const grouped = format.groupDigits
		? groupInteger(whole, format.groupSeparator ?? ",")
		: whole;

	const numeric =
		sign + grouped + (fraction ? decimalSeparator + fraction : "");

	return {
		text: numeric + (format.ellipsis ? "…" : "") + (format.unit ?? ""),
		numericEnd: numeric.length,
		integerDigits: whole.length,
		hasSign: sign !== "",
	};
}

/**
 * Which characters share an advance width.
 *
 * @category Scene registry & specs
 */
export type SlotKind = "digit" | "sign" | "other";

/**
 * One character's column in a {@link GlyphRun}.
 *
 * @category Scene registry & specs
 */
export interface GlyphSlot {
	/**
	 * Index into the formatted text, or −1 for a reserved blank slot. Blank
	 * slots hold a column open and draw nothing.
	 */
	index: number;
	/** Empty for a reserved slot. */
	char: string;
	kind: SlotKind;
	/** Advance width, device pixels. */
	advance: number;
	/** Slot centre, device pixels from the run's left edge. */
	center: number;
	/**
	 * 0 for the units column, 1 for tens, −1 for tenths. Undefined for anything
	 * that isn't a digit inside the numeric body.
	 */
	place?: number;
}

/**
 * The result of {@link layoutGlyphs}: every slot, and the run's total width.
 *
 * @category Scene registry & specs
 */
export interface GlyphRun {
	/** One slot per character, left to right (reserved blank slots first). */
	slots: GlyphSlot[];
	/** Total advance, device pixels. */
	width: number;
}

/**
 * Options for {@link layoutGlyphs}.
 *
 * @category Scene registry & specs
 */
export interface GlyphLayoutOptions {
	/**
	 * Give every digit the widest digit's advance.
	 * @default true
	 */
	tabular?: boolean;
	/** Blank digit slots prepended, to hold a minimum width open. */
	padDigits?: number;
	/** A blank sign slot prepended, so a positive value reserves the room. */
	padSign?: boolean;
	/** See `FormattedNumber.numericEnd`. Defaults to the whole string. */
	numericEnd?: number;
	/** Defaults to `.`. */
	decimalSeparator?: string;
	/** Defaults to `−`, and is classed with `+`. */
	minusSign?: string;
}

function kindOf(char: string, minus: string): SlotKind {
	if (DIGITS.includes(char)) return "digit";
	if (char === "+" || char === "-" || char === minus) return "sign";
	return "other";
}

/**
 * Widest advance among `chars`, so a class of characters can share a column.
 *
 * Measured one character at a time with spacing off: `measureLabel` caches on
 * the string, and there are only a dozen distinct characters in a number, so a
 * counter ticking through a thousand values still only ever measures twelve
 * things. Letter spacing is added between slots below rather than folded into
 * the advance, which would count it once too often at the end of the run.
 */
function classWidth(chars: string[], style: MetricsStyle): number {
	let widest = 0;
	for (const char of chars) {
		const { width } = measureLabel(char, { ...style, letterSpacing: 0 });
		if (width > widest) widest = width;
	}
	return widest;
}

/**
 * Place value per character index, over the numeric body only.
 *
 * Counted in digits rather than in characters, so a thousands separator does
 * not shift the columns it is standing between.
 */
function placeValues(
	text: string,
	numericEnd: number,
	decimalSeparator: string,
): (number | undefined)[] {
	const places: (number | undefined)[] = new Array(text.length);
	const dot = text.indexOf(decimalSeparator);
	const intEnd = dot === -1 || dot >= numericEnd ? numericEnd : dot;

	let place = 0;
	for (let i = intEnd - 1; i >= 0; i--) {
		if (DIGITS.includes(text[i])) places[i] = place++;
	}

	if (intEnd < numericEnd) {
		place = -1;
		for (let i = intEnd + decimalSeparator.length; i < numericEnd; i++) {
			if (DIGITS.includes(text[i])) places[i] = place--;
		}
	}

	return places;
}

/**
 * One slot per character, in device pixels, laid out left to right.
 *
 * Reserved slots come first — a right-aligned numeric field, which is the
 * arrangement that keeps columns of digits under each other whether or not a
 * sign is present.
 *
 * @param text - The formatted string, usually `FormattedNumber.text`.
 * @param style - Font settings used to measure each character (sizes in device pixels).
 * @param options - Tabular figures, reserved slots and separators; see {@link GlyphLayoutOptions}.
 * @returns The slots and total width, in device pixels.
 *
 * @category Scene registry & specs
 */
export function layoutGlyphs(
	text: string,
	style: MetricsStyle,
	options: GlyphLayoutOptions = {},
): GlyphRun {
	const minus = options.minusSign ?? MINUS;
	const tabular = options.tabular !== false;
	const spacing = style.letterSpacing ?? 0;
	const numericEnd = Math.min(options.numericEnd ?? text.length, text.length);

	const digitWidth = tabular ? classWidth(DIGITS.split(""), style) : Number.NaN;
	const signWidth = tabular ? classWidth(["+", minus], style) : Number.NaN;
	const places = placeValues(text, numericEnd, options.decimalSeparator ?? ".");

	const advanceFor = (char: string, kind: SlotKind): number => {
		if (tabular && kind === "digit") return digitWidth;
		if (tabular && kind === "sign") return signWidth;
		return measureLabel(char, { ...style, letterSpacing: 0 }).width;
	};

	const slots: GlyphSlot[] = [];
	let cursor = 0;

	const push = (
		index: number,
		char: string,
		kind: SlotKind,
		place?: number,
	) => {
		const advance =
			char === ""
				? kind === "sign"
					? signWidth
					: digitWidth
				: advanceFor(char, kind);
		if (slots.length > 0) cursor += spacing;
		slots.push({
			index,
			char,
			kind,
			advance,
			center: cursor + advance / 2,
			place,
		});
		cursor += advance;
	};

	if (options.padSign && tabular) push(-1, "", "sign");
	for (let i = 0; i < (tabular ? (options.padDigits ?? 0) : 0); i++) {
		push(-1, "", "digit");
	}
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		push(i, char, kindOf(char, minus), i < numericEnd ? places[i] : undefined);
	}

	return { slots, width: cursor };
}
