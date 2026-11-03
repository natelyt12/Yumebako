const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

const SCAN_DIRS = [
  path.join(ROOT_DIR, "src"),
  path.join(ROOT_DIR, "tests"),
  path.join(ROOT_DIR, ".agent/rules"),
];

const IGNORE_FILES = [
  path.normalize(path.join(ROOT_DIR, "src/styles/fonts.css")),
  path.normalize(path.join(ROOT_DIR, "src/core/font.js")),
];

const EXTENSIONS = new Set([".css", ".js", ".html", ".md"]);

function getAllFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== "node_modules" &&
        entry.name !== ".git" &&
        entry.name !== "dist"
      ) {
        getAllFiles(fullPath, arrayOfFiles);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (EXTENSIONS.has(ext)) {
        arrayOfFiles.push(fullPath);
      }
    }
  }

  return arrayOfFiles;
}

let totalReplacements = 0;
const modifiedFiles = [];

const allFiles = SCAN_DIRS.flatMap((dir) => getAllFiles(dir));

for (const filePath of allFiles) {
  const normalized = path.normalize(filePath);
  if (IGNORE_FILES.includes(normalized)) {
    continue;
  }

  const content = fs.readFileSync(filePath, "utf8");
  let fileReplacements = 0;

  let newContent = content;

  // 1. Match "font-weight:\s*(\d+)"
  newContent = newContent.replace(
    /font-weight:\s*(\d+)/g,
    (match, weightStr) => {
      const weight = parseInt(weightStr, 10);
      // Only shift standard weights 400..900 down by 100
      if (weight > 300 && weight <= 900) {
        fileReplacements++;
        return `font-weight: ${weight - 100}`;
      }
      return match;
    },
  );

  // 2. Match "--meta-summary-fw:\s*(\d+)"
  newContent = newContent.replace(
    /--meta-summary-fw:\s*(\d+)/g,
    (match, weightStr) => {
      const weight = parseInt(weightStr, 10);
      if (weight > 300 && weight <= 900) {
        fileReplacements++;
        return `--meta-summary-fw: ${weight - 100}`;
      }
      return match;
    },
  );

  // 3. Update comments/docs referencing the font-weight hierarchy tiers
  if (newContent.includes("the Base tier (600)")) {
    newContent = newContent.replace(
      /the Base tier \(600\)/g,
      "the Base tier (500)",
    );
    fileReplacements++;
  }
  if (newContent.includes("Base / Regular (`600`)")) {
    newContent = newContent.replace(
      /Base \/ Regular \(`600`\)/g,
      "Base / Regular (`500`)",
    );
    newContent = newContent.replace(
      /Bold \/ Medium \(`700`\)/g,
      "Bold / Medium (`600`)",
    );
    newContent = newContent.replace(
      /Extra Bold \/ Heavy \(`800`\)/g,
      "Extra Bold / Heavy (`700`)",
    );
    fileReplacements += 3;
  }

  if (fileReplacements > 0) {
    fs.writeFileSync(filePath, newContent, "utf8");
    totalReplacements += fileReplacements;
    modifiedFiles.push({
      file: path.relative(ROOT_DIR, filePath),
      count: fileReplacements,
    });
  }
}

console.log(
  `[Font Weight Shift] Completed! Shifted ${totalReplacements} font-weight instances across ${modifiedFiles.length} files:\n`,
);
for (const item of modifiedFiles) {
  console.log(`  - ${item.file}: ${item.count} replacement(s)`);
}
