import { Title } from "@solidjs/meta";
import type { JSX } from "@solidjs/web";
import { For, Loading } from "solid-js";
import { ThemeToggle } from "./components/theme-toggle";

const NAV = [
	{ href: "/", label: "Index" },
	{ href: "/shapes", label: "Shapes" },
	{ href: "/bars", label: "Bars" },
	{ href: "/math", label: "Math" },
	{ href: "/orbit", label: "Orbit" },
	{ href: "/line-plot", label: "Line plot" },
	{ href: "/pie", label: "Pie" },
	{ href: "/morph", label: "Morph" },
	{ href: "/views", label: "Views" },
	{ href: "/numbers", label: "Numbers" },
	{ href: "/calculus", label: "Calculus" },
	{ href: "/linear", label: "Linear" },
	{ href: "/latex-morph", label: "LaTeX morph" },
	{ href: "/drag", label: "Drag" },
	{ href: "/pan-zoom", label: "Pan/Zoom" },
	{ href: "/benchmarks", label: "Benchmarks" },
] as const;

/**
 * The router's root layout: always mounted, receives the matched route as
 * `props.children`. Plain `<a>` elements are the links — the router intercepts
 * them and decorates the active one with `data-active` / `aria-current`, which
 * `index.css` styles. Routes are lazy (async), so the outlet sits in a
 * `<Loading>` boundary: the header stays up while a route chunk loads, instead
 * of the whole root mount deferring on it.
 */
export function App(props: { children?: JSX.Element }) {
	return (
		<div class="mx-auto flex max-w-4xl flex-col gap-6 p-6">
			<Title>sophistry playground</Title>
			<header class="flex flex-col gap-3">
				<div class="flex items-center justify-between gap-3">
					<h1 class="text-2xl font-bold">
						<a href="/">sophistry playground</a>
					</h1>
					<ThemeToggle />
				</div>
				<nav class="flex flex-wrap gap-1.5">
					<For each={NAV}>
						{(item) => (
							<a
								href={item.href}
								class="rounded-md border border-rule px-3 py-1 text-sm text-muted hover:bg-surface"
							>
								{item.label}
							</a>
						)}
					</For>
				</nav>
			</header>
			<Loading>{props.children}</Loading>
		</div>
	);
}
