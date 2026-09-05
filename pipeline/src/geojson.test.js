import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProperties,
  elementsToFeatures,
  isValidPointGeometry,
  toFeatureCollection,
} from "./geojson.js";

/** queryOverturePlaces() が返す正規化済みレコードを模したもの。 */
function record(overrides = {}) {
  return {
    id: "place-1",
    names: { primary: "紀伊國屋書店 新宿本店" },
    categories: { primary: "bookstore" },
    brand: { names: { primary: "紀伊國屋書店" } },
    addresses: [{ freeform: "東京都新宿区新宿3-17-7", country: "JP" }],
    websites: ["https://store.example.com/shinjuku"],
    confidence: 0.97,
    geometry: { type: "Point", coordinates: [139.7005, 35.6909] },
    ...overrides,
  };
}

test("elementsToFeatures: 主要プロパティが properties へ写される", () => {
  const [feature] = elementsToFeatures([record()]);

  assert.equal(feature.type, "Feature");
  assert.deepEqual(feature.geometry, { type: "Point", coordinates: [139.7005, 35.6909] });
  assert.deepEqual(feature.properties, {
    name: "紀伊國屋書店 新宿本店",
    brand: "紀伊國屋書店",
    address: "東京都新宿区新宿3-17-7",
    confidence: 0.97,
    websites: ["https://store.example.com/shinjuku"],
  });
});

test("elementsToFeatures: confidence は数値のまま保持される", () => {
  const [feature] = elementsToFeatures([record({ confidence: 0.9 })]);

  assert.equal(feature.properties.confidence, 0.9);
  assert.equal(typeof feature.properties.confidence, "number");
});

test("elementsToFeatures: websites を持たないレコードではキーが省略される", () => {
  for (const websites of [undefined, null, [], ["", "   "]]) {
    const [feature] = elementsToFeatures([record({ websites })]);

    assert.equal(
      "websites" in feature.properties,
      false,
      `websites=${JSON.stringify(websites)} でキーが残っている`,
    );
  }
});

test("elementsToFeatures: 住所を持たないレコードではキーが省略される", () => {
  for (const addresses of [undefined, null, [], [{ country: "JP" }], [{ freeform: "  " }]]) {
    const [feature] = elementsToFeatures([record({ addresses })]);

    assert.equal(
      "address" in feature.properties,
      false,
      `addresses=${JSON.stringify(addresses)} でキーが残っている`,
    );
  }
});

test("elementsToFeatures: brand を持たないレコードではキーが省略される", () => {
  for (const brand of [undefined, null, {}, { names: {} }]) {
    const [feature] = elementsToFeatures([record({ brand })]);

    assert.equal("brand" in feature.properties, false);
    // brand が無くても name は残り、ビューア側のチェーン判定に使える
    assert.equal(feature.properties.name, "紀伊國屋書店 新宿本店");
  }
});

test("elementsToFeatures: 座標が不正なレコードはスキップされ処理は継続する", () => {
  const invalidGeometries = [
    undefined,
    null,
    { type: "Point" },
    { type: "Point", coordinates: [] },
    { type: "Point", coordinates: [139.7] },
    { type: "Point", coordinates: ["139.7", "35.6"] },
    { type: "Point", coordinates: [Number.NaN, 35.6] },
    { type: "Point", coordinates: [139.7, Number.POSITIVE_INFINITY] },
    { type: "LineString", coordinates: [[139.7, 35.6], [139.8, 35.7]] },
  ];

  const records = [
    record({ id: "ok-first" }),
    ...invalidGeometries.map((geometry, index) => record({ id: `ng-${index}`, geometry })),
    record({ id: "ok-last" }),
  ];

  const features = elementsToFeatures(records);

  assert.equal(features.length, 2, "有効なレコードだけが残るべき");
  assert.deepEqual(
    features.map((feature) => feature.properties.name),
    ["紀伊國屋書店 新宿本店", "紀伊國屋書店 新宿本店"],
  );
});

test("elementsToFeatures: 座標が 0 のレコードは有効として扱われる", () => {
  const features = elementsToFeatures([record({ geometry: { type: "Point", coordinates: [0, 0] } })]);

  assert.equal(features.length, 1);
  assert.deepEqual(features[0].geometry.coordinates, [0, 0]);
});

test("elementsToFeatures: 配列でない入力は空配列になる", () => {
  assert.deepEqual(elementsToFeatures(undefined), []);
  assert.deepEqual(elementsToFeatures(null), []);
  assert.deepEqual(elementsToFeatures([]), []);
});

test("buildProperties: 空文字列や空白のみの値はキーごと省略される", () => {
  const properties = buildProperties({
    names: { primary: "   " },
    brand: { names: { primary: "" } },
    addresses: [{ freeform: "" }],
    confidence: "0.97",
  });

  assert.deepEqual(properties, {});
});

test("buildProperties: websites は空要素を除いた配列になる", () => {
  const properties = buildProperties({
    websites: ["https://a.example.com", "  ", "https://b.example.com "],
  });

  assert.deepEqual(properties.websites, ["https://a.example.com", "https://b.example.com"]);
});

test("isValidPointGeometry: Point かつ有限座標のみ true", () => {
  assert.equal(isValidPointGeometry({ type: "Point", coordinates: [139.7, 35.6] }), true);
  assert.equal(isValidPointGeometry({ type: "Point", coordinates: [139.7, null] }), false);
  assert.equal(isValidPointGeometry({ type: "Polygon", coordinates: [] }), false);
  assert.equal(isValidPointGeometry(null), false);
});

test("toFeatureCollection: FeatureCollection として包む", () => {
  const features = elementsToFeatures([record()]);

  assert.deepEqual(toFeatureCollection(features), {
    type: "FeatureCollection",
    features,
  });
});
