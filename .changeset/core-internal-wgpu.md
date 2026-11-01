---
"@sophistry/core": patch
---

`@sophistry/core/internal` no longer re-exports `mat4` and `vec3` from `wgpu-matrix`; import them from `wgpu-matrix` directly. (`/internal` is not covered by semver.) This keeps `wgpu-matrix`'s own declarations, which fail under `nodenext` resolution, out of the published types.
