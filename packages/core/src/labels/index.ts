/**
 * Labels: numbers as scene objects (`decimalNumber`, `integer`, `variable`,
 * with the formatting and glyph layout under them) and text presets
 * (`bulletedList`, `title`). `text` and `defineText` live with the text node
 * kind in `scene/text.ts`.
 */

export * from "./decimal-number.js";
export * from "./digits.js";
export { TextLayoutNode } from "./text-layout.js";
export * from "./text-presets.js";
