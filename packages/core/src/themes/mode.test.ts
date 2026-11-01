import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `mode.ts` reads the DOM at module load, so each test installs a fake browser
 * first and imports a fresh copy.
 */
function installFakeBrowser(
	options: { dataset?: Record<string, string>; systemDark?: boolean } = {},
) {
	const dataset: Record<string, string> = { ...options.dataset };
	const meta = {
		content: "",
		setAttribute(_: string, v: string) {
			this.content = v;
		},
	};
	const store = new Map<string, string>();
	let observer: (() => void) | undefined;
	const listeners: Array<() => void> = [];
	vi.stubGlobal("document", {
		documentElement: { dataset },
		querySelector: (selector: string) =>
			selector.includes("theme-color") ? meta : null,
	});
	vi.stubGlobal(
		"MutationObserver",
		class {
			constructor(cb: () => void) {
				observer = cb;
			}
			observe() {}
		},
	);
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
	});
	const mq = {
		matches: options.systemDark ?? true,
		addEventListener: (_: string, fn: () => void) => void listeners.push(fn),
	};
	vi.stubGlobal("matchMedia", () => mq);
	return {
		dataset,
		meta,
		store,
		mq,
		flush: () => observer?.(),
		osChange: () => {
			for (const fn of listeners) fn();
		},
	};
}

async function load() {
	vi.resetModules();
	return import("./index.js");
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("colour mode", () => {
	it("defaults to dark with no DOM", async () => {
		const m = await load();
		expect(m.colorMode()).toBe("dark");
		expect(m.modePreference()).toBe("dark");
	});

	it("defaults to dark when <html> carries no data-mode", async () => {
		installFakeBrowser();
		const m = await load();
		expect(m.colorMode()).toBe("dark");
	});

	it("reads data-mode / data-pref from <html>", async () => {
		installFakeBrowser({ dataset: { mode: "light", pref: "system" } });
		const m = await load();
		expect(m.colorMode()).toBe("light");
		expect(m.modePreference()).toBe("system");
	});

	it("follows the attribute when it changes", async () => {
		const env = installFakeBrowser({ dataset: { mode: "dark", pref: "dark" } });
		const m = await load();
		expect(m.colorMode()).toBe("dark");
		env.dataset.mode = "light";
		env.dataset.pref = "light";
		env.flush();
		expect(m.colorMode()).toBe("light");
		expect(m.modePreference()).toBe("light");
	});

	it("notifies subscribers of the Readables when the attribute changes", async () => {
		const env = installFakeBrowser({ dataset: { mode: "dark", pref: "dark" } });
		const m = await load();
		const modes: string[] = [];
		const preferences: string[] = [];
		const stopMode = m.colorModeReadable.subscribe(() =>
			modes.push(m.colorModeReadable.peek()),
		);
		const stopPreference = m.modePreferenceReadable.subscribe(() =>
			preferences.push(m.modePreferenceReadable.peek()),
		);
		env.dataset.mode = "light";
		env.dataset.pref = "system";
		env.flush();
		expect(modes).toEqual(["light"]);
		expect(preferences).toEqual(["system"]);
		// An unchanged attribute does not notify.
		env.flush();
		expect(modes).toEqual(["light"]);
		stopMode();
		stopPreference();
		env.dataset.mode = "dark";
		env.flush();
		expect(modes).toEqual(["light"]);
	});

	it("notifies subscribers when a setter applies a preference, with no DOM", async () => {
		const m = await load();
		const modes: string[] = [];
		m.colorModeReadable.subscribe(() => modes.push(m.colorModeReadable.peek()));
		m.setModePreference("light");
		expect(modes).toEqual(["light"]);
		expect(m.colorMode()).toBe("light");
		expect(m.modePreference()).toBe("light");
	});

	it("feeds resolveTheme, so a stage follows the page", async () => {
		const env = installFakeBrowser({ dataset: { mode: "dark" } });
		const m = await load();
		expect(m.resolveTheme().palette.background).toBe(m.catppuccin.mocha.base);
		env.dataset.mode = "light";
		env.flush();
		expect(m.resolveTheme().palette.background).toBe(m.catppuccin.latte.base);
	});
});

describe("setModePreference", () => {
	it("stores, applies, and syncs theme-color from the palette", async () => {
		const env = installFakeBrowser();
		const m = await load();
		m.setModePreference("light");
		expect(env.store.get("theme-pref")).toBe("light");
		expect(env.dataset.mode).toBe("light");
		expect(env.dataset.pref).toBe("light");
		expect(env.meta.content).toBe(m.catppuccin.latte.base);
	});

	it("resolves system through matchMedia", async () => {
		const env = installFakeBrowser({ systemDark: false });
		const m = await load();
		m.setModePreference("system");
		expect(env.dataset.pref).toBe("system");
		expect(env.dataset.mode).toBe("light");
	});

	it("cycles system → light → dark → system", async () => {
		installFakeBrowser({ dataset: { pref: "system", mode: "dark" } });
		const m = await load();
		expect(m.cycleModePreference()).toBe("light");
		expect(m.cycleModePreference()).toBe("dark");
		expect(m.cycleModePreference()).toBe("system");
	});
});

describe("themeInitScript", () => {
	function run(script: string, env: ReturnType<typeof installFakeBrowser>) {
		new Function(script)();
		return env;
	}

	it("applies the stored preference and theme-color before paint", async () => {
		const env = installFakeBrowser();
		env.store.set("theme-pref", "light");
		const m = await load();
		run(m.themeInitScript(), env);
		expect(env.dataset.mode).toBe("light");
		expect(env.dataset.pref).toBe("light");
		expect(env.meta.content).toBe(m.catppuccin.latte.base);
	});

	it("falls back to dark with nothing stored", async () => {
		const env = installFakeBrowser();
		const m = await load();
		run(m.themeInitScript(), env);
		expect(env.dataset.mode).toBe("dark");
		expect(env.meta.content).toBe(m.catppuccin.mocha.base);
	});

	it("follows the OS while the preference is system", async () => {
		const env = installFakeBrowser({ systemDark: true });
		env.store.set("theme-pref", "system");
		const m = await load();
		run(m.themeInitScript(), env);
		expect(env.dataset.mode).toBe("dark");
		env.mq.matches = false;
		env.osChange();
		expect(env.dataset.mode).toBe("light");
	});

	it("swallows blocked storage and leaves the HTML default alone", async () => {
		const env = installFakeBrowser({ dataset: { mode: "dark" } });
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("blocked");
			},
		});
		const m = await load();
		expect(() => run(m.themeInitScript(), env)).not.toThrow();
		expect(env.dataset.mode).toBe("dark");
	});

	it("honours a custom storage key", async () => {
		const env = installFakeBrowser();
		env.store.set("my-key", "light");
		const m = await load();
		run(m.themeInitScript({ storageKey: "my-key" }), env);
		expect(env.dataset.mode).toBe("light");
	});
});

