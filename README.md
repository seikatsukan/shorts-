# SNS Blocker Web

SNS などのアプリの利用を、スマホから PC サーバーに頼んで一定時間ロックする Web アプリ（スマホ向け）。
ロックをやりきるとコインが貯まり、キャラクター（スライム）が進化する。

## 起動方法

```bash
npm install
npm run dev
```

PC サーバーにつなぐ場合は、プロジェクト直下に `.env` を作って PC サーバーの URL を書く。

```
VITE_LOCK_SERVER_URL=http://192.168.x.x:8000
```

`.env` が無い（URL 未設定）の間は、**モック**（ブラウザ内の仮サーバー）で動く。

### スマホで試す

```bash
npm run dev -- --host
```

表示された `Network: http://192.168.x.x:5173/` をスマホのブラウザで開く（スマホと PC は同じ Wi-Fi に接続）。
http で開いても動くように、ID の生成などは https 専用の機能（`crypto.randomUUID` など）に頼らない作りにしている（[`src/utils.js`](src/utils.js)）。

---

## 全体の流れ

```
スマホ（このアプリ）                     PC サーバー                 保存先（未定）
 ① アプリ・時間・目的を選ぶ
 ② スタート ───── ロック依頼 ─────────▶ ロック開始
             ◀──── 開始/終了時刻 ─────
 ③ 記録を送る ──────────────────────────────────────────────▶ 保存
 ④ カウントダウン表示（PC の時刻基準）
 ⑤ 終了 → 「おめでとう！」＋コイン付与
 ⑥ まとめ画面 ◀──────────── 期間を指定して記録を取得 ─────────── 
```

- 一度始めたロックは**キャンセルできない**。そのため、スマホからは解除の依頼は送らない。
- 目的は PC サーバーには送らず、保存先にだけ送る。

---

## PC サーバーとのやりとり

実装: [`src/api.js`](src/api.js)

HTTP の API 通信。JSON を POST して、JSON で返してもらう。

### ロック開始 `POST {VITE_LOCK_SERVER_URL}/lock`

#### スマホ → PC（送る内容）

| 項目 | 型 | 内容 |
|---|---|---|
| `apps` | 配列 | ロックするアプリの一覧（1 個以上） |
| `apps[].name` | 文字列 | アプリ名（例: `"YouTube"`） |
| `apps[].minutes` | 数値 | 制限時間（分）。20 / 30 / 60、またはカスタムで入力した 1〜1440 |
| `apps[].domain` | 文字列 | **カスタムアプリの時だけ**付く。正式なドメイン（例: `"line.me"`） |

```json
{
  "apps": [
    { "name": "YouTube", "minutes": 30 },
    { "name": "LINE", "minutes": 60, "domain": "line.me" }
  ]
}
```

- デフォルトのアプリ（YouTube / TikTok / Instagram / X / Facebook / Threads）は**名前だけ**送る。ドメインなどは PC サーバーが名前から特定する。
- カスタムアプリのドメインは、`https://` や `www.`、パスを取り除いた形で送る（例: `https://www.line.me/ja/` → `line.me`）。
- 1 回のスタートで複数のアプリをまとめて送る。アプリごとに制限時間が違うこともある。

#### PC → スマホ（成功した時）

| 項目 | 型 | 内容 |
|---|---|---|
| `success` | 真偽値 | `true` |
| `serverTime` | 日時文字列 | PC サーバーの現在時刻 |
| `apps` | 配列 | **アプリごと**の開始・終了時刻 |
| `apps[].name` | 文字列 | 送られてきた `name` をそのまま返す |
| `apps[].startTime` | 日時文字列 | 開始時刻 |
| `apps[].endTime` | 日時文字列 | 終了時刻 |

```json
{
  "success": true,
  "serverTime": "2026-10-27T12:00:00.500Z",
  "apps": [
    { "name": "YouTube", "startTime": "2026-10-27T12:00:00.500Z", "endTime": "2026-10-27T12:30:00.500Z" },
    { "name": "LINE",    "startTime": "2026-10-27T12:00:00.500Z", "endTime": "2026-10-27T13:00:00.500Z" }
  ]
}
```

