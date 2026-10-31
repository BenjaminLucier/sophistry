/**
 * The one `requestAnimationFrame` loop every clock, scene and renderer shares,
 * started lazily and asleep when nothing needs a frame. Each frame runs three
 * phases, in order:
 *
 * 1. **tick**: clocks advance from the shared timestamp; animations sampled on
 *    them write tracks (which only *mark* their subscribers stale);
 * 2. **commit**: scenes pull their stale bindings and recompute dirty nodes;
 *    {@link watch} callbacks run here too;
 * 3. **paint**: renderers draw what the commit produced.
 *
 * So a tick and the paint it causes land in the same frame, and three writes
 * to one track in a tick cost one recompute in the commit.
 *
 * Participants come in two kinds:
 *
 * - {@link onFrame}: runs in its phase **every frame** while registered. An
 *   "awake" participant (the default; a running clock) keeps the loop
 *   scheduled; a passive one (`{ awake: false }`) only rides along on frames
 *   something else caused.
 * - {@link requestFrame}: one-shot. With a callback, runs it once in its phase
 *   of the current frame (when that phase is still ahead, or is the phase now
 *   running) or of the next one; requests for the same function collapse into
 *   one. Without a callback it just wakes the loop for one frame, so passive
 *   participants run once (a scene that became dirty while no clock runs).
 *
 * There is no `flush()`: nothing runs outside a frame except through
 * {@link stepFrame}, which is for tests and offline rendering. Without
 * `requestAnimationFrame` (server rendering, plain Node) nothing is scheduled.
 */

import type { Readable } from "../reactive";

/**
 * A phase of a frame: `"tick"` (clocks and animations), `"commit"` (scenes
 * recompute) or `"paint"` (renderers draw).
 *
 * @category Tracks & clocks
 */
export type FramePhase = "tick" | "commit" | "paint";

/**
 * A frame participant; `now` is the frame's timestamp in milliseconds (the
 * `requestAnimationFrame` timestamp, or what {@link stepFrame} was given).
 *
 * @category Tracks & clocks
 */
export type FrameCallback = (now: number) => void;

/**
 * Options for {@link onFrame}.
 *
 * @category Tracks & clocks
 */
export interface FrameParticipantOptions {
	/**
	 * Whether this participant keeps the loop running. A clock with
	 * subscribers is awake; a scene's commit is passive and is woken by
	 * {@link requestFrame} when it becomes dirty.
	 *
	 * @default true
	 */
	awake?: boolean;
	/**
	 * Called when the page's visibility changes: the gap since the previous
	 * frame is then meaningless (a backgrounded tab gets no frames), so a
	 * participant measuring deltas should forget its last timestamp.
	 */
	reset?: () => void;
}

const PHASES: readonly FramePhase[] = ["tick", "commit", "paint"];
const PHASE_INDEX: Record<FramePhase, number> = {
	tick: 0,
	commit: 1,
	paint: 2,
};

interface Participant {
	callback: FrameCallback;
	awake: boolean;
	reset?: () => void;
}

/** Continuous participants per phase, in registration order. */
const participants: Set<Participant>[] = PHASES.map(() => new Set());
/** One-shot requests per phase, collapsed by function identity. */
const requests: Set<FrameCallback>[] = PHASES.map(() => new Set());
let awakeCount = 0;
/** A bare {@link requestFrame}: run one frame even if nothing else asks. */
let wakeRequested = false;

/**
 * Upper bound on drain rounds per phase, so a callback that keeps requesting
 * itself (or a watch that writes what it watches) cannot hang the page; what
 * is left over runs in the next frame.
 */
const MAX_ROUNDS = 16;

let handle: number | null = null;
/** The `requestAnimationFrame` that issued `handle`, so a swapped global (tests) is noticed. */
let issuedBy: unknown = null;
/** The phase now running, or -1 between frames. */
let phaseIndex = -1;
let watchingVisibility = false;

const hasRaf = () => typeof requestAnimationFrame === "function";

function onVisibilityChange() {
	for (const set of participants) {
		for (const participant of [...set]) participant.reset?.();
	}
}

