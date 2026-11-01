/**
 * Typesetting as a value: `createLatex` and the `LatexSource` behind it, which
 * `mathTex` and `mathTransform` also use.
 *
 * It is a small state machine
 * with a `Readable` face: a request per formula, the previous formula kept up
 * while the next one typesets, a status (`"pending"`, `"ready"`, `"failed"`)
 * and `ready()` for scripts. A formula whose outline has already been
 * typeset (the outline cache shares one promise per formula) is taken
 * synchronously, so going back to a formula, or morphing from the one just
 * shown, never blanks a frame.
 */

import type { Readable } from "@sophistry/core";
import { isReadable } from "@sophistry/core";
import type { Polyline } from "@sophistry/core/geometry";
import { boundsOf } from "@sophistry/core/geometry";
import type { MeasureOptions } from "./measure.js";
import type { LatexOutline } from "./outline.js";
import { latexOutline } from "./outline.js";
import type { PlacedLatex } from "./placed.js";

/**
 * Typesetting options shared by `mathTex`, `mathTransform` and
 * {@link createLatex}: KaTeX's `displayMode` and `macros` (from
 * `MeasureOptions`) plus the size.
 *
 * @category Components
 */
export interface LatexOptions extends MeasureOptions {
	/**
	 * Formula size in scene units per em. Changing it re-places the outline
	 * without re-typesetting.
	 * @default 1
	 */
	fontSize?: number;
	/**
	 * Called when typesetting fails, with the error and the TeX source (KaTeX
	 * parse errors are not failures: they render in KaTeX's error colour). On
	 * `mathTex` and `mathTransform` it also contains the failure: without it,
	 * the error is rethrown from the scene's next commit.
	 */
	onError?: (error: unknown, tex: string) => void;
}

/**
 * Where a formula's typesetting stands: `"pending"` while one is in flight
 * (first load, or after the source changed; the previous formula stays up
 * meanwhile), `"ready"` once the current source is typeset, `"failed"` when
 * it could not be.
 *
 * @category Components
 */
export type LatexStatus = "pending" | "ready" | "failed";

/**
 * Loading state of a formula: what {@link createLatex} returns and what
 * `mathTex` and `mathTransform` nodes expose as methods. Plain functions
 * and a promise, so it works from scripts, `watch` and bindings alike.
 *
 * @category Components
 */
export interface LatexHandle {
	/** True while a formula is being typeset (first load, or after the source changed). */
	pending(): boolean;
	/** The last typesetting failure for the current source, or undefined. */
	error(): unknown;
	/**
	 * The status as a `Readable`, to bind a prop to (`opacity:
	 * derive(formula.status, (s) => (s === "pending" ? 0.4 : 1))`).
	 */
	readonly status: Readable<LatexStatus>;
	/**
	 * Resolves once every formula the owner shows is typeset; await it before
	 * animating the outline. Rejects if typesetting fails, and with an
	 * `AbortError` (a `DOMException`) if the owner is disposed first.
	 */
	ready(): Promise<void>;
}

/**
 * A formula typeset as a value: a `Readable` of the placed parts (`null`
 * until the first typeset lands, and after a failure), plus its
 * {@link LatexHandle} loading state. Dispose it when done.
 *
 * @category Components
 */
export interface Latex extends Readable<PlacedLatex | null>, LatexHandle {
	/** Stops following the source and rejects outstanding `ready()` waiters. */
	dispose(): void;
}

/**
 * em, y-down, origin top-left → scene units, y-up, centred on the origin.
 *
 * @param source - A typeset outline, as `latexOutline` resolves.
 * @param scale - Scene units per em (the `fontSize`).
 * @returns The placed formula.
 * @category Measuring & outlines
 */
export function placeOutline(source: LatexOutline, scale: number): PlacedLatex {
	const halfWidth = source.width / 2;
	const halfHeight = source.height / 2;
	const place = (line: Polyline): Polyline =>
		line.map((p) => ({
			x: (p.x - halfWidth) * scale,
			y: (halfHeight - p.y) * scale,
		}));

	const parts = source.parts.map((part) => {
		const polylines = part.polylines.map(place);
		return {
			kind: part.kind,
			char: part.char,
			polylines,
			box: boundsOf(polylines),
		};
	});

	return {
		parts,
		width: source.width * scale,
		height: source.height * scale,
	};
}

/** Outlines whose request has settled, by the request's promise. */
const settledOutlines = new WeakMap<Promise<LatexOutline>, LatexOutline>();

/** An outline request's promise, remembering its answer once it lands. */
function requestOutline(
	tex: string,
	options: MeasureOptions,
): Promise<LatexOutline> {
	const request = latexOutline(tex, options);
	if (!settledOutlines.has(request)) {
		request.then(
			(outline) => settledOutlines.set(request, outline),
			() => {},
		);
	}
	return request;
}

