/**
 * `@sophistry/3d`: a perspective `camera3D`, flat-shaded meshes,
 * depth-sorted projection into the same 2D specs every other shape emits,
 * and the 3D primitives built on them. The renderer never learns 3D exists.
 *
 * @module @sophistry/3d
 * @packageDocumentation
 */

export { boxFaces } from "./box";
export type { Camera3DProps } from "./camera3d";
export { Camera3DNode, camera3D } from "./camera3d";
export type { Camera3DValue } from "./context";
export { camera3DContext, requireCamera3D } from "./context";
export type { DepthItem, DepthSorter, DepthSource } from "./depth-sort";
export { MAX_DEPTH_PAIRS, sortByDepth } from "./depth-sort";
export type {
	Mesh3DOptions,
	Mesh3DProps,
	MeshFacesProps,
	PreparedFace,
} from "./mesh";
export {
	defineMesh3D,
	mesh3DProps,
	meshFaces,
	prepareFaces,
	projectFaces,
} from "./mesh";
export type { MeshFace, MeshLight } from "./mesh-math";
export {
	cross3,
	dot3,
	isFrontFacing,
	normalize3,
	subtract3,
} from "./mesh-math";
export type {
	OrbitControls3DController,
	OrbitControls3DHandlers,
	OrbitControls3DOptions,
	OrbitControls3DSceneOptions,
} from "./orbit-controls";
export { orbitControls3D, orbitControlsHandlers } from "./orbit-controls";
export type { PlatonicSolid } from "./polyhedra";
export {
	convexHullFaces,
	orientFaces,
	PLATONIC_SOLIDS,
	polyhedronMeshFaces,
} from "./polyhedra";
export type { Axes3DProps, Axis3DTickOptions } from "./primitives/axes3d";
export { axes3D } from "./primitives/axes3d";
export type { Cone3DProps } from "./primitives/cone3d";
export { cone3D } from "./primitives/cone3d";
export type { Curve3DProps } from "./primitives/curve3d";
export { curve3D } from "./primitives/curve3d";
export type { Cylinder3DProps } from "./primitives/cylinder3d";
export { cylinder3D } from "./primitives/cylinder3d";
export type { Grid3DProps, GridLines, GridPlane } from "./primitives/grid3d";
export { grid3D, gridLineCount } from "./primitives/grid3d";
export type { Line3DProps } from "./primitives/line3d";
export { line3D } from "./primitives/line3d";
export type {
	ConvexHull3DProps,
	PlatonicSolid3DProps,
	Polyhedron3DProps,
} from "./primitives/polyhedron3d";
export {
	convexHull3D,
	dodecahedron3D,
	icosahedron3D,
	octahedron3D,
	polyhedron3D,
	tetrahedron3D,
} from "./primitives/polyhedron3d";
export type { Cube3DProps, Prism3DProps } from "./primitives/prism3d";
export { cube3D, prism3D } from "./primitives/prism3d";
export type { Dot3DProps, Sphere3DProps } from "./primitives/sphere3d";
export { dot3D, sphere3D } from "./primitives/sphere3d";
export type { SurfacePlot3DProps } from "./primitives/surface-plot3d";
export { surfaceFaces, surfacePlot3D } from "./primitives/surface-plot3d";
export type { Torus3DProps } from "./primitives/torus3d";
export { torus3D } from "./primitives/torus3d";
export type { Vector3DProps, VectorEnds } from "./primitives/vector3d";
export { vector3D } from "./primitives/vector3d";
export type { ProjectedPoint } from "./project";
export { clipSegment, depthZ, projectPoint, projectScale } from "./project";
export type { Shape3DProps } from "./props3d";
export { shape3DProps } from "./props3d";
export type { Axis } from "./ring";
export { axisVector, ringPoints } from "./ring";
export type { ProjectedPiece, Shape3DOptions } from "./shape3d";
export { defineShape3D, Shape3DNode } from "./shape3d";
