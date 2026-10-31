/** Vite's `?url` suffix, which the KaTeX font table leans on. */
declare module "*.ttf?url&no-inline" {
	const src: string;
	export default src;
}

/** KaTeX's stylesheet, imported for its side effect — it is the layout. */
declare module "*.css";
