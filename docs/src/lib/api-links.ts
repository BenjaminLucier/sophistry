/**
 * Resolves an exported API name ("Circle", "draw") to the URL of its page in
 * the reference that starlight-typedoc generates into `content/docs/api/`.
 *
 * The generated layout is `api/<module>/<kind>/<lowercased name>/`, where the
 * module is the TypeDoc `@module` name of the entry point
 * (`@sophistry/core`, `@sophistry/solidjs/charts`, ...) with
 * Starlight's slugging applied (`@` dropped), e.g.
 * `/api/sophistry/core/functions/draw/`. A name that collides with
 * another only by case gets a `-1` suffix. That directory is written by the
 * starlight integration's `config:setup` hook, i.e. before Vite starts and
 * before any page renders — in `astro build` and `astro dev` alike — so a
 * root-relative `import.meta.glob` (keys only, nothing is loaded) sees it.
 */

const pages = import.meta.glob("/src/content/docs/api/**/*.md");

/** Lower is better: a function/variable/class page beats an interface or type. */
const KIND_RANK: Record<string, number> = {
	functions: 0,
	variables: 0,
	classes: 0,
	interfaces: 1,
	"type-aliases": 1,
};
/**
 * Which entry wins when several export the same name: the core, then the
 * Solid binding (the gallery's examples are Solid), then the feature packages
 * with their binding subpaths, then the maths entries, React last (its
 * `Stage`, hooks and components share the Solid ones' names).
 */
const ENTRY_RANK: Record<string, number> = {
	"@sophistry/core": 0,
	"@sophistry/solidjs": 1,
	"@sophistry/charts": 2,
	"@sophistry/solidjs/charts": 3,
	"@sophistry/text": 4,
	"@sophistry/solidjs/text": 5,
	"@sophistry/3d": 6,
	"@sophistry/solidjs/3d": 7,
	"@sophistry/charts/3d": 8,
	"@sophistry/solidjs/charts/3d": 9,
	"@sophistry/core/geometry": 10,
	"@sophistry/core/color": 11,
	"@sophistry/core/themes": 12,
	"@sophistry/react": 13,
};

interface Hit {
	url: string;
	rank: number;
}

let table: Map<string, Hit> | undefined;

function build(): Map<string, Hit> {
	const map = new Map<string, Hit>();
	const prefix = "/src/content/docs/api/";
	for (const key of Object.keys(pages)) {
		const parts = key.slice(prefix.length).replace(/\.md$/, "").split("/");
		// <module segments...>/<kind>/<name>; README.md, modules.md and the
		// module READMEs have no kind directory and are skipped.
		if (parts.length < 3) continue;
		const name = parts[parts.length - 1] as string;
		const kind = parts[parts.length - 2] as string;
		const moduleDir = parts.slice(0, -2);
		const kindRank = KIND_RANK[kind];
		if (kindRank === undefined) continue;
		const rank = kindRank * 100 + (ENTRY_RANK[moduleDir.join("/")] ?? 99);
		const dir = moduleDir
			.map((p) => p.replace(/^@/, "").toLowerCase())
			.join("/");
		const hit = { url: `/api/${dir}/${kind}/${name.toLowerCase()}/`, rank };
		// TypeDoc writes `Name-1.md` when another symbol has already claimed the
		// case-insensitive file name; identifiers cannot contain `-`, so the
		// suffix is safe to strip.
		const symbol = name.replace(/-\d+$/, "");
		const existing = map.get(symbol);
		if (!existing || rank < existing.rank) map.set(symbol, hit);
	}
	if (map.size === 0) {
		throw new Error(
			"api-links: no generated API pages found under docs/src/content/docs/api. " +
				"They are written by starlight-typedoc when Astro starts; run the docs " +
				"through `pnpm --filter @sophistry/docs build` (or `dev`), not a bare script.",
		);
	}
	return map;
}

/** The API page URL for `name`, or `undefined` if the reference has none. */
export function apiUrl(name: string): string | undefined {
	table ??= build();
	return table.get(name)?.url;
}

/**
 * Like {@link apiUrl} but for example `meta.uses`: an unknown name throws, so a
 * renamed or mistyped export fails the build instead of rotting silently.
 */
export function requireApiUrl(name: string, example: string): string {
	const url = apiUrl(name);
	if (!url) {
		throw new Error(
			`Example "${example}": meta.uses lists "${name}", which has no generated API page. ` +
				"Fix the name or remove it from `uses`.",
		);
	}
	return url;
}
