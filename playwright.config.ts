import {
	defineConfig,
	devices,
	type PlaywrightTestConfig,
} from "@playwright/test";

const FIXTURES = "http://127.0.0.1:5201";
const DOCS = "http://127.0.0.1:4322";
const PLAYGROUND = "http://127.0.0.1:5203";

/**
 * Which web servers to start: all of them by default, or a comma-separated
 * subset of `fixtures`, `docs` and `playground`. The visual-regression
 * container (`scripts/e2e-visual.mjs`) runs only the gallery, which needs only
 * the static docs server; the Vite servers would need Linux builds of their
 * native dependencies there.
 */
const servers = process.env.E2E_SERVERS?.split(",").map((name) => name.trim());

/** One entry of `webServer`. */
type WebServer = Extract<
	NonNullable<PlaywrightTestConfig["webServer"]>,
	unknown[]
>[number];

/** `server`, unless E2E_SERVERS leaves `name` out. */
const serve = (name: string, server: WebServer): WebServer[] =>
	!servers || servers.includes(name) ? [server] : [];

export default defineConfig({
	testDir: "./e2e/tests",
	outputDir: "./e2e/test-results",
	// Gallery baselines: e2e/__screenshots__/gallery/<category>/<Name>.png (the
	// spec passes ["gallery", category, "<Name>.png"]). They are Linux-only,
	// made in the pinned Playwright container; see CONTRIBUTING.md.
	snapshotPathTemplate: "e2e/__screenshots__/{arg}{ext}",
	expect: {
		toMatchSnapshot: {
			// Captures are byte-identical from run to run, so this only absorbs
			// rasteriser noise between machines: a per-pixel colour distance
			// (YIQ, 0..1) below which a pixel counts as equal, and a handful of
			// pixels allowed past it. Recolouring one 6 px dot changes ~80.
			threshold: 0.1,
			maxDiffPixels: 10,
		},
	},
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI
		? [["github"], ["html", { open: "never", outputFolder: "e2e/report" }]]
		: [["list"]],
	timeout: 60_000,
	use: {
		trace: "retain-on-failure",
		viewport: { width: 1280, height: 720 },
		// Fixed DPR so canvas sizes (and pixel maths) do not depend on the host.
		deviceScaleFactor: 1,
	},
	projects: [
		{
			// Frame-exactness probes (same-rAF paint, clock suspension, hover under a
			// moving camera) are timing sensitive: they flaked when run alongside
			// other pages and each other, because rAF cadence collapses under CPU
			// contention. Run them alone, one at a time.
			name: "engine",
			testMatch: /engine\.spec\.ts/,
			fullyParallel: false,
			workers: 1,
			use: { ...devices["Desktop Chrome"], deviceScaleFactor: 1 },
		},
		{
			name: "chromium",
			testIgnore: [/engine\.spec\.ts/, /gallery\.spec\.ts/],
			// Start only once the timing-sensitive engine project has finished.
			dependencies: ["engine"],
			use: { ...devices["Desktop Chrome"], deviceScaleFactor: 1 },
		},
		{
			// Every gallery example, mounted, settled deterministically and compared
			// with its baseline. Run it alone with `--project=gallery --no-deps`.
			name: "gallery",
			testMatch: /gallery\.spec\.ts/,
			dependencies: ["engine"],
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1280, height: 720 },
				deviceScaleFactor: 1,
				colorScheme: "light",
			},
		},
	],
	webServer: [
		...serve("fixtures", {
			// The workspace library source, served by Vite for the engine tests.
			command:
				"pnpm --filter @sophistry/e2e exec vite --config fixtures/vite.config.ts --host 127.0.0.1",
			url: `${FIXTURES}/index.html`,
			reuseExistingServer: !process.env.CI,
			stdout: "ignore",
			timeout: 60_000,
		}),
		...serve("docs", {
			// The docs build, made with PUBLIC_SOPHISTRY_CAPTURE=1 so the gallery's
			// capture mode is compiled in (`pnpm test:e2e` and
			// scripts/e2e-visual.mjs build it so; the deployed docs leave it out).
			command: "node e2e/serve-docs.mjs 4322",
			url: DOCS,
			reuseExistingServer: !process.env.CI,
			stdout: "ignore",
			timeout: 60_000,
		}),
		...serve("playground", {
			// The playground's Vite *dev* server: Solid's misuse diagnostics exist
			// only in the dev build, so `playground.spec.ts` visits every route here.
			command:
				"pnpm --filter playground exec vite --port 5203 --strictPort --host 127.0.0.1",
			url: PLAYGROUND,
			reuseExistingServer: !process.env.CI,
			stdout: "ignore",
			timeout: 60_000,
		}),
	],
});