/** Whether the loop needs another frame. */
function wanted(): boolean {
	return (
		awakeCount > 0 ||
		wakeRequested ||
		requests.some((pending) => pending.size > 0)
	);
}

/** Schedules a frame if one is wanted and none is outstanding. */
function ensure() {
	if (phaseIndex >= 0) return; // the frame in progress reschedules itself
	if (handle !== null && issuedBy === globalThis.requestAnimationFrame) return;
	if (!hasRaf() || !wanted()) return;
	if (!watchingVisibility && typeof document !== "undefined") {
		watchingVisibility = true;
		document.addEventListener("visibilitychange", onVisibilityChange);
	}
	issuedBy = globalThis.requestAnimationFrame;
	handle = requestAnimationFrame(frame);
}

/** Cancels the outstanding frame once nothing needs it any more. */
function sleepIfIdle() {
	if (phaseIndex >= 0 || handle === null || wanted()) return;
	if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
	handle = null;
}

/**
 * Runs the phases from `first` on at timestamp `now`. Every callback runs even
 * if an earlier one throws; the first failure is rethrown at the end.
 */
function runPhases(now: number, first: number) {
	wakeRequested = false;
	let failure: unknown;
	let failed = false;
	const attempt = (callback: FrameCallback) => {
		try {
			callback(now);
		} catch (error) {
			if (!failed) {
				failed = true;
				failure = error;
			}
		}
	};
	try {
		for (let index = first; index < PHASES.length; index++) {
			phaseIndex = index;
			// A bare wake asked for before the paint phase is answered by this
			// frame's paint (passive participants run in it); only one asked for
			// during the paint itself needs another frame.
			if (index === PHASE_INDEX.paint) wakeRequested = false;
			for (const participant of [...(participants[index] ?? [])]) {
				attempt(participant.callback);
			}
			const pending = requests[index];
			if (!pending) continue;
			for (let round = 0; pending.size > 0 && round < MAX_ROUNDS; round++) {
				const batch = [...pending];
				pending.clear();
				for (const callback of batch) attempt(callback);
			}
		}
	} finally {
		phaseIndex = -1;
	}
	if (failed) throw failure;
}

function frame(now: number) {
	handle = null;
	try {
		runPhases(now, 0);
	} finally {
		ensure();
	}
}

/**
 * Registers `callback` to run in `phase` of every frame until the returned
 * function is called. An awake participant (the default) starts the loop and
 * keeps it running; a passive one (`{ awake: false }`) runs only in frames
 * something else caused. A participant registered during a frame first runs
 * in the next one.
 *
 * @example
 * ```ts
 * import { onFrame } from "@sophistry/core";
 *
 * // Count every frame the loop runs, without keeping it awake.
 * let frames = 0;
 * const stop = onFrame("paint", () => { frames += 1; }, { awake: false });
 * ```
 *
 * @param phase - Which phase to run in.
 * @param callback - Receives the frame timestamp in milliseconds.
 * @param options - See {@link FrameParticipantOptions}.
 * @returns A function that unregisters the participant.
 * @category Tracks & clocks
 */
export function onFrame(
	phase: FramePhase,
	callback: FrameCallback,
	options: FrameParticipantOptions = {},
): () => void {
	const participant: Participant = {
		callback,
		awake: options.awake ?? true,
		reset: options.reset,
	};
	participants[PHASE_INDEX[phase]]?.add(participant);
	if (participant.awake) awakeCount++;
	ensure();
	let registered = true;
	return () => {
		if (!registered) return;
		registered = false;
		participants[PHASE_INDEX[phase]]?.delete(participant);
		if (participant.awake) awakeCount--;
		sleepIfIdle();
	};
}

