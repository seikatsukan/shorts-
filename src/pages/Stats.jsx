import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { AppIcon, Sheet } from '../components/ui';
import { fetchRecords } from '../storage';
import { OTHER_COLOR, formatClock, formatMinutes, getChartColor } from '../data/apps';

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
const MAX_SEGMENTS = 8; // これを超えるアプリは「その他」にまとめる

// ---- 日付ユーティリティ ----
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7)); // 月曜始まり
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

function getPeriod(tab, offset, today) {
  if (tab === 'week') {
    const start = addDays(startOfWeek(today), offset * 7);
    const end = addDays(start, 7);
    return { start, end, label: `${md(start)}(月) 〜 ${md(addDays(end, -1))}(日)` };
  }
  const start = addMonths(startOfMonth(today), offset);
  return { start, end: addMonths(start, 1), label: `${start.getFullYear()}年${start.getMonth() + 1}月` };
}

// 保存先の記録（1回のスタート単位）を、アプリ1つずつの行に展開する
const toItems = (records) =>
  records.flatMap((r) => {
    const startAt = Date.parse(r.startedAt);
    return r.apps.map((a) => ({
      id: `${r.id}-${a.name}`,
      name: a.name,
      minutes: a.minutes,
      purpose: r.purpose,
      startAt,
      endAt: startAt + a.minutes * 60_000,
    }));
  });

// 保存先から期間内の記録を取得する
function useRecords(from, to) {
  const { userId } = useApp();
  const [result, setResult] = useState({ key: null, records: [], error: null });
  const fromTime = from.getTime();
  const toTime = to.getTime();
  const key = `${userId}-${fromTime}-${toTime}`;
  useEffect(() => {
    let cancelled = false;
    fetchRecords({ userId, from: new Date(fromTime), to: new Date(toTime) })
      .then(({ records }) => !cancelled && setResult({ key, records: toItems(records), error: null }))
      .catch(() => !cancelled && setResult({ key, records: [], error: '記録を取得できませんでした' }));
    return () => {
      cancelled = true;
    };
  }, [userId, fromTime, toTime, key]);
  // 取得済みの期間と違えば読み込み中（前の期間の表示を残したまま待つ）
  return { ...result, loading: result.key !== key };
}

// アプリごとの合計時間（多い順）
function summarize(records) {
  const totals = new Map();
  records.forEach((r) => totals.set(r.name, (totals.get(r.name) ?? 0) + r.minutes));
  const rows = [...totals]
    .map(([name, minutes]) => ({ name, minutes, color: getChartColor(name) }))
    .sort((a, b) => b.minutes - a.minutes);
  if (rows.length <= MAX_SEGMENTS) return rows;
  const rest = rows.slice(MAX_SEGMENTS - 1);
  return [
    ...rows.slice(0, MAX_SEGMENTS - 1),
    { name: 'その他', minutes: rest.reduce((s, r) => s + r.minutes, 0), color: OTHER_COLOR, other: true },
  ];
}

