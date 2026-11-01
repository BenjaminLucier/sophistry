/// <reference path="./assets.d.ts" />
/// <reference path="./opentype.d.ts" />

/**
 * The KaTeX font files, as outlines.
 *
 * The reference above is load-bearing and must stay at the top of the file:
 * opentype.js ships no types, and a consumer compiling this source (which is
 * how the sophistry packages are published) has no other way to see the local shim —
 * its own `include` covers its own `src`, not ours.
 *
 * KaTeX ships the Computer Modern derivatives it typesets with as ordinary web
 * fonts, so the same file the browser rasterises for the DOM can be handed to
 * opentype.js and asked for contours instead. That is the whole trick behind
 * this module: there is no second source of glyph shapes to keep in sync — the
 * canvas draws the *same* outlines the DOM does, at the positions the DOM's own
 * layout put them (see `measure.ts`).
 *
 * The URLs are static `?url` imports rather than a computed path because a
 * bundler has to see them to emit the assets. They are only strings until
 * something asks for a face, so importing this module downloads nothing; a
 * formula in `KaTeX_Math-Italic` fetches one file, not twenty.
 */

import amsRegular from "katex/dist/fonts/KaTeX_AMS-Regular.ttf?url&no-inline";
import caligraphicBold from "katex/dist/fonts/KaTeX_Caligraphic-Bold.ttf?url&no-inline";
import caligraphicRegular from "katex/dist/fonts/KaTeX_Caligraphic-Regular.ttf?url&no-inline";
import frakturBold from "katex/dist/fonts/KaTeX_Fraktur-Bold.ttf?url&no-inline";
import frakturRegular from "katex/dist/fonts/KaTeX_Fraktur-Regular.ttf?url&no-inline";
import mainBold from "katex/dist/fonts/KaTeX_Main-Bold.ttf?url&no-inline";
import mainBoldItalic from "katex/dist/fonts/KaTeX_Main-BoldItalic.ttf?url&no-inline";
import mainItalic from "katex/dist/fonts/KaTeX_Main-Italic.ttf?url&no-inline";
import mainRegular from "katex/dist/fonts/KaTeX_Main-Regular.ttf?url&no-inline";
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.ttf?url&no-inline";
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.ttf?url&no-inline";
import sansSerifBold from "katex/dist/fonts/KaTeX_SansSerif-Bold.ttf?url&no-inline";
import sansSerifItalic from "katex/dist/fonts/KaTeX_SansSerif-Italic.ttf?url&no-inline";
import sansSerifRegular from "katex/dist/fonts/KaTeX_SansSerif-Regular.ttf?url&no-inline";
import scriptRegular from "katex/dist/fonts/KaTeX_Script-Regular.ttf?url&no-inline";
import size1Regular from "katex/dist/fonts/KaTeX_Size1-Regular.ttf?url&no-inline";
import size2Regular from "katex/dist/fonts/KaTeX_Size2-Regular.ttf?url&no-inline";
import size3Regular from "katex/dist/fonts/KaTeX_Size3-Regular.ttf?url&no-inline";
import size4Regular from "katex/dist/fonts/KaTeX_Size4-Regular.ttf?url&no-inline";
import typewriterRegular from "katex/dist/fonts/KaTeX_Typewriter-Regular.ttf?url&no-inline";
import type { OpenTypeFont } from "./opentype-font.js";

/**
 * A resolved face name, exactly as KaTeX names its files.
 *
 * @category Fonts
 */
export type FaceName =
	| "KaTeX_AMS-Regular"
	| "KaTeX_Caligraphic-Bold"
	| "KaTeX_Caligraphic-Regular"
	| "KaTeX_Fraktur-Bold"
	| "KaTeX_Fraktur-Regular"
	| "KaTeX_Main-Bold"
	| "KaTeX_Main-BoldItalic"
	| "KaTeX_Main-Italic"
	| "KaTeX_Main-Regular"
	| "KaTeX_Math-BoldItalic"
	| "KaTeX_Math-Italic"
	| "KaTeX_SansSerif-Bold"
	| "KaTeX_SansSerif-Italic"
	| "KaTeX_SansSerif-Regular"
	| "KaTeX_Script-Regular"
	| "KaTeX_Size1-Regular"
	| "KaTeX_Size2-Regular"
	| "KaTeX_Size3-Regular"
	| "KaTeX_Size4-Regular"
	| "KaTeX_Typewriter-Regular";

