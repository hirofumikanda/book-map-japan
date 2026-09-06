// maplibre-gl v6 は default export を持たないため名前付きで読み込む
import { addProtocol, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";

import {
  buildChainIdExpression,
  buildIconImageExpression,
  CHAIN_TABLE,
  GENERIC_BOOK_ICON_ID,
} from "./chains.js";

const BOOK_SOURCE_ID = "book";
const BOOK_SOURCE_LAYER = "book";
const BOOK_LAYER_ID = "book";

/** チェーン絞り込みプルダウンの「すべて」を表す値。 */
const ALL_CHAINS_VALUE = "all";

/** PMTiles と画像は publicDir 直下へ出力されるため、ページ URL 基準で解決する。 */
const PMTILES_PATH = "book.pmtiles";
const ICON_IMAGE_DIR = "img";

const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const OVERTURE_ATTRIBUTION =
  '&copy; <a href="https://overturemaps.org/" target="_blank" rel="noopener">Overture Maps Foundation</a>';

/**
 * サブパス配信(`https://<user>.github.io/<repo>/`)でも同じ成果物が動くよう、
 * 静的資産はすべてページの URL を基準に解決する(spec: サブパス配信への対応)。
 */
function resolveAssetUrl(path) {
  return new URL(path, window.location.href).href;
}

/** チェーンアイコン画像の URL。 */
function iconImageUrl(image) {
  return resolveAssetUrl(`${ICON_IMAGE_DIR}/${image}`);
}

/** 登録するアイコン: 汎用の book.png + チェーン別9枚(design.md Decision 10)。 */
const ICON_IMAGE_DEFS = [
  { id: GENERIC_BOOK_ICON_ID, image: "book.png" },
  ...CHAIN_TABLE.map(({ iconId, image }) => ({ id: iconId, image })),
];

/**
 * ズームに応じた confidence しきい値。チェーン店以外にのみ適用する
 * (design.md Decision 4、spec: ズームレベルに応じたconfidenceフィルタ)。
 */
const CONFIDENCE_FILTER = [
  ">=",
  ["get", "confidence"],
  ["step", ["zoom"], 0.99, 15, 0.97, 16, 0.95, 17, 0.9],
];

const CHAIN_ID_EXPRESSION = buildChainIdExpression();

/** チェーン店(既知チェーンのいずれかに一致した POI)かどうか。 */
const IS_CHAIN_STORE = ["!=", CHAIN_ID_EXPRESSION, ""];

/**
 * レイヤの filter 式を組み立てる(design.md Decision 9)。
 *
 * - 「すべて」: チェーン店は minzoom(z10)から confidence によらず全件、
 *   チェーン店以外は z14 以上かつしきい値を満たすもののみ
 * - 特定チェーン: 当該チェーンのみ。チェーン店なのでズーム出し分けも
 *   confidence フィルタも掛からない
 */
export function buildBookFilter(selectedValue) {
  if (selectedValue && selectedValue !== ALL_CHAINS_VALUE) {
    return ["==", CHAIN_ID_EXPRESSION, selectedValue];
  }

  return ["any", IS_CHAIN_STORE, ["all", [">=", ["zoom"], 14], CONFIDENCE_FILTER]];
}

/** ラベルは z15 以上でのみ表示し、name → brand → operator の順にフォールバックする。 */
const TEXT_FIELD_EXPRESSION = [
  "step",
  ["zoom"],
  "",
  15,
  ["coalesce", ["get", "name"], ["get", "brand"], ["get", "operator"], ""],
];

function buildStyle() {
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: OSM_ATTRIBUTION,
      },
      [BOOK_SOURCE_ID]: {
        type: "vector",
        url: `pmtiles://${resolveAssetUrl(PMTILES_PATH)}`,
        attribution: OVERTURE_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm",
        // POI を前景として際立たせるため背景地図は不透明度50%にする
        paint: { "raster-opacity": 0.5 },
      },
    ],
  };
}

/** アイコンを1枚ロードして登録する。既に登録済みなら何もしない。 */
async function loadAndAddBookIcon(map, def) {
  if (map.hasImage(def.id)) {
    return;
  }

  const { data } = await map.loadImage(iconImageUrl(def.image));

  // 並行ロード中に styleimagemissing 経由で登録された場合の二重登録を避ける
  if (map.hasImage(def.id)) {
    return;
  }

  map.addImage(def.id, data);
}

addProtocol("pmtiles", new Protocol().tile);

const map = new MapLibreMap({
  container: "map",
  style: buildStyle(),
  // ハッシュ無しで開かれた場合の初期表示は皇居周辺・z10
  center: [139.7528, 35.6852],
  zoom: 10,
  hash: true,
});

// スタイル再読み込み等で未登録のアイコンが参照された場合に遅延登録する
map.on("styleimagemissing", (event) => {
  const def = ICON_IMAGE_DEFS.find((candidate) => candidate.id === event.id);
  if (!def) {
    return;
  }

  loadAndAddBookIcon(map, def).catch((error) => {
    console.warn(`アイコンの遅延登録に失敗しました: ${def.image}`, error);
  });
});

map.on("load", async () => {
  // 初回描画でシンボルが欠落しないよう、全アイコンのロード完了後にレイヤを追加する
  await Promise.all(
    ICON_IMAGE_DEFS.map((def) =>
      loadAndAddBookIcon(map, def).catch((error) => {
        // 1枚の失敗で地図全体を止めない。未登録ぶんは styleimagemissing が拾う
        console.warn(`アイコンの読み込みに失敗しました: ${def.image}`, error);
      }),
    ),
  );

  map.addLayer({
    id: BOOK_LAYER_ID,
    type: "symbol",
    source: BOOK_SOURCE_ID,
    "source-layer": BOOK_SOURCE_LAYER,
    minzoom: 10,
    // maxzoom は設定しない。z14 タイルのオーバーズームで拡大時も表示を継続する
    filter: buildBookFilter(ALL_CHAINS_VALUE),
    layout: {
      "icon-image": buildIconImageExpression(),
      "icon-allow-overlap": true,
      "icon-size": 0.5,
      "text-field": TEXT_FIELD_EXPRESSION,
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
      "text-variable-anchor": ["left", "top"],
      "text-radial-offset": 0.6,
      // ラベルを置けない場合でもアイコンは残す
      "text-optional": true,
    },
  });
});
