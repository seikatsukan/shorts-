import { useCallback, useEffect, useRef } from 'react';
import { ApiError, approvePendingChange, cancelFixedSchedule, devMakeApprovable, requestUnlock, setupFixedSchedule } from '../api';
import { applyDay, newHabit } from '../habit';
import { MAX_UNLOCK_TICKETS, UNLOCK_PRICE, UNLOCK_SETTINGS, settleFixed } from '../fixed';

// 「固定時間で自動ロック」モードの状態と操作（AppContext から使う）
//
// user.fixedDraft: 予定を決めている途中の内容 { entries, progress }（閉じても消えないように保存）
//   entries: [{ id, days, start, end, apps: [アプリ名] }] / progress: サーバーに作り終わった分（やり直しの時に飛ばす）
//   purpose: 目的（始める前に聞く。null は目的なし）
// user.fixed: 始めた後の状態（自分でロックするモードのコイン・スライムとは別に持つ）
//   schedule: 予定 / ruleIds: { 予定のid: サーバーのルールID } / purpose: 目的（null は目的なし）
//   habit: 色の段階など（habit.js の形。お休みチケットは使わない） / events: まだ知らせていない判定の結果
//   coins / unlockTickets: 一時解除チケットの枚数 / unlocks: 使った一時解除 [{ id, requestedAt, startsAt, endsAt }]
//   unlockMinutes: 今サーバーで効いている一時解除の長さ（分）
//   pending: 翌朝以降に承認が要る変更 [{ id, kind: 'settings' | 'cancel', ruleId, approvableFrom, expiresAt }]
//   cancelling: キャンセルを申請中か / notice: 一度だけ知らせる文（キャンセルの期限切れなど）

const NO_EVENTS = [];

