/**
 * `@sophistry/codegen`: generates the framework bindings' component
 * files from the source packages' `definitions` exports. Run
 * `pnpm --filter @sophistry/codegen generate` (or `check` for CI).
 *
 * @module @sophistry/codegen
 */

export * from "./generate.ts";
export * from "./load.ts";
export * from "./render.ts";
export * from "./targets.ts";
