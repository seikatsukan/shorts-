// ロック記録の保存先とのやりとり
//
// 保存先（DBやクラウド）はまだ決まっていないので、今はモックとして端末の localStorage に保存する。
// 保存先が決まったら、この2つの関数の中身を API 通信に差し替えるだけでよい。
//
// 保存先へ送るデータ（ロックを1回スタートするごとに1件）
//   {
//     "id": "…",                                   // 記録ID
//     "userId": "…",                               // アカウントID（ログイン実装までは端末ごとの仮ID）
//     "startedAt": "2026-10-27T12:00:00.500Z",     // 開始日時（サーバーのタイマーの開始時刻）
//     "apps": [{ "name": "YouTube", "minutes": 30 }, { "name": "LINE", "minutes": 60 }],
//     "purpose": "勉強" | null                      // 目的（選択されていれば）
//   }

import { DEFAULT_APPS, PURPOSES } from './data/apps';

const STORAGE_KEY = 'sns-blocker:sessions';
const IS_MOCK_STORAGE = true;

// 記録を保存先へ送る
export async function saveRecord(record) {
  writeLocal([...readLocal(), record]);
}

// 指定アカウントの、期間内（from <= startedAt < to）の記録を保存先から取得する
// demo: 記録がまだ無いため見た目確認用のデータを返したかどうか（モックのみ）
// allowDemo: false にするとデモデータを返さない（毎日の目標の判定などに使う時）
export async function fetchRecords({ userId, from, to, allowDemo = true }) {
  await new Promise((r) => setTimeout(r, 200)); // 通信の待ち時間を再現
  const saved = readLocal().filter((r) => r.userId === userId);
  const demo = allowDemo && IS_MOCK_STORAGE && saved.length === 0;
  const source = demo ? makeDemoRecords(userId) : saved;
  return {
    records: source.filter((r) => {
      const t = Date.parse(r.startedAt);
      return t >= from.getTime() && t < to.getTime();
    }),
    demo,
  };
}

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function writeLocal(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 保存できなくても動作は続ける
  }
}

// 見た目確認用のデモデータ（過去60日分）
function makeDemoRecords(userId) {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const names = DEFAULT_APPS.slice(0, 5).map((a) => a.name);
  const records = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 60; i >= 0; i--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    if (rand() < 0.35) continue;
    const count = 1 + Math.floor(rand() * 2);
    for (let j = 0; j < count; j++) {
      const startAt = day.getTime() + (9 + Math.floor(rand() * 12)) * 3_600_000;
      if (startAt > Date.now()) continue;
      records.push({
        id: `demo-${i}-${j}`,
        userId,
        startedAt: new Date(startAt).toISOString(),
        apps: [
          {
            name: names[Math.floor(rand() * rand() * names.length)],
            minutes: [20, 30, 60, 45, 90][Math.floor(rand() * 5)],
          },
        ],
        purpose: rand() < 0.6 ? PURPOSES[Math.floor(rand() * PURPOSES.length)] : null,
      });
    }
  }
  return records;
}
