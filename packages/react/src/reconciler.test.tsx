/**
 * The reconciler end to end through `<Stage>`: props reaching nodes, only
 * changed props written, bound `Readable`s updating with no React render,
 * keyed lists and conditional children keeping identity and order, children
 * of groups and composites, disposal, events and text errors.
 */

import type {
	CircleProps,
	NodeOf,
	Readable,
	Scene,
	SceneNode,
	ShapeNode,
} from "@sophistry/core";
import {
	circle,
	defineComposite,
	Invalidate as Phase,
	track,
} from "@sophistry/core";
import type { GroupNode } from "@sophistry/core/internal";
import { act, cleanup, render } from "@testing-library/react";
import { Component, createRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Circle, Group, Rect } from "./generated/core.gen.js";
import { Stage } from "./stage.js";
import { type DomHarness, installDom } from "./test-dom.js";
import { wrap } from "./wrap.js";

type CircleNode = ShapeNode<CircleProps>;

let dom: DomHarness;

beforeEach(() => {
	dom = installDom();
});

afterEach(() => {
	cleanup();
	dom.restore();
	vi.restoreAllMocks();
});

/** Renders `children` in a stage and returns the scene. */
function mount(children: ReactNode) {
	const sceneRef = createRef<Scene>();
	const view = render(<Stage ref={sceneRef}>{children}</Stage>);
	const scene = sceneRef.current as Scene;
	return {
		scene,
		rerender: (next: ReactNode) =>
			view.rerender(<Stage ref={sceneRef}>{next}</Stage>),
		unmount: view.unmount,
	};
}

/** The ids of the specs the next paint draws, after a commit. */
function specIds(scene: Scene): number[] {
	scene.commit();
	return scene.snapshot().map((spec) => spec.id);
}

const ORIGIN = { x: 0, y: 0 };

describe("props", () => {
	it("creates a node per element with its props", () => {
		const ref = createRef<CircleNode>();
		const { scene } = mount(
			<Circle ref={ref} radius={2} center={{ x: 1, y: 0 }} fill="red" />,
		);
		const node = ref.current as SceneNode<{ radius: number; fill: string }>;
		expect(node.type).toBe("Circle");
		expect(node.get("radius")).toBe(2);
		expect(node.get("fill")).toBe("red");
		expect(scene.root.children).toEqual([node]);
		expect(specIds(scene)).toEqual([node.id]);
	});

	it("writes only the props that changed", () => {
		const ref = createRef<CircleNode>();
		const { rerender } = mount(
			<Circle ref={ref} radius={1} center={ORIGIN} fill="red" />,
		);
		const node = ref.current as SceneNode;
		const set = vi.spyOn(node, "set");
		rerender(<Circle ref={ref} radius={3} center={ORIGIN} fill="red" />);
		expect(set).toHaveBeenCalledTimes(1);
		expect(set).toHaveBeenCalledWith("radius", 3);
		set.mockClear();
		rerender(<Circle ref={ref} radius={3} center={ORIGIN} />);
		expect(set.mock.calls).toEqual([["fill", undefined]]);
		expect((node as SceneNode<{ fill: unknown }>).get("fill")).toBe(
			circle.descriptor.fill.default,
		);
	});

	it("binds a Readable prop: a track write updates the spec with no render", () => {
		const radius = track(1);
		const ref = createRef<CircleNode>();
		let renders = 0;
		function Counted() {
			renders++;
			return <Circle ref={ref} radius={radius} />;
		}
		const { scene } = mount(<Counted />);
		scene.commit();
		const node = ref.current as SceneNode<{ radius: number }>;
		const before = scene.snapshot()[0];
		const rendered = renders;
		act(() => radius.set(4));
		scene.commit();
		expect(node.get("radius")).toBe(4);
		expect(scene.snapshot()[0]).not.toBe(before);
		expect(renders).toBe(rendered);
	});

	it("ignores unknown props with one warning", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const ref = createRef<CircleNode>();
		const props = { radius: 1, bogus: 1 } as { radius: number };
		const { rerender } = mount(<Circle ref={ref} {...props} />);
		rerender(
			<Circle ref={ref} {...({ radius: 1, bogus: 2 } as { radius: number })} />,
		);
		expect(ref.current).not.toBeNull();
		const messages = warn.mock.calls.filter((call) =>
			String(call[0]).includes('"bogus"'),
		);
		expect(messages).toHaveLength(1);
	});
});

