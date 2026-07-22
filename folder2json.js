#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

// Directories to skip while scanning
const IGNORE_DIRS = new Set([
  ".prompts",
  "_prompts",
  "node_modules",
  ".venv",
  ".git",
  ".svn",
  ".hg",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".turbo",
  ".vscode",
  ".idea",
  "site",
]);

const INCLUDE_EXTENSIONS = new Set([
  ".svg",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".dart",
  ".json",
  ".md",
  ".txt",
  ".php",
  ".css",
  ".htm",
  ".html",
  ".yml",
  ".yaml",
  ".sh",
])

// Optional: skip common binary files
const IGNORE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".rar",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
]);


async function getFiles(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;

      console.log(`=== Folder: ${entry.name}`)

      files.push(...(await getFiles(fullPath, baseDir)));
      continue;
    }

    if (!entry.isFile()) continue;

    if (".DS_Store" === entry.name) continue;

    const extens = path.extname(entry.name).toLowerCase()
    if (!INCLUDE_EXTENSIONS.has(extens)) continue;

    try {
      const content = await fs.readFile(fullPath, "utf8");

      files.push({
        path: path.relative(baseDir, fullPath).replace(/\\/g, "/"),
        content,
      });
    } catch (err) {
      console.warn(`Skipping unreadable file: ${fullPath}`);
    }
  }

  return files;
}

async function main() {
  const inputFolder = process.argv[2];
  const outputFile = process.argv[3] || "files.json";

  if (!inputFolder) {
    console.error("Usage:");
    console.error("  node export-files.js <input-folder> [output.json]");
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputFolder);

  try {
    const stats = await fs.stat(resolvedInput);

    if (!stats.isDirectory()) {
      throw new Error("Input path is not a directory.");
    }
  } catch (err) {
    console.error(`Invalid input folder: ${resolvedInput}`);
    process.exit(1);
  }

  console.log(`Scanning ${resolvedInput}...`);

  const files = await getFiles(resolvedInput);

  await fs.writeFile(outputFile, JSON.stringify(files, null, 2), "utf8");

  console.log(`Done! Exported ${files.length} files.`);
  console.log(`Output written to: ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
