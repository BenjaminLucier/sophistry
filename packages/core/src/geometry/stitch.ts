/**
 * Joins unordered segments (marching squares and triangles) into polylines by the
 * identity of their endpoints: callers key each endpoint by the edge or corner
 * it came from, so neighbours meet exactly with no tolerance. Internal.
 */

/** One connected run of segments. */
export interface StitchedRun<K> {
	/** Endpoint keys in walk order. A closed run does not repeat its first key. */
	keys: K[];
	/** Segment indices in walk order: `segments[i]` joins `keys[i]` to `keys[i + 1]` (wrapping, when closed). */
	segments: number[];
	/** Whether the run returns to where it started (and has at least three distinct steps). */
	closed: boolean;
}

/** Where `stitchSegments` starts its runs. */
export type StitchStart = "free-ends" | "in-order";

/**
 * Joins `pairs` (each a segment's two endpoint keys) into runs, walking from
 * key to key through unused segments; at a key shared by more than two
 * segments the walk takes the lowest-index unused one.
 *
 * - `"free-ends"` (the default): open runs come first, each walked from a free
 *   end (an odd-degree key, in order of first appearance), so none is split
 *   in the middle; the remaining segments form loops, each started at its
 *   lowest-index segment's first key and walked towards its second.
 * - `"in-order"`: runs come in the order of their lowest-index segment, each
 *   running in that segment's direction — extended forwards from its second
 *   key, then backwards from its first. A run's start and direction then
 *   follow the order segments were found in, which is what the charts'
 *   contours (and their reveals) have always drawn.
 *
 * In a field without branch points (every key on at most two segments) the
 * two give the same pieces and the same loops; only open runs' order and
 * direction differ.
 *
 * @param pairs - Segment endpoints as keys; equal keys (`SameValueZero`) are the same point. A segment may start and end at one key.
 * @param start - Where runs start.
 * @returns The runs, every segment in exactly one.
 */
export function stitchSegments<K>(
	pairs: readonly (readonly [K, K])[],
	start: StitchStart = "free-ends",
): StitchedRun<K>[] {
	const incident = new Map<K, number[]>();
	pairs.forEach(([a, b], index) => {
		for (const key of [a, b]) {
			const list = incident.get(key);
			if (list) list.push(index);
			else incident.set(key, [index]);
		}
	});
	const used = new Array<boolean>(pairs.length).fill(false);

	/** Walks from `from` until stuck, reporting each segment and the key it reaches. */
	const extend = (from: K, step: (segment: number, key: K) => void) => {
		let at = from;
		for (;;) {
			const next = incident.get(at)?.find((s) => !used[s]);
			if (next === undefined) return;
			used[next] = true;
			const [a, b] = pairs[next];
			at = a === at ? b : a;
			step(next, at);
		}
	};

	const finish = (keys: K[], segments: number[]): StitchedRun<K> => {
		const closed = keys.length > 3 && keys[keys.length - 1] === keys[0];
		if (closed) keys.pop();
		return { keys, segments, closed };
	};

	const walk = (from: K): StitchedRun<K> => {
		const keys = [from];
		const segments: number[] = [];
		extend(from, (segment, key) => {
			segments.push(segment);
			keys.push(key);
		});
		return finish(keys, segments);
	};

	const runs: StitchedRun<K>[] = [];
	if (start === "in-order") {
		for (let index = 0; index < pairs.length; index++) {
			if (used[index]) continue;
			used[index] = true;
			const [a, b] = pairs[index];
			const keys = [a, b];
			const segments = [index];
			extend(b, (segment, key) => {
				segments.push(segment);
				keys.push(key);
			});
			extend(a, (segment, key) => {
				segments.unshift(segment);
				keys.unshift(key);
			});
			runs.push(finish(keys, segments));
		}
		return runs;
	}
	for (const [key, list] of incident) {
		if (list.length % 2 === 1 && list.some((s) => !used[s])) {
			runs.push(walk(key));
		}
	}
	for (let index = 0; index < pairs.length; index++) {
		if (!used[index]) runs.push(walk(pairs[index][0]));
	}
	return runs;
}
