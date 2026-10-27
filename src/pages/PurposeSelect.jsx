import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { BookOpen, Moon, Dumbbell, Pencil } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { WizardHeader } from '../components/ui';
import { PURPOSES } from '../data/apps';

const ICONS = { 勉強: BookOpen, 昼寝: Moon, スポーツ: Dumbbell };

export default function PurposeSelect() {
  const navigate = useNavigate();
  const { draft, setDraftPurpose } = useApp();
  const initialIsCustom = draft.purpose && !PURPOSES.includes(draft.purpose);
  const [selected, setSelected] = useState(initialIsCustom ? 'custom' : draft.purpose);
  const [customText, setCustomText] = useState(initialIsCustom ? draft.purpose : '');

  if (draft.apps.length === 0) return <Navigate to="/select-app" replace />;

  const purpose = selected === 'custom' ? customText.trim() : selected;

  const goNext = (value) => {
    setDraftPurpose(value || null);
    navigate('/confirm');
  };

  return (
    <div className="screen wizard-screen">
      <WizardHeader step={2} title="目的を設定しますか？" subtitle="空いた時間で何をするか決めておきましょう" />

      <div className="purpose-list">
        {PURPOSES.map((p) => {
          const Icon = ICONS[p];
          return (
            <button
              key={p}
              className={`purpose-item${selected === p ? ' active' : ''}`}
              onClick={() => setSelected(p)}
            >
              <Icon size={22} /> {p}
            </button>
          );
        })}
        <button
          className={`purpose-item${selected === 'custom' ? ' active' : ''}`}
          onClick={() => setSelected('custom')}
        >
          <Pencil size={22} /> カスタム
        </button>
        {selected === 'custom' && (
          <input
            className="text-input"
            type="text"
            placeholder="例: 読書"
            maxLength={30}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            autoFocus
          />
        )}
      </div>

      <div className="bottom-bar">
        <button className="text-button" onClick={() => goNext(null)}>
          スキップ
        </button>
        <button className="primary-button" disabled={!purpose} onClick={() => goNext(purpose)}>
          次へ
        </button>
      </div>
    </div>
  );
}
