/**
 * `createLatex` / `mathTex` / `mathTransform` on the framework-free scene
 * graph: a formula is absent until its outline lands (its siblings draw at
 * once), the previous formula stays up while a new one loads, `ready()`
 * waits for the current props, and failures reach `onError` or the next
 * commit. Run against headless scenes. KaTeX cannot
 * lay anything out outside a browser, so `latexOutline` is a controllable
 * fake.
 */

import type { ContainerNode, Scene } from "@sophistry/core";
import {
	circle,
	createScene,
	derive,
	resolveTheme,
	track,
	writeLagRatio,
	writePhase,
} from "@sophistry/core";
import type { ShapeSpec } from "@sophistry/core/internal";
import { plainShapeSpec } from "@sophistry/core/internal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LatexOutline } from "./outline.js";
import { OUTLINE_RATIO } from "./outline-stroke.js";

interface Deferred {
	tex: string;
	resolve: () => void;
	reject: (error: unknown) => void;
}

let pendingRequests: Deferred[] = [];

/** One glyph per character, each a unit-wide box, so tests can tell formulas apart by width and part count. */
const fake = (tex: string): LatexOutline => ({
	parts: [...tex].map((char, index) => ({
		kind: "glyph" as const,
		box: { minX: index, minY: 0, maxX: index + 1, maxY: 1 },
		char,
		polylines: [
			[
				{ x: index, y: 0 },
				{ x: index + 1, y: 0 },
				{ x: index + 1, y: 1 },
				{ x: index, y: 1 },
			],
		],
	})),
	width: tex.length,
	height: 1,
});

vi.mock("./outline.js", () => ({
	latexOutline: vi.fn(
		(tex: string) =>
			new Promise((resolve, reject) => {
				pendingRequests.push({
					tex,
					resolve: () => resolve(fake(tex)),
					reject,
				});
			}),
	),
}));

import { createLatex } from "./latex.js";
import { MathTexNode, mathTex } from "./math-tex.js";
import { mathTransform } from "./math-transform.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Settles the oldest unsettled request for `tex`. */
async function land(tex: string) {
	const index = pendingRequests.findIndex((request) => request.tex === tex);
	expect(index, `request for ${tex}`).toBeGreaterThanOrEqual(0);
	pendingRequests.splice(index, 1)[0]?.resolve();
	await tick();
}

/** Fails the oldest unsettled request for `tex`. */
async function fail(tex: string, error: unknown = new Error("boom")) {
	const index = pendingRequests.findIndex((request) => request.tex === tex);
	expect(index, `request for ${tex}`).toBeGreaterThanOrEqual(0);
	pendingRequests.splice(index, 1)[0]?.reject(error);
	await tick();
}

const theme = resolveTheme({ mode: "dark" });
let scene: Scene;

function shapes(): ShapeSpec[] {
	scene.commit();
	return scene
		.snapshot()
		.filter((spec): spec is ShapeSpec => spec.kind === "shape");
}

beforeEach(() => {
	pendingRequests = [];
	scene = createScene({
		headless: true,
		size: { width: 800, height: 450 },
		units: 10,
		theme,
	});
});
afterEach(() => {
	scene.dispose();
	vi.restoreAllMocks();
});

