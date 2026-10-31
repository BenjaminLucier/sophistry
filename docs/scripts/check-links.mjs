// Checks every internal link and #anchor in the built site (docs/dist).
//
//   pnpm --filter @sophistry/docs build
//   pnpm --filter @sophistry/docs check:links
//
// For each `<a href>` in every HTML file: a path must resolve to a built file
// (`/x/` -> `x/index.html`), and a `#fragment` must match an `id` (or `name`)
// in the target page. External links (http, mailto, ...) are not fetched.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	process.argv[2] ?? "dist",
);
if (!existsSync(dist)) {
	console.error(`No build output at ${dist}; run the docs build first.`);
	process.exit(2);
}

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			// The prerender bundle is build scratch, not site output.
			if (name === ".prerender") continue;
			yield* walk(path);
		} else if (name.endsWith(".html")) yield path;
	}
}

const idCache = new Map();
function idsOf(file) {
	let ids = idCache.get(file);
	if (!ids) {
		const html = readFileSync(file, "utf8");
		ids = new Set();
		for (const m of html.matchAll(
			/\s(?:id|name)=("([^"]*)"|'([^']*)'|([^\s>]+))/g,
		))
			ids.add(m[2] ?? m[3] ?? m[4]);
		idCache.set(file, ids);
	}
	return ids;
}

/** The built file a site path points at, or undefined. */
function target(pathname) {
	const clean = decodeURIComponent(pathname);
	const base = join(dist, clean);
	for (const candidate of [
		clean.endsWith("/") ? join(base, "index.html") : base,
		join(base, "index.html"),
		`${base}.html`,
	]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return undefined;
}

const problems = [];
let checked = 0;
for (const file of walk(dist)) {
	const html = readFileSync(file, "utf8");
	const page = `/${relative(dist, file).replace(/index\.html$/, "")}`;
	for (const m of html.matchAll(/<a\s[^>]*?href=("([^"]*)"|'([^']*)')/g)) {
		const href = (m[2] ?? m[3]).replaceAll("&amp;", "&");
		if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue; // external
		const [withoutHash, fragment] = href.split("#", 2);
		const [pathPart] = withoutHash.split("?", 1);
		const abs = pathPart === "" ? page : posix.resolve(page, pathPart);
		// posix.resolve drops the trailing slash; restore it for directories.
		const withSlash =
			pathPart.endsWith("/") && !abs.endsWith("/") ? `${abs}/` : abs;
		checked++;
		const dest = target(withSlash);
		if (!dest) {
			problems.push(`${page}: ${href} -> no such page`);
			continue;
		}
		if (
			fragment &&
			fragment !== "top" &&
			!idsOf(dest).has(decodeURIComponent(fragment))
		) {
			problems.push(
				`${page}: ${href} -> no #${fragment} in ${relative(dist, dest)}`,
			);
		}
	}
}

if (problems.length) {
	console.error(problems.join("\n"));
	console.error(`\n${problems.length} broken link(s) of ${checked} checked.`);
	process.exit(1);
}
console.log(`${checked} internal links checked: ok`);
