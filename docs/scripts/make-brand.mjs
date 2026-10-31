/**
 * Generates the brand SVGs in `public/` using sophistry's own geometry:
 * the mark is an epicycle trace, arc-length measured and revealed to 80% with
 * `measure` / `sliceAtT` / `pointAtT` / `toPathData` — the same primitives
 * that power `draw()`. Colours are the library's Catppuccin Mauve.
 *
 *   node docs/scripts/make-brand.mjs
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "../packages/core/src");

// `vite` is astro's dependency, not ours: resolve it through astro.
const fromAstro = createRequire(
	createRequire(import.meta.url).resolve("astro/package.json"),
);
const { createServer } = await import(
	pathToFileURL(fromAstro.resolve("vite")).href
);

const server = await createServer({
	root,
	configFile: false,
	appType: "custom",
	logLevel: "silent",
	server: { middlewareMode: true },
});
const path = await server.ssrLoadModule(`${src}/geometry/path.ts`);
const themes = await server.ssrLoadModule(`${src}/themes/catppuccin.ts`);
await server.close();

const { mocha, latte } = themes.catppuccin;

// Epicycles: a unit circle carrying a smaller one spinning the other way.
const N = 720;
const raw = [];
for (let i = 0; i <= N; i++) {
	const t = (i / N) * Math.PI * 2;
	raw.push({
		x: Math.cos(t) + 0.55 * Math.cos(-4 * t),
		y: Math.sin(t) + 0.55 * Math.sin(-4 * t),
	});
}
// Fit into a 64x64 box (padding 9) with y flipped to screen space.
const S = 64;
const pad = 6;
const k = (S / 2 - pad) / 1.55;
const pts = raw.map((p) => ({
	x: +(S / 2 + p.x * k).toFixed(2),
	y: +(S / 2 - p.y * k).toFixed(2),
}));
const table = path.measure(pts);
const REVEAL = 0.8;
const drawn = path.toPathData(path.sliceAtT(table, REVEAL));
const full = path.toPathData(pts, true);
const tip = path.pointAtT(table, REVEAL);
const tx = tip.x.toFixed(2);
const ty = tip.y.toFixed(2);

const mark = (accent, ghost, ink) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" fill="none">` +
	`<path d="${full}" stroke="${ghost}" stroke-opacity=".28" stroke-width="2.2" stroke-linejoin="round"/>` +
	`<path d="${drawn}" stroke="${accent}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>` +
	`<circle cx="${tx}" cy="${ty}" r="4.6" fill="${accent}"/>` +
	`<circle cx="${tx}" cy="${ty}" r="1.8" fill="${ink}"/></svg>\n`;

const out = (name, svg) => writeFileSync(resolve(root, "public", name), svg);
// Dark UI wants Mocha mauve; light UI wants Latte mauve.
out("logo-dark.svg", mark(mocha.mauve, mocha.mauve, mocha.base));
out("logo-light.svg", mark(latte.mauve, latte.mauve, latte.base));

// Favicon: rounded tile so it reads on any browser chrome.
const inner = mark(mocha.mauve, mocha.mauve, mocha.base)
	.replace(/^<svg[^>]*>/, "")
	.replace("</svg>\n", "");
out(
	"favicon.svg",
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"><rect width="${S}" height="${S}" rx="14" fill="${mocha.base}"/><g transform="translate(6 6) scale(.8125)" fill="none">${inner}</g></svg>\n`,
);
// Shared with the OG card builder.
writeFileSync(
	resolve(root, "scripts/mark-parts.json"),
	JSON.stringify({ full, drawn, tx, ty, S, mocha, latte }, null, 1),
);
console.log("wrote logo-dark.svg, logo-light.svg, favicon.svg");
