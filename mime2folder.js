#!/usr/bin/env node

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");


function extractFilename(headers) {
  const match = headers.match(
    /Content-Disposition:\s*attachment;\s*filename="([^"]+)"/i
  );

  return match ? match[1] : null;
}


function getBoundary(headers) {
  const match = headers.match(
    /boundary="([^"]+)"/i
  );

  return match ? match[1] : null;
}


function splitMultipart(content, boundary) {
  return content
    .split(`--${boundary}`)
    .filter((part) => {
      return (
        part.trim() !== "" &&
        part.trim() !== "--"
      );
    });
}


function parsePart(part) {
  const separator = "\r\n\r\n";
  const headerEnd = part.indexOf(separator);

  if (headerEnd === -1) {
    return null;
  }

  const headers = part.slice(0, headerEnd);
  let body = part.slice(headerEnd + separator.length);

  // Remove trailing CRLF added before the next boundary
  if (body.endsWith("\r\n")) {
    body = body.slice(0, -2);
  }

  const filename = extractFilename(headers);

  if (!filename) {
    return null;
  }

  return {
    filename,
    content: body,
  };
}


async function writeFileSafe(outputDir, filename, content) {
  const normalized = filename.replace(/\\/g, "/");
  const relativePath = path.normalize(normalized);

  // Prevent path traversal
  if (
    path.isAbsolute(relativePath) ||
    relativePath.startsWith(".." + path.sep) ||
    relativePath.includes(`${path.sep}..${path.sep}`)
  ) {
    throw new Error(`Unsafe filename: ${filename}`);
  }

  const outputPath = path.join(outputDir, relativePath);

  await fsp.mkdir(path.dirname(outputPath), {
    recursive: true,
  });

  await fsp.writeFile(outputPath, content, "utf8");

  console.log(`Extracted: ${relativePath}`);
}


async function main() {
  const inputFile = process.argv[2];
  const outputFolder = process.argv[3] || "extracted-files";

  if (!inputFile) {
    console.error("Usage:");
    console.error(
      "  node import-files.js <input.mime> [output-folder]"
    );
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputFile);
  const resolvedOutput = path.resolve(outputFolder);

  try {
    const stats = await fsp.stat(resolvedInput);

    if (!stats.isFile()) {
      throw new Error("Input path is not a file.");
    }
  } catch {
    console.error(`Invalid input file: ${resolvedInput}`);
    process.exit(1);
  }


  console.log(`Reading ${resolvedInput}...`);

  const content = await fsp.readFile(
    resolvedInput,
    "utf8"
  );


  const headerEnd = content.indexOf("\r\n\r\n");

  if (headerEnd === -1) {
    throw new Error("Invalid MIME file.");
  }

  const headers = content.slice(0, headerEnd);

  const boundary = getBoundary(headers);

  if (!boundary) {
    throw new Error("Could not find MIME boundary.");
  }


  await fsp.mkdir(resolvedOutput, {
    recursive: true,
  });


  const parts = splitMultipart(
    content.slice(headerEnd + 4),
    boundary
  );

  let count = 0;

  for (const part of parts) {
    const file = parsePart(part);

    if (!file) {
      continue;
    }

    await writeFileSafe(
      resolvedOutput,
      file.filename,
      file.content
    );

    count++;
  }


  console.log("");
  console.log(`Done! Extracted ${count} files.`);
  console.log(`Output written to: ${resolvedOutput}`);
}


main().catch((err) => {
  console.error(err);
  process.exit(1);
});
