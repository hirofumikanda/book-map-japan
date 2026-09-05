OpenSpec Change: $ARGUMENTS

tasks.mdの実装タスクをGitHub Issueとして登録してください。

ルール:

- 1つの独立してレビュー可能な変更を1 Issueにする
- 各Issueに目的、作業内容、受け入れ条件、テスト、依存Issueを記載する
- OpenSpec Change名とtasks.mdのタスク番号を記載する
- 実装はまだ開始しない
- 作成後、Issue番号をtasks.mdに追記する

マイルストーン:

- OpenSpec Change名をタイトルとするマイルストーンに、作成した全Issueを割り当てる
- `gh api repos/{owner}/{repo}/milestones` で既存を確認し、無ければ `gh api --method POST repos/{owner}/{repo}/milestones -f title='<change名>' -f description='<proposal.mdのWhyの要約>'` で作成する
- Issue作成時に `gh issue create --milestone '<change名>'` で指定する

ラベル:

- 各Issueに「領域」と「種別」のラベルを1つずつ付ける。手動作業を含む場合は補助ラベルを追加する
- 領域(`area:*`)はtasks.mdのそのグループが触るパスから決める
  - `pipeline/` → `area:pipeline`
  - `web/` → `area:web`
  - `.github/`・リポジトリ設定・`.gitignore` → `area:infra`
  - README等のドキュメントのみ → `area:docs`
- 種別(`type:*`)は作業の性質から決める
  - 新規のコード実装 → `type:feature`
  - データ生成・デプロイ実行など、コード変更を主目的としない運用作業 → `type:ops`
  - ドキュメント作成 → `type:docs`
  - 実装済みのものを確認する検証専用 → `type:test`
- GitHub UI操作など、コードで完結しない手動作業を含むIssueには `needs-manual-step` を付ける
- 依存Issueが未完了で着手できないIssueには `blocked` を付ける
- `gh label list` で既存ラベルを確認し、不足分のみ `gh label create <name> --color <hex> --description <説明>` で作成する
  - 色は体系立てて選ぶ(領域=青系、種別=緑系、補助=黄/赤系など)
  - 既存ラベルと意味が重複するものを新設しない
- ラベルとマイルストーンの割り当て結果も、Issue番号と併せて最後に一覧で報告する
