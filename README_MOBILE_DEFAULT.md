# モバイル初期画面 自動転送

## 動作
- スマホで `/action-map-90/` を開く  
  → `/action-map-90/mobile-coach.php` へ自動転送
- PCで `/action-map-90/` を開く  
  → 従来のPC版を表示
- スマホの「PC版を開く」を押す  
  → `/?view=desktop` を開き、自動転送を回避
- PCからスマホ版を確認する場合  
  → `/?view=mobile` でAIコーチ画面へ転送

## 変更ファイル
- index.php
- mobile-coach.php

DB変更はありません。
