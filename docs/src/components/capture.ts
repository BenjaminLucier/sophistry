/**
 * Capture mode: deterministic gallery examples for the visual-regression suite
 * (`e2e/tests/gallery.spec.ts`).
 *
 * Open a gallery page with `?capture` in its URL and every example island runs
 * its clock by hand instead of on wall-clock time:
 *
 * - the island's clock starts paused, so the frame loop never advances it and
 *   how fast the machine is cannot change what the scene shows;
 * - its reduced-motion mode is forced to `"no-preference"`, so scripts on it
 *   animate exactly as a reader sees them, even when the browser asks for
 *   reduced motion (the suite emulates that for the few examples that create a
 *   clock of their own, which then jump to their end state);
 * - {@link CaptureControl.settle}, reachable from the page as
 *   `window.__sophistryCapture[name]`, advances it in fixed steps, yielding a
 *   macrotask after each so every `await play(...)` chain moves on before the
 *   next step. The same sequence of steps always produces the same frame.
 *
 * Nothing changes without the query parameter, and nothing changes in the
 * production docs at all: capture mode is compiled in only on the dev server
 * (`astro dev`) and in a build made for the suite with
 * `PUBLIC_SOPHISTRY_CAPTURE=1` (see {@link CAPTURE_BUILD}). The deployed site
 * ignores `?capture` and never publishes `window.__sophistryCapture`, so a
 * reader who adds the parameter (or follows a link carrying it) does not get
 * examples frozen at time 0.
 */

/** What {@link CaptureControl.settle} reports. */
export interface CaptureResult {
	/** Clock time this call advanced, in seconds. */
	time: number;
	/** Whether no run was left ticking on the example's clock when it returned. */
	idle: boolean;
}

/** The handle an island publishes for the capture suite. */
export interface CaptureControl {
	/**
	 * Advances the example's clock by `step` seconds at a time until nothing is
	 * subscribed to it or `limit` seconds have passed, whichever comes first.
	 */
	settle(limit: number, step?: number): Promise<CaptureResult>;
}

declare global {
	interface Window {
		/** Capture handles by example name ("basic/UnitCircle"); see `capture.ts`. */
		__sophistryCapture?: Record<string, CaptureControl>;
	}
}

/**
 * Whether this build carries capture mode: the dev server, or a build with
 * `PUBLIC_SOPHISTRY_CAPTURE=1` in its environment. `pnpm test:e2e`,
 * `scripts/e2e-visual.mjs` (`pnpm test:e2e:visual`/`update`) and CI's `e2e`
 * job build the docs that way; the production build (`pnpm --filter
 * @sophistry/docs build`, the Pages deploy) does not. Vite replaces both
 * reads at build time, so in production this is the constant `false`.
 */
export const CAPTURE_BUILD: boolean =
	import.meta.env.DEV || import.meta.env.PUBLIC_SOPHISTRY_CAPTURE === "1";

/** Whether this page was opened in capture mode (`?capture`), in a build that has it. */
export function captureMode(): boolean {
	return (
		CAPTURE_BUILD &&
		typeof location !== "undefined" &&
		new URLSearchParams(location.search).has("capture")
	);
}

/** One macrotask: lets every promise chain a step resolved run to its next `await`. */
const macrotask = () =>
	new Promise<void>((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => {
			channel.port1.close();
			resolve();
		};
		channel.port2.postMessage(null);
	});

/** Steps of 1/60 s, a display frame, unless the caller asks otherwise. */
const STEP = 1 / 60;

/**
 * Publishes a capture handle for one example.
 *
 * @param name - The example's name, "category/Name".
 * @param advance - Steps the example's clock by hand.
 * @param active - How many runs are ticking on that clock right now.
 * @returns A function withdrawing the handle.
 */
export function publishCapture(
	name: string,
	advance: (dt: number) => void,
	active: () => number,
): () => void {
	const control: CaptureControl = {
		async settle(limit, step = STEP) {
			// Floating-point steps are counted, not summed, so the same limit
			// always takes the same number of steps.
			const steps = Math.round(limit / step);
			let taken = 0;
			await macrotask();
			while (active() > 0 && taken < steps) {
				advance(step);
				taken++;
				await macrotask();
			}
			return { time: taken * step, idle: active() === 0 };
		},
	};
	window.__sophistryCapture ??= {};
	const registry = window.__sophistryCapture;
	registry[name] = control;
	return () => {
		if (registry[name] === control) delete registry[name];
	};
}
