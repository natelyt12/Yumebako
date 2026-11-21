import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

let registered = false;

/**
 * Shared in-memory DB stores (`appData` and `mediaData`) plus `localStorage`
 * mock so real Layer 2 modules (`DataControl.js`, `mediaGC.js`) and
 * `storageHandler.js` can be imported and tested directly in Node.
 */
export function installWallpaperTestEnv() {
  if (!globalThis.__YUMEBAKO_TEST_DB__) {
    globalThis.__YUMEBAKO_TEST_DB__ = {
      appData: new Map(),
      mediaData: new Map(),
    };
  }

  if (!globalThis.__YUMEBAKO_LS_STORE__) {
    globalThis.__YUMEBAKO_LS_STORE__ = new Map();
  }

  if (!globalThis.localStorage) {
    const ls = globalThis.__YUMEBAKO_LS_STORE__;
    globalThis.localStorage = {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, String(v)),
      removeItem: (k) => ls.delete(k),
      clear: () => ls.clear(),
    };
  }

  if (!registered) {
    registered = true;
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.startsWith("/src/")) {
          if (specifier === "/src/core/db.js") {
            return { shortCircuit: true, url: "yumebako-test://db.js" };
          }
          if (specifier === "/src/core/time.js") {
            return { shortCircuit: true, url: "yumebako-test://time.js" };
          }
          if (specifier === "/src/core/i18n.js") {
            return { shortCircuit: true, url: "yumebako-test://i18n.js" };
          }
          const resolved = pathToFileURL(
            path.resolve(ROOT, specifier.slice(1)),
          ).href;
          return { shortCircuit: true, url: resolved };
        }
        return nextResolve(specifier, context);
      },
      load(url, context, nextLoad) {
        if (url === "yumebako-test://db.js") {
          return {
            shortCircuit: true,
            format: "module",
            source: `
              const stores = globalThis.__YUMEBAKO_TEST_DB__;
              function getStore(name = "appData") {
                if (!stores[name]) stores[name] = new Map();
                return stores[name];
              }
              export async function getFromStore(key, storeName = "appData") {
                return getStore(storeName).get(key) ?? null;
              }
              export async function saveToStore(key, value, storeName = "appData") {
                getStore(storeName).set(key, value);
              }
              export async function clearStore(storeName = "appData") {
                getStore(storeName).clear();
              }
              export async function getAllFromStore(storeName = "appData") {
                return Array.from(getStore(storeName).entries()).map(([key, value]) => ({ key, value }));
              }
              export async function removeFromStore(key, storeName = "appData") {
                getStore(storeName).delete(key);
              }
              export async function saveManyToStore(entries, storeName = "appData") {
                const s = getStore(storeName);
                for (const e of entries) s.set(e.key, e.value);
              }
              export async function removeManyFromStore(keys, storeName = "appData") {
                const s = getStore(storeName);
                for (const k of keys) s.delete(k);
              }
              export async function getAllKeys(storeName = "appData") {
                return Array.from(getStore(storeName).keys());
              }
            `,
          };
        }
        if (url === "yumebako-test://time.js") {
          return {
            shortCircuit: true,
            format: "module",
            source: `export function initDate() {} export function initClock() {}`,
          };
        }
        if (url === "yumebako-test://i18n.js") {
          return {
            shortCircuit: true,
            format: "module",
            source: `
              export async function initI18n() {}
              export function t(key, varsOrFallback) {
                if (typeof varsOrFallback === "string") return varsOrFallback;
                return key;
              }
              export function translateDOM() {}
            `,
          };
        }
        return nextLoad(url, context);
      },
    });
  }

  return {
    db: globalThis.__YUMEBAKO_TEST_DB__,
    localStorageStore: globalThis.__YUMEBAKO_LS_STORE__,
    reset() {
      globalThis.__YUMEBAKO_TEST_DB__.appData.clear();
      globalThis.__YUMEBAKO_TEST_DB__.mediaData.clear();
      globalThis.__YUMEBAKO_LS_STORE__.clear();
    },
  };
}
