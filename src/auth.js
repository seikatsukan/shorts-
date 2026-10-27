// アカウント作成・ログイン
//
// 認証サーバーはまだ無いので、今はモックとして端末の localStorage にアカウントを保存する。
// 認証サーバーができたら、この2つの関数の中身を API 通信に差し替えるだけでよい。
//
// 成功時に返す値: { userId, email }
// 失敗時: AuthError を投げる（message をそのまま画面に表示する）

import { uuid } from './utils';

const ACCOUNTS_KEY = 'sns-blocker:mock-accounts';

export class AuthError extends Error {}

export async function signUp({ email, password }) {
  await wait();
  const accounts = readAccounts();
  if (accounts.some((a) => a.email === email)) {
    throw new AuthError('このメールアドレスはすでに登録されています');
  }
  const account = { userId: uuid(), email, passwordHash: await hash(password) };
  writeAccounts([...accounts, account]);
  return { userId: account.userId, email };
}

export async function logIn({ email, password }) {
  await wait();
  const account = readAccounts().find((a) => a.email === email);
  if (!account || account.passwordHash !== (await hash(password))) {
    throw new AuthError('メールアドレスかパスワードが違います');
  }
  return { userId: account.userId, email };
}

const wait = () => new Promise((r) => setTimeout(r, 800)); // 通信の待ち時間を再現

// モックでもパスワードをそのまま保存しないようにハッシュ化しておく
// （crypto.subtle は https / localhost でしか使えないので、http の時は簡易ハッシュ）
async function hash(text) {
  const bytes = new TextEncoder().encode(text);
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return `fnv-${h.toString(16)}`;
}

function readAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) ?? [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // 保存できなくても動作は続ける
  }
}
