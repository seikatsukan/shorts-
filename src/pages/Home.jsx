import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ellipsis, X, LogOut, ChartBar, Plus, Lock } from 'lucide-react';
import { useApp, useNow } from '../store/AppContext';
import { AppIcon, ErrorBoundary } from '../components/ui';
import { getEvolution, formatCountdown, formatClock, formatMinutes } from '../data/apps';

// 3D（three.js）は重いので、画面を先に出してからキャラだけ後で読み込む
const SlimeCanvas = lazy(() => import('../components/Slime'));

export default function Home() {
  const navigate = useNavigate();
  const { coins, activeLocks, completed, dismissCompleted, startDraft, logOut } = useApp();
  const now = useNow();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const evolution = getEvolution(coins);

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
            <button className="menu-item" onClick={handleLogout}>
              <LogOut size={20} /> ログアウト
            </button>
          </nav>
        </div>
      )}

      {/* キャラクター（進化するたびに大きくなる。タップするとジャンプ） */}
      <div className="model-container" onClick={() => setTapCount((c) => c + 1)}>
        <ErrorBoundary fallback={null}>
          <Suspense fallback={<div className="model-loading" />}>
            <SlimeCanvas
              stage={evolution.stage}
              walking={sortedLocks.length > 0}
              celebrating={!!completed}
              tapCount={tapCount}
            />
          </Suspense>
        </ErrorBoundary>
      </div>

      <div className="evolution">
        <div className="evolution-bar">
          <div style={{ width: `${evolution.progress * 100}%` }} />
        </div>
        <p className="evolution-text">
          {evolution.isMax ? '最終進化！' : `あと ${evolution.remaining} コインで進化`}
        </p>
      </div>

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
    </div>
  );
}
