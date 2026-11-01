import { describe, expect, it } from "vitest";

/**
 * The dependency direction `docs/src/content/docs/project/architecture.mdx`
 * ("Layering inside `packages/core/src`") describes, checked over every source
 * file: a module imports only its own directory and the directories its layer
 * may reach. And the core stays framework-free: no file, tests included,
 * imports Solid.
 *
 * Source-level, not a runtime cycle detector: `?raw` hands back each file's
 * text without executing it (see `./raw.d.ts`), so this needs no `fs` and
 * catches an upward import whether or not it would happen to resolve.
 */
const sources = import.meta.glob<string>(
	["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../**/*.d.ts"],
	{ query: "?raw", import: "default", eager: true },
);

/** Every file, tests included, for the framework check. */
const everySource = import.meta.glob<string>(["../**/*.{ts,tsx}"], {
	query: "?raw",
	import: "default",
	eager: true,
});

/**
 * What each directory may import directly, besides itself. A directory may
 * also import whatever those reach (the closure below), so "and below" holds
 * without repeating every leaf. Directories that do not exist yet are listed
 * all the same: the rules apply as soon as they appear.
 */
const DEPENDS_ON: Record<string, readonly string[]> = {
	// Dependency-free leaves (d3-color / d3-interpolate, wgpu-matrix).
	color: [],
	geometry3d: [],
	geometry: ["geometry3d"],
	// `track`, `derive`: nothing below them.
	reactive: [],
	// The colour mode is a Track.
	themes: ["geometry", "color", "reactive"],
	tween: ["reactive", "geometry", "color"],
	anim: ["tween", "reactive", "geometry", "themes"],
	// DrawSpec types, bake, gradient, clip, layout math.
	spec: ["geometry", "color", "themes"],
	// Pure: hit, pick-items, constrain, drop, item-order.
	// `tween` for `Animatable`, the sink a drag writes to.
	interact: ["spec", "geometry", "reactive", "tween"],
	// Renderer, pointer driver, a11y, cameras.
	render: ["spec", "interact", "geometry", "themes", "tween"],
	scene: [
		"color",
		"geometry3d",
		"geometry",
		"reactive",
		"themes",
		"tween",
		"anim",
		"spec",
		"interact",
		"render",
	],
	shapes: ["scene"],
	// Peer edges, one way: labels may use shapes; coordinate systems and
	// networks are drawn with both.
	labels: ["scene", "shapes"],
	coords: ["scene", "shapes", "labels"],
	network: ["scene", "shapes", "labels"],
	export: ["anim", "tween", "render"],
};

/** Directories (and the root files, `"(root)"`) that may import anything. */
const UNRESTRICTED = new Set(["entries", "(root)"]);

/**
 * Known breaches, allowed until they are fixed. Each is `[from, to]` path
 * prefixes.
 */
const EXCEPTIONS: [string, string][] = [];

/** {@link DEPENDS_ON} closed transitively: everything each directory may reach. */
const REACHES: Record<string, Set<string>> = Object.fromEntries(
	Object.keys(DEPENDS_ON).map((directory) => {
		const reached = new Set<string>();
		const pending = [...DEPENDS_ON[directory]];
		while (pending.length > 0) {
			const next = pending.pop() as string;
			if (reached.has(next)) continue;
			reached.add(next);
			pending.push(...(DEPENDS_ON[next] ?? []));
		}
		return [directory, reached];
	}),
);

/**
 * The top-level directory of a src-relative path, or `"(root)"` for a file at
 * the top. An import of a directory's barrel (`"../reactive/index.js"`) resolves
 * into that directory, which counts as its layer.
 */
function layerOf(path: string): string {
	const parts = path.split("/");
	if (parts.length > 1) return parts[0];
	return parts[0] in DEPENDS_ON || parts[0] === "entries" ? parts[0] : "(root)";
}

/** `from` (a src-relative file) importing `specifier`, as a src-relative path. */
function resolve(from: string, specifier: string): string {
	const out = from.split("/").slice(0, -1);
	for (const part of specifier.split("/")) {
		if (part === "..") out.pop();
		else if (part !== ".") out.push(part);
	}
	return out.join("/");
}

