// サーバー（cf-rules-api）との通信
//
// 取り決めは seikatsukan/api-spec の openapi.yaml（v0.2.0 の案）。バックエンドは変えられないので、こちらが合わせる。
// - API は画面と同じオリジンの /api 以下。ログインは /auth 以下で付く Cookie（session）で続く
// - .env に VITE_API_BASE=/api と書くと本物のサーバーへ送る（手元では vite.config.js のプロキシで流す）
//   サーバーが /api を付けずに置いた時は VITE_API_BASE=/ と書く（/rules などへ送る）
//   未設定の場合はモック（サーバーの代わりにブラウザ内で仕様どおりの応答を作る）で動く
// - エラーは常に { code, message, details }。message はそのまま画面に出せる日本語
//
// ロックのしかた（アプリごとに集中タイマーのルールを1つ持ち、使い回す）
//   1. GET /options・GET /rules・GET /status で、アプリID・今あるルール・サーバーの現在時刻を取る
//   2. まだルールが無いアプリだけ POST /rules で作る（作るのはいつもすぐ反映。ルールは消さずに次も使う）
//      消すのは「緩める変更」で翌朝の承認が要るため、毎回作って消す形にはしない
//   3. アプリごとに POST /rules/{ruleId}/timer で、選んだ分数のタイマーを始める。終わる時刻は timerEndsAt
//   動いているタイマーをもう一度始めた時の動きは仕様に無いので、ロック中のアプリは始めない（何も始めずにエラー）
//
// アプリの指定（target は sites）
//   サーバーのカタログ（/options）にあるアプリは ID で、無いアプリ（Facebook・Threads・カスタム）はドメインで送る
//   { "type": "sites", "apps": ["youtube"], "domains": [], "categoryIds": [] }
//   { "type": "sites", "apps": [], "domains": ["line.me"], "categoryIds": [] }

import { DEFAULT_APPS } from './data/apps';
import { UNLOCK_SETTINGS, formatDays, formatTimeRange } from './fixed';

const IS_MOCK = !import.meta.env.VITE_API_BASE;
const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, '') ?? '';

// サーバーが返したエラー
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `サーバーエラー (${status})`);
    this.status = status;
    this.code = body?.code ?? null;
    this.details = body?.details ?? null;
  }
}

// サーバーがカスタムアプリのドメインを受け付けなかった時のエラー
export class UnsupportedAppError extends Error {
  constructor(names) {
    super(`${names.join('、')} のドメインをサーバーが受け付けませんでした`);
    this.names = names;
  }
}

// アプリを指定してロックを始める。apps: [{ name, minutes, domain? }]（domain はカスタムアプリだけ）
// 一部のアプリだけ始められなかった時は、始められた分を locks に、残りを failed に入れて返す
// （始めたタイマーは止められないので、全部を失敗にはしない）。1つも始められなかった時は例外
export async function startLock({ apps }) {
  const [options, rules, clock] = await Promise.all([
    request('GET', '/options'),
    request('GET', '/rules'),
    fetchClock(),
  ]);

  const plans = apps.map((app) => {
    const target = targetFor(app, options);
    const rule = rules.find((r) => r.schedule.type === 'timer' && sameTarget(r.target, target)) ?? null;
    return { app, target, rule };
  });

  // ロック中のアプリがあれば何も始めない（画面でも選べないようにしているが、別の端末で始めた時のため）
  const running = plans.filter((p) => p.rule?.timerEndsAt && Date.parse(p.rule.timerEndsAt) > clock.serverNow);
  if (running.length > 0) {
    throw new Error(`${running.map((p) => p.app.name).join('、')} はすでにロック中です`);
  }

  // ルールがまだ無いアプリは作る。オフになっているルールはオンにする（どちらもすぐ反映）
  const unsupported = [];
  for (const plan of plans) {
    try {
      if (!plan.rule) {
        const res = await request('POST', '/rules', {
          name: plan.app.name,
          schedule: { type: 'timer', durationMinutes: plan.app.minutes },
          target: plan.target,
        });
        plan.rule = res.rule;
      } else if (!plan.rule.enabled) {
        const res = await request('PATCH', `/rules/${plan.rule.id}`, { enabled: true });
        plan.rule = res.rule;
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && plan.app.domain) unsupported.push(plan.app.name);
      else throw e;
    }
  }
  if (unsupported.length > 0) throw new UnsupportedAppError(unsupported);

  // タイマーを始める（1つずつ。失敗したものは飛ばして続ける）
  const locks = [];
  const failed = [];
  for (const { app, rule } of plans) {
    try {
      const started = await request('POST', `/rules/${rule.id}/timer`, { durationMinutes: app.minutes });
      const endAt = Date.parse(started.timerEndsAt);
      if (Number.isNaN(endAt)) throw new Error('サーバーの応答に終わる時刻が含まれていません');
      locks.push({ name: app.name, minutes: app.minutes, ruleId: rule.id, startAt: endAt - app.minutes * 60_000, endAt });
    } catch (e) {
      failed.push({ name: app.name, minutes: app.minutes, message: e.message });
    }
  }
  if (locks.length === 0) throw new Error(failed[0].message);

  return {
    clockOffset: clock.offset, // サーバー時刻 - 端末時刻。カウントダウンはサーバー時刻基準で行う
    startAt: Math.min(...locks.map((l) => l.startAt)),
    locks,
    failed,
  };
}

