/**
 * `wrap`: host types in the catalogue, and the component prop types
 * (checked by `tsc`: the `@ts-expect-error` lines must stay errors).
 */

import type {
	CircleProps,
	circle,
	group,
	Readable,
	SceneNode,
	ShapeNode,
} from "@sophistry/core";
import { circle as circleDefinition, defineComposite } from "@sophistry/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { Circle, Group } from "./generated/core.gen.js";
import { type ComponentProps, wrap } from "./wrap.js";

describe("wrap", () => {
	it("returns a host element type, the same for the same definition", () => {
		expect(Circle as unknown).toBe("sophistry:Circle");
		expect(wrap(circleDefinition)).toBe(Circle);
	});

	it("gives a different definition with the same name its own type", () => {
		const make = () =>
			defineComposite<object>({ name: "Twin", props: {}, setup: () => [] });
		const first = wrap(make()) as unknown;
		const second = wrap(make()) as unknown;
		expect(first).toBe("sophistry:Twin");
		expect(second).toBe("sophistry:Twin#2");
	});

	it("types props from the definition", () => {
		type Props = ComponentProps<typeof circle>;
		expectTypeOf<Props["radius"]>().toEqualTypeOf<number | Readable<number>>();
		expectTypeOf<Props["onTap"]>().toEqualTypeOf<CircleProps["onTap"]>();
		expectTypeOf<Props>().toHaveProperty("ref");
		expectTypeOf<NonNullable<Props["ref"]>>().toMatchTypeOf<
			React.Ref<ShapeNode<CircleProps>>
		>();
		type GroupComponentProps = ComponentProps<typeof group>;
		expectTypeOf<GroupComponentProps>().toHaveProperty("children");
		expectTypeOf<GroupComponentProps["children"]>().not.toEqualTypeOf<
			readonly SceneNode[] | undefined
		>();

		// @ts-expect-error radius is required
		const missing = <Circle />;
		// @ts-expect-error a circle takes no children
		const withChildren = <Circle radius={1}>{null}</Circle>;
		const fine = (
			<Group x={1}>
				<Circle radius={1} />
			</Group>
		);
		expect([missing, withChildren, fine]).toHaveLength(3);
	});
});
