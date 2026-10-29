// 毎日の目標（習慣づくり）のルール
//
// - 1日（0時〜24時）に、自分で決めた目標時間以上ロックできたらその日は「成功」
// - 成功が続くと、STEP_DAYS の日数ごとにスライムの色が1つ上がる（合計21日連続で銀色）
// - 失敗した日は、お休みチケット（週1回の無料分 → コインで買った分の順）があれば自動で使い、何も起きない
//   チケットが無ければ色が1つ下がり、連続記録は0に戻る
// - 失敗が続いている間は、下がるのは最初の1回だけ（アプリを開かなかった日が続いても、毎日開いて失敗しても同じ）
//   その間はチケットも使わない（守るものが無いので）。次に成功すると、また普通に数え始める
// - 銀色になった後も毎日の目標は続き、失敗すると1つ下がる
// - 隠し要素：銀色になってから CROWN_DAYS 日続けて成功すると王冠をかぶる（失敗して色が下がると外れる。知らせは出さない）

export const COLORS = [
  { name: '水色', hex: '#8fd3f5' },
  { name: '緑', hex: '#7fd88c' },
  { name: '青', hex: '#4f86e8' },
  { name: '紫', hex: '#a070e0' },
  { name: '銀', hex: '#d5dce5' },
];
export const MAX_STAGE = COLORS.length - 1;

// 次の色に上がるのに必要な連続日数（3 → 7 → 14 → 21日目で銀）
export const STEP_DAYS = [3, 4, 7, 7];

// 銀色になってから王冠をかぶるまでの成功日数（お休みチケットの日は途切れないが数えない）
const CROWN_DAYS = 3;
// 王冠をかぶっているか（銀色の段階では progress が銀色になってからの成功日数）
export const hasCrown = (habit) => !!habit && habit.stage === MAX_STAGE && habit.progress >= CROWN_DAYS;

// 1日の目標時間の選択肢（分）
export const GOAL_OPTIONS = [30, 60, 90, 120, 180];

// コインで買うお休みチケット
export const TICKET_PRICE = 10; // 1枚のコイン数
export const MAX_EXTRA_TICKETS = 3; // 持っておける枚数

// ---- 日付（端末の時間帯で 0 時区切り）----
export const dayStart = (t) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
export const nextDay = (t) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
};
const prevDay = (t) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
};
// その日が入っている週の月曜日（お休みチケットは週に1回）
const weekKey = (t) => {
  const d = new Date(dayStart(t));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
};

// 目標を初めて決めた時の状態（今日から数え始める）
export function newHabit(goal, now) {
  return {
    goal, // 1日の目標（分）
    stage: 0, // 色の段階（COLORS の番号）
    progress: 0, // 次の色までに続けた日数
    streak: 0, // 連続して成功した日数（お休みチケットの日は途切れない）
    settledUntil: dayStart(now), // この日以降はまだ判定していない
    ticketsUsed: {}, // 無料のお休みチケットを使った週 { 週の月曜: その日 }
    extraTickets: 0, // コインで買ったお休みチケットの枚数
    failing: false, // 失敗が続いている途中か（すでに1つ下がった）
  };
}

// 今週の無料のお休みチケットが残っているか
export const hasTicket = (habit, now) => !habit.ticketsUsed[weekKey(now)];
// 今使えるお休みチケットの合計（無料分 + 買った分）
export const ticketCount = (habit, now) => (hasTicket(habit, now) ? 1 : 0) + (habit.extraTickets ?? 0);

// 1日分の結果を反映する。event は画面に知らせる内容（無ければ null）
export function applyDay(habit, ok, day) {
  const h = { ...habit, ticketsUsed: { ...habit.ticketsUsed } };
  let event = null;
  if (ok) {
    h.failing = false;
    h.streak += 1;
    h.progress += 1;
    if (h.stage < MAX_STAGE && h.progress >= STEP_DAYS[h.stage]) {
      event = { type: 'up', day, from: h.stage, to: h.stage + 1, streak: h.streak };
      h.stage += 1;
      h.progress = 0;
    } else {
      event = { type: 'success', day, streak: h.streak };
    }
  } else if (h.failing) {
    // 失敗が続いている途中：これ以上は下がらない
    event = { type: 'miss', day, continued: true };
  } else if (!h.ticketsUsed[weekKey(day)]) {
    h.ticketsUsed[weekKey(day)] = day;
    event = { type: 'ticket', day, kind: 'weekly' };
  } else if ((h.extraTickets ?? 0) > 0) {
    h.extraTickets -= 1;
    event = { type: 'ticket', day, kind: 'extra' };
  } else {
    event = h.stage > 0 ? { type: 'down', day, from: h.stage, to: h.stage - 1 } : { type: 'miss', day };
    h.stage = Math.max(0, h.stage - 1);
    h.progress = 0;
    h.streak = 0;
    h.failing = true;
  }
  h.settledUntil = nextDay(day);
  return { habit: h, event };
}

// まだ判定していない日を順に判定する
// 今日は目標に届いた時だけ成功にする（届いていなければ、日が変わってから判定）
// minutesOfDay は minutesByDay(records, now) の結果（今の時刻までに経過した分）
export function settle(habit, minutesOfDay, now) {
  const today = dayStart(now);
  let h = habit;
  const events = [];
  for (let d = h.settledUntil; d <= today; d = nextDay(d)) {
    const ok = (minutesOfDay.get(d) ?? 0) >= h.goal;
    if (d === today && !ok) break;
    const r = applyDay(h, ok, d);
    h = r.habit;
    events.push(r.event);
  }
  return { habit: h, events };
}

// ロックの記録を時間の範囲 [開始, 終了] にして、重なっている部分をまとめる
// （同じ時間に複数のアプリをロックしていても二重に数えないため）
export function mergeRanges(records) {
  const ranges = records
    .map((r) => {
      const start = Date.parse(r.startedAt);
      return [start, start + Math.max(...r.apps.map((a) => a.minutes)) * 60_000];
    })
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

// day の日（0時〜24時）のうち、until までにロックしていた分数
export function minutesOnDay(ranges, day, until) {
  const from = day;
  const to = Math.min(nextDay(day), until);
  let ms = 0;
  for (const [s, e] of ranges) ms += Math.max(0, Math.min(e, to) - Math.max(s, from));
  return ms / 60_000;
}

// 日ごとにロックしていた分数（実際に経過した分だけ。日をまたぐロックは0時で分ける）
export function minutesByDay(records, until) {
  const ranges = mergeRanges(records);
  const result = new Map();
  for (const [s] of ranges) {
    for (let d = dayStart(s); d < until && d <= dayStart(until); d = nextDay(d)) {
      if (!result.has(d)) result.set(d, minutesOnDay(ranges, d, until));
    }
  }
  return result;
}

// 判定に必要な記録の範囲（前日から始まって日をまたいだロックも含めるため1日前から）
export const fetchRangeFor = (habit, now) => ({ from: prevDay(habit.settledUntil), to: nextDay(now) });
