// 「固定時間で自動ロック」モードのルール
//
// - 最初に「ロックの予定」（曜日・時間帯・アプリ）を決める。予定ごとにサーバーの時間帯（window）のルールを1つ作り、
//   毎週その時間は自動でブロックされる
// - 予定の途中で使えるのは一時解除だけ。一時解除チケットはコインで買う
// - 成長は「ロックの予定がある日」だけ数え、その日に一時解除を使わなければ成功、使ったら失敗
//   （色の上がり方・下がり方・王冠は自分でロックするモードと同じ。お休みチケットは無い）
// - コインは、一時解除を使わずにやりきった予定の長さぶん（10分で1枚）。その日の判定の時にもらえる

import { coinsFor } from './data/apps';
import { applyDay, dayStart, nextDay } from './habit';

// 一時解除チケット
export const UNLOCK_PRICE = 15; // 1枚のコイン数
export const MAX_UNLOCK_TICKETS = 3; // 持っておける枚数

// サーバーに設定する一時解除の決まり（ユーザーごとに1つ。全部のルールにまとめてかかる）
// 今のサーバーは申請の時に長さを選べないので、長さは1つだけ。1日の回数は持てるチケットの枚数に合わせる
export const UNLOCK_SETTINGS = { unlockMinutes: 30, unlocksPerDay: MAX_UNLOCK_TICKETS, delayedUnlockMinutes: null };

// 「その日の終わりまで」。サーバーの時刻は 00:00〜23:59 までしか書けないので 23:59 にする（23:59〜0:00 の1分は止まらない）
export const END_OF_DAY = '23:59';

// 曜日（サーバーと同じく 0=日曜 … 6=土曜）。表示は月曜から
export const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [0, 6];

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const sameDays = (a, b) => a.length === b.length && a.every((d) => b.includes(d));

export function formatDays(days) {
  if (sameDays(days, EVERY_DAY)) return '毎日';
  if (sameDays(days, WEEKDAYS)) return '平日';
  if (sameDays(days, WEEKEND)) return '土日';
  return WEEK_ORDER.filter((d) => days.includes(d)).map((d) => DAY_LABELS[d]).join('・');
}

const trimHour = (hhmm) => hhmm.replace(/^0(\d)/, '$1');
export function formatTimeRange(start, end) {
  if (start === '00:00' && end === END_OF_DAY) return '1日中';
  if (end === END_OF_DAY) return `${trimHour(start)}〜その日の終わり`;
  const crosses = toMinutes(end) < toMinutes(start);
  return `${trimHour(start)}〜${crosses ? '翌' : ''}${trimHour(end)}`;
}

// 予定の時間帯が正しいか（開始と終了が同じ時間帯はサーバーで作れない）
export const isValidRange = (start, end) => /^\d\d:\d\d$/.test(start) && /^\d\d:\d\d$/.test(end) && start !== end;

// 予定の長さ（分）
export function entryMinutes({ start, end }) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return e > s ? e - s : 24 * 60 - s + e;
}

// day の日（0時の時刻）に始まる予定の時間帯 [{ entry, start, end }]（時刻はミリ秒。日をまたぐものは翌日に終わる）
export function occurrencesOn(schedule, day) {
  const d = new Date(day);
  const at = (minutes, plusDay = 0) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDay, Math.floor(minutes / 60), minutes % 60).getTime();
  return schedule
    .filter((entry) => entry.days.includes(d.getDay()))
    .map((entry) => {
      const s = toMinutes(entry.start);
      const e = toMinutes(entry.end);
      return { entry, start: at(s), end: e > s ? at(e) : at(e, 1) };
    })
    .sort((a, b) => a.start - b.start);
}

// 時刻 t にロック中の予定（前の日から日をまたいで続いているものも含める）
export function activeOccurrences(schedule, t) {
  const today = dayStart(t);
  const yesterday = dayStart(today - 1);
  return [...occurrencesOn(schedule, yesterday), ...occurrencesOn(schedule, today)].filter(
    (o) => o.start <= t && t < o.end,
  );
}

// 時刻 t より後に始まるいちばん近い予定
export function nextOccurrence(schedule, t) {
  let day = dayStart(t);
  for (let i = 0; i < 8; i++) {
    const found = occurrencesOn(schedule, day).find((o) => o.start > t);
    if (found) return found;
    day = nextDay(day);
  }
  return null;
}

// 一時解除 [{ requestedAt, endsAt }] のどれかが、その時間帯に重なっているか
const unlockedDuring = (unlocks, o) => unlocks.some((u) => u.requestedAt < o.end && u.endsAt > o.start);

// まだ判定していない日を順に判定する
// - 予定の無い日は数えずに飛ばす
// - その日の予定が全部終わってから判定する（日をまたぐ予定は翌日に終わってから）
// - habit.startedAt（モードを始めた時刻）より前に終わっていた予定は数えない
// - 一時解除を使った日は失敗。使わなかった予定の長さぶんのコインをもらう（失敗した日も、やりきった予定のぶんはもらえる）
export function settleFixed(habit, schedule, unlocks, now) {
  let h = habit;
  const events = [];
  let coins = 0;
  for (let d = h.settledUntil; d <= dayStart(now); d = nextDay(d)) {
    // モードを始める前に終わっていた予定は数えない
    const list = occurrencesOn(schedule, d).filter((o) => o.end > (h.startedAt ?? 0));
    if (list.length === 0) {
      h = { ...h, settledUntil: nextDay(d) };
      continue;
    }
    if (Math.max(...list.map((o) => o.end)) > now) break;
    const used = list.some((o) => unlockedDuring(unlocks, o));
    const earned = list
      .filter((o) => !unlockedDuring(unlocks, o))
      .reduce((sum, o) => sum + coinsFor(entryMinutes(o.entry)), 0);
    const r = applyDay(h, !used, d, { tickets: false });
    h = r.habit;
    coins += earned;
    events.push({ ...r.event, coins: earned });
  }
  return { habit: h, events, coins };
}