// ---- 固定時間で自動ロック ----
//
// 予定（曜日・時間帯・アプリ）ごとに時間帯（window）のルールを1つ作る。作るのはいつもすぐ反映
//   { "name": "火 2:00〜3:00", "schedule": { "type": "window", "start": "02:00", "end": "03:00", "days": [2] },
//     "target": { "type": "sites", "apps": ["youtube"], "domains": [], "categoryIds": [] } }
// 一時解除の決まり（長さ・1日の回数・待ち時間）は PATCH /settings で設定する。
// 今の設定より緩いと反映待ちになり、翌朝以降に承認するまで前の設定のまま（長さ・回数は今の設定で動く）
//
// 途中で失敗した時は、終わった分を progress に入れて投げる。もう一度呼ぶ時に渡すと、終わった分は飛ばす
// （ルールを消すのは翌朝の承認が要るので、同じ予定のルールを二重に作らないように）

// 予定を始める。entries: [{ id, days, start, end, apps: [{ name, domain? }] }]
// 戻り値 { settings: { applyMode, pendingChange, unlockMinutes }, rules: { 予定のid: ルールID } }
export async function setupFixedSchedule(entries, progress = {}) {
  const done = { settings: progress.settings ?? null, rules: { ...progress.rules } };
  try {
    const options = await request('GET', '/options');
    if (!done.settings) {
      const res = await request('PATCH', '/settings', { unlock: UNLOCK_SETTINGS });
      done.settings = {
        applyMode: res.applyMode,
        pendingChange: res.pendingChange ? pendingOf(res.pendingChange) : null,
        unlockMinutes: res.settings?.unlock?.unlockMinutes ?? UNLOCK_SETTINGS.unlockMinutes,
      };
    }
    for (const entry of entries) {
      if (done.rules[entry.id]) continue;
      const targets = entry.apps.map((app) => targetFor(app, options));
      const res = await request('POST', '/rules', {
        name: `${formatDays(entry.days)} ${formatTimeRange(entry.start, entry.end)}`.slice(0, 50),
        schedule: { type: 'window', start: entry.start, end: entry.end, days: entry.days },
        target: {
          type: 'sites',
          apps: [...new Set(targets.flatMap((t) => t.apps))],
          domains: [...new Set(targets.flatMap((t) => t.domains))],
          categoryIds: [],
        },
      });
      done.rules[entry.id] = res.rule.id;
    }
    return done;
  } catch (e) {
    e.progress = done;
    throw e;
  }
}

// 一時解除を申請する（全部のルール）。申請した時点でサーバーの今日の回数を1回使う
// 戻り値 { id, requestedAt, startsAt, endsAt }（ミリ秒）。待ち時間がある時は startsAt まではブロックのまま
export async function requestUnlock() {
  const u = await request('POST', '/unlocks', {});
  return { id: u.id, requestedAt: Date.parse(u.requestedAt), startsAt: Date.parse(u.startsAt), endsAt: Date.parse(u.endsAt) };
}

