# AIコーチ スマホ/PWA版

## 追加URL
`https://keiichizup.sakura.ne.jp/action-map-90/mobile-coach.php`

## 追加内容
- スマホ専用「今日」画面
- 朝・夜・記録の下部ナビ
- 朝は気分・集中時間・最大3タスクをタップ入力
- 夜は完了タスク・気分・未完理由をタップ入力
- 文章入力は任意
- 16時以降は夜の振り返りを優先表示
- PWA対応（ホーム画面追加・standalone表示）
- 既存DB/APIを共用

## 導入
1. `migration_005_ai_coach.sql` 未実行ならphpMyAdminで実行
2. パッチ内のファイルを `/home/keiichizup/www/action-map-90/` へアップロード
3. `mobile-coach.php` をスマホで開く
4. iPhone: Safari共有 → ホーム画面に追加
5. Android: ブラウザメニューまたは画面内メニュー → ホーム画面に追加

`config/config.php` は含まれていません。
