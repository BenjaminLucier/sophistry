// Solid's dev build checks for misuse (onCleanup inside onSettled, untracked
// reads, ...) and reports it through the console. Production builds strip those
// checks, so the e2e suite cannot see them. This mounts the docs islands in dev
// mode and fails on any diagnostic, wherever it originates.
import { render } from "@solidjs/web";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

// happy-dom has no layout and its documents are in quirks mode, so KaTeX cannot
// typeset there: `latexOutline` rejects, which `MathTex` now (correctly) sends
// to `<Errored>`. Hand back a tiny fixed outline instead, so the maths examples
// mount, resolve and animate their async formulas in dev mode like they do in a
// browser.
vi.mock("../../../packages/text/src/outline", async (original) => ({
	...(await original<typeof import("../../../packages/text/src/outline")>()),
	latexOutline: async (tex: string) => ({
		parts: [
			{
				kind: "glyph",
				char: tex[0] ?? "x",
				polylines: [
					[
						{ x: 0, y: 0 },
						{ x: 1, y: 0 },
						{ x: 1, y: 1 },
					],
				],
				box: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
			},
		],
		width: 2,
		height: 1,
	}),
}));

import { attribution } from "solid-js/attribution";
import { ExampleIsland } from "./ExampleIsland";
import { Thumb } from "./home/Thumb";

/**
 * Solid's attribution engine with its defaults minus the two checks gated on
 * wall-clock time (HOT_SCOPE_TIME, WASTED_RECOMPUTE), which fail on a busy
 * machine. A bare `attribution.enable()` would switch them back on.
 */
const enableDevDiagnostics = () =>
	attribution.enable({ hotTime: false, wastedRecompute: false });

const paths = Object.keys(
	import.meta.glob("../examples/*/*.{ts,tsx}", { eager: false }),
);
const names = paths.map((p) =>
	p.replace("../examples/", "").replace(/\.tsx?$/, ""),
);
/** Thumbs show Solid examples only (the home page's strip). */
const solidNames = new Set(
	paths
		.filter((p) => p.endsWith(".tsx"))
		.map((p) => p.replace("../examples/", "").replace(".tsx", "")),
);

beforeAll(() => {
	// Attribution-backed diagnostics (EFFECT_RELAY_TEAR, ...) only run once the
	// engine is enabled, as a dev server does.
	enableDevDiagnostics();
	// Its why-run chatter goes to console.log; silence it.
	vi.spyOn(console, "log").mockImplementation(() => {});
	// happy-dom runs animation frames back to back (setImmediate), hundreds a
	// second; a browser gives ~60. Solid's hot-scope heuristics count re-runs per
	// second, so pace frames like a display would.
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
		setTimeout(() => cb(performance.now()), 16),
	);
	vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
	// A canvas context where every property is a function returning itself.
	const noop: unknown = new Proxy(() => undefined, {
		get: (_t, key) => (key === "measureText" ? () => ({ width: 10 }) : noop),
		set: () => true,
		apply: () => noop,
	});
	HTMLCanvasElement.prototype.getContext = (() => noop) as never;
});
afterEach(() => vi.restoreAllMocks());

const settle = () => new Promise((r) => setTimeout(r, 50));

it("ExampleIsland and Thumb mount every example with no Solid diagnostics", async () => {
	const messages: string[] = [];
	for (const level of ["warn", "error"] as const)
		vi.spyOn(console, level).mockImplementation((...a) => {
			messages.push(`${level}: ${a.map(String).join(" ")}`);
		});
	expect(names.length).toBeGreaterThan(20);
	for (const [i, name] of names.entries()) {
		const host = document.createElement("div");
		document.body.append(host);
		const dispose = render(
			() =>
				i % 4 === 0 && solidNames.has(name) ? (
					<Thumb name={name} />
				) : (
					<ExampleIsland name={name} />
				),
			host,
		);
		await settle();
		dispose();
		host.remove();
	}
	// Any Solid dev diagnostic (STRICT_READ_UNTRACKED, NO_OWNER_CLEANUP,
	// EFFECT_RELAY_TEAR, CLEANUP_IN_FORBIDDEN_SCOPE, ...) from any source fails,
	// except KaTeX's one-off quirks-mode warning when it is first loaded.
	expect(messages.filter((m) => !/quirks mode/.test(m))).toEqual([]);
}, 120_000);
