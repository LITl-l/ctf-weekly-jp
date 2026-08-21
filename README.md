# ctf-weekly-jp

CTFtime の今週のCTFを **毎週** Discord に日本語で通知する Bot です。
各イベントに **AI による要約・ジャンル推定・初心者向け度の判定** が付きます。

Cloudflare Workers の無料枠のみで動作します（サーバー常時起動は不要）。

## 通知イメージ

```
## 📢 今週のCTF（8月19日〜8月26日）— 全 6件
うち初心者向け 1件 🟢
難易度はAIによる推定です。参加前に必ず公式情報をご確認ください。

🟢 BrunnerCTF 2026
  📅 開催期間（JST）: 8月21日(金) 21:00 〜 8月23日(日) 21:00（2日）
  🎯 形式: Jeopardy（問題解答形式） / オンライン
  🔑 参加条件: 誰でも参加可
  ⚖️ weight: 24.66
  🧩 予想ジャンル: web / crypto / rev
  🟢 初心者向け（AI推定）: 公式説明に入門者歓迎と明記されています。
```

## 仕組み

```
Cron (毎週月曜 09:00 JST)  ─┐
/ctf next（スラッシュコマンド）─┴─► CTFtime取得 → 絞り込み → AI要約 → 埋め込み生成 → Discord投稿
```

Cloudflare Workers は常時接続（Gateway）を維持できないため、Discord Bot は
**HTTP Interactions 方式**で実装しています。Cron Trigger と同じ Worker に同居します。

## セットアップ

### 1. Discord Webhook を作る

通知したいチャンネル → 「連携サービス」→「ウェブフックを作成」→ URL をコピー。

### 2. AI プロバイダを選ぶ

OpenAI 互換 API なら何でも使えます。無料枠のあるもの:

| プロバイダ | `AI_BASE_URL` | `AI_MODEL` の例 | 無料枠 |
|---|---|---|---|
| Mistral（既定） | `https://api.mistral.ai/v1` | `mistral-small-latest` | Experiment ティア（毎月更新） |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | `meta/llama-3.3-70b-instruct` | 初回1,000クレジット・40 RPM |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | 無料枠あり |
| ローカル llama.cpp | `http://localhost:8080/v1` | 任意 | 完全無料 |

APIキーを設定しない場合も動作します。その場合 AI 要約は行われず、
weight からのルールベース判定にフォールバックします（その旨が埋め込みに明記されます）。

### 3. Cloudflare にデプロイ

```bash
npm install

# KV 名前空間を作り、出力された id を wrangler.toml に貼る
npx wrangler kv namespace create CONFIG

# シークレットを登録
npx wrangler secret put AI_API_KEY
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put DISCORD_PUBLIC_KEY   # Discord Developer Portal → General Information
npx wrangler secret put DISCORD_APP_ID

npm run deploy
```

### 4. スラッシュコマンドを登録する

```bash
DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... npm run register
# 開発中は DISCORD_GUILD_ID=... も指定すると即時反映されます
```

Discord Developer Portal →「Interactions Endpoint URL」に
`https://ctf-weekly-jp.<your-subdomain>.workers.dev/interactions` を設定します。

## コマンド

| コマンド | 説明 |
|---|---|
| `/ctf next` | 今週のCTF一覧をその場で表示 |
| `/ctf config show` | 現在の絞り込み条件を表示 |
| `/ctf config set <key> <value>` | 条件を変更（KVに保存） |
| `/ctf config reset` | 初期値に戻す |

### 設定できる項目

| キー | 既定値 | 説明 |
|---|---|---|
| `days` | `7` | 何日先までのCTFを対象にするか |
| `online_only` | `true` | オンライン開催のみに絞る |
| `include_restricted` | `false` | 予選通過者限定などの制限付きも含める |
| `weight_min` | `0` | 最小 weight（**未評価イベントは常に表示**） |
| `max_events` | `15` | 1回の通知の最大件数 |

## 難易度推定について

難易度は **AI による推定** であり、公式のものではありません。判定は次を根拠にしています:

- CTFtime の `weight`（イベント格付け）
- 開催形式・参加制限・開催時間・登録チーム数
- 主催者による公式説明文

**`weight: 0` は「簡単」ではなく「未評価」を意味します。**
新規開催のCTFは必ず 0 から始まるため、これを低難易度と誤読すると
初心者に上級者向けイベントを勧めてしまいます。本Botは 0 を必ず
`⚪ 未評価` として扱い、説明文に明確な初心者向け記述がない限り
`初心者向け` とは判定しません。

## 開発

```bash
nix develop          # node 22 が入った開発シェル
npm install
npm test             # 88 tests
npm run typecheck
npm run dryrun       # 実際の CTFtime を叩いて結果を標準出力に表示（Discordには投稿しない）

AI_API_KEY=xxx npm run dryrun   # AI要約つきで確認
MAX_EVENTS=1 npm run dryrun     # 遅いローカルモデル用に1件だけ
```

## 設計判断の記録

なぜこの形なのかは `docs/adr/` に残しています。

| ADR | 内容 |
|---|---|
| [0001](docs/adr/0001-cloudflare-workers-http-interactions.md) | Cloudflare Workers + HTTP Interactions で動かす |
| [0002](docs/adr/0002-openai-compatible-ai-provider.md) | AI プロバイダはベンダーではなく OpenAI 互換 URL として扱う |
| [0003](docs/adr/0003-ctftime-weight-zero-is-unrated.md) | `weight: 0` は未評価であり、初心者向けとは判定しない |
| [0004](docs/adr/0004-errors-as-values-zero-runtime-dependencies.md) | エラーは値、データは不変、実行時依存ゼロ |
| [0005](docs/adr/0005-defer-multi-guild-and-richer-persistence.md) | 複数サーバー対応は延期（再検討の条件つき） |

## 設計上の注意点

- **CTFtime は User-Agent が無いと 403 を返します。** `CTFTIME_USER_AGENT` は必須です。
- **Discord の Interaction は3秒以内に応答が必要です。** `/ctf next` は
  即座に deferred 応答を返し、実処理は `waitUntil` で継続してから元メッセージを編集します。
- **通知が無いこと自体を通知します。** 該当0件・CTFtime障害・AI障害のいずれの場合も
  必ず何かを投稿します。沈黙は「壊れている」と区別がつかないためです。
- **AI が落ちてもイベントは落としません。** 個別の失敗は weight ベースの
  自動判定にフォールバックし、その旨をフッターに明記します。
- **エラーは例外ではなく値です。** 失敗しうる関数は `Result<T, E>` を返し、
  `try/catch` は `fetch` などのプラットフォーム API を包む境界にだけ置きます。
  実行時依存はゼロで、`Result` も外部ライブラリではなく自前の40行です。

## ライセンス

MIT
