import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { DOCS, frames } from "./helpers";

/*
 * Visual regression for the gallery. Each example is mounted in capture mode
 * (`?capture`, see docs/src/components/capture.ts), driven to a deterministic
 * frame and compared with its baseline in
 * e2e/__screenshots__/gallery/<category>/<Name>.png. Capture mode exists only
 * in a docs build made with PUBLIC_SOPHISTRY_CAPTURE=1, as `pnpm test:e2e`,
 * scripts/e2e-visual.mjs and CI's e2e job build it; the production docs
 * ignore `?capture`.
 *
 * How an example reaches its frame:
 *
 * - Runs on the island's clock (`usePlayer()`, `useClock()`, the default for
 *   every example) animate on a clock the test steps by hand, 1/60 s at a
 *   time, until nothing is running: the captured frame is the scene at rest.
 * - Examples that never come to rest (a `while (!signal.aborted)` script, or
 *   `forever`) are listed in LOOPS with the clock time they are captured at.
 * - Examples that create a clock of their own (`createClock()`, for a
 *   scrubber) are outside the island's reach, so the page emulates
 *   `prefers-reduced-motion: reduce`: their timelines jump to the end state.
 * - Interactive and scroll-driven examples are captured as they first appear,
 *   before any input.
 *
 * The capture is the canvas's own backing store (`toDataURL`), not a page
 * screenshot: a stage's CSS box is fractional (632 x 355.5 px), so a clip of
 * the page covers 356 or 357 rows depending on the sub-pixel scroll offset,
 * and the compositor resamples the canvas into it. The backing store is
 * always the same size and holds exactly what the stage painted.
 *
 * Baselines are Linux-only (the pinned Playwright container that CI's e2e job
 * also runs in): font rasterisation differs between platforms. Comparison is
 * on when E2E_VISUAL=1; elsewhere every example is still mounted, settled and
 * captured, but not compared. Update baselines with `pnpm test:e2e:update`.
 */

declare global {
	interface Window {
		/** Published by capture mode; see docs/src/components/capture.ts. */
		__sophistryCapture?: Record<
			string,
			{ settle(limit: number): Promise<{ time: number; idle: boolean }> }
		>;
	}
}

const DIST =
	process.env.E2E_DOCS_DIST ??
	fileURLToPath(new URL("../../docs/dist", import.meta.url));
const GALLERY = join(DIST, "gallery");
const BASELINES = fileURLToPath(
	new URL("../__screenshots__/gallery", import.meta.url),
);
const VISUAL = process.env.E2E_VISUAL === "1";

/** One clock step, as in capture.ts. */
const STEP = 1 / 60;
/** Clock time an example may take to come to rest before it counts as stuck. */
const MAX_SETTLE = 60;

/**
 * Examples that animate forever, with the clock time (seconds) each is
 * captured at: a moment that shows the scene well, usually inside a hold.
 * The test fails if one of these comes to rest before its time (take it off
 * the list) or an example not listed here does not (add it).
 */
const LOOPS: Record<string, number> = {
	"advanced/FourierEpicycles": 11,
	"advanced/GradientDescent": 7.8,
	"advanced/GraphTraversal": 5.2,
	"advanced/SineCurveUnitCircle": 6.75,
	"advanced/SortingVisualizer": 6,
	// Second cycle: drawing backwards over the first colour thinning away.
	"animation/AnimatedBoundaryHighlight": 2.4,
	"animation/AnimatedNumbers": 2.5,
	// Mid-swap, in the slow stretch where the arcs and trails both show.
	"animation/ArcsTrailsAndSpeed": 1.6,
	"animation/CustomAnimationLeaf": 2,
	"animation/EasingComparison": 2.5,
	"animation/EmphasisEffects": 2,
	"animation/FadeAndGrow": 2,
	// Mid-wave: focusOn 1.5 s, blink 1.2 s, flash 1.2 s, then the wave.
	"animation/IndicationEffects": 4.6,
	"animation/MatchingShapes": 2.8,
	"animation/MorphShapes": 1.4,
	"animation/MovingAngle": 2.5,
	"animation/PointMovingOnShapes": 1,
	// Mid-race, where the curves are furthest apart.
	"animation/RateFunctions": 1.25,
	"animation/Sequencing": 2,
	"animation/WriteAndErase": 2,
	"basic/ClipWipe": 1,
	"basic/GradientsAndStrokes": 1.25,
	"basic/GroupTransforms": 1,
	"basic/RectDimensions": 1.9,
	"basic/UnitCircle": 2.5,
	// Mid-reorder: the tiles sliding past each other.
	"basic/LayoutTransition": 1.1,
	"interaction/CameraFlight": 3,
	"maths/ComplexMultiplication": 4.25,
	// Halfway through the map, the grid half bent.
	"maths/ComplexSquaring": 1.85,
	"maths/FormulaMorph": 3.3,
	"maths/LinearTransformation": 3.8,
	// Mid-flow, the disc already sheared into an arc.
	"maths/PendulumPhaseFlow": 2.8,
	"maths/ValueTrackerDot": 5.8,
	"plotting/AxisRescale": 3.3,
	"plotting/BarChartMorph": 2.7,
	// At rest on the scatter, in the hold after the forward blend.
	"plotting/BarsToScatter": 3.9,
	"plotting/KeyedBoxes": 1.8,
	"plotting/KeyedBubbles": 3.1,
	"plotting/KeyedPie": 1.8,
	"plotting/KeyedScatter": 1.8,
	"plotting/LineMorph": 2.1,
	"plotting/RadarAxes": 4.9,
	"plotting/SortedBars": 2.5,
	"plotting/StackMorph": 2.1,
	"plotting/SunburstDrillDown": 4.9,
	"plotting/TreeTransition": 4.9,
	"plotting/TreemapResquarify": 4.9,
	"plotting/TreemapTransition": 4.9,
	"three-d/CameraMotion": 2.5,
	// Half a turn into the phase: the arrows have swung well away from the start.
	"vanilla/PathBatch": 3,
	// Two quarter-turns in: the tip is at 180 degrees, readout and arc agreeing.
	"vanilla/TracksAndDerive": 2.4,
};

