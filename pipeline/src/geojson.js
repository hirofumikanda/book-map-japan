/**
 * Overture Places のレコードを、タイル生成とビューア表示に必要な
 * プロパティだけを持つ GeoJSON Feature へ変換する。
 */

function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trimmedOrNull(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

/** Point かつ経度・緯度が有限の数値であることを確認する。 */
export function isValidPointGeometry(geometry) {
  if (!geometry || geometry.type !== "Point") return false;

  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false;

  return toFiniteNumber(coordinates[0]) !== null && toFiniteNumber(coordinates[1]) !== null;
}

function normalizeWebsites(value) {
  if (!Array.isArray(value)) return null;

  const websites = value.map(trimmedOrNull).filter((website) => website !== null);
  return websites.length > 0 ? websites : null;
}

/**
 * Feature の properties を組み立てる。
 * 値を持たない項目はキーごと省略し、空文字列や null を入れない。
 */
export function buildProperties(record) {
  const properties = {};

  const name = trimmedOrNull(record?.names?.primary);
  if (name !== null) properties.name = name;

  const brand = trimmedOrNull(record?.brand?.names?.primary);
  if (brand !== null) properties.brand = brand;

  const address = trimmedOrNull(record?.addresses?.[0]?.freeform);
  if (address !== null) properties.address = address;

  const confidence = toFiniteNumber(record?.confidence);
  if (confidence !== null) properties.confidence = confidence;

  const websites = normalizeWebsites(record?.websites);
  if (websites !== null) properties.websites = websites;

  return properties;
}

/**
 * レコード配列を Feature 配列へ変換する。
 * 座標が不正なレコードはスキップし、処理全体は停止しない。
 */
export function elementsToFeatures(records) {
  if (!Array.isArray(records)) return [];

  const features = [];

  for (const record of records) {
    if (!isValidPointGeometry(record?.geometry)) continue;

    const [longitude, latitude] = record.geometry.coordinates;

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [longitude, latitude] },
      properties: buildProperties(record),
    });
  }

  return features;
}

export function toFeatureCollection(features) {
  return { type: "FeatureCollection", features };
}