describe("createLatex", () => {
	it("is null until the outline lands, then the placed formula", async () => {
		const placed = createLatex("x");
		const stale = vi.fn();
		placed.subscribe(stale);
		expect(placed.peek()).toBeNull();
		expect(placed.pending()).toBe(true);
		await land("x");
		expect(stale).toHaveBeenCalled();
		expect(placed.peek()?.width).toBe(1);
		expect(placed.status.peek()).toBe("ready");
		placed.dispose();
	});

	it("keeps the previous formula readable and reports pending while a new one loads", async () => {
		const tex = track("ab");
		const placed = createLatex(tex);
		await land("ab");
		expect(placed.peek()?.width).toBe(2);
		expect(placed.pending()).toBe(false);

		tex.set("abcd");
		expect(placed.pending()).toBe(true);
		expect(placed.peek()?.width).toBe(2); // stale stays up
		await land("abcd");
		expect(placed.peek()?.width).toBe(4);
		expect(placed.pending()).toBe(false);
		placed.dispose();
	});

	it("ready() waits for the formula", async () => {
		const placed = createLatex("abc");
		let width = 0;
		const done = placed.ready().then(() => {
			width = placed.peek()?.width ?? -1;
		});
		await tick();
		expect(width).toBe(0);
		await land("abc");
		await done;
		expect(width).toBe(3);
		placed.dispose();
	});

	it("sends a rejection to onError, error() and ready()", async () => {
		const onError = vi.fn();
		const placed = createLatex("\\bad", { onError });
		const outcome = placed.ready().then(
			() => "ok",
			(error: unknown) => String(error),
		);
		await fail("\\bad");
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0]?.[1]).toBe("\\bad");
		expect(String(placed.error())).toContain("boom");
		expect(placed.status.peek()).toBe("failed");
		expect(placed.peek()).toBeNull();
		expect(await outcome).toContain("boom");
		placed.dispose();
	});

	it("a superseded request's failure is not reported", async () => {
		const onError = vi.fn();
		const tex = track("\\bad");
		const placed = createLatex(tex, { onError });
		tex.set("ok");
		placed.peek();
		await fail("\\bad");
		await land("ok");
		expect(onError).not.toHaveBeenCalled();
		expect(placed.peek()?.width).toBe(2);
		placed.dispose();
	});

	it("changing fontSize re-places without typesetting again", async () => {
		const options = track({ fontSize: 1 });
		const placed = createLatex("ab", options);
		await land("ab");
		options.set({ fontSize: 3 });
		expect(placed.peek()?.width).toBe(6);
		expect(pendingRequests).toHaveLength(0);
		placed.dispose();
	});

	it("takes a formula already typeset synchronously", async () => {
		const first = createLatex("ab");
		await land("ab");
		// The fake answers each call with a new promise; share the settled one
		// as the real outline cache does.
		const { latexOutline } = await import("./outline.js");
		const shared = Promise.resolve(fake("ab"));
		vi.mocked(latexOutline)
			.mockReturnValueOnce(shared)
			.mockReturnValueOnce(shared);
		const warm = createLatex("ab");
		await warm.ready();
		warm.dispose();
		const again = createLatex("ab");
		expect(again.pending()).toBe(false);
		expect(again.peek()?.width).toBe(2);
		first.dispose();
		again.dispose();
	});

	it("ready() rejects with an AbortError once disposed", async () => {
		const placed = createLatex("ab");
		const outcome = placed.ready().then(
			() => "resolved",
			(error: DOMException) => error.name,
		);
		placed.dispose();
		expect(await outcome).toBe("AbortError");
	});
});

