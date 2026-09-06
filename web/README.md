# web

MapLibre GL JS + PMTiles で書店 POI を表示するビューア。Vite でビルドし、`dist/` を GitHub Pages へ公開する。

表示するタイル `public/book.pmtiles` は [`pipeline`](../pipeline/README.md) がローカルで生成してコミット済みのものを使う。ビューア側でパイプラインを実行することはない。

## 必要な環境

| 要件 | 備考 |
| --- | --- |
| Node.js `^20.19.0 \|\| >=22.12.0` | `vite@8` の `engines` が要求する。リポジトリ全体では 22 系を前提としている |

外部ツールは不要。`npm install` だけで開発・ビルド・テストができる。

## 依存ライブラリ

| パッケージ | 役割 |
| --- | --- |
| `maplibre-gl@^6` | 地図の描画。v6 の ESM ビルドは **default export を持たない**ため `import { Map as MapLibreMap } from "maplibre-gl"` のように名前付きで読み込む |
| `pmtiles@^4` | `pmtiles://` プロトコルの登録。`Protocol#tile(params, abortController)` が MapLibre v4 以降の Promise ベースの `addProtocol` に対応する |
| `vite@^8`(dev) | 開発サーバーとビルド |
| `@maplibre/maplibre-gl-style-spec`(dev) | テストでスタイル式を MapLibre のパーサへ通して検証するために使う |

`maplibre-gl` の CSS は `src/main.js` の冒頭で `import "maplibre-gl/dist/maplibre-gl.css"` しており、Vite がバンドルする。`index.html` に `<link>` を置く必要はない。

## Vite の構成

`vite.config.js` の設定は次のとおり。

| 設定 | 値 | 意味 |
| --- | --- | --- |
| `root` | `.`(= `web/`) | `index.html` を**このディレクトリ直下**に置く。`public/` には置けない(Vite は root の `index.html` を解析して `<script>` をハッシュ付きバンドルへ書き換えるため) |
| `publicDir` | `public` | `img/*.png` と `book.pmtiles` が**加工されずそのまま** `dist/` 直下へコピーされる |
| `base` | `./` | 生成される HTML の資産参照が相対パスになる。オリジン直下でも GitHub Pages のサブパス配下でも同じ成果物が動く |
| `build.outDir` | `dist` | 公開用の静的資産一式の出力先。Git 管理外 |

## コマンド

```bash
npm install
```

| コマンド | 用途 |
| --- | --- |
| `npm run dev` | 開発サーバー。ソース変更の HMR が効く。日常の開発用 |
| `npm run build` | `dist/` へ本番用の静的資産を出力する |
| `npm run preview` | `dist/` をそのまま配信する。**`npm run build` の後**に実行する、本番同等の確認用 |
| `npm test` | `node --test` によるユニットテスト。Vite に依存しない |

初めて動かす場合は次の順で確認するとよい。

```bash
npm install
npm run dev        # http://localhost:5173/ を開く

# 本番同等の確認
npm run build && npm run preview
```

どちらのサーバーでも、皇居周辺・ズームレベル10の地図に書店 POI がチェーン別アイコンで表示される。

## HTTP Range 対応の確認

PMTiles はクライアントがファイルのバイト範囲を指定してタイルを取り出す方式のため、**配信元が HTTP Range に対応していること**が動作の前提になる。Vite の開発サーバー・プレビューサーバーはいずれも対応しているため、追加のプラグインは入れていない。

配信元を変えた場合や POI が表示されない場合は、次のコマンドで配信元の Range 対応を確認する。

```bash
# 206 Partial Content と Content-Range が返ること
curl -i -r 0-99 http://localhost:4173/book.pmtiles

# Range ヘッダ無しでは 200 でファイル全体が返ること
curl -I http://localhost:4173/book.pmtiles
```

期待する応答は次のとおり(`2077648` はファイルサイズなので、タイルを再生成すると変わる)。

```
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-99/2077648
Accept-Ranges: bytes
Content-Length: 100
```

```
HTTP/1.1 200 OK
Content-Length: 2077648
```

Range に応答しない配信元を使う場合は、`vite.config.js` へ `configureServer` / `configurePreviewServer` で Range を処理するプラグインを足す必要がある。本番の GitHub Pages は Range に対応している。

## GitHub Pages のサブパス配信

公開先が `https://<user>.github.io/<repo>/` のようにオリジン直下でないため、資産の参照をすべてページの URL 基準で解決している。

- **バンドル(JS / CSS)**: `base: './'` により `./assets/index-*.js` の相対パスで参照される
- **PMTiles とアイコン**: `src/main.js` が `new URL("book.pmtiles", window.location.href)` / `new URL("img/<file>", window.location.href)` で解決する

リポジトリ名をビルド設定へ埋め込んでいないため、同じ `dist/` がオリジン直下でもサブパス配下でもそのまま動く。

## ディレクトリ構成

| パス | 役割 |
| --- | --- |
| `index.html` | Vite のエントリ。`#map` のスタイル、絞り込みプルダウンのスタイル、`<script type="module" src="/src/main.js">` |
| `src/main.js` | 地図本体。スタイル構築、フィルタ、アイコン登録、コントロール、ポップアップ |
| `src/chains.js` | チェーン照合テーブル。アイコン式・チェーンID式・プルダウンの選択肢をここから導出する |
| `src/chains.test.js` | `chains.js` のユニットテスト |
| `public/img/*.png` | チェーン別アイコン(9チェーン)と汎用アイコン `book.png` |
| `public/book.pmtiles` | 書店 POI のタイル(z10-14、source-layer は `book`)。`pipeline` の生成物 |
| `vite.config.js` | Vite の設定 |
| `dist/` | ビルド生成物。Git 管理外 |

## 表示仕様の要点

- **チェーン店は z10 以上で `confidence` によらず全件**表示し、チェーン店以外は z14 以上かつズーム連動の `confidence` しきい値(z10-14: 0.99 / z15: 0.97 / z16: 0.95 / z17以上: 0.90)を満たすもののみ表示する
- チェーンの追加・変更は `src/chains.js` の `CHAIN_TABLE` に1行足すだけでよい。アイコン・フィルタ・プルダウンの3箇所へ自動で反映される
- ラベルは z15 以上でのみ表示する。グリフは `demotiles.maplibre.org` の Noto Sans Regular を使う

## テスト

```bash
npm test
```

`node --test` で `src/*.test.js` を実行する。テストランナーを追加せず、`chains.js` は素の ESM のままにしてある。ブラウザや Vite を必要としない。
