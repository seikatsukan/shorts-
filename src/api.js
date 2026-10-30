// サーバー（cf-rules-api）との通信
//
// 取り決めは seikatsukan/api-spec の openapi.yaml（v0.2.0 の案）。バックエンドは変えられないので、こちらが合わせる。
// - API は画面と同じオリジンの /api 以下。ログインは /auth 以下で付く Cookie（session）で続く
// - .env に VITE_API_BASE=/api と書くと本物のサーバーへ送る（手元では vite.config.js のプロキシで流す）
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

const API_BASE = import.meta.env.VITE_API_BASE;
const IS_MOCK = !API_BASE;

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

async function request(method, path, body) {
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

const MOCK_KEY = 'sns-blocker:mock-api';
const MOCK_FAIL_KEY = 'sns-blocker:mock-api-fail';
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

const loadMock = () => {
  try {
    return JSON.parse(localStorage.getItem(MOCK_KEY)) ?? { rules: [] };
  } catch {
    return { rules: [] };
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

  if (method === 'GET' && path === '/options') {
    return { apps: MOCK_CATALOG, categories: {}, webPushPublicKey: null };
  }
  if (method === 'GET' && path === '/rules') return db.rules;
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