describe("children", () => {
	function List({ keys }: { keys: string[] }) {
		return (
			<>
				{keys.map((key, i) => (
					<Circle key={key} radius={1} center={{ x: i, y: 0 }} label={key} />
				))}
			</>
		);
	}
	const labels = (nodes: readonly SceneNode[]) =>
		nodes.map((node) => (node as SceneNode<{ label: string }>).get("label"));

	it("keeps node identity and tree order through inserts, moves and removals", () => {
		const { scene, rerender } = mount(<List keys={["a", "b", "c"]} />);
		const [a, b, c] = scene.root.children as SceneNode[];
		rerender(<List keys={["c", "a", "b"]} />);
		expect(scene.root.children).toEqual([c, a, b]);
		expect(specIds(scene)).toEqual([c, a, b].map((node) => node?.id));

		rerender(<List keys={["c", "d", "a", "b"]} />);
		expect(labels(scene.root.children)).toEqual(["c", "d", "a", "b"]);
		expect(scene.root.children[0]).toBe(c);
		expect(scene.root.children[2]).toBe(a);

		rerender(<List keys={["d", "b"]} />);
		expect(labels(scene.root.children)).toEqual(["d", "b"]);
		expect(scene.root.children[1]).toBe(b);
		expect(a?.disposed).toBe(true);
		expect(c?.disposed).toBe(true);
		expect(b?.disposed).toBe(false);
		expect(specIds(scene)).toHaveLength(2);
	});

	it("places conditional children in tree order", () => {
		const view = (show: boolean) => (
			<>
				<Circle radius={1} label="first" />
				{show && <Rect width={1} height={1} label="middle" />}
				<Circle radius={1} label="last" />
			</>
		);
		const { scene, rerender } = mount(view(false));
		const [first, last] = scene.root.children as SceneNode[];
		rerender(view(true));
		expect(labels(scene.root.children)).toEqual(["first", "middle", "last"]);
		const middle = scene.root.children[1] as SceneNode;
		rerender(view(false));
		expect(scene.root.children).toEqual([first, last]);
		expect(middle.disposed).toBe(true);
	});

	it("gives a group its children, in order, across reorders", () => {
		const groupRef = createRef<GroupNode>();
		const view = (keys: string[]) => (
			<Group ref={groupRef} x={2}>
				<List keys={keys} />
			</Group>
		);
		const { scene, rerender } = mount(view(["a", "b"]));
		const group = groupRef.current as SceneNode & {
			children: readonly SceneNode[];
		};
		expect(scene.root.children).toEqual([group]);
		const [a, b] = group.children;
		rerender(view(["b", "a", "c"]));
		expect(group.children[0]).toBe(b);
		expect(group.children[1]).toBe(a);
		expect(labels(group.children)).toEqual(["b", "a", "c"]);
		rerender(view(["c"]));
		expect(labels(group.children)).toEqual(["c"]);
		expect(a?.disposed).toBe(true);
		expect(specIds(scene)).toEqual([group.children[0]?.id]);
	});

	it("hands a composite its children through its children prop", () => {
		interface FrameProps {
			children?: readonly SceneNode[];
			padding?: number;
		}
		const frame = defineComposite<FrameProps>({
			name: "TestFrame",
			props: {
				children: { kind: "children", invalidates: Phase.UPDATE },
				padding: { default: 0, invalidates: Phase.UPDATE },
			},
			setup: (ctx) => [...ctx.children],
			update: (changed, ctx) =>
				changed.has("children") ? [...ctx.children] : undefined,
		});
		const Frame = wrap(frame);
		const frameRef = createRef<NodeOf<typeof frame>>();
		const view = (keys: string[]) => (
			<Frame ref={frameRef} padding={1}>
				<List keys={keys} />
			</Frame>
		);
		const { scene, rerender } = mount(view(["a", "b"]));
		scene.commit();
		const composite = frameRef.current as SceneNode & {
			children: readonly SceneNode[];
		};
		expect(labels(composite.children)).toEqual(["a", "b"]);
		const [a, b] = composite.children;
		rerender(view(["b", "x", "a"]));
		scene.commit();
		expect(labels(composite.children)).toEqual(["b", "x", "a"]);
		expect(composite.children[0]).toBe(b);
		expect(composite.children[2]).toBe(a);
		expect(specIds(scene)).toHaveLength(3);
		rerender(view([]));
		scene.commit();
		expect(composite.children).toEqual([]);
		expect(a?.disposed && b?.disposed).toBe(true);
	});

	it("rejects children on a definition that takes none", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const caught = renderCaught(
			// @ts-expect-error a circle takes no children
			<Circle radius={1}>
				<Circle radius={2} />
			</Circle>,
		);
		expect(caught()).toMatch(/<Circle> takes no children/);
	});

	it("rejects text with a pointer to <Text>", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const caught = renderCaught(<>hello</>);
		expect(caught()).toMatch(/<Text text=/);
	});

	it("rejects DOM elements", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const caught = renderCaught(<span />);
		expect(caught()).toMatch(/<span> is not a Sophistry element/);
	});
});

