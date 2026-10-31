/**
 * Plans, writes and checks the generated files.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type EntryItem, renderEntry } from "./render.ts";
import {
	type Binding,
	bindings as defaultBindings,
	renames as defaultRenames,
	sourcePackages as defaultSources,
	GENERATED_DIRECTORY,
	type SourcePackage,
	WRAP_MODULE,
} from "./targets.ts";

/** One file codegen owns: where it goes and what it must contain. */
export interface GeneratedFile {
	/** Absolute path. */
	path: string;
	content: string;
}

/** Definitions of one source package, by export name (null: none yet). */
export type DefinitionsByPackage = ReadonlyMap<
	string,
	Readonly<Record<string, { readonly name: string }>> | null
>;

/** Input of {@link planFiles}. */
export interface PlanOptions {
	/** The repository's `packages/` folder. */
	packagesDirectory: string;
	definitions: DefinitionsByPackage;
	sources?: readonly SourcePackage[];
	bindings?: readonly Binding[];
	renames?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Every generated file's path and content. Pure. */
export function planFiles(options: PlanOptions): GeneratedFile[] {
	const sources = options.sources ?? defaultSources;
	const bindings = options.bindings ?? defaultBindings;
	const renames = options.renames ?? defaultRenames;
	const files: GeneratedFile[] = [];
	for (const source of sources) {
		const definitions = options.definitions.get(source.name) ?? null;
		const items: EntryItem[] = Object.entries(definitions ?? {}).map(
			([exportName, definition]) => ({
				exportName,
				componentName: renames[source.name]?.[exportName] ?? definition.name,
			}),
		);
		for (const binding of bindings) {
			files.push({
				path: join(
					options.packagesDirectory,
					binding.folder,
					GENERATED_DIRECTORY,
					`${source.file}.gen.ts`,
				),
				content: renderEntry({
					packageName: source.name,
					items,
					// Only the root entry (`core`) sits beside the hand-written exports.
					reserved: source.file === "core" ? binding.reserved : [],
					wrapModule: WRAP_MODULE,
				}),
			});
		}
	}
	return files;
}

async function readOrNull(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

/** The files whose content on disk differs from the plan (or that are missing). */
export async function staleFiles(
	files: readonly GeneratedFile[],
): Promise<GeneratedFile[]> {
	const stale: GeneratedFile[] = [];
	for (const file of files) {
		if ((await readOrNull(file.path)) !== file.content) stale.push(file);
	}
	return stale;
}

/** Writes the files that changed; returns them. */
export async function writeFiles(
	files: readonly GeneratedFile[],
): Promise<GeneratedFile[]> {
	const changed = await staleFiles(files);
	for (const file of changed) {
		await mkdir(dirname(file.path), { recursive: true });
		await writeFile(file.path, file.content);
	}
	return changed;
}
