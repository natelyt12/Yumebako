import { getFromStore, saveToStore } from "/src/core/db.js";

const PICRE_STORAGE_KEY = "data:picre";

async function fetchImageBlob(url) {
    try {
        const response = await fetch(url, { mode: "cors" });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.blob();
    } catch (error) {
        console.error("[picreAPI] Error fetching image blob:", error);
        return null;
    }
}

/**
 * Fetch only the metadata of a random Picre image, without downloading the
 * file itself. Used by the Switcher to build lightweight cards in bulk.
 * @returns {Promise<{ image: string, source: string, width: number, height: number, file_size: number }>}
 */
export async function fetchPicreMeta() {
    const res = await fetch("https://pic.re/image.json");
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const raw = await res.json();
    if (!raw?.file_url) throw new Error("Invalid Picre response");
    return { ...raw, image: "https://" + raw.file_url };
}

async function fetchPicre() {
    const res = await fetch("https://pic.re/image.json");
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const raw = await res.json();
    const imageUrl = "https://" + raw.file_url;

    const imageBlob = await fetchImageBlob(imageUrl);

    const processed_data = {
        image: imageUrl,
        blob: imageBlob,
        source: raw.source,
        width: raw.width,
        height: raw.height,
        size: raw.file_size,
        last_updated: Date.now(),
    };
    return processed_data;
}

export async function getPicreData(refresh = false) {
    try {
        let picreData = await getFromStore(PICRE_STORAGE_KEY);

        if (!picreData || refresh) {
            picreData = await fetchPicre();
            await saveToStore(PICRE_STORAGE_KEY, picreData);
        } else if (!picreData.blob || !(picreData.blob instanceof Blob)) {
            const blob = await fetchImageBlob(picreData.image);
            if (blob) {
                picreData.blob = blob;
                await saveToStore(PICRE_STORAGE_KEY, picreData);
            } else {
                return null;
            }
        }

        return picreData;
    } catch (error) {
        console.error("[picreAPI] Error in getPicreData:", error);
        return null;
    }
}
