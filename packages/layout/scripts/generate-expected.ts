/**
 * Records what Chrome lays out for every fixture.
 *
 * Each `test/fixtures/<name>.ts` module exports `fixtures`. This script turns
 * each fixture into HTML (every element `display: flex` and border-box, the
 * root absolutely positioned in a viewport of the fixture's `available`
 * size), opens it in Playwright's Chromium, reads every element's border box
 * relative to its parent's, and writes `test/fixtures/<name>.expected.json`.
 *
 * Run it after adding or changing a fixture: `pnpm --filter @sophistry/layout fixtures`.
 * The tests themselves never need a browser.
 */

import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import type { Edges, LayoutStyle } from "../src/index.ts";
import type { ExpectedBox, Fixture, FixtureNode } from "../test/fixture.ts";

const directory = fileURLToPath(new URL("../test/fixtures/", import.meta.url));

const kebab = (name: string) =>
	name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const length = (value: number | string) =>
	typeof value === "number" ? `${value}px` : value;

/** Inline CSS for a style. */
function css(style: LayoutStyle = {}): string {
	const out: string[] = [];
	const edges = (
		prefix: string,
		suffix: string,
		value: Partial<Edges<number | string>> | undefined,
	) => {
		if (!value) return;
		for (const side of ["top", "right", "bottom", "left"] as const) {
			const v = value[side];
			if (v !== undefined) out.push(`${prefix}-${side}${suffix}: ${length(v)}`);
		}
	};
	for (const [key, value] of Object.entries(style)) {
		if (value === undefined) continue;
		switch (key) {
			case "margin":
				edges("margin", "", value);
				break;
			case "padding":
				edges("padding", "", value);
				break;
			case "border":
				edges("border", "-width", value);
				break;
			case "aspectRatio":
			case "flexGrow":
			case "flexShrink":
				out.push(`${kebab(key)}: ${value}`);
				break;
			default:
				out.push(
					`${kebab(key)}: ${typeof value === "number" ? `${value}px` : value}`,
				);
		}
	}
	return out.join("; ");
}

function html(node: FixtureNode): string {
	if (node.words) {
		const inline = node.words
			.map(
				([w, h]) =>
					`<span style="display:inline-block;vertical-align:top;width:${w}px;height:${h}px"></span>`,
			)
			// A zero-width space between words is a break opportunity of no width.
			.join("&#8203;");
		return `<div class="words" style="${css(node.style)}">${inline}</div>`;
	}
	const children = (node.children ?? []).map(html).join("");
	return `<div style="${css(node.style)}">${children}</div>`;
}

const PAGE_STYLE = `
* { box-sizing: border-box; }
body { margin: 0; }
.viewport { position: relative; display: block; }
.viewport > div { position: absolute; left: 0; top: 0; }
div { display: flex; position: relative; border: 0 solid transparent; }
.words { display: block; font-size: 0; line-height: 0; }
`;

async function main() {
	const files = readdirSync(directory).filter(
		(file) => file.endsWith(".ts") && !file.endsWith(".d.ts"),
	);
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		for (const file of files) {
			const module = (await import(
				pathToFileURL(join(directory, file)).href
			)) as {
				fixtures: Fixture[];
			};
			const result: Record<string, ExpectedBox> = {};
			for (const fixture of module.fixtures) {
				const available = fixture.available ?? { width: 1000, height: 1000 };
				// Words leaves keep their style but must stay block containers.
				const root = html(fixture.root);
				await page.setContent(
					`<!doctype html><style>${PAGE_STYLE}</style><div class="viewport" style="width:${available.width}px;height:${available.height}px">${root}</div>`,
				);
				result[fixture.name] = await page.evaluate(() => {
					type Box = {
						x: number;
						y: number;
						width: number;
						height: number;
						children: Box[];
					};
					const zero = (element: Element): Box => ({
						x: 0,
						y: 0,
						width: 0,
						height: 0,
						children: element.classList.contains("words")
							? []
							: [...element.children].map(zero),
					});
					const read = (element: Element, parent: DOMRect | null): Box => {
						if (getComputedStyle(element).display === "none")
							return zero(element);
						const rect = element.getBoundingClientRect();
						return {
							x: parent ? rect.left - parent.left : rect.left,
							y: parent ? rect.top - parent.top : rect.top,
							width: rect.width,
							height: rect.height,
							children: element.classList.contains("words")
								? []
								: [...element.children].map((child) => read(child, rect)),
						};
					};
					const root = document.querySelector(".viewport > div") as Element;
					return read(root, null);
				});
			}
			const target = join(directory, file.replace(/\.ts$/, ".expected.json"));
			writeFileSync(target, `${JSON.stringify(result, null, "\t")}\n`);
			console.log(`${file}: ${module.fixtures.length} fixtures`);
		}
	} finally {
		await browser.close();
	}
}

await main();
