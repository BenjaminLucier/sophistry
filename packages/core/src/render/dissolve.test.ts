/**
 * `Renderer.dissolve`: the stage-level cross-fade a reduced-motion jump is
 * painted through. The current pixels are copied once, then laid over each
 * new frame at falling opacity until the duration has passed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTheme } from "../themes";
import { createPaintHost } from "./test-host";

type Call = { op: string; args: unknown[] };

/** A context that records what the dissolve cares about, and accepts everything else. */
function recordingContext(calls: Call[]): CanvasRenderingContext2D {
	const record =
		(op: string) =>
		(...args: unknown[]) => {
			calls.push({ op, args });
		};
	let alpha = 1;
	const target: Record<string, unknown> = {
		drawImage: record("drawImage"),
		clearRect: record("clearRect"),
		get globalAlpha() {
			return alpha;
		},
		set globalAlpha(value: number) {
			alpha = value;
			calls.push({ op: "set:globalAlpha", args: [value] });
		},
	};
	return new Proxy(target, {
		get(object, key) {
			if (key in object) return Reflect.get(object, key);
			return () => {};
		},
		set(object, key, value) {
			return Reflect.set(object, key, value);
		},
	}) as unknown as CanvasRenderingContext2D;
}

let now = 0;

beforeEach(() => {
	now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function setup() {
	const stage: Call[] = [];
	const copy: Call[] = [];
	const surface = {
		width: 0,
		height: 0,
		getContext: () => recordingContext(copy),
	};
	const canvas = {
		getContext: () => recordingContext(stage),
		ownerDocument: { createElement: () => surface },
	} as unknown as HTMLCanvasElement;
	const host = createPaintHost(
		{ canvas, theme: resolveTheme(), size: { width: 100, height: 50 } },
		(renderer) => renderer.setFrame([]),
	);
	host.drain();
	stage.length = 0;
	return {
		renderer: host.renderer,
		host,
		stage,
		copy,
		canvas,
		surface,
		dispose: () => host.renderer.dispose(),
	};
}

const overlays = (calls: Call[]) => calls.filter((c) => c.op === "drawImage");

describe("Renderer.dissolve", () => {
	it("copies the canvas once and fades the copy out over the next frames", () => {
		const { renderer, host, stage, copy, canvas, surface, dispose } = setup();
		renderer.dissolve(0.15);
		expect(overlays(copy).map((c) => c.args[0])).toEqual([canvas]);
		expect(surface.width).toBe(100);

		now = 50;
		expect(host.frame()).toBe(true);
		expect(overlays(stage).map((c) => c.args[0])).toEqual([surface]);
		const alphas = stage
			.filter((c) => c.op === "set:globalAlpha")
			.map((c) => c.args[0] as number);
		expect(alphas.some((a) => Math.abs(a - 2 / 3) < 1e-9)).toBe(true);

		// Past the end: one last plain frame, and the loop goes quiet.
		now = 200;
		stage.length = 0;
		expect(host.drain()).toBe(1);
		expect(overlays(stage)).toHaveLength(0);
		expect(host.requested()).toBe(false);
		dispose();
	});

	it("leaves a running dissolve to finish rather than copying again", () => {
		const { renderer, host, copy, dispose } = setup();
		renderer.dissolve(0.15);
		now = 40;
		renderer.dissolve(0.15);
		expect(overlays(copy)).toHaveLength(1);
		now = 400;
		host.drain();
		renderer.dissolve(0.15);
		expect(overlays(copy)).toHaveLength(2);
		dispose();
	});

	it("is dropped while hidden, and does nothing for a zero duration", () => {
		const { renderer, host, stage, copy, dispose } = setup();
		renderer.dissolve(0);
		expect(overlays(copy)).toHaveLength(0);
		renderer.setVisible(false);
		renderer.dissolve(0.15);
		expect(overlays(copy)).toHaveLength(0);
		expect(renderer.needsPaint()).toBe(false);
		renderer.setVisible(true);
		host.drain();
		expect(overlays(stage)).toHaveLength(0);
		dispose();
	});
});
