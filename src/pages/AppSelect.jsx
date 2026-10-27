import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, CircleAlert, LayoutGrid, Plus } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { AppIcon, Sheet, WizardHeader } from '../components/ui';
import { DEFAULT_APPS, TIME_OPTIONS, formatMinutes, isValidDomain, normalizeDomain } from '../data/apps';

export default function AppSelect() {
  const navigate = useNavigate();
  const { draft, setDraftApp, customApps, saveCustomApp, removeCustomApp, activeLocks } = useApp();

  const isCustom = (name) => customApps.some((a) => a.name === name);
  const unsupported = new Set(draft.unsupported);

  // 開いているポップアップ: { type: 'time', targets: [アプリ名] } / { type: 'custom', editing: アプリ名 | null } / null
  // PCサーバーに対応していないと言われて戻ってきた時は、そのカスタムアプリの入力を開いておく
  const [popup, setPopup] = useState(() => {
    const first = draft.unsupported.find(isCustom);
    return first ? { type: 'custom', editing: first } : null;
  });

  const lockedNames = new Set(activeLocks.map((l) => l.name));
  const allApps = [...DEFAULT_APPS.map((a) => a.name), ...customApps.map((a) => a.name)];
  const selectable = allApps.filter((name) => !lockedNames.has(name));
  const minutesOf = (name) => draft.apps.find((a) => a.name === name)?.minutes;

  const applyTime = (minutes) => {
    popup.targets.forEach((name) => setDraftApp(name, minutes));
    setPopup(null);
  };

  const handleTileClick = (name) => {
    if (unsupported.has(name) && isCustom(name)) setPopup({ type: 'custom', editing: name });
    else setPopup({ type: 'time', targets: [name] });
  };

  const handleSaveCustom = (app) => {
    const editing = popup.editing;
    saveCustomApp(editing, app);
    // 新しく追加した時はそのまま時間選択へ
    setPopup(editing ? null : { type: 'time', targets: [app.name] });
  };

  const handleRemoveCustom = () => {
    removeCustomApp(popup.editing);
    setPopup(null);
  };

  return (
    <div className="screen wizard-screen">
      <WizardHeader step={1} title="制限するアプリ" subtitle="アプリをタップして時間を選んでください" />

      {draft.unsupported.length > 0 && (
        <div className="error-box align-left">
          <CircleAlert size={18} />
          <p>
            「{draft.unsupported.join('」「')}」はPCが対応していないか、正式な名前ではありません。
            名前とドメインを確認するか、選択を外してください。
          </p>
        </div>
      )}

      <div className="app-grid">
        {allApps.map((name) => {
          const minutes = minutesOf(name);
          const locked = lockedNames.has(name);
          const error = unsupported.has(name);
          return (
            <button
              key={name}
              className={`app-cell${minutes ? ' selected' : ''}${error ? ' error' : ''}`}
              disabled={locked}
              onClick={() => handleTileClick(name)}
            >
              <span className="app-cell-icon">
                <AppIcon name={name} size={52} />
                {minutes && (
                  <span className="check-badge">
                    {error ? <span>!</span> : <Check size={12} strokeWidth={3} />}
                  </span>
                )}
              </span>
              <span className="app-cell-name">{name}</span>
              <span className="app-cell-time">
                {locked ? 'ロック中' : error ? '要確認' : minutes ? formatMinutes(minutes) : ''}
              </span>
            </button>
          );
        })}

        <button
          className="app-cell"
          disabled={selectable.length === 0}
          onClick={() => setPopup({ type: 'time', targets: selectable, title: 'すべてのアプリ' })}
        >
          <span className="app-cell-icon">
            <span className="app-tile outline" style={{ width: 52, height: 52 }}>
              <LayoutGrid size={24} />
            </span>
          </span>
          <span className="app-cell-name">すべて</span>
          <span className="app-cell-time" />
        </button>

        <button className="app-cell" onClick={() => setPopup({ type: 'custom', editing: null })}>
          <span className="app-cell-icon">
            <span className="app-tile outline" style={{ width: 52, height: 52 }}>
              <Plus size={24} />
            </span>
          </span>
          <span className="app-cell-name">カスタム</span>
          <span className="app-cell-time" />
        </button>
      </div>

      <div className="bottom-bar">
        <span className="bottom-bar-info">{draft.apps.length > 0 ? `${draft.apps.length}個 選択中` : '未選択'}</span>
        <button
          className="primary-button"
          disabled={draft.apps.length === 0 || draft.unsupported.length > 0}
          onClick={() => navigate('/select-purpose')}
        >
          次へ
        </button>
      </div>

      {popup?.type === 'time' && (
        <TimeSheet
          title={popup.title ?? popup.targets[0]}
          current={popup.targets.length === 1 ? minutesOf(popup.targets[0]) : undefined}
          onSelect={applyTime}
          onRemove={popup.targets.length === 1 && minutesOf(popup.targets[0]) ? () => applyTime(null) : null}
          onEdit={
            popup.targets.length === 1 && isCustom(popup.targets[0])
              ? () => setPopup({ type: 'custom', editing: popup.targets[0] })
              : null
          }
          onClose={() => setPopup(null)}
        />
      )}

      {popup?.type === 'custom' && (
        <CustomAppSheet
          key={popup.editing ?? 'new'}
          initial={customApps.find((a) => a.name === popup.editing)}
          serverError={unsupported.has(popup.editing)}
          existing={[...DEFAULT_APPS, ...customApps].filter((a) => a.name !== popup.editing)}
          onSave={handleSaveCustom}
          onRemove={popup.editing ? handleRemoveCustom : null}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

function TimeSheet({ title, current, onSelect, onRemove, onEdit, onClose }) {
  const isCustomValue = current && !TIME_OPTIONS.includes(current);
  const [showCustom, setShowCustom] = useState(isCustomValue);
  const [customMinutes, setCustomMinutes] = useState(isCustomValue ? String(current) : '');
  const parsed = Number(customMinutes);
  const customValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 24 * 60;

  return (
    <Sheet title={`${title} の制限時間`} onClose={onClose}>
      <div className="option-grid">
        {TIME_OPTIONS.map((t) => (
          <button
            key={t}
            className={`option${current === t ? ' active' : ''}`}
            onClick={() => onSelect(t)}
          >
            {formatMinutes(t)}
          </button>
        ))}
        <button
          className={`option${showCustom ? ' active' : ''}`}
          onClick={() => setShowCustom(true)}
        >
          カスタム
        </button>
      </div>

      {showCustom && (
        <div className="custom-input-row">
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="1440"
            placeholder="例: 45"
            value={customMinutes}
            onChange={(e) => setCustomMinutes(e.target.value)}
            autoFocus
          />
          <span>分</span>
          <button className="primary-button small" disabled={!customValid} onClick={() => onSelect(parsed)}>
            決定
          </button>
        </div>
      )}

      {onEdit && (
        <button className="text-button full" onClick={onEdit}>
          名前・ドメインを編集
        </button>
      )}
      {onRemove && (
        <button className="text-button danger" onClick={onRemove}>
          選択を解除
        </button>
      )}
    </Sheet>
  );
}

// カスタムアプリの追加・修正（名前と正式なドメイン）
function CustomAppSheet({ initial, serverError, existing, onSave, onRemove, onClose }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [domainInput, setDomainInput] = useState(initial?.domain ?? '');
  const [touched, setTouched] = useState(false);

  const trimmed = name.trim();
  const domain = normalizeDomain(domainInput);
  const nameTaken = existing.some((a) => a.name.toLowerCase() === trimmed.toLowerCase());
  const domainTaken = existing.find((a) => a.domain === domain);
  const domainError = !domain
    ? null
    : !isValidDomain(domain)
      ? '「line.me」のような形で入力してください'
      : domainTaken
        ? `${domainTaken.name} と同じドメインです`
        : null;
  const unchanged = initial && trimmed === initial.name && domain === initial.domain;
  const canSave = trimmed && domain && !nameTaken && !domainError && !(serverError && unchanged);

  return (
    <Sheet title={initial ? 'アプリを修正' : 'アプリを追加'} onClose={onClose}>
      {serverError && (
        <p className="error-box align-left small">
          <CircleAlert size={16} />
          PCが対応していないか、正式な名前ではありません。名前とドメインを確認してください。
        </p>
      )}

      <label className="field">
        <span className="field-label">アプリ名</span>
        <input
          className="text-input"
          type="text"
          placeholder="例: LINE"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        {nameTaken && <span className="field-error">すでに登録されています</span>}
      </label>

      <label className="field">
        <span className="field-label">正式なドメイン</span>
        <input
          className="text-input"
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="例: line.me"
          value={domainInput}
          onChange={(e) => setDomainInput(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        {touched && domainError ? (
          <span className="field-error">{domainError}</span>
        ) : (
          <span className="field-hint">サイトのURLの「https://」の後ろの部分です</span>
        )}
      </label>

      <button
        className="primary-button full"
        disabled={!canSave}
        onClick={() => onSave({ name: trimmed, domain })}
      >
        {initial ? '保存' : '追加'}
      </button>
      {onRemove && (
        <button className="text-button danger" onClick={onRemove}>
          このアプリを削除
        </button>
      )}
    </Sheet>
  );
}
