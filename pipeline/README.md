# pipeline

Overture Maps Places から日本全国の書店 POI を取得し、ビューアが読み込む `book.pmtiles` を生成するデータパイプライン。

ローカルでの手動実行を前提としている。CI では実行しない(下記の外部ツールを CI へ持ち込まないため)。生成した `book.pmtiles` は `web/public/` へコピーしてリポジトリへコミットする。

## 必要なツール

npm で解決できない外部ツールに依存する。実行前に PATH を通しておくこと。未インストールの場合は各スクリプトが導入方法を案内して終了する。

| ツール | 用途 | 導入 |
| --- | --- | --- |
| Node.js 20 以上 | スクリプトの実行 | |
| DuckDB CLI | Overture Places(S3 上の GeoParquet)へのクエリ | https://duckdb.org/docs/installation/ |
| tippecanoe | GeoJSON → PMTiles(MVT)変換 | https://github.com/felt/tippecanoe |
| pmtiles CLI | 生成した PMTiles のヘッダ検証 | https://github.com/protomaps/PMTiles/releases |

DuckDB の `spatial` / `httpfs` 拡張はクエリ内で `INSTALL` / `LOAD` するため、事前準備は不要(初回のみダウンロードが走る)。

## 実行手順

```bash
npm install

# 1. Overture Places から取得して GeoJSON を書き出す
#    OVERTURE_RELEASE は必須。未指定の場合は失敗して何も書き出さない
OVERTURE_RELEASE=<release> npm run fetch

# 2. GeoJSON を z10-14 の PMTiles へ変換する
npm run build:tiles

# 3. 生成物を検証する
npm run verify:tiles

# 4. 配信対象へ反映する
cp out/book.pmtiles ../web/public/book.pmtiles
```

`<release>` には Overture Maps のリリースバージョン(例: `2026-08-20.0`)を指定する。利用可能なリリースは https://docs.overturemaps.org/release/ を参照。

## 各スクリプトの動作

### `npm run fetch`

`categories.primary = 'bookstore'` かつ日本国内、`confidence >= 0.9` の POI を DuckDB 経由で取得し、GeoJSON FeatureCollection として書き出す。

- 日本国内の判定は、日本を覆う矩形 bbox(経度 122〜154 / 緯度 20〜46)による一次絞り込みと、`addresses` に国コード `JP` を含むことの両方を満たすこと
- `names.primary` → `name`、`brand.names.primary` → `brand`、`addresses[0].freeform` → `address`、`confidence`、`websites` を properties へ写す。値を持たない項目はキーごと省略する
- 座標が不正なレコードはスキップして処理を継続する
- **取得に失敗した場合は GeoJSON を書き出さず、終了コード 1 で終了する**(不完全な成果物を残さない)

### `npm run build:tiles`

tippecanoe で GeoJSON を PMTiles へ変換する。

- レイヤ名は `book`(ビューアの `source-layer` と一致させる必要がある)
- ズーム範囲は z10〜z14
- `--no-feature-limit` / `--no-tile-size-limit` / `--drop-rate=0` により**間引きを全面的に無効化**する。既定の drop-rate では低ズームでチェーン店が虫食いになるため

### `npm run verify:tiles`

生成された PMTiles を検証する。いずれかに失敗すると理由を列挙して終了コード 1 で終了する。

- `pmtiles show --header-json` のヘッダが minzoom=10 / maxzoom=14 であること
- GeoJSON から等間隔にサンプリングした POI が、対応する z14 タイル内に Feature として存在すること
  - MVT では配列プロパティ(`websites` など)が JSON 文字列として格納されるため、パースしてから比較する

## 環境変数

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `OVERTURE_RELEASE` | (なし・`fetch` では必須) | 取得対象の Overture Maps リリースバージョン |
| `BOOK_GEOJSON_PATH` | `out/book.geojson` | GeoJSON の入出力パス |
| `BOOK_PMTILES_PATH` | `out/book.pmtiles` | PMTiles の入出力パス |
| `BOOK_VERIFY_SAMPLE_SIZE` | `5` | `verify:tiles` でサンプリングする POI 数 |

## ディレクトリ構成

| パス | 役割 |
| --- | --- |
| `src/overture-client.js` | DuckDB 経由の Overture Places クエリ。日本国内判定を含む |
| `src/geojson.js` | Overture レコード → GeoJSON Feature 変換 |
| `src/fetch-pois.js` | `npm run fetch` のエントリ |
| `src/build-tiles.js` | `npm run build:tiles` のエントリ。tippecanoe の起動 |
| `src/tile-math.js` | 経緯度 → タイル座標(XYZ)変換 |
| `src/verify-tiles.js` | `npm run verify:tiles` のエントリ。ヘッダとサンプル POI の検証 |
| `src/paths.js` | 入出力パスの解決(環境変数による上書き) |
| `src/*.test.js` | ユニットテスト |
| `out/` | 生成物。Git 管理外 |

## テスト

```bash
npm test   # node --test
```

外部ツール(DuckDB CLI / tippecanoe / pmtiles CLI)とネットワークを必要としない。サブプロセス実行と取得処理は注入可能にしてあり、テストではスタブへ差し替えている。
