import { expect, type Page, test } from "@playwright/test";
import { FIXTURES, frames, instrument, near, pixel } from "./helpers";

async function open(page: Page, query: string) {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	await page.addInitScript(instrument);
	await page.goto(`${FIXTURES}/?${query}`);
	await page.waitForSelector("canvas");
	await frames(page, 3);
	return errors;
}

test.describe("shared frame loop", () => {
	test("a clock tick is painted in the same rAF frame", async ({ page }) => {
		const errors = await open(page, "s=same-frame");
		await page.waitForFunction(() => window.__t.tick > 90);
		const { paints, tickFrame } = await page.evaluate(() => ({
			paints: (window as never as { __probe: { paints: Paint[] } }).__probe
				.paints,
			tickFrame: window.__t.tickFrame as Record<number, number>,
		}));
		type Paint = { frame: number; tick: number; hit: boolean };
		let checked = 0;
		for (const p of paints as Paint[]) {
			if (p.tick < 5) continue;
			// Every paint shows the rect where the latest tick put it...
			expect(p.hit, `paint at tick ${p.tick} frame ${p.frame}`).toBe(true);
			// ...and that tick happened in the very frame being painted.
			expect(tickFrame[p.tick], `tick ${p.tick}`).toBe(p.frame);
			checked++;
		}
		expect(checked).toBeGreaterThan(60);
		// One paint per tick: nothing was painted a frame late or twice.
		const ticks = Object.keys(tickFrame).length;
		expect(checked).toBeGreaterThanOrEqual(ticks - 10);
		expect(errors).toEqual([]);
	});
});

test.describe("offscreen suspension", () => {
	const snapshot = (page: Page) =>
		page.evaluate(() => {
			const t = window.__t;
			const counts = (
				window as never as { __probe: { counts: Record<string, number> } }
			).__probe.counts;
			const out: Record<
				string,
				{ time: number; paints: number; paused: boolean }
			> = {};
			for (const id of ["A", "B", "C", "D"]) {
				out[id] = {
					time: t.clocks[id].time.peek(),
					paints: counts[id] ?? 0,
					paused: t.clocks[id].paused.peek(),
				};
			}
			return out;
		});

	type Snapshot = Awaited<ReturnType<typeof snapshot>>;
	type StageId = keyof Snapshot;

	/**
	 * Two snapshots a few frames apart. Everything below asserts on a window like
	 * this, never on a fixed frame count after a scroll: when an
	 * `IntersectionObserver` report reaches the stage depends on browser load,
	 * so "five frames after `scrollIntoView`" is sometimes before it.
	 */
	const window10 = async (page: Page) => {
		const before = await snapshot(page);
		await frames(page, 10);
		return { before, after: await snapshot(page) };
	};

	/** Polls until the stage neither ticks nor paints across a window. */
	const frozen = (page: Page, id: StageId, message: string) =>
		expect
			.poll(
				async () => {
					const { before, after } = await window10(page);
					return (
						after[id].time === before[id].time &&
						after[id].paints === before[id].paints
					);
				},
				{ message, timeout: 15_000 },
			)
			.toBe(true);

	/** Polls until the stage both ticks and paints across a window. */
	const running = (page: Page, id: StageId, message: string) =>
		expect
			.poll(
				async () => {
					const { before, after } = await window10(page);
					return (
						after[id].time > before[id].time &&
						after[id].paints > before[id].paints
					);
				},
				{ message, timeout: 15_000 },
			)
			.toBe(true);

	test("hidden stages stop painting and ticking; paused() untouched; resume on return", async ({
		page,
	}) => {
		const errors = await open(page, "s=offscreen");
		// A is on screen: advancing and painting.
		await running(page, "A", "A (on screen) runs");
		// C (inside a scroller below the fold) is hidden: frozen once the first
		// observer report has been delivered.
		await frozen(page, "C", "C (below the fold) freezes");
		// D opted out: keeps ticking and painting off-screen.
		await running(page, "D", "D (opted out) runs off-screen");
		// B (no clock) is hidden: it must not paint although its track changes.
		await expect
			.poll(
				async () => {
					const { before, after } = await window10(page);
					return after.B.paints - before.B.paints;
				},
				{ message: "B (hidden, no clock) stops painting", timeout: 15_000 },
			)
			.toBe(0);
		const settled = await snapshot(page);
		for (const id of ["A", "B", "C", "D"] as const)
			expect(settled[id].paused).toBe(false);

		// Scroll B into view: it paints again, and A (now far off-screen) freezes.
		await page.evaluate(() =>
			document.querySelector('[data-stage="B"]')?.scrollIntoView(),
		);
		await expect
			.poll(
				async () => {
					const { before, after } = await window10(page);
					return after.B.paints > before.B.paints;
				},
				{ message: "B paints once scrolled into view", timeout: 15_000 },
			)
			.toBe(true);
		await frozen(page, "A", "A freezes once scrolled away");
		expect((await snapshot(page)).A.paused).toBe(false);

		// C sits inside an overflow scroller that is itself scrolled to the top,
		// so even with the scroller on screen C is clipped out of view.
		await page.evaluate(() =>
			document.querySelector("[data-scroller]")?.scrollIntoView(),
		);
		await page.waitForFunction(() => {
			const rect = document
				.querySelector("[data-scroller]")
				?.getBoundingClientRect();
			return !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight;
		});
		await frozen(page, "C", "C stays clipped while its scroller is on screen");

		// Scrolling the container reveals it: resumes.
		await page.evaluate(() => {
			const s = document.querySelector("[data-scroller]");
			s?.scrollTo({ top: s.scrollHeight });
		});
		await running(page, "C", "C resumes when its scroller reveals it");
		expect((await snapshot(page)).C.paused).toBe(false);

		// And scrolling it back out suspends it again.
		await page.evaluate(() =>
			document.querySelector("[data-scroller]")?.scrollTo({ top: 0 }),
		);
		await frozen(page, "C", "C freezes again when scrolled out");
		expect(errors).toEqual([]);
	});
});

