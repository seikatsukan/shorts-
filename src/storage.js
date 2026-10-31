// ロック記録の保存先とのやりとり
//
// 保存先（DBやクラウド）はまだ決まっていないので、今はモックとして端末の localStorage に保存する。
// 保存先が決まったら、この2つの関数の中身を API 通信に差し替えるだけでよい。
//
// 保存先へ送るデータ（ロックを1回スタートするごとに1件）
//   {
//     "id": "…",                                   // 記録ID
//     "userId": "…",                               // アカウントID（サーバーの users.id）
//     "startedAt": "2026-10-27T12:00:00.500Z",     // 開始日時（サーバーのタイマーの開始時刻）
//     "apps": [{ "name": "YouTube", "minutes": 30 }, { "name": "LINE", "minutes": 60 }],
//     "purpose": "勉強" | null                      // 目的（選択されていれば）
//   }

const STORAGE_KEY = 'sns-blocker:sessions';

// 記録を保存先へ送る
export async function saveRecord(record) {
  writeLocal([...readLocal(), record]);
}

// 指定アカウントの、期間内（from <= startedAt < to）の記録を保存先から取得する
export async function fetchRecords({ userId, from, to }) {
  await new Promise((r) => setTimeout(r, 200)); // 通信の待ち時間を再現
  return {
    records: readLocal().filter((r) => {
      const t = Date.parse(r.startedAt);
      return r.userId === userId && t >= from.getTime() && t < to.getTime();
    }),
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
