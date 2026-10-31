/**
 * A drift guard for `interact/`'s `hasInteraction`.
 *
 * `hasInteraction` (`interact/types.ts`) is a hand-maintained
 * 21-way `!== undefined` chain that gates whether a node bothers to register
 * for interaction at all — see `shape.ts`'s `props.ref` branch for the sibling
 * gate this mirrors. The bug this test exists to catch has no symptom at the
 * call site: add a new field to `InteractionProps` (or `InteractionHandlers`)
 * without adding a line to that chain, and a scene using only the new prop
 * silently never registers — no error, no warning, just a shape that doesn't
 * respond to a pointer.
 *
 * This cannot fix the chain (nor turn it into something structurally
 * exhaustive, which would be the real fix — e.g. deriving it from `Object.keys` at the call site instead
 * of a literal `!== undefined` per field). What it *can* do is fail loudly the
 * next time the two drift: `sample` below is typed `Required<InteractionProps>`,
 * so TypeScript itself refuses to compile this file if `InteractionProps`
 * gains a field this object doesn't supply a value for — turning "a scene
 * silently stops responding" into "the test suite doesn't build."
 */

import { describe, expect, it } from "vitest";
import type { InteractionProps } from "./types";
import { hasInteraction } from "./types";

const noop = () => {};

/**
 * One concrete, non-`undefined` value per `InteractionProps` field. The
 * `Required<...>` annotation is the drift guard: if `InteractionProps` gains a
 * field (directly, or by adding one to `InteractionHandlers`, which it
 * extends) without this file being updated, this literal fails to typecheck.
 */
const sample: Required<InteractionProps> = {
	pointerEvents: "painted",
	hitArea: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
	cursor: "pointer",
	label: "a node",
	role: "button",
	pressed: false,
	focusable: true,
	onPointerDown: noop,
	onPointerMove: noop,
	onPointerUp: noop,
	onTap: noop,
	onDoubleTap: noop,
	onLongPress: noop,
	onContextMenu: noop,
	onWheel: noop,
	onEnter: noop,
	onLeave: noop,
	hover: noop,
	drag: { start: () => true, move: noop, end: noop },
	keyboard: { nudge: noop },
	drop: {},
	itemLabel: () => "",
};

describe("hasInteraction drift guard", () => {
	it("has no undetected InteractionProps field", () => {
		// The `Required<InteractionProps>` type check above is the real guard;
		// this just asserts the runtime key list it produces is non-empty, so a
		// future refactor that hollows `sample` out to `{}` (still typechecking,
		// if every field somehow became optional-away) doesn't pass silently.
		expect(Object.keys(sample).length).toBeGreaterThan(0);
	});

	it("responds to every InteractionProps field individually", () => {
		for (const key of Object.keys(sample) as (keyof InteractionProps)[]) {
			const props = { [key]: sample[key] } as InteractionProps;
			expect(
				hasInteraction(props),
				`hasInteraction ignored "${key}" — update the chain in src/interact/types.ts`,
			).toBe(true);
		}
	});

	it("is false when nothing is set", () => {
		expect(hasInteraction({})).toBe(false);
	});
});
