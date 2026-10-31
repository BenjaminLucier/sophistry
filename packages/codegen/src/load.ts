/**
 * Loads a package's `definitions` export under plain Node.
 *
 * The workspace packages ship TypeScript source written for bundler
 * resolution (`import { x } from "./scene"`). Node strips the types itself;
 * these hooks add the two resolutions it lacks (a missing `.ts` extension, a
 * directory's `index.ts`) and stub asset imports (`?url`, `?raw`, fonts,
 * styles), which only a bundler understands and no definition needs.
 */

import { registerHooks } from "node:module";

const ASSET =
	/\?(url|raw|inline|worker)(&[\w-]+)*$|\.(css|woff2?|ttf|otf|png|svg)$/;

let registered = false;

/** Registers the resolve and load hooks once per process. */
export function registerSourceHooks(): void {
	if (registered) return;
	registered = true;
	registerHooks({
		resolve(specifier, context, nextResolve) {
			if (ASSET.test(specifier)) {
				return {
					url: `data:text/javascript,export default ${JSON.stringify(specifier)};`,
					shortCircuit: true,
				};
			}
			try {
				return nextResolve(specifier, context);
			} catch (error) {
				if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
					throw error;
				}
				for (const suffix of [".ts", ".tsx", "/index.ts"]) {
					try {
						return nextResolve(specifier + suffix, context);
					} catch {}
				}
				throw error;
			}
		},
	});
}

/** A definition as codegen reads it. */
export interface LoadedDefinition {
	readonly name: string;
	readonly kind: string;
}

/**
 * Imports `<packageName>/definitions` and returns its `definitions` record,
 * or null when the package or the subpath does not exist (yet).
 *
 * @throws When the module exists but fails to load or has no `definitions`.
 */
export async function loadDefinitions(
	packageName: string,
): Promise<Record<string, LoadedDefinition> | null> {
	registerSourceHooks();
	let module: { definitions?: unknown };
	try {
		module = await import(`${packageName}/definitions`);
	} catch (error) {
		const code = (error as { code?: string }).code;
		const message = String((error as Error).message);
		// Node's codes, or Vite's message when loaded under Vitest.
		if (
			code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
			(code === "ERR_MODULE_NOT_FOUND" && message.includes(packageName)) ||
			/"\.\/(?:[\w-]+\/)*definitions" is not exported/.test(message)
		) {
			return null;
		}
		throw error;
	}
	const definitions = module.definitions;
	if (typeof definitions !== "object" || definitions === null) {
		throw new Error(
			`${packageName}/definitions has no \`definitions\` export.`,
		);
	}
	return definitions as Record<string, LoadedDefinition>;
}
