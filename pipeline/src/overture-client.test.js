import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  BOOKSTORE_CATEGORIES,
  JAPAN_BBOX,
  MIN_CONFIDENCE,
  buildQuery,
  execDuckDb,
  hasJapanAddress,
  normalizeRecord,
  parseDuckDbOutput,
  queryOverturePlaces,
} from "./overture-client.js";

const RELEASE = "2026-08-20.0";

function jpAddresses() {
  return [{ freeform: "東京都新宿区新宿3-17-7", country: "JP" }];
}

/** DuckDB CLI の -json 出力を模した行を作る(JSON カラムは文字列で返ってくる想定)。 */
function duckDbRow(overrides = {}) {
  return {
    id: "place-1",
    names: JSON.stringify({ primary: "紀伊國屋書店 新宿本店" }),
    categories: JSON.stringify({ primary: "bookstore" }),
    brand: JSON.stringify({ names: { primary: "紀伊國屋書店" } }),
    addresses: JSON.stringify(jpAddresses()),
    websites: JSON.stringify(["https://example.com/"]),
    confidence: 0.97,
    geometry: JSON.stringify({ type: "Point", coordinates: [139.7005, 35.6909] }),
    ...overrides,
  };
}

function execReturning(rows) {
  return async () => JSON.stringify(rows);
}

test("buildQuery: release が未指定なら例外を投げる", () => {
  assert.throws(() => buildQuery({}), /リリースバージョン/);
  assert.throws(() => buildQuery({ release: "" }), /リリースバージョン/);
  assert.throws(() => buildQuery({ release: "   " }), /リリースバージョン/);
});

test("buildQuery: カテゴリ・bbox・confidence しきい値が SQL に含まれる", () => {
  const sql = buildQuery({ release: RELEASE });

  assert.match(sql, /categories\.primary IN \('bookstore'\)/);
  assert.match(sql, /confidence >= 0\.9/);
  assert.match(sql, /bbox\.xmin >= 122/);
  assert.match(sql, /bbox\.xmax <= 154/);
  assert.match(sql, /bbox\.ymin >= 20/);
  assert.match(sql, /bbox\.ymax <= 46/);
  assert.ok(sql.includes(`release/${RELEASE}/theme=places/type=place/*`));
});

test("buildQuery: 既定値が定数と一致する", () => {
  assert.deepEqual({ ...JAPAN_BBOX }, { minLon: 122, maxLon: 154, minLat: 20, maxLat: 46 });
  assert.deepEqual([...BOOKSTORE_CATEGORIES], ["bookstore"]);
  assert.equal(MIN_CONFIDENCE, 0.9);
});

test("buildQuery: カテゴリは複数指定でも IN の配列形を保つ", () => {
  const sql = buildQuery({ release: RELEASE, categories: ["bookstore", "used_bookstore"] });

  assert.match(sql, /categories\.primary IN \('bookstore', 'used_bookstore'\)/);
});

test("buildQuery: STRUCT/LIST は to_json、geometry は ST_AsGeoJSON で取り出す", () => {
  const sql = buildQuery({ release: RELEASE });

  for (const column of ["names", "categories", "brand", "addresses", "websites"]) {
    assert.ok(
      sql.includes(`to_json(${column}) AS ${column}`),
      `${column} が to_json されていない`,
    );
  }
  assert.match(sql, /ST_AsGeoJSON\(geometry\) AS geometry/);
});

test("buildQuery: spatial / httpfs のロードと s3_region の設定を含む", () => {
  const sql = buildQuery({ release: RELEASE });

  assert.match(sql, /INSTALL spatial;\nLOAD spatial;/);
  assert.match(sql, /INSTALL httpfs;\nLOAD httpfs;/);
  assert.match(sql, /SET s3_region='us-west-2';/);
});

test("buildQuery: bbox に数値以外が渡されたら例外を投げる", () => {
  assert.throws(
    () => buildQuery({ release: RELEASE, bbox: { ...JAPAN_BBOX, minLon: undefined } }),
    /bbox\.minLon/,
  );
});

test("parseDuckDbOutput: 空出力は空配列になる", () => {
  assert.deepEqual(parseDuckDbOutput(""), []);
  assert.deepEqual(parseDuckDbOutput("   \n"), []);
  assert.deepEqual(parseDuckDbOutput(undefined), []);
});

test("normalizeRecord: to_json されたカラムがオブジェクトへ復元される", () => {
  const record = normalizeRecord(duckDbRow());

  assert.deepEqual(record.names, { primary: "紀伊國屋書店 新宿本店" });
  assert.deepEqual(record.brand, { names: { primary: "紀伊國屋書店" } });
  assert.deepEqual(record.addresses, jpAddresses());
  assert.deepEqual(record.websites, ["https://example.com/"]);
});

test("normalizeRecord: geometry 文字列がオブジェクトへ復元される", () => {
  const record = normalizeRecord(duckDbRow());

  assert.deepEqual(record.geometry, { type: "Point", coordinates: [139.7005, 35.6909] });
});

