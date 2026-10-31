/**
 * `pnpm --filter @sophistry/codegen generate` writes the bindings'
 * generated component files; `... check` (`--check`) writes nothing and exits
 * 1 when any is stale, for CI.
 */

import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type DefinitionsByPackage,
	planFiles,
	staleFiles,
	writeFiles,
} from "./generate.ts";
import { loadDefinitions } from "./load.ts";
import { sourcePackages } from "./targets.ts";

const packagesDirectory = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const check = process.argv.includes("--check");

const definitions = new Map<
	string,
	Awaited<ReturnType<typeof loadDefinitions>>
>();
for (const source of sourcePackages) {
	definitions.set(source.name, await loadDefinitions(source.name));
}

const files = planFiles({
	packagesDirectory,
	definitions: definitions as DefinitionsByPackage,
});
const show = (path: string) => relative(packagesDirectory, path);

for (const [name, found] of definitions) {
	const count = found ? Object.keys(found).length : 0;
	console.log(
		`${name}: ${found ? `${count} definitions` : "no definitions export yet"}`,
	);
}

if (check) {
	const stale = await staleFiles(files);
	if (stale.length > 0) {
		console.error(
			`Stale generated files (run \`pnpm --filter @sophistry/codegen generate\`):\n  ${stale.map((file) => show(file.path)).join("\n  ")}`,
		);
		process.exit(1);
	}
	console.log(`${files.length} generated files are up to date.`);
} else {
	const changed = await writeFiles(files);
	console.log(
		changed.length > 0
			? `Wrote:\n  ${changed.map((file) => show(file.path)).join("\n  ")}`
			: `${files.length} generated files are up to date.`,
	);
}
