/**
 * The spec layer: what the scene hands the renderer (`DrawSpec` and its
 * parts), the bake steps that build specs from authored geometry, paints and
 * gradients, clip regions, layout maths and the text-metrics oracle. Pure:
 * no scene graph, no canvas (bar the offscreen `measureText` context).
 */

export * from "./bake.js";
export * from "./clip.js";
export * from "./colorRampProp.js";
export * from "./compile.js";
export * from "./gradient.js";
export * from "./layout.js";
export * from "./metrics.js";
export * from "./text-layout.js";
export * from "./types.js";
