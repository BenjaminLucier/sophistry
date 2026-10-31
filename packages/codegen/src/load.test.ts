import { describe, expect, it } from "vitest";
import { loadDefinitions } from "./load.ts";

describe("loadDefinitions", () => {
	it("returns null for a package without a definitions subpath", async () => {
		// `@sophistry/charts/math/definitions` is not an export.
		expect(await loadDefinitions("@sophistry/charts/math")).toBeNull();
	});

	it("reads a feature package's definitions, and a subpath's", async () => {
		const charts = await loadDefinitions("@sophistry/charts");
		expect(charts?.chart?.name).toBe("Chart");
		const charts3d = await loadDefinitions("@sophistry/charts/3d");
		expect(charts3d?.scatter3D?.name).toBe("Scatter3D");
	});

	it("reads core's definitions by export name", async () => {
		const definitions = await loadDefinitions("@sophistry/core");
		expect(definitions?.circle?.name).toBe("Circle");
		expect(definitions?.group?.kind).toBe("primitive");
		expect(Object.keys(definitions ?? {})).not.toContain("track");
	});
});
