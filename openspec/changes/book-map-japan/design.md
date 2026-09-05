## Context

本リポジトリには`web/public/img/`配下のチェーン別アイコン画像10点しか存在せず、パイプライン・ビューア・デプロイはすべて新規実装となる(モチベーションは proposal.md - Why を参照)。

実装の下敷きとするのは[cafe-map-japan](https://github.com/hirofumikanda/cafe-map-japan)の現行構成である。同リポジトリは「Overture Maps Places → DuckDB → GeoJSON → tippecanoe → PMTiles」というパイプラインと、「MapLibre GL JS v6 + PMTiles Protocol」というフロントエンド、GitHub Actionsによる Pages デプロイの3層で構成されており、本changeはこの構成をドメイン(カフェ→書店)だけ差し替えて再現する。ただしビルドツールについてはユーザー指定により**Viteを採用**し、cafe側の「バンドラ無し・import map + 自前コピースクリプト」構成からは意図的に外れる(Decision 11・12)。

制約:

- **npm外の外部ツール依存**: Overture PlacesはAWS S3上のGeoParquetで公開されており、クエリにはDuckDB CLI(`spatial`・`httpfs`拡張)が要る。PMTiles生成にはtippecanoeが要る。どちらもnpmで解決できないため、開発者のローカル環境に前提として置く。
- **CIではパイプラインを実行しない**: 上記2ツールをCIへ持ち込まない方針のため、`web/public/book.pmtiles`はリポジトリへコミットする。
- **既存アイコン画像は変更しない**: ファイル名(`kumazawa.png`等)がユーザー指定であり、チェーン照合テーブル側をこの命名に合わせる。
- **このディレクトリはまだgitリポジトリではない**: GitHub Pagesデプロイを機能させるにはgit初期化とGitHubリモートへのpushが前提になる。

## Goals / Non-Goals

**Goals:**

- cafe-map-japanと同一のアーキテクチャ・ディレクトリ構成・命名規則を踏襲し、将来の相互参照とメンテナンスコストを下げる(ビルドツール層を除く)。
- 書店ドメイン固有の差分(カテゴリ、チェーン照合テーブル、アイコン、ソース/レイヤ名)を局所化し、それ以外は逐語的に移植する。
- チェーン判定を「テーブルに1行足すだけ」で拡張できる形に保つ(アイコン式・フィルタ式・プルダウン選択肢がすべて同一テーブルから導出される)。

**Non-Goals:**

- パイプラインのCI実行・データ自動更新(手動フローのまま)。
- 地図上での検索・ルーティング・お気に入り等、cafe-map-japanに無い機能。
- チェーン絞り込みの選択状態の永続化(URL・localStorage等)。
- 古書店・コミック専門店・複合店(TSUTAYA等)の取り込み(カテゴリ`bookstore`のみ。proposal.md - 前提・想定)。

## Decisions

### Decision 1: Overture PlacesのクエリはDuckDB CLIのサブプロセス実行で行う

`spawn("duckdb", ["-json", "-c", query])`でDuckDB CLIを呼び、`read_parquet('s3://overturemaps-us-west-2/release/<release>/theme=places/type=place/*')`に対してbbox・カテゴリ・confidenceの条件を1本のSQLで適用する。`names`・`categories`・`brand`・`addresses`・`websites`はSTRUCT/LIST型で、DuckDB CLIの`-json`出力ではそのままSELECTすると有効なJSONにならないため、`to_json()`で明示的にJSON化する。`geometry`は`ST_AsGeoJSON()`でVARCHAR化し、Node側で`JSON.parse`して復元する。

- **代替案**: Pythonの`overturemaps` CLI / boto3で直接GeoParquetを読む → Node.js単一ランタイムという構成を崩す。DuckDBならS3レンジ読み + 述語プッシュダウンで日本分だけを効率的に取得できる。
- **代替案**: Overpass API(OSM) → cafe-map-japanが既にOverture Placesへ移行済みであり、ユーザー指定もOverture Maps。

`OVERTURE_RELEASE`環境変数は必須とし、未指定なら例外を投げて不完全なGeoJSONを書き出さない。

### Decision 2: 日本国内判定は「bbox一次絞り込み + `addresses.country = 'JP'`」の2段構え

行政境界ポリゴンによる厳密なクリップは行わず、日本を覆う矩形bbox(経度122〜154、緯度20〜46)で一次絞り込みしたうえで、`addresses`配列に国コード`JP`を含むレコードのみを残す。bboxはロシア極東・韓国・台湾の一部を含むため、国コード判定が実質的なフィルタになる。`addresses`を持たないレコードは国が確定できないため対象外とする。

- **代替案**: Overtureのdivisionsテーマとの空間結合 → クエリが重くなり、依存も増える。POIマップとしての精度要求に対して過剰。

### Decision 3: 対象カテゴリは`categories.primary = 'bookstore'`のみ

Overtureの新カテゴリ階層では`shopping > specialty_store > books_music_and_video_store > bookstore`が書店にあたり、その下に`academic_bookstore`・`used_bookstore`・`comic_books_store`がぶら下がる。今回は`bookstore`のみを対象とする(ユーザー確認済み)。カフェ側が`IN ('cafe','coffee_shop')`だったのに対し単一値になるが、SQL側は将来の追加に備えてカテゴリ配列を受け取る形(`categories.primary IN (...)`)を維持する。

- **代替案**: 親カテゴリ`books_music_and_video_store`も含める → CD/DVD専門店が混ざる。
- **代替案**: `used_bookstore`等も含める → 「書店」の語義は広がるが、指定アイコンの9チェーンはいずれも新刊書店であり、汎用アイコンの母数だけが増える。

### Decision 4: `confidence >= 0.9`をパイプライン側の下限、ビューア側ではチェーン店以外にのみズーム連動の追加しきい値

パイプラインは0.9未満を落として配信サイズを抑える。ビューアは**チェーン店以外**に対してのみ、z10-14で0.99、z15で0.97、z16で0.95、z17以上で0.90という`step`式のフィルタを重ねる。広域では確度の高いPOIだけを見せ、拡大するほど網羅性を優先するという段階設計。`setFilter`の呼び直しは不要で、ズーム変化はスタイル式が自動で再評価する。

**チェーン店にはこのしきい値を適用しない**点がcafe-map-japanとの意図的な差異。z10-13ではチェーン店だけが表示対象であり、実データ(3,376件)ではしきい値0.99によってチェーン店467件のうち**223件(47.8%)しか広域に出ない**。「チェーン店を優先表示する」という本変更の狙いに対して取りこぼしが大きすぎるため、チェーン店については確度より網羅性を優先し、`confidence`によらず全件を表示する。品質の担保はチェーン照合テーブル(Decision 8)のmatchKey一致そのものが担う。

### Decision 5: ソース名・レイヤ名・ファイル名は`book`で統一

PMTilesファイルは`book.pmtiles`、tippecanoeの`--layer=book`、MapLibreのsource id / layer id / source-layerもすべて`book`。cafe側の`cafe`と対称になり、パイプラインとビューアの間の暗黙の契約が1語で表現される。環境変数は`BOOK_GEOJSON_PATH`・`BOOK_PMTILES_PATH`・`BOOK_VERIFY_SAMPLE_SIZE`。

### Decision 6: tippecanoeは間引きを全面的に無効化してz10-14を生成

`--minimum-zoom=10 --maximum-zoom=14 --no-feature-limit --no-tile-size-limit --drop-rate=0`。デフォルトの`drop-rate=10`は低ズームで密度ベースの間引きを行うため、z10-13でチェーン店が虫食いになる。書店POIはカフェより件数が1桁少ない見込みで、間引き無効化によるタイルサイズ増は許容範囲と判断する。

### Decision 7: チェーン判定は単一テーブル`web/src/chains.js`から3種の成果物を導出する

`CHAIN_TABLE`の各エントリは`{ id, iconId, label, matchKeys, image }`を持ち、ここから

1. `buildIconImageExpression()` … `icon-image`用の`case`式
2. `buildChainIdExpression()` … 一致したチェーンの`id`(未一致は空文字列)を返す`case`式。フィルタで「チェーン店か」「特定チェーンか」の判定に使う
3. `CHAIN_FILTER_OPTIONS` … 絞り込みプルダウンの選択肢

をすべて導出する。チェーン追加はテーブルに1行足すだけで3箇所に反映される。判定は`brand` → `operator` → `name`を連結した文字列に対する**部分一致**で、評価順は`CHAIN_TABLE`の並び順。

Node側のユニットテスト用に`resolveChainIconId(properties)`(NFKC正規化 + 法人格表記除去つき)も併せて提供する。MapLibreのスタイル式にはNFKC相当の演算が無いため、タイル上ではraw文字列への部分一致になる — この非対称性はcafe-map-japanと同じ既知の割り切りで、未一致時は汎用アイコンへ安全にフォールバックする。

### Decision 8: matchKeysはフルネーム優先、表記ゆれは明示列挙、評価順で包含関係を解く

書店チェーン名にはカフェチェーンに無い固有の落とし穴があるため、次の方針を採る。

- **短い/汎用的なキーを登録しない**: 「宮脇」「丸善」等の単独語は人名・他業種と衝突する。原則「宮脇書店」のようにフルネームで登録する。
- **旧字体・異体字は正規化されない**: NFKCは`國`→`国`を行わない。紀伊國屋書店は`["紀伊國屋書店", "紀伊国屋書店", "紀伊國屋", "紀伊国屋"]`のように両表記を明示列挙する。
- **包含関係のあるチェーンは具体的な方を先に評価する**: 「丸善ジュンク堂書店」は「丸善」を部分文字列として含むため、`CHAIN_TABLE`で**ジュンク堂書店を丸善より前**に置き、「丸善ジュンク堂書店」名義の店舗はジュンク堂書店(`junku.png`)として分類する。丸善は「丸善」単独では誤判定が広いため`["丸善書店", "丸善ジュンク堂"]`ではなく`["丸善"]`を最後尾寄りで評価する形にし、先行するジュンク堂エントリで大型複合店を吸収させる。
- **別業態名も同一チェーンとして扱う**: くまざわ書店の「BOOKSくまざわ」「ブックスくまざわ」等は同じ`kumazawa.png`へ寄せる。

確定テーブル(評価順)。Overture `2026-08-19.0` の実データ3,376件を集計して決定した(tasks 5.2・5.3)。

| 順 | id | label | matchKeys | 実データのヒット数 | image |
|---|---|---|---|---|---|
| 1 | `kinokuniya` | 紀伊國屋書店 | 紀伊國屋書店 / 紀伊国屋書店 | 50(うち新字体1) | `kinokuniya.png` |
| 2 | `junku` | ジュンク堂書店 | ジュンク堂書店 | 41 | `junku.png` |
| 3 | `maruzen` | 丸善 | 丸善 | 18 | `maruzen.png` |
| 4 | `kumazawa` | くまざわ書店 | くまざわ書店 | 103 | `kumazawa.png` |
| 5 | `miraiya` | 未来屋書店 | 未来屋書店 | 91 | `miraiya.png` |
| 6 | `miyawaki` | 宮脇書店 | 宮脇書店 | 83 | `miyawaki.png` |
| 7 | `bunkyo` | 文教堂 | 文教堂 | 37 | `bunkyo.png` |
| 8 | `sansei` | 三省堂書店 | 三省堂書店 | 21 | `sansei.png` |
| 9 | `yurin` | 有隣堂 | 有隣堂 | 23 | `yurin.png` |

未一致は`GENERIC_BOOK_ICON_ID`(画像`book.png`)。9チェーン合計は467件(全体の13.8%)。

実データによる方針の検証結果:

- **「三省堂」単独キーは採用しない**: 「刃物や三省堂」という刃物店が誤マッチする。フルネーム`三省堂書店`に限定して除外した。「短い/汎用的なキーを登録しない」方針が実際に必要だった唯一の例。
- **「丸善」単独キーは採用する**: 18件すべてが実際の丸善書店で誤マッチは無い。`丸善書店`に限定すると2件しか拾えないため、フルネーム優先の例外として`丸善`を採用する。
- **「丸善ジュンク堂書店」は実データに0件**: 丸善とジュンク堂の両方を含むレコードも0件だった。ただし将来の出現に備え、評価順は**ジュンク堂を丸善より前**に維持する。
- **新字体「紀伊国屋」は実在する**: 「紀伊国屋書店武蔵小杉店」が1件。NFKCで吸収されないため両表記の列挙は必須。
- **「BOOKSくまざわ」「ブックスくまざわ」は0件**: 実データに存在しないためmatchKeysから外した。
- **短縮形が不要なチェーン**: くまざわ/未来屋/宮脇は、短縮形と`〜書店`のヒット数が同一だったためフルネームのみとする。
- **「ゲオ文教堂伊東店」**: `文教堂`でヒットする1件。文教堂はゲオHDの子会社であり系列店として扱って問題ないため、`文教堂`をキーとする。
- **`brand`の充足率は36.9%**: 6割超のレコードは`name`のみでの判定になる。またこのリリースの`brand`は「宮脇書店 流山店」のように支店名を含むが、部分一致のため判定に支障はない。

### Decision 9: チェーン優先表示はレイヤの`filter`式の合成で実現する

レイヤは1枚のまま、confidenceフィルタを**チェーン店以外の枝の内側へ畳み込んだ**式で表示制御する(Decision 4)。

- プルダウン「すべて」: `["any", ["!=", chainIdExpr, ""], ["all", [">=", ["zoom"], 14], CONFIDENCE_FILTER]]` — チェーン店はレイヤの`minzoom`(z10)から`confidence`によらず全件、チェーン店以外はz14以上かつしきい値を満たすもののみ表示
- 特定チェーン選択: `["==", chainIdExpr, "<id>"]` — 選択したチェーンはチェーン店であるため、ズーム出し分けもconfidenceフィルタも掛からない

選択変更時は`map.setFilter()`でこの式を張り替えるだけで、ソース・レイヤ・アイコンは不変。

- **代替案**: チェーン用と非チェーン用で2レイヤに分ける → アイコン・ラベル・ポップアップの定義が二重化し、シンボル衝突の解決も分断される。
- **代替案**: JS側でズーム変化を監視して`setFilter`を呼び直す → 宣言的な`["zoom"]`式で足りるうえ、ズーム中の再評価コストと取りこぼしを招く。
- **代替案**: 最上位の`["all", <confidence>, <スコープ>]`を保ったままz10-14のしきい値だけ緩める → チェーン店以外も同時に緩んでしまい、しきい値の意味がズームごとに揺れる。チェーン店だけを対象外にするほうが意図が式に現れる。

### Decision 10: アイコンは`map.loadImage()` + `map.addImage()`で事前一括登録し、`styleimagemissing`をフォールバックに置く

`map.on("load")`内でテーブル由来の全アイコン(9チェーン + 汎用)を`Promise.all`で並行ロードしてから`addLayer`する。初回描画時のシンボル欠落を防ぐため、レイヤ追加はロード完了後。加えて`styleimagemissing`ハンドラを登録し、スタイル再読み込み等で未登録参照が起きた場合に遅延登録する。画像URLは`new URL('img/<file>', window.location.href)`で解決し、GitHub Pagesのサブパス配信に対応する。

- **代替案**: スプライトシートを生成してstyleの`sprite`で読む → 生成ステップが1つ増え、アイコン差し替えのたびに再生成が必要になる。10枚程度なら個別ロードで十分。

### Decision 11: ビルドツールはViteを使う

`web/`をViteのrootとし、`npm run build`(= `vite build`)が`web/dist/`へ公開用の静的資産一式を出力する。ディレクトリの役割は次のとおり。

| パス | 役割 |
|---|---|
| `web/index.html` | Viteのエントリ。`<script type="module" src="/src/main.js">`のみを持ち、import mapは持たない |
| `web/src/main.js` / `src/chains.js` | アプリ本体。`maplibre-gl`・`pmtiles`を通常のnpm importで解決する |
| `web/public/` | publicDir。`img/*.png`と`book.pmtiles`が**加工されずそのまま**`dist/`直下へコピーされる |
| `web/vite.config.js` | `base: './'`・`build.outDir: 'dist'`の設定 |
| `web/dist/` | ビルド生成物。gitignore対象 |

要点:

- **既存アイコンは移動不要**: `web/public/img/*.png`はpublicDirの規約にそのまま合致し、ビルド後も`<base>/img/kumazawa.png`で参照できる。`book.pmtiles`も同様に`web/public/`へ置く。
- **`index.html`の位置が`web/public/`から`web/`へ移る**: Viteはrootの`index.html`をエントリとして解析し、`<script>`の参照をハッシュ付きバンドルへ書き換えるため、publicDirには置けない。
- **`base: './'`**: 生成されるHTMLの資産参照が相対パスになり、オリジン直下でもGitHub Pagesのサブパス(`https://<user>.github.io/<repo>/`)でも同じ成果物が動く。リポジトリ名をビルド設定へ埋め込まずに済む(spec: サブパス配信への対応)。
- **CSSはJSからimportする**: `src/main.js`冒頭で`import "maplibre-gl/dist/maplibre-gl.css"`と書けばViteがバンドルするため、`index.html`側の`<link>`とvendorコピーが不要になる。
- **ユニットテストはViteに依存させない**: `chains.js`は素のESMのままにし、`node --test`で実行する。テストのためだけにテストランナーを追加しない。

- **代替案**: バンドラ無し・import map + 自前コピースクリプト(cafe-map-japanの現行構成) → cafe側と構成は揃うが、vendorのコピー対象ファイル(maplibre-glの`.mjs` 3点等)を依存パッケージの内部構造に合わせて手で維持し続ける必要がある。ユーザー指定によりViteを採用する。

### Decision 12: ローカル配信はViteの開発/プレビューサーバーで賄い、Range対応は実測で担保する

PMTilesはクライアントがバイト範囲でタイルを取り出す方式のため、配信元のRange対応が動作の前提になる。Viteの開発サーバー(`vite`)とプレビューサーバー(`vite preview`)はいずれも内部の静的配信で`Range`リクエストに応答するため、自前の配信サーバー(`server/serve.js`)は実装しない。ただし「Rangeに対応していること」は要件として残るため、`curl -i -r 0-99 <origin>/book.pmtiles`が`206 Partial Content`を返すことをタスクで実測確認する(万一対応していなければ、その時点でVite pluginとして`Range`ハンドラを足す)。

`vite`はソース変更のHMRを伴う日常の開発用、`vite preview`は`dist/`をそのまま配信する本番同等の確認用として使い分ける。本番はGitHub Pages(Fastly/Varnish)がRangeに対応している。

- **代替案**: Range対応の静的サーバーを自前実装する → Viteが同じ役割を担うため二重になる。自前実装が必要になるのは上記の実測が失敗した場合に限る。

### Decision 13: デプロイはGitHub Actions、`book.pmtiles`はコミット済み前提

`.github/workflows/deploy-pages.yml`が`main`へのpushと`workflow_dispatch`をトリガーに、`web`で`npm ci` → `npm run build`(`vite build`)し、その出力である`web/dist/`を`upload-pages-artifact`/`deploy-pages`で公開する。ビルドジョブ失敗時は`needs`によりデプロイジョブが走らない。ワークフローはパイプラインを実行しないため、`.gitignore`では`*.pmtiles`を無視しつつ`!web/public/book.pmtiles`で当該ファイルのみ除外を解除する。

## Risks / Trade-offs

- **Overture Placesの`brand`欠落でチェーン判定が漏れる** → `brand`が無くても`name`(例:「くまざわ書店ペリエ千葉本店」)への部分一致で拾える設計にしてある。判定漏れは汎用アイコンへのフォールバックに留まり、表示自体は壊れない。ただし「チェーン店はz10から表示」の恩恵は受けられないため、タスク段階で実データの`brand`充足率を確認する。
- **短いmatchKeyによる誤判定** → 実データで検証済み(tasks 5.2)。「丸善」は18件すべて真陽性だったため採用、「三省堂」は刃物店が誤マッチしたため`三省堂書店`へ限定した。Decision 8の確定テーブルを参照。
- **旧字体「紀伊國屋」/「紀伊国屋」の取りこぼし** → 両表記をmatchKeysに明示列挙する。NFKCでは吸収されないため、テーブル側の責務として扱う。実データに新字体表記が1件実在することを確認済み。
- **カテゴリを`bookstore`のみに絞ることによる網羅性の低下** → ユーザー確認済みの意図的な選択。将来広げる場合はパイプラインのカテゴリ配列に追加するだけで済む(SQLは`IN`のまま)。
- **`web/public/book.pmtiles`をコミットすることによるリポジトリ肥大** → 実測2.0MB(3,376件、Overture `2026-08-19.0`)で、GitHubの100MB/ファイル制限に対して十分小さい。データ更新のたびにバイナリ差分が積み上がる点はトレードオフとして受け入れる。
- **DuckDB CLI・tippecanoeがnpm外依存** → 開発者環境のセットアップ手順を`pipeline/README.md`に明記し、未インストール時は`ENOENT`を捕捉して導入方法を案内するエラーメッセージを出す。
- **チェーン店にconfidenceフィルタを掛けないことで低確度レコードが混じる** → Decision 4の意図的な選択。チェーン店として表示されるのはmatchKeyに一致したレコードのみであり、`confidence`が低くても「そのチェーンの店である」という判定自体は名称一致に基づく。位置や属性の精度が低いレコードが混じる可能性は残るが、広域でチェーン店の半数が消えるほうが本変更の狙いに反すると判断した。チェーン店以外は従来どおりしきい値で絞る。
- **Viteの静的配信がRangeに応答しない場合** → PMTilesがローカルで読めなくなる。タスク段階の`curl -i -r 0-99`で早期に検知し、その場合のみ`configureServer`/`configurePreviewServer`でRangeを処理する小さなVite pluginを追加する(本番のGitHub Pagesは影響を受けない)。
- **外部サービス依存(OSMタイル・demotilesグリフ)** → いずれも公開エンドポイントで可用性保証はない。オフライン/遮断環境では背景地図とラベルが出ないが、POIアイコンの描画は継続する。

## Migration Plan

新規構築のため既存データの移行は無い。立ち上げ順序は次のとおり。

1. `pipeline`を実装し、ローカルで`OVERTURE_RELEASE=<release> npm run fetch` → `npm run build:tiles` → `npm run verify:tiles`を通す。
2. `cp pipeline/out/book.pmtiles web/public/book.pmtiles`でフロントへ反映する。
3. `web`を実装し、`npm run dev`で開発しながら、最終確認は`npm run build` → `npm run preview`(`dist/`の本番同等配信)で行う(チェーン優先表示・アイコン・絞り込み・ポップアップ・Range)。
4. リポジトリをgit初期化してGitHubへpushし、Settings > Pages > Source を **GitHub Actions** に設定する(GitHub UI上の手動作業。コードには含まれない)。
5. `main`へのpushでワークフローが走り、公開URLで表示を確認する。

ロールバックは、デプロイ済みサイトについては直前のコミットへ`git revert`してpushすれば前のビルドが再公開される。データだけを戻す場合は`web/public/book.pmtiles`を以前のバージョンへ戻してコミットする。

## Open Questions

- ~~matchKeysの最終的な文言~~ → **解決済み**(tasks 5.2・5.3)。Decision 8の確定テーブルを参照。
- ~~z10-14のconfidenceしきい値0.99を書店の密度に合わせて緩めるかどうか~~ → **解決済み**(ユーザー判断)。しきい値の数値は据え置いたまま、**チェーン店をフィルタの適用対象外**とした(Decision 4・9。`bookstore-map-viewer`仕様も更新済み)。判断材料とした実データ(3,376件)の測定値は次のとおり。

  | しきい値 | 適用ズーム | 全POI | チェーン店(467件中) |
  |---|---|---|---|
  | 0.99 | z10-14 | 1,041 (30.8%) | 223 (47.8%) |
  | 0.97 | z15 | 1,965 (58.2%) | 349 (74.7%) |
  | 0.95 | z16 | 2,510 (74.3%) | 404 (86.5%) |
  | 0.90 | z17+ | 3,376 (100%) | 467 (100%) |

  改定後、z10以上で表示されるチェーン店は223件から**467件(全件)**になる。チェーン店以外の表示条件(z14以上かつしきい値を満たすもの)は変わらない。
