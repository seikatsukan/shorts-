import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ellipsis, X, LogOut, ChartBar, Plus, Lock, Target, CalendarClock } from 'lucide-react';
import { useApp, useNow } from '../store/AppContext';
import { AppIcon, ErrorBoundary, Sheet } from '../components/ui';
import { ColorTrack, HabitReport } from '../components/habitUi';
import { InstallHint } from '../components/InstallHint';
import { formatCountdown, formatClock, formatMinutes } from '../data/apps';
import { PurposeSheet } from '../components/PurposeSheet';
import {
  COLORS, GOAL_OPTIONS, MAX_EXTRA_TICKETS, MAX_STAGE, STEP_DAYS, TICKET_PRICE,
  dayStart, hasCrown, hasTicket, minutesOnDay, nextDay, ticketCount,
} from '../habit';

// 3D（three.js）は重いので、画面を先に出してからキャラだけ後で読み込む
const SlimeCanvas = lazy(() => import('../components/Slime'));

// お休みチケットを食べる演出
const SNACK_FIRST_DELAY = 0.6; // 画面が見えてから1枚目が飛び始めるまで（秒。気づけるように少し待つ）
const SNACK_INTERVAL = 0.45; // 2枚目以降の間隔（秒）
const SNACK_GIVE_UP = 15; // 画面が見えているのに終わらない時に、食べたことにして先へ進むまで（秒）