- 日時はすべて ISO 8601 形式（`2026-10-27T12:00:00.500Z` や `2026-10-27T21:00:00+09:00`）。
- スマホはこの時刻を元にカウントダウンを表示する。スマホの時計がずれていても PC の時刻に合わせられるよう、`serverTime` との差でずれを補正する（通信にかかった時間の半分も差し引く）。
- あるアプリの `startTime` / `endTime` が欠けていた場合でも、エラーにはしない（PC 側ではもうロックが始まっているため）。その時は `serverTime` に制限時間を足した時刻を終了時刻とする。

#### PC → スマホ（対応していないアプリがあった時）

カスタムアプリが PC サーバーで対応していない、または正式な名前・ドメインではない時に返す。
**この時はどのアプリもロックを開始しないこと。**（一部だけ始まると、スマホから取り消せないため）

```json
{
  "success": false,
  "error": "UNSUPPORTED_APP",
  "unsupportedApps": ["LINE"]
}
```

| 項目 | 内容 |
|---|---|
| `error` | `"UNSUPPORTED_APP"` 固定 |
| `unsupportedApps` | 対応していないアプリの `name`（送られてきたものをそのまま） |

- HTTP ステータスは 200 でも 4xx（400 / 422 など）でもよい。
- スマホは「対応していないか、正式な名前ではありません」と表示し、アプリ選択画面に戻る。該当アプリの名前・ドメインの修正画面が開くので、利用者は直してから送り直す。

#### PC → スマホ（その他のエラー）

```json
{ "success": false, "message": "画面に表示するエラー文" }
```

- `message` はそのまま画面に表示される。無い場合は「サーバーがロックを受け付けませんでした」。
- JSON を返さずに HTTP エラー（500 など）になった場合は「サーバーエラー (500)」と表示する。
- 15 秒以内に応答が無い時は「サーバーから応答がありません」と表示する。
- どのエラーでも、利用者は確認画面から「もう一度試す」を押せる。

### PC サーバーを作る時の注意

- **CORS**: スマホのブラウザから別のアドレスの PC へ送るので、PC サーバー側で CORS を許可する（`Access-Control-Allow-Origin`、`Content-Type` ヘッダーと `POST` / `OPTIONS` を許可）。
- **HTTPS**: Web アプリを `https://` で公開すると、`http://` の PC には送信できない（ブラウザがブロックする）。LAN 内で試す間は Web アプリも `http://` で配信する。

### モックの動き

`VITE_LOCK_SERVER_URL` が未設定の時は、1.2 秒待ってから上の形式で返す。

- デフォルトのアプリはすべて対応済みとして扱う。
- カスタムアプリは、ドメインが `line.me` / `discord.com` / `twitch.tv` / `reddit.com` / `pinterest.com` / `nicovideo.jp` 以外なら `UNSUPPORTED_APP` を返す（エラー表示の確認用）。

---

## 保存先とのやりとり

実装: [`src/storage.js`](src/storage.js)

保存先（DB・クラウドなど）は**未定**。今は端末の `localStorage` に保存するモックで動いている。
保存先が決まったら、`saveRecord` と `fetchRecords` の中身を API 通信に置き換えるだけでよい（呼び出し側は変更不要）。

### 記録を送る `saveRecord(record)`

- **いつ**: PC サーバーから成功が返ってきた時（ロック開始時）。ロックはキャンセルできないので、開始時点で確定とする。
- **単位**: ロックを 1 回スタートするごとに 1 件。複数アプリをまとめてロックした時は `apps` に並ぶ。

| 項目 | 型 | 内容 |
|---|---|---|
| `id` | 文字列 | 記録 ID（スマホで作る UUID） |
| `userId` | 文字列 | アカウント ID（下記） |
| `startedAt` | 日時文字列 | 開始日時（PC サーバーが返した開始時刻） |
| `apps` | 配列 | ロックしたアプリ |
| `apps[].name` | 文字列 | アプリ名 |
| `apps[].minutes` | 数値 | 制限時間（分） |
| `purpose` | 文字列 / `null` | 目的（「勉強」「昼寝」「スポーツ」、カスタム入力の文字）。スキップした時は `null` |

