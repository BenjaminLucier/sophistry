import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

// Mirrors packages/core/vitest.config.ts: Solid's browser build must be
// processed by Vite so the examples mount under happy-dom.
export default defineConfig({
	plugins: [solid()],
	test: {
		environment: "happy-dom",
		server: {
			deps: { inline: [/solid-js/, /@solidjs\//, /@sophistry\//] },
		},
		include: ["src/**/*.test.{ts,tsx}"],
		// Half the cores locally, Vitest's default in CI; see the library's config.
		maxWorkers: process.env.CI ? undefined : "50%",
	},
	ssr: {
		resolve: {
			conditions: ["browser", "development"],
			externalConditions: ["browser", "development"],
		},
	},
	resolve: {
		conditions: ["browser", "development"],
	},
});
