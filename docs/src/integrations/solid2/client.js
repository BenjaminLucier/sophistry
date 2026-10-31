/**
 * Astro island bootstrap for Solid 2 — `@astrojs/solid-js`'s client entry,
 * ported to Solid 2's module layout: `render`/`hydrate` come from
 * `@solidjs/web`, `createStore`/`reconcile` from the `solid-js` main entry,
 * and the Solid 1 `Suspense` wrapper is dropped (islands here are
 * `client:only`, so only the render path runs).
 */

import { hydrate, render } from "@solidjs/web";
import { createComponent, createStore, reconcile } from "solid-js";

const alreadyInitializedElements = new WeakMap();

export default (element) =>
	(Component, props, slotted, { client }) => {
		if (!element.hasAttribute("ssr")) return;
		const isHydrate = client !== "only";
		let slot;
		const _slots = {};
		if (Object.keys(slotted).length > 0) {
			if (!isHydrate) {
				const iterator = document.createTreeWalker(
					element,
					NodeFilter.SHOW_ELEMENT,
					(node) => {
						if (node === element) return NodeFilter.FILTER_SKIP;
						if (node.nodeName === "ASTRO-SLOT") return NodeFilter.FILTER_ACCEPT;
						if (node.nodeName === "ASTRO-ISLAND")
							return NodeFilter.FILTER_REJECT;
						return NodeFilter.FILTER_SKIP;
					},
				);
				for (slot = iterator.nextNode(); slot; slot = iterator.nextNode())
					_slots[slot.getAttribute("name") || "default"] = slot;
			}
			for (const [key, value] of Object.entries(slotted)) {
				if (_slots[key]) continue;
				_slots[key] = document.createElement("astro-slot");
				if (key !== "default") _slots[key].setAttribute("name", key);
				_slots[key].innerHTML = value;
			}
		}
		const { default: children, ...slots } = _slots;
		if (alreadyInitializedElements.has(element)) {
			alreadyInitializedElements.get(element)(
				// reconcile applies as little as possible, and removes missing values
				// without breaking reactivity.
				reconcile({ ...props, ...slots, children }),
			);
		} else {
			const [store] = createStore({ ...props, ...slots, children });
			alreadyInitializedElements.set(element, store);
			const fn = () => createComponent(Component, store);
			let dispose;
			if (isHydrate) {
				dispose = hydrate(fn, element);
			} else {
				element.innerHTML = "";
				dispose = render(fn, element);
			}
			element.addEventListener("astro:unmount", () => dispose(), {
				once: true,
			});
		}
	};
