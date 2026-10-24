# Skill Pallet

<img src="assets/lockup.svg" width="304" alt="Skill Pallet">

Codexと並べて使う、Mac用のスキルランチャー。木製のチップを押すと、現在のチャットの入力欄へスキルを追記します。

**[0.3.6 Beta 1をダウンロード](https://github.com/2ndNuts/skill-pallet-releases/releases/download/v0.3.6-beta.1/Skill-Pallet-0.3.6-beta.1-arm64.zip)** · [リリース情報](https://github.com/2ndNuts/skill-pallet-releases/releases/tag/v0.3.6-beta.1) · [インストール手順](INSTALL.md)

## ベータ版について

無料で試せる未公証ベータ版です。AppleのDeveloper ID署名・公証は受けていないため、初回起動時は利用者による個別許可が必要です。別のMacでの初回起動・入力は未検証です。

このリポジトリではアプリと利用資料を配布します。ソース管理用のリポジトリは非公開です。

## 対応環境

- Apple Silicon搭載Mac（Mシリーズ）
- macOS 14以降
- Codexデスクトップアプリ

## できること

- 4列の木製チップからスキルを選択。マウスオーバーで日本語の概要を表示。
- 名前・用途・ジャンルで絞り込み、関連スキルはスタックから展開。
- Option＋クリックでお気に入りを保存。
- 直近30日の使用回数に応じて、木の色が5段階で変化。
- チップごとの慣性・衝突と木の操作音。音と最前面固定は切り替え可能。

## 初めて使うとき

1. ZIPを展開し、`Skill Pallet.app` を「アプリケーション」へ移します。
2. [初回起動の手順](INSTALL.md)に沿って開き、アクセシビリティを許可します。
3. Codexを開き、Skill Palletの↻からカタログ作成を依頼します。入力欄へ追加された依頼を確認して送信します。
4. カタログが反映されたら、使いたいチャットを開いてチップを押します。

カタログには、利用者のCodexで使えるスキルが並びます。Skill Palletは入力欄へ追記し、送信は利用者が行います。

## 保存と更新

カタログと使用履歴は `~/Library/Application Support/Skill Pallet/` に保存します。お気に入り、操作音、ピンなどの設定も再起動後に引き継ぎます。

アプリ本体の更新は、終了後に新しいアプリへ置き換えます。↻はスキルカタログの更新用です。未公証版では、アプリ更新後に起動やアクセシビリティの再許可が必要になる場合があります。

## 不具合の報告

[Issues](https://github.com/2ndNuts/skill-pallet-releases/issues)へ、アプリのバージョン、macOSのバージョン、起きた操作と表示内容をお知らせください。

[変更履歴](CHANGELOG.md) · [第三者素材のクレジット](THIRD_PARTY_NOTICES.md)