export default function Home() {
  const navigate = useNavigate();
  const {
    coins, activeLocks, completed, dismissCompleted, startDraft, logOut,
    habit, lockRanges, habitEvents, dismissHabitEvents, markTicketsEaten, setGoal, setPurpose, evaluateHabit, buyTicket,
  } = useApp();
  const now = useNow();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  // 1日の目標を決める画面（まだ決めていなければ最初から開く）
  const [goalOpen, setGoalOpen] = useState(!habit);
  // 目的を決める画面（1日の目標を決めた後に続けて開く。スキップできる）
  const [purposeOpen, setPurposeOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);

  // お休みチケットを使った時は、お知らせを出す前にスライムがチケットを食べる
  // - 判定の結果は保存されているので、食べる前にアプリを閉じても次に開いた時に食べる
  // - 画面が裏に回っている間は止まり（描画が止まるため）、見えるようになってから飛ぶ
  // - 何枚か使った時は少し間をあけて順番に。「おめでとう」が出ている間は待つ
  const snacks = completed
    ? []
    : habitEvents
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.type === 'ticket' && !e.eaten)
        .map(({ i }, n) => ({ id: i, delay: SNACK_FIRST_DELAY + n * SNACK_INTERVAL }));
  const pendingSnacks = snacks.map((x) => x.id).join(',');
  const skipSnacks = () => markTicketsEaten(snacks.map((x) => x.id));
  // 3D が表示できない時も、お知らせが出ないままにならないように
  // （読み込みに失敗した時はすぐ、画面が見えている状態で長く終わらない時は SNACK_GIVE_UP 秒後に先へ進む）
  const [modelFailed, setModelFailed] = useState(false);
  const skipRef = useRef(skipSnacks);
  useEffect(() => {
    skipRef.current = skipSnacks;
  });
  useEffect(() => {
    if (!pendingSnacks) return;
    if (modelFailed) {
      skipRef.current();
      return;
    }
    let timer;
    const restart = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') timer = setTimeout(() => skipRef.current(), SNACK_GIVE_UP * 1000);
    };
    restart();
    document.addEventListener('visibilitychange', restart);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', restart);
    };
  }, [pendingSnacks, modelFailed]);

  // 今日の進み具合（実際に経過した分 / 今のロックが終わるまで含めた分）を毎秒計算する
  const today = dayStart(now);
  const elapsed = minutesOnDay(lockRanges, today, now);
  const planned = minutesOnDay(lockRanges, today, nextDay(today));
  const todayDone = !!habit && habit.settledUntil > today;
  // 目標に届いたらすぐ判定する（1分ごとの判定を待たずに「達成」にする）
  const reached = !!habit && elapsed >= habit.goal;
  useEffect(() => {
    if (reached && !todayDone) evaluateHabit();
  }, [reached, todayDone, evaluateHabit]);

  const startWizard = () => {
    // 今の履歴位置を覚えておき、ロック開始後はここまで戻る（戻るボタンで入力途中の画面に戻らないように）
    startDraft(window.history.state?.idx ?? null);
    navigate('/select-app');
  };

  const handleLogout = () => {
    setIsMenuOpen(false);
    logOut();
    navigate('/', { replace: true });
  };

  const sortedLocks = [...activeLocks].sort((a, b) => a.endAt - b.endAt);

  return (
    <div className="screen home-screen">
      <header className="top-bar">
        <button className="icon-button" onClick={() => setIsMenuOpen(true)} aria-label="メニュー">
          <Ellipsis size={24} />
        </button>
        <div className="coin-chip">🪙 {coins}</div>
      </header>

      {/* メニュー（左から開く） */}
      {isMenuOpen && (
        <div className="drawer-overlay" onClick={() => setIsMenuOpen(false)}>
          <nav className="drawer" onClick={(e) => e.stopPropagation()}>
            <button className="icon-button" onClick={() => setIsMenuOpen(false)} aria-label="閉じる">
              <X size={24} />
            </button>
            <button className="menu-item" onClick={() => navigate('/stats')}>
              <ChartBar size={20} /> 週/月のまとめ
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setIsMenuOpen(false);
                setGoalOpen(true);
              }}
            >
              <Target size={20} /> 1日の目標と目的
            </button>
            {/* 固定時間へはいつでも移れる（スライムの成長とコインはリセット。予定の画面で知らせる） */}
            <button className="menu-item" onClick={() => navigate('/fixed-setup')}>
              <CalendarClock size={20} /> 固定時間で自動ロックにする
            </button>
            <button className="menu-item" onClick={handleLogout}>
              <LogOut size={20} /> ログアウト
            </button>
          </nav>
        </div>
      )}

      {/* キャラクター（毎日の目標を続けると色が変わる。タップするとジャンプ） */}
      <div className="model-container" onClick={() => setTapCount((c) => c + 1)}>
        <ErrorBoundary fallback={null} onError={() => setModelFailed(true)}>
          <Suspense fallback={<div className="model-loading" />}>
            <SlimeCanvas
              colorStage={habit?.stage ?? 0}
              crown={hasCrown(habit)}
              walking={sortedLocks.length > 0}
              celebrating={!!completed}
              tapCount={tapCount}
              snacks={snacks}
              onSnackEaten={(id) => markTicketsEaten([id])}
            />
          </Suspense>
        </ErrorBoundary>
      </div>

      <InstallHint />

      {habit ? (
        <HabitPanel
          habit={habit}
          elapsed={elapsed}
          planned={planned}
          done={todayDone}
          now={now}
          onTicket={() => setTicketOpen(true)}
        />
      ) : (
        <button className="goal-cta" onClick={() => setGoalOpen(true)}>
          🎯 1日の目標を決めよう
        </button>
      )}

      {/* 開発中（npm run dev）だけ表示するテスト用ボタン。本番のビルドには入らない */}
      {import.meta.env.DEV && <DevTools />}

      {/* ロック中のアプリ */}
      {sortedLocks.length > 0 && (
        <section className="card lock-list">
          <h3 className="card-title">
            <Lock size={16} /> ロック中
          </h3>
          {sortedLocks.map((lock) => (
            <div key={lock.id} className="lock-row">
              <AppIcon name={lock.name} size={36} />
              <div className="lock-info">
                <span className="lock-name">{lock.name}</span>
                <span className="lock-sub">{formatClock(lock.endAt)} に解除</span>
              </div>
              <span className="countdown">{formatCountdown(lock.endAt - now)}</span>
            </div>
          ))}
        </section>
      )}

      <div className="home-actions">
        {sortedLocks.length > 0 ? (
          <button className="secondary-button" onClick={startWizard}>
            <Plus size={18} /> ロック追加
          </button>
        ) : (
          <button className="primary-button" onClick={startWizard}>
            <Lock size={18} /> ロックする
          </button>
        )}
      </div>

      {/* ロック終了：おめでとう */}
      {completed && (
        <div className="modal-overlay">
          <div className="modal result-modal">
            <p className="result-emoji">🎉</p>
            <h2>おめでとう！</h2>
            <p className="result-sub">ロックをやりきりました</p>
            <ul className="result-list">
              {completed.locks.map((l) => (
                <li key={l.id}>
                  <AppIcon name={l.name} size={28} />
                  <span>{l.name}</span>
                  <span className="result-time">{formatMinutes(l.minutes)}</span>
                </li>
              ))}
            </ul>
            <p className="result-coins">🪙 {completed.coins} コイン獲得！</p>
            <button className="primary-button" onClick={dismissCompleted}>
              OK
            </button>
          </div>
        </div>
      )}

      {/* 毎日の目標の結果（「おめでとう」を閉じて、チケットを食べ終わった後に出す） */}
      {!completed && snacks.length === 0 && habitEvents.length > 0 && (
        <HabitReport events={habitEvents} onClose={dismissHabitEvents} />
      )}

      {ticketOpen && habit && (
        <TicketSheet habit={habit} coins={coins} now={now} onBuy={buyTicket} onClose={() => setTicketOpen(false)} />
      )}

      {goalOpen && (
        <GoalSheet
          current={habit?.goal}
          onSelect={(goal) => {
            setGoal(goal);
            setGoalOpen(false);
            setPurposeOpen(true);
          }}
          onClose={() => setGoalOpen(false)}
        />
      )}

      {purposeOpen && (
        <PurposeSheet
          current={habit?.purpose ?? null}
          onSelect={(purpose) => {
            setPurpose(purpose);
            setPurposeOpen(false);
          }}
          onClose={() => setPurposeOpen(false)}
        />
      )}
    </div>
  );
}

