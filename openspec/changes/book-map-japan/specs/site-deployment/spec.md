## Purpose

GitHub Actionsを用いて`web`フロントエンドのビルドとGitHub Pagesへの公開を自動化し、手動デプロイ作業を不要にする。

## ADDED Requirements

### Requirement: web資産のビルド自動化
システムはGitHub Actionsワークフローにより、`web`ディレクトリのビルド手順(依存パッケージのインストールとビルドコマンドの実行)を自動実行し、GitHub Pagesへ公開する静的資産一式を生成しなければならない(SHALL)。

#### Scenario: mainブランチへのpushでビルドが実行される
- **WHEN** `main`ブランチへ変更がpushされる
- **THEN** ワークフローが起動し、`web`のビルドが自動的に実行される

#### Scenario: 手動実行でビルドが行える
- **WHEN** ユーザーがGitHub Actions上でワークフローを手動実行(workflow_dispatch)する
- **THEN** `main`ブランチへのpushを待たずに同じビルド・デプロイ手順が実行される

### Requirement: GitHub Pagesへの自動デプロイ
システムはビルドにより生成された静的資産をGitHub Pagesへデプロイしなければならない(SHALL)。デプロイが成功した場合、GitHub PagesのURLで最新のWebフロントエンドが閲覧可能でなければならない(SHALL)。

#### Scenario: デプロイが成功する
- **WHEN** ビルドジョブが正常に完了する
- **THEN** 生成された静的資産がGitHub Pagesへデプロイされ、公開URLから最新のビルド内容が配信される

#### Scenario: ビルドが失敗した場合はデプロイしない
- **WHEN** ビルドジョブがエラーで失敗する
- **THEN** デプロイジョブは実行されず、GitHub Pages上の既存の公開内容は変更されない

### Requirement: デプロイスコープの限定
システムのデプロイワークフローは`web`のビルドとGitHub Pagesへの公開のみを行い、書店POIデータの取得やPMTiles生成(データパイプラインの実行)は行ってはならない(SHALL NOT)。

#### Scenario: pipelineの実行を伴わずにデプロイされる
- **WHEN** デプロイワークフローが実行される
- **THEN** Overture Placesデータの取得やPMTiles変換は実行されず、ワークフロー実行前に用意された`book.pmtiles`がそのまま公開資産に含まれる

### Requirement: PMTilesの公開資産への同梱
システムはGitHub Pagesへ公開する静的資産に、リポジトリへコミット済みの書店POIのPMTilesファイルを含めなければならない(SHALL)。

#### Scenario: 公開サイトからPMTilesが取得できる
- **WHEN** デプロイ後の公開URLでマップページを開く
- **THEN** 同一のベースパス配下から書店POIのPMTilesがHTTP Rangeリクエストで取得され、POIが地図上に表示される