test.describe("document paint order", () => {
	test("a <Show> of an earlier sibling paints below the later one", async ({
		page,
	}) => {
		const errors = await open(page, "s=order");
		// Overlap of the red (-0.5) and blue (+0.5) rects is at the centre.
		expect(near(await pixel(page, "show", 0.5, 0.5), 0, 0, 255)).toBe(true);
		await page.evaluate(() => window.__t.setShow(true));
		await frames(page, 4);
		// Red mounted last but sits earlier in the document: blue stays on top.
		expect(near(await pixel(page, "show", 0.5, 0.5), 0, 0, 255)).toBe(true);
		// Red's exclusive part (left of overlap) is visible.
		expect(near(await pixel(page, "show", 0.5 - 2 / 16, 0.5), 255, 0, 0)).toBe(
			true,
		);
		await page.evaluate(() => window.__t.setShow(false));
		await frames(page, 4);
		expect(near(await pixel(page, "show", 0.5 - 2 / 16, 0.5), 255, 0, 0)).toBe(
			false,
		);
		expect(errors).toEqual([]);
	});

	test("a <For> reorder flips paint order", async ({ page }) => {
		const errors = await open(page, "s=order");
		// r, g, b: b is last, so on top at the centre.
		expect(near(await pixel(page, "for", 0.5, 0.5), 0, 0, 255)).toBe(true);
		await page.evaluate(() => window.__t.setOrder(["b", "g", "r"]));
		await frames(page, 4);
		expect(near(await pixel(page, "for", 0.5, 0.5), 255, 0, 0)).toBe(true);
		await page.evaluate(() => window.__t.setOrder(["g", "r", "b"]));
		await frames(page, 4);
		expect(near(await pixel(page, "for", 0.5, 0.5), 0, 0, 255)).toBe(true);
		await page.evaluate(() => window.__t.setOrder(["r", "b", "g"]));
		await frames(page, 4);
		expect(near(await pixel(page, "for", 0.5, 0.5), 0, 255, 0)).toBe(true);
		expect(errors).toEqual([]);
	});
});

/** Ink width in the top and bottom fifth of the ink's bounding box. */
async function inkProfile(page: Page, stage: string) {
	return page.evaluate((stage) => {
		const canvas = document.querySelector<HTMLCanvasElement>(
			`[data-stage="${stage}"] canvas`,
		) as HTMLCanvasElement;
		const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
		const { width, height } = canvas;
		const data = ctx.getImageData(0, 0, width, height).data;
		// The stage paints an opaque background: ink is whatever is dark against it.
		const isInk = (d: Uint8ClampedArray, i: number) =>
			d[i] + d[i + 1] + d[i + 2] < 300;
		const rows: number[] = new Array(height).fill(0);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++)
				if (isInk(data, (y * width + x) * 4)) rows[y]++;
		const inked = rows.flatMap((n, y) => (n ? [y] : []));
		const top = inked[0];
		const bottom = inked[inked.length - 1];
		const span = bottom - top;
		const avg = (from: number, to: number) => {
			let sum = 0;
			for (let y = from; y < to; y++) sum += rows[y];
			return sum / Math.max(1, to - from);
		};
		return {
			upper: avg(top, top + Math.floor(span * 0.2)),
			lower: avg(bottom - Math.floor(span * 0.2), bottom),
			span,
			height,
		};
	}, stage);
}