// 予定のルールを消す（キャンセル）。オンのルールを消すのは「緩める変更」なので反映待ちになる
// 戻り値: 反映待ちの変更 [{ id, ruleId, approvableFrom, expiresAt }]
export async function cancelFixedSchedule(ruleIds, progress = []) {
  const pending = [...progress];
  try {
    for (const ruleId of ruleIds) {
      if (pending.some((p) => p.ruleId === ruleId)) continue;
      const res = await request('DELETE', `/rules/${ruleId}`);
      pending.push(res.pendingChange ? pendingOf(res.pendingChange) : { id: null, ruleId, approvableFrom: 0, expiresAt: Infinity });
    }
    return pending;
  } catch (e) {
    e.progress = pending;
    throw e;
  }
}

// 反映待ちの変更の一覧（期限切れは含まない）
export async function fetchPendingChanges() {
  return (await request('GET', '/pending-changes')).map(pendingOf);
}

// 反映待ちの変更を承認して反映する（approvableFrom より前は 409 NOT_APPROVABLE_YET）
export async function approvePendingChange(id) {
  return request('POST', `/pending-changes/${id}/approve`);
}

const pendingOf = (p) => ({
  id: p.id,
  ruleId: p.subject?.type === 'rule' ? p.subject.ruleId : null,
  approvableFrom: Date.parse(p.approvableFrom),
  expiresAt: Date.parse(p.expiresAt),
});

// アプリをサーバーの target にする
function targetFor(app, options) {
  const lower = app.name.toLowerCase();
  const appId = app.domain
    ? null
    : Object.keys(options.apps).find((id) => options.apps[id].displayName.toLowerCase() === lower);
  if (appId) return { type: 'sites', apps: [appId], domains: [], categoryIds: [] };
  const domain = app.domain ?? DEFAULT_APPS.find((a) => a.name === app.name)?.domain;
  if (!domain) throw new Error(`${app.name} のドメインが分かりません`);
  return { type: 'sites', apps: [], domains: [domain], categoryIds: [] };
}

const sortedJoin = (list) => [...(list ?? [])].sort().join(',');
const sameTarget = (a, b) =>
  a.type === b.type &&
  sortedJoin(a.apps) === sortedJoin(b.apps) &&
  sortedJoin(a.domains) === sortedJoin(b.domains) &&
  sortedJoin(a.categoryIds) === sortedJoin(b.categoryIds);

// サーバーの現在時刻（GET /status の now）と、端末の時計とのずれ（通信時間の半分を補正）
async function fetchClock() {
  const sentAt = Date.now();
  const status = await request('GET', '/status');
  const receivedAt = Date.now();
  const serverNow = Date.parse(status.now);
  if (Number.isNaN(serverNow)) throw new Error('サーバーの応答に時刻が含まれていません');
  return { serverNow, offset: serverNow - (sentAt + receivedAt) / 2 };
}

// ---- Cloudflare との連携 ----
// ロックのルールはユーザー自身の Cloudflare に書き込むので、使う前に連携と初期設定が要る
//   1. POST /cloudflare/connect → 返ってきた url（Cloudflare の認可画面）へ画面ごと移動する
//   2. 許可するとサーバーの /cloudflare/callback を通ってアプリに戻る。失敗した時は ?cloudflareError=<reason> が付く
//   3. POST /cloudflare/setup で初期設定（何度呼んでもよい）。manualSteps はユーザーが手でやること（証明書など）
// 連携していない時、ルールを作る・タイマー・一時解除などは CLOUDFLARE_NOT_CONNECTED（409）になる。
// その時は CLOUDFLARE_DISCONNECTED_EVENT を出し、連携の画面へ戻す（useCloudflare.js）

export const CLOUDFLARE_DISCONNECTED_EVENT = 'sns-blocker:cloudflare-disconnected';

// 連携と初期設定の状態 { connected, accountName, setup: { tlsDecryptEnabled, gatewayProxyEnabled, manualSteps } | null }
export const fetchCloudflare = () => request('GET', '/cloudflare');

// Cloudflare の認可画面へ移動する
export async function connectCloudflare() {
  const { url } = await request('POST', '/cloudflare/connect');
  window.location.assign(url);
}