// 今日の目標（いちばん大きく）・連続日数・色の段階・お休みチケット
function HabitPanel({ habit, elapsed, planned, done, now, onTicket }) {
  const isSilver = habit.stage === MAX_STAGE;
  const goal = habit.goal;
  const locking = planned > elapsed + 0.01; // 今ロック中（この先の分が残っている）
  const remain = Math.max(1, Math.ceil(goal - elapsed));
  let hint;
  if (done) hint = '✓ 今日の目標を達成しました';
  else if (locking && planned >= goal) hint = `ロック中… あと ${remain}分で達成`;
  else if (locking) hint = `ロック中。終わってもあと ${Math.ceil(goal - planned)}分 足りません`;
  else hint = `あと ${remain}分 ロックすると今日の目標を達成`;

  return (
    <section className="habit-card">
      {/* 今日の目標 */}
      <div className={`today${done ? ' done' : ''}`}>
        <div className="today-head">
          <span className="today-label">
            今日の目標
            {habit.purpose && <span className="today-purpose">🎯 {habit.purpose}のため</span>}
          </span>
          <span className="today-value">
            {done ? '達成！' : (
              <>
                <strong>{Math.floor(elapsed)}</strong> / {formatMinutes(goal)}
              </>
            )}
          </span>
        </div>
        <div className="today-bar">
          {/* 薄い部分は、今のロックが終わるまでに増える分 */}
          {!done && <div className="planned" style={{ width: `${Math.min(1, planned / goal) * 100}%` }} />}
          <div className="elapsed" style={{ width: `${done ? 100 : Math.min(1, elapsed / goal) * 100}%` }} />
        </div>
        <p className="today-hint">{hint}</p>
      </div>

      <div className="habit-bottom">
        <div className="habit-top">
          <span className="habit-streak">🔥 {habit.streak}日連続</span>
          <span className="habit-next">
            {isSilver ? (
              '銀色をキープ中！'
            ) : (
              <>
                あと <strong>{STEP_DAYS[habit.stage] - habit.progress}日</strong> で
                <span className="next-dot" style={{ background: COLORS[habit.stage + 1].hex }} />
                {COLORS[habit.stage + 1].name}
              </>
            )}
          </span>
          <button className="habit-ticket" onClick={onTicket} aria-label="お休みチケット">
            🎫 {ticketCount(habit, now)}
          </button>
        </div>
        <ColorTrack stage={habit.stage} progress={habit.progress} done={done} />
      </div>
    </section>
  );
}

