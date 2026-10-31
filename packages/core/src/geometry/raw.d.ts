/**
 * Vite's `?raw` suffix — a module's source text as a string, rather than its
 * executed exports. `layering.test.ts` leans on it for a source-level check
 * that stays a leaf: reading files this way needs no `fs`/`node:fs` (and so
 * no `@types/node` dependency this package otherwise has no use for), the
 * same reasoning `text/assets.d.ts` already applies to its own Vite suffix
 * imports (`?url`).
 */
declare module "*.ts?raw" {
	const source: string;
	export default source;
}

/** Vite's `import.meta.glob`, as far as `layering.test.ts` uses it. */
interface ImportMeta {
	glob<T = unknown>(
		pattern: string | string[],
		options?: { query?: string; import?: string; eager?: boolean },
	): Record<string, T>;
}
