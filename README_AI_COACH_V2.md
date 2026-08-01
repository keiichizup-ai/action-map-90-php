# AIコーチ v2 改善内容

## 朝のチェックイン
- 今日の日付がタスクの開始日〜終了日に含まれるタスクだけ表示
- 今日の予定タスクは初回表示時に選択済み
- チェックボックスとタスク名を左揃えに改善
- 日付範囲と見積時間をタスクカード内に表示

## 夜の振り返り
- 朝のチェックインで選んだタスクだけ表示
- できたタスクをチェックして保存
- 完了にしたタスクは既存タスク一覧にも反映

## 反映ファイル
- api/coach.php
- assets/app.js
- assets/style.css
- assets/mobile-coach.js
- assets/mobile-coach.css
- index.php
- mobile-coach.php
- service-worker.js

DB変更はありません。
