import assert from "node:assert/strict";
import test from "node:test";

import { expression } from "@maplibre/maplibre-gl-style-spec";

import {
  CHAIN_FILTER_OPTIONS,
  CHAIN_TABLE,
  GENERIC_BOOK_ICON_ID,
  buildChainIdExpression,
  buildIconImageExpression,
  normalizeChainText,
  resolveChainIconId,
} from "./chains.js";

/** 生成した式を MapLibre 本体のパーサへ通し、実際に評価できる形かを検証する。 */
function compile(styleExpression) {
  const compiled = expression.createExpression(styleExpression, {
    type: "string",
    "property-type": "data-driven",
    expression: { interpolated: false, parameters: ["zoom", "feature"] },
  });

  assert.equal(
    compiled.result,
    "success",
    compiled.result === "error"
      ? compiled.value.map((error) => error.message).join("\n")
      : "",
  );

  return (properties) => compiled.value.evaluate({ zoom: 14 }, { properties });
}

test("9チェーンそれぞれが専用アイコンIDへ解決される", () => {
  const cases = [
    ["くまざわ書店ペリエ千葉本店", "kumazawa"],
    ["未来屋書店イオンモール幕張新都心店", "miraiya"],
    ["宮脇書店 流山店", "miyawaki"],
    ["紀伊國屋書店新宿本店", "kinokuniya"],
    ["丸善 丸の内本店", "maruzen"],
    ["ジュンク堂書店池袋本店", "junku"],
    ["文教堂 青戸店", "bunkyo"],
    ["三省堂書店有楽町店", "sansei"],
    ["有隣堂伊勢佐木町本店", "yurin"],
  ];

  for (const [name, expected] of cases) {
    assert.equal(resolveChainIconId({ name }), expected, name);
  }

  // テーブルの全エントリが1件ずつ網羅されていること
  assert.equal(new Set(cases.map(([, id]) => id)).size, CHAIN_TABLE.length);
});

test("どのチェーンにも一致しないPOIは汎用アイコンへフォールバックする", () => {
  assert.equal(resolveChainIconId({ name: "町の本屋さん" }), GENERIC_BOOK_ICON_ID);
  assert.equal(resolveChainIconId({}), GENERIC_BOOK_ICON_ID);
  assert.equal(resolveChainIconId(undefined), GENERIC_BOOK_ICON_ID);
  assert.equal(resolveChainIconId({ name: null }), GENERIC_BOOK_ICON_ID);
});

test("「三省堂」単独では一致せず、刃物店を誤判定しない", () => {
  // 実データに存在する誤マッチ候補(design.md Decision 8)
  assert.equal(resolveChainIconId({ name: "刃物や三省堂" }), GENERIC_BOOK_ICON_ID);
  assert.equal(resolveChainIconId({ name: "三省堂書店" }), "sansei");
});

test("法人格表記が吸収される", () => {
  assert.equal(resolveChainIconId({ brand: "株式会社有隣堂" }), "yurin");
  assert.equal(resolveChainIconId({ brand: "有限会社宮脇書店" }), "miyawaki");
  assert.equal(resolveChainIconId({ brand: "（株）文教堂" }), "bunkyo");
});

test("全角/半角のゆれと前後の空白が吸収される", () => {
  assert.equal(resolveChainIconId({ name: "ｼﾞｭﾝｸ堂書店池袋本店" }), "junku");
  assert.equal(resolveChainIconId({ name: "  くまざわ書店  " }), "kumazawa");
  assert.equal(resolveChainIconId({ name: "未来屋　書店" }), "miraiya");
});

test("「紀伊國屋」「紀伊国屋」の両表記が同一チェーンへ解決される", () => {
  // NFKC は 國 → 国 を行わないため、matchKeys への明示列挙が効いていること
  assert.notEqual("紀伊國屋書店".normalize("NFKC"), "紀伊国屋書店");
  assert.equal(resolveChainIconId({ name: "紀伊國屋書店新宿本店" }), "kinokuniya");
  assert.equal(resolveChainIconId({ name: "紀伊国屋書店武蔵小杉店" }), "kinokuniya");
});

test("「丸善ジュンク堂書店」は評価順によりjunkuへ解決される", () => {
  assert.equal(resolveChainIconId({ name: "丸善ジュンク堂書店梅田店" }), "junku");

  const ids = CHAIN_TABLE.map((entry) => entry.id);
  assert.ok(ids.indexOf("junku") < ids.indexOf("maruzen"), "ジュンク堂は丸善より前");
});

test("brandが無くnameのみでも判定される / brandはnameより優先される", () => {
  assert.equal(resolveChainIconId({ name: "くまざわ書店ペリエ千葉本店" }), "kumazawa");
  // brand は支店名を含むことがあるが、部分一致のため支障しない
  assert.equal(resolveChainIconId({ brand: "宮脇書店 流山店", name: "宮脇書店" }), "miyawaki");
});

