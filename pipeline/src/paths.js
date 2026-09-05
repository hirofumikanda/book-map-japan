import path from "node:path";
import { fileURLToPath } from "node:url";

const PIPELINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_GEOJSON_PATH = path.join(PIPELINE_ROOT, "out", "book.geojson");
const DEFAULT_PMTILES_PATH = path.join(PIPELINE_ROOT, "out", "book.pmtiles");

function resolveWithOverride(override, defaultPath) {
  if (typeof override === "string" && override.trim() !== "") {
    return path.resolve(override.trim());
  }
  return defaultPath;
}

/** GeoJSON の入出力パス。BOOK_GEOJSON_PATH で上書きできる。 */
export function resolveGeoJsonPath(env = process.env) {
  return resolveWithOverride(env?.BOOK_GEOJSON_PATH, DEFAULT_GEOJSON_PATH);
}

/** PMTiles の入出力パス。BOOK_PMTILES_PATH で上書きできる。 */
export function resolvePmtilesPath(env = process.env) {
  return resolveWithOverride(env?.BOOK_PMTILES_PATH, DEFAULT_PMTILES_PATH);
}