```json
{
  "id": "db88aa66-5576-4251-978a-2d7eda1fefe8",
  "userId": "b7cb565a-d045-44d3-a2cf-8870fa536611",
  "startedAt": "2026-10-27T12:58:04.576Z",
  "apps": [
    { "name": "LINE", "minutes": 30 },
    { "name": "YouTube", "minutes": 20 }
  ],
  "purpose": "勉強"
}
```

- 各アプリの終了時刻は `startedAt + minutes` で求められるので保存しない。
- **`userId` について**: ログイン中のアカウント ID（下の「アカウント（認証）」が返す `userId`）。
- 送信に失敗してもロックや画面表示は止めない（コンソールにエラーを出すだけ）。

### 記録を取得する `fetchRecords({ userId, from, to })`

まとめ画面（今週 / 今月のグラフ、カレンダー）を表示する時に呼ぶ。

| 引数 | 内容 |
|---|---|
| `userId` | このアカウントの記録だけ取得する |
| `from` | 期間の始まり（この日時を含む） |
| `to` | 期間の終わり（この日時を含まない） |

- `startedAt` が `from` 以上 `to` 未満の記録を、上の「送る記録」と同じ形の配列で返す。
- 呼ばれ方: 週（月曜 0:00〜翌週月曜 0:00）、月（1 日 0:00〜翌月 1 日 0:00）、カレンダーの表示月。いずれも端末の時間帯で区切る。
- 戻り値は `{ records: [...], demo: false }`。`demo` はモック専用で、保存済みの記録が 1 件も無い時に見た目確認用のデモデータを返したことを示す。本番の保存先では常に `false` でよい。

---

## アカウント（認証）

実装: [`src/auth.js`](src/auth.js)

認証サーバーは**未定**。今は端末の `localStorage` にアカウントを保存するモックで動いている（パスワードは SHA-256 でハッシュ化して保存）。
認証サーバーができたら、`signUp` と `logIn` の中身を API 通信に置き換えるだけでよい（呼び出し側は変更不要）。

- **いつ**: 説明ページの Step 3 で「アカウントを作成」または「ログイン」を押した時。
- **成功したら**: 返ってきた `userId` / `email` をログイン状態として端末に保存し、メイン画面へ進む。以後、保存先への記録の送信・取得にこの `userId` を使う。
- **ログアウト**: メイン画面のメニューから。端末のログイン状態を消して説明ページに戻る。

### スマホ → 認証サーバー（新規登録 / ログインとも同じ形）

```json
{
  "email": "test@example.com",
  "password": "password123"
}
```

- 新規登録の時、パスワードは 8 文字以上（スマホ側でも確認してから送る）。

### 認証サーバー → スマホ（成功）

```json
{
  "userId": "85e212bd-5eeb-42db-be42-e004749b19f6",
  "email": "test@example.com"
}
```

### 認証サーバー → スマホ（失敗）

失敗の理由を画面に表示する。モックでは次の 2 つ。

| 場面 | 表示する文 |
|---|---|
| 新規登録で、メールアドレスがもう使われている | このメールアドレスはすでに登録されています |
| ログインで、メールアドレスかパスワードが違う | メールアドレスかパスワードが違います |

通信そのものに失敗した時は「通信に失敗しました。もう一度お試しください」と表示する。

---

## JSON の例（場面ごと）

日時は分かりやすいように日本時間（`+09:00`）で書いている。UTC（`Z`）で書いてもよい。

### 例 1: デフォルトのアプリだけをロック（目的あり）

YouTube を 30 分、TikTok を 20 分、目的「勉強」でスタートした場合。

**① スマホ → PC サーバー**（`POST /lock`）

```json
{
  "apps": [
    { "name": "YouTube", "minutes": 30 },
    { "name": "TikTok", "minutes": 20 }
  ]
}
```

**② PC サーバー → スマホ**（成功）

```json
{
  "success": true,
  "serverTime": "2026-10-27T21:00:00.500+09:00",
  "apps": [
    { "name": "YouTube", "startTime": "2026-10-27T21:00:00.500+09:00", "endTime": "2026-10-27T21:30:00.500+09:00" },
    { "name": "TikTok",  "startTime": "2026-10-27T21:00:00.500+09:00", "endTime": "2026-10-27T21:20:00.500+09:00" }
  ]
}
```