/** Renders `children` in a stage under an error boundary; returns the caught message. */
function renderCaught(children: ReactNode): () => string | null {
	let message: string | null = null;
	class Boundary extends Component<
		{ children: ReactNode },
		{ failed: boolean }
	> {
		override state = { failed: false };
		static getDerivedStateFromError() {
			return { failed: true };
		}
		override componentDidCatch(error: Error) {
			message = error.message;
		}
		override render() {
			return this.state.failed ? null : this.props.children;
		}
	}
	render(
		<Boundary>
			<Stage>{children}</Stage>
		</Boundary>,
	);
	return () => message;
}

describe("disposal", () => {
	it("unmounting disposes the nodes, the scene and the bindings", () => {
		let subscribers = 0;
		const radius: Readable<number> = {
			peek: () => 1,
			subscribe: () => {
				subscribers++;
				return () => {
					subscribers--;
				};
			},
		};
		const groupRef = createRef<GroupNode>();
		const circleRef = createRef<CircleNode>();
		const { scene, unmount } = mount(
			<Group ref={groupRef}>
				<Circle ref={circleRef} radius={radius} />
			</Group>,
		);
		const group = groupRef.current as SceneNode;
		const node = circleRef.current as SceneNode;
		expect(subscribers).toBe(1);
		unmount();
		expect(node.disposed).toBe(true);
		expect(group.disposed).toBe(true);
		expect(scene.root.disposed).toBe(true);
		expect(subscribers).toBe(0);
		expect(scene.commit()).toBe(false);
	});

	it("removing an element ends its bindings", () => {
		const radius = track(1);
		const ref = createRef<CircleNode>();
		const { scene, rerender } = mount(<Circle ref={ref} radius={radius} />);
		const node = ref.current as SceneNode<{ radius: number }>;
		rerender(null);
		expect(node.disposed).toBe(true);
		expect(scene.root.children).toEqual([]);
		act(() => radius.set(3));
		expect(node.get("radius")).not.toBe(3);
	});
});

describe("events", () => {
	it("passes handlers through as props and fires them", () => {
		const onTap = vi.fn();
		const ref = createRef<CircleNode>();
		const { rerender } = mount(<Circle ref={ref} radius={1} onTap={onTap} />);
		const node = ref.current as CircleNode;
		expect(node.get("onTap")).toBe(onTap);
		const handlers = (
			node as unknown as {
				interactionHandlers(): { onTap?: (event: unknown) => void };
			}
		).interactionHandlers();
		handlers.onTap?.({ type: "tap" });
		expect(onTap).toHaveBeenCalledWith({ type: "tap" });

		const next = vi.fn();
		rerender(<Circle ref={ref} radius={1} onTap={next} />);
		expect(node.get("onTap")).toBe(next);
	});

	it("takes a Track as the hover sink instead of binding it", () => {
		const hovered = track(false);
		const ref = createRef<CircleNode>();
		mount(<Circle ref={ref} radius={1} hover={hovered} />);
		expect((ref.current as CircleNode).get("hover")).toBe(hovered);
	});
});