/**
 * Asks for one frame. With a `callback`, runs it once in `phase`: in the frame
 * now running when that phase has not finished yet (a commit that asks for a
 * paint gets it in the same frame; a callback requested during its own phase
 * runs later in that phase), otherwise in the next frame. Requests for the same
 * function collapse into one. Without a callback, wakes the loop for one frame
 * so passive {@link onFrame} participants run.
 *
 * @example
 * ```ts
 * import { createScene, requestFrame } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.querySelector("#figure")! });
 * // A scene that became dirty: commit (then paint) on the next frame.
 * requestFrame("commit", () => scene.commit());
 * ```
 *
 * @param phase - Which phase to run `callback` in. Defaults to `"commit"`.
 * @param callback - What to run once; omit to just wake the loop.
 * @returns A function withdrawing the request, if it has not run yet.
 * @category Tracks & clocks
 */
export function requestFrame(
	phase: FramePhase = "commit",
	callback?: FrameCallback,
): () => void {
	if (!callback) {
		wakeRequested = true;
		ensure();
		return () => {};
	}
	const pending = requests[PHASE_INDEX[phase]];
	pending?.add(callback);
	// A request for a phase this frame has already passed waits for the next.
	ensure();
	return () => {
		pending?.delete(callback);
		sleepIfIdle();
	};
}

/**
 * Runs `run` with the value of `source` in the commit phase of the frame after
 * `source` went stale. Several changes before that frame coalesce into one
 * run, which sees the latest value; a run that sees a value equal (by
 * `Object.is`) to the one it saw last is skipped. `run` is not called for the
 * value at subscription time.
 *
 * Use it to push a Readable into something that is not a scene node (a DOM
 * element's text, a log, a framework store). A `run` may write tracks; nodes
 * bound to them recompute in the same commit phase.
 *
 * @example
 * ```ts
 * import { track, watch } from "@sophistry/core";
 *
 * const output = document.querySelector("output")!;
 * const value = track(0);
 * const stop = watch(value, (current) => {
 *   output.textContent = current.toFixed(2);
 * });
 * ```
 *
 * @param source - What to watch.
 * @param run - Called with the new value.
 * @returns A function that stops watching (a pending run is dropped).
 * @category Reactivity
 */
export function watch<T>(
	source: Readable<T>,
	run: (value: T) => void,
): () => void {
	let seen = source.peek();
	let active = true;
	const commit = () => {
		if (!active) return;
		const value = source.peek();
		if (Object.is(value, seen)) return;
		seen = value;
		run(value);
	};
	const unsubscribe = source.subscribe(() => {
		if (active) requestFrame("commit", commit);
	});
	return () => {
		if (!active) return;
		active = false;
		unsubscribe();
		requests[PHASE_INDEX.commit]?.delete(commit);
		sleepIfIdle();
	};
}

/**
 * Runs one frame synchronously at timestamp `now`, as if
 * `requestAnimationFrame` had fired: every phase, every participant and every
 * pending request. An outstanding scheduled frame is cancelled and
 * rescheduled afterwards if still needed.
 *
 * For tests and offline rendering (frame export). `{ tick: false }` skips the
 * tick phase, so the frame commits and paints exactly the state written by
 * hand without advancing any clock. Throws when called from inside a frame.
 *
 * @param now - The frame timestamp in milliseconds.
 * @param options - `tick: false` to commit and paint only.
 * @category Tracks & clocks
 */
export function stepFrame(now: number, options: { tick?: boolean } = {}): void {
	if (phaseIndex >= 0) throw new Error("stepFrame() cannot run inside a frame");
	if (handle !== null && typeof cancelAnimationFrame === "function") {
		cancelAnimationFrame(handle);
	}
	handle = null;
	try {
		runPhases(now, options.tick === false ? 1 : 0);
	} finally {
		ensure();
	}
}

/**
 * The phase of the frame now running, or `null` between frames.
 *
 * @category Tracks & clocks
 */
export function currentFramePhase(): FramePhase | null {
	return PHASES[phaseIndex] ?? null;
}

/** Whether the loop currently has a frame outstanding. For tests. */
export function isFrameLoopRunning(): boolean {
	return handle !== null;
}

/** Drops every participant and request and forgets the outstanding frame. For tests only. */
export function resetFrameLoop(): void {
	for (const set of participants) set.clear();
	for (const set of requests) set.clear();
	awakeCount = 0;
	wakeRequested = false;
	handle = null;
	issuedBy = null;
	phaseIndex = -1;
}
