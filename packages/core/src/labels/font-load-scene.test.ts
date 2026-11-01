// @vitest-environment happy-dom
/**
 * A web font load reaching a mounted scene: `createScene` hands the graph an
 * `onFontLoad` that calls `renderer.invalidate()`, so cached layers drawn
 * with the fallback font repaint, and the next frame paints again although
 * no spec changed. A scene without text neither listens nor repaints.
 *
 * `document.fonts` is replaced by an `EventTarget` before anything measures,
 * so the metrics module's one listener lands on it.
 */

import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Scene } from "../scene/scene.js";
import { createScene, sceneInternals } from "../scene/scene.js";
import type { DomHarness } from "../scene/test-dom.js";
import { installDom, mountPoint } from "../scene/test-dom.js";
import { label } from "../scene/text.js";
import { circle } from "../shapes/circle.js";

const fonts = new EventTarget();
const original = Object.getOwnPropertyDescriptor(document, "fonts");
Object.defineProperty(document, "fonts", { value: fonts, configurable: true });

afterAll(() => {
	if (original) Object.defineProperty(document, "fonts", original);
	else delete (document as { fonts?: unknown }).fonts;
});

let dom: DomHarness;
const scenes: Scene[] = [];

beforeEach(() => {
	dom = installDom({ width: 1000, height: 500 });
});

afterEach(() => {
	for (const scene of scenes.splice(0)) scene.dispose();
	dom.restore();
});

function mount(): Scene {
	const scene = createScene({ host: mountPoint() });
	scenes.push(scene);
	return scene;
}

describe("font loads in a scene", () => {
	it("invalidate the renderer of a scene with text, which repaints", () => {
		const scene = mount();
		scene.add(label.create({ text: "Hello" }));
		dom.drain();
		const renderer = sceneInternals(scene)?.renderer;
		if (!renderer) throw new Error("expected a renderer");
		const invalidate = vi.spyOn(renderer, "invalidate");
		dom.takeCalls();
		fonts.dispatchEvent(new Event("loadingdone"));
		expect(invalidate).toHaveBeenCalledTimes(1);
		dom.drain();
		expect(dom.takeCalls().some((call) => call.op === "fillText")).toBe(true);
	});

	it("leave a scene without text alone", () => {
		const scene = mount();
		scene.add(circle.create({ radius: 1 }));
		dom.drain();
		const renderer = sceneInternals(scene)?.renderer;
		if (!renderer) throw new Error("expected a renderer");
		const invalidate = vi.spyOn(renderer, "invalidate");
		dom.takeCalls();
		fonts.dispatchEvent(new Event("loadingdone"));
		dom.drain();
		expect(invalidate).not.toHaveBeenCalled();
		expect(dom.takeCalls()).toEqual([]);
	});
});
