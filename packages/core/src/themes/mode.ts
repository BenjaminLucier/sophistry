/**
 * Light and dark mode. A stored preference (`system | light | dark`) resolves to
 * a mode on `<html data-mode>` (preference on `data-pref`); this module observes
 * that attribute as a {@link Track}, so scenes repaint whoever flips it.
 *
 * - Dark is the default when nothing says otherwise.
 * - `themeInitScript()` must be inlined, blocking, in `<head>` to avoid a flash.
 * - Only that script and `installColorMode` read `prefers-color-scheme`.
 * - `theme-color` comes from the palette's backgrounds.
 * - `installColorMode`'s `storageKey` and `palette` are remembered for
 *   `setModePreference` / `cycleModePreference`.
 */

import { type Readable, type Track, track } from "../reactive/index.js";
import { resolvePalette } from "./palette.js";
import type { ColorMode, ModePreference, PaletteSpec } from "./types.js";

/** Default `localStorage` key the mode preference is stored under. */
const MODE_STORAGE_KEY = "theme-pref";
const FALLBACK_MODE: ColorMode = "dark";
const FALLBACK_PREFERENCE: ModePreference = "dark";
const PREFERENCE_ORDER: ModePreference[] = ["system", "light", "dark"];

const hasDom = typeof document !== "undefined";

function isMode(value: unknown): value is ColorMode {
	return value === "light" || value === "dark";
}

function isPreference(value: unknown): value is ModePreference {
	return value === "system" || isMode(value);
}

function readDomMode(): ColorMode {
	const mode = hasDom ? document.documentElement.dataset.mode : undefined;
	return isMode(mode) ? mode : FALLBACK_MODE;
}

function readDomPreference(): ModePreference {
	const pref = hasDom ? document.documentElement.dataset.pref : undefined;
	return isPreference(pref) ? pref : readDomMode();
}

// Tracks write synchronously, so a read right after a write is exact. Both
// are module-level because the mode is a document-level singleton.
const modeTrack: Track<ColorMode> = track(readDomMode());
const preferenceTrack: Track<ModePreference> = track(readDomPreference());

function setState(nextMode: ColorMode, nextPreference: ModePreference): void {
	modeTrack.set(nextMode);
	preferenceTrack.set(nextPreference);
}

let observing = false;

/** Mirrors the `<html>` attributes into the tracks. Attached on first read or subscribe. */
function observe(): void {
	if (observing || !hasDom) return;
	observing = true;
	const sync = () => setState(readDomMode(), readDomPreference());
	new MutationObserver(sync).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-mode", "data-pref"],
	});
	sync();
}

/** A read-only view of `source` that starts the attribute observer when used. */
function observed<T>(source: Readable<T>): Readable<T> {
	return {
		peek() {
			observe();
			return source.peek();
		},
		subscribe(onStale) {
			observe();
			return source.subscribe(onStale);
		},
	};
}

/**
 * The page's concrete colour mode as a {@link Readable}: `peek()` it for the
 * current value, `subscribe` (or bind a prop to it) to follow `<html
 * data-mode>` however it changes. Falls back to `"dark"` with no DOM or no
 * attribute.
 *
 * @example
 * ```ts
 * import { colorModeReadable } from "@sophistry/core/themes";
 *
 * const stop = colorModeReadable.subscribe(() =>
 * 	console.log("now", colorModeReadable.peek()),
 * );
 * ```
 *
 * @see {@link colorMode}
 *
 * @category Theming
 */
export const colorModeReadable: Readable<ColorMode> = observed(modeTrack);

/**
 * The stored mode preference (`"system"` included) as a {@link Readable};
 * follows `<html data-pref>` like {@link colorModeReadable}.
 *
 * @see {@link modePreference}
 *
 * @category Theming
 */
export const modePreferenceReadable: Readable<ModePreference> =
	observed(preferenceTrack);

