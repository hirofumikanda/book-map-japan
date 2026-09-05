import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  TILE_LAYER,
  TILE_MAX_ZOOM,
  TILE_MIN_ZOOM,
  buildTiles,
  buildTippecanoeArgs,
  execTippecanoe,
} from "./build-tiles.js";

function silentLogger() {
  return { log() {}, error() {} };
}

test("buildTippecanoeArgs: 間引き無効化の3フラグが渡る", () => {
  const args = buildTippecanoeArgs({ geojsonPath: "/in.geojson", pmtilesPath: "/out.pmtiles" });

  assert.ok(args.includes("--no-feature-limit"));
  assert.ok(args.includes("--no-tile-size-limit"));
  assert.ok(args.includes("--drop-rate=0"));
});

test("buildTippecanoeArgs: レイヤ名とズーム範囲が指定される", () => {
  const args = buildTippecanoeArgs({ geojsonPath: "/in.geojson", pmtilesPath: "/out.pmtiles" });

  assert.ok(args.includes(`--layer=${TILE_LAYER}`));
  assert.equal(TILE_LAYER, "book");
  assert.ok(args.includes(`--minimum-zoom=${TILE_MIN_ZOOM}`));
  assert.ok(args.includes(`--maximum-zoom=${TILE_MAX_ZOOM}`));
  assert.equal(TILE_MIN_ZOOM, 10);
  assert.equal(TILE_MAX_ZOOM, 14);
});

test("buildTippecanoeArgs: 出力先と --force、入力は末尾", () => {
  const args = buildTippecanoeArgs({ geojsonPath: "/in.geojson", pmtilesPath: "/out.pmtiles" });

  assert.ok(args.includes("--output=/out.pmtiles"));
  assert.ok(args.includes("--force"));
  assert.equal(args.at(-1), "/in.geojson");
});

test("buildTiles: BOOK_GEOJSON_PATH / BOOK_PMTILES_PATH で入出力を上書きできる", async () => {
  let received = null;

  const exitCode = await buildTiles({
    env: { BOOK_GEOJSON_PATH: "/tmp/in.geojson", BOOK_PMTILES_PATH: "/tmp/out.pmtiles" },
    exec: async (args) => {
      received = args;
    },
    logger: silentLogger(),
  });

  assert.equal(exitCode, 0);
  assert.ok(received.includes("--output=/tmp/out.pmtiles"));
  assert.equal(received.at(-1), "/tmp/in.geojson");
});

test("buildTiles: tippecanoe が失敗したら 1 を返す", async () => {
  const errors = [];

  const exitCode = await buildTiles({
    env: {},
    exec: async () => {
      throw new Error("tippecanoe が終了コード 1 で失敗しました。");
    },
    logger: { ...silentLogger(), error: (message) => errors.push(message) },
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some((message) => message.includes("終了コード 1")));
});

test("execTippecanoe: 未インストール(ENOENT)なら導入方法を案内する", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    queueMicrotask(() => {
      const error = new Error("spawn tippecanoe ENOENT");
      error.code = "ENOENT";
      child.emit("error", error);
    });
    return child;
  };

  await assert.rejects(
    () => execTippecanoe([], { spawnImpl }),
    (error) => {
      assert.match(error.message, /tippecanoe \(tippecanoe\) が見つかりません/);
      assert.match(error.message, /github\.com\/felt\/tippecanoe/);
      assert.equal(error.cause?.code, "ENOENT");
      return true;
    },
  );
});

test("execTippecanoe: 非ゼロ終了ならエラーになる", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 2));
    return child;
  };

  await assert.rejects(() => execTippecanoe([], { spawnImpl }), /終了コード 2/);
});
