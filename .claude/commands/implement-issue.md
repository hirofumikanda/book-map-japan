GitHub Issue `$ARGUMENTS` を実装してください。

## 実装ルール

* 最初に対象Issueの内容を確認すること
* Issueに記載されたOpenSpec Change名を特定すること
* 実装には必ず `/opsx:apply` コマンドを使用すること
* `/opsx:apply` によって、対象OpenSpec Changeの `tasks.md` に従って実装すること
* 対象Issueに対応するタスクのみを実装すること
* 対象Issueの範囲外のタスクは実装しないこと
* 必要なテストを実施し、結果を確認すること

## Git / Pull Request

* `main` ブランチ上で直接変更・コミットしないこと
* 対象Issue用の作業ブランチを作成すること
* 実装完了後、変更をコミットすること
* 作業ブランチをリモートリポジトリへpushすること
* Pull Requestを作成すること
* Pull Requestの本文に以下を記載すること

  * 変更内容
  * 実施したテストとその結果
  * `Closes #<Issue番号>`
* `Closes` には必ず今回指定されたIssue番号を使用すること

## 禁止事項

* `main` ブランチへのマージは実施しないこと
* `git merge`、`gh pr merge`など、Pull Requestをマージする操作は実行しないこと
* Pull Request作成後はマージせず、そこで作業を終了すること