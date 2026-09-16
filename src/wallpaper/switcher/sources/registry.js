import { CollectionSource } from "./CollectionSource.js";
import { WallhavenSource } from "./WallhavenSource.js";
import { UnsplashSource } from "./UnsplashSource.js";
import { PicreSource } from "./PicreSource.js";

/**
 * SourceRegistry.js
 * ---------------------------------------------------------------------------
 * Single place declaring which sources the Wallpaper Switcher exposes and in
 * which order their tabs are rendered.
 *
 * To add a source: implement a `BaseSource` subclass and list it here.
 */
export const SOURCE_CLASSES = [CollectionSource, WallhavenSource, UnsplashSource, PicreSource];

/** @type {Record<string, typeof import("./BaseSource.js").BaseSource>} */
export const SOURCE_REGISTRY = Object.fromEntries(SOURCE_CLASSES.map((SourceClass) => [SourceClass.id, SourceClass]));

/** Instantiate a fresh set of source adapters (one per registry entry). */
export function createSources() {
    return SOURCE_CLASSES.map((SourceClass) => new SourceClass());
}