const IMPORT =
	/(?:^|[\s;])(?:import|export)\s(?:[^;"'`]*?\sfrom\s)?["'](\.[^"']*)["']|import\(\s*["'](\.[^"']*)["']\s*\)/g;

/**
 * An import of a UI framework package: `solid-js` (and its subpaths) or any
 * `@solidjs/*`. Matches comments too, so a JSDoc example cannot teach Solid.
 */
const FRAMEWORK_IMPORT =
	/(?:^|[\s;*])(?:import|export)\s(?:[^;"'`]*?\sfrom\s)?["']((?:solid-js|@solidjs\/)[^"']*)["']|import\(\s*["']((?:solid-js|@solidjs\/)[^"']*)["']\s*\)/g;

/** Glob keys are relative to this file; key them by src-relative path. */
function bySourcePath(glob: Record<string, string>): Map<string, string> {
	return new Map(
		Object.entries(glob).map(([key, source]) => [
			resolve("geometry/layering.test.ts", key),
			source,
		]),
	);
}

const files = bySourcePath(sources);
const allFiles = bySourcePath(everySource);

/** Whether a file in `own` may import a module in `theirs`. */
function mayImport(own: string, theirs: string): boolean {
	if (own === theirs || UNRESTRICTED.has(own)) return true;
	return REACHES[own]?.has(theirs) ?? false;
}

/** Every cross-directory import that the table does not allow. */
function breaches(): string[] {
	const found: string[] = [];
	for (const [file, source] of files) {
		const own = layerOf(file);
		for (const match of source.matchAll(IMPORT)) {
			const target = resolve(file, match[1] ?? match[2]);
			const theirs = layerOf(target);
			if (mayImport(own, theirs)) continue;
			if (
				EXCEPTIONS.some(([a, b]) => file.startsWith(a) && target.startsWith(b))
			)
				continue;
			found.push(`${file} (${own}) -> ${target} (${theirs})`);
		}
	}
	return found.sort();
}

/** Every framework import in the tree, tests included. */
function frameworkImports(): string[] {
	const found: string[] = [];
	for (const [file, source] of allFiles) {
		for (const match of source.matchAll(FRAMEWORK_IMPORT))
			found.push(`${file} -> ${match[1] ?? match[2]}`);
	}
	return found.sort();
}

describe("layering", () => {
	it("reads the whole source tree", () => {
		expect(files.has("geometry/path/cubic.ts")).toBe(true);
		expect(files.has("themes/mode.ts")).toBe(true);
		expect([...files.keys()].some((file) => file.endsWith(".test.ts"))).toBe(
			false,
		);
		expect(allFiles.has("themes/mode.test.ts")).toBe(true);
	});

	it("parses imports, so a clean run means something", () => {
		const targets = [
			...(files.get("themes/mode.ts") ?? "").matchAll(IMPORT),
		].map((match) => match[1] ?? match[2]);
		expect(targets).toContain("../reactive/index.js");
		expect(targets).toContain("./palette.js");
	});

	it("knows every directory in the tree", () => {
		const unknown = [...new Set([...allFiles.keys()].map(layerOf))].filter(
			(directory) => !(directory in DEPENDS_ON) && !UNRESTRICTED.has(directory),
		);
		expect(unknown).toEqual([]);
	});

	it("would catch an upward import", () => {
		expect(layerOf("geometry/morph.ts")).toBe("geometry");
		expect(layerOf("geometry/path/cubic.ts")).toBe("geometry");
		expect(layerOf("index.ts")).toBe("(root)");
		expect(layerOf("reactive")).toBe("reactive");
		expect(resolve("geometry/morph.ts", "../tween/interpolators")).toBe(
			"tween/interpolators",
		);
		expect(mayImport("geometry", "tween")).toBe(false);
		expect(mayImport("themes", "anim")).toBe(false);
		expect(mayImport("spec", "interact")).toBe(false);
		expect(mayImport("shapes", "labels")).toBe(false);
		// Allowed: direct, transitive, unrestricted.
		expect(mayImport("geometry", "geometry3d")).toBe(true);
		expect(mayImport("anim", "color")).toBe(true);
		expect(mayImport("shapes", "geometry")).toBe(true);
		expect(mayImport("entries", "scene")).toBe(true);
		expect(mayImport("(root)", "export")).toBe(true);
	});

	it("no file imports a directory its layer may not reach", () => {
		expect(breaches()).toEqual([]);
	});

	it("the canonical lerp lives in geometry/, not tween/", () => {
		const path = files.get("geometry/path/cubic.ts");
		expect(path).toMatch(
			/import\s*\{\s*lerpPoint\s*\}\s*from\s*["']\.\.\/lerp\.js["']/,
		);
		expect(path).not.toMatch(/function lerpPoint\(/);
		expect(files.get("geometry/transform.ts")).toMatch(
			/import\s*\{\s*lerp\s*\}\s*from\s*["']\.\/lerp\.js["']/,
		);
	});
});

describe("framework-free", () => {
	it("would catch a Solid import", () => {
		// Built from pieces so this file does not match itself.
		const solid = ["solid", "js"].join("-");
		const samples = [
			`import { createSignal } from "${solid}";`,
			`import { render } from "${solid}/web";`,
			`import { describe } from "vitest";\nimport { Show } from "@${solid.replace("-", "")}/router";`,
			` * import { For } from '${solid}';`,
			`const lazy = import("${solid}/store");`,
			`export { untrack } from "${solid}";`,
		];
		for (const sample of samples)
			expect([...sample.matchAll(FRAMEWORK_IMPORT)]).toHaveLength(1);
		expect([
			...`import { solid } from "./solid-js-like";`.matchAll(FRAMEWORK_IMPORT),
		]).toHaveLength(0);
	});

	it("no file imports solid-js or @solidjs/*", () => {
		expect(frameworkImports()).toEqual([]);
	});
});