/**
 * Every example embedded in a built `/gallery/` page, as `[page, id, name]`,
 * `name` being `category/Name` (the baseline's path and the LOOPS key). Read
 * from the built HTML so each example gets its own test and one failing
 * example cannot hide the rest of its page.
 *
 * The name comes from the section's `data-example`: a category's examples are
 * split across sub-pages (`/gallery/plotting/bars-and-parts/`), so the page's
 * URL no longer says which category an example belongs to.
 */
function galleryExamples(
	dir = GALLERY,
	prefix = "/gallery",
): [string, string, string][] {
	const found: [string, string, string][] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			found.push(...galleryExamples(full, `${prefix}/${name}`));
		} else if (name === "index.html") {
			const html = readFileSync(full, "utf8");
			for (const match of html.matchAll(
				/<section[^>]*class="[^"]*sophistry-example[^"]*"[^>]*>/g,
			)) {
				const tag = match[0];
				const id = tag.match(/\bid="([^"]+)"/)?.[1];
				if (!id) continue;
				const path = `${prefix}/`;
				const name =
					tag.match(/\bdata-example="([^"]+)"/)?.[1] ??
					`${category(path)}/${id}`;
				found.push([path, id, name]);
			}
		}
	}
	return found.sort();
}

/** Every committed baseline, as "category/Name". */
function baselines(dir = BASELINES): string[] {
	if (!existsSync(dir)) return [];
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...baselines(full));
		else if (entry.name.endsWith(".png"))
			found.push(relative(BASELINES, full).replace(/\.png$/, ""));
	}
	return found.sort();
}

/** Distinct colours among a coarse sample of the canvas (1 means blank). */
const distinctColours = (page: Page, id: string) =>
	page.evaluate((id) => {
		const canvas = document.getElementById(id)?.querySelector("canvas");
		if (!canvas || canvas.width === 0) return 0;
		const ctx = canvas.getContext("2d") ?? canvas.getContext("webgl");
		if (!ctx || !("getImageData" in ctx)) return 0;
		const { width, height } = canvas;
		const seen = new Set<number>();
		const data = ctx.getImageData(0, 0, width, height).data;
		const step = Math.max(1, Math.floor((width * height) / 20000));
		for (let p = 0; p < width * height; p += step) {
			const i = p * 4;
			seen.add(
				(data[i] << 24) |
					(data[i + 1] << 16) |
					(data[i + 2] << 8) |
					data[i + 3],
			);
			if (seen.size > 8) break;
		}
		return seen.size;
	}, id);

/** The example's canvas as a PNG data URL, straight from its backing store. */
const canvasPng = (page: Page, id: string) =>
	page.evaluate(
		(id) =>
			document.getElementById(id)?.querySelector("canvas")?.toDataURL() ?? "",
		id,
	);

/**
 * Steps an example's clock to its capture time: to rest, or to `at` seconds
 * for a loop. Called repeatedly, a little apart in real time, because some
 * scripts start late (a formula has to typeset before it is written out):
 * three calls in a row with nothing left to run mean the example is at rest.
 */
async function settle(page: Page, name: string, at: number | undefined) {
	const limit = at ?? MAX_SETTLE;
	let time = 0;
	let idle = true;
	for (let quiet = 0, round = 0; quiet < 3 && round < 50; round++) {
		if (limit - time < STEP / 2) break;
		const result = await page.evaluate(
			([name, limit]) => {
				const control = window.__sophistryCapture?.[name];
				if (!control)
					throw new Error(
						`no capture handle for ${name}: capture mode is compiled in only ` +
							"with PUBLIC_SOPHISTRY_CAPTURE=1 (pnpm test:e2e builds the docs that way)",
					);
				return control.settle(limit);
			},
			[name, limit - time] as const,
		);
		time += result.time;
		idle = result.idle;
		quiet = result.time === 0 ? quiet + 1 : 0;
		await page.waitForTimeout(100);
	}
	return { time, idle };
}

