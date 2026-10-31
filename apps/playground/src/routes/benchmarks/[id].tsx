import { Title } from "@solidjs/meta";
import { useParams } from "@solidjs/router";
import { createMemo, createSignal, For, flush, Show } from "solid-js";
import type {
	BenchConfig,
	BenchResult,
	Summary,
} from "../../benchmarks/harness";
import {
	loadPrevious,
	nextFrame,
	resultKey,
	sample,
	savePrevious,
} from "../../benchmarks/harness";
import { findBenchmark } from "../../benchmarks/scenes";

const DURATIONS = [2, 5, 10];

const button =
	"rounded-md border border-rule px-3 py-1 text-sm hover:bg-surface";
const selected = "bg-surface border-accent";

const ms = (value: number) => `${value.toFixed(2)} ms`;

/** "+12%" / "−8%" against the last run of the same configuration. */
function delta(now: number, before: number | undefined): string {
	if (before === undefined || before === 0) return "";
	const change = ((now - before) / before) * 100;
	return `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(0)}%`;
}

function Row(props: {
	label: string;
	hint: string;
	now: Summary;
	before?: Summary;
}) {
	return (
		<tr class="border-t border-rule">
			<th class="py-2 pr-4 text-left font-medium" title={props.hint}>
				{props.label}
			</th>
			<td class="pr-4 tabular-nums">{ms(props.now.p50)}</td>
			<td class="pr-4 tabular-nums">{ms(props.now.p95)}</td>
			<td class="pr-4 tabular-nums">{ms(props.now.max)}</td>
			<td class="text-muted tabular-nums">
				{delta(props.now.p50, props.before?.p50)}
			</td>
		</tr>
	);
}

