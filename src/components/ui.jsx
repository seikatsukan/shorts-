import { Component } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { getAppMeta } from '../data/apps';

// アプリのアイコン（色付きタイル）
export function AppIcon({ name, size = 40 }) {
  const meta = getAppMeta(name);
  return (
    <span
      className="app-tile"
      style={{ width: size, height: size, fontSize: size * 0.45, background: meta.color }}
      aria-hidden="true"
    >
      {meta.glyph}
    </span>
  );
}

// 画面下から出てくるポップアップ
export function Sheet({ title, onClose, children }) {
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {title && <h3 className="sheet-title">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

// ロック設定の各ステップ共通のヘッダー
export function WizardHeader({ step, title, subtitle }) {
  const navigate = useNavigate();
  return (
    <>
      <header className="top-bar">
        <button className="icon-button" onClick={() => navigate(-1)} aria-label="戻る">
          <ChevronLeft size={24} />
        </button>
        <div className="steps">
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= step ? 'step-dot active' : 'step-dot'} />
          ))}
        </div>
        <div style={{ width: 40 }} />
      </header>
      <h2 className="page-title">{title}</h2>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </>
  );
}

// 中でエラーが起きても画面全体を止めずに fallback を表示する（3Dモデルの読み込み失敗など）
export class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(error);
    this.props.onError?.(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
