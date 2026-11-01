/**
 * `@sophistry/text/definitions`: every definition the package's main
 * entry exports (`mathTex`, `mathTransform`), keyed by export name. What
 * `@sophistry/codegen` reads to generate the framework bindings'
 * components (`export const MathTex = wrap(mathTex);`).
 *
 * Nothing is listed by hand: the record is collected from the main entry's
 * exports, as `@sophistry/core/definitions` collects core's. Kept off the
 * main entry on purpose (tree shaking, no import cycle).
 *
 * @module @sophistry/text/definitions
 */

import { collectDefinitions } from "@sophistry/core/definitions";
import * as entry from "../index.js";

/**
 * Every definition `@sophistry/text` exports, by export name.
 *
 * @category Components
 */
export const definitions = collectDefinitions(entry);