const FACE_URLS: Record<FaceName, string> = {
	"KaTeX_AMS-Regular": amsRegular,
	"KaTeX_Caligraphic-Bold": caligraphicBold,
	"KaTeX_Caligraphic-Regular": caligraphicRegular,
	"KaTeX_Fraktur-Bold": frakturBold,
	"KaTeX_Fraktur-Regular": frakturRegular,
	"KaTeX_Main-Bold": mainBold,
	"KaTeX_Main-BoldItalic": mainBoldItalic,
	"KaTeX_Main-Italic": mainItalic,
	"KaTeX_Main-Regular": mainRegular,
	"KaTeX_Math-BoldItalic": mathBoldItalic,
	"KaTeX_Math-Italic": mathItalic,
	"KaTeX_SansSerif-Bold": sansSerifBold,
	"KaTeX_SansSerif-Italic": sansSerifItalic,
	"KaTeX_SansSerif-Regular": sansSerifRegular,
	"KaTeX_Script-Regular": scriptRegular,
	"KaTeX_Size1-Regular": size1Regular,
	"KaTeX_Size2-Regular": size2Regular,
	"KaTeX_Size3-Regular": size3Regular,
	"KaTeX_Size4-Regular": size4Regular,
	"KaTeX_Typewriter-Regular": typewriterRegular,
};

/**
 * Which variants each family actually ships.
 *
 * Not every family has four faces — `KaTeX_Math` is italic-only, because there
 * is no such thing as an upright math variable in TeX, and the size families
 * are single-face. The lookup below falls back through this table rather than
 * failing, so a `\mathbf` inside a `\mathscr` renders in Script-Regular instead
 * of rendering as nothing.
 */
const FAMILY_VARIANTS: Record<
	string,
	Partial<Record<"regular" | "bold" | "italic" | "boldItalic", FaceName>>
> = {
	KaTeX_AMS: { regular: "KaTeX_AMS-Regular" },
	KaTeX_Caligraphic: {
		regular: "KaTeX_Caligraphic-Regular",
		bold: "KaTeX_Caligraphic-Bold",
	},
	KaTeX_Fraktur: {
		regular: "KaTeX_Fraktur-Regular",
		bold: "KaTeX_Fraktur-Bold",
	},
	KaTeX_Main: {
		regular: "KaTeX_Main-Regular",
		bold: "KaTeX_Main-Bold",
		italic: "KaTeX_Main-Italic",
		boldItalic: "KaTeX_Main-BoldItalic",
	},
	KaTeX_Math: {
		italic: "KaTeX_Math-Italic",
		boldItalic: "KaTeX_Math-BoldItalic",
	},
	KaTeX_SansSerif: {
		regular: "KaTeX_SansSerif-Regular",
		bold: "KaTeX_SansSerif-Bold",
		italic: "KaTeX_SansSerif-Italic",
	},
	KaTeX_Script: { regular: "KaTeX_Script-Regular" },
	KaTeX_Size1: { regular: "KaTeX_Size1-Regular" },
	KaTeX_Size2: { regular: "KaTeX_Size2-Regular" },
	KaTeX_Size3: { regular: "KaTeX_Size3-Regular" },
	KaTeX_Size4: { regular: "KaTeX_Size4-Regular" },
	KaTeX_Typewriter: { regular: "KaTeX_Typewriter-Regular" },
};

/**
 * Every font family name KaTeX can put on the page (e.g. `KaTeX_Main`), for the pre-measure font warm-up.
 *
 * @category Fonts
 */
export const KATEX_FAMILIES = Object.keys(FAMILY_VARIANTS);

