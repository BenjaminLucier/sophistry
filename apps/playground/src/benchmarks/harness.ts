import { flush } from "solid-js";

/** One configurable knob on a benchmark, rendered as a row of buttons. */
export interface ParamDef {
	key: string;
	label: string;
	options: number[];
	default: number;
}

export type BenchConfig = Record<string, number>;

/**
 * What a benchmark scene receives. It mounts its nodes, then calls `ready`
 * once with a `step` function; the harness calls `step(frame)` every frame to
 * mutate whatever signals the benchmark is about. Keeping the mutation behind
 * one function is what lets the harness time "a state change" separately from
 * "the paint it causes".
 */
export interface BenchSceneProps {
	config: BenchConfig;
	ready: (step: (frame: number) => void) => void;
}

export interface Summary {
	p50: number;
	p95: number;
	max: number;
}

export interface BenchResult {
	/** ms from asking for the scene to its first painted frame. */
	mountMs: number;
	frames: number;
	/** Wall-clock seconds the sample actually took. */
	seconds: number;
	fps: number;
	/** Time between consecutive animation frames — what the user feels. */
	frameMs: Summary;
	/** `step()` plus Solid's flush: signal writes, memo recomputes, and the
	 * renderer's collect effect (the incremental frame collector: patched specs, a z re-sort only when needed). */
	updateMs: Summary;
	/** The renderer's paint callback: Canvas2D command issuance. Does not
	 * include GPU rasterisation, which happens after the callback returns. */
	paintMs: Summary;
	/** Frames slower than 1.5× a 60 Hz frame. */
	slowFrames: number;
	/** Chrome only (`performance.memory`); null elsewhere. */
	heapDeltaMb: number | null;
}

export function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
	return sorted[index];
}

export function summarize(samples: number[]): Summary {
	const sorted = [...samples].sort((a, b) => a - b);
	return {
		p50: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		max: sorted.length ? sorted[sorted.length - 1] : 0,
	};
}

export const nextFrame = (): Promise<number> =>
	new Promise((resolve) => requestAnimationFrame(resolve));

function heapMb(): number | null {
	const memory = (
		performance as unknown as { memory?: { usedJSHeapSize: number } }
	).memory;
	return memory ? memory.usedJSHeapSize / 1024 / 1024 : null;
}

const WARMUP_FRAMES = 20;
const SLOW_FRAME_MS = (1000 / 60) * 1.5;

/**
 * Drives `step` once per animation frame for `seconds`, and records where the
 * time went.
 *
 * The paint phase is timed by wrapping `requestAnimationFrame` for the length
 * of the run: the renderer schedules its paint through it, so every callback
 * registered by anything *other than this loop* is timed. That is only the
 * paint because the harness never starts the library's `Clock` (which would
 * also use rAF) — it writes signals directly instead of tweening them.
 */
export async function sample(
	step: (frame: number) => void,
	seconds: number,
): Promise<Omit<BenchResult, "mountMs">> {
	const nativeRaf = window.requestAnimationFrame.bind(window);
	const paint: number[] = [];
	window.requestAnimationFrame = (callback) =>
		nativeRaf((time) => {
			const start = performance.now();
			callback(time);
			paint.push(performance.now() - start);
		});

	const frameDeltas: number[] = [];
	const updates: number[] = [];

	try {
		let frame = 0;
		let last = 0;
		let heapBefore: number | null = null;
		let startedAt = 0;

		await new Promise<void>((done) => {
			const loop = (time: number) => {
				const running = frame >= WARMUP_FRAMES;
				if (frame === WARMUP_FRAMES) {
					paint.length = 0;
					heapBefore = heapMb();
					startedAt = time;
				}
				if (running && last > 0) frameDeltas.push(time - last);
				last = time;

				const start = performance.now();
				step(frame);
				flush();
				if (running) updates.push(performance.now() - start);

				frame++;
				if (running && time - startedAt >= seconds * 1000) {
					done();
					return;
				}
				nativeRaf(loop);
			};
			nativeRaf(loop);
		});

		const heapAfter = heapMb();
		const elapsed = frameDeltas.reduce((sum, delta) => sum + delta, 0) / 1000;
		return {
			frames: frameDeltas.length,
			seconds: elapsed,
			fps: elapsed > 0 ? frameDeltas.length / elapsed : 0,
			frameMs: summarize(frameDeltas),
			updateMs: summarize(updates),
			paintMs: summarize(paint),
			slowFrames: frameDeltas.filter((delta) => delta > SLOW_FRAME_MS).length,
			heapDeltaMb:
				heapBefore !== null && heapAfter !== null
					? heapAfter - heapBefore
					: null,
		};
	} finally {
		window.requestAnimationFrame = nativeRaf;
	}
}

/** The key a result is remembered under, so a re-run can show a delta. */
export function resultKey(id: string, config: BenchConfig): string {
	const parts = Object.keys(config)
		.sort()
		.map((key) => `${key}=${config[key]}`);
	return `sophistry-bench:${id}:${parts.join(",")}`;
}

export function loadPrevious(key: string): BenchResult | null {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as BenchResult) : null;
	} catch {
		return null;
	}
}

export function savePrevious(key: string, result: BenchResult): void {
	try {
		localStorage.setItem(key, JSON.stringify(result));
	} catch {
		// Storage full or disabled: the comparison is a convenience.
	}
}
