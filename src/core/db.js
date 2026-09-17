const DB_NAME = "BakoDB";
const DB_VERSION = 2;
const STORE_NAME = "appData";
const MEDIA_STORE_NAME = "mediaData";

let db = null;

/**
 * Open or retrieve the application's IndexedDB instance.
 * @returns {Promise<IDBDatabase>} A promise that resolves to the IndexedDB database instance.
 */
async function getDB() {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("IndexedDB error:", event.target.error);
            reject("Error opening database");
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "key" });
            }
            if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
                db.createObjectStore(MEDIA_STORE_NAME, { keyPath: "key" });
            }
        };
    });
}

/**
 * Retrieve a value from the IndexedDB store by its key.
 * @param {string} key - The unique key identifying the stored value.
 * @param {string} storeName - The object store to query (defaults to appData).
 * @returns {Promise<any|null>} A promise that resolves to the retrieved value, or null if an error occurs.
 */
export async function getFromStore(key, storeName = STORE_NAME) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], "readonly");
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result?.value);
            request.onerror = () => reject("Error getting data from store");
        });
    } catch (error) {
        console.error("Error in getFromStore:", error);
        return null;
    }
}

/**
 * Save or update a key-value pair in the IndexedDB store.
 * @param {string} key - The unique key for the data.
 * @param {any} value - The data to store.
 * @param {string} storeName - The object store to write to (defaults to appData).
 * @returns {Promise<boolean>} A promise that resolves to true if successful, or false if an error occurs.
 */
export async function saveToStore(key, value, storeName = STORE_NAME) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.put({ key, value });

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject("Error saving data to store");
        });
    } catch (error) {
        console.error("Error in saveToStore:", error);
        return false;
    }
}

/**
 * Clear all data from the IndexedDB store.
 * @param {string} storeName - The object store to clear (defaults to appData).
 * @returns {Promise<boolean>} A promise that resolves to true if successful, false otherwise.
 */
export async function clearStore(storeName = STORE_NAME) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject("Error clearing store");
        });
    } catch (error) {
        console.error("Error in clearStore:", error);
        return false;
    }
}

/**
 * Retrieve all items stored in the IndexedDB store.
 * @param {string} storeName - The object store to query (defaults to appData).
 * @returns {Promise<Array<any>|null>} A promise that resolves to an array of all stored items, or null on error.
 */
export async function getAllFromStore(storeName = STORE_NAME) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], "readonly");
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject("Error getting all data from store");
        });
    } catch (error) {
        console.error("Error in getAllFromStore:", error);
        return null;
    }
}

/**
 * Remove a single key from the IndexedDB store.
 * @param {string} key - The key to delete.
 * @param {string} storeName - The object store to query (defaults to appData).
 * @returns {Promise<boolean>} A promise that resolves to true if successful, false otherwise.
 */
export async function removeFromStore(key, storeName = STORE_NAME) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject("Error removing data from store");
        });
    } catch (error) {
        console.error("Error in removeFromStore:", error);
        return false;
    }
}

/**
 * List every key held by the IndexedDB store.
 * @param {string} storeName - The object store to query (defaults to appData).
 * @returns {Promise<Array<string>>} A promise resolving to the stored keys (empty on error).
 */
export async function getAllKeys(storeName = STORE_NAME) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], "readonly");
            const store = transaction.objectStore(storeName);
            const request = store.getAllKeys();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject("Error getting keys from store");
        });
    } catch (error) {
        console.error("Error in getAllKeys:", error);
        return [];
    }
}
