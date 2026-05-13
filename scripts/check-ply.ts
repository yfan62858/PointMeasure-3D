import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const plyPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(process.cwd(), "data", "office_sample_300k.ply");

type PlyHeader = {
  format: string;
  vertexCount: number;
  properties: string[];
  hasPosition: boolean;
  hasRgb: boolean;
};

function readHeader(filePath: string): PlyHeader {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const fd = fs.openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    let headerText = "";

    while (!headerText.includes("end_header")) {
      const chunk = Buffer.alloc(8192);
      const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, total);
      if (bytesRead === 0) {
        break;
      }
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
      headerText = Buffer.concat(chunks).toString("ascii");
      if (total > 1024 * 1024) {
        throw new Error("PLY header is unexpectedly larger than 1 MB.");
      }
    }

    if (!headerText.includes("end_header")) {
      throw new Error("Invalid PLY: missing end_header.");
    }

    return parseHeader(headerText);
  } finally {
    fs.closeSync(fd);
  }
}

function parseHeader(headerText: string): PlyHeader {
  const lines = headerText.slice(0, headerText.indexOf("end_header")).split(/\r?\n/);
  let format = "unknown";
  let vertexCount = 0;
  let inVertex = false;
  const properties: string[] = [];

  for (const line of lines) {
    const tokens = line.trim().split(/\s+/);
    if (tokens[0] === "format") {
      format = tokens[1] ?? "unknown";
      continue;
    }

    if (tokens[0] === "element") {
      inVertex = tokens[1] === "vertex";
      if (inVertex) {
        vertexCount = Number(tokens[2] ?? 0);
      }
      continue;
    }

    if (inVertex && tokens[0] === "property") {
      properties.push(tokens[tokens.length - 1]);
    }
  }

  const propertySet = new Set(properties.map((property) => property.toLowerCase()));
  return {
    format,
    vertexCount,
    properties,
    hasPosition: propertySet.has("x") && propertySet.has("y") && propertySet.has("z"),
    hasRgb: propertySet.has("red") && propertySet.has("green") && propertySet.has("blue")
  };
}

function estimateMemoryBytes(header: PlyHeader): number {
  const bytesPerPoint = header.properties.reduce((sum, property) => {
    const lower = property.toLowerCase();
    if (lower === "red" || lower === "green" || lower === "blue" || lower === "alpha") {
      return sum + 1;
    }
    return sum + 4;
  }, 0);
  return header.vertexCount * bytesPerPoint;
}

try {
  const stat = fs.statSync(plyPath);
  const header = readHeader(plyPath);

  if (!header.hasPosition) {
    throw new Error("PLY is missing required x y z properties.");
  }

  console.log(`file: ${plyPath}`);
  console.log(`format: ${header.format}`);
  console.log(`vertex count: ${header.vertexCount.toLocaleString()}`);
  console.log(`properties: ${header.properties.join(", ")}`);
  console.log(`has x y z: ${header.hasPosition ? "yes" : "no"}`);
  console.log(`has red green blue: ${header.hasRgb ? "yes" : "no"}`);
  console.log(`file size: ${stat.size.toLocaleString()} bytes`);
  console.log(`estimated memory usage: ${estimateMemoryBytes(header).toLocaleString()} bytes`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
