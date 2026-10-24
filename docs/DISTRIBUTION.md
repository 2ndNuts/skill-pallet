# ビルドと配布

## 現在の状態

0.3.6は開発版です。Apple Silicon・macOS 14以降を対象とし、開発環境で起動・入力・保存・3D UIを確認しています。Developer ID署名・Appleの公証・別のMacでの初回起動確認は未完了です。

ソースは個人アカウント `2ndNuts/skill-pallet` で非公開管理します。公開ベータのアプリと利用資料は `2ndNuts/skill-pallet-releases` で配布します。ソース管理用のリポジトリの公開範囲は変更しません。

## 開発ビルド

```sh
npm ci --prefix ui/interactive
npm test --prefix ui/interactive
bash scripts/build.sh development
bash scripts/package.sh development
```

生成先は `build/Skill Pallet.app` と `dist/Skill-Pallet-0.3.6-arm64-development.zip` です。アドホック署名で、Developer ID署名・Appleの公証は付いていません。利用中のローカル署名済みアプリと設定は置き換えません。

## 未公証版をGitHubで配布する

Apple Developer Programへ加入せず、未公証版のZIPをGitHub Releaseで配布できます。利用者は、入手元とファイルを確認し、初回起動時にmacOSの「プライバシーとセキュリティ」からそのアプリを個別に許可します。Appleも未公証アプリを開くための個別許可の手順を案内しています。

0.3.6 Beta 1のパッケージは次のコマンドで生成します。

```sh
python3 scripts/package-beta.py 0.3.6-beta.1
```

生成先は `dist/beta/0.3.6-beta.1/` です。ZIP、`SHA256SUMS.txt`、`BUILD-INFO.json` を配布専用の公開リポジトリへ添付します。`distribution/public/` のガイド・クレジットをZIPにも同梱します。既存のリリース出力を上書きせず、バージョンと手順書が一致しない場合もパッケージを止めます。

Releaseには、対応環境、未公証であること、[初回起動とアクセシビリティ許可の手順](INSTALL.md)、チェックサム、既知の制限を添えます。配布は開発版・ベータ版であることを明記します。管理者がアプリの実行を制限しているMacでは、利用者による許可が使えない場合があります。

アドホック署名は開発元の本人確認には使えません。更新により初回起動の許可やアクセシビリティの再登録が必要になる場合があります。利用者に開発者の証明書や秘密鍵をインストールさせる方式は採用しません。

現在のZIPは別のMacでの初回起動・入力が未検証です。この制限をReleaseと利用ガイドに明記しています。手元の検証に加え、別のMacでも実際にダウンロードした未公証版でその導線を確認します。リポジトリの公開状態とReleaseの下書き状態は、配布方式とは別に管理します。

## Developer ID署名・公証を付ける配布ビルド

この方式には個人名義のApple Developer Programと、そのチームの `Developer ID Application` 証明書が必要です。秘密鍵と公証の認証情報はmacOSのキーチェーンで管理します。

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

公証スクリプトはビルド済みのアプリをZIPにしてAppleへ提出し、Acceptedを確認してからチケットをアプリへ添付します。`release` モードのパッケージは署名・添付済みチケット・Gatekeeperの判定が通った場合だけ生成します。未公証のZIPは `development` モードで生成します。

## 配布前の確認

1. 生成したZIPをGitHubから別のMacへダウンロードする。未公証版は利用者による個別許可、公証付き版は通常の起動の流れを確認する。
2. 空のカタログから、アクセシビリティ許可 → Codexへの更新依頼 → カタログ反映まで確認する。
3. 空欄・下書きのあるチャット・チャット切り替え後の追記、成功時の使用回数保存を確認する。
4. アプリ更新後のお気に入り・履歴・音・ピンの引き継ぎと、初回起動・アクセシビリティの再許可の有無を確認する。
5. 操作音のON/OFF、音の重なり、動きを減らす設定、最小ウィンドウ幅を確認する。

ローカル開発証明書からDeveloper IDへの初回移行では署名の識別子が変わるため、このMacでもアクセシビリティの再登録が必要になる場合があります。同じDeveloper IDの署名を更新後も継続します。

## GitHub Release

配布用ZIPにはアプリ、第三者素材のクレジット、READMEを含めます。SHA-256を `SHA256SUMS.txt` に保存します。個人のカタログ・使用履歴・署名鍵・認証情報は含めません。

リリースを下書きで作成し、検証したZIPとチェックサムを添付してから、配布専用リポジトリのベータ版として公開します。配布専用リポジトリには利用資料・ロゴ・第三者素材のライセンスだけを置き、アプリのソース管理用リポジトリは非公開のまま維持します。

アプリ内の更新ボタンは現在、カタログ更新用です。GitHubからアプリ本体を取得・置換する自動アップデーターはまだ実装していません。

## 参照

- [Apple: Macでアプリを安全に開く（未公証アプリの個別許可）](https://support.apple.com/ja-jp/102445)
- [Apple: Signing Mac Software with Developer ID](https://developer.apple.com/developer-id/)
- [Apple: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [GitHub: About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

