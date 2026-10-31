/**
 * `createResolver`: the one implementation behind `resolveEasing`,
 * `resolveConstraint`, `resolveGraphLayout`, `resolveScale`,
 * `resolveInterpolator`, `resolveCorrespondence` and `resolveColormap`.
 *
 * Every such prop is `Name | Function`; a string looks up a closed, frozen map of
 * built-ins and anything else passes through, so custom functions are never
 * second-class and nothing is registered at module level. An unknown name throws,
 * listing the valid ones.
 */

/**
 * A resolver over a frozen map of built-in `T`s, keyed by name.
 *
 * @category Interaction plumbing
 */
export interface Resolver<T> {
	/** What `resolve`'s thrown errors call this map. */
	readonly name: string;
	/**
	 * The frozen name → value map of built-ins, exposed so callers can
	 * enumerate valid names (`Object.keys(resolver.registry)`) rather than
	 * only resolve them. Frozen: assigning to it throws in strict mode.
	 */
	readonly registry: Readonly<Record<string, T>>;
	/**
	 * A string resolves through the built-ins; anything else (a function, or
	 * any other already-a-`T` value such as a caller-built `Scale`) passes
	 * through unchanged. Throws for a string that is not a built-in, naming
	 * the valid ones.
	 */
	resolve(spec: T | string): T;
}

/**
 * Builds a `Resolver<T>` over a frozen copy of `entries`. `registryName` is
 * cosmetic — it only appears in the error message a bad name throws — but
 * worth getting right: `createResolver("easing", easings)` produces `Unknown
 * easing "bounceInAndOut". Valid names: …`, which is the whole reason this
 * exists rather than a bare `registry[name]`. With `caseInsensitive`, `"Viridis"`
 * finds `viridis`; the error still lists the canonical names.
 *
 * @category Interaction plumbing
 */
export function createResolver<T>(
	registryName: string,
	entries: Readonly<Record<string, T>>,
	options: { readonly caseInsensitive?: boolean } = {},
): Resolver<T> {
	const registry: Readonly<Record<string, T>> = Object.freeze({ ...entries });
	// Lower-cased name -> canonical name, when lookups ignore case.
	const canonical = options.caseInsensitive
		? new Map(Object.keys(registry).map((name) => [name.toLowerCase(), name]))
		: null;

	function resolve(spec: T | string): T {
		if (typeof spec !== "string") return spec;
		// Own-property lookup: "constructor"/"toString"/"__proto__" must be
		// unknown names, not Object.prototype members.
		const name = canonical ? (canonical.get(spec.toLowerCase()) ?? spec) : spec;
		if (Object.hasOwn(registry, name)) {
			const found = registry[name];
			if (found !== undefined) return found;
		}
		const names = Object.keys(registry).sort().join(", ") || "(none)";
		throw new Error(
			`Unknown ${registryName} "${spec}". Built-in names: ${names}. Pass a custom ${registryName} as a value instead of a name.`,
		);
	}

	return { name: registryName, registry, resolve };
}
