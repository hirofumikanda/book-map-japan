> 各タスクグループは [hirofumikanda/book-map-japan](https://github.com/hirofumikanda/book-map-japan/issues) のIssueへ登録済み。見出し末尾の `#N` が対応Issue。

## 1. リポジトリ基盤 — #1

- [x] 1.1 `.gitignore`を作成する(`node_modules/`・`*.log`・`.DS_Store`・`pipeline/out/`・`web/dist/`・`*.pmtiles`と`!web/public/book.pmtiles`の除外解除)
- [x] 1.2 ルート`README.md`を作成する(アーキテクチャ図、ディレクトリ構成表、セットアップ・実行手順、テスト、デプロイ、OpenSpec開発フロー)
- [x] 1.3 gitリポジトリを初期化し、初回コミットを作成する(`web/public/img/*.png`を含む) — 初回コミット `1cb2163` で充足済み

## 2. パイプライン: 骨組みとOvertureクエリ — #2

- [x] 2.1 `pipeline/package.json`を作成する(ESM、`fetch`・`build:tiles`・`verify:tiles`・`test`スクリプト、devDependencies: `pmtiles`・`@mapbox/vector-tile`・`pbf`)
- [x] 2.2 `pipeline/src/overture-client.js`を実装する: `JAPAN_BBOX`(経度122〜154/緯度20〜46)・`BOOKSTORE_CATEGORIES = ["bookstore"]`・`MIN_CONFIDENCE = 0.9`の定数と、`buildQuery({release, bbox, categories, minConfidence})`(design.md Decision 1・3)
- [x] 2.3 `buildQuery`で`names`・`categories`・`brand`・`addresses`・`websites`を`to_json()`、`geometry`を`ST_AsGeoJSON()`でSELECTし、`INSTALL/LOAD spatial`・`httpfs`・`SET s3_region='us-west-2'`を含めることを確認する
- [x] 2.4 DuckDB CLIをサブプロセス実行する`execDuckDb`と、`queryOverturePlaces()`を実装する。`release`未指定は例外、`ENOENT`は導入案内付きエラー、`addresses`に`country: "JP"`を含むレコードのみ残す(design.md Decision 2)
- [x] 2.5 `pipeline/src/overture-client.test.js`を書く: releaseなしで例外、SQLにカテゴリ`bookstore`・bbox・confidenceしきい値が含まれる、`execImpl`注入で`JP`以外の住所が除外される、`geometry`文字列がオブジェクトへ復元される

## 3. パイプライン: GeoJSON変換と取得スクリプト — #3

- [x] 3.1 `pipeline/src/geojson.js`の`elementsToFeatures(records)`を実装する: Point座標の検証、`names.primary`→`name`、`brand.names.primary`→`brand`、`addresses[0].freeform`→`address`、`confidence`(数値)、`websites`(配列がある場合のみ)をpropertiesへ写す
- [x] 3.2 `pipeline/src/geojson.test.js`を書く: 各propertyの保持、`websites`・`address`を持たないレコードでキーが省略される、座標が不正なレコードがスキップされる
- [x] 3.3 `pipeline/src/fetch-pois.js`を実装する: `OVERTURE_RELEASE`を読み、取得が全件成功した場合のみ`out/book.geojson`へFeatureCollectionを書き出す。失敗時は`process.exitCode = 1`で終了し出力しない

## 4. パイプライン: PMTiles生成と検証 — #4

- [x] 4.1 `pipeline/src/build-tiles.js`を実装する: tippecanoeを`--output`・`--force`・`--layer=book`・`--minimum-zoom=10`・`--maximum-zoom=14`・`--no-feature-limit`・`--no-tile-size-limit`・`--drop-rate=0`で起動する。入出力は`BOOK_GEOJSON_PATH`・`BOOK_PMTILES_PATH`で上書き可能にし、`ENOENT`は導入案内付きエラーにする(design.md Decision 5・6)
- [x] 4.2 `pipeline/src/tile-math.js`の`lonLatToTile(lon, lat, zoom)`と`tile-math.test.js`(既知の座標→タイル番号)を実装する
- [x] 4.3 `pipeline/src/verify-tiles.js`を実装する: `pmtiles show --header-json`でminzoom=10/maxzoom=14を検証し、GeoJSONから等間隔サンプリングしたPOIが対応するz14タイル内にFeatureとして存在することを検証する(`BOOK_VERIFY_SAMPLE_SIZE`、既定5)。配列プロパティはタイル側のJSON文字列をパースして比較する
- [x] 4.4 `pipeline/README.md`を書く: 必要ツール(DuckDB CLI・tippecanoe・pmtiles)、`OVERTURE_RELEASE`の説明、3コマンドの実行手順、環境変数、ディレクトリ構成

## 5. パイプラインの実行とデータ確定 — #5

- [x] 5.1 `OVERTURE_RELEASE=<最新リリース> npm run fetch`を実行し、`out/book.geojson`の件数を確認する
- [x] 5.2 `out/book.geojson`の`brand`充足率と`name`の表記分布を集計し、9チェーンそれぞれの実際の表記を洗い出す(design.md Open Questions)
- [x] 5.3 集計結果をもとに`CHAIN_TABLE`のmatchKeysを確定する。特に「紀伊國屋/紀伊国屋」の両表記、「丸善ジュンク堂書店」の評価順、「丸善」「三省堂」の誤マッチ有無を確認する(design.md Decision 8)
- [x] 5.4 `npm run build:tiles`と`npm run verify:tiles`を実行し、検証をパスさせる
- [x] 5.5 `cp pipeline/out/book.pmtiles web/public/book.pmtiles`で配置し、ファイルサイズを確認したうえでコミットする

## 6. ビューア: 骨組みとチェーン照合テーブル — #6(6.1〜6.2)/ #7(6.3〜6.5)

- [x] 6.1 `web/package.json`を作成する(ESM、`dev`(`vite`)・`build`(`vite build`)・`preview`(`vite preview`)・`test`(`node --test`)スクリプト、dependencies: `maplibre-gl@^6`・`pmtiles@^4`、devDependencies: `vite@^8`)
- [x] 6.2 `web/vite.config.js`を作成する: root=`web`、publicDir=`public`、`base: './'`、`build.outDir: 'dist'`(design.md Decision 11)
- [ ] 6.3 `web/src/chains.js`を実装する: `GENERIC_BOOK_ICON_ID`、5.3で確定した`CHAIN_TABLE`(9チェーン。評価順はジュンク堂→丸善)、`normalizeChainText`(NFKC + 法人格表記除去)、`resolveChainIconId`(design.md Decision 7・8)
- [ ] 6.4 `chains.js`に`buildIconImageExpression()`・`buildChainIdExpression()`・`CHAIN_FILTER_OPTIONS`を追加する。3者が同じmatchKeys部分一致条件・同じ評価順を共有する形にする
- [ ] 6.5 `web/src/chains.test.js`を書く: 9チェーンそれぞれが専用アイコンIDへ解決される、未一致が汎用IDへフォールバックする、法人格表記(株式会社有隣堂)・全角半角ゆれ・「紀伊国屋」旧字体差が吸収される、「丸善ジュンク堂書店」が`junku`になる、`name`のみでも判定される、生成される式の形が期待どおり

## 7. ビューア: 地図本体 — #8

- [ ] 7.1 `web/index.html`(Viteのroot直下)を作成する: `lang="ja"`、タイトル、`#map`の全画面スタイル、チェーン絞り込み`<select>`のスタイル(`.chain-filter-ctrl`)、`.visually-hidden`、`<script type="module" src="/src/main.js">`。import mapとCSSの`<link>`は置かない(design.md Decision 11)
- [ ] 7.2 `web/src/main.js`冒頭で`import "maplibre-gl/dist/maplibre-gl.css"`し、PMTiles Protocolを`addProtocol`に登録し、OSMラスタ(`raster-opacity: 0.5`)+ `pmtiles://.../book.pmtiles`のvector sourceを持つstyleを組み立て、`glyphs`にdemotilesを指定する。PMTiles URLは`window.location.href`基準で解決する(spec: 背景地図の表示 / サブパス配信への対応)
- [ ] 7.3 地図を`center: [139.7528, 35.6852]`・`zoom: 10`・`hash: true`で初期化し、OSM/Overture Maps両方のattributionを設定する(spec: 地図の初期表示位置 / 地図状態のURLハッシュ同期 / 出典への帰属表示)
- [ ] 7.4 `CONFIDENCE_FILTER`(`step`式: z10-14=0.99 / z15=0.97 / z16=0.95 / z17+=0.90。チェーン店以外にのみ適用)と`buildBookFilter(selectedValue)`を実装する。「すべて」は`["any", ["!=", chainIdExpr, ""], ["all", [">=", ["zoom"], 14], CONFIDENCE_FILTER]]`、特定チェーン選択は`["==", chainIdExpr, "<id>"]`(design.md Decision 4・9)
- [ ] 7.5 アイコン登録処理を実装する: `ICON_IMAGE_DEFS`(汎用`book.png` + 9チェーン)、`iconImageUrl()`(`window.location.href`基準)、`loadAndAddBookIcon()`、`styleimagemissing`ハンドラ(design.md Decision 10)
- [ ] 7.6 `map.on("load")`で全アイコンを`Promise.all`でロードしてから`book`シンボルレイヤを追加する: `minzoom: 10`、`maxzoom`未設定(オーバーズーム)、`filter: buildBookFilter("all")`、`icon-image`は`buildIconImageExpression()`、`icon-allow-overlap: true`、`icon-size: 0.5`
- [ ] 7.7 ラベルのlayoutを設定する: `text-field`は`step`式でz15未満は空文字列・z15以上は`name`→`brand`→`operator`のcoalesce、`text-font: ["Noto Sans Regular"]`、`text-size: 12`、`text-variable-anchor: ["left","top"]`、`text-radial-offset: 0.6`、`text-optional: true`(spec: POIラベルの配置)

## 8. ビューア: コントロールとポップアップ — #9

- [ ] 8.1 `NavigationControl`を`top-right`に追加する(spec: ナビゲーションコントロールの表示)
- [ ] 8.2 `GeolocateControl`(`enableHighAccuracy`・`trackUserLocation`・`showUserLocation`)を`bottom-right`にattributionより後で追加し、`error`はwarnに留める(spec: 現在地表示コントロールの表示)
- [ ] 8.3 `ChainFilterControl`(`IControl`)を実装して`top-left`に追加する: `CHAIN_FILTER_OPTIONS`から`<option>`を生成、初期値`all`、`visually-hidden`ラベルを`for`で紐付け、`mousedown`/`dblclick`/`wheel`/`touchstart`の伝播を止める(design.md Decision 9、spec: チェーン店の絞り込みプルダウンメニュー)
- [ ] 8.4 `applyChainFilter(value)`を実装し、`change`で`map.setFilter(BOOK_LAYER_ID, buildBookFilter(value))`だけを呼ぶ形にする
- [ ] 8.5 ポップアップを実装する: レイヤ限定の`click`、`escapeHtml`、名称フォールバック(`name`→`brand`→`operator`→既定文言)、`brand`が名称と異なる場合のみ表示、`address`、`confidence`は生値、`websites`は文字列/配列をパースし`http`/`https`のみリンク化(spec: POIクリック時のポップアップ表示)
- [ ] 8.6 `mouseenter`/`mouseleave`でカーソルを`pointer`に切り替える

## 9. 開発サーバーとドキュメント — #10

- [ ] 9.1 `npm run dev`と`npm run build && npm run preview`の両方で`book.pmtiles`とアイコンが解決され、POIが表示されることを確認する
- [ ] 9.2 `curl -i -r 0-99 <preview origin>/book.pmtiles`が`206 Partial Content`と正しい`Content-Range`を返すことを実測する。返さない場合のみ、`configurePreviewServer`/`configureServer`でRangeを処理するVite pluginを`vite.config.js`へ追加する(design.md Decision 12、spec: PMTilesの静的配信)
- [ ] 9.3 `web/README.md`を書く: 依存ライブラリとNode要件(`vite@^8`が要求する`^20.19.0 || >=22.12.0`)、Viteの構成(root/publicDir/`base: './'`/`dist`)、`dev`・`build`・`preview`・`test`の使い分け、Range検証の`curl`例、ディレクトリ構成、GitHub Pagesサブパス配信への対応

## 10. デプロイ — #11

- [ ] 10.1 `.github/workflows/deploy-pages.yml`を作成する: `push: [main]`と`workflow_dispatch`、`pages: write`/`id-token: write`権限、`concurrency: pages`、buildジョブ(`actions/setup-node`でNode 22・`npm ci`・`npm run build`・`configure-pages`・`upload-pages-artifact` with `path: web/dist`)、`needs: build`のdeployジョブ(`deploy-pages`)(design.md Decision 13、spec: site-deployment)
- [ ] 10.2 GitHubリモートへpushし、Settings > Pages > Source を **GitHub Actions** に設定する(手動作業)
- [ ] 10.3 ワークフローの実行結果を確認し、公開URLでマップが表示されることを確認する

## 11. 検証 — #12

- [ ] 11.1 `cd pipeline && npm test`、`cd web && npm test`が全件パスすることを確認する
- [ ] 11.2 ローカル(`npm run build && npm run preview`)でz10/z13/z14/z15/z16の表示を確認する: z14未満でチェーン店のみ(`confidence`が0.99未満のチェーン店もz10で表示される)、z14以上で非チェーンも表示、z15以上でラベルが出る(spec: 書店POIのシンボルレイヤ表示 / ズームレベルに応じたconfidenceフィルタ / POIラベルの配置)
- [ ] 11.3 9チェーンそれぞれのPOIが指定アイコンで、未一致POIが`book.png`で描画されることを確認する(spec: チェーン店のアイコンによる視覚的識別)
- [ ] 11.4 プルダウンで各チェーンを選択し、当該チェーンのみが表示されること・z14未満でも`confidence`によらず表示されること・「すべて」に戻ると元の条件に戻ることを確認する(spec: チェーン店の絞り込みプルダウンメニュー)
- [ ] 11.5 POIをクリックして店名・ブランド・住所・信頼度(生値)・websitesリンクがポップアップに出ることを確認する
- [ ] 11.6 `npm run preview`のオリジンに対し`curl -i -r 0-99 <preview origin>/book.pmtiles`が`206 Partial Content`を返すことを確認する
- [ ] 11.7 ハッシュ付きURLで開いた場合に指定位置で初期化され、パン/ズームでハッシュが更新されることを確認する
