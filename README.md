# Discord用 動画圧縮（PWA）

Discordのアップロード上限に収まるように，動画を端末の中で再圧縮する静的Webアプリ．
H.264 + AAC のMP4を出力する．サーバーは不要で，GitHub Pagesにそのまま置ける．

## 公開のしかた（GitHub Pages）

1. このフォルダの中身をリポジトリの直下に置いてpushする．
2. リポジトリの Settings → Pages で，Source を「Deploy from a branch」，Branch を `main` / `/(root)` にする．
3. `https://<ユーザー名>.github.io/<リポジトリ名>/` を開く．

ビルドは不要．ライブラリ（Mediabunny 1.66.2，MPL-2.0）は `vendor/` に同梱している．

## 使い方

- Windows：Chrome / Edgeで開き，動画をドロップする．結果を保存してDiscordにドラッグする．
- Android：Chromeで開き，メニューの「ホーム画面に追加」でインストールする．以後はギャラリーの共有メニューに出る．
- iPhone：Safariで開き，「ホーム画面に追加」する．アプリを開いて動画を選び，結果を共有シートからDiscordに渡す．

## ファイル

- `plan.js`：目標サイズからビットレート・解像度・fpsを決める（設計書「圧縮の決め方」）．
- `compress.js`：Mediabunny（WebCodecs）で変換する．目標を超えたら1回だけやり直す．
- `app.js`：画面．`sw.js`：オフライン用キャッシュと共有メニューからの受け取り．
