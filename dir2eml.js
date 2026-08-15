#!/usr/bin/env node

/*
Recursively scans an input directory and exports eligible text files as MIME attachments in a single output file.

Configuration is loaded from .dir2eml.json in the input directory and merged with DEFAULT_CONFIG.

Inclusion and exclusion order:

Directories listed in excludeDir are skipped with all their contents.
Non-regular files are skipped.
Files listed in includeFiles are considered before excludeFiles and excludeExt.
Files listed in excludeFiles are skipped unless also listed in includeFiles.
Files with an extension listed in excludeExt are skipped unless also listed in includeFiles.
All remaining files are considered for inclusion, regardless of extension.
Files containing a zero byte or any byte above 7-bit ASCII are treated as binary and skipped.
Unreadable files are skipped.

Included files have their line endings normalised to LF and are written as 8-bit MIME attachments.
*/

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const CONFIG_FILE = ".dir2eml.json";

// deno-fmt-ignore
const TEXT_PLAIN_EXTENSIONS = [
  ".js", ".mjs", ".ts", ".jsx", ".tsx", ".html", ".htm", ".css", ".md", ".svg", ".yml", ".yaml", ".php", ".sh",
  ".dart",
];

// deno-fmt-ignore
const DEFAULT_CONFIG = {
  "excludeExt": [".png", ".jpg", ".jpeg", ".svg"],
  "excludeDir": ["node_modules", ".git", ".vscode", ".wrangler", "_env", "dist", "build", "_prompts", "_prompts_data"],
  "excludeFiles": [".dir2eml.json", ".DS_Store", "pnpm-lock.yaml", ".gitkeep", ".gitignore", "tsconfig.tsbuildinfo"],
  "includeFiles": []
};

const createConfigArray = (values) => [...values];

const loadConfig = async (inputFolder) => {
  const configPath = path.join(inputFolder, CONFIG_FILE);

  try {
    const content = await fsp.readFile(configPath, "utf8");
    const userConfig = JSON.parse(content);
    const config = { ...DEFAULT_CONFIG, ...userConfig };

    return {
      excludeExt: createConfigArray(
        Array.isArray(config.excludeExt) ? config.excludeExt : [],
      ),
      excludeDir: createConfigArray(
        Array.isArray(config.excludeDir) ? config.excludeDir : [],
      ),
      excludeFiles: createConfigArray(
        Array.isArray(config.excludeFiles) ? config.excludeFiles : [],
      ),
      includeFiles: createConfigArray(
        Array.isArray(config.includeFiles) ? config.includeFiles : [],
      ),
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return {
        excludeExt: createConfigArray(DEFAULT_CONFIG.excludeExt),
        excludeDir: createConfigArray(DEFAULT_CONFIG.excludeDir),
        excludeFiles: createConfigArray(DEFAULT_CONFIG.excludeFiles),
        includeFiles: createConfigArray(DEFAULT_CONFIG.includeFiles),
      };
    }

    throw new Error(`Unable to read ${configPath}: ${err.message}`);
  }
};

const mimeType = (filename) => {
  const extension = path.extname(filename).toLowerCase();

  if (extension === ".json") return "application/json";
  if (TEXT_PLAIN_EXTENSIONS.includes(extension)) return "text/plain";

  return "application/octet-stream";
};

const isBinary = (buffer) =>
  buffer.some((byte) =>
    byte > 0x7f ||
    (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)
  );

const addFile = async (files, fullPath, baseDir) => {
  try {
    const buffer = await fsp.readFile(fullPath);

    if (isBinary(buffer)) {
      console.warn(`Skipping binary file: ${fullPath}`);
      return;
    }

    const content = buffer.toString("utf8");

    files.push({
      path: path.join(path.basename(baseDir), path.relative(baseDir, fullPath))
        .replace(/\\/g, "/"),
      content: content.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
    });
  } catch {
    console.warn(`Skipping unreadable file: ${fullPath}`);
  }
};

const getFiles = async (dir, config, baseDir = dir) => {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (config.excludeDir.includes(entry.name)) continue;

      const childFiles = await getFiles(fullPath, config, baseDir);
      files.push(...childFiles);
      continue;
    }

    if (!entry.isFile()) continue;

    if (config.includeFiles.includes(entry.name)) {
      await addFile(files, fullPath, baseDir);
      continue;
    }

    if (config.excludeFiles.includes(entry.name)) continue;

    const extension = path.extname(entry.name).toLowerCase();

    if (config.excludeExt.includes(extension)) continue;

    await addFile(files, fullPath, baseDir);
  }

  return files;
};

const main = async () => {
  const inputFolder = process.argv[2];
  const outputFile = process.argv[3] || "files.mime";

  if (!inputFolder) {
    console.error("Usage:");
    console.error("  node dir2eml.js <input-folder> [output.mime]");
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

  const config = await loadConfig(resolvedInput);

  console.log(`Scanning ${resolvedInput}...`);

  const boundary = `===============_${Date.now().toString(16)}_${
    Math.random().toString(16).slice(2)
  }`;
  const LF = "\n";
  const out = fs.createWriteStream(outputFile, { encoding: "utf8" });

  const output1 = `From: Me<me@example.com>${LF}` +
    `Date: ${new Date().toUTCString()}${LF}` +
    `MIME-Version: 1.0${LF}` +
    `Content-Type: multipart/mixed; boundary="${boundary}"${LF}` +
    LF;
  out.write(output1);

  const files = await getFiles(resolvedInput, config);
  let count = 0;

  for (const file of files) {
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
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