/**
 * The concrete mode (`"light"` or `"dark"`) the page is in right now.
 *
 * Reads `<html data-mode>`; a plain read that never subscribes. To follow
 * changes, use {@link colorModeReadable}. Falls back to `"dark"` with no DOM
 * or no attribute.
 *
 * @returns The current colour mode.
 * @see {@link modePreference}
 *
 * @category Theming
 */
export function colorMode(): ColorMode {
	return colorModeReadable.peek();
}

/**
 * What the user chose, `"system"` included (the `<html data-pref>` value).
 * A plain read like {@link colorMode}; follow it with
 * {@link modePreferenceReadable}.
 *
 * @returns The stored preference.
 *
 * @category Theming
 */
export function modePreference(): ModePreference {
	return modePreferenceReadable.peek();
}

function systemMode(): ColorMode {
	return hasDom && typeof matchMedia === "function"
		? matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light"
		: FALLBACK_MODE;
}

/**
 * Resolves a preference to a concrete mode; `"system"` asks the OS through
 * `prefers-color-scheme`, and is `"dark"` when that is unavailable.
 *
 * @param pref - A stored preference.
 * @returns `"light"` or `"dark"`.
 *
 * @category Theming
 */
export function resolveModePreference(pref: ModePreference): ColorMode {
	return pref === "system" ? systemMode() : pref;
}

function themeColors(palette?: PaletteSpec): Record<ColorMode, string> {
	const p = resolvePalette(palette);
	return { light: p.light.background, dark: p.dark.background };
}

/**
 * Options shared by the mode setters and {@link installColorMode}.
 *
 * @category Theming
 */
export interface ModeOptions {
	/**
	 * `localStorage` key the preference is stored under. Defaults to the key
	 * given to {@link installColorMode}, else `"theme-pref"`.
	 */
	storageKey?: string;
	/**
	 * Palette whose backgrounds feed `<meta name="theme-color">`. Defaults to
	 * the palette given to {@link installColorMode}, else Catppuccin.
	 */
	palette?: PaletteSpec;
}

// Remembered from installColorMode. The mode is a document-level singleton
// (one <html>, one theme-color meta), so a module-level record is accurate
// rather than a hidden global: later setters must agree with the install.
let installed: ModeOptions = {};

function writeDom(
	pref: ModePreference,
	resolved: ColorMode,
	palette?: PaletteSpec,
): void {
	if (!hasDom) return;
	const root = document.documentElement;
	root.dataset.pref = pref;
	root.dataset.mode = resolved;
	document
		.querySelector('meta[name="theme-color"]')
		?.setAttribute("content", themeColors(palette)[resolved]);
}

/**
 * Stores and applies a preference: writes `localStorage`, sets
 * `data-pref`/`data-mode` on `<html>`, and syncs `<meta name="theme-color">`.
 * The tracks follow through the attribute observer (or directly, with no DOM).
 *
 * @param pref - `"system"`, `"light"` or `"dark"`.
 * @param options - Storage key and palette; each falls back to what
 *   {@link installColorMode} was given, then to the defaults. See {@link ModeOptions}.
 *
 * @category Theming
 */
export function setModePreference(
	pref: ModePreference,
	options: ModeOptions = {},
): void {
	const storageKey =
		options.storageKey ?? installed.storageKey ?? MODE_STORAGE_KEY;
	const palette = options.palette ?? installed.palette;
	try {
		localStorage.setItem(storageKey, pref);
	} catch {
		// Storage blocked: the preference still applies for this page view.
	}
	const resolved = resolveModePreference(pref);
	writeDom(pref, resolved, palette);
	// With a DOM the observer picks the attributes up; either way, apply now
	// so the very next read agrees.
	setState(resolved, pref);
}

/**
 * Advances the preference `system → light → dark → system` and applies it
 * with {@link setModePreference}; handy for a single theme-toggle button.
 *
 * @param options - See {@link ModeOptions}; defaults to what
 *   {@link installColorMode} was given.
 * @returns The preference it moved to.
 *
 * @category Theming
 */
