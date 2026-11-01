/**
 * Deterministic frame export. For each frame the timeline is seeked to an
 * exact instant and the shared frame loop runs one frame synchronously
 * without ticking any clock (`stepFrame(now, { tick: false })`: every scene
 * commits and every visible renderer paints exactly the state just written),
 * then the canvas is encoded, so output is independent of machine speed.
 * Offline rendering ignores reduced motion, and never settles a pending
 * `play()`. Resolution is the canvas backing store (the scene's box times
 * `devicePixelRatio`).
 *
 * Nothing here knows about scenes: it drives the frame loop and encodes a
 * canvas, so any canvas a scene paints into (`scene.canvas`) will do.
 */

import type { Animation } from "../anim/animation.js";
import type { Timeline } from "../anim/timeline.js";
import {
	timeline as createTimeline,
	timelineInternals,
} from "../anim/timeline.js";
import { isReadable } from "../reactive/index.js";
import type { Clock } from "../tween/clock.js";
import { stepFrame } from "../tween/frame-loop.js";

/**
 * Image formats `toBlob` universally supports; browsers may add more.
 *
 * @category Export
 */
export type FrameImageType = "image/png" | "image/webp" | "image/jpeg";

/**
 * A canvas this module can encode: anything with `toBlob` (an
 * `HTMLCanvasElement`) or `convertToBlob` (an `OffscreenCanvas`).
 *
 * @category Export
 */
export type ExportCanvas =
	| Pick<HTMLCanvasElement, "toBlob">
	| Pick<OffscreenCanvas, "convertToBlob">;

/**
 * Options for {@link captureFrame}.
 *
 * @category Export
 */
export interface CaptureOptions {
	/**
	 * Encoding. The default PNG is lossless and keeps alpha.
	 * @default `"image/png"`
	 */
	type?: FrameImageType;
	/** 0..1 for lossy types (`image/webp`, `image/jpeg`); ignored for PNG. */
	quality?: number;
}

/**
 * One exported frame.
 *
 * @category Export
 */
export interface ExportedFrame {
	/** The encoded image. */
	blob: Blob;
	/** Zero-based frame number. */
	index: number;
	/** Timeline time of the frame in seconds. */
	time: number;
	/** Total number of frames in this export. */
	count: number;
	/**
	 * The MIME type the browser actually encoded, which can differ from the one
	 * requested: Safari silently falls back to PNG for `image/webp`. Check it
	 * before naming files by the requested extension.
	 */
	type: string;
}

/**
 * Options for {@link renderFrames} and {@link exportFrames}.
 *
 * @category Export
 */
export interface RenderFramesOptions extends CaptureOptions {
	/**
	 * What to render: a {@link Timeline}, or a bare {@link Animation} (a timeline
	 * is made for it on `clock`). Its state is restored when the export ends:
	 * a timeline that has been run returns to its position (and keeps playing if
	 * it was), and one that was never run goes back to its untouched start.
	 */
	timeline: Timeline | Animation;
	/** The canvas to encode: the scene's (`scene.canvas`). */
	canvas: ExportCanvas;
	/**
	 * Frames per second of exported time.
	 * @default 30
	 */
	fps?: number;
	/**
	 * First instant to render, in seconds.
	 * @default 0
	 */
	from?: number;
	/**
	 * Last instant to render (inclusive), in seconds. Defaults to the
	 * timeline's duration, or `from + duration`. Required for infinite
	 * timelines.
	 */
	to?: number;
	/** Length to render from `from`; alternative to `to`. */
	duration?: number;
	/**
	 * A clock to hold still during the export, so ambient animations on it do
	 * not move the scene between the seek and the encode. Paused for the
	 * duration and resumed afterwards if it was running. Defaults to the
	 * clock the `timeline` itself runs on, so you normally leave it out; pass
	 * it to hold a different clock (say the scene's) still. Also the clock used
	 * when `timeline` is a bare animation.
	 */
	clock?: Clock;
	/** Aborts the export: the iteration throws an `AbortError`. State is still restored. */
	signal?: AbortSignal;
}

/** Whether `value` is a {@link Timeline} rather than a bare animation. */
function isTimeline(value: Timeline | Animation): value is Timeline {
	return (
		isReadable((value as Timeline).time) &&
		typeof (value as Timeline).play === "function"
	);
}

/** A timestamp for a synchronous frame. */
const now = () =>
	typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * Encodes the canvas as it is right now.
 *
 * The canvas holds what was last painted; to capture a scene right after
 * changing tracks, run a frame first (`stepFrame(performance.now(), { tick:
 * false })`), or use {@link renderFrames}, which does that for you.
 *
 * @param canvas - The canvas to encode.
 * @param options - Format and quality.
 * @returns The encoded image.
 * @category Export
 */
export async function captureFrame(
	canvas: ExportCanvas,
	options: CaptureOptions = {},
): Promise<Blob> {
	const type = options.type ?? "image/png";
	if ("convertToBlob" in canvas) {
		return canvas.convertToBlob({ type, quality: options.quality });
	}
	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) =>
				blob
					? resolve(blob)
					: reject(
							new Error(`captureFrame(): the canvas could not encode ${type}`),
						),
			type,
			options.quality,
		);
	});
}

