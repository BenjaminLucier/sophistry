// Renders the repository's ROADMAP.md into docs/src/content/docs/project/roadmap.mdx
// (the docs page is generated; edit ROADMAP.md instead).
//
//   node docs/scripts/sync-roadmap.mjs          write the page
//   node docs/scripts/sync-roadmap.mjs --check  fail if the page is out of date
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "docs/src/content/docs/project/roadmap.mdx");
const GITHUB = "https://github.com/BenjaminLucier/sophistry/blob/main/";

export function render() {
	let body = readFileSync(resolve(root, "ROADMAP.md"), "utf8")
		.split("\n")
		.slice(2) // the "# Roadmap" title and its blank line
		.join("\n")
		.replaceAll(
			"(https://sophistry.dev/project/stability/)",
			"(/project/stability/)",
		)
		// Relative repository links become GitHub links.
		.replace(/\]\((?!https?:|\/|#)([^)]+)\)/g, `](${GITHUB}$1)`)
		.trimEnd();
	body +=
		"\n\n## Next steps\n\n- [Stability and versioning](/project/stability/)\n" +
		"- [Performance](/project/performance/), including today's limits at tens of thousands of nodes\n" +
		`- [Contributing](${GITHUB}CONTRIBUTING.md)\n`;
	return `---\ntitle: "Roadmap"\ndescription: "Where sophistry is headed, and what is deliberately out of scope."\n---\n\n${body}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const next = render();
	if (process.argv.includes("--check")) {
		if (readFileSync(target, "utf8") !== next) {
			console.error(
				"roadmap.mdx is out of date: run `pnpm --filter @sophistry/docs sync:roadmap`",
			);
			process.exit(1);
		}
	} else writeFileSync(target, next);
}
