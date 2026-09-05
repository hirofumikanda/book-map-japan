import { spawn } from "node:child_process";

/**
 * 日本全体を覆う矩形 bbox。Overture Places の bbox カラムに対する一次絞り込みに使う。
 * ロシア極東・韓国・台湾の一部を含むため、最終的な国判定は addresses の国コードで行う。
 */
export const JAPAN_BBOX = Object.freeze({
  minLon: 122,
  maxLon: 154,
  minLat: 20,
  maxLat: 46,
});

/**
 * 取得対象の Overture カテゴリ。
 * 現時点では bookstore のみだが、将来の追加に備えて SQL 側は IN (...) の配列形を保つ。
 */
export const BOOKSTORE_CATEGORIES = Object.freeze(["bookstore"]);

/** パイプライン側の confidence 下限。ビューア側でさらにズーム連動のしきい値を重ねる。 */
export const MIN_CONFIDENCE = 0.9;

const OVERTURE_S3_RELEASE_BASE = "s3://overturemaps-us-west-2/release";

/** to_json() で JSON 化してから取り出すカラム(STRUCT / LIST 型)。 */
const JSON_COLUMNS = Object.freeze([
  "names",
  "categories",
  "brand",
  "addresses",
  "websites",
]);

const DUCKDB_INSTALL_URL = "https://duckdb.org/docs/installation/";

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function assertFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} には有限の数値を指定してください: ${value}`);
  }
  return value;
}

/**
 * Overture Places に対する DuckDB クエリを組み立てる。
 *
 * STRUCT / LIST 型のカラムはそのまま SELECT すると DuckDB CLI の -json 出力で
 * 有効な JSON にならないため to_json() を通す。geometry は ST_AsGeoJSON() で
 * VARCHAR 化し、Node 側で JSON.parse して復元する。
 */
export function buildQuery({
  release,
  bbox = JAPAN_BBOX,
  categories = BOOKSTORE_CATEGORIES,
  minConfidence = MIN_CONFIDENCE,
} = {}) {
  if (typeof release !== "string" || release.trim() === "") {
    throw new Error(
      "Overture Maps のリリースバージョンが指定されていません。" +
        "OVERTURE_RELEASE 環境変数を設定してください(例: OVERTURE_RELEASE=2026-08-20.0)。",
    );
  }

  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error("取得対象のカテゴリが空です。1つ以上のカテゴリを指定してください。");
  }

  assertFiniteNumber(bbox?.minLon, "bbox.minLon");
  assertFiniteNumber(bbox?.maxLon, "bbox.maxLon");
  assertFiniteNumber(bbox?.minLat, "bbox.minLat");
  assertFiniteNumber(bbox?.maxLat, "bbox.maxLat");
  assertFiniteNumber(minConfidence, "minConfidence");

  const source = `${OVERTURE_S3_RELEASE_BASE}/${release.trim()}/theme=places/type=place/*`;
  const categoryList = categories.map(quoteSqlString).join(", ");

  return `INSTALL spatial;
LOAD spatial;
INSTALL httpfs;
LOAD httpfs;
SET s3_region='us-west-2';

SELECT
  id,
  to_json(names) AS names,
  to_json(categories) AS categories,
  to_json(brand) AS brand,
  to_json(addresses) AS addresses,
  to_json(websites) AS websites,
  confidence,
  ST_AsGeoJSON(geometry) AS geometry
FROM read_parquet('${source}', filename=true, hive_partitioning=1)
WHERE categories.primary IN (${categoryList})
  AND confidence >= ${minConfidence}
  AND bbox.xmin >= ${bbox.minLon}
  AND bbox.xmax <= ${bbox.maxLon}
  AND bbox.ymin >= ${bbox.minLat}
  AND bbox.ymax <= ${bbox.maxLat};`;
}

/**
 * DuckDB CLI をサブプロセスとして実行し、-json 出力を文字列で返す。
 * CLI が見つからない場合は導入方法を案内するエラーにする。
 */
export function execDuckDb(query, { command = "duckdb", spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, ["-json", "-c", query]);
    } catch (error) {
      reject(toDuckDbSpawnError(error, command));
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
      reject(toDuckDbSpawnError(error, command));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `DuckDB CLI が終了コード ${code} で失敗しました。${stderr.trim() || stdout.trim()}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

function toDuckDbSpawnError(error, command) {
  if (error?.code === "ENOENT") {
    return new Error(
      `DuckDB CLI (${command}) が見つかりません。${DUCKDB_INSTALL_URL} を参照してインストールし、PATH を通してください。`,
      { cause: error },
    );
  }
  return error;
}

/** DuckDB CLI の -json 出力(JSON 配列)をパースする。空出力は空配列として扱う。 */
export function parseDuckDbOutput(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return [];

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("DuckDB の出力が JSON 配列ではありません。");
  }
  return parsed;
}

function maybeParseJson(value) {
  if (typeof value !== "string") return value ?? null;

  const text = value.trim();
  if (text === "" || text === "null") return null;

  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

/** to_json() したカラムと ST_AsGeoJSON() した geometry を JS の値へ復元する。 */
export function normalizeRecord(record) {
  const normalized = { ...record };

  for (const column of JSON_COLUMNS) {
    if (column in normalized) {
      normalized[column] = maybeParseJson(normalized[column]);
    }
  }

  if ("geometry" in normalized) {
    normalized.geometry = maybeParseJson(normalized.geometry);
  }

  return normalized;
}

/**
 * addresses に国コード JP を含むレコードだけを日本国内とみなす。
 * addresses を持たないレコードは国が確定できないため対象外。
 */
export function hasJapanAddress(record) {
  const addresses = record?.addresses;
  if (!Array.isArray(addresses)) return false;
  return addresses.some((address) => address?.country === "JP");
}

/**
 * Overture Places から日本国内の書店 POI を取得する。
 * execImpl を差し替えることで DuckDB CLI 無しでもテストできる。
 */
export async function queryOverturePlaces({
  release,
  bbox = JAPAN_BBOX,
  categories = BOOKSTORE_CATEGORIES,
  minConfidence = MIN_CONFIDENCE,
  execImpl = execDuckDb,
} = {}) {
  const query = buildQuery({ release, bbox, categories, minConfidence });
  const raw = await execImpl(query);

  return parseDuckDbOutput(raw).map(normalizeRecord).filter(hasJapanAddress);
}
