import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [solid()],
	test: {
		environment: "happy-dom",
		// Solid ships separate server and browser builds, picked by export
		// condition. Tests must run the browser build, so Vite has to process
		// Solid itself instead of leaving it to Node's resolver.
		server: { deps: { inline: [/solid-js/, /@solidjs\//] } },
		include: ["src/**/*.test.{ts,tsx}"],
		// Most of a file's cost is importing its module graph, so beyond half
		// the cores the run gets barely faster while the machine is pinned.
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
