/**
 * Permanent guard for the playground's dev build.
 *
 * Solid's misuse diagnostics (`EFFECT_RELAY_TEAR`, `STRICT_READ_UNTRACKED`,
 * `NO_OWNER_CLEANUP`, ...) exist only in the development build and are logged
 * through `console.warn` / `console.error`. A production build strips them, so
 * neither the gallery nor the docs suite can see a library regression that
 * only a user running a dev server would hit. This visits every playground
 * route against the Vite dev server and fails on any console warning, console
 * error, or uncaught page error.
 *
 * Routes are discovered from the file-system router's tree
 * (`apps/playground/src/routes`), so a new route is covered without editing
 * this file; the dynamic `benchmarks/[id]` route is expanded with every
 * benchmark id declared in `src/benchmarks/scenes.tsx`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { PLAYGROUND } from "./helpers";

const APP = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../apps/playground/src",
);

/** Every `*.tsx` under `routes/`, as a URL path (`index` and `[id]` resolved). */
function discoverRoutes(): string[] {
	const ids = [
		...readFileSync(join(APP, "benchmarks/scenes.tsx"), "utf8").matchAll(
			/^\t\tid: "([^"]+)",$/gm,
		),
	].map((match) => match[1]);
	const root = join(APP, "routes");
	const paths: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) walk(join(dir, entry.name));
			else if (entry.name.endsWith(".tsx")) {
				const route = relative(root, join(dir, entry.name))
					.replace(/\.tsx$/, "")
					.replace(/(^|\/)index$/, "");
				if (route.includes("[id]")) {
					for (const id of ids) paths.push(`/${route.replace("[id]", id)}`);
				} else paths.push(`/${route}`);
			}
		}
	};
	walk(root);
	return paths.sort();
}

const ROUTES = discoverRoutes();

/** Index pages: links and tables, no stage to wait for. */
const NO_CANVAS = new Set(["/", "/benchmarks"]);

/** Records everything a page says that a clean dev build should not. */
function watch(page: Page): string[] {
	const problems: string[] = [];
	page.on("console", (message) => {
		const type = message.type();
		if (type === "warning" || type === "error")
			problems.push(`console.${type}: ${message.text()}`);
	});
	page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
	return problems;
}

test("route discovery found the playground's routes", () => {
	expect(ROUTES).toContain("/");
	expect(ROUTES).toContain("/views");
	expect(ROUTES).toContain("/benchmarks/all-moving");
	expect(ROUTES.length).toBeGreaterThanOrEqual(20);
});

for (const route of ROUTES) {
	test(`playground ${route} logs no warnings or errors`, async ({ page }) => {
		const problems = watch(page);
		// `?attribution` enables Solid's attribution engine (see the playground's
		// entry): without it the relay-tear, hot-scope and unstable-memo checks
		// never run. The benchmarks are left out: they are deliberately heavy
		// scenes (thousands of nodes) and the engine's bookkeeping turns the
		// largest into a multi-second page load that is not a signal about
		// the library.
		const attribution = route.startsWith("/benchmarks/") ? "" : "?attribution";
		await page.goto(`${PLAYGROUND}${route}${attribution}`);
		// A benchmark mounts its scene only once started.
		if (route.startsWith("/benchmarks/"))
			await page.getByRole("button", { name: "Run" }).click();
		if (!NO_CANVAS.has(route)) await page.locator("canvas").first().waitFor();
		// Some diagnostics only fire on a frame after mount (a relay write
		// landing in the next flush), so let the animations run.
		await page.waitForTimeout(2500);
		// The benchmark scenes drive thousands of nodes from one signal on purpose
		// (it is what they measure), which is exactly Solid's HUGE_FAN_OUT advice.
		const unexpected = route.startsWith("/benchmarks/")
			? problems.filter((problem) => !problem.includes("[HUGE_FAN_OUT]"))
			: problems;
		expect(unexpected).toEqual([]);
	});
}
