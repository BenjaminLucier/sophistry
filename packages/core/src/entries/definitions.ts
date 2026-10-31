/**
 * `@sophistry/core/definitions`: every definition the package's main
 * entry exports, keyed by export name. What `@sophistry/codegen` reads to
 * generate the framework bindings' components (`export const Circle =
 * wrap(circle);`).
 *
 * Nothing is listed by hand: the record is collected from the main entry's
 * exports, so a definition is picked up as soon as it is exported from
 * `@sophistry/core`, and its type is the exact definition type. Feature
 * packages (`text`, `charts`, `3d`) expose the same `./definitions` subpath
 * (copy this file).
 *
 * Kept off the main entry on purpose: reading the whole module namespace
 * would defeat tree shaking, and the main entry importing this file would be
 * an import cycle.
 *
 * @example
 * ```ts
 * import { definitions } from "@sophistry/core/definitions";
 *
 * for (const [exportName, definition] of Object.entries(definitions)) {
 * 	console.log(exportName, definition.name, definition.kind);
 * }
 * ```
 *
 * @module @sophistry/core/definitions
 */

import * as entry from "../index";
import type { Definition } from "../scene/types";

/**
 * Whether `value` is a definition made by `definePrimitive`, `defineShape`,
 * `defineComposite` and friends.
 *
 * @param value - Anything.
 * @returns Whether it is a definition.
 * @category Scene graph
 */
export function isDefinition(value: unknown): value is Definition {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<Definition>;
	return (
		(candidate.kind === "primitive" || candidate.kind === "composite") &&
		typeof candidate.name === "string" &&
		typeof candidate.descriptor === "object" &&
		candidate.descriptor !== null &&
		typeof candidate.create === "function"
	);
}

/**
 * The exports of module `M` that are definitions, by export name.
 *
 * @typeParam M - A module namespace type (`typeof import("...")`).
 * @category Scene graph
 */
export type DefinitionExports<M> = {
	readonly [K in keyof M as M[K] extends DefinitionShape ? K : never]: M[K];
};

/** What every `Definition<P, N>` is assignable to, whatever `P` and `N`. */
interface DefinitionShape {
	readonly kind: "primitive" | "composite";
	readonly name: string;
	readonly descriptor: object;
	readonly container: boolean;
	create(...args: never[]): unknown;
}

/**
 * Collects the definitions among a module namespace's exports, by export
 * name, sorted by name so the output is stable.
 *
 * @param namespace - `import * as entry from "..."`.
 * @returns A frozen record of the definitions.
 * @category Scene graph
 */
export function collectDefinitions<M extends object>(
	namespace: M,
): DefinitionExports<M> {
	const found = Object.entries(namespace)
		.filter(([, value]) => isDefinition(value))
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return Object.freeze(Object.fromEntries(found)) as DefinitionExports<M>;
}

/**
 * Every definition `@sophistry/core` exports, by export name
 * (`{ circle, ellipse, group, label, rect, square, ... }`).
 *
 * @category Scene graph
 */
export const definitions = collectDefinitions(entry);
