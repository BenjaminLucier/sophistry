/**
 * The spec layer: what the scene hands the renderer (`DrawSpec` and its
 * parts), the bake steps that build specs from authored geometry, paints and
 * gradients, clip regions, layout maths and the text-metrics oracle. Pure:
 * no scene graph, no canvas (bar the offscreen `measureText` context).
 */

export * from "./bake";
export * from "./clip";
export * from "./colorRampProp";
export * from "./compile";
export * from "./gradient";
export * from "./layout";
export * from "./metrics";
export * from "./types";
