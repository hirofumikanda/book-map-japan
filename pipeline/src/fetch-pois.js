import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { elementsToFeatures, toFeatureCollection } from "./geojson.js";
import { queryOverturePlaces } from "./overture-client.js";
import { resolveGeoJsonPath } from "./paths.js";

export { resolveGeoJsonPath };

async function writeGeoJsonFile(outputPath, featureCollection) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(featureCollection)}\n`, "utf8");
}

/**
 * Overture Places から書店 POI を取得し、GeoJSON として書き出す。
 * 取得が成功した場合にのみ書き出し、失敗時は不完全な成果物を残さず 1 を返す。
 */
export async function fetchPois({
  env = process.env,
  query = queryOverturePlaces,
  writeOutput = writeGeoJsonFile,
  logger = console,
} = {}) {
  const outputPath = resolveGeoJsonPath(env);

  try {
    const records = await query({ release: env?.OVERTURE_RELEASE });
    const features = elementsToFeatures(records);

    if (features.length < records.length) {
      logger.warn?.(
        `座標が不正な ${records.length - features.length} 件をスキップしました。`,
      );
    }

    await writeOutput(outputPath, toFeatureCollection(features));
    logger.log?.(`${features.length} 件の書店POIを ${outputPath} へ書き出しました。`);
    return 0;
  } catch (error) {
    logger.error?.(`書店POIの取得に失敗しました: ${error?.message ?? error}`);
    logger.error?.(`${outputPath} は書き出していません。`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = await fetchPois();
}
