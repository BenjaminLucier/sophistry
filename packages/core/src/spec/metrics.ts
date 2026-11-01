/**
 * The text-metrics oracle: one lazily created offscreen context used only for
 * `measureText`, so a `<Label>` can report its box for layout. It never draws.
 * Without a `document` (SSR) measurements fall back to an em-based estimate.
 */

import type { Bounds } from "../geometry/index.js";
import type { TextStyle } from "./types.js";

/**
 * Everything that changes a string's advance width. `fontSize` and
 * `letterSpacing` are in whatever length unit the caller works in — scene units
 * for specs, pixels for a caller that already has them — and the measurements
 * come back in that same unit (see {@link measureLabel}).
 *
 * @category Scene registry & specs
 */
export type MetricsStyle = Pick<
	TextStyle,
	"fontSize" | "fontFamily" | "fontWeight" | "italic" | "letterSpacing"
>;

/**
 * Where the box sits relative to the anchor, on top of `MetricsStyle`.
 *
 * @category Scene registry & specs
 */
export type BoxStyle = MetricsStyle & Pick<TextStyle, "align" | "baseline">;

/**
 * In the unit of the style it was measured with. `ascent`/`descent` are measured from the alphabetic baseline.
 *
 * @category Scene registry & specs
 */
export interface LabelMetrics {
	/** Advance width of the string. */
	width: number;
	/** Height of the ink above the baseline. */
	ascent: number;
	/** Depth of the ink below the baseline. */
	descent: number;
}

// Rough proportions of a humanist sans, used only when there is no DOM.
const EM_WIDTH = 0.52;
const EM_ASCENT = 0.72;
const EM_DESCENT = 0.21;

/**
 * Entries kept before the least recently used one is evicted.
 *
 * An LRU, so an animating `<DecimalNumber>` (a new string every frame) cannot
 * evict the scene's stable measurements.
 */
const CACHE_LIMIT = 512;

const cache = new Map<string, LabelMetrics>();

/** `undefined` means "not tried yet", `null` means "no DOM here". */
let oracle: CanvasRenderingContext2D | null | undefined;

/** How many times a web font has finished loading; see {@link fontLoads}. */
let fontEpoch = 0;
const fontListeners = new Set<() => void>();

/**
 * Bumped each time `document.fonts` finishes loading a font. A string measured
 * before its font arrived has the fallback font's box, so the measurement
 * cache is dropped and every subscriber is told: the scene re-runs whatever
 * layout measured text, and the renderer repaints.
 *
 * Shaped like the reactive layer's `Readable<number>` (`peek`, `subscribe`)
 * without importing it, so `spec/` stays below `reactive/`. Subscribing is
 * what starts the `document.fonts` listener, as does the first measurement.
 *
 * @category Scene registry & specs
 */
export const fontLoads = {
	/** The current font epoch: 0 until the first font load. */
	peek(): number {
		return fontEpoch;
	},
	/**
	 * Calls `onStale` after every font load. Returns unsubscribe.
	 *
	 * @param onStale - Told that measurements may have changed.
	 */
	subscribe(onStale: () => void): () => void {
		watchFonts();
		fontListeners.add(onStale);
		return () => {
			fontListeners.delete(onStale);
		};
	},
};

let watchingFonts = false;

/** Starts listening to `document.fonts`, once, where there is one. */
function watchFonts(): void {
	if (watchingFonts) return;
	watchingFonts = true;
	const fonts =
		typeof document === "undefined"
			? undefined
			: (document as { fonts?: EventTarget }).fonts;
	if (typeof fonts?.addEventListener !== "function") return;
	fonts.addEventListener("loadingdone", () => {
		cache.clear();
		fontEpoch++;
		for (const listener of [...fontListeners]) listener();
	});
}

function context(): CanvasRenderingContext2D | null {
	if (oracle !== undefined) return oracle;
	watchFonts();
	oracle =
		typeof document === "undefined"
			? null
			: document.createElement("canvas").getContext("2d");
	return oracle;
}

/**
 * Builds the canvas `font` shorthand (for example `"italic 400 24px serif"`)
 * from a text style. The one copy: the renderer re-exports it from
 * `render/paint.ts`, so what is measured here is what gets painted.
 *
 * @param style - The text style; `fontSize` is read as pixels.
 * @param scale - Multiplies `fontSize`. The renderer passes the view's scale so
 * a scene-unit font size becomes the pixel size glyphs are drawn at.
 *
 * @category Renderer & paint
 */
export function fontString(style: MetricsStyle, scale = 1): string {
	const italic = style.italic ? "italic " : "";
	return `${italic}${style.fontWeight} ${style.fontSize * scale}px ${style.fontFamily}`;
}

