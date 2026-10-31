/**
 * `linearTransform`: warps its children's space by a blended matrix, pins
 * the pen so a shear does not fatten strokes (unless `scaleStroke`), and
 * keeps its space object while nothing changed; `basisVectors` and
 * `transformDeterminant` read the same blend.
 */

import { describe, expect, it } from "vitest";
import { Invalidate } from "../scene/context";
import { group } from "../scene/group";
import { line } from "../shapes/line";
import {
	basisVectors,
	LinearTransformNode,
	linearTransform,
	transformDeterminant,
} from "./linear-transform";
import { mount } from "./test-scene";

const SHEAR = { iHat: { x: 2, y: 0 }, jHat: { x: 1, y: 2 } };

function warped(props: Parameters<typeof linearTransform.create>[0] = {}) {
	const segment = line.create({
		from: { x: 0, y: 1 },
		to: { x: 1, y: 1 },
		strokeWidth: 0.1,
	});
	const node = linearTransform.create({ ...props, children: [segment] });
	const scene = mount(node);
	return { node, segment, scene };
}

describe("linearTransform", () => {
	it("is a container primitive whose props recompute the space", () => {
		expect(linearTransform.name).toBe("LinearTransform");
		expect(linearTransform.kind).toBe("primitive");
		expect(linearTransform.container).toBe(true);
		expect(linearTransform.descriptor.progress.invalidates).toBe(
			Invalidate.SPACE,
		);
		expect(linearTransform.create()).toBeInstanceOf(LinearTransformNode);
	});

	it("maps its children's points through the matrix", () => {
		const { scene } = warped(SHEAR);
		const [segment] = scene.segments();
		expect(segment?.a).toEqual({ x: 1, y: 2 });
		expect(segment?.b).toEqual({ x: 3, y: 2 });
	});

	it("pins the pen: a shear does not fatten strokes", () => {
		const { scene } = warped(SHEAR);
		expect(scene.shapes()[0]?.style.strokeWidth).toBeCloseTo(0.1, 9);
	});

	it("scales strokes with scaleStroke", () => {
		const { scene } = warped({ ...SHEAR, scaleStroke: true });
		// The matrix's scale factor: mean of its column lengths.
		const expected = 0.1 * ((2 + Math.hypot(1, 2)) / 2);
		expect(scene.shapes()[0]?.style.strokeWidth).toBeCloseTo(expected, 9);
	});

	it("keeps the enclosing group's pen, and nested transforms do not compound it", () => {
		const segment = line.create({
			from: { x: 0, y: 0 },
			to: { x: 1, y: 0 },
			strokeWidth: 0.1,
		});
		const scene = mount(
			group.create({
				scale: 2,
				children: [
					linearTransform.create({
						...SHEAR,
						children: [
							linearTransform.create({ ...SHEAR, children: [segment] }),
						],
					}),
				],
			}),
		);
		expect(scene.shapes()[0]?.style.strokeWidth).toBeCloseTo(0.2, 9);
	});

	it("blends from the identity by progress, about origin", () => {
		const { node, scene } = warped({ ...SHEAR, progress: 0 });
		expect(scene.segments()[0]?.a).toEqual({ x: 0, y: 1 });
		node.set("progress", 0.5);
		scene.commit();
		expect(scene.segments()[0]?.a).toEqual({ x: 0.5, y: 1.5 });
		node.update({ progress: 1, origin: { x: 0, y: 1 } });
		scene.commit();
		// The point on the origin stays put.
		expect(scene.segments()[0]?.a).toEqual({ x: 0, y: 1 });
	});

	it("multiplies opacity into its children", () => {
		const { scene } = warped({ opacity: 0.5 });
		expect(scene.shapes()[0]?.style.opacity).toBeCloseTo(0.5, 9);
	});

	it("keeps its child space while nothing in it changed", () => {
		const { node, scene } = warped(SHEAR);
		const before = node.childSpace;
		node.set("iHat", { ...SHEAR.iHat });
		scene.commit();
		expect(node.childSpace).toBe(before);
	});
});

describe("basisVectors", () => {
	it("draws two arrows to the blended columns, and labels when asked", () => {
		const node = basisVectors.create({ ...SHEAR, progress: 0.5, labels: true });
		const scene = mount(node);
		expect(node.children.map((c) => c.type)).toEqual([
			"Vector",
			"Vector",
			"Label",
			"Label",
		]);
		expect(node.children[0]?.get("to" as never)).toEqual({ x: 1.5, y: 0 });
		expect(node.children[1]?.get("to" as never)).toEqual({ x: 0.5, y: 1.5 });
		expect(scene.texts().map((t) => t.text)).toEqual(["î", "ĵ"]);
		node.set("labels", false);
		scene.commit();
		expect(node.children.map((c) => c.type)).toEqual(["Vector", "Vector"]);
	});
});

describe("transformDeterminant", () => {
	it("is the blended map's determinant", () => {
		expect(transformDeterminant({ ...SHEAR })).toBeCloseTo(4, 9);
		expect(transformDeterminant({ ...SHEAR, progress: 0 })).toBe(1);
		expect(
			transformDeterminant({ matrix: { a: 0, b: 1, c: 1, d: 0, e: 0, f: 0 } }),
		).toBe(-1);
	});
});
