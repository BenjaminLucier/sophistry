/**
 * `@sophistry/3d/definitions`: every definition the package's main entry
 * exports, keyed by export name. What `@sophistry/codegen` reads to
 * generate the framework bindings' `/3d` components (`export const Cube3D =
 * wrap(cube3D);`).
 *
 * Nothing is listed by hand: the record is collected from the main entry's
 * exports (a copy of `@sophistry/core/definitions`' collector, since
 * feature packages only import core's public and `/internal` entries). Kept
 * off the main entry so reading the whole module namespace does not defeat
 * tree shaking.
 *
 * @module @sophistry/3d/definitions
 */

import type { Definition } from "@sophistry/core";
import * as entry from "../index.js";

/** Whether `value` is a definition made by `definePrimitive`, `defineShape3D` and friends. */
function isDefinition(value: unknown): value is Definition {
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

/** What every `Definition<P, N>` is assignable to, whatever `P` and `N`. */
interface DefinitionShape {
	readonly kind: "primitive" | "composite";
	readonly name: string;
	readonly descriptor: object;
	readonly container: boolean;
	create(...args: never[]): unknown;
}

/** The exports of module `M` that are definitions, by export name. */
type DefinitionExports<M> = {
	readonly [K in keyof M as M[K] extends DefinitionShape ? K : never]: M[K];
};

function collectDefinitions<M extends object>(
	namespace: M,
): DefinitionExports<M> {
	const found = Object.entries(namespace)
		.filter(([, value]) => isDefinition(value))
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return Object.freeze(Object.fromEntries(found)) as DefinitionExports<M>;
}

/**
 * Every definition `@sophistry/3d` exports, by export name
 * (`{ axes3D, camera3D, cube3D, ... }`).
 *
 * @category Scene graph
 */
export const definitions = collectDefinitions(entry);
