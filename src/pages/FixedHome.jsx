import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, CalendarX, Cloud, Ellipsis, LockOpen, LogOut, Plus, Target, X } from 'lucide-react';
import { useApp, useNow } from '../store/AppContext';
import { AppIcon, ErrorBoundary, Sheet } from '../components/ui';
import { ColorTrack, HabitReport } from '../components/habitUi';
import { InstallHint } from '../components/InstallHint';
import { PurposeSheet } from '../components/PurposeSheet';
import { EntrySheet } from './FixedSetup';
import { DEFAULT_APPS, formatClock, formatCountdown } from '../data/apps';
import { uuid } from '../utils';
import { COLORS, MAX_STAGE, STEP_DAYS, dayStart, hasCrown } from '../habit';
import {
  DAY_LABELS, MAX_UNLOCK_TICKETS, UNLOCK_PRICE, UNLOCK_SETTINGS, activeOccurrences, formatDays, formatTimeRange, nextOccurrence,
  occurrencesOn,
} from '../fixed';

const SlimeCanvas = lazy(() => import('../components/Slime'));

const formatDate = (t) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}（${DAY_LABELS[d.getDay()]}）${formatClock(t)}`;
};

// 固定時間で自動ロックのメイン画面
export default function FixedHome() {
  const navigate = useNavigate();
  const {
    fixed, fixedEvents, dismissFixedEvents, dismissFixedNotice, buyUnlockTicket, startUnlock, cancelFixed,
    approvePending, withdrawCancel, setFixedPurpose, addFixedEntry, customApps, logOut,
  } = useApp();
  const now = useNow();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  // 開いているポップアップ: 'shop' / 'unlock' / 'schedule' / 'add-entry' / 'add-confirm' / 'purpose' / 'cancel' / 'cancel-done' / 'withdraw' / null
  // 予定を足す時は「ロックの予定」→ 入力（add-entry）→ 確認（add-confirm）の順に開く
  const [popup, setPopup] = useState(null);
  const [newEntry, setNewEntry] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!fixed) return null;
  const { habit, schedule } = fixed;
  const today = dayStart(now);

  const active = activeOccurrences(schedule, now);
  const current = fixed.unlocks.find((u) => u.endsAt > now) ?? null;
  const unlocking = current && current.startsAt <= now;
  const locked = active.length > 0 && !unlocking;
  // 今日の予定（前の日から続いているものも含める）
  const todayList = [
    ...occurrencesOn(schedule, today - 1).filter((o) => o.end > today),
    ...occurrencesOn(schedule, today),
  ];
  const usedToday = fixed.unlocks.some((u) => u.requestedAt >= today);
  const next = nextOccurrence(schedule, now);
  const settledToday = habit.settledUntil > today;
  const cancelPending = fixed.pending.filter((p) => p.kind === 'cancel');
  const settingsPending = fixed.pending.find((p) => p.kind === 'settings');
  const approvable = fixed.pending.some((p) => p.approvableFrom <= now);
  // キャンセルを承認できる時間（予定ごとの反映待ちを全部承認できる間）
  const cancelWindow = cancelPending.length > 0 && {
    from: Math.max(...cancelPending.map((p) => p.approvableFrom)),
    until: Math.min(...cancelPending.map((p) => p.expiresAt)),
  };
  // キャンセルを申請している間は予定を足せない
  const canAddEntry = !fixed.cancelling && cancelPending.length === 0;

  // 成功したら true（ポップアップは閉じる）
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPopup(null);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = () => {
    setIsMenuOpen(false);
    logOut();
    navigate('/', { replace: true });
  };

  let todayHint;
  if (todayList.length === 0) todayHint = next ? `今日はロックの予定はありません。次は ${formatDate(next.start)}` : '';
  else if (usedToday) todayHint = '今日は一時解除を使ったので、今日の判定は失敗になります';
  else if (settledToday) todayHint = '✓ 今日のロックを一時解除なしでやりきりました';
  else todayHint = '一時解除を使わずに過ごせば、今日は成功です';

  return (
    <div className="screen home-screen">
      <header className="top-bar">
        <button className="icon-button" onClick={() => setIsMenuOpen(true)} aria-label="メニュー">
          <Ellipsis size={24} />
        </button>
        <div className="coin-chip">🪙 {fixed.coins}</div>
      </header>

      {isMenuOpen && (
        <div className="drawer-overlay" onClick={() => setIsMenuOpen(false)}>
          <nav className="drawer" onClick={(e) => e.stopPropagation()}>
            <button className="icon-button" onClick={() => setIsMenuOpen(false)} aria-label="閉じる">
              <X size={24} />
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setIsMenuOpen(false);
                setPopup('schedule');
              }}
            >
              <CalendarClock size={20} /> ロックの予定
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setIsMenuOpen(false);
                setPopup('purpose');
              }}
            >
              <Target size={20} /> 目的
            </button>
            {!fixed.cancelling && (
              <button
                className="menu-item"
                onClick={() => {
                  setIsMenuOpen(false);
                  setPopup('cancel');
                }}
              >
                <CalendarX size={20} /> 固定時間をキャンセル
              </button>
            )}
            <button className="menu-item" onClick={() => navigate('/connect')}>
              <Cloud size={20} /> Cloudflare の連携
            </button>
            <button className="menu-item" onClick={handleLogout}>
              <LogOut size={20} /> ログアウト
            </button>
          </nav>
        </div>
      )}

      <div className="model-container" onClick={() => setTapCount((c) => c + 1)}>
        <ErrorBoundary fallback={null}>
          <Suspense fallback={<div className="model-loading" />}>
            <SlimeCanvas colorStage={habit.stage} crown={hasCrown(habit)} walking={locked} celebrating={false} tapCount={tapCount} />
          </Suspense>
        </ErrorBoundary>
      </div>

      <InstallHint />

      {/* お知らせ（キャンセルの期限切れなど） */}
      {fixed.notice && (
        <div className="notice-card">
          <p>{fixed.notice}</p>
          <button className="text-button" onClick={dismissFixedNotice}>
            OK
          </button>
        </div>
      )}

      {/* 承認が要る変更（キャンセル・一時解除の設定） */}
      {(cancelPending.length > 0 || settingsPending) && (
        <div className="notice-card pending">
          {cancelPending.length > 0 && (
            <p>
              <strong>固定時間のキャンセルを申請中です。</strong>
              {cancelWindow.from <= now
                ? `${formatDate(cancelWindow.until)} までに「承認する」を押すと予定が消え、もう一度使い方を選べます。過ぎるとキャンセルは取り消されます。`
                : `${formatDate(cancelWindow.from)}〜${formatDate(cancelWindow.until)} の間に「承認する」を押すとキャンセルされます。それまでは予定どおりロックされます。`}
            </p>
          )}
          {settingsPending && (
            <p>
              一時解除を「1回{UNLOCK_SETTINGS.unlockMinutes}分・待ち時間なし」にする設定が承認待ちです
              {settingsPending.approvableFrom > now && `（${formatDate(settingsPending.approvableFrom)} から承認できます）`}。
              それまでは今の設定（1回{fixed.unlockMinutes}分）で一時解除されます。
            </p>
          )}
          <div className="notice-actions">
            {cancelPending.length > 0 && (
              <button className="text-button" disabled={busy} onClick={() => setPopup('withdraw')}>
                キャンセルをやめる
              </button>
            )}
            {approvable && (
              <button className="primary-button small" disabled={busy} onClick={() => run(approvePending)}>
                承認する
              </button>
            )}
          </div>
        </div>
      )}

      {/* 今日のロック */}
      <section className="habit-card">
        <div className={`today fixed-today${settledToday && !usedToday ? ' done' : ''}`}>
          <div className="today-head">
            <span className="today-label">
              今日のロック
              {fixed.purpose && <span className="today-purpose">🎯 {fixed.purpose}のため</span>}
            </span>
            <span className="today-value">{locked ? 'ロック中' : unlocking ? '一時解除中' : ''}</span>
          </div>
          {todayList.length > 0 && (
            <ul className="fixed-list">
              {todayList.map((o) => {
                const isActive = o.start <= now && now < o.end;
                const ended = o.end <= now;
                return (
                  <li key={`${o.entry.id}-${o.start}`} className={isActive ? 'active' : ended ? 'ended' : ''}>
                    <span className="fixed-time">{formatTimeRange(o.entry.start, o.entry.end)}</span>
                    <span className="entry-apps">
                      {o.entry.apps.slice(0, 4).map((name) => (
                        <AppIcon key={name} name={name} size={20} />
                      ))}
                      {o.entry.apps.length > 4 && <span className="entry-more">+{o.entry.apps.length - 4}</span>}
                    </span>
                    <span className="fixed-status">
                      {isActive ? formatCountdown(o.end - now) : ended ? '終了' : 'これから'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="today-hint">{todayHint}</p>
        </div>

        {/* 一時解除 */}
        <div className="unlock-row">
          <button className="habit-ticket" onClick={() => setPopup('shop')} aria-label="一時解除チケット">
            🔓 {fixed.unlockTickets}
          </button>
          {current ? (
            <span className="unlock-status">
              {unlocking
                ? `一時解除中 あと ${formatCountdown(current.endsAt - now)}`
                : `あと ${formatCountdown(current.startsAt - now)} で一時解除`}
            </span>
          ) : (
            <button
              className="secondary-button small"
              disabled={active.length === 0 || fixed.unlockTickets === 0}
              onClick={() => setPopup('unlock')}
            >
              <LockOpen size={16} /> 一時解除する
            </button>
          )}
        </div>

        <div className="habit-bottom">
          <div className="habit-top">
            <span className="habit-streak">🔥 {habit.streak}日連続</span>
            <span className="habit-next">
              {habit.stage === MAX_STAGE ? (
                '銀色をキープ中！'
              ) : (
                <>
                  あと <strong>{STEP_DAYS[habit.stage] - habit.progress}日</strong> で
                  <span className="next-dot" style={{ background: COLORS[habit.stage + 1].hex }} />
                  {COLORS[habit.stage + 1].name}
                </>
              )}
            </span>
          </div>
          <ColorTrack stage={habit.stage} progress={habit.progress} done={settledToday} />
        </div>
      </section>

      {error && <p className="error-box">{error}</p>}

      {import.meta.env.DEV && <FixedDevTools />}

      {fixedEvents.length > 0 && <HabitReport events={fixedEvents} onClose={dismissFixedEvents} fixed />}

      {popup === 'shop' && (
        <Sheet title="🔓 一時解除チケット" onClose={() => setPopup(null)}>
          <p className="sheet-desc">
            ロック中に使うと、{fixed.unlockMinutes}分間すべてのロックが解除されます。使った日は失敗になります。
          </p>
          <ul className="ticket-list">
            <li>
              <span>持っているチケット</span>
              <strong>
                {fixed.unlockTickets} / {MAX_UNLOCK_TICKETS}枚
              </strong>
            </li>
          </ul>
          <button
            className="primary-button full"
            onClick={buyUnlockTicket}
            disabled={fixed.unlockTickets >= MAX_UNLOCK_TICKETS || fixed.coins < UNLOCK_PRICE}
          >
            🪙 {UNLOCK_PRICE} で1枚買う
          </button>
          <p className="sheet-note">
            {fixed.unlockTickets >= MAX_UNLOCK_TICKETS
              ? `これ以上は持てません（${MAX_UNLOCK_TICKETS}枚まで）`
              : fixed.coins < UNLOCK_PRICE
                ? `コインが足りません（今 ${fixed.coins}枚）。一時解除なしでロックをやりきるとコインがもらえます`
                : `持っているコイン: ${fixed.coins}枚`}
          </p>
        </Sheet>
      )}

      {popup === 'unlock' && (
        <Sheet title="一時解除しますか？" onClose={() => setPopup(null)}>
          <ul className="rule-notes">
            <li>チケットを1枚使い、{fixed.unlockMinutes}分間すべてのロックが解除されます。</li>
            <li>
              <strong>今日は失敗になります。</strong>連続記録が0に戻り、スライムの色が1つ下がることがあります。
            </li>
            <li>途中でやめても、チケットは戻りません。</li>
          </ul>
          <button className="primary-button full" disabled={busy} onClick={() => run(startUnlock)}>
            <LockOpen size={18} /> 一時解除する
          </button>
        </Sheet>
      )}

      {popup === 'schedule' && (
        <Sheet title="ロックの予定" onClose={() => setPopup(null)}>
          <ul className="confirm-entries">
            {schedule.map((e) => (
              <li key={e.id}>
                <strong>{formatDays(e.days)}</strong> {formatTimeRange(e.start, e.end)}
                <span>{e.apps.join('・')}</span>
              </li>
            ))}
          </ul>
          {canAddEntry && (
            <button
              className="secondary-button add-entry"
              onClick={() => {
                setNewEntry({ id: uuid(), days: [], start: '22:00', end: '07:00', apps: [] });
                setPopup('add-entry');
              }}
            >
              <Plus size={18} /> 予定を追加
            </button>
          )}
          <p className="sheet-note">
            {canAddEntry
              ? '予定を足すことはいつでもできます。今ある予定は、変えたり外したりできません。'
              : 'キャンセルを申請している間は、予定を足せません。'}
          </p>
        </Sheet>
      )}

      {popup === 'add-entry' && newEntry && (
        <EntrySheet
          key={newEntry.id}
          initial={newEntry}
          allApps={[...DEFAULT_APPS.map((a) => a.name), ...customApps.map((a) => a.name)]}
          onSave={(entry) => {
            setNewEntry(entry);
            setPopup('add-confirm');
          }}
          onClose={() => setPopup('schedule')}
        />
      )}

      {popup === 'add-confirm' && newEntry && (
        <Sheet title="この予定を追加しますか？" onClose={() => setPopup('add-entry')}>
          <ul className="confirm-entries">
            <li>
              <strong>{formatDays(newEntry.days)}</strong> {formatTimeRange(newEntry.start, newEntry.end)}
              <span>{newEntry.apps.join('・')}</span>
            </li>
          </ul>
          <ul className="rule-notes">
            <li>
              <strong>追加した予定は、変えたり外したりできません。</strong>外す時は、固定時間ごとキャンセルします。
            </li>
            <li>追加するとすぐに効きます。今がその時間帯なら、今からロックされます。</li>
            <li>今日の判定には、追加した時刻より後に始まる分から数えます。</li>
          </ul>
          <button className="primary-button full" disabled={busy} onClick={() => run(() => addFixedEntry(newEntry))}>
            <Plus size={18} /> 追加する
          </button>
          {error && <p className="field-error">{error}</p>}
        </Sheet>
      )}

      {popup === 'purpose' && (
        <PurposeSheet
          current={fixed.purpose ?? null}
          description="メイン画面に出す目的です。ロックの決まりには関係しないので、いつでも変えられます。"
          onSelect={(p) => {
            setFixedPurpose(p);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}

      {popup === 'cancel' && (
        <Sheet title="固定時間をキャンセルしますか？" onClose={() => setPopup(null)}>
          <ul className="rule-notes">
            <li>
              <strong>すぐにはキャンセルされません。</strong>明日の朝から承認できるようになり、承認した時点で予定が消えます。
            </li>
            <li>それまでは、今日の残りの予定もいつもどおりロックされます。</li>
            <li>承認しないまま期限を過ぎると、キャンセルは取り消されて予定が続きます。</li>
            <li>キャンセルが反映されたら、もう一度使い方（自分でロック／固定時間）を選びます。今のスライムの成長とコインは引き継げません。</li>
          </ul>
          <button
            className="primary-button full danger"
            disabled={busy}
            onClick={async () => {
              if (await run(cancelFixed)) setPopup('cancel-done');
            }}
          >
            キャンセルを申請する
          </button>
          {error && <p className="field-error">{error}</p>}
        </Sheet>
      )}

      {popup === 'withdraw' && (
        <Sheet title="キャンセルをやめますか？" onClose={() => setPopup(null)}>
          <ul className="rule-notes">
            <li>予定はそのまま続きます。スライムの成長とコインもそのままです。</li>
            <li>もう一度キャンセルする時は、また申請して翌朝以降の承認からになります。</li>
          </ul>
          <button className="primary-button full" disabled={busy} onClick={() => run(withdrawCancel)}>
            キャンセルをやめる
          </button>
          {error && <p className="field-error">{error}</p>}
        </Sheet>
      )}

      {/* 申請した後に、承認できる時間と期限を知らせる */}
      {popup === 'cancel-done' && cancelWindow && (
        <Sheet title="キャンセルを申請しました" onClose={() => setPopup(null)}>
          <ul className="confirm-entries">
            <li>
              <strong>承認できる時間</strong>
              <span>
                {formatDate(cancelWindow.from)} 〜 {formatDate(cancelWindow.until)}
              </span>
            </li>
          </ul>
          <ul className="rule-notes">
            <li>この間にアプリを開いて、メイン画面の「承認する」を押すとキャンセルされます。</li>
            <li>
              <strong>期限を過ぎるとキャンセルは取り消され、</strong>予定はそのまま続きます。
            </li>
            <li>承認するまでは、予定どおりロックされます。</li>
          </ul>
          <button className="primary-button full" onClick={() => setPopup(null)}>
            OK
          </button>
        </Sheet>
      )}

      {busy && (
        <div className="modal-overlay">
          <div className="loading">
            <div className="spinner" />
            <p>サーバーに送信中…</p>
          </div>
        </div>
      )}
    </div>
  );
}

// 開発中（npm run dev）だけ表示するテスト用ボタン
function FixedDevTools() {
  const { devFixedCoins, devFixedDay, devFixedApprovable } = useApp();
  return (
    <div className="dev-tools">
      <button onClick={() => devFixedCoins(15)}>🧪 コイン+15</button>
      <button onClick={() => devFixedDay(true)}>🧪 1日成功</button>
      <button onClick={() => devFixedDay(false)}>🧪 1日失敗</button>
      <button onClick={devFixedApprovable}>🧪 承認できる時刻にする</button>
    </div>
  );
}
