// @vitest-environment happy-dom
/**
 * Frame export: each frame is seeked, committed and painted synchronously
 * before its encode, at exact times; the timeline and clocks are restored
 * afterwards; reduced motion is ignored; aborts and validation.
 * It paints a real scene's canvas.
 *
 * `export/` may not import `scene/`; tests are outside the layering rule, so
 * this one builds its scene with `createScene` all the same.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { valueTo } from "../anim/move.js";
import { timeline } from "../anim/timeline.js";
import type { Track } from "../reactive/index.js";
import { track } from "../reactive/index.js";
import type { Scene } from "../scene/scene.js";
import { createScene } from "../scene/scene.js";
import type { DomHarness } from "../scene/test-dom.js";
import { installDom, mountPoint } from "../scene/test-dom.js";
import { rect } from "../shapes/rect.js";
import { createClock } from "../tween/clock.js";
import { captureFrame, exportFrames, renderFrames } from "./frames.js";

const linear = { easing: "linear" } as const;

let dom: DomHarness;
let encodes: {
	time: number;
	painted: string;
	type?: string;
	quality?: number;
}[] = [];
let canvas!: HTMLCanvasElement;
let scene: Scene | null = null;
let x: Track<number> = track(0);

const originalToBlob = HTMLCanvasElement.prototype.toBlob;

beforeEach(() => {
	dom = installDom({ width: 100, height: 50 });
	encodes = [];
	x = track(0);
	HTMLCanvasElement.prototype.toBlob = (
		callback: BlobCallback,
		type?: string,
		quality?: unknown,
	) => {
		// What was painted since the previous encode is the frame being encoded.
		encodes.push({
			time: x.peek(),
			painted: dom
				.takeCalls()
				.map((call) => `${call.op}(${call.args.join(",")})`)
				.join(";"),
			type,
			quality: quality as number | undefined,
		});
		queueMicrotask(() =>
			callback(new Blob([`frame${encodes.length}`], { type })),
		);
	};
});

afterEach(() => {
	scene?.dispose();
	scene = null;
	HTMLCanvasElement.prototype.toBlob = originalToBlob;
	vi.unstubAllGlobals();
	dom.restore();
});

/**
 * A 100 x 50 scene, 40 units wide so the rect stays on screen for x in 0..10:
 * an off-screen node is culled, and would paint nothing to tell frames apart.
 */
function mount(clock = createClock()) {
	scene = createScene({ host: mountPoint(), units: 40, clock });
	scene.add(
		rect.create({
			center: { peek: () => ({ x: x.peek(), y: 0 }), subscribe: x.subscribe },
			width: 1,
			height: 1,
		}),
	);
	canvas = scene.canvas as HTMLCanvasElement;
	dom.drain();
	dom.takeCalls();
}

