#!/usr/bin/env node

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const CONFIG_FILE = "dir2eml.json";

// Directories to skip while scanning
// deno-fmt-ignore
const IGNORE_DIRS = new Set([ ".prompts", "_prompts", "node_modules", ".git", ".svn", ".hg", "dist", "build"]);

// deno-fmt-ignore
const INCLUDE_EXTENSIONS = new Set([
  ".svg", ".js", ".jsx", ".ts", ".tsx", ".dart", ".json", ".md", ".txt", ".php", ".css", ".htm",
  ".html", ".yml", ".yaml", ".sh",
]);

const normalisePath = (value) => value.replace(/\\/g, "/").replace(/^\.\//, "");

const createConfigSet = (values) =>
  new Set(values.map((value) => normalisePath(value)));

const loadConfig = async (inputFolder) => {
  const configPath = path.join(inputFolder, CONFIG_FILE);

  try {
    const content = await fsp.readFile(configPath, "utf8");
    const config = JSON.parse(content);

    return {
      excludeDir: createConfigSet(
        Array.isArray(config.excludeDir) ? config.excludeDir : [],
      ),
      excludeFiles: createConfigSet(
        Array.isArray(config.excludeFiles) ? config.excludeFiles : [],
      ),
      includeFiles: createConfigSet(
        Array.isArray(config.includeFiles) ? config.includeFiles : [],
      ),
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return {
        excludeDir: new Set(),
        excludeFiles: new Set(),
        includeFiles: new Set(),
      };
    }

    throw new Error(`Unable to read ${configPath}: ${err.message}`);
  }
};

const matchesConfigEntry = (entries, relativePath, name) =>
  entries.has(relativePath) || entries.has(name);

const mimeType = (filename) => {
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
};

async function* getFiles(dir, config, baseDir = dir, excludedByParent = false) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = normalisePath(path.relative(baseDir, fullPath));

    if (entry.isDirectory()) {
      const excludedByConfig = matchesConfigEntry(
        config.excludeDir,
        relativePath,
        entry.name,
      );
      const excludedByBuiltIn = IGNORE_DIRS.has(entry.name);
      const excluded = excludedByParent || excludedByConfig ||
        excludedByBuiltIn;

      if (!excluded) console.log(`=== Folder: ${relativePath || entry.name}`);

      yield* getFiles(fullPath, config, baseDir, excluded);
      continue;
    }

    if (!entry.isFile()) continue;

    const explicitlyIncluded = matchesConfigEntry(
      config.includeFiles,
      relativePath,
      entry.name,
    );

    if (!explicitlyIncluded) {
      if (excludedByParent) continue;
      if (matchesConfigEntry(config.excludeFiles, relativePath, entry.name)) {
        continue;
      }
      if (entry.name === ".DS_Store") continue;

      const ext = path.extname(entry.name).toLowerCase();

      if (!INCLUDE_EXTENSIONS.has(ext)) continue;
    }

    try {
      const content = await fsp.readFile(fullPath, "utf8");

      yield {
        // path: path.relative(baseDir, fullPath).replace(/\\/g, "/"),
        path: path.join(
          path.basename(baseDir),
          path.relative(baseDir, fullPath),
        ).replace(/\\/g, "/"),
        // Normalize input files to LF as well.
        content: content.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
      };
    } catch {
      console.warn(`Skipping unreadable file: ${fullPath}`);
    }
  }
}

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

  const boundary = "===============_" + Date.now().toString(16) + "_" +
    Math.random().toString(16).slice(2);
  const LF = "\n";
  const out = fs.createWriteStream(outputFile, { encoding: "utf8" });

  const output1 = `From: Me<me@example.com>${LF}` +
    `To: You<you@example.com>${LF}` +
    `Date: ${(new Date()).toUTCString()}${LF}` +
    `Message-ID: <${Date.now()}.${
      Math.random().toString(36).slice(2)
    }@example.com>${LF}` +
    `Subject: project files${LF}` +
    `MIME-Version: 1.0${LF}` +
    `Content-Type: multipart/mixed; boundary="${boundary}"${LF}` +
    LF;
  out.write(output1);

  let count = 0;

  for await (const file of getFiles(resolvedInput, config)) {
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