/** The error `ready()` waiters get when their owner goes away. */
export function disposedError(): DOMException {
	return new DOMException("The formula was disposed.", "AbortError");
}

interface Waiter {
	resolve: () => void;
	reject: (error: unknown) => void;
}

/**
 * Outstanding `ready()` promises of one owner, settled together.
 *
 * @internal
 */
export class ReadyWaiters {
	private readonly waiters = new Set<Waiter>();
	private disposed = false;

	/** A promise settled by the next {@link ReadyWaiters.settle}. */
	wait(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (this.disposed) reject(disposedError());
			else this.waiters.add({ resolve, reject });
		});
	}

	/** Resolves every waiter, or rejects them all with `failure.error`. */
	settle(failure?: { error: unknown }): void {
		const waiters = [...this.waiters];
		this.waiters.clear();
		for (const waiter of waiters) {
			if (failure) waiter.reject(failure.error);
			else waiter.resolve();
		}
	}

	/** Whether anyone is waiting. */
	get size(): number {
		return this.waiters.size;
	}

	/** Rejects every waiter (and later ones) with an `AbortError`. */
	dispose(): void {
		this.disposed = true;
		const waiters = [...this.waiters];
		this.waiters.clear();
		for (const waiter of waiters) waiter.reject(disposedError());
	}
}

/**
 * One formula's typesetting state: the request for the current source, the
 * placed result, the status and `ready()` waiters. Fed explicitly with
 * {@link LatexSource.typeset}; {@link createLatex} feeds it from `Readable`s
 * and the components from their props.
 *
 * - A new source (TeX, `displayMode` or `macros`) starts a request; the
 *   placed formula stays the previous one until it lands. A request
 *   superseded meanwhile is dropped, its failure too.
 * - A new `fontSize` re-places the current outline without a request.
 * - A failure clears the placed formula (nothing draws), records the error
 *   and calls `onError` (from the options of the failed request).
 *
 * `onChange` runs synchronously whenever the placed formula or the status
 * changed (it must not throw).
 *
 * @internal
 */
export class LatexSource {
	private readonly onChange: () => void;
	private tex: string | undefined;
	private displayMode: boolean | undefined;
	private macros: Record<string, string> | undefined;
	private fontSize = 1;
	private onError: LatexOptions["onError"];
	private request = 0;
	private outline: LatexOutline | null = null;
	private placedValue: PlacedLatex | null = null;
	private failure: { error: unknown } | null = null;
	private statusValue: LatexStatus = "pending";
	private readonly waiters = new ReadyWaiters();
	private disposed = false;

	constructor(onChange: () => void = () => {}) {
		this.onChange = onChange;
	}

	/** The placed formula: null before the first typeset lands and after a failure. */
	placed(): PlacedLatex | null {
		return this.placedValue;
	}

	status(): LatexStatus {
		return this.statusValue;
	}

	error(): unknown {
		return this.failure?.error;
	}

	/** The TeX source of the current request. */
	source(): string | undefined {
		return this.tex;
	}

	/**
	 * Points the source at `tex` with `options`: a request when the formula
	 * changed, a re-placement when only the size did, nothing otherwise.
	 */
	typeset(tex: string, options: LatexOptions = {}): void {
		if (this.disposed) return;
		this.onError = options.onError;
		const fontSize = options.fontSize ?? 1;
		if (
			tex === this.tex &&
			options.displayMode === this.displayMode &&
			options.macros === this.macros
		) {
			if (fontSize !== this.fontSize) {
				this.fontSize = fontSize;
				if (this.outline) {
					this.placedValue = placeOutline(this.outline, fontSize);
					this.onChange();
				}
			}
			return;
		}
		this.tex = tex;
		this.displayMode = options.displayMode;
		this.macros = options.macros;
		this.fontSize = fontSize;
		const request = ++this.request;
		let outline: Promise<LatexOutline>;
		try {
			outline = requestOutline(tex, {
				displayMode: options.displayMode,
				macros: options.macros,
			});
		} catch (error) {
			this.fail(error, tex);
			return;
		}
		const settled = settledOutlines.get(outline);
		if (settled) {
			this.accept(settled);
			return;
		}
		const wasPending = this.statusValue === "pending";
		this.statusValue = "pending";
		this.failure = null;
		outline.then(
			(result) => {
				if (request !== this.request || this.disposed) return;
				this.accept(result);
			},
			(error: unknown) => {
				// A superseded request's failure is not news.
				if (request !== this.request || this.disposed) return;
				this.fail(error, tex);
			},
		);
		if (!wasPending) this.onChange();
	}

	/** Resolves once the current source is typeset (see {@link LatexHandle.ready}). */
	ready(): Promise<void> {
		if (this.disposed) return Promise.reject(disposedError());
		if (this.statusValue === "ready") return Promise.resolve();
		if (this.statusValue === "failed" && this.failure) {
			return Promise.reject(this.failure.error);
		}
		return this.waiters.wait();
	}

