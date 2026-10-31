import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { coinsFor } from '../data/apps';
import { fetchRecords, saveRecord } from '../storage';
import { fetchSession, logOutSession } from '../auth';
import { uuid } from '../utils';
import { useFixedMode } from './useFixedMode';
import {
  MAX_EXTRA_TICKETS, TICKET_PRICE, applyDay, fetchRangeFor, mergeRanges, minutesByDay, newHabit, settle,
} from '../habit';

// アプリ全体で共有する状態（コイン・ロック中のアプリなど）
// ※コイン・ロック・カスタムアプリはアカウントごとに分けて持つ（別のアカウントでログインしても混ざらない）
// ※ログインはサーバー（auth.js）。ここに持つ account は最後に確かめた結果で、起動のたびにサーバーに確かめ直す
// ※users の中身（コイン・スライム・予定など）はこの端末にだけ保存する（サーバーに保存する API がまだ無いため）
// ※ロックの記録はスタート時に storage.js 経由で保存先へ送る

const STORAGE_KEY = 'sns-blocker:v1';

const initialState = {
  account: null, // ログイン中のアカウント { userId, email, name }（auth.js）。null なら初めての利用者 / ログアウト中
  tutorialSeen: false, // この端末で説明を見たか（ログアウトしても消さない。次からはログイン画面から始める）
  clockOffset: 0, // サーバー時刻 - 端末時刻（ms）
  users: {}, // userId ごとのデータ（下の emptyUser の形）
};

const emptyUser = {
  // 使い方のモード: 'timer'（自分でロック） / 'fixed'（固定時間で自動ロック） / null（まだ選んでいない）
  // 2つのモードはコイン・スライムの成長も別。固定時間をキャンセルした時は、反映された後にもう一度選ぶ
  mode: null,
  fixed: null, // 固定時間モードの状態（useFixedMode.js）
  fixedDraft: null, // 固定時間の予定を決めている途中の内容（useFixedMode.js）
  coins: 0, // 持っているコイン（ロックをやりきるともらえる。お休みチケットを買うのに使う）
  habit: null, // 毎日の目標と色の段階（habit.js の newHabit の形）。目標を決めるまでは null
  // まだ画面で知らせていない判定の結果（habit.js の applyDay の event）。
  // アプリを閉じても消えないように保存し、知らせ終わったら空にする。食べたチケットには eaten: true を付ける
  habitEvents: [],
  activeLocks: [], // { id, groupId, ruleId, name, minutes, purpose, startAt, endAt }（ruleId はサーバーのタイマーのルール）
  finishedLocks: [], // 終了したが、同じスタートの他のロックがまだ続いているもの
  customApps: [], // ユーザーが追加したアプリ { name, domain }
};

const NO_EVENTS = []; // 判定の結果が無い時（毎回同じ配列を使う）

const emptyDraft = { apps: [], unsupported: [], startIdx: null };

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
  // unsupported: サーバーにドメインを受け付けてもらえなかったカスタムアプリの名前
  // startIdx: ロック設定を始めた時の履歴位置（終わったら元の画面に戻るため）
  const [draft, setDraft] = useState(emptyDraft);
  // 終了したロックの「おめでとう」表示用
  const [completed, setCompleted] = useState(null);
  // 処理済みのロック（同じロックで2回コインを付けないように）
  const processedRef = useRef(new Set());
  // 起動した後、サーバーにログイン中か確かめ終わったか（Google から戻ってきた直下などに、説明ページを一瞬出さないため）
  const [sessionChecked, setSessionChecked] = useState(false);

  // サーバーのログインに合わせる。通信できない時は、最後に確かめた account のまま使う
  useEffect(() => {
    let cancelled = false;
    fetchSession()
      .then((account) => {
        if (cancelled) return;
        setState((s) =>
          account
            ? { ...s, account, tutorialSeen: true }
            : s.account
              ? { ...s, account: null }
              : s,
        );
      })
      .catch(() => {})
      .finally(() => !cancelled && setSessionChecked(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 保存できなくても動作は続ける
    }
  }, [state]);

  const userId = state.account?.userId ?? null;
  // 保存してあるデータに項目が足りない時（古い版で保存したものなど）は、初期値で補う
  const savedUser = userId && state.users[userId];
  const user = useMemo(() => (savedUser ? { ...emptyUser, ...savedUser } : emptyUser), [savedUser]);

  // ログイン中のアカウントのデータを更新する
  const updateUser = useCallback((fn) => {
    setState((s) => {
      const id = s.account?.userId;
      if (!id) return s;
      return { ...s, users: { ...s.users, [id]: fn({ ...emptyUser, ...s.users[id] }) } };
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
      const { records } = await fetchRecords({ userId, from: new Date(from), to: new Date(to) });
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

  const fixedMode = useFixedMode({ user, updateUser, now });

  const value = useMemo(
    () => ({
      account: state.account,
      sessionChecked,
      tutorialSeen: state.tutorialSeen,
      userId,
      ...user,
      mode: user.mode ?? null,
      now,
      draft,
      completed,
      ...fixedMode,

      markTutorialSeen: () => setState((s) => (s.tutorialSeen ? s : { ...s, tutorialSeen: true })),
      logIn: (account) => setState((s) => ({ ...s, account, tutorialSeen: true })),
      logOut: () => {
        logOutSession().catch(() => {}); // 通信できなくても、この端末ではログアウトした状態にする
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
      // 目的を決める・変える（null は目的なし）。1日の目標を決めた後に聞く
      setPurpose: (purpose) => updateUser((u) => (u.habit ? { ...u, habit: { ...u.habit, purpose } } : u)),
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
      // 目的は1日の目標と一緒に決めたもの（habit.purpose）を記録に付ける
      addLocks: ({ locks, startAt, clockOffset }) => {
        const purpose = habit?.purpose ?? null;
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
    [state.account, sessionChecked, state.tutorialSeen, userId, user, now, draft, completed, updateUser, habit, lockRanges, habitEvents, evaluateHabit, fixedMode],
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
