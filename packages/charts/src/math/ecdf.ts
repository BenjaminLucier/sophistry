import { finiteValues } from "@sophistry/core/internal";
/** Empirical CDF: a step function rising from 0 to 1 by `1/n` at each observed value. */

/**
 * Step data shaped for `stairsPolyline`/`<Stairs>`: `edges.length === values.length + 1`.
 *
 * @category Math & helpers
 */
export interface EcdfSteps {
	edges: number[];
	values: number[];
}

/** @category Math */
export interface EcdfOptions {
	/**
	 * Padding left of the smallest value and right of the largest, in data units. Defaults to 5% of
	 * the data's span (0.5 when the span is 0).
	 */
	pad?: number;
}

/**
 * `EcdfOptions.pad`'s fraction-of-span default.
 *
 * @category Math & helpers
 */
export const DEFAULT_ECDF_PAD_FRACTION = 0.05;
/**
 * `EcdfOptions.pad`'s fallback when the data's span is 0 (every value identical).
 *
 * @category Math & helpers
 */
export const DEFAULT_ECDF_PAD_FALLBACK = 0.5;

/**
 * The step function of the empirical CDF of `values`, over the sorted unique
 * finite values `u_1 < … < u_k`: `edges = [u_1 - pad, u_1, …, u_k, u_k + pad]`
 * and `values = [0, F(u_1), …, F(u_k)]`, so the curve is 0 before `u_1`,
 * jumps at each value, and ends at 1.
 *
 * @param values - The sample; non-finite entries are dropped.
 * @returns `edges` and `values` for {@link stairsPolyline}; both empty when no finite value remains.
 * @category Math & helpers
 */
export function ecdfSteps(
	values: readonly number[],
	options: EcdfOptions = {},
): EcdfSteps {
	const finite = finiteValues(values);
	const total = finite.length;
	if (total === 0) return { edges: [], values: [] };

	const sorted = [...finite].sort((a, b) => a - b);
	const unique: number[] = [];
	for (const v of sorted) {
		if (unique.length === 0 || unique[unique.length - 1] !== v) {
			unique.push(v);
		}
	}
	const k = unique.length;

	const span = unique[k - 1] - unique[0];
	const pad =
		options.pad ??
		(span > 0 ? span * DEFAULT_ECDF_PAD_FRACTION : DEFAULT_ECDF_PAD_FALLBACK);

	const edges: number[] = [unique[0] - pad, ...unique, unique[k - 1] + pad];

	// F(u_{i+1}) = (count of finite values <= u_{i+1}) / total. Since `sorted`
	// is ascending, this is just the position just past the last occurrence
	// of u_{i+1} in `sorted`.
	const cdfValues: number[] = new Array(k + 1);
	cdfValues[0] = 0;
	let searchFrom = 0;
	for (let i = 0; i < k; i++) {
		const u = unique[i];
		let count = searchFrom;
		while (count < total && sorted[count] <= u) count++;
		cdfValues[i + 1] = count / total;
		searchFrom = count;
	}

	return { edges, values: cdfValues };
}
