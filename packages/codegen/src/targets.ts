/**
 * What codegen generates: for every binding, one file per source package.
 *
 * A source package exposes its definitions at `<package>/definitions`
 * (`export const definitions = { circle, ... }`, keyed by export name; see
 * `@sophistry/core/definitions`). A package without that subpath yet
 * (or not installed) generates an empty entry, so the bindings' `./text`,
 * `./charts` subpaths exist before their component layers do.
 */

/** A package whose definitions become components. */
export interface SourcePackage {
	/** The npm name, imported by the generated files. */
	name: string;
	/** The generated file's base name in each binding (`core` → `core.gen.ts`). */
	file: string;
}

/** A framework binding the components are generated into. */
export interface Binding {
	/** The npm name, for messages. */
	name: string;
	/** The package folder, relative to the repository's `packages/`. */
	folder: string;
	/**
	 * Names the binding's hand-written entry exports, which no generated
	 * component (or its `<Name>Props` type) may take.
	 */
	reserved: readonly string[];
}

/** Where the generated files go inside a binding, relative to its folder. */
export const GENERATED_DIRECTORY = "src/generated";

/** The module the generated files import `wrap` and `ComponentProps` from, relative to them. */
export const WRAP_MODULE = "../wrap";

export const sourcePackages: readonly SourcePackage[] = [
	{ name: "@sophistry/core", file: "core" },
	{ name: "@sophistry/text", file: "text" },
	{ name: "@sophistry/charts", file: "charts" },
	{ name: "@sophistry/3d", file: "3d" },
	// 3D charts: their own entry, so a binding's `./charts` never needs `@sophistry/3d`.
	{ name: "@sophistry/charts/3d", file: "charts3d" },
];

/** Hand-written components and types both bindings export from `.`. */
const sharedReserved = [
	"Stage",
	"StageProps",
	"MultiStage",
	"MultiStageProps",
	"Camera",
	"CameraProps",
	"CameraPaneProps",
	"SplitScreen",
	"SplitScreenProps",
	"PictureInPicture",
	"PictureInPictureProps",
	"QuadView",
	"QuadViewProps",
	"PanZoom",
	"PanZoomProps",
	"UsePanZoomOptions",
	"ClockProvider",
	"ClockProviderProps",
	"ComponentProps",
];

export const bindings: readonly Binding[] = [
	{
		name: "@sophistry/solidjs",
		folder: "solidjs",
		reserved: [
			...sharedReserved,
			"UsePlayerOptions",
			"UsePlayerResult",
			"UseMovablePointOptions",
			"UseMovablePointResult",
		],
	},
	{
		name: "@sophistry/react",
		folder: "react",
		reserved: [
			...sharedReserved,
			"SophistryComponent",
			"Player",
			"PlayerOptions",
			"MovablePoint",
			"Instances",
			"InstancesProps",
		],
	},
];

/**
 * Component names to use instead of a definition's own `name`, by package
 * and export name. The way out of a collision (two definitions with one
 * name, or one taking a reserved name).
 *
 * @example
 * ```ts
 * { "@sophistry/core": { camera: "CameraNode" } }
 * ```
 */
export const renames: Readonly<
	Record<string, Readonly<Record<string, string>>>
> = {};