// DuckDB CLI の -json 出力では、to_json() / ST_AsGeoJSON() の結果は文字列ではなく
// インラインの JSON 値として現れる。実際の CLI 出力に合わせたケース。
test("normalizeRecord: 既にパース済みのインライン JSON はそのまま保持される", () => {
  const record = normalizeRecord({
    id: "place-1",
    names: { primary: "紀伊國屋書店 新宿本店" },
    categories: { primary: "bookstore" },
    brand: { names: { primary: "紀伊國屋書店" } },
    addresses: jpAddresses(),
    websites: ["https://example.com/"],
    confidence: 0.97,
    geometry: { type: "Point", coordinates: [139.7005, 35.6909] },
  });

  assert.deepEqual(record.names, { primary: "紀伊國屋書店 新宿本店" });
  assert.deepEqual(record.addresses, jpAddresses());
  assert.deepEqual(record.geometry, { type: "Point", coordinates: [139.7005, 35.6909] });
});

test("queryOverturePlaces: インライン JSON 形式でも JP 判定と geometry 復元が働く", async () => {
  const rows = [
    { id: "jp", addresses: jpAddresses(), geometry: { type: "Point", coordinates: [139.7, 35.6] } },
    { id: "kr", addresses: [{ country: "KR" }], geometry: { type: "Point", coordinates: [127, 37] } },
  ];

  const records = await queryOverturePlaces({ release: RELEASE, execImpl: execReturning(rows) });

  assert.deepEqual(
    records.map((record) => record.id),
    ["jp"],
  );
  assert.deepEqual(records[0].geometry, { type: "Point", coordinates: [139.7, 35.6] });
});

test("normalizeRecord: null 相当の JSON カラムは null になる", () => {
  const record = normalizeRecord(duckDbRow({ brand: "null", websites: "" }));

  assert.equal(record.brand, null);
  assert.equal(record.websites, null);
});

test("hasJapanAddress: 国コードで日本国内を判定する", () => {
  assert.equal(hasJapanAddress({ addresses: jpAddresses() }), true);
  assert.equal(hasJapanAddress({ addresses: [{ country: "KR" }] }), false);
  assert.equal(hasJapanAddress({ addresses: [] }), false);
  assert.equal(hasJapanAddress({}), false);
  assert.equal(hasJapanAddress({ addresses: null }), false);
});

test("queryOverturePlaces: release 未指定ならクエリを実行せず例外を投げる", async () => {
  let called = false;
  const execImpl = async () => {
    called = true;
    return "[]";
  };

  await assert.rejects(() => queryOverturePlaces({ execImpl }), /リリースバージョン/);
  assert.equal(called, false, "release 未指定なのに DuckDB が呼ばれている");
});

test("queryOverturePlaces: JP 以外の住所・住所なしのレコードが除外される", async () => {
  const rows = [
    duckDbRow({ id: "jp" }),
    duckDbRow({ id: "kr", addresses: JSON.stringify([{ country: "KR" }]) }),
    duckDbRow({ id: "no-address", addresses: "null" }),
  ];

  const records = await queryOverturePlaces({ release: RELEASE, execImpl: execReturning(rows) });

  assert.deepEqual(
    records.map((record) => record.id),
    ["jp"],
  );
});

test("queryOverturePlaces: 取得結果の geometry がオブジェクトへ復元される", async () => {
  const records = await queryOverturePlaces({
    release: RELEASE,
    execImpl: execReturning([duckDbRow()]),
  });

  assert.equal(records.length, 1);
  assert.deepEqual(records[0].geometry, { type: "Point", coordinates: [139.7005, 35.6909] });
  assert.equal(records[0].confidence, 0.97);
});

test("queryOverturePlaces: 組み立てた SQL がそのまま実行される", async () => {
  let received = null;
  const execImpl = async (query) => {
    received = query;
    return "[]";
  };

  await queryOverturePlaces({ release: RELEASE, execImpl });

  assert.equal(received, buildQuery({ release: RELEASE }));
});

test("execDuckDb: CLI 未インストール(ENOENT)なら導入方法を案内する", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      const error = new Error("spawn duckdb ENOENT");
      error.code = "ENOENT";
      child.emit("error", error);
    });
    return child;
  };

  await assert.rejects(
    () => execDuckDb("SELECT 1;", { spawnImpl }),
    (error) => {
      assert.match(error.message, /DuckDB CLI \(duckdb\) が見つかりません/);
      assert.match(error.message, /duckdb\.org\/docs\/installation/);
      assert.equal(error.cause?.code, "ENOENT");
      return true;
    },
  );
});

test("execDuckDb: 非ゼロ終了なら stderr を含むエラーになる", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stderr.emit("data", "Parser Error: syntax error");
      child.emit("close", 1);
    });
    return child;
  };

  await assert.rejects(() => execDuckDb("SELECT", { spawnImpl }), /Parser Error: syntax error/);
});

test("execDuckDb: 正常終了なら stdout をそのまま返す", async () => {
  const spawnImpl = (command, args) => {
    assert.equal(command, "duckdb");
    assert.deepEqual(args.slice(0, 2), ["-json", "-c"]);

    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stdout.emit("data", '[{"id":');
      child.stdout.emit("data", '"place-1"}]');
      child.emit("close", 0);
    });
    return child;
  };

  const raw = await execDuckDb("SELECT 1;", { spawnImpl });

  assert.deepEqual(parseDuckDbOutput(raw), [{ id: "place-1" }]);
});
