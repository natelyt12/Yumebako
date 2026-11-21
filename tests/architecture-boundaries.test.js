import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function listFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function resolveImportTarget(fromFile, specifier) {
  if (specifier.startsWith("/src/")) {
    return path.resolve(ROOT, specifier.slice(1)).replace(/\\/g, "/");
  }
  if (specifier.startsWith(".")) {
    return path
      .resolve(path.dirname(fromFile), specifier)
      .replace(/\\/g, "/");
  }
  return specifier;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function extractImportSpecifiers(source) {
  const clean = stripComments(source);
  const specs = [];
  const staticRe = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicRe = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticRe, dynamicRe]) {
    let match;
    while ((match = re.exec(clean)) !== null) {
      specs.push(match[1]);
    }
  }
  return specs;
}

test("Architecture Layer 1 (frontend): zero direct DB/source/API imports or storage calls", () => {
  const frontendFiles = listFiles(path.join(ROOT, "src/wallpaper/frontend"), [
    ".js",
  ]);
  assert.ok(frontendFiles.length > 0);

  for (const file of frontendFiles) {
    const src = fs.readFileSync(file, "utf8");
    const fileRel = rel(file);

    for (const spec of extractImportSpecifiers(src)) {
      const target = resolveImportTarget(file, spec);
      assert.equal(
        target.includes("src/core/db"),
        false,
        `${fileRel} must not import src/core/db (${spec})`,
      );
      assert.equal(
        target.includes("src/wallpaper/backend/sources"),
        false,
        `${fileRel} must not import Layer 3 sources (${spec})`,
      );
      if (fileRel.startsWith("src/wallpaper/frontend/switcher/")) {
        assert.equal(
          target.includes("src/wallpaper/backend/rendering"),
          false,
          `${fileRel} must not import Layer 4 rendering (${spec})`,
        );
        assert.equal(
          target.includes("src/wallpaper/backend/effects"),
          false,
          `${fileRel} must not import Layer 4 effects (${spec})`,
        );
      }
    }

    assert.equal(
      /\b(?:getFromStore|saveToStore|removeFromStore|saveManyToStore|removeManyFromStore)\s*\(/.test(
        src,
      ),
      false,
      `${fileRel} must not call IndexedDB store helpers directly`,
    );
  }
});

test("Architecture Layer 1 (arrange panel): never queries desktop .image or .video DOM", () => {
  const arrangeFile = path.join(
    ROOT,
    "src/wallpaper/frontend/customize/panels/arrange/index.js",
  );
  const src = fs.readFileSync(arrangeFile, "utf8");
  assert.equal(
    /querySelector(?:All)?\s*\(\s*["']\.(?:image|video)["']\s*\)/.test(src),
    false,
    "arrange/index.js must read metrics via Layer 2/4 contract, not .image/.video DOM queries",
  );
});

test("Architecture Layer 1 (UI rules): zero aria-label or title attributes on controls", () => {
  const frontendFiles = listFiles(path.join(ROOT, "src/wallpaper/frontend"), [
    ".js",
    ".html",
  ]);

  for (const file of frontendFiles) {
    const src = fs.readFileSync(file, "utf8");
    const fileRel = rel(file);
    assert.equal(
      /\baria-label\b|\bdata-i18n-title\b|\bdata-action-title\b|\btitle=|\.title\s*=/.test(
        src,
      ),
      false,
      `${fileRel} violates ui_rules.md (contains aria-label or title attribute)`,
    );
  }
});

test("Architecture Layer 2 (backend/data): never imports Layer 4 rendering or Layer 1 frontend", () => {
  const dataFiles = listFiles(path.join(ROOT, "src/wallpaper/backend/data"), [
    ".js",
  ]);

  for (const file of dataFiles) {
    const src = fs.readFileSync(file, "utf8");
    const fileRel = rel(file);

    for (const spec of extractImportSpecifiers(src)) {
      const target = resolveImportTarget(file, spec);
      assert.equal(
        target.includes("src/wallpaper/frontend"),
        false,
        `${fileRel} must not import Layer 1 frontend (${spec})`,
      );
      assert.equal(
        target.includes("src/wallpaper/backend/rendering"),
        false,
        `${fileRel} must not import Layer 4 rendering (${spec})`,
      );
      if (target.includes("src/wallpaper/backend/effects")) {
        assert.ok(
          target.endsWith("effectStates.js"),
          `${fileRel} may only import pure effectStates metadata from effects (${spec})`,
        );
      }
    }
  }
});

test("Architecture Layer 3 (backend/sources): strictly headless with no DOM, notifications, or Layer 4 imports", () => {
  const sourceFiles = listFiles(
    path.join(ROOT, "src/wallpaper/backend/sources"),
    [".js"],
  );

  for (const file of sourceFiles) {
    const src = fs.readFileSync(file, "utf8");
    const fileRel = rel(file);

    for (const spec of extractImportSpecifiers(src)) {
      const target = resolveImportTarget(file, spec);
      assert.equal(
        target.includes("src/wallpaper/frontend"),
        false,
        `${fileRel} must not import Layer 1 frontend (${spec})`,
      );
      assert.equal(
        target.includes("src/wallpaper/backend/rendering"),
        false,
        `${fileRel} must not import Layer 4 rendering (${spec})`,
      );
      if (target.includes("src/wallpaper/backend/effects")) {
        assert.ok(
          target.endsWith("effectStates.js"),
          `${fileRel} may only import pure effectStates metadata from effects (${spec})`,
        );
      }
    }

    const code = stripComments(src);
    assert.equal(
      /\bshowNotification\b|\bdocument\.createElement\b|\bwindow\.open\b/.test(
        code,
      ),
      false,
      `${fileRel} must stay headless (no showNotification / document.createElement / window.open)`,
    );
  }
});

test("Architecture Layer 4 (rendering & effects): stateless with no DataControl/Source/Frontend imports or saveSettings", () => {
  const layer4Files = [
    ...listFiles(path.join(ROOT, "src/wallpaper/backend/rendering"), [".js"]),
    ...listFiles(path.join(ROOT, "src/wallpaper/backend/effects"), [".js"]),
  ];

  for (const file of layer4Files) {
    const src = fs.readFileSync(file, "utf8");
    const fileRel = rel(file);

    for (const spec of extractImportSpecifiers(src)) {
      const target = resolveImportTarget(file, spec);
      assert.equal(
        target.includes("src/wallpaper/frontend"),
        false,
        `${fileRel} must not import Layer 1 frontend (${spec})`,
      );
      assert.equal(
        target.includes("src/wallpaper/backend/data"),
        false,
        `${fileRel} must not import Layer 2 data (${spec})`,
      );
      assert.equal(
        target.includes("src/wallpaper/backend/sources"),
        false,
        `${fileRel} must not import Layer 3 sources (${spec})`,
      );
    }

    assert.equal(
      /\bsaveSettings\s*\(/.test(src),
      false,
      `${fileRel} must remain stateless and never call saveSettings()`,
    );
  }
});

test("Architecture Forbidden: Settings modal must not import wallpaper customize UI", () => {
  const settingsFiles = listFiles(path.join(ROOT, "src/settings"), [
    ".js",
    ".html",
  ]);
  for (const file of settingsFiles) {
    const src = fs.readFileSync(file, "utf8");
    const fileRel = rel(file);
    assert.equal(
      src.includes("wallpaper/frontend/customize") ||
        src.includes("wallpaper_customize"),
      false,
      `${fileRel} must not embed or import wallpaper customize UI`,
    );
  }
});
