/**
 * A shape whose geometry is async (a font, a worker result, a fetch) is left
 * out of the frame until it resolves, without holding back its siblings, and
 * appears in the commit after it does. A newer request supersedes an older
 * one, and a rejection is not swallowed.
 */

import { describe, expect, it } from "vitest";
import { rect } from "../shapes/index.js";
import type { DrawSpec, ShapeSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { Invalidate, themeContext } from "./context.js";
import { SceneGraph } from "./graph.js";
import {
	defineShape,
	type ShapeGeometry,
	type ShapeProps,
	shapeProps,
} from "./shape.js";

/** A graph that records whether a commit was asked for. */
function manualGraph() {
	let pending = false;
	const frames: (readonly DrawSpec[])[] = [];
	const graph = new SceneGraph({
		schedule: () => {
			pending = true;
		},
		onFrame: (frame) => frames.push(frame),
	});
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	return {
		graph,
		frames,
		pending: () => pending,
		commit: () => {
			pending = false;
			return graph.commit();
		},
	};
}

/** A promise with its resolve and reject handles. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const triangle = (size: number): ShapeGeometry => ({
	closed: true,
	polylines: [
		[
			{ x: 0, y: 0 },
			{ x: size, y: 0 },
			{ x: size, y: size },
		],
	],
});

interface SlowProps extends ShapeProps {
	size?: number;
}

/** A shape whose geometry for each size waits on a test-held promise. */
function slowShape() {
	const requests = new Map<
		number,
		ReturnType<typeof deferred<ShapeGeometry>>
	>();
	const definition = defineShape<SlowProps>({
		name: "Slow",
		props: {
			...shapeProps,
			size: { default: 1, invalidates: Invalidate.GEOMETRY },
		},
		geometry: (props) => {
			const request = deferred<ShapeGeometry>();
			requests.set(props.size ?? 1, request);
			return request.promise;
		},
	});
	return { definition, requests };
}

/** Lets resolved promises' callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("async geometry", () => {
	it("a pending node neither blanks its siblings nor errors, and appears once resolved", async () => {
		const { definition, requests } = slowShape();
		const { graph, commit, frames, pending } = manualGraph();
		const sibling = graph.root.add(
			rect.create({ width: 1, height: 1, fill: "#f00" }),
		);
		const slow = graph.root.add(definition.create({ fill: "#0f0" }));
		commit();
		expect(frames.at(-1)?.map((spec) => spec.id)).toEqual([sibling.id]);
		expect(slow.spec).toBeNull();
		expect(slow.bounds()).toBeNull();

		requests.get(1)?.resolve(triangle(1));
		await settle();
		expect(pending()).toBe(true);
		commit();
		expect(frames.at(-1)?.map((spec) => spec.id)).toEqual([
			sibling.id,
			slow.id,
		]);
		expect((slow.spec as ShapeSpec).style.fill).toBe("#0f0");
		expect(slow.width()).toBe(1);
	});

	it("a newer request supersedes an older one; the old outline stays up meanwhile", async () => {
		const { definition, requests } = slowShape();
		const { graph, commit } = manualGraph();
		const slow = graph.root.add(definition.create({ size: 1 }));
		commit();
		requests.get(1)?.resolve(triangle(1));
		await settle();
		commit();
		const first = slow.spec as ShapeSpec;

		slow.set("size", 2);
		commit();
		slow.set("size", 3);
		commit();
		expect(slow.spec).toBe(first);
		// The size-3 answer lands first, then the stale size-2 one: dropped.
		requests.get(3)?.resolve(triangle(3));
		await settle();
		commit();
		requests.get(2)?.resolve(triangle(2));
		await settle();
		commit();
		expect(slow.width()).toBe(3);
		expect((slow.spec as ShapeSpec).local?.polylines[0]?.[1]).toEqual({
			x: 3,
			y: 0,
		});
	});

	it("does not swallow a rejection: the next commit throws it, once", async () => {
		const { definition, requests } = slowShape();
		const { graph, commit, frames } = manualGraph();
		const sibling = graph.root.add(rect.create({ width: 1, height: 1 }));
		graph.root.add(definition.create({}));
		commit();
		requests.get(1)?.reject(new Error("boom"));
		await settle();
		expect(() => commit()).toThrow("boom");
		commit();
		expect(frames.at(-1)?.map((spec) => spec.id)).toEqual([sibling.id]);
	});

	it("a synchronous throw from geometry surfaces from the commit", () => {
		const broken = defineShape<ShapeProps>({
			name: "Broken",
			props: shapeProps,
			geometry: () => {
				throw new Error("bad outline");
			},
		});
		const { graph, commit } = manualGraph();
		graph.root.add(broken.create());
		expect(() => commit()).toThrow("bad outline");
	});

	it("a disposed node ignores its late answer", async () => {
		const { definition, requests } = slowShape();
		const { graph, commit, pending } = manualGraph();
		const slow = graph.root.add(definition.create({}));
		commit();
		slow.dispose();
		commit();
		requests.get(1)?.resolve(triangle(1));
		await settle();
		expect(pending()).toBe(false);
		expect(slow.spec).toBeNull();
	});
});
