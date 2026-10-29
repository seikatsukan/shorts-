import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { coinsFor } from '../data/apps';
import { fetchRecords, saveRecord } from '../storage';
import { uuid } from '../utils';
import {
  MAX_EXTRA_TICKETS, TICKET_PRICE, applyDay, fetchRangeFor, mergeRanges, minutesByDay, newHabit, settle,
} from '../habit';

// アプリ全体で共有する状態（コイン・ロック中のアプリなど）
// ※コイン・ロック・カスタムアプリはアカウントごとに分けて持つ（別のアカウントでログインしても混ざらない）
// ※認証サーバーができたら、users の中身もサーバーのユーザーデータから読み込む想定
// ※ロックの記録はスタート時に storage.js 経由で保存先へ送る

const STORAGE_KEY = 'sns-blocker:v1';

const initialState = {
  account: null, // ログイン中のアカウント { userId, email }。null なら初めての利用者 / ログアウト中
  tutorialSeen: false, // この端末で説明を見たか（ログアウトしても消さない。次からはログイン画面から始める）
  clockOffset: 0, // PCサーバー時刻 - 端末時刻（ms）
  users: {}, // userId ごとのデータ（下の emptyUser の形）
};

const emptyUser = {
  coins: 0, // 持っているコイン（ロックをやりきるともらえる。お休みチケットを買うのに使う）
  habit: null, // 毎日の目標と色の段階（habit.js の newHabit の形）。目標を決めるまでは null
  // まだ画面で知らせていない判定の結果（habit.js の applyDay の event）。
  // アプリを閉じても消えないように保存し、知らせ終わったら空にする。食べたチケットには eaten: true を付ける
  habitEvents: [],
  activeLocks: [], // { id, groupId, name, minutes, purpose, startAt, endAt }
  finishedLocks: [], // 終了したが、同じスタートの他のロックがまだ続いているもの
  customApps: [], // ユーザーが追加したアプリ { name, domain }
};

const NO_EVENTS = []; // 判定の結果が無い時（毎回同じ配列を使う）

