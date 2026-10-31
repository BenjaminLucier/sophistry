// Fails when the Playwright container image CI runs in and the installed
// @playwright/test drift apart.
//
//   node scripts/check-playwright-image.mjs   # or: pnpm check:playwright
//
// The gallery baselines (e2e/__screenshots__/gallery) are rendered in
// mcr.microsoft.com/playwright:v<version>-noble, whose browsers must be the
// ones the installed @playwright/test drives: scripts/e2e-visual.mjs derives
// its tag from the installed version, but .github/workflows/ci.yml names it
// by hand. This checks, with no dependencies and no network:
//
// - the root package.json pins @playwright/test to an exact version (a range
//   would let the lockfile move under a fixed image tag);
// - pnpm-lock.yaml resolves @playwright/test, playwright and playwright-core
//   to that version and no other;
// - every mcr.microsoft.com/playwright image in .github/workflows is tagged
//   v<that version>-<distro>;
// - the installed node_modules/@playwright/test, when present, is that version.
//
// CI's `check` job runs it. When you bump Playwright, change the version in
// package.json, run `pnpm install`, update the image tag in ci.yml, and
// regenerate the baselines (`pnpm test:e2e:update`).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const problems = [];

const spec = JSON.parse(read("package.json")).devDependencies?.[
	"@playwright/test"
];
if (!spec) {
	console.error(
		"check-playwright-image: no @playwright/test in package.json devDependencies",
	);
	process.exit(1);
}
if (!/^\d+\.\d+\.\d+$/.test(spec)) {
	problems.push(
		`package.json pins @playwright/test to "${spec}"; pin an exact version (the CI image tag cannot follow a range)`,
	);
}
const version = spec.replace(/^[\^~=v]+/, "");

// Every resolved version of the three packages, from the lockfile's keys
// ("  playwright@1.64.1:", "  '@playwright/test@1.64.1':").
const lock = read("pnpm-lock.yaml");
const resolved = new Map();
for (const match of lock.matchAll(
	/^ {2}'?(@playwright\/test|playwright|playwright-core)@(\d+\.\d+\.\d+[^':(\s]*)/gm,
)) {
	const [, name, at] = match;
	if (!resolved.has(name)) resolved.set(name, new Set());
	resolved.get(name).add(at);
}
if (!resolved.has("@playwright/test")) {
	problems.push("pnpm-lock.yaml resolves no @playwright/test");
}
for (const [name, versions] of resolved) {
	const other = [...versions].filter((v) => v !== version);
	if (other.length > 0) {
		problems.push(
			`pnpm-lock.yaml resolves ${name} to ${[...versions].join(", ")}, not only ${version}`,
		);
	}
}

const workflows = join(root, ".github/workflows");
let images = 0;
for (const file of readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f))) {
	const text = readFileSync(join(workflows, file), "utf8");
	for (const match of text.matchAll(
		/mcr\.microsoft\.com\/playwright(?::([^\s"'@]+))?/g,
	)) {
		images++;
		const tag = match[1];
		const want = new RegExp(`^v${version.replaceAll(".", "\\.")}-[a-z]+$`);
		if (!tag || !want.test(tag)) {
			problems.push(
				`.github/workflows/${file} runs ${match[0]}; expected the tag v${version}-<distro> (e.g. v${version}-noble)`,
			);
		}
	}
}
if (images === 0) {
	problems.push(
		"no mcr.microsoft.com/playwright image in .github/workflows; the e2e job should run in one",
	);
}

const installed = join(root, "node_modules/@playwright/test/package.json");
if (existsSync(installed)) {
	const { version: have } = JSON.parse(readFileSync(installed, "utf8"));
	if (have !== version) {
		problems.push(
			`node_modules has @playwright/test ${have}, package.json pins ${version}; run pnpm install`,
		);
	}
}

if (problems.length > 0) {
	console.error(
		"check-playwright-image: the Playwright versions drifted apart:",
	);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
console.log(
	`check-playwright-image: @playwright/test ${version}, its lockfile entries and ${images} CI image tag(s) agree`,
);