describe("mathTex", () => {
	it("does not blank the scene: siblings draw while the formula loads", async () => {
		const warn = vi.spyOn(console, "warn");
		const error = vi.spyOn(console, "error");
		scene.add(circle.create({ radius: 1 }));
		const formula = scene.add(mathTex.create({ tex: "ab" }));
		expect(formula).toBeInstanceOf(MathTexNode);
		expect(shapes()).toHaveLength(1);
		expect(formula.pending()).toBe(true);
		let ready = false;
		void formula.ready().then(() => {
			ready = true;
		});
		await tick();
		expect(ready).toBe(false);
		await land("ab");
		expect(ready).toBe(true);
		expect(formula.pending()).toBe(false);
		expect(formula.placed()?.width).toBe(2);
		expect(shapes()).toHaveLength(2);
		expect(warn).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});

	it("keeps the old formula up while tex changes, and reports each typeset", async () => {
		const typeset: number[] = [];
		const tex = track("ab");
		const formula = scene.add(
			mathTex.create({
				tex,
				onTypeset: (placed) => typeset.push(placed.width),
			}),
		);
		scene.commit();
		await land("ab");
		expect(typeset).toEqual([2]);
		const before = shapes()[0];
		expect(before?.write?.pieces).toEqual([0, 1]);

		tex.set("abcd");
		expect(formula.pending()).toBe(false); // not yet pulled
		scene.commit();
		expect(formula.pending()).toBe(true);
		expect(shapes()[0]).toBe(before);
		expect(formula.placed()?.width).toBe(2);
		await land("abcd");
		expect(formula.pending()).toBe(false);
		expect(typeset).toEqual([2, 4]);
		expect(shapes()[0]?.write?.pieces).toEqual([0, 1, 2, 3]);
	});

	it("status, bound to a prop, tracks the wait", async () => {
		const tex = track("ab");
		const formula = mathTex.create({ tex });
		formula.set(
			"opacity",
			derive(formula.status, (status) => (status === "pending" ? 0.4 : 1)),
		);
		scene.add(formula);
		scene.commit();
		await land("ab");
		expect(shapes()[0]?.style.opacity).toBe(1);
		tex.set("abc");
		scene.commit();
		expect(shapes()[0]?.style.opacity).toBe(0.4);
		await land("abc");
		expect(shapes()[0]?.style.opacity).toBe(1);
	});

	it("writes glyph by glyph: one piece per part, the outline sized by fontSize", async () => {
		const progress = track(0.5);
		scene.add(mathTex.create({ tex: "abc", fontSize: 2, progress }));
		scene.commit();
		await land("abc");
		const [spec] = shapes();
		expect(spec?.progress).toBe(0.5);
		expect(spec?.write?.pieces).toEqual([0, 1, 2]);
		expect(spec?.write?.lagRatio).toBe(writeLagRatio(3));
		// Specs are in scene units: the formula's own size, unscaled.
		expect(spec?.write?.outlineWidth).toBeCloseTo(2 * OUTLINE_RATIO);
		progress.set(1);
		expect(shapes()[0]?.progress).toBe(1);
	});

	it("is fill alone in the theme foreground by default", async () => {
		scene.add(mathTex.create({ tex: "a" }));
		scene.commit();
		await land("a");
		const style = shapes()[0]?.style;
		expect(style?.fill).toBe(theme.palette.foreground);
		expect(style?.strokeWidth).toBe(0);
	});

	it("re-places on a new fontSize without typesetting again", async () => {
		const formula = scene.add(mathTex.create({ tex: "ab" }));
		scene.commit();
		await land("ab");
		const typeset = vi.fn();
		formula.update({ fontSize: 2, onTypeset: typeset });
		scene.commit();
		expect(pendingRequests).toHaveLength(0);
		expect(formula.placed()?.width).toBe(4);
		expect(typeset).toHaveBeenCalledTimes(1);
	});

	it("partFill colours parts, one shape each, written as the whole would be", async () => {
		const progress = track(0.4);
		const formula = scene.add(
			mathTex.create({
				tex: "xyz",
				progress,
				fill: "white",
				partFill: { x: "gold", z: "tomato" },
			}),
		);
		scene.commit();
		await land("xyz");
		const specs = shapes();
		expect(specs.map((spec) => spec.style.fill)).toEqual([
			"gold",
			"white",
			"tomato",
		]);
		specs.forEach((spec, index) => {
			const phase = writePhase(0.4, index, 3);
			// A lone piece's write phase is its own progress.
			const own = writePhase(spec.progress, 0, 1);
			expect(own.border).toBeCloseTo(phase.border);
			expect(own.fill).toBeCloseTo(phase.fill);
		});

		// Back to one node once the colouring goes.
		formula.set("partFill", undefined);
		expect(shapes()).toHaveLength(1);
		expect(shapes()[0]?.progress).toBe(0.4);
	});

	it("partFill as a function sees each part", async () => {
		scene.add(
			mathTex.create({
				tex: "ab",
				partFill: (_part, index) => (index === 1 ? "red" : undefined),
			}),
		);
		scene.commit();
		await land("ab");
		expect(shapes().map((spec) => spec.style.fill)).toEqual([
			theme.palette.foreground,
			"red",
		]);
	});

	it("per-part shapes pivot about the formula's centre, as the whole does", async () => {
		const whole = scene.add(mathTex.create({ tex: "ab", rotation: 0.5, x: 1 }));
		scene.commit();
		await land("ab");
		const parted = scene.add(
			mathTex.create({ tex: "ab", rotation: 0.5, x: 1, partFill: {} }),
		);
		scene.commit();
		await land("ab");
		expect(parted.pending()).toBe(false);
		const [wholeBox, partedBox] = [whole.bounds(), parted.bounds()];
		expect(partedBox?.minX).toBeCloseTo(wholeBox?.minX ?? Number.NaN);
		expect(partedBox?.maxY).toBeCloseTo(wholeBox?.maxY ?? Number.NaN);
	});

	it("parts() and partBounds() locate glyphs in scene units", async () => {
		const formula = scene.add(mathTex.create({ tex: "ab", x: 3 }));
		expect(formula.parts()).toEqual([]);
		expect(formula.partBounds(0)).toBeNull();
		scene.commit();
		await land("ab");
		expect(formula.parts().map((part) => part.char)).toEqual(["a", "b"]);
		expect(formula.partBounds(0)).toEqual({
			minX: 2,
			minY: -0.5,
			maxX: 3,
			maxY: 0.5,
		});
		expect(formula.partBounds(1)?.maxX).toBe(4);
		expect(formula.partBounds(2)).toBeNull();
		expect(formula.bounds()).toEqual({
			minX: 2,
			minY: -0.5,
			maxX: 4,
			maxY: 0.5,
		});
	});

	it("with onError, contains a failure and reports it", async () => {
		const onError = vi.fn();
		scene.add(circle.create({ radius: 1 }));
		const formula = scene.add(mathTex.create({ tex: "\\bad", onError }));
		scene.commit();
		await fail("\\bad");
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0]?.[1]).toBe("\\bad");
		expect(() => scene.commit()).not.toThrow();
		expect(shapes()).toHaveLength(1);
		expect(formula.status.peek()).toBe("failed");
	});

	it("without onError, rethrows the failure from the next commit, once", async () => {
		const formula = scene.add(mathTex.create({ tex: "\\bad" }));
		scene.commit();
		await fail("\\bad");
		expect(() => scene.commit()).toThrow("boom");
		expect(() => scene.commit()).not.toThrow();
		expect(String(formula.error())).toContain("boom");
	});

	it("drops a formula on failure and recovers when a valid tex follows", async () => {
		const onError = vi.fn();
		const tex = track("ok");
		const formula = scene.add(mathTex.create({ tex, onError }));
		scene.commit();
		await land("ok");
		expect(shapes()).toHaveLength(1);
		tex.set("\\bad");
		scene.commit();
		await fail("\\bad");
		expect(onError).toHaveBeenCalledTimes(1);
		expect(shapes()).toHaveLength(0);

		tex.set("fine");
		scene.commit();
		await land("fine");
		expect(formula.pending()).toBe(false);
		expect(formula.placed()?.width).toBe(4);
		expect(shapes()).toHaveLength(1);
		expect(onError).toHaveBeenCalledTimes(1);
	});

	it("ready() called right after tex changes waits for the new formula", async () => {
		const formula = scene.add(mathTex.create({ tex: "ab" }));
		scene.commit();
		await land("ab");
		await formula.ready();

		formula.set("tex", "abc");
		// No commit in between: the stale formula must not satisfy it.
		let settled = false;
		void formula.ready().then(() => {
			settled = true;
		});
		await tick();
		expect(settled).toBe(false);
		scene.commit();
		await land("abc");
		expect(settled).toBe(true);
	});

	it("pending() does not throw after a failure, and ready() rejects", async () => {
		const formula = scene.add(
			mathTex.create({ tex: "\\bad", onError: () => {} }),
		);
		const outcome = formula.ready().then(
			() => "ok",
			(error: unknown) => String(error),
		);
		scene.commit();
		await fail("\\bad");
		expect(() => formula.pending()).not.toThrow();
		expect(formula.pending()).toBe(false);
		expect(await outcome).toContain("boom");
	});

	it("ready() waiters reject with an AbortError when the node is disposed", async () => {
		const formula = scene.add(mathTex.create({ tex: "ab" }));
		scene.commit();
		const outcome = formula.ready().then(
			() => "resolved",
			(error: DOMException) => error.name,
		);
		formula.dispose();
		expect(await outcome).toBe("AbortError");
		// A late answer lands nowhere.
		await land("ab");
		expect(shapes()).toHaveLength(0);
	});

	it("forwards pointer handlers to its outline", async () => {
		const onTap = vi.fn();
		const formula = scene.add(mathTex.create({ tex: "a", onTap }));
		scene.commit();
		await land("a");
		scene.commit();
		const outline = formula.children[0];
		expect(outline?.get("onTap" as never)).toBe(onTap);
		const next = vi.fn();
		formula.set("onTap", next);
		scene.commit();
		expect(formula.children[0]?.get("onTap" as never)).toBe(next);
	});

	it("emits the spec a plain single shape would", async () => {
		scene.add(mathTex.create({ tex: "ab", progress: 0.3 }));
		scene.commit();
		await land("ab");
		const spec = plainShapeSpec(shapes()[0] as ShapeSpec);
		expect(spec.closed).toBe(true);
		expect(spec.polylines).toHaveLength(2);
		expect(spec.write?.pieces).toEqual([0, 1]);
	});
});

