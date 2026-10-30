// デフォルトで登録してあるアプリ
// domain: カスタム追加時の重複チェック用。サーバーのカタログ（/options）に無いアプリ（Facebook・Threads）はこのドメインで送る
// color: アイコンタイルの色 / glyph: タイルに表示する文字
export const DEFAULT_APPS = [
  { name: 'YouTube', domain: 'youtube.com', color: '#FF0033', glyph: '▶' },
  { name: 'TikTok', domain: 'tiktok.com', color: '#111111', glyph: '♪' },
  { name: 'Instagram', domain: 'instagram.com', color: '#D6249F', glyph: '◎' },
  { name: 'X', domain: 'x.com', color: '#000000', glyph: '𝕏' },
  { name: 'Facebook', domain: 'facebook.com', color: '#1877F2', glyph: 'f' },
  { name: 'Threads', domain: 'threads.net', color: '#3A3A3A', glyph: '@' },
];

// 入力されたドメインを整える（https:// や www.、パスを取り除く）
export function normalizeDomain(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
}

export const isValidDomain = (domain) => /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain);

// 制限時間の選択肢（分）
export const TIME_OPTIONS = [20, 30, 60];

// 目的の選択肢
export const PURPOSES = ['勉強', '昼寝', 'スポーツ'];

// グラフ用のカテゴリカラー（固定順。順位ではなくアプリごとに色が決まる）
const CHART_COLORS = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
  '#e87ba4', '#008300', '#6250d6', '#e34948',
];
export const OTHER_COLOR = '#9a9890';

export function getAppMeta(name) {
  const found = DEFAULT_APPS.find((a) => a.name === name);
  if (found) return found;
  // カスタムアプリは灰色タイル＋頭文字
  return { name, color: '#6B7280', glyph: name.slice(0, 1).toUpperCase(), custom: true };
}

// グラフ色：デフォルトアプリは登録順、カスタムは名前から決める
export function getChartColor(name) {
  const index = DEFAULT_APPS.findIndex((a) => a.name === name);
  if (index >= 0) return CHART_COLORS[index];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CHART_COLORS[DEFAULT_APPS.length + (hash % (CHART_COLORS.length - DEFAULT_APPS.length))];
}

// ---- コイン ----

// 10分ごとにコイン1枚
const MINUTES_PER_COIN = 10;
export const coinsFor = (minutes) => Math.floor(minutes / MINUTES_PER_COIN);

// ---- 表示用フォーマット ----

export function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatClock(time) {
  const d = new Date(time);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
