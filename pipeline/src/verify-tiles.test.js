import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  assertZoomRange,
  featureMatches,
  normalizeTileValue,
  readHeaderJson,
  resolveSampleSize,
  sampleFeatures,
  verifySampleFeatures,
} from "./verify-tiles.js";

test("assertZoomRange: minzoom=10 / maxzoom=14 なら問題なし", () => {
  assert.deepEqual(assertZoomRange({ minzoom: 10, maxzoom: 14 }), []);
});

test("assertZoomRange: ズーム範囲が異なれば理由つきで報告される", () => {
  const errors = assertZoomRange({ minzoom: 0, maxzoom: 16 });

  assert.equal(errors.length, 2);
  assert.match(errors[0], /minzoom が 10 ではありません.*0/);
  assert.match(errors[1], /maxzoom が 14 ではありません.*16/);
});

test("assertZoomRange: ヘッダが空でも例外にせずエラーとして返す", () => {
  assert.equal(assertZoomRange({}).length, 2);
  assert.equal(assertZoomRange(undefined).length, 2);
});

test("sampleFeatures: 等間隔にサンプリングする", () => {
  const features = Array.from({ length: 10 }, (_, index) => index);

  assert.deepEqual(sampleFeatures(features, 5), [0, 2, 4, 6, 8]);
  assert.deepEqual(sampleFeatures(features, 1), [0]);
});

test("sampleFeatures: 件数がサンプル数より少なければ全件", () => {
  assert.deepEqual(sampleFeatures([1, 2], 5), [1, 2]);
  assert.deepEqual(sampleFeatures([], 5), []);
  assert.deepEqual(sampleFeatures([1, 2], 0), []);
});

test("normalizeTileValue: JSON 文字列の配列・オブジェクトはパースされる", () => {
  assert.deepEqual(normalizeTileValue('["https://a.example.com"]'), ["https://a.example.com"]);
  assert.deepEqual(normalizeTileValue('{"a":1}'), { a: 1 });
});

test("normalizeTileValue: 通常の文字列・数値はそのまま", () => {
  assert.equal(normalizeTileValue("紀伊國屋書店"), "紀伊國屋書店");
  assert.equal(normalizeTileValue(0.97), 0.97);
  // JSON として壊れている場合は元の文字列を保つ
  assert.equal(normalizeTileValue("[壊れた"), "[壊れた");
});

test("featureMatches: 配列プロパティは JSON 文字列をパースして比較する", () => {
  const source = { name: "紀伊國屋書店 新宿本店", websites: ["https://a.example.com"] };
  const tile = {
    name: "紀伊國屋書店 新宿本店",
    websites: '["https://a.example.com"]',
    extra: "タイル側にだけある値は無視する",
  };

  assert.equal(featureMatches(source, tile), true);
});

test("featureMatches: 値が違う・キーが無い場合は false", () => {
  assert.equal(featureMatches({ name: "A" }, { name: "B" }), false);
  assert.equal(featureMatches({ name: "A" }, {}), false);
  assert.equal(featureMatches({ confidence: 0.97 }, { confidence: 0.93 }), false);
});

test("resolveSampleSize: 既定は 5、環境変数で上書きできる", () => {
  assert.equal(resolveSampleSize({}), 5);
  assert.equal(resolveSampleSize({ BOOK_VERIFY_SAMPLE_SIZE: "" }), 5);
  assert.equal(resolveSampleSize({ BOOK_VERIFY_SAMPLE_SIZE: "12" }), 12);
});

test("resolveSampleSize: 不正な値は例外になる", () => {
  assert.throws(() => resolveSampleSize({ BOOK_VERIFY_SAMPLE_SIZE: "0" }), /1 以上の整数/);
  assert.throws(() => resolveSampleSize({ BOOK_VERIFY_SAMPLE_SIZE: "-3" }), /1 以上の整数/);
  assert.throws(() => resolveSampleSize({ BOOK_VERIFY_SAMPLE_SIZE: "abc" }), /1 以上の整数/);
});

function feature(properties, coordinates = [139.7005, 35.6909]) {
  return { type: "Feature", geometry: { type: "Point", coordinates }, properties };
}

/** getZxy が指定のプロパティを持つ MVT を返す代わりに、読み取り済みの結果を差し込む。 */
function archiveReturning(tileData) {
  return { getZxy: async () => tileData };
}

test("verifySampleFeatures: タイルが存在しなければエラーになる", async () => {
  const errors = await verifySampleFeatures(archiveReturning(undefined), [
    feature({ name: "紀伊國屋書店 新宿本店" }),
  ]);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /タイル 14\/14549\/6451 が存在しません/);
});

test("readHeaderJson: pmtiles CLI 未インストールなら導入方法を案内する", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      const error = new Error("spawn pmtiles ENOENT");
      error.code = "ENOENT";
      child.emit("error", error);
    });
    return child;
  };

  await assert.rejects(
    () => readHeaderJson("/out.pmtiles", { spawnImpl }),
    (error) => {
      assert.match(error.message, /pmtiles CLI \(pmtiles\) が見つかりません/);
      assert.equal(error.cause?.code, "ENOENT");
      return true;
    },
  );
});

test("readHeaderJson: 出力 JSON をパースして返す", async () => {
  const spawnImpl = (command, args) => {
    assert.equal(command, "pmtiles");
    assert.deepEqual(args, ["show", "--header-json", "/out.pmtiles"]);

    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stdout.emit("data", '{"minzoom":10,');
      child.stdout.emit("data", '"maxzoom":14}');
      child.emit("close", 0);
    });
    return child;
  };

  assert.deepEqual(await readHeaderJson("/out.pmtiles", { spawnImpl }), {
    minzoom: 10,
    maxzoom: 14,
  });
});