describe("renderFrames", () => {
	it("renders frames in order at exact times, painting each before it is encoded", async () => {
		mount();
		const tl = timeline(valueTo(x, 10, { duration: 1, ...linear }), {
			clock: createClock(),
		});
		const seen: number[] = [];
		const times: number[] = [];
		for await (const frame of renderFrames({ timeline: tl, canvas, fps: 4 })) {
			seen.push(frame.index);
			times.push(frame.time);
			expect(frame.count).toBe(5);
			expect(frame.blob).toBeInstanceOf(Blob);
		}
		expect(seen).toEqual([0, 1, 2, 3, 4]);
		expect(times).toEqual([0, 0.25, 0.5, 0.75, 1]);
		// x was sought to each instant before the encode...
		expect(encodes.map((encode) => encode.time)).toEqual([0, 2.5, 5, 7.5, 10]);
		// ...and the canvas had really been repainted for it (distinct draw
		// calls). The first instant is the state the canvas already shows (x at
		// its start), and a frame in which nothing changed paints nothing.
		const repainted = encodes.slice(1).map((encode) => encode.painted);
		expect(encodes[0]?.painted).toBe("");
		expect(new Set(repainted).size).toBe(4);
		for (const painted of repainted) expect(painted.length).toBeGreaterThan(0);
	});

	it("honours from/to/duration, type and quality", async () => {
		mount();
		const tl = timeline(valueTo(x, 10, { duration: 4, ...linear }), {
			clock: createClock(),
		});
		const frames = await exportFrames({
			timeline: tl,
			canvas,
			fps: 2,
			from: 1,
			duration: 1,
			type: "image/webp",
			quality: 0.5,
		});
		expect(frames.map((frame) => frame.time)).toEqual([1, 1.5, 2]);
		expect(
			encodes.every(
				(encode) => encode.type === "image/webp" && encode.quality === 0.5,
			),
		).toBe(true);
		const upTo = await exportFrames({ timeline: tl, canvas, fps: 1, to: 2 });
		expect(upTo.map((frame) => frame.time)).toEqual([0, 1, 2]);
	});

	it("restores the timeline position and resumes a paused clock", async () => {
		mount();
		const clock = createClock();
		const tl = timeline(valueTo(x, 10, { duration: 2, ...linear }), { clock });
		tl.seek(0.5);
		const frames = await exportFrames({ timeline: tl, canvas, fps: 2, clock });
		expect(frames.length).toBe(5);
		expect(tl.time.peek()).toBe(0.5);
		expect(x.peek()).toBe(2.5);
		expect(clock.paused.peek()).toBe(false);
	});

	it("pauses the clock during the export and keeps a playing timeline playing afterwards", async () => {
		mount();
		const clock = createClock();
		const tl = timeline(valueTo(x, 10, { duration: 2, ...linear }), { clock });
		void tl.play();
		expect(tl.playing.peek()).toBe(true);
		let pausedDuring = false;
		for await (const _ of renderFrames({
			timeline: tl,
			canvas,
			fps: 1,
			clock,
		})) {
			pausedDuring = clock.paused.peek() && !tl.playing.peek();
		}
		expect(pausedDuring).toBe(true);
		expect(tl.playing.peek()).toBe(true);
		expect(clock.paused.peek()).toBe(false);
	});

	it("restores state when the consumer stops early", async () => {
		mount();
		const tl = timeline(valueTo(x, 10, { duration: 1, ...linear }), {
			clock: createClock(),
		});
		for await (const frame of renderFrames({ timeline: tl, canvas, fps: 4 })) {
			if (frame.index === 2) break;
		}
		expect(tl.time.peek()).toBe(0);
		expect(x.peek()).toBe(0);
	});

	it("accepts a bare animation", async () => {
		mount();
		const frames = await exportFrames({
			timeline: valueTo(x, 10, { duration: 1, ...linear }),
			canvas,
			fps: 2,
		});
		expect(frames.length).toBe(3);
		expect(encodes.map((encode) => encode.time)).toEqual([0, 5, 10]);
		expect(x.peek()).toBe(0);
	});

	it("ignores reduced motion", async () => {
		mount();
		const clock = createClock({ reducedMotion: "reduce" });
		const tl = timeline(valueTo(x, 10, { duration: 1, ...linear }), { clock });
		await exportFrames({ timeline: tl, canvas, fps: 2, clock });
		expect(encodes.map((encode) => encode.time)).toEqual([0, 5, 10]);
	});

	it("aborts with an AbortError and still restores", async () => {
		mount();
		const tl = timeline(valueTo(x, 10, { duration: 1, ...linear }), {
			clock: createClock(),
		});
		const controller = new AbortController();
		const seen: number[] = [];
		await expect(
			exportFrames({
				timeline: tl,
				canvas,
				fps: 4,
				signal: controller.signal,
				onFrame: (frame) => {
					seen.push(frame.index);
					if (frame.index === 1) controller.abort();
				},
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(seen).toEqual([0, 1]);
		expect(tl.time.peek()).toBe(0);
		expect(x.peek()).toBe(0);
	});

	it("rejects an already aborted signal before touching anything", async () => {
		mount();
		const tl = timeline(valueTo(x, 10), { clock: createClock() });
		const controller = new AbortController();
		controller.abort();
		await expect(
			exportFrames({ timeline: tl, canvas, signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(encodes.length).toBe(0);
	});

	it("validates fps and infinite timelines", async () => {
		mount();
		const tl = timeline(valueTo(x, 10), { clock: createClock() });
		await expect(
			exportFrames({ timeline: tl, canvas, fps: 0 }),
		).rejects.toThrow(RangeError);
		const infinite = timeline(
			{ duration: Number.POSITIVE_INFINITY, seek: () => {} },
			{ clock: createClock() },
		);
		await expect(exportFrames({ timeline: infinite, canvas })).rejects.toThrow(
			/infinite/,
		);
		await expect(
			exportFrames({ timeline: infinite, canvas, duration: 0.1, fps: 10 }),
		).resolves.toHaveLength(2);
	});

	it("exportFrames streams to onFrame without collecting", async () => {
		mount();
		const tl = timeline(valueTo(x, 10, { duration: 1, ...linear }), {
			clock: createClock(),
		});
		const got: number[] = [];
		const result = await exportFrames({
			timeline: tl,
			canvas,
			fps: 2,
			onFrame: async (frame) => {
				got.push(frame.index);
			},
		});
		expect(result).toEqual([]);
		expect(got).toEqual([0, 1, 2]);
	});
});

describe("renderFrames and a live run", () => {
	it("does not settle the user's pending play(), and play continues afterwards", async () => {
		mount();
		const clock = createClock();
		const tl = timeline(valueTo(x, 10, { duration: 1, ...linear }), { clock });
		let result: string | undefined;
		void tl.play().then((outcome) => {
			result = outcome;
		});
		clock.advance(0.25);
		// fps 1 renders t = 0 and t = 1: the export seeks to the very end.
		await exportFrames({ timeline: tl, canvas, fps: 1 });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(result).toBeUndefined();
		expect(tl.time.peek()).toBe(0.25);
		expect(tl.playing.peek()).toBe(true);
		clock.advance(0.75);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(result).toBe("done");
	});

	it("holds the timeline's own clock still without a clock option", async () => {
		mount();
		const clock = createClock();
		const tl = timeline(valueTo(x, 10, { duration: 2, ...linear }), { clock });
		let pausedDuring = false;
		for await (const _ of renderFrames({ timeline: tl, canvas, fps: 1 })) {
			pausedDuring = clock.paused.peek();
		}
		expect(pausedDuring).toBe(true);
		expect(clock.paused.peek()).toBe(false);
	});

	it("leaves a never-run timeline pristine: relative starts recapture afterwards", async () => {
		mount();
		const clock = createClock();
		const tl = timeline(
			valueTo(x, (value) => value + 1, { duration: 1, ...linear }),
			{
				clock,
			},
		);
		await exportFrames({ timeline: tl, canvas, fps: 2 });
		expect(x.peek()).toBe(0);
		x.set(100);
		void tl.play();
		clock.advance(1);
		expect(x.peek()).toBe(101);
	});

	it("ends on the exact end state when duration * fps is not a whole number", async () => {
		mount();
		const tl = timeline(valueTo(x, 10, { duration: 0.9, ...linear }), {
			clock: createClock(),
		});
		const frames = await exportFrames({ timeline: tl, canvas, fps: 2 });
		expect(frames.map((frame) => frame.time)).toEqual([0, 0.5, 0.9]);
		expect(frames.map((frame) => frame.count)).toEqual([3, 3, 3]);
		expect(encodes.at(-1)?.time).toBe(10);
	});

	it("reports the type the browser actually encoded", async () => {
		mount();
		HTMLCanvasElement.prototype.toBlob = (callback: BlobCallback) =>
			queueMicrotask(() => callback(new Blob(["x"], { type: "image/png" })));
		const [frame] = await exportFrames({
			timeline: valueTo(x, 1, { duration: 0 }),
			canvas,
			type: "image/webp",
		});
		expect(frame?.type).toBe("image/png");
	});

	it("works with a scene's own timeline", async () => {
		mount();
		const tl = (scene as Scene).timeline(
			valueTo(x, 10, { duration: 1, ...linear }),
		);
		const frames = await exportFrames({ timeline: tl, canvas, fps: 2 });
		expect(frames.length).toBe(3);
		expect(encodes.map((encode) => encode.time)).toEqual([0, 5, 10]);
	});
});

describe("captureFrame", () => {
	it("encodes a canvas as PNG by default", async () => {
		mount();
		const blob = await captureFrame(canvas);
		expect(blob.type).toBe("image/png");
	});

	it("uses convertToBlob on an OffscreenCanvas", async () => {
		const convertToBlob = vi.fn(
			async (options: { type: string }) =>
				new Blob(["x"], { type: options.type }),
		);
		const blob = await captureFrame(
			{ convertToBlob } as unknown as OffscreenCanvas,
			{ type: "image/webp", quality: 0.8 },
		);
		expect(convertToBlob).toHaveBeenCalledWith({
			type: "image/webp",
			quality: 0.8,
		});
		expect(blob.type).toBe("image/webp");
	});

	it("rejects when the canvas cannot encode", async () => {
		const bad = {
			toBlob: (callback: BlobCallback) => callback(null),
		} as unknown as HTMLCanvasElement;
		await expect(captureFrame(bad)).rejects.toThrow(/could not encode/);
	});
});