test("フィールドをまたいだ偶発的な部分一致が起きない", () => {
  // brand の末尾と name の先頭が連結しても「紀伊國屋書店」にはならないこと
  assert.equal(
    resolveChainIconId({ brand: "紀伊國屋", name: "書店" }),
    GENERIC_BOOK_ICON_ID,
  );
});

test("normalizeChainText: NFKC・法人格除去・空白除去を行う", () => {
  assert.equal(normalizeChainText("株式会社 有隣堂"), "有隣堂");
  assert.equal(normalizeChainText("ｼﾞｭﾝｸ堂"), "ジュンク堂");
  assert.equal(normalizeChainText("宮脇書店　流山店"), "宮脇書店流山店");
  assert.equal(normalizeChainText(undefined), "");
  assert.equal(normalizeChainText(123), "");
});

test("buildIconImageExpression: CHAIN_TABLEと同じ順のcase式になる", () => {
  const built = buildIconImageExpression();

  assert.equal(built[0], "case");
  // [case, (条件, 出力) × 9, フォールバック]
  assert.equal(built.length, CHAIN_TABLE.length * 2 + 2);
  assert.equal(built.at(-1), GENERIC_BOOK_ICON_ID);

  for (const [index, entry] of CHAIN_TABLE.entries()) {
    assert.equal(built[index * 2 + 2], entry.iconId);
  }
});

test("buildChainIdExpression: 未一致は空文字列を返すcase式になる", () => {
  const built = buildChainIdExpression();

  assert.equal(built[0], "case");
  assert.equal(built.length, CHAIN_TABLE.length * 2 + 2);
  assert.equal(built.at(-1), "");

  for (const [index, entry] of CHAIN_TABLE.entries()) {
    assert.equal(built[index * 2 + 2], entry.id);
  }
});

test("アイコン式とチェーンID式は同一の一致条件を共有する", () => {
  const iconExpression = buildIconImageExpression();
  const chainIdExpression = buildChainIdExpression();

  for (let index = 0; index < CHAIN_TABLE.length; index += 1) {
    const position = index * 2 + 1;
    assert.deepEqual(
      iconExpression[position],
      chainIdExpression[position],
      `${CHAIN_TABLE[index].id} の条件が一致しない`,
    );
  }
});

test("一致条件はエントリのmatchKeysすべてを網羅する", () => {
  const built = buildIconImageExpression();

  for (const [index, entry] of CHAIN_TABLE.entries()) {
    const condition = built[index * 2 + 1];

    assert.equal(condition[0], "any");
    assert.deepEqual(
      condition.slice(1).map(([operator, key]) => {
        assert.equal(operator, "in");
        return key;
      }),
      entry.matchKeys,
    );
  }
});

test("CHAIN_FILTER_OPTIONS: 「すべて」+ CHAIN_TABLEと同順の9件", () => {
  assert.equal(CHAIN_FILTER_OPTIONS.length, CHAIN_TABLE.length + 1);
  assert.deepEqual(CHAIN_FILTER_OPTIONS[0], { value: "all", label: "すべて" });
  assert.deepEqual(
    CHAIN_FILTER_OPTIONS.slice(1),
    CHAIN_TABLE.map(({ id, label }) => ({ value: id, label })),
  );
});

test("生成した式はMapLibreのパーサで評価でき、resolveChainIconIdと一致する", () => {
  const evaluateIcon = compile(buildIconImageExpression());
  const evaluateChainId = compile(buildChainIdExpression());

  const samples = [
    { name: "紀伊國屋書店新宿本店" },
    { name: "紀伊国屋書店武蔵小杉店" },
    { name: "丸善ジュンク堂書店梅田店" },
    { name: "丸善 丸の内本店" },
    { brand: "宮脇書店 流山店", name: "宮脇書店流山店" },
    { name: "ゲオ文教堂伊東店" },
    { name: "刃物や三省堂" },
    { name: "町の本屋さん" },
    {},
  ];

  for (const properties of samples) {
    const expected = resolveChainIconId(properties);

    assert.equal(evaluateIcon(properties), expected, JSON.stringify(properties));
    assert.equal(
      evaluateChainId(properties),
      expected === GENERIC_BOOK_ICON_ID ? "" : expected,
      JSON.stringify(properties),
    );
  }
});

test("スタイル式はNFKC正規化を行わず、未一致時は汎用アイコンへ安全に倒れる", () => {
  // design.md Decision 7 の既知の非対称性を意図どおりであることとして固定する
  const evaluateIcon = compile(buildIconImageExpression());
  const halfWidth = { name: "ｼﾞｭﾝｸ堂書店池袋本店" };

  assert.equal(resolveChainIconId(halfWidth), "junku");
  assert.equal(evaluateIcon(halfWidth), GENERIC_BOOK_ICON_ID);
});
