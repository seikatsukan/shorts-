// ログイン（Google）
//
// ログインはサーバー（cf-rules-api の /auth 以下）が持ち、Cookie（session、HttpOnly）で続く。
// - ログイン: /auth/google/start へ画面ごと移動する（fetch ではない）。終わると next の画面に戻ってくる
//   今のサーバーは偽のログインだけで、開いただけでダミーのユーザーになる。本物の Google になってもここは変わらない
// - ログイン中か: GET /auth/session → { user: { id, email, name } }。ログインしていなければ 401
// - ログアウト: POST /auth/logout（この端末だけ）
// VITE_API_BASE が未設定の時（api.js と同じ）はモックで動き、ボタンを押すとダミーのユーザーでログインする
//
// アカウントの形: { userId, email, name }（userId はサーバーの users.id。端末に保存するデータもこれで分ける）

const IS_MOCK = !import.meta.env.VITE_API_BASE;
const MOCK_SESSION_KEY = 'sns-blocker:mock-session';
const MOCK_USER = { userId: 'u_mock_alice', email: 'alice@example.com', name: 'Alice（テスト）' };

// Google のログイン画面へ移動する。モックの時はその場でログインしてアカウントを返す
export async function startGoogleLogin() {
  if (IS_MOCK) {
    await new Promise((r) => setTimeout(r, 500)); // 通信の待ち時間を再現
    write(MOCK_SESSION_KEY, MOCK_USER);
    return MOCK_USER;
  }
  window.location.assign('/auth/google/start?next=/');
  return null;
}

// ログイン中のアカウント。ログインしていなければ null。通信できない時は例外
export async function fetchSession() {
  if (IS_MOCK) return read(MOCK_SESSION_KEY);
  const r = await fetch('/auth/session', { credentials: 'same-origin' });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`ログインの確認に失敗しました (${r.status})`);
  const { user } = await r.json();
  return { userId: user.id, email: user.email, name: user.name };
}

// この端末だけログアウトする
export async function logOutSession() {
  if (IS_MOCK) {
    localStorage.removeItem(MOCK_SESSION_KEY);
    return;
  }
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
}

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても動作は続ける
  }
}