// 初期設定をする。{ tlsDecryptEnabled, gatewayProxyEnabled, manualSteps }（true / false / null は未確認）
export const setupCloudflare = () => request('POST', '/cloudflare/setup');

async function request(method, path, body) {
  try {
    return await send(method, path, body);
  } catch (e) {
    if (e.code === 'CLOUDFLARE_NOT_CONNECTED') window.dispatchEvent(new Event(CLOUDFLARE_DISCONNECTED_EVENT));
    throw e;
  }
}

async function send(method, path, body) {
  if (IS_MOCK) return mockRequest(method, path, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const r = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin', // ログインの Cookie を送る
      signal: controller.signal,
    });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, json);
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('サーバーから応答がありません');
    if (e instanceof TypeError) throw new Error('サーバーに接続できません');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---- モック（openapi.yaml の決まりどおりに、使うエンドポイントだけ応答を作る）----
// ルールはブラウザに保存する（再読み込みしても、動いているタイマーが残るように）
// 開発用: localStorage の sns-blocker:mock-api-fail に ["Facebook"] のようにルール名を入れると、
// そのルールのタイマーを始める時に 502 を返す（一部だけ始められなかった時の画面を試すため）
// 開発用: localStorage の sns-blocker:mock-cloudflare-error に "denied" のように reason を入れると、
// Cloudflare の連携が失敗して ?cloudflareError=denied 付きで戻ってくる（連携できなかった時の画面を試すため）

const MOCK_KEY = 'sns-blocker:mock-api';
const MOCK_FAIL_KEY = 'sns-blocker:mock-api-fail';
const MOCK_CF_ERROR_KEY = 'sns-blocker:mock-cloudflare-error';
const MOCK_DELAY = 250; // 1回の通信にかかる時間（ms）

// cf-rules の get_catalog() と同じアプリ
const MOCK_CATALOG = {
  x: { displayName: 'X', domains: ['x.com', 'twitter.com', 'twimg.com', 't.co'] },
  youtube: {
    displayName: 'YouTube',
    domains: ['youtube.com', 'youtu.be', 'ytimg.com', 'youtube-nocookie.com', 'googlevideo.com'],
  },
  instagram: { displayName: 'Instagram', domains: ['instagram.com', 'cdninstagram.com'] },
  tiktok: { displayName: 'TikTok', domains: ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com'] },
  line: { displayName: 'LINE', domains: ['line.me', 'line-apps.com', 'line-scdn.net'] },
};
const MOCK_DOMAIN = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/; // cf-rules と同じドメインの形
// 一時解除の設定の初期値（仕様書の例と同じ。実際の初期値は未確認）。これより緩い設定は反映待ちになる
const MOCK_EMPTY = {
  rules: [],
  settings: { unlock: { unlockMinutes: 10, unlocksPerDay: 2, delayedUnlockMinutes: 5 }, approvalExpiryHours: 24 },
  pending: [],
  unlocks: [],
  // Cloudflare の連携。setup は初期設定をした結果（していなければ null）
  cloudflare: { connected: false, accountName: null, setup: null },
};
// cf-rules の ensure_setup が返す「手でやる手順」と同じ
const MOCK_MANUAL_STEPS = [
  'スマホに Cloudflare のルート証明書をインストールして信頼する',
  'スマホの WARP（1.1.1.1 アプリ）でこの Zero Trust 組織にログインする',
];

// 開発用（モックの時だけ）: 反映待ちの変更を、今すぐ承認できるようにする（翌朝まで待たずに試すため）
export function devMakeApprovable() {
  if (!IS_MOCK) return;
  const db = loadMock();
  db.pending.forEach((p) => (p.approvableFrom = isoWithOffset(Date.now() - 60_000)));
  saveMock(db);
}

const loadMock = () => {
  try {
    return { ...MOCK_EMPTY, ...JSON.parse(localStorage.getItem(MOCK_KEY)) };
  } catch {
    return { ...MOCK_EMPTY };
  }
};
const saveMock = (db) => {
  try {
    localStorage.setItem(MOCK_KEY, JSON.stringify(db));
  } catch {
    // 保存できなくても動作は続ける
  }
};

// 端末のタイムゾーン付きの時刻（例: 2026-10-30T21:30:00+09:00）
function isoWithOffset(t) {
  const offset = -new Date(t).getTimezoneOffset();
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(t + offset * 60_000).toISOString().slice(0, 19);
  return `${local}${offset >= 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)}`;
}

const fail = (status, code, message, details = null) => {
  throw new ApiError(status, { code, message, details });
};

function mockRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(mockHandle(method, path, body));
      } catch (e) {
        reject(e);
      }
    }, MOCK_DELAY);
  });
}

