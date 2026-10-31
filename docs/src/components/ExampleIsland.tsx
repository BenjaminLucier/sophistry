import type { JSX } from "@solidjs/web";
import { Dynamic } from "@solidjs/web";
import type { Clock } from "@sophistry/core";
import { createClock } from "@sophistry/core";
import { ClockProvider, useTrackValue } from "@sophistry/solidjs";
import { createSignal, Errored, onSettled, Show, untrack } from "solid-js";
import { captureMode, publishCapture } from "./capture";

type ExampleComponent = () => JSX.Element;
/**
 * A framework-free example's default export (`src/examples/vanilla/*.ts`):
 * builds its scene in `host`, on `clock`, and returns its cleanup.
 */
type MountFunction = (host: HTMLElement, clock?: Clock) => () => void;
type Loader = () => Promise<{ default: ExampleComponent | MountFunction }>;

// Every example module, lazily: each becomes its own chunk, fetched only when
// its island scrolls near the viewport. Solid examples are `.tsx`, plain
// TypeScript ones `.ts`.
const loaders = import.meta.glob<{
	default: ExampleComponent | MountFunction;
}>("../examples/*/*.{ts,tsx}");

/** The loader of an example ("basic/UnitCircle"), and whether it is plain TypeScript. */
function loaderFor(
	name: string,
): { load: Loader; vanilla: boolean } | undefined {
	const solid = loaders[`../examples/${name}.tsx`];
	if (solid) return { load: solid as Loader, vanilla: false };
	const vanilla = loaders[`../examples/${name}.ts`];
	return vanilla ? { load: vanilla as Loader, vanilla: true } : undefined;
}

/**
 * Hosts a framework-free example: a `<div>` its mount function builds the
 * scene in once the island has settled, on the island's clock; the returned
 * cleanup runs when the island unmounts or restarts.
 */
function Vanilla(props: { mount: MountFunction; clock: Clock }) {
	const host = (<div />) as HTMLDivElement;
	const mount = untrack(() => props.mount);
	const clock = untrack(() => props.clock);
	onSettled(() => mount(host, clock));
	return host;
}

const box = {
	"aspect-ratio": "16 / 9",
	width: "100%",
	display: "flex",
	"align-items": "center",
	"justify-content": "center",
	"box-sizing": "border-box",
	"border-radius": "0.5rem",
} as const;

function ErrorBox(props: { message: string }) {
	return (
		<div
			role="alert"
			style={{
				...box,
				padding: "1rem",
				border: "1px solid #e5484d",
				background: "rgba(229, 72, 77, 0.1)",
				color: "inherit",
				"text-align": "center",
			}}
		>
			<span>Example failed to load: {props.message}</span>
		</div>
	);
}

/**
 * Loads and renders one example; throws (caught by the boundary) on failure.
 * Shows `placeholder` until the module has arrived, so the stage's space stays
 * reserved while its chunk loads.
 */
function Loaded(props: {
	load: Loader;
	vanilla: boolean;
	clock: Clock;
	placeholder: () => JSX.Element;
}) {
	const [Comp, setComp] = createSignal<ExampleComponent | undefined>();
	const [failure, setFailure] = createSignal<unknown>();
	onSettled(() => {
		props.load().then(
			(m) => {
				const exported = m.default;
				if (!props.vanilla) setComp(() => exported as ExampleComponent);
				else {
					const mount = exported as MountFunction;
					const clock = props.clock;
					setComp(() => () => <Vanilla mount={mount} clock={clock} />);
				}
			},
			(e) => setFailure(() => e),
		);
	});
	return (
		<Show
			when={failure()}
			fallback={
				<Show when={Comp()} fallback={props.placeholder()}>
					{(C) => <Dynamic component={C()} />}
				</Show>
			}
		>
			{(e) => <ErrorBox message={String((e() as Error)?.message ?? e())} />}
		</Show>
	);
}

/**
 * How close to the viewport an example's stage mounts, and how far from it
 * the stage unmounts again. The gap between the two keeps a stage from
 * remounting on every small scroll back and forth; a long gallery page keeps
 * only the few stages around the viewport alive.
 */
const MOUNT_MARGIN = "800px 0px";
const UNMOUNT_MARGIN = "2400px 0px";

/** How long the clock must sit idle before a run counts as finished, in ms. */
const IDLE_MS = 900;

/**
 * A clock of the example's own, plus a live count of the runs ticking on it,
 * so the controls can tell a finished animation from one in flight.
 *
 * In capture mode (see `capture.ts`) the clock starts paused and ignores the
 * reduced-motion preference: the capture suite advances it by hand.
 */
function createExampleClock(
	onBusy: (busy: boolean) => void,
	capture: boolean,
): Clock & { active(): number } {
	const clock = createClock(
		capture ? { reducedMotion: "no-preference" } : undefined,
	);
	if (capture) clock.pause();
	let active = 0;
	const report = () => queueMicrotask(() => onBusy(active > 0));
	return {
		...clock,
		active: () => active,
		onTick(listener) {
			const unsubscribe = clock.onTick(listener);
			active++;
			report();
			let live = true;
			return () => {
				if (!live) return;
				live = false;
				unsubscribe();
				active--;
				report();
			};
		},
	};
}

function Icon(props: { d: string }) {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d={props.d} />
		</svg>
	);
}

