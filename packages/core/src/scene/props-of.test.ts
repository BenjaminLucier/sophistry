import { describe, expectTypeOf, it } from "vitest";
import type { CircleProps, circle } from "../shapes/circle.js";
import type { group } from "./group.js";
import type { NodeOf, PropsOf } from "./types.js";

// Type-level: `tsc -b` checks these; the runtime assertions are no-ops.
describe("PropsOf", () => {
	it("infers a shape's props through its node and instanceable-key parameters", () => {
		expectTypeOf<PropsOf<typeof circle>>().not.toBeNever();
		expectTypeOf<PropsOf<typeof circle>>().toEqualTypeOf<CircleProps>();
		expectTypeOf<PropsOf<typeof circle>["radius"]>().toEqualTypeOf<number>();
	});

	it("infers a container's props", () => {
		expectTypeOf<PropsOf<typeof group>>().not.toBeNever();
		expectTypeOf<NodeOf<typeof group>>().not.toBeNever();
	});

	it("is never for something that is not a definition", () => {
		expectTypeOf<PropsOf<{ name: string }>>().toBeNever();
	});
});
