# ビルドと配布

## 現在の状態

0.3.6は開発版です。Apple Silicon・macOS 14以降を対象とし、開発環境で起動・入力・保存・3D UIを確認しています。Developer ID署名・Appleの公証・別のMacでの初回起動確認は未完了です。

リポジトリとReleaseは個人アカウント `2ndNuts/skill-pallet` で非公開管理します。非公開リポジトリのReleaseを閲覧・ダウンロードできるのは、リポジトリへの読み取り権限を持つ人です。

## 開発ビルド

```sh
npm ci --prefix ui/interactive
npm test --prefix ui/interactive
bash scripts/build.sh development
bash scripts/package.sh development
```

生成先は `build/Skill Pallet.app` と `dist/Skill-Pallet-0.3.6-arm64-development.zip` です。開発用のアドホック署名であり、一般配布用の署名・公証は付いていません。利用中のローカル署名済みアプリと設定は置き換えません。

## 一般向けの配布ビルド

個人名義のApple Developer Programと、そのチームの `Developer ID Application` 証明書が必要です。秘密鍵と公証の認証情報はmacOSのキーチェーンで管理します。

```sh
export SKILL_PALLET_SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)'
bash scripts/build.sh release
```

リリースモードはHardened Runtimeとタイムスタンプを有効にし、Developer ID Application署名とTeam IDを検証します。ローカル署名やアドホック署名では通りません。

公証の認証情報を `notarytool` のキーチェーンプロファイルへ登録してから、次を実行します。

```sh
export SKILL_PALLET_NOTARY_PROFILE='skill-pallet-notary'
bash scripts/notarize.sh
bash scripts/package.sh release
```

公証スクリプトはビルド済みのアプリをZIPにしてAppleへ提出し、Acceptedを確認してからチケットをアプリへ添付します。配布用パッケージは署名・添付済みチケット・Gatekeeperの判定が通った場合だけ生成します。

## 配布前の確認

1. 生成したZIPをGitHubから別のMacへダウンロードし、標準のGatekeeperが有効なまま初回起動できることを確認する。
2. 空のカタログから、アクセシビリティ許可 → Codexへの更新依頼 → カタログ反映まで確認する。
3. 空欄・下書きのあるチャット・チャット切り替え後の追記、成功時の使用回数保存を確認する。
4. アプリ更新後もアクセシビリティ許可・お気に入り・履歴・音・ピンが引き継がれることを確認する。
5. 操作音のON/OFF、音の重なり、動きを減らす設定、最小ウィンドウ幅を確認する。

ローカル開発証明書からDeveloper IDへの初回移行では署名の識別子が変わるため、このMacでもアクセシビリティの再登録が必要になる場合があります。同じDeveloper IDの署名を更新後も継続します。

## GitHub Release

配布用ZIPにはアプリ、第三者素材のクレジット、READMEを含めます。SHA-256を `SHA256SUMS.txt` に保存します。個人のカタログ・使用履歴・署名鍵・認証情報は含めません。

リリースを下書きで作成し、検証したZIPとチェックサムを添付します。一般公開へ切り替える時点で、ソース公開の範囲と利用許諾も確定します。

アプリ内の更新ボタンは現在、カタログ更新用です。GitHubからアプリ本体を取得・置換する自動アップデーターはまだ実装していません。

## 参照

- [Apple: Signing Mac Software with Developer ID](https://developer.apple.com/developer-id/)
- [Apple: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [GitHub: About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

