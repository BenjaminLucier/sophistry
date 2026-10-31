import { Title } from "@solidjs/meta";
import { For } from "solid-js";
import { BENCHMARKS } from "../../benchmarks/scenes";

export default function BenchmarksIndex() {
	return (
		<>
			<Title>Benchmarks — sophistry playground</Title>
			<p class="text-sm text-muted">
				Each benchmark is a style of load. Pick one, choose how big, and run it
				for a timing snapshot. For numbers worth comparing, use a production
				build (<code>vite build && vite preview</code>) in a foreground tab with
				devtools closed.
			</p>
			<div class="grid gap-4 sm:grid-cols-2">
				<For each={BENCHMARKS}>
					{(bench) => (
						<a
							href={`/benchmarks/${bench.id}`}
							class="rounded-xl border border-rule p-4 transition-colors hover:bg-surface"
						>
							<h2 class="font-semibold text-ink">{bench.title}</h2>
							<p class="mt-1 text-sm text-muted">{bench.blurb}</p>
						</a>
					)}
				</For>
			</div>
		</>
	);
}
