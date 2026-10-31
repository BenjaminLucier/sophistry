import type { JSX } from "@solidjs/web";
import { Dynamic } from "@solidjs/web";
import { createSignal, onSettled, Show, untrack } from "solid-js";

type ExampleComponent = () => JSX.Element;

// Same lazy module map as the gallery: one chunk per example.
const loaders = import.meta.glob<{ default: ExampleComponent }>(
	"../../examples/*/*.tsx",
);

/**
 * A live, bare gallery example for the home page's thumbnail strip. Mounts only
 * once near the viewport, so six canvases do not all start at page load.
 */
export function Thumb(props: { name: string }) {
	const load = loaders[`../../examples/${untrack(() => props.name)}.tsx`];
	const [visible, setVisible] = createSignal(false);
	const [Comp, setComp] = createSignal<ExampleComponent | undefined>();
	let host: HTMLDivElement | undefined;

	onSettled(() => {
		if (!host || !load) return;
		const start = () => {
			setVisible(true);
			void load().then((m) => setComp(() => m.default));
		};
		if (typeof IntersectionObserver === "undefined") return start();
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					io.disconnect();
					start();
				}
			},
			{ rootMargin: "200px" },
		);
		io.observe(host);
		return () => io.disconnect();
	});

	return (
		<div ref={host} class="home-thumb-stage" data-ready={visible()}>
			<Show when={Comp()}>{(C) => <Dynamic component={C()} />}</Show>
		</div>
	);
}
