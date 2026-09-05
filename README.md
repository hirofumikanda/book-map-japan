# book-map-japan

[Overture Maps](https://overturemaps.org/) の Places データを出典とする、日本全国の書店マップ。

チェーン店をチェーン別のアイコンで表示し、広域ズームではチェーン店を優先して描画する。

## アーキテクチャ

```mermaid
flowchart LR
    A["Overture Maps Places<br/>(S3 GeoParquet)"] -->|DuckDB CLI| B["pipeline<br/>fetch"]
    B --> C["out/book.geojson"]
    C -->|tippecanoe| D["out/book.pmtiles"]
    D -->|手動コピー| E["web/public/book.pmtiles"]
    E --> F["web<br/>Vite build"]
    F --> G["web/dist"]
    G -->|GitHub Actions| H["GitHub Pages"]
```

データ取得からタイル生成まで(`pipeline`)はローカルで手動実行し、生成した `book.pmtiles` をリポジトリへコミットする。CI は `web` のビルドと公開のみを行い、パイプラインは実行しない(DuckDB CLI・tippecanoe を CI へ持ち込まないため)。

## ディレクトリ構成

| パス | 役割 |
| --- | --- |
| `pipeline/` | Overture Places から書店 POI を取得し、GeoJSON を経て PMTiles を生成・検証する Node.js スクリプト群 |
| `pipeline/out/` | パイプラインの生成物(`book.geojson` / `book.pmtiles`)。Git 管理外 |
| `web/` | MapLibre GL JS + PMTiles のビューア。Vite でビルドする |
| `web/index.html` | Vite のエントリ |
| `web/src/` | `main.js`(地図本体)、`chains.js`(チェーン照合テーブル) |
| `web/public/` | Vite の public ディレクトリ。`img/*.png`(アイコン)と `book.pmtiles` が `dist/` 直下へそのままコピーされる |
| `web/dist/` | ビルド生成物。Git 管理外 |
| `.github/workflows/` | GitHub Pages へのデプロイワークフロー |
| `openspec/` | OpenSpec の仕様・変更提案 |

## 前提ツール

`web` のビルドだけであれば Node.js のみで足りる。`pipeline` の実行には npm で解決できない外部ツールが必要になる。

| ツール | 用途 | 備考 |
| --- | --- | --- |
| Node.js 20 以上 | `pipeline` / `web` の実行 | |
| [DuckDB CLI](https://duckdb.org/docs/installation/) | Overture Places(S3 上の GeoParquet)へのクエリ | `spatial`・`httpfs` 拡張を使用。初回実行時に自動で `INSTALL` される |
| [tippecanoe](https://github.com/felt/tippecanoe) | GeoJSON → PMTiles(MVT)変換 | |
| [pmtiles CLI](https://github.com/protomaps/PMTiles/tree/main/go) | 生成した PMTiles の検証 | `verify:tiles` で使用 |

## セットアップと実行手順

### 1. データパイプライン(ローカル手動実行)

```bash
cd pipeline
npm install

# Overture のリリースバージョンは必須。未指定の場合は失敗する
OVERTURE_RELEASE=<release> npm run fetch   # → out/book.geojson
npm run build:tiles                        # → out/book.pmtiles (z10-14)
npm run verify:tiles                       # ズーム範囲とサンプル POI を検証

# 配信対象へ反映してコミットする
cp out/book.pmtiles ../web/public/book.pmtiles
```

対象は Overture Places の `categories.primary = 'bookstore'` かつ日本国内(bbox + `addresses` の国コード `JP`)、`confidence >= 0.9` のレコード。

### 2. ビューア

```bash
cd web
npm install

npm run dev       # 開発サーバー(HMR)
npm run build     # → dist/
npm run preview   # dist/ を本番同等の構成で配信
```

`book.pmtiles` はブラウザが HTTP Range で部分取得する。配信元が Range に対応していることが動作の前提となるため、必要に応じて確認する。

```bash
curl -i -r 0-99 http://localhost:4173/book.pmtiles   # 206 Partial Content を期待
```

### 環境変数

| 変数 | 対象 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `OVERTURE_RELEASE` | `pipeline` | (なし・必須) | 取得対象の Overture Maps リリースバージョン |
| `BOOK_GEOJSON_PATH` | `pipeline` | `out/book.geojson` | GeoJSON の入出力パス |
| `BOOK_PMTILES_PATH` | `pipeline` | `out/book.pmtiles` | PMTiles の入出力パス |
| `BOOK_VERIFY_SAMPLE_SIZE` | `pipeline` | `5` | 検証時にサンプリングする POI 数 |

## チェーン店アイコン

`brand` / `operator` / `name` を照合テーブルと部分一致で突き合わせ、以下のアイコンを割り当てる。いずれにも該当しない POI は `book.png` で表示する。

| 書店 | アイコン |
| --- | --- |
| くまざわ書店 | `kumazawa.png` |
| 未来屋書店 | `miraiya.png` |
| 宮脇書店 | `miyawaki.png` |
| 紀伊國屋書店 | `kinokuniya.png` |
| 丸善 | `maruzen.png` |
| ジュンク堂書店 | `junku.png` |
| 文教堂 | `bunkyo.png` |
| 三省堂書店 | `sansei.png` |
| 有隣堂 | `yurin.png` |
| その他 | `book.png` |

チェーン店は z10 から、それ以外は z14 以上でのみ表示する。左上のプルダウンで特定チェーンだけに絞り込める。

## テスト

```bash
cd pipeline && npm test   # node --test
cd web && npm test        # node --test
```

## デプロイ

`main` への push、または GitHub Actions 上での手動実行(`workflow_dispatch`)で `.github/workflows/deploy-pages.yml` が起動し、`web` をビルドして `web/dist/` を GitHub Pages へ公開する。

初回のみ、リポジトリの **Settings > Pages > Source** を **GitHub Actions** に設定する必要がある。

ワークフローはパイプラインを実行しないため、データを更新した場合は `web/public/book.pmtiles` を差し替えてコミットする。

## OpenSpec 開発フロー

仕様と変更提案は [OpenSpec](https://github.com/Fission-AI/OpenSpec) で管理する。

| コマンド | 用途 |
| --- | --- |
| `/opsx:propose` | 変更を新規作成し、proposal / specs / design / tasks を生成する |
| `/opsx:update` | 既存の変更の計画アーティファクトを改訂する |
| `/opsx:apply` | `tasks.md` に従って実装する |
| `/opsx:archive` | 実装完了後に変更をアーカイブし、`openspec/specs/` へ反映する |

```bash
openspec list                              # 進行中の変更一覧
openspec status --change <name> --json     # アーティファクトの進捗
openspec validate <name> --strict          # 変更の検証
```

実装タスクは GitHub Issue としても登録されている(`tasks.md` の各見出し末尾が対応 Issue 番号)。

## 実装状況

現在 `openspec/changes/book-map-japan` の計画に沿って構築中で、`pipeline/` と `web/` のコードは未実装。進捗は [Issues](https://github.com/hirofumikanda/book-map-japan/issues) を参照。

## 出典

- POI データ: [Overture Maps Foundation](https://overturemaps.org/) — [ODbL](https://opendatacommons.org/licenses/odbl/)
- 背景地図: [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
