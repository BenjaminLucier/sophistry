/**
 * Entry curation: what the root exports, and what stays on `./internal`.
 */

import { describe, expect, it } from "vitest";
import * as root from "../index";
import * as internal from "./internal";

describe("root entry", () => {
	it("exports createPointerChannel", () => {
		expect(typeof root.createPointerChannel).toBe("function");
	});

	it("keeps scene-graph plumbing off the root", () => {
		for (const name of [
			"SceneGraph",
			"SceneRoot",
			"BaseNode",
			"BaseContainer",
			"ANY_CONTEXT",
			"sceneInternals",
			"CompositeNode",
			"GroupNode",
			"InteractionGroupNode",
			"createInteractionRegistry",
		]) {
			expect(name in root, `${name} on the root`).toBe(false);
			expect(name in internal, `${name} on internal`).toBe(true);
		}
	});
});