test.describe("text and strokes", () => {
	for (const yUp of ["1", "0"]) {
		test(`text renders upright (yUp=${yUp})`, async ({ page }) => {
			const errors = await open(page, `s=text&yUp=${yUp}`);
			const p = await inkProfile(page, "text");
			expect(p.span).toBeGreaterThan(p.height * 0.2);
			// A "T" is wide at the top (bar) and narrow at the bottom (stem).
			expect(p.upper).toBeGreaterThan(p.lower * 2);
			expect(errors).toEqual([]);
		});
	}

	test("stroke width scales with zoom", async ({ page }) => {
		const thickness = async (units: number) => {
			await page.goto(`${FIXTURES}/?s=stroke&units=${units}`);
			await page.waitForSelector("canvas");
			await frames(page, 3);
			return page.evaluate(() => {
				const canvas = document.querySelector("canvas") as HTMLCanvasElement;
				const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
				const x = Math.round(canvas.width / 2);
				const col = ctx.getImageData(x, 0, 1, canvas.height).data;
				let n = 0;
				for (let y = 0; y < canvas.height; y++)
					if (col[y * 4] + col[y * 4 + 1] + col[y * 4 + 2] < 300) n++;
				return { n, width: canvas.width };
			});
		};
		const wide = await thickness(8);
		const zoomed = await thickness(4);
		// 0.5 scene units at 8 units across 400px is 25px; at 4 units, 50px.
		expect(Math.abs(wide.n - 25)).toBeLessThanOrEqual(2);
		expect(zoomed.n / wide.n).toBeGreaterThan(1.9);
		expect(zoomed.n / wide.n).toBeLessThan(2.1);
	});
});

test.describe("pointer", () => {
	test("usePointer and hover follow a camera that moves under a still mouse", async ({
		page,
	}) => {
		const errors = await open(page, "s=hover");
		const box = await page.locator('[data-stage="hover"] canvas').boundingBox();
		if (!box) throw new Error("no canvas box");
		// Park the mouse at the stage's centre (scene x = centre.x), then never move it.
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await frames(page, 3);
		const read = () =>
			page.evaluate(() => ({
				x: window.__t.pointer.peek()?.scene.x as number | undefined,
				hovered: window.__t.hovered.peek() as boolean,
			}));
		const before = await read();
		expect(before.x).toBeCloseTo(0, 1);
		expect(before.hovered).toBe(false);

		// Animate the camera centre from 0 to 3 over ~30 frames; the rect sits at x=3.
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					let f = 0;
					const step = () => {
						window.__t.setCenter((++f / 30) * 3);
						f < 30 ? requestAnimationFrame(step) : resolve();
					};
					requestAnimationFrame(step);
				}),
		);
		await frames(page, 3);
		const after = await read();
		expect(after.x).toBeCloseTo(3, 1);
		expect(after.hovered).toBe(true);

		// And back out again.
		await page.evaluate(() => window.__t.setCenter(-4));
		await frames(page, 3);
		const out = await read();
		expect(out.x).toBeCloseTo(-4, 1);
		expect(out.hovered).toBe(false);
		expect(errors).toEqual([]);
	});
});

test.describe("frame export", () => {
	test("exported frames are painted for their own instant, in order, and state is restored", async ({
		page,
	}) => {
		const errors = await open(page, "s=export");
		type Row = {
			index: number;
			time: number;
			type: string;
			center: number | null;
			expected: number;
		};
		const rows = (await page.evaluate(() => window.__t.run(4))) as Row[];
		expect(rows.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
		expect(rows.map((r) => r.time)).toEqual([0, 0.25, 0.5, 0.75, 1]);
		for (const row of rows) {
			expect(row.type).toBe("image/png");
			expect(row.center, `frame ${row.index} has a red rect`).not.toBeNull();
			// Within a few device pixels of where that instant puts the rect.
			expect(Math.abs((row.center as number) - row.expected)).toBeLessThan(3);
		}
		// Every frame differs from the last (the rect really moved).
		for (let i = 1; i < rows.length; i++) {
			expect(
				(rows[i]?.center as number) - (rows[i - 1]?.center as number),
			).toBeGreaterThan(10);
		}
		// The timeline is back where it started, and the live stage follows it.
		const after = await page.evaluate(() => ({
			time: window.__t.tl.time.peek(),
			x: window.__t.x.peek().x,
		}));
		expect(after.time).toBe(0);
		expect(after.x).toBe(-6);
		await frames(page, 3);
		expect(
			near(await pixel(page, "export", 0.5 - 6 / 16, 0.5), 255, 0, 0),
		).toBe(true);
		expect(errors).toEqual([]);
	});
});
