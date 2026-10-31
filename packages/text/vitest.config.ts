import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		// Most of a file's cost is importing its module graph, so beyond half
		// the cores the run gets barely faster while the machine is pinned.
		maxWorkers: process.env.CI ? undefined : "50%",
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "json-summary"],
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/**/index.ts"],
		},
	},
});