/**
 * Picks the face a computed style is asking for.
 *
 * `fontFamily` arrives from `getComputedStyle` and may be a stack — KaTeX's own
 * rules name exactly one family, but a page-level `font-family` can leak in on
 * spans KaTeX left unstyled (the `.mspace` runs, mostly, which carry no text).
 * Anything unrecognised lands on `KaTeX_Main-Regular`, which is what KaTeX
 * itself falls back to.
 *
 * @param fontFamily - Computed `font-family`, possibly a comma-separated stack.
 * @param fontWeight - Computed `font-weight`: a keyword or number; 600 and up counts as bold.
 * @param fontStyle - Computed `font-style`; `italic` and `oblique` count as italic.
 * @returns The closest available KaTeX face.
 *
 * @category Fonts
 */
export function resolveFace(
	fontFamily: string,
	fontWeight: string,
	fontStyle: string,
): FaceName {
	const family =
		fontFamily
			.split(",")
			.map((name) => name.trim().replace(/^["']|["']$/g, ""))
			.find((name) => name in FAMILY_VARIANTS) ?? "KaTeX_Main";

	const numericWeight = Number.parseInt(fontWeight, 10);
	const bold = fontWeight === "bold" || (numericWeight || 400) >= 600;
	const italic = fontStyle.startsWith("italic") || fontStyle.startsWith("obli");

	const variants = FAMILY_VARIANTS[family];
	const wanted =
		bold && italic
			? "boldItalic"
			: bold
				? "bold"
				: italic
					? "italic"
					: "regular";

	// Degrade one axis at a time — a missing bold-italic prefers italic over
	// bold, because in maths the slant carries meaning and the weight is
	// emphasis.
	const order =
		wanted === "boldItalic"
			? (["boldItalic", "italic", "bold", "regular"] as const)
			: wanted === "italic"
				? (["italic", "boldItalic", "regular", "bold"] as const)
				: wanted === "bold"
					? (["bold", "regular", "boldItalic", "italic"] as const)
					: (["regular", "italic", "bold", "boldItalic"] as const);

	for (const variant of order) {
		const face = variants[variant];
		if (face) return face;
	}
	return "KaTeX_Main-Regular";
}

/**
 * opentype.js, imported with the first face rather than with the module: only
 * typesetting needs it, so a scene that never shows a formula never loads it,
 * and tools that merely read this package's definitions under plain Node
 * (codegen) never meet its UMD build.
 */
let opentype: Promise<typeof import("opentype.js")> | null = null;

/** One in-flight or settled parse per face, so a face is fetched at most once. */
const faces = new Map<FaceName, Promise<OpenTypeFont>>();

/**
 * Fetches and parses one KaTeX font file with opentype.js, for its outlines.
 * Repeat calls share the first promise; a failed fetch is not cached.
 *
 * @param name - The face to load, as returned by {@link resolveFace}.
 * @returns The parsed font.
 *
 * @category Fonts
 */
export function loadFace(name: FaceName): Promise<OpenTypeFont> {
	const existing = faces.get(name);
	if (existing) return existing;

	const pending = fetch(FACE_URLS[name])
		.then((response) => {
			if (!response.ok) {
				throw new Error(`${name}: ${response.status} ${response.statusText}`);
			}
			return response.arrayBuffer();
		})
		.then(async (buffer) => {
			opentype ??= import("opentype.js");
			return (await opentype).parse(buffer);
		})
		.catch((error: unknown) => {
			// A failed fetch must not poison the cache: a formula rendered again
			// after the network came back should get a second chance.
			faces.delete(name);
			throw error;
		});

	faces.set(name, pending);
	return pending;
}

/**
 * Waits for the browser to have the *webfont* form of every KaTeX family.
 *
 * Separate from `loadFace`, and both are needed. opentype.js supplies the
 * contours; the browser's copy decides where KaTeX's HTML layout puts them, and
 * a span still measured in a fallback font reports the wrong advance. `1em` is
 * a shorthand the Font Loading API requires; the size does not matter, only the
 * family.
 *
 * Resolves immediately outside a browser. `measureLatex` calls this for you.
 *
 * @category Fonts
 */
export async function ensureWebFonts(): Promise<void> {
	if (typeof document === "undefined" || !document.fonts) return;
	await Promise.all(
		KATEX_FAMILIES.map((family) =>
			document.fonts.load(`1em "${family}"`).catch(() => []),
		),
	);
	await document.fonts.ready;
}
