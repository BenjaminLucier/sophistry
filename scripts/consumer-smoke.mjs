// "Fresh install from npm" launch check. Builds every published package, packs them with
// `pnpm pack` (which applies `publishConfig`, so the tarball's `exports` are the
// published ones), installs the tarball into a throwaway project outside the
// workspace with npm, bundles a tiny app that imports every entry point, and
// loads it in headless Chromium. Fails on any build warning about unresolved
// imports, console error / warning, page error, failed request, or blank canvas.
//
//   pnpm smoke:consumer         # or: just smoke
//
// Needs network (npm install) and a Playwright Chromium (`playwright install`).
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = ["core", "text", "charts", "3d", "solidjs", "react"];
const work = mkdtempSync(join(tmpdir(), "sophistry-smoke-"));
const run = (cmd, args, cwd, opts = {}) =>
	execFileSync(cmd, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...opts,
	});

/** Pinned versions come from the workspace catalog so the check tracks it. */
const catalog = Object.fromEntries(
	[
		...readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").matchAll(
			/^\s+"?([^":\s]+\/?[^":\s]*)"?:\s*(\S+)\s*$/gm,
		),
	].map((m) => [m[1], m[2]]),
);
const need = ["solid-js", "@solidjs/web", "@solidjs/vite-plugin", "vite"];
for (const n of need)
	if (!catalog[n]) throw new Error(`catalog entry missing: ${n}`);

const app = `
import { render } from "@solidjs/web";
import * as core from "@sophistry/core";
import * as geometry from "@sophistry/core/geometry";
import * as color from "@sophistry/core/color";
import * as themes from "@sophistry/core/themes";
import * as internal from "@sophistry/core/internal";
import * as text from "@sophistry/text";
import * as charts from "@sophistry/charts";
import * as chartsMath from "@sophistry/charts/math";
import * as d3 from "@sophistry/3d";
import * as solid from "@sophistry/solidjs";
import * as solidText from "@sophistry/solidjs/text";
import * as solidCharts from "@sophistry/solidjs/charts";
import * as solid3d from "@sophistry/solidjs/3d";
import * as react from "@sophistry/react";

const { Circle, Stage } = solid;
const entries = { core, geometry, color, themes, internal, text, charts, chartsMath, d3, solid, solidText, solidCharts, solid3d, react };
const counts = Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, Object.keys(v).length]));
window.__smoke = { counts, ready: false };

const direct = geometry.morphPathData("M0 0 L2 0 L2 2 L0 2 Z", "M1 0 L2 2 L0 2 Z")(0.5);
window.__smoke.directMorphSubpaths = direct.length;

function App() {
	return (
		<>
			<div id="morph"><Stage units={4}><Circle center={{ x: 0, y: 0 }} radius={1} fill="#fff" /></Stage></div>
			<div id="math"><Stage units={10}><solidText.MathTex tex={"e^{i\\\\pi}+1=0"} fontSize={1} ref={(n) => n.ready().then(() => { window.__smoke.ready = true; })} /></Stage></div>
		</>
	);
}
render(() => <App />, document.getElementById("root"));
`;

