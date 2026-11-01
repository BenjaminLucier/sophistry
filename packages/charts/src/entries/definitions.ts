/**
 * `@sophistry/charts/definitions`: every definition the package's main
 * entry exports, keyed by export name. What `@sophistry/codegen` reads
 * to generate the framework bindings' chart components (`export const
 * Scatter = wrap(scatter);`).
 *
 * Collected from the main entry's exports, so a definition is picked up as
 * soon as it is exported from `@sophistry/charts`. Kept off the main
 * entry: reading the whole module namespace would defeat tree shaking.
 *
 * @module @sophistry/charts/definitions
 */

import { collectDefinitions } from "@sophistry/core/definitions";
import * as entry from "../index.js";

/**
 * Every definition `@sophistry/charts` exports, by export name
 * (`{ chart, scatter, ... }`).
 *
 * @category Charts
 */
export const definitions = collectDefinitions(entry);
