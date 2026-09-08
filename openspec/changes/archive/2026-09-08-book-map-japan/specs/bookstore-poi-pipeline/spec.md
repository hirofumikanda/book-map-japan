## Purpose

Overture Maps Placesから日本全国の書店POIを取得してGeoJSON化し、z10-14のMVT形式PMTilesアーカイブへ変換したうえで、HTTP Rangeリクエストに対応した静的配信が可能な状態にするデータパイプライン。

## ADDED Requirements

### Requirement: Overture Maps Placesからの書店POI取得
システムはOverture Maps Foundationが公開するPlacesデータセット(theme=places, type=place)から、日本国内に所在する書店に該当するPOI(`categories.primary`が`bookstore`であるレコード)を取得しなければならない(SHALL)。取得結果はGeoJSON FeatureCollectionとして出力し、各Featureは店名・ブランド・住所等、Overture Places上の属性情報をpropertiesとして保持しなければならない(SHALL)。

日本国内であることの判定は、日本を覆う矩形bboxによる一次絞り込みと、`addresses`に国コード`JP`を含むことの両方を満たすことによって行わなければならない(SHALL)。

対象とするOverture Mapsのリリースバージョンは実行時に明示的に指定できなければならず(SHALL)、指定されていない場合は処理を失敗させなければならない(SHALL)。

#### Scenario: 日本全国の書店POIを取得する
- **WHEN** データ取得処理を実行する
- **THEN** 日本国内の`categories.primary`が`bookstore`のPOIがGeoJSON FeatureCollectionとして出力される

#### Scenario: 日本国外の書店POIが除外される
- **WHEN** bboxの範囲内にあるが`addresses`の国コードが`JP`でない書店POIが存在する
- **THEN** 当該POIは出力GeoJSONのFeatureCollectionに含まれない

#### Scenario: 書店以外のカテゴリのPOIが除外される
- **WHEN** `categories.primary`が`bookstore`以外(例: `used_bookstore`、`comic_books_store`、`books_music_and_video_store`)のPOIが存在する
- **THEN** 当該POIは出力GeoJSONのFeatureCollectionに含まれない

#### Scenario: リリースバージョン未指定では処理が失敗する
- **WHEN** Overture Mapsのリリースバージョンを指定せずにデータ取得処理を実行する
- **THEN** 処理は失敗を明示して終了し、GeoJSONを出力しない

#### Scenario: Overture Placesデータの取得に失敗する
- **WHEN** Overture Placesデータへのアクセスがタイムアウトまたはエラーで失敗する
- **THEN** 処理は失敗を明示して終了し、不完全なGeoJSONを正常出力として扱わない

### Requirement: confidenceによる品質フィルタ
システムはOverture Placesレコードの`confidence`値が0.9以上のレコードのみを取得対象とし、0.9未満のレコードは出力するGeoJSONから除外しなければならない(SHALL)。

#### Scenario: confidenceが0.9以上のPOIが含まれる
- **WHEN** `confidence`が0.9以上の書店POIを取得する
- **THEN** 当該POIは出力GeoJSONのFeatureCollectionに含まれる

#### Scenario: confidenceが0.9未満のPOIが除外される
- **WHEN** `confidence`が0.9未満の書店POIが存在する
- **THEN** 当該POIは出力GeoJSONのFeatureCollectionに含まれない

### Requirement: confidence・websitesプロパティの保持
システムはGeoJSONの各Featureのpropertiesに、Overture Placesレコードが保持する`confidence`(信頼度スコア)を数値として保持しなければならない(SHALL)。またOverture Placesレコードが`websites`属性を持つ場合、その値をpropertiesの`websites`として保持しなければならない(SHALL)。`websites`属性を持たないレコードでは、当該propertyを省略してよい(MAY)。

#### Scenario: confidenceがpropertiesに保持される
- **WHEN** Overture PlacesレコードをGeoJSON Featureへ変換する
- **THEN** 変換後のpropertiesに、元レコードのconfidence値が数値として保持される

#### Scenario: websitesがpropertiesに保持される
- **WHEN** `websites`属性を持つOverture PlacesレコードをGeoJSON Featureへ変換する
- **THEN** 変換後のpropertiesに当該レコードのwebsites情報がwebsitesとして保持される

#### Scenario: websitesを持たないレコードではpropertyが省略される
- **WHEN** `websites`属性を持たないOverture PlacesレコードをGeoJSON Featureへ変換する
- **THEN** 変換後のpropertiesにwebsitesキーは含まれない

