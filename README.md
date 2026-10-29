# Skill Pallet

<img src="ui/brand/assets/lockup.svg" width="304" alt="Skill Pallet">

Codexと並べて使う、Mac用のスキルランチャー。木製のチップからスキルを選ぶと、現在のチャットの入力欄へ追記します。

[ソースコード](https://github.com/2ndNuts/skill-pallet)はこのリポジトリで公開しています。アプリと利用資料は、配布専用の公開リポジトリ [skill-pallet-releases](https://github.com/2ndNuts/skill-pallet-releases) で提供しています。**[0.3.17 Beta 1の配布先](https://github.com/2ndNuts/skill-pallet-releases/releases/tag/v0.3.17-beta.1)**

ベータ版はDeveloper ID署名・Appleの公証を受けていません。利用者による初回起動の個別許可が必要です。別のMacでの初回起動確認は未完了です。

## 機能

- 4列の木製チップ、ジャンルと日本語検索、関連スキルのスタック。
- 7ジャンルの色を、チップの縁・ジャンルボタン・概要の印へ統一。絞り込みに合わせて切り替え。
- 横フリックやジャンルボタンで、木のトレーごと200msで切り替え。縦スクロールではチップの一覧を移動。
- マウスオーバーで概要を表示。Option＋クリックでお気に入りを保存。
- 直近30日の使用回数に応じて、スキルごとに木の色が5段階で変化。
- 個別の慣性・摩擦・衝突。スクロールやウィンドウ移動の接触に木の音が連動。
- 起動・再表示・更新操作で、右下から左上へチップが整列。
- 操作音はOFF・標準・大の3段階。最前面への固定とともに設定を保存。

## 対応環境

Apple Silicon搭載Mac、macOS 14以降、Codexデスクトップアプリが必要です。Intel Mac・Windows・ブラウザ版Codexは動作確認の対象に含みません。

## 初めて使うとき

ReleaseのZIPを展開し、アプリをApplicationsフォルダへ移して開きます。未公証版の初回起動では、[インストール手順](docs/INSTALL.md)に沿って、そのアプリを開くか利用者自身で判断します。

1. macOSの「プライバシーとセキュリティ → アクセシビリティ」でSkill Palletを許可します。
2. Codexを開き、Skill Palletの更新ボタンからカタログ作成を依頼します。入力欄へ追加された依頼文を確認して送信します。
3. カタログが反映されたら、使いたいチャットを開いてチップを押します。Skill Palletは末尾に追記し、送信は行いません。

カタログは利用者ごとに作成します。このアプリからスキル自体をインストールする機能はありません。

入力形式は `/スキル名`、`$スキル名`、ファイル参照から選べます。入力欄が見つからない場合はCodexの入力欄を一度クリックしてください。

## 保存するデータ

カタログと使用日時は `~/Library/Application Support/Skill Pallet/`、お気に入り・操作音・ピンなどの設定はmacOSのユーザー設定に保存します。使用回数は追記の成功を確認した場合だけ加算します。

色の境界は直近30日で、0〜4回／5〜10回／11〜15回／16〜20回／21回以上です。

クリップボードは追記のために一時使用し、処理後に元の内容を復元します。アクセシビリティ操作の対象は実行中のCodexアプリです。

## 開発

Xcode Command Line Tools、Python 3、Node.jsとnpmを用意します。

```sh
npm ci --prefix ui/interactive
npm test --prefix ui/interactive
bash scripts/build.sh development
```

`build/Skill Pallet.app` が生成され、ネイティブの自己検証も実行されます。開発ビルドはアドホック署名です。通常利用中のアプリを置き換えません。

ブラウザでのUI確認には、架空のサンプルカタログを用意しています。

```sh
npm run build --prefix ui/interactive
python3 -m http.server 8794 --bind 127.0.0.1 --directory ui
```

`http://127.0.0.1:8794/interactive/` を開きます。ブラウザではCodexへの追記は実行せず、サンプル上でUIを確認します。

## 関連資料

- [カタログの形式](docs/CATALOG.md)
- [未公証版のインストール](docs/INSTALL.md)
- [公開用の利用ガイド](distribution/public/README.md)
- [ビルドと配布](docs/DISTRIBUTION.md)
- [第三者素材のクレジット](THIRD_PARTY_NOTICES.md)
- [0.3.17の横フリック・連続操作の改善](docs/releases/0.3.17.md)
- [0.3.16のトレー切り替え](docs/releases/0.3.16.md)
- [0.3.15の横フリック](docs/releases/0.3.15.md)
- [0.3.14のジャンル7色](docs/releases/0.3.14.md)
- [0.3.13の音量3段階](docs/releases/0.3.13.md)
- [0.3.12の空欄への追記と押下反応の修正](docs/releases/0.3.12.md)
- [0.3.11の押下反応の改善](docs/releases/0.3.11.md)
- [0.3.10の入力速度とウィンドウ表示の修正](docs/releases/0.3.10.md)
- [0.3.9の入力欄検出の修正](docs/releases/0.3.9.md)
- [0.3.7の入力結果確認の修正](docs/releases/0.3.7.md)
- [0.3.6の変更と検証状況](docs/releases/0.3.6.md)

## ライセンス

ソースコードは [MIT License](LICENSE) で公開しています。第三者のコード・画像・音源には、それぞれ [第三者素材のクレジット](THIRD_PARTY_NOTICES.md) に記載したライセンスが適用されます。

