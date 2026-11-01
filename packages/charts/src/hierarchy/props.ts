/**
 * The props descriptor the zoomable hierarchy charts share: every base,
 * transition and drill prop reruns `update`, plus each chart's own. Internal
 * to the family.
 */

import type { PropsDescriptor } from "@sophistry/core";
import { Invalidate } from "@sophistry/core";
import { DRILL_PROP_KEYS } from "./drill.js";
import { HIERARCHY_PROP_KEYS } from "./shared.js";

/**
 * A hierarchy chart's props descriptor: the shared keys and `own`, each
 * rerunning `update` when written (`progress` defaults to 1).
 *
 * @internal
 */
export function hierarchyPropsDescriptor<P extends object>(
	own: readonly (keyof P & string)[],
): PropsDescriptor<P> {
	const out: Record<string, { default?: unknown; invalidates: number }> = {};
	for (const key of [...HIERARCHY_PROP_KEYS, ...DRILL_PROP_KEYS, ...own])
		out[key] = { invalidates: Invalidate.UPDATE };
	out.progress = { default: 1, invalidates: Invalidate.UPDATE };
	return out as unknown as PropsDescriptor<P>;
}
