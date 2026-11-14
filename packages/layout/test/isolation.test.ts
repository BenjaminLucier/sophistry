/// <reference types="vite/client" />
/**
 * The engine stands alone: its sources import only each other, and the
 * package has no runtime dependencies. That keeps it usable outside
 * sophistry without changes.
 */

import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };

const sources = import.meta.glob<string>(
	["../src/**/*.ts", "!../src/**/*.test.ts"],
	{
		query: "?raw",
		import: "default",
		eager: true,
	},
);

describe("isolation", () => {
	it("imports nothing outside its own sources", () => {
		const outside: string[] = [];
		for (const [file, text] of Object.entries(sources)) {
			for (const match of text.matchAll(
				/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g,
			)) {
				const specifier = match[1] ?? match[2] ?? "";
				if (!specifier.startsWith("./")) outside.push(`${file}: ${specifier}`);
			}
		}
		expect(outside).toEqual([]);
	});

	it("has no runtime dependencies", () => {
		const fields = manifest as Record<string, unknown>;
		expect(fields.dependencies ?? {}).toEqual({});
		expect(fields.peerDependencies ?? {}).toEqual({});
	});
});
