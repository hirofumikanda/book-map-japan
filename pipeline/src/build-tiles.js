import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveGeoJsonPath, resolvePmtilesPath } from "./paths.js";

/** ビューア側の source-layer と一致させる必要があるレイヤ名。 */
export const TILE_LAYER = "book";
export const TILE_MIN_ZOOM = 10;
export const TILE_MAX_ZOOM = 14;

const TIPPECANOE_INSTALL_URL = "https://github.com/felt/tippecanoe";

/**
 * tippecanoe の引数を組み立てる。
 *
 * 密度ベースの間引き(--drop-rate)・フィーチャ数上限・タイルサイズ上限をすべて
 * 無効化する。既定の drop-rate では低ズームでチェーン店が虫食いになるため。
 */
export function buildTippecanoeArgs({ geojsonPath, pmtilesPath }) {
  return [
    `--output=${pmtilesPath}`,
    "--force",
    `--layer=${TILE_LAYER}`,
    `--minimum-zoom=${TILE_MIN_ZOOM}`,
    `--maximum-zoom=${TILE_MAX_ZOOM}`,
    "--no-feature-limit",
    "--no-tile-size-limit",
    "--drop-rate=0",
    geojsonPath,
  ];
}

function toTippecanoeSpawnError(error, command) {
  if (error?.code === "ENOENT") {
    return new Error(
      `tippecanoe (${command}) が見つかりません。${TIPPECANOE_INSTALL_URL} を参照してインストールし、PATH を通してください。`,
      { cause: error },
    );
  }
  return error;
}

/** tippecanoe をサブプロセス実行する。stdio は親へ引き継ぐ(進捗表示のため)。 */
export function execTippecanoe(args, { command = "tippecanoe", spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, { stdio: "inherit" });
    } catch (error) {
      reject(toTippecanoeSpawnError(error, command));
      return;
    }

    child.on("error", (error) => {
      reject(toTippecanoeSpawnError(error, command));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`tippecanoe が終了コード ${code} で失敗しました。`));
        return;
      }
      resolve();
    });
  });
}

/** GeoJSON を z10-14 の PMTiles へ変換する。 */
export async function buildTiles({
  env = process.env,
  exec = execTippecanoe,
  logger = console,
} = {}) {
  const geojsonPath = resolveGeoJsonPath(env);
  const pmtilesPath = resolvePmtilesPath(env);

  try {
    await exec(buildTippecanoeArgs({ geojsonPath, pmtilesPath }));
    logger.log?.(`${pmtilesPath} を生成しました(layer=${TILE_LAYER}, z${TILE_MIN_ZOOM}-${TILE_MAX_ZOOM})。`);
    return 0;
  } catch (error) {
    logger.error?.(`PMTiles の生成に失敗しました: ${error?.message ?? error}`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = await buildTiles();
}