// お休みチケット（コインで買える）
function TicketSheet({ habit, coins, now, onBuy, onClose }) {
  const extra = habit.extraTickets ?? 0;
  const full = extra >= MAX_EXTRA_TICKETS;
  const short = coins < TICKET_PRICE;
  return (
    <Sheet title="🎫 お休みチケット" onClose={onClose}>
      <p className="sheet-desc">
        目標に届かなかった日を自動で守ります（色も連続記録もそのまま）。今週の無料チケットから先に使います。
      </p>
      <ul className="ticket-list">
        <li>
          <span>今週の無料チケット</span>
          <strong>{hasTicket(habit, now) ? '1枚' : '使用済み'}</strong>
        </li>
        <li className="ticket-note">毎週月曜に1枚もらえます（持ち越しはできません）</li>
        <li>
          <span>コインで買ったチケット</span>
          <strong>
            {extra} / {MAX_EXTRA_TICKETS}枚
          </strong>
        </li>
      </ul>
      <button className="primary-button full" onClick={onBuy} disabled={full || short}>
        🪙 {TICKET_PRICE} で1枚買う
      </button>
      <p className="sheet-note">
        {full
          ? `これ以上は持てません（${MAX_EXTRA_TICKETS}枚まで）`
          : short
            ? `コインが足りません（今 ${coins}枚）。ロックをやりきるとコインがもらえます`
            : `持っているコイン: ${coins}枚`}
      </p>
    </Sheet>
  );
}

// 1日の目標を決める
function GoalSheet({ current, onSelect, onClose }) {
  const isCustom = current && !GOAL_OPTIONS.includes(current);
  const [showCustom, setShowCustom] = useState(isCustom);
  const [custom, setCustom] = useState(isCustom ? String(current) : '');
  const parsed = Number(custom);
  const customValid = Number.isInteger(parsed) && parsed >= 10 && parsed <= 720;

  return (
    <Sheet title="1日の目標" onClose={onClose}>
      <p className="sheet-desc">
        1日にこの時間ロックできたら「成功」。続けるとスライムの色が変わり、21日続けると銀色になります。
      </p>
      <div className="option-grid">
        {GOAL_OPTIONS.map((m) => (
          <button key={m} className={`option${current === m ? ' active' : ''}`} onClick={() => onSelect(m)}>
            {formatMinutes(m)}
          </button>
        ))}
        <button className={`option${showCustom ? ' active' : ''}`} onClick={() => setShowCustom(true)}>
          カスタム
        </button>
      </div>
      {showCustom && (
        <div className="custom-input-row">
          <input
            type="number"
            inputMode="numeric"
            min="10"
            max="720"
            placeholder="10〜720"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            autoFocus
          />
          <span>分</span>
          <button className="primary-button small" disabled={!customValid} onClick={() => onSelect(parsed)}>
            決定
          </button>
        </div>
      )}
      {current && <p className="sheet-note">変更した目標は今日の判定から使われます。</p>}
    </Sheet>
  );
}

// 開発中（npm run dev）だけ表示するテスト用ボタン
function DevTools() {
  const { habit, devAddCoins, devHabitDay } = useApp();
  return (
    <div className="dev-tools">
      <button onClick={() => devAddCoins(10)}>🧪 コイン+10</button>
      <button onClick={() => devHabitDay(true)} disabled={!habit}>
        🧪 1日成功
      </button>
      <button onClick={() => devHabitDay(false)} disabled={!habit}>
        🧪 1日失敗
      </button>
    </div>
  );
}
