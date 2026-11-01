/**
 * `wrap`: props reach nodes, Solid changes set only the changed prop,
 * Readables bind without Solid work, children keep order and identity
 * through `<Show>`/`<For>`, composites receive children, unmount disposes,
 * event props reach the interaction record.
 */

import { render } from "@solidjs/web";
import type { Scene, SceneNode, ScenePointerEvent } from "@sophistry/core";
import {
	circle,
	defineComposite,
	group,
	rect,
	Invalidate as Stages,
	track,
} from "@sophistry/core";
import type { BaseNode } from "@sophistry/core/internal";
import { createSignal, For, flush, Show } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Circle, Group, Rect } from "./generated/core.gen.js";
import { Stage } from "./stage.js";
import type { DomHarness } from "./test/dom.js";
import { installDom, mountPoint } from "./test/dom.js";
import type { ComponentProps } from "./wrap.js";
import { wrap } from "./wrap.js";

let dom: DomHarness;
beforeEach(() => {
	dom = installDom();
});
afterEach(() => {
	dom.restore();
	vi.restoreAllMocks();
});

/** Renders `content` inside a `<Stage>` and returns the scene and the disposer. */
function mount(content: () => unknown): { scene: Scene; dispose: () => void } {
	let scene: Scene | undefined;
	const dispose = render(
		() => (
			<Stage
				ref={(created) => {
					scene = created;
				}}
			>
				{content() as never}
			</Stage>
		),
		mountPoint(),
	);
	if (!scene) throw new Error("no scene");
	return { scene, dispose };
}

/** The ids of the specs the scene would paint, in paint order. */
function specIds(scene: Scene): number[] {
	scene.commit();
	return scene.snapshot().map((spec) => (spec as { id: number }).id);
}

describe("wrap: props", () => {
	it("passes the props to create and reaches the spec", () => {
		let node: SceneNode | undefined;
		const { scene } = mount(() => (
			<Circle
				radius={2}
				center={{ x: 1, y: 0 }}
				fill="red"
				ref={(created) => {
					node = created;
				}}
			/>
		));
		expect(node?.type).toBe("Circle");
		expect(node?.get("radius" as never)).toBe(2);
		expect(scene.root.children).toEqual([node]);
		expect(specIds(scene)).toEqual([node?.id]);
		expect(node?.bounds()).toEqual({ minX: -1, minY: -2, maxX: 3, maxY: 2 });
	});

	it("sets only the prop whose Solid signal changed, once per change", () => {
		const [radius, setRadius] = createSignal(1);
		const [fill, setFill] = createSignal<string | undefined>("red");
		let node: SceneNode | undefined;
		mount(() => (
			<Circle
				radius={radius()}
				fill={fill()}
				stroke="blue"
				ref={(created) => {
					node = created;
				}}
			/>
		));
		const set = vi.spyOn(node as SceneNode, "set");
		setRadius(3);
		flush();
		expect(set.mock.calls).toEqual([["radius", 3]]);
		expect(node?.get("radius" as never)).toBe(3);

		set.mockClear();
		setFill(undefined);
		flush();
		expect(set.mock.calls).toEqual([["fill", undefined]]);
		expect(node?.get("stroke" as never)).toBe("blue");
	});

	it("does not set again on the first run", () => {
		const sets: unknown[] = [];
		const counting: typeof circle = {
			...circle,
			create(props) {
				const node = circle.create(props);
				const original = node.set.bind(node);
				node.set = ((key: never, value: never) => {
					sets.push(key);
					return original(key, value);
				}) as typeof node.set;
				return node;
			},
		};
		const Counting = wrap(counting);
		mount(() => <Counting radius={1} fill="red" />);
		expect(sets).toEqual([]);
	});

	it("passes a Readable through: Track writes bind in core and run no Solid code", () => {
		const radius = track(1);
		let bodies = 0;
		let reads = 0;
		const { scene } = mount(() => {
			bodies++;
			return (
				<Circle
					radius={(() => {
						reads++;
						return radius;
					})()}
				/>
			);
		});
		const node = scene.root.children[0] as SceneNode;
		const readsAfterMount = reads;
		radius.set(2);
		flush();
		scene.commit();
		expect(node.get("radius" as never)).toBe(2);
		expect(node.bounds()).toEqual({ minX: -2, minY: -2, maxX: 2, maxY: 2 });
		radius.set(3);
		flush();
		expect(node.get("radius" as never)).toBe(3);
		expect(bodies).toBe(1);
		expect(reads).toBe(readsAfterMount);
	});

	it("switches between a plain value and a Readable with set", () => {
		const bound = track(5);
		const [value, setValue] = createSignal<number | typeof bound>(1);
		let node: SceneNode | undefined;
		mount(() => (
			<Circle
				radius={value()}
				ref={(created) => {
					node = created;
				}}
			/>
		));
		setValue(bound);
		flush();
		expect(node?.get("radius" as never)).toBe(5);
		bound.set(6);
		expect(node?.get("radius" as never)).toBe(6);
		setValue(2);
		flush();
		bound.set(7);
		expect(node?.get("radius" as never)).toBe(2);
	});

	it("ignores unknown props with one dev warning per key", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const Loose = Circle as unknown as (props: object) => unknown;
		mount(() => (
			<>
				{Loose({ radius: 1, wobble: 2 }) as never}
				{Loose({ radius: 1, wobble: 3 }) as never}
			</>
		));
		const messages = warn.mock.calls.map(([message]) => String(message));
		expect(messages.filter((m) => m.includes('"wobble"'))).toHaveLength(1);
	});
});