**③ スマホ → 保存先**（記録を送る）

```json
{
  "id": "6f1c2a9e-3b7d-4e2a-9c41-0a8f5d2b7e10",
  "userId": "b7cb565a-d045-44d3-a2cf-8870fa536611",
  "startedAt": "2026-10-27T21:00:00.500+09:00",
  "apps": [
    { "name": "YouTube", "minutes": 30 },
    { "name": "TikTok", "minutes": 20 }
  ],
  "purpose": "勉強"
}
```

### 例 2: カスタムのアプリを含めてロック（目的はスキップ）

Instagram を 60 分、カスタムで追加した LINE（`line.me`）を 45 分、目的なしでスタートした場合。

**① スマホ → PC サーバー**（カスタムの LINE だけ `domain` が付く）

```json
{
  "apps": [
    { "name": "Instagram", "minutes": 60 },
    { "name": "LINE", "minutes": 45, "domain": "line.me" }
  ]
}
```

**② PC サーバー → スマホ**（成功）

```json
{
  "success": true,
  "serverTime": "2026-10-28T13:15:02.000+09:00",
  "apps": [
    { "name": "Instagram", "startTime": "2026-10-28T13:15:02.000+09:00", "endTime": "2026-10-28T14:15:02.000+09:00" },
    { "name": "LINE",      "startTime": "2026-10-28T13:15:02.000+09:00", "endTime": "2026-10-28T14:00:02.000+09:00" }
  ]
}
```

**③ スマホ → 保存先**（目的をスキップしたので `purpose` は `null`）

```json
{
  "id": "0d3e7b52-8a14-4c6f-b2e9-5f71c0a4d983",
  "userId": "b7cb565a-d045-44d3-a2cf-8870fa536611",
  "startedAt": "2026-10-28T13:15:02.000+09:00",
  "apps": [
    { "name": "Instagram", "minutes": 60 },
    { "name": "LINE", "minutes": 45 }
  ],
  "purpose": null
}
```

### 例 3: カスタムのアプリが PC サーバーで対応していない

カスタムで「Hoge」（`hoge-sns.com`）を追加し、YouTube と一緒に送った場合。

**① スマホ → PC サーバー**

```json
{
  "apps": [
    { "name": "YouTube", "minutes": 20 },
    { "name": "Hoge", "minutes": 30, "domain": "hoge-sns.com" }
  ]
}
```

**② PC サーバー → スマホ**（対応していない。YouTube もロックしない）

```json
{
  "success": false,
  "error": "UNSUPPORTED_APP",
  "unsupportedApps": ["Hoge"]
}
```

→ 保存先には何も送らない。スマホはアプリ選択画面に戻り、「Hoge」の名前・ドメインの修正画面を開く。

### 例 4: PC サーバーでその他のエラー

**② PC サーバー → スマホ**

```json
{
  "success": false,
  "message": "PCのブロック設定を書き込めませんでした"
}
```

→ 保存先には何も送らない。スマホは `message` を表示し、「もう一度試す」を押せるようにする。

### 例 5: 保存先から記録を取得（まとめ画面）

10 月 26 日（月）〜 11 月 1 日（日）の「今週」を表示する場合。

**スマホ → 保存先**（取得の条件）

```json
{
  "userId": "b7cb565a-d045-44d3-a2cf-8870fa536611",
  "from": "2026-10-26T00:00:00.000+09:00",
  "to": "2026-11-02T00:00:00.000+09:00"
}
```

`from` は含み、`to` は含まない（月曜 0:00 から翌週月曜 0:00 の手前まで）。

**保存先 → スマホ**（`startedAt` が期間内の記録を、送った時と同じ形で返す）

```json
{
  "records": [
    {
      "id": "6f1c2a9e-3b7d-4e2a-9c41-0a8f5d2b7e10",
      "userId": "b7cb565a-d045-44d3-a2cf-8870fa536611",
      "startedAt": "2026-10-27T21:00:00.500+09:00",
      "apps": [
        { "name": "YouTube", "minutes": 30 },
        { "name": "TikTok", "minutes": 20 }
      ],
      "purpose": "勉強"
    },
    {
      "id": "0d3e7b52-8a14-4c6f-b2e9-5f71c0a4d983",
      "userId": "b7cb565a-d045-44d3-a2cf-8870fa536611",
      "startedAt": "2026-10-28T13:15:02.000+09:00",
      "apps": [
        { "name": "Instagram", "minutes": 60 },
        { "name": "LINE", "minutes": 45 }
      ],
      "purpose": null
    }
  ],
  "demo": false
}
```

