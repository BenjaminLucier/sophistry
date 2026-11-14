/**
 * `@sophistry/box/definitions`: every definition the package's main entry
 * exports (`box`), keyed by export name. What `@sophistry/codegen` reads to
 * generate the framework bindings' components (`export const Box = wrap(box);`).
 *
 * @module @sophistry/box/definitions
 */

import { collectDefinitions } from "@sophistry/core/definitions";
import * as entry from "../index.js";

/**
 * Every definition `@sophistry/box` exports, by export name.
 *
 * @category Components
 */
export const definitions = collectDefinitions(entry);