let server;
let failed = false;
try {
	console.log("building the published packages ...");
	for (const name of PACKAGES)
		run("pnpm", ["--filter", `@sophistry/${name}`, "build"], root);
	const packDir = join(work, "pack");
	mkdirSync(packDir);
	// `pnpm pack` applies `publishConfig` and turns `workspace:^` into a range.
	const tarballs = {};
	for (const name of PACKAGES) {
		const before = new Set(readdirSync(packDir));
		run(
			"pnpm",
			["pack", "--pack-destination", packDir],
			join(root, "packages", name),
		);
		const file = readdirSync(packDir).find((f) => !before.has(f));
		tarballs[`@sophistry/${name}`] = `file:${join(packDir, file)}`;
	}

	const dir = join(work, "consumer");
	mkdirSync(join(dir, "src"), { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: "sophistry-consumer",
			private: true,
			type: "module",
			dependencies: {
				...tarballs,
				react: "^19.3.0",
				"solid-js": catalog["solid-js"],
				"@solidjs/web": catalog["@solidjs/web"],
			},
			devDependencies: {
				vite: catalog.vite,
				"@solidjs/vite-plugin": catalog["@solidjs/vite-plugin"],
			},
		}),
	);
	writeFileSync(
		join(dir, "index.html"),
		'<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>',
	);
	writeFileSync(join(dir, "src/main.tsx"), app);
	writeFileSync(
		join(dir, "vite.config.mjs"),
		'import solid from "@solidjs/vite-plugin";\nexport default { plugins: [solid()], logLevel: "info" };\n',
	);
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: { jsx: "preserve", jsxImportSource: "solid-js" },
		}),
	);

	console.log("installing packed tarball ...");
	run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir);
	console.log("building consumer ...");
	const build = execFileSync("npx", ["vite", "build"], {
		cwd: dir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const out = build;
	if (/IMPORT_IS_UNDEFINED|\[warn|warning/i.test(out))
		throw new Error(`consumer build warned:\n${out}`);

	const dist = join(dir, "dist");
	const types = {
		".html": "text/html",
		".js": "text/javascript",
		".css": "text/css",
		".ttf": "font/ttf",
		".woff2": "font/woff2",
	};
	server = createServer((req, res) => {
		const p = normalize(
			decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname),
		);
		try {
			const f = join(dist, p.endsWith("/") ? `${p}index.html` : p);
			if (!f.startsWith(dist)) throw new Error("outside");
			res
				.writeHead(200, {
					"content-type": types[extname(f)] ?? "application/octet-stream",
				})
				.end(readFileSync(f));
		} catch {
			res.writeHead(404).end();
		}
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const url = `http://127.0.0.1:${server.address().port}/`;

	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		const problems = [];
		page.on(
			"console",
			(m) =>
				["error", "warning"].includes(m.type()) &&
				problems.push(`console.${m.type()}: ${m.text()}`),
		);
		page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
		page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()}`));
		page.on(
			"response",
			(r) =>
				r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`),
		);
		await page.goto(url);
		await page.waitForFunction(() => window.__smoke?.ready === true, null, {
			timeout: 15000,
		});
		await page.waitForTimeout(500);
		const measure = () => {
			const lit = (sel) => {
				const c = document.querySelector(`${sel} canvas`);
				if (!c) return -1;
				const copy = document.createElement("canvas");
				copy.width = c.width;
				copy.height = c.height;
				const cx = copy.getContext("2d", { willReadFrequently: true });
				cx.drawImage(c, 0, 0);
				const d = cx.getImageData(0, 0, c.width, c.height).data;
				let n = 0;
				// Count pixels differing from the corner (the background).
				for (let i = 0; i < d.length; i += 4)
					if (
						d[i] !== d[0] ||
						d[i + 1] !== d[1] ||
						d[i + 2] !== d[2] ||
						d[i + 3] !== d[3]
					)
						n++;
				return n;
			};
			return {
				...window.__smoke,
				morphPixels: lit("#morph"),
				mathPixels: lit("#math"),
			};
		};
		// `ready()` resolves before the first paint of the formula; poll for ink.
		await page
			.waitForFunction(`(${measure})().mathPixels > 0`, null, {
				timeout: 10000,
			})
			.catch(() => {});
		const info = await page.evaluate(measure);
		console.log(JSON.stringify(info));
		for (const [k, n] of Object.entries(info.counts))
			if (n === 0) problems.push(`entry ${k} has no exports`);
		if (info.directMorphSubpaths < 1)
			problems.push("morphPathData returned nothing");
		if (!(info.morphPixels > 0)) problems.push("morph canvas is blank");
		if (!(info.mathPixels > 0)) problems.push("MathTex canvas is blank");
		if (problems.length) throw new Error(problems.join("\n"));
	} finally {
		await browser.close();
	}
	console.log("consumer smoke: OK");
} catch (e) {
	failed = true;
	console.error(
		`consumer smoke: FAILED\n${e.stderr ? `${e.stderr}\n` : ""}${e.message}`,
	);
} finally {
	server?.close();
	rmSync(work, { recursive: true, force: true });
	for (const name of PACKAGES)
		rmSync(join(root, "packages", name, "dist"), {
			recursive: true,
			force: true,
		});
}
process.exit(failed ? 1 : 0);
