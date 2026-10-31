import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "happy-dom",
		include: ["src/**/*.test.{ts,tsx}"],
		// Most of a file's cost is importing its module graph, so beyond half
		// the cores the run gets barely faster while the machine is pinned.
		maxWorkers: process.env.CI ? undefined : "50%",
	},
});
