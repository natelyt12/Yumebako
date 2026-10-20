import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

/**
 * Vite emits CSS imported from JS modules before the CSS of the HTML entry, so the
 * `@layer` order statement cannot be trusted to land first (and the minifier drops it).
 * Prepend it to every emitted stylesheet instead — the first stylesheet parsed
 * establishes the order for the whole document.
 */
const CASCADE_LAYER_ORDER =
  "@layer utilities, tokens, base, components, features;";

/** Insert the order statement after any leading `@import`s, skipping quoted/url() semicolons. */
function insertAfterLeadingImports(css, statement) {
  let index = 0;

  for (;;) {
    const match = /^\s*@import\b/.exec(css.slice(index));
    if (!match) break;

    let depth = 0;
    let quote = null;
    let end = -1;

    for (let i = index + match[0].length; i < css.length; i += 1) {
      const char = css[i];

      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      } else if (char === ";" && depth === 0) {
        end = i + 1;
        break;
      }
    }

    if (end === -1) break;
    index = end;
  }

  return `${css.slice(0, index)}${statement}\n${css.slice(index)}`;
}

function cascadeLayerOrder() {
  let isBuild = false;

  return {
    name: "yumebako:cascade-layer-order",
    enforce: "pre",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    // Dev: every stylesheet is injected separately, so each one needs the order
    // statement before its own layer blocks.
    transform(code, id) {
      if (isBuild) return null;

      const file = id.split("?")[0];
      if (!file.endsWith(".css") || file.endsWith("layers.css")) return null;

      return { code: `${CASCADE_LAYER_ORDER}\n${code}`, map: null };
    },
    // Build: prepend once per emitted stylesheet, after minification.
    generateBundle(_, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".css"))
          continue;
        asset.source = insertAfterLeadingImports(
          String(asset.source),
          CASCADE_LAYER_ORDER,
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [crx({ manifest }), cascadeLayerOrder()],
  server: {
    port: 3546,
    strictPort: true,
    hmr: {
      port: 3546,
    },
    cors: true,
  },
});