export function cycleModePreference(options: ModeOptions = {}): ModePreference {
	const next =
		PREFERENCE_ORDER[
			(PREFERENCE_ORDER.indexOf(preferenceTrack.peek()) + 1) %
				PREFERENCE_ORDER.length
		];
	setModePreference(next, options);
	return next;
}

let uninstallColorMode: (() => void) | undefined;

/**
 * Applies the stored preference and follows OS changes — the runtime twin of
 * `themeInitScript()`, for apps that cannot inline a script (client-only dev
 * servers, embeds). Idempotent. Prefer the script where you can: this runs
 * after first paint.
 *
 * The `storageKey` and `palette` are remembered, so later
 * {@link setModePreference} / {@link cycleModePreference} calls write the same
 * key and the same `theme-color` without repeating them.
 *
 * @param options - See {@link ModeOptions}.
 * @returns A disposer that stops following OS changes.
 * @see {@link themeInitScript}
 *
 * @category Theming
 */
export function installColorMode(options: ModeOptions = {}): () => void {
	const storageKey = options.storageKey ?? MODE_STORAGE_KEY;
	const { palette } = options;
	// Idempotent: a repeat call replaces the previous OS-change listener
	// instead of stacking another one.
	uninstallColorMode?.();
	uninstallColorMode = undefined;
	installed = { storageKey: options.storageKey, palette };
	if (!hasDom) return () => {};
	const stored = (() => {
		try {
			return localStorage.getItem(storageKey);
		} catch {
			return null;
		}
	})();
	const read = () => (isPreference(stored) ? stored : FALLBACK_PREFERENCE);
	writeDom(read(), resolveModePreference(read()), palette);
	if (typeof matchMedia === "function") {
		const query = matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => {
			const pref = readDomPreference();
			if (pref === "system") writeDom(pref, systemMode(), palette);
		};
		query.addEventListener("change", onChange);
		const dispose = () => {
			query.removeEventListener?.("change", onChange);
			if (uninstallColorMode === dispose) uninstallColorMode = undefined;
		};
		uninstallColorMode = dispose;
		return dispose;
	}
	return () => {};
}

/**
 * Options for {@link themeInitScript}.
 *
 * @category Theming
 */
export interface ThemeInitScriptOptions {
	/** Palette whose backgrounds feed `theme-color`. Defaults to Catppuccin. */
	palette?: PaletteSpec;
	/**
	 * `localStorage` key to read.
	 * @default `"theme-pref"`
	 */
	storageKey?: string;
	/**
	 * Preference when nothing is stored.
	 * @default `"dark"`
	 */
	fallback?: ModePreference;
}

/**
 * The blocking pre-paint script, as a string for an inline `<script>` in
 * `<head>`. It resolves the stored preference, sets `data-mode`/`data-pref` on
 * `<html>` and keeps `<meta name="theme-color">` in sync, then follows OS
 * changes live. Failure (blocked storage) leaves the HTML's own default.
 *
 * A strict CSP needs a nonce or hash for it.
 *
 * @param options - See {@link ThemeInitScriptOptions}.
 * @returns JavaScript source text; embed it verbatim.
 * @see {@link installColorMode}
 *
 * @category Theming
 */
export function themeInitScript(options: ThemeInitScriptOptions = {}): string {
	const colors = themeColors(options.palette);
	const key = options.storageKey ?? MODE_STORAGE_KEY;
	const fallback = options.fallback ?? FALLBACK_PREFERENCE;
	return `(function(){try{var d=document.documentElement,meta=document.querySelector('meta[name="theme-color"]'),colors=${JSON.stringify(colors)},pref,mq=matchMedia("(prefers-color-scheme: dark)");function read(){var s=localStorage.getItem(${JSON.stringify(key)});return s==="light"||s==="dark"||s==="system"?s:${JSON.stringify(fallback)}}pref=read();function apply(){var mode=pref==="system"?(mq.matches?"dark":"light"):pref;d.dataset.mode=mode;d.dataset.pref=pref;if(meta)meta.content=colors[mode]}apply();mq.addEventListener("change",function(){pref=read();apply()})}catch(e){}})();`;
}
