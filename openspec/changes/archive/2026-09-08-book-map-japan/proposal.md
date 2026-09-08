## Why

日本全国の書店POIを地図上で探せる公開Webマップが存在しない。既存の[cafe-map-japan](https://github.com/hirofumikanda/cafe-map-japan)がOverture Maps Placesを出典とするPOIマップとして実績のある構成(パイプライン + 静的フロントエンド + GitHub Pages)を確立しているため、同じアーキテクチャを書店ドメインへ適用することで、低コストかつ短期間で同等品質のマップを立ち上げられる。

本リポジトリには現時点で`web/public/img/`配下のチェーン別アイコン画像しか存在せず、パイプライン・ビューア・デプロイのいずれも未実装である。

## What Changes

- **データパイプライン(`pipeline/`)を新規追加**: Overture Maps Places(theme=places, type=place)から`categories.primary = 'bookstore'`かつ日本国内・`confidence >= 0.9`のPOIをDuckDB経由で取得し、GeoJSONを経てtippecanoeで`book.pmtiles`(MVT, z10-14, source-layer: `book`)へ変換する。生成物のメタデータとサンプルPOIを検証する`verify:tiles`も含む。
- **Webフロントエンド(`web/`)を新規追加**: MapLibre GL JS v6 + PMTiles Protocolで、透過50%のOpenStreetMap Standard背景地図上に書店POIをシンボルレイヤとして表示する。ビルドツールにはViteを使い、`web/public/`(アイコン画像・PMTiles)を含む静的資産一式を`web/dist/`へ出力する。
- **チェーン店の優先表示**: `brand`/`operator`/`name`を既知チェーン照合テーブルと部分一致で突き合わせ、チェーン店はz10以上でconfidenceしきい値によらず全件、チェーン店以外はz14以上かつしきい値を満たすもののみ表示する。加えて左上のプルダウンでチェーンを絞り込める。
- **チェーン別アイコン**: 既知9チェーン(くまざわ書店・未来屋書店・宮脇書店・紀伊國屋書店・丸善・ジュンク堂書店・文教堂・三省堂書店・有隣堂)に`web/public/img/`配下の専用画像を割り当て、未一致POIは汎用アイコン`book.png`で表示する。
- **ズーム連動のconfidenceフィルタ(チェーン店以外のみ)・ラベル・各種コントロール**: チェーン店以外へ適用するz10-14は0.99以上/z15は0.97以上/z16は0.95以上/z17以上は0.90以上のconfidenceしきい値(チェーン店には適用しない)、z15以上での店名ラベル表示、NavigationControl(右上)・GeolocateControl(右下)・URLハッシュ同期・Overture Maps帰属表示。
- **GitHub Pagesへの自動デプロイを新規追加**: `main`へのpushまたは`workflow_dispatch`で`web`をViteでビルドし、`web/dist/`をGitHub Pagesへ公開するGitHub Actionsワークフロー。パイプラインの実行は含まず、`web/public/book.pmtiles`はコミット済みの前提とする。

## Capabilities

### New Capabilities
- `bookstore-poi-pipeline`: Overture Maps Placesから日本全国の書店POIを取得し、GeoJSONを経てz10-14のPMTilesアーカイブへ変換し、HTTP Range対応で静的配信可能な状態にするデータパイプライン。
- `bookstore-map-viewer`: MapLibre GL JS v6でPMTilesを読み込み、背景地図上に書店POIを表示し、チェーン店の優先表示・チェーン別アイコン・絞り込み・ポップアップ・各種地図コントロールを提供するWebフロントエンド。
- `site-deployment`: GitHub Actionsによる`web`のビルドとGitHub Pagesへの公開の自動化。

### Modified Capabilities
(なし。本リポジトリには既存の`openspec/specs/`が存在しないため、すべて新規capabilityとして追加する)

## Impact

- **新規ディレクトリ**: `pipeline/`(Node.js ESM、`src/overture-client.js`・`geojson.js`・`fetch-pois.js`・`build-tiles.js`・`verify-tiles.js`・`tile-math.js`とそのユニットテスト)、`web/`(`index.html`・`vite.config.js`・`src/main.js`・`src/chains.js`)、`.github/workflows/deploy-pages.yml`。
- **既存資産**: `web/public/img/*.png`(10ファイル)は変更・移動せずそのまま参照する(Viteのpublic dirの規約に合致するため)。
- **外部依存(npm外)**: DuckDB CLI(`spatial`・`httpfs`拡張)、tippecanoe。いずれもパイプライン実行時のみ必要で、デプロイワークフローでは不要。
- **npm依存**: `web`はdependenciesに`maplibre-gl@^6`・`pmtiles@^4`、devDependenciesに`vite@^8`。`pipeline`はdevDependenciesとして`pmtiles`(`web`と同じく`^4`)・`@mapbox/vector-tile`・`pbf`。いずれも各パッケージの最新メジャーに揃える。`vite@^8`はNode `^20.19.0 || >=22.12.0`を要求するため、開発環境とデプロイワークフローのNodeは22系を使う。
- **外部サービス**: Overture Maps(AWS S3 `overturemaps-us-west-2`、`us-west-2`リージョン)、OpenStreetMapタイルサーバー、`demotiles.maplibre.org`のグリフサーバー、GitHub Pages。
- **リポジトリ設定(手動作業)**: 初回のみSettings > Pages > SourceをGitHub Actionsに設定する必要がある。
- **コミット対象のバイナリ**: `web/public/book.pmtiles`はデプロイワークフローがパイプラインを実行しないためリポジトリへコミットする(`.gitignore`で当該ファイルのみ除外解除)。

## 前提・想定

- **カテゴリ範囲**: Overture Placesの`categories.primary`が`bookstore`のレコードのみを対象とする。`used_bookstore`(古書店)・`comic_books_store`・`academic_bookstore`・親カテゴリ`books_music_and_video_store`は対象外(ユーザー確認済み)。
- **機能セット**: cafe-map-japanの現行仕様(confidenceフィルタ、ラベルz15以上、チェーン絞り込みプルダウン、Geolocate、URLハッシュ同期)を書店ドメインへそのまま移植する。cafe固有の値のみ書店向けに読み替える。
- **データ更新フロー**: パイプラインはローカル手動実行し、生成した`book.pmtiles`を`web/public/`へコピーしてコミットする(CIでは実行しない)。
