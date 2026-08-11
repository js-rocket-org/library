#!/usr/bin/env node

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

// Directories to skip while scanning
const IGNORE_DIRS = new Set(
  // deno-fmt-ignore
  [
    ".prompts", "_prompts", "node_modules", ".venv", ".git", ".svn", ".hg", ".next", ".nuxt", "dist",
    "build", "coverage", ".cache", ".turbo", ".vscode", ".idea", ".wrangler", ".deploy", "site",
  ],
);

const INCLUDE_EXTENSIONS = new Set(
  // deno-fmt-ignore
  [".svg", ".js", ".jsx", ".ts", ".tsx", ".dart", ".json", ".md", ".txt", ".php", ".css", ".htm", ".html",
    ".yml", ".yaml", ".sh"],
);

function mimeType(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case ".json":
      return "application/json";

    case ".js":
    case ".mjs":
    case ".ts":
    case ".jsx":
    case ".tsx":
    case ".html":
    case ".htm":
    case ".css":
    case ".md":
    case ".svg":
    case ".yml":
    case ".yaml":
    case ".php":
    case ".sh":
    case ".dart":
      return "text/plain";

    default:
      return "application/octet-stream";
  }
}

async function* getFiles(dir, baseDir = dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;

      console.log(`=== Folder: ${path.relative(baseDir, fullPath) || entry.name}`);

      yield* getFiles(fullPath, baseDir);
      continue;
    }

    if (!entry.isFile()) continue;
    if (entry.name === ".DS_Store") continue;

    const ext = path.extname(entry.name).toLowerCase();

    if (!INCLUDE_EXTENSIONS.has(ext)) continue;

    try {
      const content = await fsp.readFile(fullPath, "utf8");

      yield {
        // path: path.relative(baseDir, fullPath).replace(/\\/g, "/"),
        path: path.join(path.basename(baseDir), path.relative(baseDir, fullPath)).replace(/\\/g, "/"),
        // Normalize input files to LF as well.
        content: content.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
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
    console.error("  node folder2mime.js <input-folder> [output.mime]");
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputFolder);

  try {
    const stats = await fsp.stat(resolvedInput);

    if (!stats.isDirectory()) throw new Error("Input path is not a directory.");
  } catch {
    console.error(`Invalid input folder: ${resolvedInput}`);
    process.exit(1);
  }

  console.log(`Scanning ${resolvedInput}...`);

  const boundary = "===============_" + Date.now().toString(16) + "_" + Math.random().toString(16).slice(2);

  const LF = "\n";

  const out = fs.createWriteStream(outputFile, { encoding: "utf8" });

  const output1 = `From: Me<me@example.com>${LF}` +
    `To: You<you@example.com>${LF}` +
    `Date: ${(new Date()).toUTCString()}${LF}` +
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@example.com>${LF}` +
    `Subject: project files${LF}` +
    `MIME-Version: 1.0${LF}` +
    `Content-Type: multipart/mixed; boundary="${boundary}"${LF}` +
    LF;
  out.write(output1);

  let count = 0;

  for await (const file of getFiles(resolvedInput)) {
    count++;

    const output2 = `--${boundary}${LF}` +
      `Content-Type: ${mimeType(file.path)}; charset=utf-8${LF}` +
      `Content-Transfer-Encoding: 8bit${LF}` +
      `Content-Disposition: attachment; filename="${file.path}"${LF}` +
      LF +
      file.content +
      `${file.content.endsWith("\n") ? "" : LF}` +
      LF;
    out.write(output2);
  }

  const output3 = `--${boundary}--${LF}`;
  out.write(output3);

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
