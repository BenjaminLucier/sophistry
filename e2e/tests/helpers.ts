import type { Page } from "@playwright/test";

export const FIXTURES = "http://127.0.0.1:5201";
export const DOCS = "http://127.0.0.1:4322";
export const PLAYGROUND = "http://127.0.0.1:5203";

/**
 * Installed before any page script. Counts animation frames (callbacks of one
 * frame share a timestamp) and records every `fill` on a stage's canvas with
 * the frame it happened in, so tests can say *which frame* a paint landed in.
 */
export const instrument = `
(() => {
	const t = (window.__probe = { frame: 0, lastStamp: -1, paints: [], counts: {} });
	const raf = window.requestAnimationFrame.bind(window);
	window.requestAnimationFrame = (cb) =>
		raf((stamp) => {
			if (stamp !== t.lastStamp) { t.lastStamp = stamp; t.frame++; }
			window.__t && (window.__t.frame = t.frame);
			cb(stamp);
		});
	const fill = CanvasRenderingContext2D.prototype.fill;
	CanvasRenderingContext2D.prototype.fill = function (...args) {
		const r = fill.apply(this, args);
		const canvas = this.canvas;
		const id = canvas.closest("[data-stage]")?.dataset.stage;
		if (id) {
			t.counts[id] = (t.counts[id] || 0) + 1;
			if (id === "same" && window.__t) {
				// Is the rect where the latest tick says it should be?
				const tick = window.__t.tick || 0;
				const w = canvas.width, h = canvas.height;
				const px = Math.round(w / 2 + (-7 + (tick % 140) * 0.1) * (w / 16));
				const d = this.getImageData(px, Math.round(h / 2), 1, 1).data;
				t.paints.push({ frame: t.frame, tick, hit: d[0] > 200 && d[1] < 60 });
			}
		}
		return r;
	};
})();
`;

/** Resolves after `n` animation frames. */
export const frames = (page: Page, n: number) =>
	page.evaluate(
		(count) =>
			new Promise<void>((resolve) => {
				let left = count;
				const step = () =>
					--left <= 0 ? resolve() : requestAnimationFrame(step);
				requestAnimationFrame(step);
			}),
		n,
	);

/** RGBA of one pixel of a stage's canvas, `fx`/`fy` as fractions of its size. */
export const pixel = (page: Page, stage: string, fx: number, fy: number) =>
	page.evaluate(
		({ stage, fx, fy }) => {
			const canvas = document.querySelector<HTMLCanvasElement>(
				`[data-stage="${stage}"] canvas`,
			);
			if (!canvas) throw new Error(`no canvas in ${stage}`);
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("no 2d context");
			return Array.from(
				ctx.getImageData(
					Math.round(canvas.width * fx),
					Math.round(canvas.height * fy),
					1,
					1,
				).data,
			);
		},
		{ stage, fx, fy },
	);

export const near = (
	rgba: number[],
	r: number,
	g: number,
	b: number,
	tol = 40,
) =>
	Math.abs(rgba[0] - r) <= tol &&
	Math.abs(rgba[1] - g) <= tol &&
	Math.abs(rgba[2] - b) <= tol &&
	rgba[3] > 200;
