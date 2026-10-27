import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { coinsFor } from '../data/apps';
import { saveRecord } from '../storage';
import { uuid } from '../utils';

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
  coins: 0,
  activeLocks: [], // { id, groupId, name, minutes, purpose, startAt, endAt }
  finishedLocks: [], // 終了したが、同じスタートの他のロックがまだ続いているもの
  customApps: [], // ユーザーが追加したアプリ { name, domain }
};

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
      },

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
        }).catch((e) => console.error('記録の保存に失敗しました', e));
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
    }),
    [state.account, state.tutorialSeen, userId, user, now, draft, completed, updateUser],
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