/** "/gallery/basic/" to "basic": an example's category, its baseline folder. */
const category = (path: string) =>
	path.replace(/^\/gallery\/?/, "").replace(/\/$/, "") || "index";

const examples = galleryExamples();
const pages = [...new Set(examples.map(([path]) => path))];

test("the docs build has gallery pages", () => {
	expect(pages.length).toBeGreaterThanOrEqual(6);
});

test("every baseline belongs to a gallery example", () => {
	test.skip(!VISUAL, "visual comparison is off (E2E_VISUAL=1 turns it on)");
	const names = new Set(examples.map(([, , name]) => name));
	const stale = baselines().filter((name) => !names.has(name));
	expect(stale, "delete these baselines, or run pnpm test:e2e:update").toEqual(
		[],
	);
});

test("every example in LOOPS exists", () => {
	const names = new Set(examples.map(([, , name]) => name));
	expect(Object.keys(LOOPS).filter((name) => !names.has(name))).toEqual([]);
});

for (const [path, id, name] of examples) {
	const slug = name.slice(0, name.lastIndexOf("/"));
	test(`gallery ${path} ${id}: mounts, paints and matches its baseline`, async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const errors: string[] = [];
		page.on("pageerror", (e) => {
			errors.push(`pageerror: ${e.message}`);
			// The stack goes to the log: the message alone rarely says where.
			console.log(`pageerror in ${id}: ${e.stack ?? e.message}`);
		});
		page.on("console", (m) => {
			if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
		});

		// Examples that create their own clock jump to their end state.
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto(`${DOCS}${path}?capture`);
		const section = page.locator(`[id="${id}"]`);
		// Scroll the example in view (the island, not the whole section: it
		// includes a long source listing). Islands mount lazily and off-screen
		// stages deliberately skip painting, and layout shifts as neighbours
		// load, so the example is re-revealed before every look at its canvas.
		const island = section.locator("astro-island");
		const reveal = () => island.scrollIntoViewIfNeeded({ timeout: 5_000 });
		await reveal();
		await section
			.locator("canvas")
			.first()
			.waitFor({ state: "visible", timeout: 20_000 });
		await page.waitForLoadState("networkidle");
		await page.evaluate(() => document.fonts.ready);

		const at = LOOPS[name];
		const { time, idle } = await settle(page, name, at);
		if (at === undefined) {
			expect(
				idle,
				`${name} still animates after ${MAX_SETTLE} s of clock time; if it loops, add it to LOOPS`,
			).toBe(true);
		} else {
			expect(
				idle,
				`${name} came to rest at ${time.toFixed(2)} s; take it off LOOPS`,
			).toBe(false);
		}

		await expect
			.poll(
				async () => {
					await reveal();
					return distinctColours(page, id);
				},
				{
					message: `${id} canvas should not be blank`,
					timeout: 15_000,
				},
			)
			.toBeGreaterThan(1);
		await expect(section.locator("[role=alert]")).toHaveCount(0);

		// The settled frame, once two consecutive looks agree (a reduced-motion
		// jump cross-fades for up to 150 ms of real time).
		let png = "";
		await expect
			.poll(
				async () => {
					await reveal();
					await frames(page, 2);
					const next = await canvasPng(page, id);
					const same = next === png;
					png = next;
					return same && png !== "";
				},
				{ message: `${id} canvas should stop changing`, timeout: 15_000 },
			)
			.toBe(true);

		const image = Buffer.from(png.slice(png.indexOf(",") + 1), "base64");
		await test.info().attach(`${id}.png`, {
			body: image,
			contentType: "image/png",
		});
		if (VISUAL) {
			expect(image).toMatchSnapshot(["gallery", slug, `${id}.png`]);
		}
		expect(errors).toEqual([]);
	});
}

test("light/dark toggle keeps html[data-mode] and stages in sync", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(`${DOCS}${pages[0]}`);
	const html = page.locator("html");
	const canvas = page.locator("section.sophistry-example canvas").first();
	await canvas.scrollIntoViewIfNeeded();
	await canvas.waitFor({ state: "visible" });
	const corner = () =>
		page.evaluate(() => {
			const c = document.querySelector(
				"section.sophistry-example canvas",
			) as HTMLCanvasElement;
			const d = (c.getContext("2d") as CanvasRenderingContext2D).getImageData(
				2,
				2,
				1,
				1,
			).data;
			return d[0] + d[1] + d[2];
		});
	const select = page.locator("starlight-theme-select select").first();

	await select.selectOption("dark");
	await expect(html).toHaveAttribute("data-mode", "dark");
	await expect.poll(corner).toBeLessThan(300);
	const dark = await corner();

	await select.selectOption("light");
	await expect(html).toHaveAttribute("data-mode", "light");
	await expect.poll(corner).toBeGreaterThan(450);

	await select.selectOption("dark");
	await expect(html).toHaveAttribute("data-mode", "dark");
	await expect.poll(corner).toBe(dark);
	expect(errors).toEqual([]);
});