describe("mode hardening", () => {
	it("cycleModePreference advances from the in-memory preference, not the DOM", async () => {
		const env = installFakeBrowser({
			dataset: { pref: "system", mode: "dark" },
		});
		const m = await load();
		env.dataset.pref = "dark"; // stale DOM edit with no observer flush
		expect(m.cycleModePreference()).toBe("light");
	});

	it("installColorMode is idempotent and returns a disposer", async () => {
		const env = installFakeBrowser();
		const removed: Array<() => void> = [];
		(
			env.mq as unknown as {
				removeEventListener: (_: string, fn: () => void) => void;
			}
		).removeEventListener = (_, fn) => void removed.push(fn);
		const m = await load();
		const dispose1 = m.installColorMode();
		m.installColorMode();
		expect(removed).toHaveLength(1);
		dispose1();
	});

	it("themeInitScript ignores an unrecognised stored value", async () => {
		const env = installFakeBrowser();
		env.store.set("theme-pref", "bogus");
		const m = await load();
		new Function(m.themeInitScript())();
		expect(env.dataset.pref).toBe("dark");
		expect(env.dataset.mode).toBe("dark");
	});

	it("installColorMode remembers the palette and key for later setters", async () => {
		const env = installFakeBrowser();
		const m = await load();
		const brand = m.definePalette({
			name: "brand",
			light: {
				background: "#ffeedd",
				foreground: "#000000",
				accent: "#ff0000",
			},
			dark: { background: "#112233", foreground: "#ffffff", accent: "#00ff00" },
		});
		m.installColorMode({ palette: brand, storageKey: "k" });
		m.setModePreference("light");
		expect(env.meta.content).toBe(m.resolvePalette(brand).light.background);
		expect(env.store.get("k")).toBe("light");
		expect(m.cycleModePreference()).toBe("dark");
		expect(env.meta.content).toBe(m.resolvePalette(brand).dark.background);
		expect(env.store.get("k")).toBe("dark");
		// A per-call key wins; the palette is still the remembered one.
		m.setModePreference("light", { storageKey: "other" });
		expect(env.store.get("other")).toBe("light");
		expect(env.meta.content).toBe(m.resolvePalette(brand).light.background);
	});
});
