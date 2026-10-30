import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Copy, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { AppIcon, Sheet } from '../components/ui';
import { CustomAppSheet } from './AppSelect';
import { PurposeSheet } from '../components/PurposeSheet';
import { DEFAULT_APPS, formatMinutes } from '../data/apps';
import {
  DAY_LABELS, END_OF_DAY, EVERY_DAY, MAX_UNLOCK_TICKETS, UNLOCK_PRICE, WEEKDAYS, WEEKEND, WEEK_ORDER,
  entryMinutes, formatDays, formatTimeRange, isValidRange,
} from '../fixed';
import { uuid } from '../utils';

// 時間帯のよく使う例（タップすると開始・終了が入る）
const TIME_PRESETS = [
  { label: '夜', start: '22:00', end: '07:00' },
  { label: '朝', start: '06:00', end: '09:00' },
  { label: '日中', start: '09:00', end: '17:00' },
  { label: '夕方', start: '17:00', end: '21:00' },
  { label: '1日中', start: '00:00', end: END_OF_DAY },
];

// 予定がまだ無い時の「ここから始める」例
const SUGGESTIONS = [
  { days: EVERY_DAY, start: '22:00', end: '07:00', note: '寝る前と夜中' },
  { days: WEEKDAYS, start: '09:00', end: '17:00', note: '平日の勉強・仕事中' },
];

