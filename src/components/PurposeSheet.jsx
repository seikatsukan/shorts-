import { useState } from 'react';
import { Sheet } from './ui';
import { PURPOSES } from '../data/apps';

// 目的を決める（何のためにロックするか）。選択肢かカスタム入力。スキップすると目的なし
// 2つのモードで共通（自分でロックは1日の目標の後、固定時間は予定を始める前に聞く）
export function PurposeSheet({
  current,
  onSelect,
  onClose,
  description = '目的を決めておくと、毎日の目標を続けやすくなります。ロックのたびには聞きません。',
}) {
  const isCustom = current && !PURPOSES.includes(current);
  const [showCustom, setShowCustom] = useState(isCustom);
  const [custom, setCustom] = useState(isCustom ? current : '');
  const trimmed = custom.trim();

  return (
    <Sheet title="何のためにロックしますか？" onClose={onClose}>
      <p className="sheet-desc">{description}</p>
      <div className="option-grid">
        {PURPOSES.map((p) => (
          <button key={p} className={`option${current === p ? ' active' : ''}`} onClick={() => onSelect(p)}>
            {p}
          </button>
        ))}
        <button className={`option${showCustom ? ' active' : ''}`} onClick={() => setShowCustom(true)}>
          カスタム
        </button>
      </div>
      {showCustom && (
        <div className="custom-input-row">
          <input
            className="text-input"
            type="text"
            placeholder="例: 資格の勉強"
            maxLength={20}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            autoFocus
          />
          <button className="primary-button small" disabled={!trimmed} onClick={() => onSelect(trimmed)}>
            決定
          </button>
        </div>
      )}
      <button className="text-button full" onClick={() => onSelect(null)}>
        {current ? '目的なしにする' : 'スキップ'}
      </button>
    </Sheet>
  );
}
