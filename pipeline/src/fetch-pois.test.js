import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { fetchPois, resolveGeoJsonPath } from "./fetch-pois.js";

const RELEASE = "2026-08-20.0";

function silentLogger() {
  return { log() {}, warn() {}, error() {} };
}

function validRecord(overrides = {}) {
  return {
    names: { primary: "紀伊國屋書店 新宿本店" },
    addresses: [{ freeform: "東京都新宿区新宿3-17-7", country: "JP" }],
    confidence: 0.97,
    geometry: { type: "Point", coordinates: [139.7005, 35.6909] },
    ...overrides,
  };
}

test("resolveGeoJsonPath: 既定は pipeline/out/book.geojson", () => {
  const resolved = resolveGeoJsonPath({});

  assert.equal(path.basename(resolved), "book.geojson");
  assert.equal(path.basename(path.dirname(resolved)), "out");
  assert.ok(path.isAbsolute(resolved));
});

test("resolveGeoJsonPath: BOOK_GEOJSON_PATH で上書きできる", () => {
  assert.equal(
    resolveGeoJsonPath({ BOOK_GEOJSON_PATH: "/tmp/custom.geojson" }),
    "/tmp/custom.geojson",
  );
  // 空文字・空白のみは未指定として扱う
  assert.equal(resolveGeoJsonPath({ BOOK_GEOJSON_PATH: "   " }), resolveGeoJsonPath({}));
});

test("fetchPois: OVERTURE_RELEASE が query へ渡される", async () => {
  let received;
  const query = async (options) => {
    received = options;
    return [];
  };

  await fetchPois({
    env: { OVERTURE_RELEASE: RELEASE },
    query,
    writeOutput: async () => {},
    logger: silentLogger(),
  });

  assert.equal(received.release, RELEASE);
});

test("fetchPois: 成功時は FeatureCollection を書き出して 0 を返す", async () => {
  const writes = [];

  const exitCode = await fetchPois({
    env: { OVERTURE_RELEASE: RELEASE },
    query: async () => [validRecord()],
    writeOutput: async (outputPath, featureCollection) => {
      writes.push({ outputPath, featureCollection });
    },
    logger: silentLogger(),
  });

  assert.equal(exitCode, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].featureCollection.type, "FeatureCollection");
  assert.equal(writes[0].featureCollection.features.length, 1);
  assert.equal(writes[0].featureCollection.features[0].properties.name, "紀伊國屋書店 新宿本店");
});

test("fetchPois: 取得に失敗した場合は書き出さず 1 を返す", async () => {
  let wrote = false;
  const errors = [];

  const exitCode = await fetchPois({
    env: { OVERTURE_RELEASE: RELEASE },
    query: async () => {
      throw new Error("S3 への接続がタイムアウトしました");
    },
    writeOutput: async () => {
      wrote = true;
    },
    logger: { ...silentLogger(), error: (message) => errors.push(message) },
  });

  assert.equal(exitCode, 1);
  assert.equal(wrote, false, "失敗時に不完全な GeoJSON を書き出している");
  assert.ok(errors.some((message) => message.includes("タイムアウト")));
});

test("fetchPois: release 未指定は取得エラーとして 1 を返す", async () => {
  let wrote = false;

  const exitCode = await fetchPois({
    env: {},
    query: async ({ release }) => {
      if (!release) throw new Error("リリースバージョンが指定されていません");
      return [];
    },
    writeOutput: async () => {
      wrote = true;
    },
    logger: silentLogger(),
  });

  assert.equal(exitCode, 1);
  assert.equal(wrote, false);
});

test("fetchPois: 書き出しに失敗した場合も 1 を返す", async () => {
  const exitCode = await fetchPois({
    env: { OVERTURE_RELEASE: RELEASE },
    query: async () => [validRecord()],
    writeOutput: async () => {
      throw new Error("EACCES: permission denied");
    },
    logger: silentLogger(),
  });

  assert.equal(exitCode, 1);
});

test("fetchPois: 座標が不正なレコードは警告のうえスキップされる", async () => {
  const warnings = [];
  const writes = [];

  const exitCode = await fetchPois({
    env: { OVERTURE_RELEASE: RELEASE },
    query: async () => [validRecord(), validRecord({ geometry: null })],
    writeOutput: async (_outputPath, featureCollection) => {
      writes.push(featureCollection);
    },
    logger: { ...silentLogger(), warn: (message) => warnings.push(message) },
  });

  assert.equal(exitCode, 0);
  assert.equal(writes[0].features.length, 1);
  assert.ok(warnings.some((message) => message.includes("1 件")));
});