describe("wrap: children", () => {
	it("keeps tree order and identity through <Show>", () => {
		const [shown, setShown] = createSignal(false);
		const refs: Record<string, SceneNode> = {};
		const keep = (name: string) => (node: SceneNode) => {
			refs[name] = node;
		};
		const { scene } = mount(() => (
			<Group ref={keep("group")}>
				<Circle radius={1} ref={keep("a")} />
				<Show when={shown()}>
					<Circle radius={2} ref={keep("b")} />
				</Show>
				<Circle radius={3} ref={keep("c")} />
			</Group>
		));
		const parent = refs.group as unknown as { children: SceneNode[] };
		const a = refs.a;
		const c = refs.c;
		expect(parent.children).toEqual([a, c]);

		setShown(true);
		flush();
		const b = refs.b as SceneNode;
		expect(parent.children).toEqual([a, b, c]);
		expect(specIds(scene)).toEqual([a?.id, b.id, c?.id]);

		setShown(false);
		flush();
		expect(parent.children).toEqual([a, c]);
		expect(b.disposed).toBe(true);
		expect(a?.disposed).toBe(false);
		expect(specIds(scene)).toEqual([a?.id, c?.id]);
	});

	it("keeps identity through <For> insert and reorder", () => {
		const [items, setItems] = createSignal([1, 2, 3]);
		const byItem = new Map<number, SceneNode>();
		const { scene } = mount(() => (
			<For each={items()}>
				{(item) => (
					<Circle
						radius={item}
						ref={(node) => {
							byItem.set(item, node);
						}}
					/>
				)}
			</For>
		));
		const first = [1, 2, 3].map((item) => byItem.get(item));
		expect(scene.root.children).toEqual(first);

		setItems([3, 4, 1, 2]);
		flush();
		const [one, two, three] = first;
		const four = byItem.get(4);
		expect(scene.root.children).toEqual([three, four, one, two]);
		expect(specIds(scene)).toEqual([three, four, one, two].map((n) => n?.id));
		expect(first.every((node) => node && !node.disposed)).toBe(true);

		setItems([4]);
		flush();
		expect(scene.root.children).toEqual([four]);
		expect([one, two, three].every((node) => node?.disposed)).toBe(true);
	});

	it("gives a composite its children through the children-kind prop", () => {
		interface FrameProps {
			padding?: number;
			children?: readonly SceneNode[];
		}
		const setups: number[] = [];
		const framed = defineComposite<FrameProps>({
			name: "Framed",
			props: {
				padding: { default: 0.5, invalidates: Stages.UPDATE },
				children: { kind: "children", invalidates: Stages.NONE },
			},
			setup: (ctx) => {
				setups.push(ctx.children.length);
				return [rect.create({ width: 4, height: 4 }), ...ctx.children];
			},
			update: (changed, ctx) =>
				changed.has("children")
					? [rect.create({ width: 4, height: 4 }), ...ctx.children]
					: undefined,
		});
		const Framed = wrap(framed);
		const [extra, setExtra] = createSignal(false);
		let frame: SceneNode | undefined;
		let inner: SceneNode | undefined;
		const { scene } = mount(() => (
			<Framed
				padding={1}
				ref={(node) => {
					frame = node;
				}}
			>
				<Circle
					radius={1}
					ref={(node) => {
						inner = node;
					}}
				/>
				<Show when={extra()}>
					<Circle radius={0.5} />
				</Show>
			</Framed>
		));
		scene.commit();
		expect(setups).toEqual([1]);
		const children = () =>
			(frame as unknown as { children: SceneNode[] }).children;
		expect(children()[1]).toBe(inner);
		expect(children()).toHaveLength(2);

		setExtra(true);
		flush();
		scene.commit();
		expect(children()).toHaveLength(3);
		expect(children()[1]).toBe(inner);
		expect(specIds(scene)).toHaveLength(3);
	});

	it("ignores strings among children with a dev warning", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let node: SceneNode | undefined;
		mount(() => (
			<Group
				ref={(created) => {
					node = created;
				}}
			>
				stray text
				<Circle radius={1} />
			</Group>
		));
		expect(
			(node as unknown as { children: SceneNode[] }).children,
		).toHaveLength(1);
		expect(
			warn.mock.calls.some(([m]) => String(m).includes("stray text")),
		).toBe(true);
	});

	it("warns and ignores children given to a definition that takes none", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const Loose = Rect as unknown as (props: object) => unknown;
		const { scene } = mount(() => (
			<>
				{
					Loose({
						width: 1,
						height: 1,
						get children() {
							return <Circle radius={1} />;
						},
					}) as never
				}
			</>
		));
		expect(scene.root.children).toHaveLength(1);
		expect(
			warn.mock.calls.some(([m]) => String(m).includes("takes no children")),
		).toBe(true);
	});
});

