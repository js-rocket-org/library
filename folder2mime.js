#!/usr/bin/env node

const fs = require("fs");
const fsp = require("fs/promises");
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
]);

function mimeType(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case ".js":
    case ".mjs":
      return "text/javascript";

    case ".ts":
      return "text/typescript";

    case ".jsx":
      return "text/jsx";

    case ".tsx":
      return "text/tsx";

    case ".json":
      return "application/json";

    case ".html":
    case ".htm":
      return "text/html";

    case ".css":
      return "text/css";

    case ".md":
      return "text/markdown";

    case ".svg":
      return "image/svg+xml";

    case ".yml":
    case ".yaml":
      return "application/yaml";

    case ".php":
      return "application/x-httpd-php";

    case ".sh":
      return "application/x-sh";

    case ".dart":
      return "application/dart";

    default:
      return "text/plain";
  }
}

async function* getFiles(dir, baseDir = dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) {
        continue;
      }

      console.log(`=== Folder: ${path.relative(baseDir, fullPath) || entry.name}`);

      yield* getFiles(fullPath, baseDir);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (entry.name === ".DS_Store") {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();

    if (!INCLUDE_EXTENSIONS.has(ext)) {
      continue;
    }

    try {
      const content = await fsp.readFile(fullPath, "utf8");

      yield {
        // path: path.relative(baseDir, fullPath).replace(/\\/g, "/"),
        path: path.join(
                path.basename(baseDir),
                path.relative(baseDir, fullPath)
              ).replace(/\\/g, "/"),
        content,
      };
    } catch {
      console.warn(`Skipping unreadable file: ${fullPath}`);
    }
  }
}

async function main() {
  const inputFolder = process.argv[2];
  const outputFile = process.argv[3] || "files.mime";

  if (!inputFolder) {
    console.error("Usage:");
    console.error("  node export-files.js <input-folder> [output.mime]");
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputFolder);

  try {
    const stats = await fsp.stat(resolvedInput);

    if (!stats.isDirectory()) {
      throw new Error("Input path is not a directory.");
    }
  } catch {
    console.error(`Invalid input folder: ${resolvedInput}`);
    process.exit(1);
  }

  console.log(`Scanning ${resolvedInput}...`);

  const boundary =
    "===============_" +
    Date.now().toString(16) +
    "_" +
    Math.random().toString(16).slice(2);

  const out = fs.createWriteStream(outputFile, {
    encoding: "utf8",
  });

  out.write(`MIME-Version: 1.0\r\n`);
  out.write(`Content-Type: multipart/mixed; boundary="${boundary}"\r\n`);
  out.write(`\r\n`);

  let count = 0;

  for await (const file of getFiles(resolvedInput)) {
    count++;

    out.write(`--${boundary}\r\n`);
    out.write(`Content-Type: ${mimeType(file.path)}; charset=utf-8\r\n`);
    out.write(
      `Content-Disposition: attachment; filename="${file.path}"\r\n`
    );
    out.write(`\r\n`);

    out.write(file.content);

    if (!file.content.endsWith("\n")) {
      out.write("\r\n");
    }

    out.write("\r\n");
  }

  out.write(`--${boundary}--\r\n`);

  await new Promise((resolve, reject) => {
    out.end((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  console.log(`Done! Exported ${count} files.`);
  console.log(`Boundary: ${boundary}`);
  console.log(`Output written to: ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
