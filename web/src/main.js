// maplibre-gl v6 は default export を持たないため名前付きで読み込む
import {
  addProtocol,
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// maplibre-gl v6 はワーカーの URL を `new URL(`./${変数}`, import.meta.url)` で
// 実行時に組み立てるため、バンドラが静的に検出できずワーカーが出力されない。
// Vite の ?worker&url でワーカーを（依存する maplibre-gl-shared ごと）バンドルさせ、
// その URL を setWorkerUrl() で明示的に渡す。
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";

import {
  buildChainIdExpression,
  buildIconImageExpression,
  CHAIN_FILTER_OPTIONS,
  CHAIN_TABLE,
  GENERIC_BOOK_ICON_ID,
} from "./chains.js";

const BOOK_SOURCE_ID = "book";
const BOOK_SOURCE_LAYER = "book";
const BOOK_LAYER_ID = "book";

/** チェーン絞り込みプルダウンの「すべて」を表す値。 */
const ALL_CHAINS_VALUE = "all";

/** プルダウンと visually-hidden ラベルを紐付けるための id。 */
const CHAIN_FILTER_SELECT_ID = "chain-filter-select";

/** 店名・ブランド・事業者名のいずれも持たない POI のポップアップ見出し。 */
const POPUP_FALLBACK_NAME = "(名称不明)";

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

/** 現在プルダウンで選択されているチェーン。レイヤ追加時の初期 filter にも使う。 */
let selectedChainValue = ALL_CHAINS_VALUE;

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

/** POI のプロパティを HTML へ埋め込む前にエスケープする。 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * websites を URL の配列へ正規化する。ベクタタイルのプロパティは配列を保持できず
 * JSON 文字列になることがあるため、文字列・JSON 文字列・配列のいずれも受ける。
 */
function parseWebsites(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw !== "string" || raw.trim() === "") {
    return [];
  }

  const trimmed = raw.trim();

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // JSON でなければ単一の URL とみなす
    return [trimmed];
  }
}

/** http / https のみをリンク化の対象にする(spec: POIクリック時のポップアップ表示)。 */
function isHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** ポップアップの HTML を組み立てる。値はすべてエスケープする。 */
export function buildPopupHtml(properties) {
  const name = properties.name || properties.brand || properties.operator || POPUP_FALLBACK_NAME;

  const rows = [];
  // ブランドが見出しと同じ文字列なら重複表示しない
  if (properties.brand && properties.brand !== name) {
    rows.push(["ブランド", properties.brand]);
  }
  if (properties.address) {
    rows.push(["住所", properties.address]);
  }
  if (properties.confidence !== undefined && properties.confidence !== null) {
    // 丸めや変換をせず元の数値をそのまま出す
    rows.push(["信頼度", properties.confidence]);
  }

  const parts = [`<h2 class="book-popup-title">${escapeHtml(name)}</h2>`];

  if (rows.length > 0) {
    const items = rows
      .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
      .join("");
    parts.push(`<dl class="book-popup-props">${items}</dl>`);
  }

  const links = parseWebsites(properties.websites).filter(isHttpUrl);
  if (links.length > 0) {
    const items = links
      .map((url) => {
        const escaped = escapeHtml(url);
        return `<li><a href="${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a></li>`;
      })
      .join("");
    parts.push(`<ul class="book-popup-links">${items}</ul>`);
  }

  return `<div class="book-popup">${parts.join("")}</div>`;
}

/**
 * 左上のチェーン絞り込みプルダウン(spec: チェーン店の絞り込みプルダウンメニュー)。
 * CHAIN_FILTER_OPTIONS から選択肢を生成するため、チェーンの増減に自動で追随する。
 */
class ChainFilterControl {
  #container = null;

  onAdd() {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl chain-filter-ctrl";

    const label = document.createElement("label");
    label.className = "visually-hidden";
    label.htmlFor = CHAIN_FILTER_SELECT_ID;
    label.textContent = "チェーンで絞り込む";

    const select = document.createElement("select");
    select.id = CHAIN_FILTER_SELECT_ID;

    for (const option of CHAIN_FILTER_OPTIONS) {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      select.append(optionElement);
    }

    select.value = ALL_CHAINS_VALUE;
    select.addEventListener("change", () => applyChainFilter(select.value));

    // プルダウンの操作で地図がパン・ズームしないよう、地図へのイベント伝播を止める
    for (const type of ["mousedown", "dblclick", "wheel", "touchstart"]) {
      container.addEventListener(type, (event) => event.stopPropagation());
    }

    container.append(label, select);
    this.#container = container;

    return container;
  }

  onRemove() {
    this.#container?.remove();
    this.#container = null;
  }
}

// 地図の生成より前にワーカー URL を確定させる
setWorkerUrl(maplibreWorkerUrl);

addProtocol("pmtiles", new Protocol().tile);

const map = new MapLibreMap({
  container: "map",
  style: buildStyle(),
  // ハッシュ無しで開かれた場合の初期表示は皇居周辺・z10
  center: [139.7528, 35.6852],
  zoom: 10,
  hash: true,
});

/**
 * プルダウンの選択をレイヤへ反映する(tasks 8.4)。
 * ソース・レイヤ・アイコンは不変で、filter を張り替えるだけ(design.md Decision 9)。
 */
function applyChainFilter(value) {
  selectedChainValue = value;

  // スタイル読み込み中はレイヤがまだ無い。選択値は保持し、addLayer 時に反映される
  if (map.getLayer(BOOK_LAYER_ID)) {
    map.setFilter(BOOK_LAYER_ID, buildBookFilter(value));
  }
}

map.addControl(new NavigationControl(), "top-right");

const geolocateControl = new GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
  showUserLocation: true,
});

// 位置情報を取得できなくても地図・他コントロール・POI表示は動き続ける。警告に留める
geolocateControl.on("error", (event) => {
  console.warn("現在地を取得できませんでした", event);
});

// attribution より後に追加することで、bottom 系コーナーでは attribution の上に載る
map.addControl(geolocateControl, "bottom-right");

map.addControl(new ChainFilterControl(), "top-left");

map.on("click", BOOK_LAYER_ID, (event) => {
  const feature = event.features?.[0];
  if (!feature) {
    return;
  }

  new Popup({ closeButton: true })
    .setLngLat(feature.geometry.coordinates.slice())
    .setHTML(buildPopupHtml(feature.properties ?? {}))
    .addTo(map);
});

map.on("mouseenter", BOOK_LAYER_ID, () => {
  map.getCanvas().style.cursor = "pointer";
});

map.on("mouseleave", BOOK_LAYER_ID, () => {
  map.getCanvas().style.cursor = "";
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
    filter: buildBookFilter(selectedChainValue),
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
