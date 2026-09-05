import { spawn } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { PMTiles } from "pmtiles";

import { resolveGeoJsonPath, resolvePmtilesPath } from "./paths.js";
import { TILE_LAYER, TILE_MAX_ZOOM, TILE_MIN_ZOOM } from "./build-tiles.js";
import { lonLatToTile } from "./tile-math.js";

const PMTILES_INSTALL_URL = "https://github.com/protomaps/PMTiles/releases";
const DEFAULT_SAMPLE_SIZE = 5;

/** PMTiles をローカルファイルとして読むための Source 実装。 */
export class NodeFileSource {
  constructor(filePath) {
    this.filePath = filePath;
  }

  getKey() {
    return this.filePath;
  }

  async getBytes(offset, length) {
    const handle = await open(this.filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      return {
        data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      };
    } finally {
      await handle.close();
    }
  }
}

function toPmtilesSpawnError(error, command) {
  if (error?.code === "ENOENT") {
    return new Error(
      `pmtiles CLI (${command}) が見つかりません。${PMTILES_INSTALL_URL} からインストールし、PATH を通してください。`,
      { cause: error },
    );
  }
  return error;
}

/** `pmtiles show --header-json` を実行してヘッダ情報を取得する。 */
export function readHeaderJson(pmtilesPath, { command = "pmtiles", spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, ["show", "--header-json", pmtilesPath]);
    } catch (error) {
      reject(toPmtilesSpawnError(error, command));
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(toPmtilesSpawnError(error, command));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pmtiles show が終了コード ${code} で失敗しました。${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`pmtiles show の出力を JSON として解釈できません: ${error.message}`));
      }
    });
  });
}

/** ヘッダのズーム範囲が期待値どおりかを検証する。 */
export function assertZoomRange(header, { minZoom = TILE_MIN_ZOOM, maxZoom = TILE_MAX_ZOOM } = {}) {
  const errors = [];

  if (header?.minzoom !== minZoom) {
    errors.push(`minzoom が ${minZoom} ではありません(実際: ${header?.minzoom})`);
  }
  if (header?.maxzoom !== maxZoom) {
    errors.push(`maxzoom が ${maxZoom} ではありません(実際: ${header?.maxzoom})`);
  }

  return errors;
}

/** Feature を等間隔にサンプリングする。 */
export function sampleFeatures(features, sampleSize) {
  if (!Array.isArray(features) || features.length === 0 || sampleSize <= 0) return [];

  const size = Math.min(sampleSize, features.length);
  const step = features.length / size;

  const sampled = [];
  for (let index = 0; index < size; index += 1) {
    sampled.push(features[Math.floor(index * step)]);
  }
  return sampled;
}

/**
 * MVT のプロパティ値を GeoJSON 側と比較できる形へ戻す。
 * 配列・オブジェクトは MVT では JSON 文字列として格納されるためパースする。
 */
export function normalizeTileValue(value) {
  if (typeof value !== "string") return value;

  const text = value.trim();
  if (!text.startsWith("[") && !text.startsWith("{")) return value;

  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

/** GeoJSON 側の properties がすべてタイル側の Feature に含まれるか。 */
export function featureMatches(sourceProperties, tileProperties) {
  return Object.entries(sourceProperties ?? {}).every(([key, expected]) => {
    if (!(key in (tileProperties ?? {}))) return false;
    return isDeepStrictEqual(normalizeTileValue(tileProperties[key]), expected);
  });
}

function readTileFeatures(tileData, layerName) {
  const tile = new VectorTile(new Pbf(new Uint8Array(tileData)));
  const layer = tile.layers?.[layerName];
  if (!layer) return null;

  const features = [];
  for (let index = 0; index < layer.length; index += 1) {
    features.push(layer.feature(index).properties);
  }
  return features;
}

/** サンプル POI が対応する z14 タイル内に Feature として存在するかを検証する。 */
export async function verifySampleFeatures(archive, features, { zoom = TILE_MAX_ZOOM } = {}) {
  const errors = [];

  for (const feature of features) {
    const [longitude, latitude] = feature.geometry.coordinates;
    const tile = lonLatToTile(longitude, latitude, zoom);
    const label = feature.properties?.name ?? `(${longitude}, ${latitude})`;

    const result = await archive.getZxy(tile.z, tile.x, tile.y);
    if (!result?.data) {
      errors.push(`${label}: タイル ${tile.z}/${tile.x}/${tile.y} が存在しません`);
      continue;
    }

    const tileFeatures = readTileFeatures(result.data, TILE_LAYER);
    if (tileFeatures === null) {
      errors.push(
        `${label}: タイル ${tile.z}/${tile.x}/${tile.y} にレイヤ "${TILE_LAYER}" がありません`,
      );
      continue;
    }

    const found = tileFeatures.some((tileProperties) =>
      featureMatches(feature.properties, tileProperties),
    );
    if (!found) {
      errors.push(
        `${label}: タイル ${tile.z}/${tile.x}/${tile.y} 内に一致する Feature が見つかりません`,
      );
    }
  }

  return errors;
}

export function resolveSampleSize(env = process.env) {
  const raw = env?.BOOK_VERIFY_SAMPLE_SIZE;
  if (raw === undefined || String(raw).trim() === "") return DEFAULT_SAMPLE_SIZE;

  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`BOOK_VERIFY_SAMPLE_SIZE には 1 以上の整数を指定してください: ${raw}`);
  }
  return parsed;
}

/** 生成された PMTiles を検証する。問題があれば 1 を返す。 */
export async function verifyTiles({
  env = process.env,
  readHeader = readHeaderJson,
  openArchive = (filePath) => new PMTiles(new NodeFileSource(filePath)),
  logger = console,
} = {}) {
  const geojsonPath = resolveGeoJsonPath(env);
  const pmtilesPath = resolvePmtilesPath(env);

  try {
    const sampleSize = resolveSampleSize(env);

    const header = await readHeader(pmtilesPath);
    const errors = assertZoomRange(header);

    const geojson = JSON.parse(await readFile(geojsonPath, "utf8"));
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    if (features.length === 0) {
      errors.push(`${geojsonPath} に Feature がありません`);
    }

    const sampled = sampleFeatures(features, sampleSize);
    const archive = openArchive(pmtilesPath);
    errors.push(...(await verifySampleFeatures(archive, sampled)));

    if (errors.length > 0) {
      logger.error?.("PMTiles の検証に失敗しました:");
      for (const error of errors) logger.error?.(`  - ${error}`);
      return 1;
    }

    logger.log?.(
      `検証に成功しました: ${pmtilesPath} (minzoom=${header.minzoom}, maxzoom=${header.maxzoom}, サンプル ${sampled.length} 件)`,
    );
    return 0;
  } catch (error) {
    logger.error?.(`PMTiles の検証に失敗しました: ${error?.message ?? error}`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = await verifyTiles();
}
