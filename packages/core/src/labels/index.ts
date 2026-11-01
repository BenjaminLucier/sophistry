/**
 * Labels: numbers as scene objects (`decimalNumber`, `integer`, `variable`,
 * with the formatting and glyph layout under them) and multi-line text
 * (`paragraph`, `bulletedList`, `title`). The single-line `label` and
 * `defineText` live with the text node kind in `scene/text.ts`.
 */

export * from "./decimal-number.js";
export * from "./digits.js";
export * from "./paragraph.js";
export { TextLayoutNode } from "./text-layout.js";
