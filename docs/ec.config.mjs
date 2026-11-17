import { defineEcConfig } from "@astrojs/starlight/expressive-code";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginCollapseImports } from "./src/lib/collapse-imports.mjs";

// Lives here rather than in astro.config.mjs because plugins are functions,
// which the `<Code>` component (used by Example.astro) can only load from this
// file.
export default defineEcConfig({
	// Order matters: the first marks a block's imports, the second folds them.
	plugins: [pluginCollapseImports(), pluginCollapsibleSections()],
});
