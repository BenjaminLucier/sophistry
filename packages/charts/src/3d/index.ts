/**
 * `@sophistry/charts/3d`: charts drawn through a `camera3D` from
 * `@sophistry/3d` (an optional peer). In these charts `z` is a data
 * channel; `zIndex` is the paint order, forwarded to every drawn node.
 *
 * Charts of many marks (`barChart3D`, `quiver3D`, `scatter3D`, `stem3D`,
 * `wireframe3D`) are composites over the 3D primitives, one per datum or
 * segment; surfaces (`surfaceGrid3D`, `triSurface3D`, `voxels3D`) are one
 * mesh each. Either way a camera move only re-projects: the chart's world
 * geometry is rebuilt when its data changes.
 *
 * @module @sophistry/charts/3d
 * @packageDocumentation
 */

export type { BarChart3DProps } from "./bar-chart3d";
export { barChart3D } from "./bar-chart3d";
export type { Quiver3DProps } from "./quiver3d";
export { quiver3D } from "./quiver3d";
export type { Scatter3DProps } from "./scatter3d";
export { scatter3D } from "./scatter3d";
export type { Stem3DProps } from "./stem3d";
export { stem3D } from "./stem3d";
export type { SurfaceGrid3DProps } from "./surface-grid3d";
export { surfaceGrid3D } from "./surface-grid3d";
export type { TriSurface3DProps } from "./tri-surface3d";
export { triSurface3D } from "./tri-surface3d";
export type { Voxels3DProps } from "./voxels3d";
export { voxels3D } from "./voxels3d";
export type { Wireframe3DProps } from "./wireframe3d";
export { wireframe3D } from "./wireframe3d";
