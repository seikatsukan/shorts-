// PCサーバーとの通信（HTTP の API 通信。JSON を POST してレスポンスの JSON を受け取る）
//
// .env に VITE_LOCK_SERVER_URL=http://192.168.x.x:8000 のように書くと実際のサーバーへ送信する。
// 未設定の場合はモック（サーバーの代わりにブラウザ内で応答を作る）で動く。
//
// 送信 JSON（POST {SERVER_URL}/lock）
//   デフォルトのアプリは名前と制限時間（分）だけ。PCサーバーが名前からドメインなどを特定する。
//   カスタムのアプリだけ domain も付ける。
//   {
//     "apps": [
//       { "name": "YouTube", "minutes": 30 },
//       { "name": "LINE", "minutes": 60, "domain": "line.me" }
//     ]
//   }
//
// 成功時のレスポンス JSON（アプリごとの時刻を元にカウントダウンを表示する）
//   {
//     "success": true,
//     "serverTime": "2026-10-27T12:00:00.500Z",   // PCサーバーの現在時刻
//     "apps": [
//       { "name": "YouTube", "startTime": "2026-10-27T12:00:00.500Z", "endTime": "2026-10-27T12:30:00.500Z" },
//       { "name": "LINE",    "startTime": "2026-10-27T12:00:00.500Z", "endTime": "2026-10-27T13:00:00.500Z" }
//     ]
//   }
//
// 対応していないアプリがあった時のレスポンス JSON（HTTP 200 でも 4xx でもよい）
//   {
//     "success": false,
//     "error": "UNSUPPORTED_APP",
//     "unsupportedApps": ["LINE"]   // 送信した name をそのまま返す
//   }

const SERVER_URL = import.meta.env.VITE_LOCK_SERVER_URL;
const IS_MOCK = !SERVER_URL;

// PCサーバーが対応していないアプリがあった時のエラー
export class UnsupportedAppError extends Error {
  constructor(names) {
    super(`${names.join('、')} は対応していないか、正式な名前ではありません`);
    this.names = names;
  }
}

export async function startLock({ apps }) {
  const body = {
    apps: apps.map(({ name, minutes, domain }) => (domain ? { name, minutes, domain } : { name, minutes })),
  };

  const sentAt = Date.now();
  const res = IS_MOCK ? await mockServer(body) : await postJson(`${SERVER_URL}/lock`, body);
  const receivedAt = Date.now();

  if (res?.error === 'UNSUPPORTED_APP') {
    throw new UnsupportedAppError(res.unsupportedApps ?? []);
  }
  if (!res?.success) throw new Error(res?.message || 'サーバーがロックを受け付けませんでした');

  const serverTime = Date.parse(res.serverTime);
  if (Number.isNaN(serverTime)) throw new Error('サーバーの応答に時刻が含まれていません');

  const locks = body.apps.map((app) => {
    const perApp = res.apps?.find((a) => a.name === app.name);
    const startAt = Date.parse(perApp?.startTime);
    const endAt = Date.parse(perApp?.endTime);
    if (Number.isNaN(startAt) || Number.isNaN(endAt)) {
      // PC側ではもうロックが始まっているので、エラーにはせずサーバー時刻＋制限時間で表示する
      console.warn(`${app.name} の開始・終了時刻が返ってきませんでした`);
      return { name: app.name, minutes: app.minutes, startAt: serverTime, endAt: serverTime + app.minutes * 60_000 };
    }
    return { name: app.name, minutes: app.minutes, startAt, endAt };
  });

  return {
    // 端末とPCサーバーの時計のずれ（通信時間の半分を補正）。カウントダウンはサーバー時刻基準で行う
    clockOffset: serverTime - (sentAt + receivedAt) / 2,
    startAt: Math.min(...locks.map((l) => l.startAt)),
    locks,
  };
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // エラー時も JSON（UNSUPPORTED_APP など）が返ってくればそれを使う
    const json = await r.json().catch(() => null);
    if (!r.ok && !json?.error) throw new Error(`サーバーエラー (${r.status})`);
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('サーバーから応答がありません');
    if (e instanceof TypeError) throw new Error('サーバーに接続できません');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// モック：デフォルトのアプリは対応済み。カスタムはこのドメイン以外を「対応していない」と返す
const MOCK_SUPPORTED_DOMAINS = ['line.me', 'discord.com', 'twitch.tv', 'reddit.com', 'pinterest.com', 'nicovideo.jp'];

function mockServer(body) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const unsupported = body.apps.filter((a) => a.domain && !MOCK_SUPPORTED_DOMAINS.includes(a.domain));
      if (unsupported.length > 0) {
        resolve({ success: false, error: 'UNSUPPORTED_APP', unsupportedApps: unsupported.map((a) => a.name) });
        return;
      }
      const now = Date.now();
      const iso = (t) => new Date(t).toISOString();
      resolve({
        success: true,
        serverTime: iso(now),
        apps: body.apps.map((a) => ({ name: a.name, startTime: iso(now), endTime: iso(now + a.minutes * 60_000) })),
      });
    }, 1200);
  });
}
