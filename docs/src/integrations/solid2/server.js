/**
 * SSR half of the Solid 2 renderer, ported from `@astrojs/solid-js`'s server
 * entry to Solid 2's module layout: `renderToString`/`ssr` come from
 * `@solidjs/web`'s server condition, and the Solid 1 `Suspense`/async paths
 * are dropped — sync rendering only. Every island in this site is
 * `client:only="solid2"`, so in practice only `check` runs, to confirm that a
 * stray Solid component is ours rather than another framework's.
 */

import { renderToString, ssr } from "@solidjs/web";
import { createComponent } from "solid-js";

const slotName = (str) =>
	str.trim().replace(/[-_]([a-z])/g, (_, w) => w.toUpperCase());

const contexts = new WeakMap();

function getContext(result) {
	if (!contexts.has(result)) {
		contexts.set(result, { c: 0 });
	}
	return contexts.get(result);
}

function incrementId(ctx) {
	const id = `s${ctx.c}`;
	ctx.c++;
	return id;
}

async function check(Component, props, children) {
	if (typeof Component !== "function") return false;
	try {
		const { html } = await renderToStaticMarkup.call(
			this,
			Component,
			props,
			children,
			{},
		);
		return typeof html === "string";
	} catch {
		return false;
	}
}

async function renderToStaticMarkup(
	Component,
	props,
	{ default: children, ...slotted },
	metadata,
) {
	const ctx = getContext(this.result);
	const renderId = metadata?.hydrate ? incrementId(ctx) : "";
	const tagName = "astro-slot";
	const renderFn = () => {
		const slots = {};
		for (const [key, value] of Object.entries(slotted)) {
			const name = slotName(key);
			slots[name] = ssr(`<${tagName} name="${name}">${value}</${tagName}>`);
		}
		const newProps = {
			...props,
			...slots,
			// In Solid SSR mode, `ssr` creates the expected structure for children.
			children:
				children != null
					? ssr(`<${tagName}>${children}</${tagName}>`)
					: children,
		};
		return createComponent(Component, newProps);
	};
	const html = renderToString(renderFn);
	return {
		attrs: { "data-solid-render-id": renderId },
		html,
	};
}

const renderer = {
	name: "@sophistry/solid2",
	check,
	renderToStaticMarkup,
	supportsAstroStaticSlot: true,
};

export default renderer;