	/** Drops any request in flight and rejects waiters with an `AbortError`. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.request++;
		this.waiters.dispose();
	}

	private accept(outline: LatexOutline): void {
		this.outline = outline;
		this.placedValue = placeOutline(outline, this.fontSize);
		this.failure = null;
		this.statusValue = "ready";
		this.onChange();
		this.waiters.settle();
	}

	private fail(error: unknown, tex: string): void {
		this.outline = null;
		this.placedValue = null;
		this.failure = { error };
		this.statusValue = "failed";
		const onError = this.onError;
		this.onChange();
		this.waiters.settle({ error });
		onError?.(error, tex);
	}
}

/** A minimal listener set with a `Readable` view per value. */
class Listeners {
	private readonly set = new Set<() => void>();

	notify(): void {
		for (const onStale of [...this.set]) onStale();
	}

	subscribe(onStale: () => void): () => void {
		this.set.add(onStale);
		return () => {
			this.set.delete(onStale);
		};
	}
}

/**
 * The `Readable` face shared by {@link createLatex} and the components: one
 * listener set, told whenever the placed formula or the status may have
 * changed (stale only: readers pull with `peek`).
 *
 * @internal
 */
export class LatexReadables {
	private readonly listeners = new Listeners();

	/** Tells subscribers the values may have changed. */
	notify(): void {
		this.listeners.notify();
	}

	/** A `Readable` whose value is `read()`, notified by {@link LatexReadables.notify}. */
	view<T>(read: () => T): Readable<T> {
		return {
			peek: read,
			subscribe: (onStale) => this.listeners.subscribe(onStale),
		};
	}
}

/**
 * Typesets a formula and returns its placed parts (centred on the origin,
 * scene units, y up) as a `Readable`, plus its loading state. `tex` and
 * `options` may be plain values or `Readable`s: a new source typesets
 * afresh while the previous formula stays readable, a new `fontSize`
 * re-places without typesetting. The value is `null` until the first
 * formula lands, and after a failure (which also reaches `onError`, `error()`
 * and `ready()`). Use it for per-glyph styling; `mathTex` is the
 * one-node case (and its `partFill` covers per-part colours).
 *
 * Typesetting needs a browser (fonts, CSS layout); on a server the request
 * never settles. Call `dispose()` when done with it.
 *
 * @example
 * ```ts
 * import { createScene, path } from "@sophistry/core";
 * import { createLatex } from "@sophistry/text";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 8 });
 * const formula = createLatex("3x^2 + 2x", { fontSize: 0.9 });
 * await formula.ready();
 * for (const part of formula.peek()?.parts ?? []) {
 * 	scene.add(path.create({ points: part.polylines, closed: true, fill: part.char === "x" ? "gold" : "white", stroke: "none" }));
 * }
 * ```
 *
 * @param tex - The TeX source, or a `Readable` of it.
 * @param options - Typesetting options, or a `Readable` of them.
 * @returns The placed formula as a `Readable`, with its loading state.
 * @see {@link https://sophistry.dev/guides/math-and-latex/#per-glyph-control-with-createlatex}
 * @category Components
 */
export function createLatex(
	tex: string | Readable<string>,
	options: LatexOptions | Readable<LatexOptions> = {},
): Latex {
	const readables = new LatexReadables();
	const source = new LatexSource(() => readables.notify());
	const readTex = isReadable(tex) ? () => tex.peek() : () => tex;
	const readOptions = isReadable(options)
		? () => options.peek()
		: () => options;

	// Push-stale, pull-value: a source going stale marks the inputs; the
	// next read (or a microtask, so a request starts even when nobody reads)
	// brings the request up to date.
	let stale = false;
	const sync = () => {
		if (!stale) return;
		stale = false;
		source.typeset(readTex(), readOptions());
	};
	const markStale = () => {
		if (stale) return;
		stale = true;
		readables.notify();
		queueMicrotask(sync);
	};
	const stops: (() => void)[] = [];
	if (isReadable(tex)) stops.push(tex.subscribe(markStale));
	if (isReadable(options)) stops.push(options.subscribe(markStale));
	source.typeset(readTex(), readOptions());

	const placed = readables.view(() => {
		sync();
		return source.placed();
	});
	return {
		peek: placed.peek,
		subscribe: placed.subscribe,
		status: readables.view(() => {
			sync();
			return source.status();
		}),
		pending: () => {
			sync();
			return source.status() === "pending";
		},
		error: () => {
			sync();
			return source.error();
		},
		ready: () => {
			sync();
			return source.ready();
		},
		dispose: () => {
			for (const stop of stops) stop();
			stops.length = 0;
			source.dispose();
		},
	};
}
