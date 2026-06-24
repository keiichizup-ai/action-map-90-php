# ACTION MAP 90 PHP版

さくらのレンタルサーバで動かすための、PHP + MySQL版AI戦略マンダラチャートです。

## 機能

- メールアドレス・パスワード登録
- ログイン / ログアウト
- ユーザー別マンダラチャート保存
- 81マスの自動保存
- 中央8つの中目標を外側ブロック中央へ自動反映
- OpenAI APIによる具体アクション展開
- OpenAI APIによる30/60/90日プラン生成
- 30/60/90日プランの実行タスク化
- タスクのステータス管理
- Google Calendar等に取り込める `.ics` ファイル出力
- YouTube動画・Google Books書籍レコメンド
- 90日ビジョン画像生成
- クラウド保存データ削除

## ファイル構成

```text
action-map-90-php/
├── index.php
├── assets/
│   ├── app.js
│   └── style.css
├── api/
│   ├── bootstrap.php
│   ├── auth.php
│   ├── chart.php
│   ├── ai.php
│   ├── tasks.php
│   ├── recommendations.php
│   └── vision.php
├── config/
│   ├── config.example.php
│   └── .htaccess
├── database/
│   ├── schema.sql
│   ├── migration_002_execution_features.sql
│   └── .htaccess
├── uploads/
│   └── visions/
├── .htaccess
├── .gitignore
└── README.md
```

## さくらのレンタルサーバでの設定手順

### 1. サーバーを契約

PHPとMySQLが使えるプランを契約してください。ライトプランより、スタンダード以上を推奨します。

### 2. PHPバージョンを確認

コントロールパネルでPHP 8.1以上を選択してください。

### 3. MySQLデータベースを作成

コントロールパネルでMySQLデータベースを作成します。以下を控えてください。

```text
データベースサーバー名
データベース名
ユーザー名
パスワード
```

### 4. テーブルを作成

さくらのコントロールパネルからphpMyAdminを開き、作成したDBを選択します。

`database/schema.sql` の内容をSQL画面へ貼り付けて実行してください。

既に前回版のテーブルを作成済みの場合は、`database/migration_002_execution_features.sql` だけを実行してください。

### 5. config.phpを作成

`config/config.example.php` をコピーして、`config/config.php` を作成します。

```php
const DB_HOST = 'mysql0000.db.sakura.ne.jp';
const DB_NAME = 'your_database_name';
const DB_USER = 'your_database_user';
const DB_PASS = 'your_database_password';

const OPENAI_API_KEY = 'sk-proj-...';
const OPENAI_MODEL = 'gpt-4.1-mini';
const OPENAI_IMAGE_MODEL = 'gpt-image-1';
const YOUTUBE_API_KEY = '';
const SESSION_SECRET = '長いランダム文字列に変更';
```

`config/config.php` はGitHubへ上げないでください。

`YOUTUBE_API_KEY` は任意です。未設定でもYouTube検索リンクを表示します。APIキーを設定すると動画タイトル、説明、サムネイルを取得できます。

### 6. ファイルをアップロード

FTPソフト、またはファイルマネージャーで以下のようにアップロードします。

```text
/home/アカウント名/www/action-map-90/
```

アップロード後、以下のURLでアクセスします。

```text
https://あなたのドメイン/action-map-90/
```

### 7. 動作確認

1. 新規登録できる
2. ログアウトできる
3. ログインできる
4. マンダラに入力すると「クラウド保存済み」になる
5. 再ログイン後も入力内容が残る
6. 中央の中目標が外側ブロックへ自動反映される
7. アクション展開が動く
8. 30/60/90日プラン生成が動く
9. 実行タスク化が動く
10. `カレンダー用ICS` をダウンロードできる
11. 参考動画・書籍が表示される
12. 90日ビジョン画像が生成される
13. クラウドデータ削除が動く

## GitHubへ上げてよいもの

```text
index.php
assets/
api/
config/config.example.php
database/schema.sql
database/migration_002_execution_features.sql
.htaccess
.gitignore
README.md
```

## GitHubへ上げないもの

```text
config/config.php
OpenAI APIキー
DBパスワード
YouTube APIキー
秘密鍵
.env
```

## ローカル確認

XAMPPやMAMPを使う場合は、MySQLに `schema.sql` を流し込み、`config/config.php` のDB接続情報をローカル用に変更してください。

PHP内蔵サーバーで簡易確認する場合:

```bash
php -S localhost:8000
```

ブラウザで開きます。

```text
http://localhost:8000
```

## デプロイ先
https://keiichizup.sakura.ne.jp/action-map-90/
