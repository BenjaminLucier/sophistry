// @vitest-environment happy-dom
/**
 * A `scatter` on a real scene is one tab stop whose markers the keys walk: a
 * listbox with one option, the current marker, announced with its tooltip
 * text and its place along the screen.
 */

import { createScene, stepFrame } from "@sophistry/core";
import { resetFrameLoop } from "@sophistry/core/internal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chart } from "../chart.js";
import { scatter } from "./index.js";

let frames: FrameRequestCallback[] = [];
let dispose: (() => void) | null = null;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalRaf = globalThis.requestAnimationFrame;
const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
	frames = [];
	const target: Record<string, unknown> = {};
	const ctx = new Proxy(target, {
		get(_, prop: string) {
			if (prop === "measureText") return () => ({ width: 10 });
			return target[prop] ?? (() => {});
		},
		set(_, prop: string, value: unknown) {
			target[prop] = value;
			return true;
		},
	});
	HTMLCanvasElement.prototype.getContext = (() =>
		ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
	globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
		frames.push(cb);
		return frames.length;
	};
	globalThis.cancelAnimationFrame = () => {};
	HTMLElement.prototype.getBoundingClientRect = () =>
		({
			left: 0,
			top: 0,
			right: 1000,
			bottom: 500,
			x: 0,
			y: 0,
			width: 1000,
			height: 500,
		}) as DOMRect;
});

afterEach(() => {
	dispose?.();
	dispose = null;
	document.body.innerHTML = "";
	HTMLCanvasElement.prototype.getContext = originalGetContext;
	globalThis.requestAnimationFrame = originalRaf;
	HTMLElement.prototype.getBoundingClientRect = originalRect;
	resetFrameLoop();
});

let now = 0;
function paint(): void {
	for (let i = 0; i < 5; i++) {
		now += 16;
		const queued = frames;
		frames = [];
		for (const cb of queued) cb(now);
		stepFrame(now);
	}
}

const key = (el: HTMLElement, name: string) => {
	el.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: name,
			bubbles: true,
			cancelable: true,
		}),
	);
};

// Out of x order on purpose: the keys walk the screen, not the data.
const data = [
	{ x: 3, y: 1 },
	{ x: 1, y: 4 },
	{ x: 2, y: 2 },
	{ x: 4, y: 3 },
];

describe("scatter by keyboard", () => {
	it("walks the markers left to right as one listbox tab stop", () => {
		const host = document.createElement("div");
		document.body.append(host);
		const scene = createScene({ host, units: 16 });
		dispose = () => scene.dispose();
		scene.add(
			chart.create({
				width: 8,
				height: 4,
				xRange: [0, 5],
				yRange: [0, 5],
				children: [scatter.create({ data, x: "x", y: "y", tooltip: true })],
			}),
		);
		paint();

		const stops = [...host.querySelectorAll<HTMLElement>("[data-vis-focus]")];
		expect(stops).toHaveLength(1);
		const [list] = stops as [HTMLElement];
		expect(list.getAttribute("role")).toBe("listbox");
		expect(list.getAttribute("aria-label")).toBe("Scatter, 4 points");
		expect(list.getAttribute("aria-activedescendant")).toBeNull();

		list.focus();
		const option = () => list.querySelector<HTMLElement>('[role="option"]');
		const seen: string[] = [];
		const step = (name: string) => {
			key(list, name);
			paint();
			seen.push(
				`${option()?.getAttribute("aria-posinset")}/${option()?.getAttribute("aria-setsize")} ${option()?.textContent}`,
			);
		};
		step("ArrowRight");
		expect(list.getAttribute("aria-activedescendant")).toBe(option()?.id);
		step("ArrowRight");
		step("End");
		step("ArrowRight");
		step("Home");
		// Place along the screen, of how many, then the marker's tooltip.
		expect(seen).toEqual([
			"1/4 x: 1, y: 4",
			"2/4 x: 2, y: 2",
			"4/4 x: 4, y: 3",
			"4/4 x: 4, y: 3",
			"1/4 x: 1, y: 4",
		]);

		key(list, "Escape");
		paint();
		expect(list.getAttribute("aria-activedescendant")).toBeNull();
	});
});