function finite(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * The font size the oracle actually measures at. Specs carry font sizes in
 * *scene units* — `0.35` is an ordinary size — and asking a canvas to measure a
 * 0.35px font is asking for browser minimum-size clamps and hinting noise. So a
 * string is measured once at this size and the result scaled linearly to the
 * requested one, which also means every size of the same string shares one
 * cache entry.
 */
const REFERENCE_SIZE = 64;

/**
 * Advance width and ink extent of `text`, in the unit the style's `fontSize`
 * and `letterSpacing` are in (scene units for specs).
 *
 * Ascent/descent come from the *ink* box (`actualBoundingBox*`) where the
 * browser offers it, so a caption of lowercase letters sits as tightly under a
 * shape as it looks like it should; the font box is the fallback. Measured at a
 * fixed reference size and scaled (see {@link REFERENCE_SIZE}), cached (LRU,
 * 512 entries, dropped when `document.fonts` finishes loading a font; see
 * {@link fontLoads} to hear about that). Without a DOM, an estimate from the
 * font size is returned instead.
 *
 * @param text - The string to measure. Empty gives all zeros.
 * @param style - Font size, family, weight, italic and letter spacing.
 * @returns Width, ascent and descent in the style's length unit.
 *
 * @category Scene registry & specs
 */
export function measureLabel(text: string, style: MetricsStyle): LabelMetrics {
	if (!text || !(style.fontSize > 0))
		return { width: 0, ascent: 0, descent: 0 };
	const k = style.fontSize / REFERENCE_SIZE;
	const reference = measureAtReference(text, {
		...style,
		fontSize: REFERENCE_SIZE,
		letterSpacing: (style.letterSpacing ?? 0) / k,
	});
	return {
		width: reference.width * k,
		ascent: reference.ascent * k,
		descent: reference.descent * k,
	};
}

function measureAtReference(text: string, style: MetricsStyle): LabelMetrics {
	const font = fontString(style);
	const spacing = style.letterSpacing ?? 0;
	const key = `${font}\u0000${spacing}\u0000${text}`;
	const hit = cache.get(key);
	if (hit) {
		// Re-insert to refresh recency: a `Map` iterates in insertion order, which
		// is the whole of the LRU bookkeeping.
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}

	const ctx = context();
	let result: LabelMetrics;

	if (!ctx) {
		result = {
			width: text.length * style.fontSize * EM_WIDTH + spacing * text.length,
			ascent: style.fontSize * EM_ASCENT,
			descent: style.fontSize * EM_DESCENT,
		};
	} else {
		ctx.font = font;
		// Where the browser supports it, letting it apply the spacing keeps the
		// measurement identical to what the renderer will actually draw.
		const native = "letterSpacing" in ctx;
		if (native) ctx.letterSpacing = `${spacing}px`;
		const measured = ctx.measureText(text);
		if (native) ctx.letterSpacing = "0px";

		result = {
			width: measured.width + (native ? 0 : spacing * text.length),
			ascent: finite(
				measured.actualBoundingBoxAscent,
				finite(measured.fontBoundingBoxAscent, style.fontSize * EM_ASCENT),
			),
			descent: finite(
				measured.actualBoundingBoxDescent,
				finite(measured.fontBoundingBoxDescent, style.fontSize * EM_DESCENT),
			),
		};
	}

	if (cache.size >= CACHE_LIMIT) {
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}
	cache.set(key, result);
	return result;
}

/**
 * The label's box relative to its anchor, in the style's length unit.
 *
 * `align` decides where the anchor sits horizontally and `baseline` where it
 * sits vertically, exactly as the canvas will place the glyphs. Glyphs are
 * always drawn upright on screen, so on a y-down view (`yUp: false`, scene `y`
 * running down the screen) the vertical offsets flip.
 *
 * @param text - The string to measure.
 * @param style - The metrics style plus `align` and `baseline`.
 * @param yUp - Whether scene `y` increases upward on screen. Defaults to true.
 * @returns A box relative to the anchor, in the style's unit.
 *
 * @category Scene registry & specs
 */
export function labelBox(text: string, style: BoxStyle, yUp = true): Bounds {
	const { width, ascent, descent } = measureLabel(text, style);
	const height = ascent + descent;

	let minX = -width / 2;
	if (style.align === "left" || style.align === "start") minX = 0;
	else if (style.align === "right" || style.align === "end") minX = -width;

	// Offset of the box's top from the anchor, y-up.
	let top = ascent;
	switch (style.baseline) {
		case "top":
		case "hanging":
			top = 0;
			break;
		case "middle":
			top = height / 2;
			break;
		case "bottom":
		case "ideographic":
			top = height;
			break;
		default:
			top = ascent;
	}

	return yUp
		? { minX, minY: top - height, maxX: minX + width, maxY: top }
		: { minX, minY: -top, maxX: minX + width, maxY: height - top };
}