describe("wrap: lifetime and events", () => {
	it("disposes nodes, the scene and Track subscriptions on unmount", () => {
		const radius = track(1);
		let subscribers = 0;
		const counted = {
			peek: () => radius.peek(),
			subscribe(onStale: () => void) {
				subscribers++;
				const stop = radius.subscribe(onStale);
				return () => {
					subscribers--;
					stop();
				};
			},
		};
		const nodes: SceneNode[] = [];
		const { scene, dispose } = mount(() => (
			<Group ref={(node) => nodes.push(node)}>
				<Circle radius={counted} ref={(node) => nodes.push(node)} />
			</Group>
		));
		expect(subscribers).toBe(1);
		const disposeScene = vi.spyOn(scene, "dispose");
		dispose();
		expect(nodes.every((node) => node.disposed)).toBe(true);
		expect(disposeScene).toHaveBeenCalled();
		expect(subscribers).toBe(0);
		expect(scene.root.disposed).toBe(true);
	});

	it("forwards event props untouched to the node's handlers", () => {
		const taps: ScenePointerEvent[] = [];
		const onTap = (event: ScenePointerEvent) => taps.push(event);
		const hover = track(false);
		let node: SceneNode | undefined;
		mount(() => (
			<Circle
				radius={1}
				onTap={onTap}
				hover={hover}
				ref={(created) => {
					node = created;
				}}
			/>
		));
		expect(node?.get("onTap" as never)).toBe(onTap);
		// A Track given to `hover` is the sink itself, not a binding.
		expect(node?.get("hover" as never)).toBe(hover);
		const handlers = (node as unknown as BaseNode).interactionHandlers();
		const event = { x: 0, y: 0 } as unknown as ScenePointerEvent;
		handlers.onTap?.(event);
		expect(taps).toEqual([event]);
	});

	it("passes nodes made in Solid to a group's setChildren in JSX order", () => {
		let node: SceneNode | undefined;
		mount(() => (
			<Group
				x={2}
				ref={(created) => {
					node = created;
				}}
			>
				<Rect width={1} height={1} />
				<Circle radius={1} />
			</Group>
		));
		const types = (node as unknown as { children: SceneNode[] }).children.map(
			(child) => child.type,
		);
		expect(types).toEqual(["Rect", "Circle"]);
		expect(node?.definition).toBe(group);
	});
});

describe("ComponentProps", () => {
	it("keeps required props, adds Readables, children and ref by definition", () => {
		type CircleProps = ComponentProps<typeof circle>;
		type GroupProps = ComponentProps<typeof group>;
		const ok: CircleProps = { radius: track(1), onTap: () => {} };
		// @ts-expect-error radius is required
		const missing: CircleProps = {};
		// @ts-expect-error a circle takes no children
		const withChildren: CircleProps = { radius: 1, children: null };
		const container: GroupProps = { children: null, x: track(1) };
		// @ts-expect-error event props are not bindable
		const boundEvent: CircleProps = { radius: 1, onTap: track(() => {}) };
		const leaf = defineComposite<{ size?: number }>({
			name: "Leaf",
			props: { size: { invalidates: Stages.UPDATE } },
			setup: () => [],
		});
		type LeafProps = ComponentProps<typeof leaf>;
		const leafOk: LeafProps = { size: track(2) };
		// @ts-expect-error a composite without a children prop takes no children
		const leafChildren: LeafProps = { children: null };
		const typedRef: GroupProps = {
			ref: (node) => node.setChildren([]),
		};
		expect([
			ok,
			missing,
			withChildren,
			container,
			boundEvent,
			leafOk,
			leafChildren,
			typedRef,
		]).toHaveLength(8);
	});
});
