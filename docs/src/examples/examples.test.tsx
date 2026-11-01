import { render } from "@solidjs/web";
import { beforeAll, describe, expect, it } from "vitest";
import { CATEGORIES, examplesIn, SUBGALLERIES } from "../lib/examples";

interface ExampleModule {
	/** A Solid component (`.tsx`), or a framework-free `mount(host)` (`.ts`). */
	default: (host?: HTMLElement) => unknown;
	meta?: { title: string; description: string };
}

const modules = import.meta.glob<ExampleModule>("./*/*.{ts,tsx}", {
	eager: true,
});
const categories: string[] = CATEGORIES.map((c) => c.dir);

/** happy-dom's canvas has no 2D context; hand out a recording-free no-op one. */
function stubContext(canvas: HTMLCanvasElement): unknown {
	const noop = (): unknown => new Proxy(() => undefined, handler);
	const handler: ProxyHandler<object> = {
		get: (_t, key) => {
			if (key === "canvas") return canvas;
			// Text layout reads widths and ascents back from the context.
			if (key === "measureText")
				return () => ({
					width: 10,
					actualBoundingBoxAscent: 8,
					actualBoundingBoxDescent: 2,
					fontBoundingBoxAscent: 8,
					fontBoundingBoxDescent: 2,
				});
			return noop();
		},
		set: () => true,
	};
	return new Proxy({}, handler);
}

describe("gallery examples", () => {
	beforeAll(() => {
		HTMLCanvasElement.prototype.getContext = function (
			this: HTMLCanvasElement,
		) {
			return stubContext(this);
		} as never;
	});

	it("finds the seeded examples", () => {
		expect(Object.keys(modules).length).toBeGreaterThanOrEqual(6);
	});

	for (const [path, mod] of Object.entries(modules)) {
		const name = path.replace(/^\.\//, "").replace(/\.tsx?$/, "");
		const vanilla = path.endsWith(".ts");
		describe(name, () => {
			it("lives in a known category and is PascalCase", () => {
				const [category, id, ...rest] = name.split("/");
				expect(rest).toEqual([]);
				expect(categories).toContain(category);
				expect(id).toMatch(/^[A-Z][A-Za-z0-9]*$/);
			});

			it("has well-formed meta", () => {
				const { meta } = mod;
				expect(meta, "missing `export const meta`").toBeDefined();
				expect(meta?.title.trim()).toBeTruthy();
				expect(meta?.description.trim()).toBeTruthy();
			});

			it("mounts without throwing", () => {
				expect(typeof mod.default).toBe("function");
				const host = document.createElement("div");
				document.body.append(host);
				// Dispose synchronously so the examples' animations never get a frame.
				const dispose = vanilla
					? (mod.default(host) as () => void)
					: render(() => mod.default() as never, host);
				expect(host.querySelector("canvas")).not.toBeNull();
				dispose();
				host.remove();
			});
		});
	}
});

describe("gallery pages", () => {
	it("put every example of a split category on exactly one sub-page", () => {
		for (const [category, pages] of Object.entries(SUBGALLERIES)) {
			expect(categories).toContain(category);
			const onPages = pages.flatMap((p) => p.ids);
			expect(new Set(onPages).size, `${category}: an id is listed twice`).toBe(
				onPages.length,
			);
			const files = Object.keys(modules)
				.filter((path) => path.startsWith(`./${category}/`))
				.map((path) => path.replace(/^.*\//, "").replace(/\.tsx?$/, ""))
				.sort();
			expect([...onPages].sort()).toEqual(files);
			// Throws on any mismatch between the map and the files.
			expect(examplesIn(category)).toHaveLength(files.length);
		}
	});
});