/** The times to render for `options`, validated. */
function frameTimes(options: RenderFramesOptions, total: number): number[] {
	const fps = options.fps ?? 30;
	if (!(fps > 0) || !Number.isFinite(fps)) {
		throw new RangeError("renderFrames(): fps must be a positive number");
	}
	const from = options.from ?? 0;
	const to =
		options.to ??
		(options.duration !== undefined ? from + options.duration : total);
	if (!Number.isFinite(to)) {
		throw new RangeError(
			"renderFrames(): the timeline is infinite; pass `to` or `duration`",
		);
	}
	if (!(to >= from)) {
		throw new RangeError("renderFrames(): `to` must not be before `from`");
	}
	const count = Math.floor((to - from) * fps + 1e-9) + 1;
	const times = Array.from({ length: count }, (_, i) => from + i / fps);
	// When the range is not a whole number of frames the grid stops short of
	// `to`; render the exact end state last instead of silently dropping it.
	if (to - (times.at(-1) ?? from) > 1e-9) times.push(to);
	return times;
}

/**
 * Renders a timeline to images, one `await` per frame, at `from + i / fps`
 * through `to` (a 1 s timeline at 30 fps gives 31 frames, plus one at exactly
 * `to` when it falls between frames). The scene must be visible
 * (`pauseWhenHidden: false` for off-screen export). Afterwards the timeline
 * returns to where it was.
 *
 * @example
 * ```ts
 * import { createScene, renderFrames, track, valueTo } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, pauseWhenHidden: false });
 * const x = track(0);
 * const tl = scene.timeline(valueTo(x, 10, { duration: 2 }));
 * const files: File[] = [];
 * for await (const frame of renderFrames({ timeline: tl, canvas: scene.canvas!, fps: 30 })) {
 *   files.push(new File([frame.blob], `frame-${frame.index}.png`));
 * }
 * ```
 *
 * @param options - See {@link RenderFramesOptions}.
 * @returns An async iterator of {@link ExportedFrame}.
 * @see {@link https://sophistry.dev/recipes/export-stills/}
 * @category Export
 */
export async function* renderFrames(
	options: RenderFramesOptions,
): AsyncGenerator<ExportedFrame, void, undefined> {
	const tl = isTimeline(options.timeline)
		? options.timeline
		: createTimeline(options.timeline, {
				clock: options.clock,
				motion: "essential",
			});
	const times = frameTimes(options, tl.duration);
	const hooks = timelineInternals(tl);
	// Without the internal hooks (a hand-made Timeline) fall back to the public
	// `seek`, which settles a pending run that reaches the end.
	const scrub = hooks ? hooks.scrub : tl.seek;
	const clock = options.clock ?? hooks?.clock;
	const pristine = hooks?.pristine() ?? false;
	const priorTime = tl.time.peek();
	const wasPlaying = tl.playing.peek();
	const clockWasRunning = clock ? !clock.paused.peek() : false;

	options.signal?.throwIfAborted();
	tl.pause();
	if (clockWasRunning) clock?.pause();
	try {
		for (const [index, time] of times.entries()) {
			options.signal?.throwIfAborted();
			scrub(time);
			// Commit and paint what the seek wrote, without advancing any clock.
			stepFrame(now(), { tick: false });
			const blob = await captureFrame(options.canvas, options);
			options.signal?.throwIfAborted();
			yield { blob, index, time, count: times.length, type: blob.type };
		}
	} finally {
		// A timeline nothing had written to goes back to never-entered (tracks at
		// their start, captures forgotten); otherwise return to where it was.
		if (pristine) hooks?.reset();
		else scrub(priorTime);
		if (clockWasRunning) clock?.resume();
		if (wasPlaying) void tl.play();
	}
}

/**
 * Options for {@link exportFrames}.
 *
 * @category Export
 */
export interface ExportFramesOptions extends RenderFramesOptions {
	/** Called with each frame as soon as it is encoded (stream it out instead of holding every blob). */
	onFrame?: (frame: ExportedFrame) => void | Promise<void>;
}

/**
 * Renders a timeline and collects the frames; the convenience form of
 * {@link renderFrames}.
 *
 * Holding every frame in memory is fine for short clips; for long ones pass
 * `onFrame` and persist each blob as it arrives (the returned array is then
 * empty). Returning a promise from `onFrame` applies back-pressure.
 *
 * @param options - See {@link ExportFramesOptions}.
 * @returns The frames in order (empty when `onFrame` is given).
 * @category Export
 */
export async function exportFrames(
	options: ExportFramesOptions,
): Promise<ExportedFrame[]> {
	const collected: ExportedFrame[] = [];
	for await (const frame of renderFrames(options)) {
		if (options.onFrame) await options.onFrame(frame);
		else collected.push(frame);
	}
	return collected;
}
