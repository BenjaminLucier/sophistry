/**
 * `resolveColorRamp` is what widened `<Imshow>`/`<ContourF>`/`<Pcolormesh>`/
 * `<VectorField>`'s `colors` prop from "an explicit stop list, always" to
 * "a stop list, a published colormap's name, or a caller's own ramp
 * function" — see the module doc. These are the three forms plus the
 * omitted case, each checked against what the resolver is documented to do.
 */

import { describe, expect, it } from "vitest";
import { colormaps, resolveColormap } from "../themes";
import { resolveColorRamp } from "./colorRampProp";

const fallback = () => ["#000000", "#ffffff"];

describe("resolveColorRamp", () => {
	it("builds a colorRamp from an explicit stop list", () => {
		const ramp = resolveColorRamp(["#ff0000", "#0000ff"], fallback);
		// `colorRamp` interpolates and reports back in `rgba(...)`; endpoints are
		// exact regardless of interpolation space.
		expect(ramp(0)).toBe("rgba(255, 0, 0, 1)");
		expect(ramp(1)).toBe("rgba(0, 0, 255, 1)");
	});

	it("resolves a colormap name to the published map", () => {
		const ramp = resolveColorRamp("viridis", fallback);
		expect(ramp(0)).toBe(colormaps.viridis(0));
		expect(ramp(1)).toBe(colormaps.viridis(1));
	});

	it("passes a caller's own ramp function through unchanged", () => {
		const custom = (t: number) => `rgb(${Math.round(t * 255)}, 0, 0)`;
		const ramp = resolveColorRamp(custom, fallback);
		expect(ramp).toBe(custom);
		expect(ramp(0.5)).toBe(custom(0.5));
	});

	it("falls back to the caller's default stops only when colors is omitted", () => {
		const ramp = resolveColorRamp(undefined, fallback);
		expect(ramp(0)).toBe("rgba(0, 0, 0, 1)");
		expect(ramp(1)).toBe("rgba(255, 255, 255, 1)");
	});

	it("agrees with resolveColormap directly for the name/function forms", () => {
		expect(resolveColorRamp("magma", fallback)(0.3)).toBe(
			resolveColormap("magma")(0.3),
		);
	});
});