function mockHandle(method, path, body) {
  const db = loadMock();
  const now = Date.now();
  const running = (r) => r.timerEndsAt && Date.parse(r.timerEndsAt) > now;
  const findRule = (id) => db.rules.find((r) => r.id === id) ?? fail(404, 'NOT_FOUND', '見つかりません', { ruleId: id });
  // 期限を過ぎた反映待ちは消える
  db.pending = db.pending.filter((p) => Date.parse(p.expiresAt) > now);
  // 翌朝（05:00。仕様では時刻は未決定）から承認できる反映待ちを作る
  const makePending = (subject, action, before, after) => {
    const d = new Date(now);
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 5).getTime();
    const p = {
      id: `pc_${Math.random().toString(16).slice(2, 8)}`,
      subject,
      action,
      before,
      after,
      requestedAt: isoWithOffset(now),
      approvableFrom: isoWithOffset(from),
      expiresAt: isoWithOffset(from + db.settings.approvalExpiryHours * 3_600_000),
    };
    // 1つのルール（と設定）につき反映待ちは1件。前のものは置き換える
    db.pending = [...db.pending.filter((q) => JSON.stringify(q.subject) !== JSON.stringify(subject)), p];
    return p;
  };
  const currentUnlock = () => db.unlocks.find((u) => !u.cancelledAt && Date.parse(u.endsAt) > now) ?? null;
  const unlockView = (u) => ({
    ...u,
    status: u.cancelledAt ? 'cancelled' : Date.parse(u.startsAt) > now ? 'waiting' : Date.parse(u.endsAt) > now ? 'active' : 'ended',
  });

  // Cloudflare の連携
  const cf = db.cloudflare;
  if (method === 'GET' && path === '/cloudflare') {
    const setup = cf.setup ?? { tlsDecryptEnabled: false, gatewayProxyEnabled: false, manualSteps: MOCK_MANUAL_STEPS };
    return { connected: cf.connected, accountName: cf.accountName, setup: cf.connected ? setup : null };
  }
  if (method === 'POST' && path === '/cloudflare/connect') {
    // 本物は Cloudflare の画面を通って戻ってくる。モックはその場で許可したことにしてアプリに戻る
    const reason = localStorage.getItem(MOCK_CF_ERROR_KEY);
    if (reason) return { url: `/?cloudflareError=${encodeURIComponent(reason)}` };
    db.cloudflare = { connected: true, accountName: "alice@example.com's Account", setup: null };
    saveMock(db);
    return { url: '/' };
  }
  const notConnected = () => fail(409, 'CLOUDFLARE_NOT_CONNECTED', 'Cloudflare と連携してください');
  if (method === 'POST' && path === '/cloudflare/setup') {
    if (!cf.connected) notConnected();
    db.cloudflare = { ...cf, setup: { tlsDecryptEnabled: true, gatewayProxyEnabled: true, manualSteps: MOCK_MANUAL_STEPS } };
    saveMock(db);
    return db.cloudflare.setup;
  }
  // 仕様で CLOUDFLARE_NOT_CONNECTED を返すもの（Cloudflare に書き込む操作）
  const writesCloudflare =
    (method === 'POST' && ['/rules', '/unlocks'].includes(path)) ||
    (['PATCH', 'DELETE'].includes(method) && /^\/rules\/[^/]+$/.test(path)) ||
    (method === 'POST' && /^\/rules\/[^/]+\/timer$/.test(path)) ||
    (method === 'POST' && /^\/pending-changes\/[^/]+\/approve$/.test(path));
  if (writesCloudflare && !cf.connected) notConnected();

  if (method === 'GET' && path === '/options') {
    return { apps: MOCK_CATALOG, categories: {}, webPushPublicKey: null };
  }
  if (method === 'GET' && path === '/rules') {
    saveMock(db);
    return db.rules.map((r) => ({ ...r, pendingChange: db.pending.find((p) => p.subject.ruleId === r.id) ?? null }));
  }
  if (method === 'GET' && path === '/settings') {
    return { ...db.settings, pendingChange: db.pending.find((p) => p.subject.type === 'settings') ?? null };
  }
  if (method === 'PATCH' && path === '/settings') {
    // classify_unlock_settings_change と同じ判定（長さ・回数が同じか少なく、待ち時間が同じか長いならすぐ）
    const o = db.settings.unlock;
    const n = body.unlock;
    const stricter =
      n.unlockMinutes <= o.unlockMinutes &&
      n.unlocksPerDay <= o.unlocksPerDay &&
      (n.delayedUnlockMinutes ?? 0) >= (o.delayedUnlockMinutes ?? 0);
    if (stricter) {
      db.settings = { ...db.settings, unlock: n };
      db.pending = db.pending.filter((p) => p.subject.type !== 'settings');
      saveMock(db);
      return { applyMode: 'immediate', settings: { ...db.settings, pendingChange: null }, pendingChange: null };
    }
    const p = makePending({ type: 'settings' }, 'update', { unlock: o }, { unlock: n });
    saveMock(db);
    return { applyMode: 'pending', settings: { ...db.settings, pendingChange: p }, pendingChange: p };
  }
  if (method === 'GET' && path === '/pending-changes') {
    saveMock(db);
    return db.pending;
  }
  const approveMatch = path.match(/^\/pending-changes\/([^/]+)\/approve$/);
  if (approveMatch && method === 'POST') {
    const p = db.pending.find((q) => q.id === approveMatch[1]) ??
      fail(410, 'PENDING_CHANGE_EXPIRED', '承認の期限を過ぎたため、この変更は取り消されました');
    if (Date.parse(p.approvableFrom) > now) {
      fail(409, 'NOT_APPROVABLE_YET', 'この変更は明日の朝から承認できます', { approvableFrom: p.approvableFrom });
    }
    db.pending = db.pending.filter((q) => q !== p);
    if (p.subject.type === 'settings') db.settings = { ...db.settings, ...p.after };
    else if (p.action === 'delete') db.rules = db.rules.filter((r) => r.id !== p.subject.ruleId);
    saveMock(db);
    return { applyMode: 'immediate', rule: null, settings: null, pendingChange: null };
  }
  if (method === 'GET' && path === '/unlocks') {
    const today = new Date(now).setHours(0, 0, 0, 0);
    const used = db.unlocks.filter((u) => Date.parse(u.requestedAt) >= today).length;
    const perDay = db.settings.unlock.unlocksPerDay;
    const current = currentUnlock();
    return {
      unlocksPerDay: perDay,
      usedToday: used,
      remainingToday: Math.max(0, perDay - used),
      resetAt: isoWithOffset(today + 86_400_000),
      current: current && unlockView(current),
    };
  }
  if (method === 'POST' && path === '/unlocks') {
    if (currentUnlock()) fail(409, 'UNLOCK_IN_PROGRESS', '一時解除が進行中です');
    const today = new Date(now).setHours(0, 0, 0, 0);
    const used = db.unlocks.filter((u) => Date.parse(u.requestedAt) >= today).length;
    if (used >= db.settings.unlock.unlocksPerDay) {
      fail(429, 'UNLOCK_LIMIT_REACHED', '今日の一時解除の回数を使い切りました', {
        resetAt: isoWithOffset(today + 86_400_000),
        unlocksPerDay: db.settings.unlock.unlocksPerDay,
      });
    }
    const { unlockMinutes, delayedUnlockMinutes } = db.settings.unlock;
    const startsAt = now + (delayedUnlockMinutes ?? 0) * 60_000;
    const u = {
      id: `unl_${Math.random().toString(16).slice(2, 8)}`,
      ruleIds: body?.ruleIds ?? null,
      requestedAt: isoWithOffset(now),
      startsAt: isoWithOffset(startsAt),
      endsAt: isoWithOffset(startsAt + unlockMinutes * 60_000),
      cancelledAt: null,
    };
    db.unlocks.push(u);
    saveMock(db);
    return unlockView(u);
  }
  if (method === 'GET' && path === '/status') {
    return {
      now: isoWithOffset(now),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      blockingRuleIds: db.rules.filter(running).map((r) => r.id),
      rules: db.rules.map((r) => ({
        ruleId: r.id,
        name: r.name,
        state: running(r) ? 'blocking' : 'inactive',
        scheduleActive: !!running(r),
        nextChangeAt: running(r) ? r.timerEndsAt : null,
      })),
      unlock: null,
      pendingChanges: [],
    };
  }
  if (method === 'POST' && path === '/rules') {
    if (body.schedule?.type === 'window') {
      const { start, end, days } = body.schedule;
      const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!hhmm.test(start) || !hhmm.test(end) || start === end || !days?.length) {
        fail(422, 'VALIDATION_ERROR', '入力値が正しくありません', { field: 'schedule' });
      }
    }
    const domains = body.target?.domains ?? [];
    const badDomain = domains.find((d) => !MOCK_DOMAIN.test(d));
    if (badDomain) fail(422, 'VALIDATION_ERROR', '入力値が正しくありません', { field: 'target.domains' });
    const unknown = (body.target?.apps ?? []).filter((id) => !MOCK_CATALOG[id]);
    if (unknown.length > 0) fail(422, 'VALIDATION_ERROR', '入力値が正しくありません', { field: 'target.apps' });
    const stamp = isoWithOffset(now);
    const rule = {
      id: `rule_${Math.random().toString(16).slice(2, 8)}`,
      name: body.name,
      enabled: true,
      schedule: body.schedule,
      target: body.target,
      timerEndsAt: null,
      pendingChange: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    db.rules.push(rule);
    saveMock(db);
    return { applyMode: 'immediate', rule };
  }
  const ruleMatch = path.match(/^\/rules\/([^/]+)(\/timer)?$/);
  if (ruleMatch && method === 'DELETE' && !ruleMatch[2]) {
    // オンのルールを消すのは反映待ち。オフのルールはすぐ消える
    const rule = findRule(ruleMatch[1]);
    if (!rule.enabled) {
      db.rules = db.rules.filter((r) => r !== rule);
      saveMock(db);
      return { applyMode: 'immediate', rule: null, pendingChange: null };
    }
    const p = makePending({ type: 'rule', ruleId: rule.id }, 'delete', rule, null);
    saveMock(db);
    return { applyMode: 'pending', rule: { ...rule, pendingChange: p }, pendingChange: p };
  }
  if (ruleMatch && method === 'PATCH' && !ruleMatch[2]) {
    // オンにするのはすぐ反映。モックではそれ以外の変更は扱わない
    const rule = findRule(ruleMatch[1]);
    if (body.enabled === true) rule.enabled = true;
    rule.updatedAt = isoWithOffset(now);
    saveMock(db);
    return { applyMode: 'immediate', rule };
  }
  if (ruleMatch && method === 'POST' && ruleMatch[2]) {
    const rule = findRule(ruleMatch[1]);
    if (rule.schedule.type !== 'timer') {
      fail(409, 'NOT_A_TIMER_RULE', 'このルールは集中タイマーではありません', { ruleId: rule.id });
    }
    // 動いている最中にもう一度始めた時の動きは仕様に無い。モックではエラーにする
    if (running(rule)) fail(409, 'TIMER_RUNNING', 'このタイマーはすでに動いています', { ruleId: rule.id });
    let failNames = [];
    try {
      failNames = JSON.parse(localStorage.getItem(MOCK_FAIL_KEY)) ?? [];
    } catch {
      // 無ければ失敗させない
    }
    if (failNames.includes(rule.name)) {
      fail(502, 'CLOUDFLARE_API_ERROR', 'Cloudflare への反映に失敗しました。しばらくしてからもう一度お試しください', {
        retryable: true,
      });
    }
    const minutes = body?.durationMinutes ?? rule.schedule.durationMinutes;
    rule.timerEndsAt = isoWithOffset(now + minutes * 60_000);
    rule.updatedAt = isoWithOffset(now);
    saveMock(db);
    return rule;
  }
  return fail(404, 'NOT_FOUND', '見つかりません');
}
