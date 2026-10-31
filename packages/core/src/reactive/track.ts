/**
 * The core's reactive primitives: `track` (a writable value) and `derive` (a
 * value computed from others). They exist for the dependencies that cannot be
 * known ahead of time (a prop bound to user state, a label following a
 * slider); a node's own dependencies are fixed and live in its dirty bits.
 *
 * The model is push-stale, pull-value. `set` tells subscribers synchronously
 * that something *may* have changed; a subscriber only marks (a node puts
 * itself on the scene's dirty list) and never computes. Values are computed
 * when read, by `peek()`, so three writes in a frame cost one recompute and a
 * diamond of derivations never shows a mix of old and new inputs.
 *
 * There is no global graph, no owner tree and no flush: a subscription lives
 * until its `unsubscribe` is called, and `derive` holds no subscriptions of its
 * own, so an unused derivation is garbage like any other object.
 */

/**
 * A value that can be read and watched. {@link Track}s and {@link derive}d
 * values are Readables; a node prop given a Readable follows it.
 *
 * @typeParam T - The value type.
 *
 * @category Reactivity
 */
export interface Readable<T> {
	/** The current value. Never subscribes the caller. */
	peek(): T;
	/**
	 * Calls `onStale` whenever the value may have changed. `onStale` must not
	 * compute or write; it should only mark something for the next commit
	 * and read with {@link Readable.peek} then.
	 *
	 * @returns A function that ends the subscription.
	 */
	subscribe(onStale: () => void): () => void;
}

/**
 * A writable {@link Readable}. Animations drive tracks (a track is an
 * `Animatable`), and anything bound to one follows it without re-running
 * framework code.
 *
 * @typeParam T - The value type.
 *
 * @category Reactivity
 */
export interface Track<T> extends Readable<T> {
	/** Writes a value; subscribers are told when it differs from the current one. */
	set(value: T): void;
}

/**
 * Options for {@link track}.
 *
 * @category Reactivity
 */
export interface TrackOptions<T> {
	/**
	 * When a write counts as a change. Defaults to `Object.is`; `false`
	 * notifies on every write.
	 */
	equals?: false | ((previous: T, next: T) => boolean);
}

/** Marks objects built by this module, so {@link isReadable} need not guess from shape. */
const READABLE = Symbol("sophistry.readable");

/**
 * A writable value with subscribers.
 *
 * @example
 * ```ts
 * import { track } from "@sophistry/core";
 *
 * const progress = track(0);
 * const stop = progress.subscribe(() => console.log("now", progress.peek()));
 * progress.set(0.5); // logs "now 0.5"
 * stop();
 * ```
 *
 * @param initial - The starting value.
 * @param options - See {@link TrackOptions}.
 * @returns The track.
 * @category Reactivity
 */
export function track<T>(initial: T, options: TrackOptions<T> = {}): Track<T> {
	let value = initial;
	const equals = options.equals ?? Object.is;
	// A Set keeps unsubscribing O(1); notification copies nothing, so a
	// subscriber that unsubscribes while being notified is simply skipped.
	const subscribers = new Set<() => void>();
	return {
		[READABLE]: true,
		peek: () => value,
		set(next) {
			if (equals !== false && equals(value, next)) return;
			value = next;
			for (const onStale of subscribers) onStale();
		},
		subscribe(onStale) {
			subscribers.add(onStale);
			return () => {
				subscribers.delete(onStale);
			};
		},
	} as Track<T>;
}

/** The values of a tuple of Readables, in order. */
export type ValuesOf<S extends readonly Readable<unknown>[]> = {
	[K in keyof S]: S[K] extends Readable<infer T> ? T : never;
};

/**
 * A value computed from other Readables, recomputed lazily: reading it peeks
 * its sources and reruns `compute` only when one of them returned something
 * different (by `Object.is`) since the last read. Subscribing to it subscribes
 * to its sources.
 *
 * `compute` should be pure. It always sees a consistent set of inputs, since
 * the inputs are read together at the moment of the read.
 *
 * @example
 * ```ts
 * import { derive, track } from "@sophistry/core";
 *
 * const t = track(0);
 * const label = derive(t, (value) => `t = ${value.toFixed(2)}`);
 * const area = derive([track(2), track(3)], (width, height) => width * height);
 * ```
 *
 * @param source - One Readable, or a tuple of them (`sources`).
 * @param compute - Maps the source values to the derived value.
 * @returns The derived Readable.
 * @category Reactivity
 */
export function derive<S, T>(
	source: Readable<S>,
	compute: (value: S) => T,
): Readable<T>;
export function derive<const S extends readonly Readable<unknown>[], T>(
	sources: S,
	compute: (...values: ValuesOf<S>) => T,
): Readable<T>;
export function derive(
	sources: Readable<unknown> | readonly Readable<unknown>[],
	compute: (...values: unknown[]) => unknown,
): Readable<unknown> {
	if (isReadable(sources)) return deriveOne(sources, compute);
	const list = sources;
	let inputs: unknown[] | null = null;
	let cached: unknown;
	return {
		[READABLE]: true,
		peek() {
			// Compares in place and builds the argument array only from the first
			// input that moved (the ones before it are the same values): a read
			// whose inputs did not move allocates nothing. Each source is peeked
			// once.
			let next: unknown[] | null = inputs ? null : [];
			for (let i = 0; i < list.length; i++) {
				const value = (list[i] as Readable<unknown>).peek();
				if (next) next[i] = value;
				else if (!Object.is(value, (inputs as unknown[])[i])) {
					next = (inputs as unknown[]).slice(0, i);
					next[i] = value;
				}
			}
			if (next) {
				cached = compute(...next);
				inputs = next;
			}
			return cached;
		},
		subscribe(onStale) {
			const stops = list.map((source) => source.subscribe(onStale));
			return () => {
				for (const stop of stops) stop();
			};
		},
	} as Readable<unknown>;
}

/**
 * `derive` over one source: the common case (a prop following one track),
 * kept free of arrays so a read allocates nothing but what `compute` returns.
 */
function deriveOne(
	source: Readable<unknown>,
	compute: (value: unknown) => unknown,
): Readable<unknown> {
	let computed = false;
	let input: unknown;
	let cached: unknown;
	return {
		[READABLE]: true,
		peek() {
			const value = source.peek();
			if (!computed || !Object.is(value, input)) {
				cached = compute(value);
				input = value;
				computed = true;
			}
			return cached;
		},
		subscribe: (onStale) => source.subscribe(onStale),
	} as Readable<unknown>;
}

/**
 * Whether `value` is a {@link Readable}: something built by {@link track} or
 * {@link derive}, or any object with `peek` and `subscribe` methods.
 *
 * @param value - Anything.
 * @returns True for a Readable.
 * @category Reactivity
 */
export function isReadable(value: unknown): value is Readable<unknown> {
	if (typeof value !== "object" || value === null) return false;
	if (READABLE in value) return true;
	const candidate = value as Partial<Readable<unknown>>;
	return (
		typeof candidate.peek === "function" &&
		typeof candidate.subscribe === "function"
	);
}
