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
