/**
 * チェーン判定の単一の真実の源。
 *
 * `CHAIN_TABLE` から、MapLibre の `icon-image` 式・チェーンID式・絞り込み
 * プルダウンの選択肢をすべて導出する。チェーンを増やすときはテーブルに1行
 * 足せば3箇所すべてへ反映される(design.md Decision 7)。
 */

/** どのチェーンにも一致しなかった POI に使う汎用アイコンの ID(画像は book.png)。 */
export const GENERIC_BOOK_ICON_ID = "book";

/** ブランド識別情報として探索するプロパティ。design.md Decision 7 の brand → operator → name。 */
const IDENTITY_KEYS = ["brand", "operator", "name"];

/**
 * 法人格表記。NFKC 後の表記(（株） → (株))で列挙する。
 * 「株式会社有隣堂」を「有隣堂」として判定させるために取り除く。
 */
const CORPORATE_FORMS = /株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|\(有\)|\(資\)|\(名\)/g;

/**
 * 確定テーブル(評価順)。Overture 2026-08-19.0 の実データ3,376件を集計して決定した
 * (design.md Decision 8)。並び順がそのまま評価順になる。
 *
 * ジュンク堂書店を丸善より前に置くことで、「丸善ジュンク堂書店」名義の店舗が
 * ジュンク堂書店として分類される(実データには0件だが将来の出現に備える)。
 */
export const CHAIN_TABLE = [
  {
    id: "kinokuniya",
    iconId: "kinokuniya",
    label: "紀伊國屋書店",
    // NFKC は 國 → 国 を行わないため、新旧両表記を明示列挙する
    matchKeys: ["紀伊國屋書店", "紀伊国屋書店"],
    image: "kinokuniya.png",
  },
  {
    id: "junku",
    iconId: "junku",
    label: "ジュンク堂書店",
    matchKeys: ["ジュンク堂書店"],
    image: "junku.png",
  },
  {
    id: "maruzen",
    iconId: "maruzen",
    label: "丸善",
    // 実データ18件すべてが真陽性だったため、フルネーム優先の例外として単独語を採用する
    matchKeys: ["丸善"],
    image: "maruzen.png",
  },
  {
    id: "kumazawa",
    iconId: "kumazawa",
    label: "くまざわ書店",
    matchKeys: ["くまざわ書店"],
    image: "kumazawa.png",
  },
  {
    id: "miraiya",
    iconId: "miraiya",
    label: "未来屋書店",
    matchKeys: ["未来屋書店"],
    image: "miraiya.png",
  },
  {
    id: "miyawaki",
    iconId: "miyawaki",
    label: "宮脇書店",
    matchKeys: ["宮脇書店"],
    image: "miyawaki.png",
  },
  {
    id: "bunkyo",
    iconId: "bunkyo",
    label: "文教堂",
    matchKeys: ["文教堂"],
    image: "bunkyo.png",
  },
  {
    id: "sansei",
    iconId: "sansei",
    label: "三省堂書店",
    // 「三省堂」単独では刃物店(刃物や三省堂)が誤マッチするためフルネームに限定する
    matchKeys: ["三省堂書店"],
    image: "sansei.png",
  },
  {
    id: "yurin",
    iconId: "yurin",
    label: "有隣堂",
    matchKeys: ["有隣堂"],
    image: "yurin.png",
  },
];

/**
 * 表記ゆれを吸収する。NFKC 正規化(半角カナ・全角英数)、法人格表記の除去、
 * 空白の除去を行う。matchKeys と判定対象の双方に同じ処理を掛ける。
 */
export function normalizeChainText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.normalize("NFKC").replace(CORPORATE_FORMS, "").replace(/\s+/gu, "");
}

/**
 * brand → operator → name を連結した判定対象文字列を作る。
 * 区切りに改行を挟み、フィールドをまたいだ偶発的な部分一致を防ぐ。
 */
function buildSearchText(properties) {
  return IDENTITY_KEYS.map((key) => normalizeChainText(properties?.[key])).join("\n");
}

/** CHAIN_TABLE の並び順で最初に一致したエントリを返す。未一致は undefined。 */
function findChainEntry(properties) {
  const searchText = buildSearchText(properties);

  return CHAIN_TABLE.find((entry) =>
    entry.matchKeys.some((key) => searchText.includes(normalizeChainText(key))),
  );
}

/**
 * POI の properties からアイコン ID を解決する。未一致は汎用アイコンへフォールバックする。
 * MapLibre のスタイル式には NFKC 相当の演算が無いため、こちらだけが正規化を伴う
 * (design.md Decision 7 の既知の非対称性)。
 */
export function resolveChainIconId(properties) {
  return findChainEntry(properties)?.iconId ?? GENERIC_BOOK_ICON_ID;
}

/**
 * MapLibre のスタイル式で判定対象になる文字列。
 * Node 側の `buildSearchText` と同じく brand → operator → name を改行で連結する。
 * スタイル式には NFKC 相当の演算が無いため、こちらは raw 文字列への部分一致になる。
 */
const SEARCH_TEXT_EXPRESSION = [
  "concat",
  ["coalesce", ["get", "brand"], ""],
  "\n",
  ["coalesce", ["get", "operator"], ""],
  "\n",
  ["coalesce", ["get", "name"], ""],
];

/**
 * 1エントリぶんの一致条件。アイコン式とチェーンID式がこの同じ条件を共有するため、
 * 両者の判定結果が食い違うことはない。
 */
function buildMatchCondition(entry) {
  return ["any", ...entry.matchKeys.map((key) => ["in", key, SEARCH_TEXT_EXPRESSION])];
}

/** `icon-image` 用の case 式。未一致は汎用アイコン。 */
export function buildIconImageExpression() {
  const cases = CHAIN_TABLE.flatMap((entry) => [buildMatchCondition(entry), entry.iconId]);

  return ["case", ...cases, GENERIC_BOOK_ICON_ID];
}

/**
 * 一致したチェーンの id を返す case 式。未一致は空文字列。
 * レイヤの filter で「チェーン店か」「特定のチェーンか」を判定するために使う
 * (design.md Decision 9)。
 */
export function buildChainIdExpression() {
  const cases = CHAIN_TABLE.flatMap((entry) => [buildMatchCondition(entry), entry.id]);

  return ["case", ...cases, ""];
}

/** 絞り込みプルダウンの選択肢。先頭は常に「すべて」。 */
export const CHAIN_FILTER_OPTIONS = [
  { value: "all", label: "すべて" },
  ...CHAIN_TABLE.map(({ id, label }) => ({ value: id, label })),
];