記録が無い期間は `"records": []` を返す。

この 2 件から、まとめ画面には次のように表示される。

- 今週の合計: 2 時間 35 分
- アプリ別: Instagram 60 分 / LINE 45 分 / YouTube 30 分 / TikTok 20 分
- カレンダー: 27 日（YouTube・TikTok）、28 日（Instagram・LINE）に印が付き、タップすると各アプリの時間帯と目的が出る

---

## アプリ内のルール

| 項目 | ルール | 場所 |
|---|---|---|
| コイン | **10 分ごとに 1 枚**。1 回のスタートで複数アプリをロックした時は、**一番長い制限時間**で計算する（例: 30 分 + 60 分 → 6 枚）。そのスタートのロックが全部終わった時に付与する | [`src/data/apps.js`](src/data/apps.js) `coinsFor` / [`AppContext.jsx`](src/store/AppContext.jsx) |
| 進化 | 累計コイン **10 / 30 / 60 / 100 枚**で進化（段階 0〜4） | `src/data/apps.js` `EVOLUTION_THRESHOLDS` |
| キャラの大きさ | 段階ごとに大きくなる（`STAGE_SCALES`）。Blender のモデルは `.glb` で `public/models/slime.glb` に置き、`MODEL_URL` を `'/models/slime.glb'` にすると差し替わる | [`src/components/Slime.jsx`](src/components/Slime.jsx) |
| 初めての利用者 | ログインしていない時は `/` で説明ページ（PCの準備 → 使い方 → アカウント）を表示する。ログイン中はメイン画面へ。ログインしていないのにメイン画面などを開くと `/` に戻す | [`src/App.jsx`](src/App.jsx) `Entry` / `RequireAccount` |
| アカウントごとのデータ | コイン・ロック中のアプリ・カスタムアプリはアカウントごとに分けて端末に保存する。別のアカウントでログインしても混ざらない。ログアウト中もロックは PC 側で続き、次にログインした時に終了処理（「おめでとう」とコイン付与）をする | [`src/store/AppContext.jsx`](src/store/AppContext.jsx) |
| 説明の省略 | 一度説明を見た端末（ログアウト後など）は、説明を飛ばして Step 3 のログイン画面から始める（「戻る」で説明も見られる）。初めての端末でも、右上の「ログイン」で説明を飛ばせる（機種変更などでアカウントを持っている人向け） | [`src/pages/Onboarding.jsx`](src/pages/Onboarding.jsx) / `AppContext.jsx` の `tutorialSeen` |
| スキップ | スキップできるのは目的の選択だけ | [`src/pages/PurposeSelect.jsx`](src/pages/PurposeSelect.jsx) |
| ロック中のアプリ | すでにロック中のアプリは、ロック追加で選べない | [`src/pages/AppSelect.jsx`](src/pages/AppSelect.jsx) |

## ファイル構成

```
src/
  api.js                 PC サーバーとの通信（＋モック）
  storage.js             保存先とのやりとり（今はモック）
  auth.js                アカウント作成・ログイン（今はモック）
  utils.js               共通の小さな関数（http でも使える ID 生成）
  store/AppContext.jsx   アプリ全体の状態（コイン・ロック中のアプリ・入力途中の内容など）
  data/apps.js           アプリ一覧・目的・コイン/進化のルール・表示用の書式
  components/            共通部品（アイコン・ポップアップ・スライム）
  pages/
    Onboarding.jsx       説明ページ（① PCの準備 → ② 使い方 → ③ アカウント作成 / ログイン）
    Home.jsx             メイン画面
    AppSelect.jsx        ① 制限するアプリと時間
    PurposeSelect.jsx    ② 目的（スキップ可）
    Confirm.jsx          ③ 最終確認 → PC サーバーへ送信
    Stats.jsx            まとめ（今週 / 今月のグラフ・カレンダー）
```
