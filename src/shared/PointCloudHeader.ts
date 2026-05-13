import { ViewerMode } from "./ViewerModeTypes";

export type PlyProperty = {
  name: string;
  type: string;
  element: string;
};

export type PlyHeaderDetection = {
  format: string;
  vertexCount: number;
  properties: string[];
  vertexProperties: PlyProperty[];
  hasPosition: boolean;
  hasRgb: boolean;
  hasOpacity: boolean;
  hasScale: boolean;
  hasRotation: boolean;
  hasNormals: boolean;
  hasSphericalHarmonics: boolean;
  possibleGaussianSplatPly: boolean;
  detectedMode: ViewerMode;
};

const GAUSSIAN_PREFIXES = ["f_dc_", "f_rest_"];

export function parsePlyHeader(buffer: ArrayBuffer): PlyHeaderDetection {
  const text = new TextDecoder("ascii").decode(buffer.slice(0, Math.min(buffer.byteLength, 512 * 1024)));
  const endIndex = text.indexOf("end_header");
  if (endIndex < 0) {
    throw new Error("Invalid PLY: missing end_header.");
  }

  const lines = text.slice(0, endIndex).split(/\r?\n/);
  let format = "unknown";
  let vertexCount = 0;
  let currentElement = "";
  const vertexProperties: PlyProperty[] = [];

  for (const line of lines) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length === 0 || tokens[0] === "comment") {
      continue;
    }

    if (tokens[0] === "format") {
      format = tokens[1] ?? "unknown";
      continue;
    }

    if (tokens[0] === "element") {
      currentElement = tokens[1] ?? "";
      if (currentElement === "vertex") {
        vertexCount = Number(tokens[2] ?? 0);
      }
      continue;
    }

    if (currentElement === "vertex" && tokens[0] === "property") {
      const isList = tokens[1] === "list";
      const type = isList ? `${tokens[1]} ${tokens[2] ?? ""} ${tokens[3] ?? ""}`.trim() : tokens[1] ?? "unknown";
      const name = tokens[tokens.length - 1] ?? "";
      if (name) {
        vertexProperties.push({ name, type, element: currentElement });
      }
    }
  }

  const properties = vertexProperties.map((property) => property.name);
  const propertySet = new Set(properties.map((property) => property.toLowerCase()));
  const hasPosition = ["x", "y", "z"].every((property) => propertySet.has(property));
  const hasRgb = ["red", "green", "blue"].every((property) => propertySet.has(property));
  const hasOpacity = propertySet.has("opacity") || propertySet.has("alpha");
  const hasScale = propertySet.has("scale") || ["scale_0", "scale_1", "scale_2"].some((property) => propertySet.has(property));
  const hasRotation = ["rot_0", "rot_1", "rot_2", "rot_3"].some((property) => propertySet.has(property));
  const hasNormals = ["nx", "ny", "nz"].every((property) => propertySet.has(property));
  const hasSphericalHarmonics = properties.some((property) => {
    const lower = property.toLowerCase();
    return GAUSSIAN_PREFIXES.some((prefix) => lower.startsWith(prefix));
  });
  const hasPackedSplatFields = ["packed_position", "packed_rotation", "packed_scale", "packed_color"].some((property) => propertySet.has(property));
  const possibleGaussianSplatPly = hasOpacity || hasScale || hasRotation || hasSphericalHarmonics || hasPackedSplatFields;
  const detectedMode = detectViewerMode({
    hasPosition,
    hasRgb,
    possibleGaussianSplatPly
  });

  return {
    format,
    vertexCount,
    properties,
    vertexProperties,
    hasPosition,
    hasRgb,
    hasOpacity,
    hasScale,
    hasRotation,
    hasNormals,
    hasSphericalHarmonics,
    possibleGaussianSplatPly,
    detectedMode
  };
}

function detectViewerMode(input: { hasPosition: boolean; hasRgb: boolean; possibleGaussianSplatPly: boolean }): ViewerMode {
  if (!input.hasPosition) {
    return ViewerMode.UNKNOWN;
  }

  if (input.possibleGaussianSplatPly) {
    return ViewerMode.GAUSSIAN_SPLAT;
  }

  if (input.hasRgb) {
    return ViewerMode.POINT_CLOUD;
  }

  return ViewerMode.UNKNOWN;
}