export default function Stats() {
  const navigate = useNavigate();
  const { now } = useApp();
  const today = new Date(now());

  const [tab, setTab] = useState('week');
  const [offset, setOffset] = useState(0);
  const [activeApp, setActiveApp] = useState(null);

  const period = getPeriod(tab, offset, today);
  const { records, loading, error } = useRecords(period.start, period.end);
  const rows = summarize(records);
  const total = rows.reduce((s, r) => s + r.minutes, 0);

  const switchTab = (next) => {
    setTab(next);
    setOffset(0);
    setActiveApp(null);
  };
  const movePeriod = (delta) => {
    setOffset((o) => o + delta);
    setActiveApp(null);
  };

  return (
    <div className="screen stats-screen">
      <header className="top-bar">
        <button
          className="icon-button"
          // メイン画面から来た時は履歴を戻る（戻るボタンでまとめ画面に戻らないように）
          onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/home', { replace: true }))}
          aria-label="閉じる"
        >
          <X size={24} />
        </button>
        <h2 className="top-bar-title">まとめ</h2>
        <div style={{ width: 40 }} />
      </header>

      {/* 今週 / 今月 */}
      <section className="card">
        <div className="segmented">
          <button className={tab === 'week' ? 'active' : ''} onClick={() => switchTab('week')}>
            週
          </button>
          <button className={tab === 'month' ? 'active' : ''} onClick={() => switchTab('month')}>
            月
          </button>
        </div>

        <div className="period-nav">
          <button className="icon-button small" onClick={() => movePeriod(-1)} aria-label="前へ">
            <ChevronLeft size={20} />
          </button>
          <span>{offset === 0 ? (tab === 'week' ? '今週' : '今月') : period.label}</span>
          <button
            className="icon-button small"
            onClick={() => movePeriod(1)}
            disabled={offset >= 0}
            aria-label="次へ"
          >
            <ChevronRight size={20} />
          </button>
        </div>
        {offset === 0 && <p className="period-label">{period.label}</p>}

        <div className="usage-total">
          <span className="usage-total-value">{formatMinutes(total)}</span>
          <span className="usage-total-label">制限した合計</span>
        </div>

        {error ? (
          <p className="empty-text">{error}</p>
        ) : loading && total === 0 ? (
          <p className="empty-text">読み込み中…</p>
        ) : total === 0 ? (
          // 今週・今月が空の時は、ロックすると記録されることを伝える
          <p className="empty-text">
            {offset === 0 ? (
              <>
                まだ記録がありません
                <br />
                ロックすると、ここに記録されます
              </>
            ) : (
              'この期間の記録はありません'
            )}
          </p>
        ) : (
          <>
            {/* 全体を1本のバーで表示（Googleストレージ風） */}
            <div className="usage-bar" role="img" aria-label="アプリ別の制限時間の内訳">
              {rows.map((r) => (
                <button
                  key={r.name}
                  className={`usage-segment${activeApp && activeApp !== r.name ? ' dim' : ''}`}
                  style={{ flexGrow: r.minutes, background: r.color }}
                  onClick={() => setActiveApp(activeApp === r.name ? null : r.name)}
                  aria-label={`${r.name} ${formatMinutes(r.minutes)}`}
                />
              ))}
            </div>

            {/* アプリ別の内訳 */}
            <ul className="usage-list">
              {rows.map((r) => {
                const pct = Math.round((r.minutes / total) * 100);
                return (
                  <li
                    key={r.name}
                    className={`usage-row${activeApp && activeApp !== r.name ? ' dim' : ''}`}
                    onClick={() => setActiveApp(activeApp === r.name ? null : r.name)}
                  >
                    <span className="legend-dot" style={{ background: r.color }} />
                    <span className="usage-name">{r.name}</span>
                    <span className="usage-value">{formatMinutes(r.minutes)}</span>
                    <span className="usage-pct">{pct}%</span>
                    <div className="usage-meter">
                      <div style={{ width: `${(r.minutes / rows[0].minutes) * 100}%`, background: r.color }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <Calendar today={today} />
    </div>
  );
}

function Calendar({ today }) {
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [selectedDay, setSelectedDay] = useState(null);
  const { records, loading } = useRecords(month, addMonths(month, 1));

  // 日付ごとの記録
  const byDay = useMemo(() => {
    const map = new Map();
    records.forEach((r) => {
      const key = dayKey(r.startAt);
      map.set(key, [...(map.get(key) ?? []), r]);
    });
    return map;
  }, [records]);

  const firstWeekday = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];
  const todayKey = dayKey(today);
  const isCurrentMonth = month.getTime() === startOfMonth(today).getTime();

  const dayRecords = selectedDay ? [...(byDay.get(dayKey(selectedDay)) ?? [])].sort((a, b) => a.startAt - b.startAt) : [];
  const dayTotal = dayRecords.reduce((s, r) => s + r.minutes, 0);

  return (
    <section className="card">
      <div className="calendar-header">
        <button className="icon-button small" onClick={() => setMonth(addMonths(month, -1))} aria-label="前の月">
          <ChevronLeft size={20} />
        </button>
        <h3>
          {month.getFullYear()}年{month.getMonth() + 1}月
        </h3>
        <button
          className="icon-button small"
          onClick={() => setMonth(addMonths(month, 1))}
          disabled={isCurrentMonth}
          aria-label="次の月"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className={`calendar-grid${loading ? ' loading' : ''}`}>
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={`weekday${i === 5 ? ' sat' : i === 6 ? ' sun' : ''}`}>
            {w}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`empty-${i}`} />;
          const key = dayKey(date);
          const recs = byDay.get(key) ?? [];
          const apps = [...new Set(recs.map((r) => r.name))];
          const isFuture = date > today;
          return (
            <button
              key={key}
              className={`cal-day${key === todayKey ? ' today' : ''}${recs.length ? ' has-record' : ''}`}
              disabled={isFuture}
              onClick={() => setSelectedDay(date)}
            >
              <span className="cal-num">{date.getDate()}</span>
              <span className="cal-dots">
                {apps.slice(0, 3).map((name) => (
                  <span key={name} style={{ background: getChartColor(name) }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <Sheet
          title={`${selectedDay.getMonth() + 1}月${selectedDay.getDate()}日(${WEEKDAYS[(selectedDay.getDay() + 6) % 7]})`}
          onClose={() => setSelectedDay(null)}
        >
          {dayRecords.length === 0 ? (
            <p className="empty-text">この日の記録はありません</p>
          ) : (
            <>
              <p className="day-total">
                合計 <strong>{formatMinutes(dayTotal)}</strong> 制限
              </p>
              <ul className="day-list">
                {dayRecords.map((r) => (
                  <li key={r.id} className="day-item">
                    <AppIcon name={r.name} size={36} />
                    <div className="day-item-body">
                      <div className="day-item-top">
                        <span className="day-item-name">{r.name}</span>
                        <span className="day-item-min">{formatMinutes(r.minutes)}</span>
                      </div>
                      <div className="day-item-sub">
                        <span>
                          {formatClock(r.startAt)} 〜 {formatClock(r.endAt)}
                        </span>
                        {r.purpose && <span className="purpose-chip">🎯 {r.purpose}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Sheet>
      )}
    </section>
  );
}
