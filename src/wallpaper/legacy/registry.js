import { WallhavenProvider } from "./providers/wallhaven/WallhavenProvider.js";
import { PicreProvider } from "./providers/picre/PicreProvider.js";
import { CollectionProvider } from "./providers/collection/CollectionProvider.js";
import { UnsplashProvider } from "./providers/unsplash/UnsplashProvider.js";

export const PROVIDER_REGISTRY = {
    [WallhavenProvider.prototype.constructor.name]: WallhavenProvider,
    wallhaven: WallhavenProvider,
    picre: PicreProvider,
    collection: CollectionProvider,
    unsplash: UnsplashProvider,
};
