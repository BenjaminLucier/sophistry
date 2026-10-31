/**
 * Renders public/og.png (1200x630) from the mark data written by
 * make-brand.mjs. Needs Playwright with a Chromium available; it is not a
 * docs dependency, so point NODE_PATH at an install:
 *
 *   node docs/scripts/make-brand.mjs
 *   NODE_PATH=/path/to/node_modules node docs/scripts/make-og.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(import.meta.url)("playwright");
const { full, drawn, tx, ty, mocha } = JSON.parse(
	readFileSync(resolve(root, "scripts/mark-parts.json"), "utf8"),
);

const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:${mocha.base};
font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Helvetica,Arial,sans-serif;color:${mocha.text};
display:flex;align-items:center;gap:56px;padding:0 96px;overflow:hidden;position:relative}
.glow{position:absolute;inset:0;background:radial-gradient(520px 420px at 24% 50%,rgba(203,166,247,.22),transparent 70%),radial-gradient(500px 300px at 100% 100%,rgba(203,166,247,.10),transparent 70%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(${mocha.surface0} 1px,transparent 1px),linear-gradient(90deg,${mocha.surface0} 1px,transparent 1px);background-size:60px 60px;opacity:.35;mask-image:radial-gradient(600px 400px at 24% 50%,#000,transparent)}
svg{width:360px;height:360px;flex:none;position:relative}
.t{position:relative}h1{margin:0;font-size:116px;letter-spacing:-.04em;line-height:1;font-weight:750}
p{margin:22px 0 0;font-size:34px;line-height:1.3;color:${mocha.subtext1};max-width:640px}
.pill{display:inline-block;margin-top:34px;padding:10px 22px;border:1px solid ${mocha.surface2};border-radius:999px;font:500 24px ui-monospace,Menlo,monospace;color:${mocha.mauve}}
</style><div class="glow"></div><div class="grid"></div>
<svg viewBox="0 0 64 64" fill="none"><path d="${full}" stroke="${mocha.mauve}" stroke-opacity=".28" stroke-width="1.4"/><path d="${drawn}" stroke="${mocha.mauve}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${tx}" cy="${ty}" r="3" fill="${mocha.mauve}"/><circle cx="${tx}" cy="${ty}" r="1.2" fill="${mocha.base}"/></svg>
<div class="t"><h1>sophistry</h1><p>Controllable Manim-for-the-web<br>for SolidJS and React.</p><span class="pill">@sophistry/core</span></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: resolve(root, "public/og.png") });
await browser.close();
console.log("wrote public/og.png");