const ICONS = {
	play: "M4.5 2.8v10.4L13 8z",
	pause: "M4 2.5h3v11H4zM9 2.5h3v11H9z",
	restart: "M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.4.5A4 4 0 1 0 8 4v2L4.8 3.2 8 .5z",
	loop: "M4 5h6.5V3L14 6l-3.5 3V7H4v2.5H2.5V6.5A1.5 1.5 0 0 1 4 5zm8 6H5.5v2L2 10l3.5-3v2H12V6.5h1.5v3A1.5 1.5 0 0 1 12 11z",
};

/**
 * Mounts a gallery example (`name` like "basic/UnitCircle") once it is near the
 * viewport, and unmounts it again once it is far off screen, so a page of
 * eighty examples runs only the handful in view. Until it mounts, and while
 * its module loads, a placeholder holds its space: the stage's own aspect ratio
 * (`aspect`, read from the source at build time) at first, then the height it
 * last had. In capture mode every example mounts at once and stays mounted.
 *
 * Each example runs on a clock of its own, driven by the controls above it:
 * pause and resume, restart (which remounts it), and loop (which restarts it
 * once its animation has settled).
 */
export function ExampleIsland(props: { name: string; aspect?: number }) {
	// The example name is fixed for an island's lifetime, so read it once.
	const name = untrack(() => props.name);
	const aspect = untrack(() => props.aspect) ?? 16 / 9;
	const loader = loaderFor(name);
	const capture = captureMode();
	const [visible, setVisible] = createSignal(capture);
	/** The stage area's height when it last unmounted, in CSS pixels. */
	const [reserved, setReserved] = createSignal<number | undefined>();
	const [run, setRun] = createSignal(0);
	const [busy, setBusy] = createSignal(false);
	const [animated, setAnimated] = createSignal(false);
	const [finished, setFinished] = createSignal(false);
	const [loop, setLoop] = createSignal(false);
	let host: HTMLDivElement | undefined;
	let slot: HTMLDivElement | undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;

	/** Remembers the stage's height, for the placeholder that replaces it. */
	const measure = () => {
		const height = slot?.offsetHeight;
		if (height) setReserved(height);
	};

	const restart = () => {
		clearTimeout(idleTimer);
		measure();
		setFinished(false);
		if (!capture) clock.resume();
		setRun((n) => n + 1);
	};

	const clock = createExampleClock((now) => {
		clearTimeout(idleTimer);
		setBusy(now);
		if (now) {
			setAnimated(true);
			setFinished(false);
			return;
		}
		idleTimer = setTimeout(() => {
			setFinished(true);
			if (loop() && !clock.paused.peek()) restart();
		}, IDLE_MS);
	}, capture);

	const toggle = () => {
		if (finished() && !busy()) restart();
		else clock.toggle();
	};
	const paused = useTrackValue(clock.paused);
	const playing = () => busy() && !paused();

	onSettled(() =>
		capture ? publishCapture(name, clock.advance, clock.active) : undefined,
	);

	onSettled(() => {
		if (capture || !host) return;
		if (typeof IntersectionObserver === "undefined") {
			setVisible(true);
			return;
		}
		const near = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) setVisible(true);
			},
			{ rootMargin: MOUNT_MARGIN },
		);
		const far = new IntersectionObserver(
			(entries) => {
				if (entries.at(-1)?.isIntersecting !== false || !visible()) return;
				measure();
				setVisible(false);
			},
			{ rootMargin: UNMOUNT_MARGIN },
		);
		near.observe(host);
		far.observe(host);
		// Solid 2 forbids `onCleanup` here: return the cleanup instead.
		return () => {
			near.disconnect();
			far.disconnect();
			clearTimeout(idleTimer);
		};
	});

	const Placeholder = () => (
		<div
			class="sophistry-placeholder"
			style={
				reserved()
					? { ...box, "aspect-ratio": "auto", height: `${reserved()}px` }
					: { ...box, "aspect-ratio": String(aspect) }
			}
		>
			Loading example…
		</div>
	);

	return (
		<div ref={host} class="sophistry-island">
			{loader ? (
				<>
					<div class="sophistry-controls" role="toolbar" aria-label="Playback">
						{/* Static examples, and ones driving a clock of their own, get Restart only. */}
						<Show when={animated()}>
							<button
								type="button"
								onClick={toggle}
								aria-label={playing() ? "Pause" : "Play"}
							>
								<Icon d={playing() ? ICONS.pause : ICONS.play} />
								<span>{playing() ? "Pause" : "Play"}</span>
							</button>
							<button
								type="button"
								aria-pressed={loop() ? "true" : "false"}
								onClick={() => {
									const next = !loop();
									setLoop(next);
									if (next && finished() && !busy()) restart();
								}}
							>
								<Icon d={ICONS.loop} />
								<span>Loop</span>
							</button>
						</Show>
						<button type="button" onClick={restart} aria-label="Restart">
							<Icon d={ICONS.restart} />
							<span>Restart</span>
						</button>
					</div>
					<div ref={slot}>
						<Show when={visible()} fallback={<Placeholder />}>
							<Errored
								fallback={(e) => (
									<ErrorBox message={String((e() as Error)?.message ?? e())} />
								)}
							>
								<ClockProvider clock={clock}>
									{/* A fresh object per restart remounts the example. */}
									<Show when={{ run: run() }} keyed>
										{(_) => (
											<Loaded
												load={loader.load}
												vanilla={loader.vanilla}
												clock={clock}
												placeholder={Placeholder}
											/>
										)}
									</Show>
								</ClockProvider>
							</Errored>
						</Show>
					</div>
				</>
			) : (
				<ErrorBox message={`unknown example "${name}"`} />
			)}
		</div>
	);
}