const emptyDraft = { apps: [], purpose: null, unsupported: [], startIdx: null };

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
    return {
      account: saved.account ?? null,
      tutorialSeen: saved.tutorialSeen ?? false,
      clockOffset: saved.clockOffset ?? 0,
      users: saved.users ?? {},
    };
  } catch {
    return initialState;
  }
}

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, setState] = useState(loadState);
  // ロック設定の入力途中の内容（アプリ選択→目的→確認 の間で共有）
  // unsupported: PCサーバーに「対応していない」と言われたアプリ名
  // startIdx: ロック設定を始めた時の履歴位置（終わったら元の画面に戻るため）
  const [draft, setDraft] = useState(emptyDraft);
  // 終了したロックの「おめでとう」表示用
  const [completed, setCompleted] = useState(null);
  // 処理済みのロック（同じロックで2回コインを付けないように）
  const processedRef = useRef(new Set());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 保存できなくても動作は続ける
    }
  }, [state]);

  const userId = state.account?.userId ?? null;
  const user = (userId && state.users[userId]) || emptyUser;

  // ログイン中のアカウントのデータを更新する
  const updateUser = useCallback((fn) => {
    setState((s) => {
      const id = s.account?.userId;
      if (!id) return s;
      return { ...s, users: { ...s.users, [id]: fn(s.users[id] ?? emptyUser) } };
    });
  }, []);

  const now = useCallback(() => Date.now() + state.clockOffset, [state.clockOffset]);

  // 終了時刻を過ぎたロックを片付け、1回のスタート単位でコインを付与する
  const { activeLocks, finishedLocks } = user;
  useEffect(() => {
    if (activeLocks.length === 0) return;
    const tick = () => {
      const current = now();
      const finished = activeLocks.filter((l) => l.endAt <= current && !processedRef.current.has(l.id));
      if (finished.length === 0) return;
      finished.forEach((l) => processedRef.current.add(l.id));

      const finishedIds = new Set(finished.map((l) => l.id));
      const remaining = activeLocks.filter((l) => !finishedIds.has(l.id));

      // 同じスタートで始めたロックが全部終わったら、一番長い時間ぶんのコインを付与
      const doneGroups = [...new Set(finished.map((l) => l.groupId))].filter(
        (g) => !remaining.some((l) => l.groupId === g),
      );
      const doneLocks = [...finishedLocks, ...finished].filter((l) => doneGroups.includes(l.groupId));
      const earned = doneGroups.reduce((sum, g) => {
        const longest = Math.max(...doneLocks.filter((l) => l.groupId === g).map((l) => l.minutes));
        return sum + coinsFor(longest);
      }, 0);

      updateUser((u) => ({
        ...u,
        activeLocks: u.activeLocks.filter((l) => !finishedIds.has(l.id)),
        finishedLocks: [...u.finishedLocks, ...finished].filter((l) => !doneGroups.includes(l.groupId)),
        coins: u.coins + earned,
      }));
      if (doneGroups.length > 0) {
        setCompleted((prev) => ({
          locks: [...(prev?.locks ?? []), ...doneLocks],
          coins: (prev?.coins ?? 0) + earned,
        }));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeLocks, finishedLocks, now, updateUser]);

  // ---- 毎日の目標の判定（habit.js） ----
  // アプリを開いた時・1分ごと（日付が変わったら判定するため）・ロックを始めた時に判定する
  const habit = user.habit ?? null;
  const habitEvents = user.habitEvents ?? NO_EVENTS;
  // 判定に使ったロックの時間の範囲（今日の進み具合を毎秒表示するため。habit.js の mergeRanges の形）
  const [lockRanges, setLockRanges] = useState([]);
  const habitRef = useRef(habit);
  useEffect(() => {
    habitRef.current = habit;
  }, [habit]);
  const evaluatingRef = useRef(false);

  const evaluateHabit = useCallback(async () => {
    const h = habitRef.current;
    if (!userId || !h || evaluatingRef.current) return;
    evaluatingRef.current = true;
    try {
      const t = now();
      const { from, to } = fetchRangeFor(h, t);
      // デモデータで成功扱いにならないように、実際の記録だけを使う
      const { records } = await fetchRecords({ userId, from: new Date(from), to: new Date(to), allowDemo: false });
      // 実際に経過した分だけ数える（ロック中の残り時間は、経過してから数える）
      const minutes = minutesByDay(records, t);
      setLockRanges(mergeRanges(records));
      // 取得している間に別の判定が進んでいたら何もしない
      const latest = habitRef.current;
      if (!latest || latest.settledUntil !== h.settledUntil) return;
      const { habit: next, events } = settle(latest, minutes, t);
      if (events.length === 0) return;
      habitRef.current = next;
      updateUser((u) => ({ ...u, habit: next, habitEvents: [...(u.habitEvents ?? []), ...events] }));
    } catch (e) {
      console.error('毎日の目標の判定に失敗しました', e);
    } finally {
      evaluatingRef.current = false;
    }
  }, [userId, now, updateUser]);

  const habitGoal = habit?.goal;
  useEffect(() => {
    if (!habitGoal) return;
    evaluateHabit();
    const id = setInterval(evaluateHabit, 60_000);
    return () => clearInterval(id);
  }, [evaluateHabit, habitGoal]);

  const value = useMemo(
    () => ({
      account: state.account,
      tutorialSeen: state.tutorialSeen,
      userId,
      ...user,
      now,
      draft,
      completed,

      markTutorialSeen: () => setState((s) => (s.tutorialSeen ? s : { ...s, tutorialSeen: true })),
      logIn: (account) => setState((s) => ({ ...s, account, tutorialSeen: true })),
      logOut: () => {
        setState((s) => ({ ...s, account: null }));
        setCompleted(null);
        setDraft(emptyDraft);
        setLockRanges([]);
      },

      habit,
      lockRanges,
      habitEvents,
      evaluateHabit,
      // コインでお休みチケットを1枚買う（コインが足りない・持てる上限の時は何もしない）
      buyTicket: () =>
        updateUser((u) =>
          u.habit && u.coins >= TICKET_PRICE && (u.habit.extraTickets ?? 0) < MAX_EXTRA_TICKETS
            ? { ...u, coins: u.coins - TICKET_PRICE, habit: { ...u.habit, extraTickets: (u.habit.extraTickets ?? 0) + 1 } }
            : u,
        ),
      // 1日の目標を決める・変える（初めて決めた日から数え始める）
      setGoal: (goal) =>
        updateUser((u) => ({ ...u, habit: u.habit ? { ...u.habit, goal } : newHabit(goal, now()) })),
      dismissHabitEvents: () => updateUser((u) => ({ ...u, habitEvents: [] })),
      // お休みチケットを食べ終わった（habitEvents の何番目か）
      markTicketsEaten: (indexes) =>
        updateUser((u) => ({
          ...u,
          habitEvents: (u.habitEvents ?? []).map((e, i) => (indexes.includes(i) ? { ...e, eaten: true } : e)),
        })),

      // カスタムアプリのドメイン（デフォルトのアプリは undefined）
      customDomainOf: (name) => user.customApps.find((a) => a.name === name)?.domain,

      startDraft: (startIdx) => setDraft({ ...emptyDraft, startIdx }),
      setDraftApp: (name, minutes) =>
        setDraft((d) => ({
          ...d,
          apps: minutes
            ? [...d.apps.filter((a) => a.name !== name), { name, minutes }]
            : d.apps.filter((a) => a.name !== name),
          unsupported: minutes ? d.unsupported : d.unsupported.filter((n) => n !== name),
        })),
      setDraftPurpose: (purpose) => setDraft((d) => ({ ...d, purpose })),
      setDraftUnsupported: (names) => setDraft((d) => ({ ...d, unsupported: names })),
      resetDraft: () => setDraft(emptyDraft),

      // カスタムアプリの追加（prevName が null）または修正（名前を変えた場合は選択中の内容も付け替える）
      saveCustomApp: (prevName, app) => {
        updateUser((u) => ({
          ...u,
          customApps: prevName
            ? u.customApps.map((a) => (a.name === prevName ? app : a))
            : [...u.customApps, app],
        }));
        if (prevName) {
          setDraft((d) => ({
            ...d,
            apps: d.apps.map((a) => (a.name === prevName ? { ...a, name: app.name } : a)),
            unsupported: d.unsupported.filter((n) => n !== prevName),
          }));
        }
      },
      removeCustomApp: (name) => {
        updateUser((u) => ({ ...u, customApps: u.customApps.filter((a) => a.name !== name) }));
        setDraft((d) => ({
          ...d,
          apps: d.apps.filter((a) => a.name !== name),
          unsupported: d.unsupported.filter((n) => n !== name),
        }));
      },

      // サーバーから成功が返ってきたロックを登録し、保存先へ記録を送る
      addLocks: ({ locks, startAt, clockOffset, purpose }) => {
        const groupId = uuid();
        saveRecord({
          id: groupId,
          userId,
          startedAt: new Date(startAt).toISOString(),
          apps: locks.map(({ name, minutes }) => ({ name, minutes })),
          purpose: purpose || null,
        })
          .then(evaluateHabit) // 今日の目標に届いたかを判定
          .catch((e) => console.error('記録の保存に失敗しました', e));
        setState((s) => ({ ...s, clockOffset }));
        updateUser((u) => ({
          ...u,
          activeLocks: [
            ...u.activeLocks,
            ...locks.map((l) => ({ ...l, id: uuid(), groupId, purpose: purpose || null })),
          ],
        }));
      },

      dismissCompleted: () => setCompleted(null),

      // 開発中（npm run dev）だけのテスト用。本番のビルドには入らない
      ...(import.meta.env.DEV && {
        devAddCoins: (n) => updateUser((u) => ({ ...u, coins: u.coins + n })),
        // 1日分の成功／失敗をその場で反映する（21日待たずに色の変化を試すため）
        devHabitDay: (ok) => {
          if (!habit) return;
          const day = habit.settledUntil - 86_400_000;
          const { habit: next, event } = applyDay(habit, ok, day);
          updateUser((u) => ({
            ...u,
            habit: { ...next, settledUntil: habit.settledUntil },
            habitEvents: [...(u.habitEvents ?? []), event],
          }));
        },
      }),
    }),
    [state.account, state.tutorialSeen, userId, user, now, draft, completed, updateUser, habit, lockRanges, habitEvents, evaluateHabit],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  return useContext(AppContext);
}

// 1秒ごとに再描画してサーバー基準の現在時刻を返す（カウントダウン用）
export function useNow() {
  const { now } = useApp();
  const [time, setTime] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setTime(now()), 1000);
    return () => clearInterval(id);
  }, [now]);
  return time;
}