describe("mathTransform", () => {
	it("reports a failed formula to onError once", async () => {
		const onError = vi.fn();
		scene.add(mathTransform.create({ from: "ab", to: "\\bad", onError }));
		scene.commit();
		await fail("\\bad");
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0]?.[1]).toBe("\\bad");
		expect(() => scene.commit()).not.toThrow();
	});

	it("draws nothing until both formulas are typeset, and holds when one changes", async () => {
		const to = track("cd");
		const morph = scene.add(mathTransform.create({ from: "ab", to, blend: 1 }));
		scene.commit();
		expect(morph.pending()).toBe(true);
		await land("ab");
		expect(morph.pending()).toBe(true); // `to` still outstanding
		expect(shapes()).toHaveLength(0);
		await land("cd");
		expect(morph.pending()).toBe(false);
		const held = shapes();
		expect(held.length).toBeGreaterThan(0);

		to.set("efg");
		scene.commit();
		expect(morph.pending()).toBe(true);
		expect(shapes()).toEqual(held);
		await land("efg");
		expect(morph.pending()).toBe(false);
		expect(
			morph.morphedParts().filter((part) => part.opacity > 0),
		).toHaveLength(3);
	});

	it("blend samples the morph, keeping one path per part across the run", async () => {
		const blend = track(0);
		const morph = scene.add(
			mathTransform.create({ from: "ab", to: "ba", blend }),
		);
		scene.commit();
		await land("ab");
		await land("ba");
		await morph.ready();
		scene.commit();
		const wrapper = morph.children[0];
		const paths = [...(wrapper as ContainerNode).children];
		expect(paths).toHaveLength(2);
		const startBox = morph.bounds();
		blend.set(0.5);
		scene.commit();
		expect([...(wrapper as ContainerNode).children]).toEqual(paths);
		blend.set(1);
		scene.commit();
		// The two glyphs swapped places: the formula's box is the same.
		expect(morph.bounds()).toEqual(startBox);
		const parts = morph.morphedParts();
		expect(parts.every((part) => part.role === "moved")).toBe(true);
	});

	it("multiplies opacity into each part's fade and colours parts by role", async () => {
		const morph = scene.add(
			mathTransform.create({
				from: "a",
				to: "b",
				blend: 0,
				opacity: 0.5,
				partFill: (part) => (part.role === "in" ? "lime" : undefined),
			}),
		);
		scene.commit();
		await land("a");
		await land("b");
		scene.commit();
		const parts = morph.morphedParts();
		const specs = shapes();
		expect(specs.length).toBe(parts.length);
		expect(parts.map((part) => part.role).sort()).toEqual(["in", "out"]);
		const incoming = parts.findIndex((part) => part.role === "in");
		expect(specs[incoming]?.style.fill).toBe("lime");
		for (const spec of specs)
			expect(spec.style.opacity).toBeLessThanOrEqual(0.5);
	});
});
