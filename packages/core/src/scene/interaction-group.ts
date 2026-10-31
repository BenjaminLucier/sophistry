/**
 * `interactionGroup`: one handler set shared by many nodes (a labelled dot's
 * disc and text). Members answer with the group's handlers rather than the
 * group having a combined hit region, so the registry stays one record per
 * node and distant members don't swallow the space between them. It draws and
 * transforms nothing; the context it provides lives in
 * `interaction-group-context.ts`.
 */

import type { InteractionHandlers, InteractionProps } from "../interact/types";
import { BaseContainer } from "./container";
import { Invalidate } from "./context";
import type { InteractionGroupValue } from "./interaction-group-context";
import { interactionGroupContext } from "./interaction-group-context";
import { interactionProps } from "./interaction-props";
import { memo } from "./node";
import { definePrimitive } from "./primitive";
import type { Definition, SceneNode } from "./types";

/**
 * Props for {@link interactionGroup}: every {@link InteractionProps} field
 * (handlers, `pointerEvents`, `cursor`, `label`, `role`, `focusable`), which
 * members inherit, plus the `children`.
 *
 * @category Accessibility
 */
export interface InteractionGroupProps extends InteractionProps {
	/** The shapes and labels that share these handlers. */
	children?: readonly SceneNode[];
}

/**
 * `inner` over `outer`, key by key: the more specific side wins wherever it
 * says anything.
 *
 * @internal
 */
export function mergeHandlers(
	outer: InteractionHandlers,
	inner: InteractionHandlers,
): InteractionHandlers {
	const merged: Record<string, unknown> = { ...outer };
	for (const [key, value] of Object.entries(inner)) {
		if (value !== undefined) merged[key] = value;
	}
	return merged as InteractionHandlers;
}

/**
 * An interaction group node: a container that provides its members an
 * {@link InteractionGroupValue}. Not itself interactive (it has no spec to
 * hit); a change to its props bumps the registry, which re-reads every
 * member's record.
 *
 * @category Scene graph
 */
export class InteractionGroupNode extends BaseContainer<InteractionGroupProps> {
	private readonly mergedHandlers = memo(mergeHandlers);

	constructor(definition: Definition<InteractionGroupProps>) {
		super(definition);
		const props = () => this.interactionProps();
		const parent = () => this.context(interactionGroupContext);
		const value: InteractionGroupValue = {
			id: this.id,
			// Nested groups compose the way a node composes with its group: the
			// inner one is more specific, so it wins where it says anything.
			handlers: () => {
				const own = this.interactionHandlers();
				const outer = parent();
				return outer ? this.mergedHandlers(outer.handlers(), own) : own;
			},
			pointerEvents: () => props().pointerEvents ?? parent()?.pointerEvents(),
			cursor: () => props().cursor ?? parent()?.cursor() ?? null,
			label: () => props().label ?? parent()?.label() ?? null,
			role: () => props().role ?? parent()?.role() ?? null,
			focusable: () => props().focusable ?? parent()?.focusable(),
			// Delegated all the way out: nested groups are one gesture and so one
			// tab stop, and it belongs to the outermost of them. The inner group's
			// label still wins, because it is the more specific description.
			root: () => parent()?.root() ?? value,
		};
		this.provide(interactionGroupContext, value);
	}

	/** The group's own props describe its members; it is never hit itself. */
	override wantsInteraction(): boolean {
		return false;
	}
}

/**
 * Makes everything inside it answer to one set of handlers, for one on-screen
 * thing made of several nodes (a dot and its caption). It draws and transforms
 * nothing. Members (the drawables in its subtree) inherit handlers, `cursor`,
 * `pointerEvents`, `label` and the rest, but their own props win key by key;
 * nested groups merge. The group is one tab stop: its first member in tree
 * order carries the focus, and the focus ring wraps every member.
 *
 * @example
 * ```ts
 * import { circle, createScene, interactionGroup, rect } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const dot = interactionGroup.create({
 * 	label: "point A",
 * 	cursor: "pointer",
 * 	onTap: () => console.log("A"),
 * 	children: [
 * 		circle.create({ radius: 0.2 }),
 * 		rect.create({ center: { x: 0.6, y: 0 }, width: 0.6, height: 0.3 }),
 * 	],
 * });
 * scene.add(dot);
 * ```
 *
 * @see {@link https://sophistry.dev/guides/interaction/#groups}
 * @category Accessibility
 */
export const interactionGroup = definePrimitive<
	InteractionGroupProps,
	InteractionGroupNode
>({
	name: "InteractionGroup",
	container: true,
	props: {
		...interactionProps,
		// Unset means "leave it to each member", unlike a shape's own defaults.
		pointerEvents: { invalidates: Invalidate.INTERACTION },
		role: { invalidates: Invalidate.INTERACTION },
		children: { kind: "children", invalidates: Invalidate.NONE },
	},
	node: (definition) => new InteractionGroupNode(definition),
});
