import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planFiles, staleFiles, writeFiles } from "./generate.ts";
import type { Binding, SourcePackage } from "./targets.ts";

const sources: SourcePackage[] = [
	{ name: "@example/core", file: "core" },
	{ name: "@example/text", file: "text" },
];
const bindings: Binding[] = [
	{ name: "@example/solid", folder: "solid", reserved: ["Stage"] },
	{ name: "@example/react", folder: "react", reserved: ["Stage"] },
];
const definitions = new Map([
	["@example/core", { circle: { name: "Circle" }, disc: { name: "Circle" } }],
	["@example/text", null],
]);

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "codegen-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("planFiles", () => {
	it("plans one file per binding per source package, applying renames", () => {
		const files = planFiles({
			packagesDirectory: directory,
			definitions,
			sources,
			bindings,
			renames: { "@example/core": { disc: "Disc" } },
		});
		expect(files.map((file) => file.path.slice(directory.length))).toEqual([
			"/solid/src/generated/core.gen.ts",
			"/react/src/generated/core.gen.ts",
			"/solid/src/generated/text.gen.ts",
			"/react/src/generated/text.gen.ts",
		]);
		expect(files[0]?.content).toContain("export const Disc = wrap(disc);");
		expect(files[2]?.content).toContain("export {};");
	});

	it("fails on an unrenamed collision", () => {
		expect(() =>
			planFiles({
				packagesDirectory: directory,
				definitions,
				sources,
				bindings,
			}),
		).toThrow(/generated for both circle and disc/);
	});

	it("reserves the binding's own names in the root entry only", () => {
		const files = planFiles({
			packagesDirectory: directory,
			definitions: new Map<string, Record<string, { name: string }>>([
				["@example/core", {}],
				["@example/text", { stage: { name: "Stage" } }],
			]),
			sources,
			bindings,
		});
		expect(files[2]?.content).toContain("export const Stage = wrap(stage);");
	});
});

describe("staleness", () => {
	it("writes missing files, then reports nothing stale until one changes", async () => {
		const files = planFiles({
			packagesDirectory: directory,
			definitions,
			sources,
			bindings,
			renames: { "@example/core": { disc: "Disc" } },
		});
		expect(await staleFiles(files)).toHaveLength(4);
		expect(await writeFiles(files)).toHaveLength(4);
		expect(await staleFiles(files)).toEqual([]);
		expect(await writeFiles(files)).toEqual([]);

		const edited = files[1]?.path as string;
		await writeFile(edited, `${await readFile(edited, "utf8")}// hand edit\n`);
		expect((await staleFiles(files)).map((file) => file.path)).toEqual([
			edited,
		]);
	});
});
