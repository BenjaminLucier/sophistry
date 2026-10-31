// Runs the playground's /benchmarks scenarios in headless Chromium against a
// production build and prints a markdown table. Not part of the test suite.
//   pnpm --filter playground exec vite build --outDir /tmp/pg-dist --emptyOutDir
//   node e2e/bench.mjs /tmp/pg-dist > /tmp/sophistry-bench.md
import { spawn } from "node:child_process";
import { chromium, webkit } from "@playwright/test";

const dist = process.argv[2] ?? "apps/playground/dist";
const seconds = Number(process.env.BENCH_SECONDS ?? 5);
const only = process.env.BENCH_ONLY?.split(",");
const all = [
	["all-moving", { nodes: 1000 }],
	["all-moving", { nodes: 10000 }],
	["one-moving", { nodes: 1000 }],
	["one-moving", { nodes: 10000 }],
	["camera-pan", { nodes: 1000 }],
	["camera-pan", { nodes: 10000 }],
	["churn", { nodes: 500, every: 30 }],
	["churn", { nodes: 5000, every: 30 }],
	["reorder", { nodes: 10000, every: 30 }],
	["scatter-pan", { nodes: 10000, batched: 1 }],
	["scatter-pan", { nodes: 100000, batched: 1 }],
	["scatter-transition", { nodes: 10000, batched: 1 }],
	["number-plane-pan", {}],
];

const runs = only ? all.filter(([id]) => only.includes(id)) : all;

const server = spawn(
	"pnpm",
	[
		"--filter",
		"playground",
		"exec",
		"vite",
		"preview",
		"--outDir",
		dist,
		"--host",
		"127.0.0.1",
	],
	// Its own process group: `pnpm exec` starts vite as a child, and killing
	// only pnpm would leave vite serving this build on the port, where the
	// next run would silently benchmark it instead of its own.
	{ stdio: "ignore", detached: true },
);
const stop = () => {
	try {
		process.kill(-server.pid);
	} catch {
		// Already gone.
	}
};
process.on("exit", stop);
await new Promise((r) => setTimeout(r, 3000));

// BENCH_BROWSER=chrome runs the installed Google Chrome (GPU canvas when
// headed), =webkit Playwright's WebKit; the default is bundled Chromium.
const engine = process.env.BENCH_BROWSER ?? "chromium";
const launch = () =>
	(engine === "webkit" ? webkit : chromium).launch({
		headless: !process.env.BENCH_HEADED,
		...(engine === "chrome" ? { channel: "chrome" } : {}),
	});
const browser = await launch();
const rows = [];
try {
	for (const [id, config] of runs) {
		const page = await browser.newPage({
			viewport: { width: 1280, height: 800 },
		});
		await page.goto(`http://127.0.0.1:5199/benchmarks/${id}`);
		for (const [key, value] of Object.entries(config)) {
			// Each param is a row of buttons labelled with the option.
			const label = value.toLocaleString();
			const group = page.locator("div.flex.items-center", {
				hasText: new RegExp(
					`^${{ nodes: "Nodes", swaps: "Comparisons per frame", changing: "Changing per frame", every: "Rebuild every", batched: "Batched" }[key]}`,
				),
			});
			await group.getByRole("button", { name: label, exact: true }).click();
		}
		await page
			.getByRole("button", { name: `${seconds}s`, exact: true })
			.click();
		await page.getByRole("button", { name: "Run", exact: true }).click();
		await page
			.getByRole("heading", { name: "Snapshot" })
			.waitFor({ timeout: (seconds + 60) * 1000 });
		const text = await page
			.locator("section", { hasText: "Snapshot" })
			.innerText();
		const num = (re) => Number(text.match(re)?.[1]);
		const phase = (name) => {
			const m = text.match(
				new RegExp(`${name}\\s+([\\d.]+) ms\\s+([\\d.]+) ms\\s+([\\d.]+) ms`),
			);
			return m ? m.slice(1).map(Number) : [NaN, NaN, NaN];
		};
		rows.push({
			id,
			config: Object.values(config).join(" / "),
			fps: num(/([\d.]+) fps/),
			mount: num(/Mount → first paint\s+([\d.]+) ms/),
			update: phase("Update"),
			paint: phase("Paint"),
			frame: phase("Frame interval"),
			slow: text
				.match(/(\d+) \/ (\d+)/)
				?.slice(1)
				.join("/"),
		});
		await page.close();
	}
} finally {
	await browser.close();
	stop();
}

const ua = await (async () => {
	const b = await launch();
	const v = b.version();
	await b.close();
	return v;
})();
console.log(
	`${process.env.BENCH_HEADED ? "Headed" : "Headless"} ${engine} ${ua}, ${seconds}s samples, production build, 1280x800, DPR 1.\n`,
);
console.log(
	"| scenario | config | fps | mount ms | update p50 / p95 / max ms | paint p50 / p95 / max ms | frame p50 / p95 ms | slow frames |",
);
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) {
	const f = (a) => `${a[0].toFixed(2)} / ${a[1].toFixed(2)}`;
	const g = (a) => `${f(a)} / ${a[2].toFixed(2)}`;
	console.log(
		`| ${r.id} | ${r.config} | ${r.fps.toFixed(1)} | ${r.mount.toFixed(1)} | ${g(r.update)} | ${g(r.paint)} | ${f(r.frame)} | ${r.slow} |`,
	);
}