### Requirement: 住所プロパティの保持
システムはOverture Placesレコードが住所情報を持つ場合、整形済みの1行住所をGeoJSON Featureのpropertiesの`address`として保持しなければならない(SHALL)。住所情報を持たないレコードでは、当該propertyを省略してよい(MAY)。

#### Scenario: 住所がpropertiesに保持される
- **WHEN** 住所情報を持つOverture PlacesレコードをGeoJSON Featureへ変換する
- **THEN** 変換後のpropertiesに整形済みの1行住所が`address`として保持される

#### Scenario: 住所を持たないレコードではpropertyが省略される
- **WHEN** 住所情報を持たないOverture PlacesレコードをGeoJSON Featureへ変換する
- **THEN** 変換後のpropertiesにaddressキーは含まれない

### Requirement: ブランド識別情報の保持
システムは取得したGeoJSONの各Featureに、チェーン店判定に利用可能なブランド識別情報(Overture Placesの`names`・`brand`に相当する属性)を欠落させずpropertiesとして保持しなければならない(SHALL)。ブランド識別情報のproperty名は、ビューア側のチェーン判定がそのまま参照できる名称(`name`・`brand`)でなければならない(SHALL)。

#### Scenario: チェーン店のブランド名が保持される
- **WHEN** Overture Places上で`brand`属性を持つ書店POI(例: 紀伊國屋書店、ジュンク堂書店)を取得する
- **THEN** 出力GeoJSONの対応するFeatureのpropertiesに`brand`として当該ブランド名の値が保持される

#### Scenario: 店名が保持される
- **WHEN** `names.primary`を持つ書店POIを取得する
- **THEN** 出力GeoJSONの対応するFeatureのpropertiesに`name`として当該店名の値が保持される

### Requirement: GeoJSONからPMTilesへの変換
システムは取得したGeoJSONを、ズームレベルz10からz14までのMVT(Mapbox Vector Tile)を含むPMTilesアーカイブへ変換しなければならない(SHALL)。生成されたPMTilesはz10未満・z14超過のタイルデータを含まない(SHALL NOT)。変換処理は、タイルサイズ・フィーチャ数上限による間引きに加え、ズームレベルごとの密度ベースの間引き(dot-density drop)も無効化しなければならず(SHALL)、z10からz14までのいずれのズームレベルにおいてもGeoJSON中の各POIを間引いてはならない(SHALL NOT)。

#### Scenario: 指定ズーム範囲でPMTilesが生成される
- **WHEN** GeoJSONをPMTilesへ変換する
- **THEN** 生成されたPMTilesアーカイブのメタデータ上のminzoomが10、maxzoomが14として記録される

#### Scenario: 全POIがいずれかのタイルに含まれる
- **WHEN** GeoJSON中の各POIをPMTilesへ変換する
- **THEN** 各POIは変換後、z10からz14までの各ズームレベルにおいて、対応する座標のタイル内にFeatureとして存在する

### Requirement: 生成物の検証
システムは生成されたPMTilesアーカイブについて、ズーム範囲メタデータが期待値(minzoom=10、maxzoom=14)であることと、変換元GeoJSONから抽出したサンプルPOIが対応するz14タイル内にFeatureとして存在することを検証する手段を提供しなければならない(SHALL)。検証に失敗した場合は失敗を明示して終了しなければならない(SHALL)。

#### Scenario: 検証が成功する
- **WHEN** 正しく生成されたPMTilesに対して検証処理を実行する
- **THEN** ズーム範囲メタデータとサンプルPOIの存在がいずれも確認され、検証は成功として終了する

#### Scenario: ズーム範囲が期待値と異なる場合に検証が失敗する
- **WHEN** minzoom/maxzoomが期待値と異なるPMTilesに対して検証処理を実行する
- **THEN** 検証は失敗を明示して終了する

#### Scenario: サンプルPOIがタイル内に存在しない場合に検証が失敗する
- **WHEN** サンプルPOIが対応するz14タイル内に存在しないPMTilesに対して検証処理を実行する
- **THEN** 検証は失敗を明示して終了する

### Requirement: PMTilesの静的配信
システムは生成したPMTilesファイルを、クライアントからのHTTP Rangeリクエストに対応した静的配信手段で公開しなければならない(SHALL)。

#### Scenario: HTTP Rangeリクエストに応答する
- **WHEN** クライアントがPMTilesファイルの一部バイト範囲を指定してリクエストする
- **THEN** 配信元は206 Partial Contentで該当範囲のデータを返す

#### Scenario: Rangeヘッダ無しのリクエストにも応答する
- **WHEN** クライアントがRangeヘッダを付けずにPMTilesファイルをリクエストする
- **THEN** 配信元は200でファイル全体を返す
