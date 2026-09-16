export { BaseSource } from "./BaseSource.js";
export { RemoteSource } from "./RemoteSource.js";
export { SOURCE_ACTIONS } from "./sourceActions.js";
export { CollectionSource } from "./CollectionSource.js";
export { WallhavenSource } from "./WallhavenSource.js";
export { UnsplashSource } from "./UnsplashSource.js";
export { PicreSource } from "./PicreSource.js";
/**
 * Sources barrel: the single entry point the switcher needs — the factory that
 * instantiates every source (see ./registry.js).
 */
export { createSources } from "./registry.js";