export function useFixedMode({ user, updateUser, now }) {
  const fixed = user.fixed ?? null;

  // ---- 成長の判定（1分ごと・開いた時）----
  const fixedRef = useRef(fixed);
  useEffect(() => {
    fixedRef.current = fixed;
  }, [fixed]);
  const evaluateFixed = useCallback(() => {
    const f = fixedRef.current;
    if (!f) return;
    const t = now();
    const { habit, events, coins } = settleFixed(f.habit, f.schedule, f.unlocks, t);
    // キャンセルの承認期限が過ぎたら、キャンセルは取り消される（予定はそのまま続く）
    const expired = f.pending.filter((p) => p.expiresAt <= t);
    const cancelExpired = expired.some((p) => p.kind === 'cancel');
    if (events.length === 0 && expired.length === 0) return;
    updateUser((u) => {
      if (!u.fixed) return u;
      return {
        ...u,
        fixed: {
          ...u.fixed,
          habit,
          coins: u.fixed.coins + coins,
          events: [...u.fixed.events, ...events],
          pending: u.fixed.pending.filter((p) => p.expiresAt > t),
          cancelling: cancelExpired ? false : u.fixed.cancelling,
          notice: cancelExpired
            ? 'キャンセルが承認されないまま期限を過ぎたため、予定はそのまま続きます'
            : u.fixed.notice ?? null,
        },
      };
    });
  }, [now, updateUser]);
  const active = !!fixed;
  useEffect(() => {
    if (!active) return;
    evaluateFixed();
    const id = setInterval(evaluateFixed, 60_000);
    return () => clearInterval(id);
  }, [active, evaluateFixed]);

  const updateFixed = useCallback(
    (fn) => updateUser((u) => (u.fixed ? { ...u, fixed: fn(u.fixed) } : u)),
    [updateUser],
  );

  // 予定をサーバーに作って、固定時間モードを始める（自分でロックするモードのコイン・スライムはリセット）
  const startFixed = useCallback(async () => {
    const draft = user.fixedDraft;
    if (!draft?.entries.length) return;
    const domainOf = (name) => user.customApps.find((a) => a.name === name)?.domain;
    const entries = draft.entries.map((e) => ({ ...e, apps: e.apps.map((name) => ({ name, domain: domainOf(name) })) }));
    let result;
    try {
      result = await setupFixedSchedule(entries, draft.progress ?? {});
    } catch (e) {
      updateUser((u) => ({ ...u, fixedDraft: { ...u.fixedDraft, progress: e.progress ?? u.fixedDraft?.progress } }));
      throw e;
    }
    const t = now();
    const { settings } = result;
    updateUser((u) => ({
      ...u,
      mode: 'fixed',
      fixedDraft: null,
      // 自分でロックするモードの成長とコインは引き継がない
      coins: 0,
      habit: null,
      habitEvents: [],
      activeLocks: [],
      finishedLocks: [],
      fixed: {
        schedule: draft.entries,
        ruleIds: result.rules,
        purpose: draft.purpose ?? null,
        habit: { ...newHabit(null, t), startedAt: t },
        events: [],
        coins: 0,
        unlockTickets: 0,
        unlocks: [],
        unlockMinutes: settings.unlockMinutes,
        pending: settings.pendingChange ? [{ ...settings.pendingChange, kind: 'settings' }] : [],
        cancelling: false,
        notice: null,
      },
    }));
  }, [user.fixedDraft, user.customApps, now, updateUser]);

  // 一時解除を使う（チケットを1枚使う。今日は失敗になる）
  const startUnlock = useCallback(async () => {
    if (!fixedRef.current || fixedRef.current.unlockTickets <= 0) return;
    const unlock = await requestUnlock();
    updateFixed((f) => ({ ...f, unlockTickets: f.unlockTickets - 1, unlocks: [...f.unlocks, unlock] }));
  }, [updateFixed]);

  // 予定をキャンセルする（サーバーでは反映待ちになり、翌朝以降に承認すると消える）
  const cancelFixed = useCallback(async () => {
    const f = fixedRef.current;
    if (!f) return;
    const done = f.pending.filter((p) => p.kind === 'cancel');
    let pending;
    try {
      pending = await cancelFixedSchedule(Object.values(f.ruleIds), done);
    } catch (e) {
      const partial = (e.progress ?? []).map((p) => ({ ...p, kind: 'cancel' }));
      updateFixed((x) => ({ ...x, pending: [...x.pending.filter((p) => p.kind !== 'cancel'), ...partial] }));
      throw e;
    }
    updateFixed((x) => ({
      ...x,
      cancelling: true,
      pending: [...x.pending.filter((p) => p.kind !== 'cancel'), ...pending.map((p) => ({ ...p, kind: 'cancel' }))],
    }));
  }, [updateFixed]);

  // 承認できるようになった変更をまとめて承認する。キャンセルが全部反映されたらモードを選び直す
  const approvePending = useCallback(async () => {
    const f = fixedRef.current;
    if (!f) return;
    const t = now();
    const approved = [];
    const gone = [];
    let error = null;
    for (const p of f.pending.filter((x) => x.approvableFrom <= t)) {
      try {
        if (p.id) await approvePendingChange(p.id);
        approved.push(p.id);
      } catch (e) {
        // 期限切れ（または見つからない）ものは一覧から外す
        if (e instanceof ApiError && (e.status === 410 || e.status === 404)) gone.push(p.id);
        else error = e;
      }
    }
    const settingsApproved = f.pending.some((p) => p.kind === 'settings' && approved.includes(p.id));
    updateUser((u) => {
      if (!u.fixed) return u;
      const rest = u.fixed.pending.filter((p) => !approved.includes(p.id) && !gone.includes(p.id));
      const cancelDone = u.fixed.cancelling && !rest.some((p) => p.kind === 'cancel');
      const cancelLost = u.fixed.pending.some((p) => p.kind === 'cancel' && gone.includes(p.id));
      // キャンセルが全部反映された → 予定は消えたので、もう一度モードを選ぶ
      if (cancelDone && !cancelLost) return { ...u, mode: null, fixed: null };
      return {
        ...u,
        fixed: {
          ...u.fixed,
          pending: rest,
          cancelling: cancelLost ? false : u.fixed.cancelling,
          unlockMinutes: settingsApproved ? UNLOCK_SETTINGS.unlockMinutes : u.fixed.unlockMinutes,
          notice: cancelLost ? 'キャンセルの承認期限を過ぎていたため、予定はそのまま続きます' : u.fixed.notice ?? null,
        },
      };
    });
    if (error) throw error;
  }, [now, updateUser]);

  return {
    fixed,
    fixedEvents: fixed?.events ?? NO_EVENTS,
    startFixed,
    startUnlock,
    cancelFixed,
    approvePending,
    evaluateFixed,
    chooseTimerMode: () => updateUser((u) => ({ ...u, mode: 'timer' })),
    saveFixedDraft: (entries) =>
      updateUser((u) => ({ ...u, fixedDraft: { ...u.fixedDraft, entries, progress: u.fixedDraft?.progress ?? null } })),
    setFixedDraftPurpose: (purpose) =>
      updateUser((u) => ({ ...u, fixedDraft: { entries: [], progress: null, ...u.fixedDraft, purpose } })),
    // 始めた後も目的は変えられる（ブロックの決まりには関係しないので）
    setFixedPurpose: (purpose) => updateFixed((f) => ({ ...f, purpose })),
    dismissFixedEvents: () => updateFixed((f) => ({ ...f, events: [] })),
    dismissFixedNotice: () => updateFixed((f) => ({ ...f, notice: null })),
    buyUnlockTicket: () =>
      updateFixed((f) =>
        f.coins >= UNLOCK_PRICE && f.unlockTickets < MAX_UNLOCK_TICKETS
          ? { ...f, coins: f.coins - UNLOCK_PRICE, unlockTickets: f.unlockTickets + 1 }
          : f,
      ),
    ...(import.meta.env.DEV && {
      devFixedCoins: (n) => updateFixed((f) => ({ ...f, coins: f.coins + n })),
      // 承認待ちの変更を、今すぐ承認できるようにする（モックのサーバーとこの端末の両方）
      devFixedApprovable: () => {
        devMakeApprovable();
        updateFixed((f) => ({ ...f, pending: f.pending.map((p) => ({ ...p, approvableFrom: Date.now() - 60_000 })) }));
      },
      // 予定のある1日分の成功／失敗をその場で反映する
      devFixedDay: (ok) =>
        updateFixed((f) => {
          const day = f.habit.settledUntil - 86_400_000;
          const { habit, event } = applyDay(f.habit, ok, day, { tickets: false });
          return { ...f, habit: { ...habit, settledUntil: f.habit.settledUntil }, events: [...f.events, { ...event, coins: 0 }] };
        }),
    }),
  };
}