export default function BenchmarkPage() {
	const params = useParams();
	const bench = createMemo(() => findBenchmark(params.id ?? ""));

	const [config, setConfig] = createSignal<BenchConfig | null>(null);
	const [seconds, setSeconds] = createSignal(5);
	const [status, setStatus] = createSignal<"idle" | "mounting" | "sampling">(
		"idle",
	);
	// The scene reads its config once at setup, so it is handed a plain object;
	// only whether it is mounted is a signal.
	const [mounted, setMounted] = createSignal(false);
	let activeConfig: BenchConfig = {};
	const [result, setResult] = createSignal<BenchResult | null>(null);
	const [previous, setPrevious] = createSignal<BenchResult | null>(null);

	// Defaults come from the benchmark, so the config is built lazily rather
	// than at setup: the route component is reused across `:id` changes.
	const current = createMemo<BenchConfig>(() => {
		const b = bench();
		const chosen = config();
		const base: BenchConfig = {};
		for (const param of b?.params ?? []) {
			base[param.key] = chosen?.[param.key] ?? param.default;
		}
		return base;
	});

	let onReady: ((step: (frame: number) => void) => void) | undefined;

	async function run() {
		const b = bench();
		if (!b || status() !== "idle") return;
		const cfg = { ...current() };
		setResult(null);
		setStatus("mounting");

		const stepReady = new Promise<(frame: number) => void>((resolve) => {
			onReady = resolve;
		});
		const startedAt = performance.now();
		activeConfig = cfg;
		setMounted(true);
		flush();
		const step = await stepReady;
		// Two frames: the first schedules the paint, the second has run it.
		await nextFrame();
		await nextFrame();
		const mountMs = performance.now() - startedAt;

		setStatus("sampling");
		const sampled = await sample(step, seconds());
		setMounted(false);

		const key = resultKey(b.id, cfg);
		const finished: BenchResult = { mountMs, ...sampled };
		setPrevious(loadPrevious(key));
		savePrevious(key, finished);
		setResult(finished);
		setStatus("idle");
	}

	async function copy() {
		const b = bench();
		const r = result();
		if (!b || !r) return;
		await navigator.clipboard.writeText(
			JSON.stringify(
				{
					benchmark: b.id,
					config: current(),
					seconds: seconds(),
					result: r,
					env: {
						production: import.meta.env.PROD,
						dpr: window.devicePixelRatio,
						userAgent: navigator.userAgent,
					},
				},
				null,
				2,
			),
		);
	}

	return (
		<Show
			when={bench()}
			fallback={
				<p class="text-muted">
					No such benchmark. <a href="/benchmarks">Back</a>
				</p>
			}
		>
			{(b) => (
				<>
					<Title>{b().title} — benchmarks</Title>
					<div>
						<a href="/benchmarks" class="text-sm text-muted">
							← Benchmarks
						</a>
						<h2 class="text-lg font-semibold">{b().title}</h2>
						<p class="text-sm text-muted">{b().blurb}</p>
					</div>

					<Show when={import.meta.env.DEV}>
						<p class="rounded-md border border-accent p-2 text-sm">
							Dev build: Solid's dev runtime and HMR inflate every number. Use{" "}
							<code>vite build && vite preview</code> for figures you intend to
							compare.
						</p>
					</Show>

					<div class="flex flex-col gap-3">
						<For each={b().params}>
							{(param) => (
								<div class="flex flex-wrap items-center gap-2">
									<span class="w-44 text-sm text-muted">{param.label}</span>
									<For each={param.options}>
										{(option) => (
											<button
												type="button"
												class={[
													button,
													{ [selected]: current()[param.key] === option },
												]}
												disabled={status() !== "idle"}
												onClick={() =>
													setConfig({ ...current(), [param.key]: option })
												}
											>
												{option.toLocaleString()}
											</button>
										)}
									</For>
								</div>
							)}
						</For>
						<div class="flex flex-wrap items-center gap-2">
							<span class="w-44 text-sm text-muted">Sample for</span>
							<For each={DURATIONS}>
								{(option) => (
									<button
										type="button"
										class={[button, { [selected]: seconds() === option }]}
										disabled={status() !== "idle"}
										onClick={() => setSeconds(option)}
									>
										{option}s
									</button>
								)}
							</For>
						</div>
						<div>
							<button
								type="button"
								class={`${button} border-accent font-semibold`}
								disabled={status() !== "idle"}
								onClick={run}
							>
								{status() === "idle"
									? "Run"
									: status() === "mounting"
										? "Mounting…"
										: "Sampling…"}
							</button>
						</div>
					</div>

					<Show when={mounted()}>
						{(() => {
							const Scene = b().Scene;
							return (
								<Scene
									config={activeConfig}
									ready={(step) => onReady?.(step)}
								/>
							);
						})()}
					</Show>

					<Show when={result()}>
						{(r) => (
							<section class="rounded-xl border border-rule p-4">
								<div class="mb-3 flex items-baseline justify-between gap-2">
									<h3 class="font-semibold">Snapshot</h3>
									<button type="button" class={button} onClick={copy}>
										Copy JSON
									</button>
								</div>
								<dl class="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
									<div>
										<dt class="text-muted">Mount → first paint</dt>
										<dd class="tabular-nums">{ms(r().mountMs)}</dd>
									</div>
									<div>
										<dt class="text-muted">Frame rate</dt>
										<dd class="tabular-nums">
											{r().fps.toFixed(1)} fps{" "}
											<span class="text-muted">
												{delta(r().fps, previous()?.fps)}
											</span>
										</dd>
									</div>
									<div>
										<dt class="text-muted">Slow frames (&gt;25 ms)</dt>
										<dd class="tabular-nums">
											{r().slowFrames} / {r().frames}
										</dd>
									</div>
									<div>
										<dt class="text-muted">Heap change</dt>
										<dd class="tabular-nums">
											{r().heapDeltaMb === null
												? "n/a"
												: `${r().heapDeltaMb?.toFixed(1)} MB`}
										</dd>
									</div>
								</dl>
								<table class="w-full text-sm">
									<thead>
										<tr class="text-left text-muted">
											<th class="pb-1 font-normal">Phase</th>
											<th class="pb-1 font-normal">median</th>
											<th class="pb-1 font-normal">p95</th>
											<th class="pb-1 font-normal">max</th>
											<th class="pb-1 font-normal">vs last run</th>
										</tr>
									</thead>
									<tbody>
										<Row
											label="Frame interval"
											hint="Time between animation frames — what the user feels."
											now={r().frameMs}
											before={previous()?.frameMs}
										/>
										<Row
											label="Update"
											hint="step() + Solid flush: signal writes, memo recomputes, and the renderer's collect effect (incremental frame collector)."
											now={r().updateMs}
											before={previous()?.updateMs}
										/>
										<Row
											label="Paint"
											hint="The renderer's paint callback: Canvas2D command issuance only. GPU rasterisation happens after it returns and is not included."
											now={r().paintMs}
											before={previous()?.paintMs}
										/>
									</tbody>
								</table>
								<p class="mt-3 text-xs text-muted">
									{r().frames} frames over {r().seconds.toFixed(1)} s. "vs last
									run" compares medians against the previous run of this exact
									configuration, stored in this browser.
								</p>
							</section>
						)}
					</Show>
				</>
			)}
		</Show>
	);
}