// 固定時間で自動ロックの予定を決める（曜日・時間帯・アプリを予定ごとに）
export default function FixedSetup() {
  const navigate = useNavigate();
  const { mode, fixedDraft, saveFixedDraft, setFixedDraftPurpose, startFixed, customApps } = useApp();
  const purpose = fixedDraft?.purpose ?? null;
  const entries = fixedDraft?.entries ?? [];
  const allApps = [...DEFAULT_APPS.map((a) => a.name), ...customApps.map((a) => a.name)];
  // 開いているポップアップ: { type: 'entry', entry } / { type: 'purpose' } / { type: 'confirm' } / null
  // 「この予定で始める」→ 目的（スキップ可）→ 確認 の順に開く
  const [popup, setPopup] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const saveEntry = (entry) => {
    const exists = entries.some((e) => e.id === entry.id);
    saveFixedDraft(exists ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry]);
    setPopup(null);
  };
  const removeEntry = (id) => saveFixedDraft(entries.filter((e) => e.id !== id));

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await startFixed();
      navigate('/home', { replace: true });
    } catch (e) {
      setError(e.message);
      setIsLoading(false);
      setPopup(null);
    }
  };

  return (
    <div className="screen wizard-screen fixed-setup">
      <header className="top-bar">
        <button className="icon-button" onClick={() => navigate(-1)} aria-label="戻る">
          <ChevronLeft size={24} />
        </button>
        <div style={{ width: 40 }} />
      </header>
      <h2 className="page-title">ロックの予定</h2>
      <p className="page-subtitle">決めた曜日・時間帯は、毎週自動でロックされます</p>

      {mode === 'timer' && (
        <p className="error-box align-left small">
          <TriangleAlert size={16} />
          固定時間を始めると、「自分でロック」のスライムの成長とコインはリセットされます。
        </p>
      )}

      {entries.length === 0 ? (
        <section className="card">
          <h3 className="card-label">よく使う予定から始める</h3>
          {SUGGESTIONS.map((s) => (
            <button
              key={s.note}
              className="suggest-row"
              onClick={() => setPopup({ type: 'entry', entry: { id: uuid(), days: s.days, start: s.start, end: s.end, apps: [] } })}
            >
              <span>
                <strong>
                  {formatDays(s.days)} {formatTimeRange(s.start, s.end)}
                </strong>
                <span className="suggest-note">{s.note}</span>
              </span>
              <Plus size={18} />
            </button>
          ))}
        </section>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => (
            <li key={entry.id} className="entry-card">
              <div className="entry-main" onClick={() => setPopup({ type: 'entry', entry })}>
                <span className="entry-when">
                  <strong>{formatDays(entry.days)}</strong> {formatTimeRange(entry.start, entry.end)}
                </span>
                <span className="entry-apps">
                  {entry.apps.slice(0, 6).map((name) => (
                    <AppIcon key={name} name={name} size={22} />
                  ))}
                  {entry.apps.length > 6 && <span className="entry-more">+{entry.apps.length - 6}</span>}
                </span>
              </div>
              <div className="entry-actions">
                <button className="icon-button small" onClick={() => setPopup({ type: 'entry', entry })} aria-label="編集">
                  <Pencil size={16} />
                </button>
                {/* 同じアプリ・時間帯で曜日だけ違う予定を作りやすいように */}
                <button
                  className="icon-button small"
                  onClick={() => setPopup({ type: 'entry', entry: { ...entry, id: uuid(), days: [] } })}
                  aria-label="コピー"
                >
                  <Copy size={16} />
                </button>
                <button className="icon-button small" onClick={() => removeEntry(entry.id)} aria-label="削除">
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        className="secondary-button add-entry"
        onClick={() =>
          setPopup({ type: 'entry', entry: { id: uuid(), days: [], start: '22:00', end: '07:00', apps: [] } })
        }
      >
        <Plus size={18} /> 予定を追加
      </button>

      {error && <p className="error-box">{error}</p>}

      <div className="bottom-bar">
        <span className="bottom-bar-info">{entries.length > 0 ? `${entries.length}個の予定` : '予定なし'}</span>
        <button className="primary-button" disabled={entries.length === 0} onClick={() => setPopup({ type: 'purpose' })}>
          {error ? 'もう一度試す' : 'この予定で始める'}
        </button>
      </div>

      {popup?.type === 'entry' && (
        <EntrySheet
          key={popup.entry.id}
          initial={popup.entry}
          allApps={allApps}
          onSave={saveEntry}
          onClose={() => setPopup(null)}
        />
      )}

      {popup?.type === 'purpose' && (
        <PurposeSheet
          current={purpose}
          description="決めておくと、メイン画面に出ます。ロックの決まりには関係しません。"
          onSelect={(p) => {
            setFixedDraftPurpose(p);
            setPopup({ type: 'confirm' });
          }}
          onClose={() => setPopup(null)}
        />
      )}

      {popup?.type === 'confirm' && (
        <Sheet title="この予定で始めますか？" onClose={() => setPopup(null)}>
          <p className="confirm-purpose-line">🎯 {purpose ? `${purpose}のため` : '目的なし'}</p>
          <ul className="confirm-entries">
            {entries.map((e) => (
              <li key={e.id}>
                <strong>{formatDays(e.days)}</strong> {formatTimeRange(e.start, e.end)}
                <span>{e.apps.join('・')}</span>
              </li>
            ))}
          </ul>
          <ul className="rule-notes">
            <li>始めた後は、予定を変えられません。</li>
            <li>やめる時はメニューの「固定時間をキャンセル」から。キャンセルは翌朝以降に承認すると反映されます。</li>
            <li>
              ロック中は、一時解除チケット（🪙{UNLOCK_PRICE}・{MAX_UNLOCK_TICKETS}枚まで）で一時解除できます。使った日は失敗になります。
            </li>
          </ul>
          <button className="primary-button full" onClick={handleStart} disabled={isLoading}>
            始める
          </button>
        </Sheet>
      )}

      {isLoading && (
        <div className="modal-overlay">
          <div className="loading">
            <div className="spinner" />
            <p>予定を登録しています…</p>
          </div>
        </div>
      )}
    </div>
  );
}

// 予定1つ分の入力（曜日・時間帯・アプリ）。よく使う組み合わせはボタン1つで入る
function EntrySheet({ initial, allApps, onSave, onClose }) {
  const { saveCustomApp, customApps } = useApp();
  const [days, setDays] = useState(initial.days);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [apps, setApps] = useState(initial.apps);
  const [addingApp, setAddingApp] = useState(false);

  const toggle = (list, setList, value) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const sameDays = (a) => a.length === days.length && a.every((d) => days.includes(d));
  const validTime = isValidRange(start, end);
  const allSelected = allApps.every((a) => apps.includes(a));
  const canSave = days.length > 0 && apps.length > 0 && validTime;

  if (addingApp) {
    return (
      <CustomAppSheet
        existing={[...DEFAULT_APPS, ...customApps]}
        onSave={(app) => {
          saveCustomApp(null, app);
          setApps([...apps, app.name]);
          setAddingApp(false);
        }}
        onClose={() => setAddingApp(false)}
      />
    );
  }

  return (
    <Sheet title="ロックの予定" onClose={onClose}>
      <h4 className="entry-section">曜日</h4>
      <div className="chip-row">
        {[
          ['毎日', EVERY_DAY],
          ['平日', WEEKDAYS],
          ['土日', WEEKEND],
        ].map(([label, value]) => (
          <button key={label} className={`chip${sameDays(value) ? ' active' : ''}`} onClick={() => setDays(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="day-row">
        {WEEK_ORDER.map((d) => (
          <button
            key={d}
            className={`day-chip${days.includes(d) ? ' active' : ''}${d === 0 ? ' sun' : d === 6 ? ' sat' : ''}`}
            onClick={() => toggle(days, setDays, d)}
          >
            {DAY_LABELS[d]}
          </button>
        ))}
      </div>

      <h4 className="entry-section">時間帯</h4>
      <div className="chip-row">
        {TIME_PRESETS.map((p) => (
          <button
            key={p.label}
            className={`chip${start === p.start && end === p.end ? ' active' : ''}`}
            onClick={() => {
              setStart(p.start);
              setEnd(p.end);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="time-row">
        <input type="time" step="300" value={start} onChange={(e) => setStart(e.target.value)} aria-label="開始" />
        <span>〜</span>
        {end === END_OF_DAY ? (
          <button className="time-end-label" onClick={() => setEnd('23:00')}>
            その日の終わり
          </button>
        ) : (
          <input type="time" step="300" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="終了" />
        )}
      </div>
      <button
        className={`chip end-of-day${end === END_OF_DAY ? ' active' : ''}`}
        onClick={() => setEnd(end === END_OF_DAY ? '23:00' : END_OF_DAY)}
      >
        その日の終わりまで
      </button>
      <p className="field-hint">
        {validTime
          ? `${formatTimeRange(start, end)}（${formatMinutes(entryMinutes({ start, end }))}）`
          : '開始と終了を別の時刻にしてください'}
      </p>

      <h4 className="entry-section">
        アプリ
        <button className="text-button" onClick={() => setApps(allSelected ? [] : allApps)}>
          {allSelected ? 'すべて外す' : 'すべて選ぶ'}
        </button>
      </h4>
      <div className="app-grid compact">
        {allApps.map((name) => (
          <button
            key={name}
            className={`app-cell${apps.includes(name) ? ' selected' : ''}`}
            onClick={() => toggle(apps, setApps, name)}
          >
            <span className="app-cell-icon">
              <AppIcon name={name} size={40} />
              {apps.includes(name) && <span className="check-badge">✓</span>}
            </span>
            <span className="app-cell-name">{name}</span>
          </button>
        ))}
        <button className="app-cell" onClick={() => setAddingApp(true)}>
          <span className="app-cell-icon">
            <span className="app-tile outline" style={{ width: 40, height: 40 }}>
              <Plus size={20} />
            </span>
          </span>
          <span className="app-cell-name">カスタム</span>
        </button>
      </div>

      <button className="primary-button full" disabled={!canSave} onClick={() => onSave({ id: initial.id, days, start, end, apps })}>
        {canSave ? `${formatDays(days)} ${formatTimeRange(start, end)} で保存` : '曜日とアプリを選んでください'}
      </button>
    </Sheet>
  );
}
