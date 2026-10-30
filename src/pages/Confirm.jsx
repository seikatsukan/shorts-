import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { AppIcon, WizardHeader } from '../components/ui';
import { startLock, UnsupportedAppError } from '../api';
import { formatMinutes } from '../data/apps';

export default function Confirm() {
  const navigate = useNavigate();
  const { draft, addLocks, resetDraft, customDomainOf, setDraftUnsupported, setDraftApp, habit } = useApp();
  // 通信中（ローディング）とエラーの状態
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  if (draft.apps.length === 0 && !isLoading) return <Navigate to="/select-app" replace />;

  // 履歴の idx の位置まで戻る。分からない時（URLを直接開いた時など）は path に置き換える
  const backTo = (idx, path) => {
    const current = window.history.state?.idx;
    if (idx !== null && current != null && idx < current) navigate(idx - current);
    else navigate(path, { replace: true });
  };

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // サーバーでアプリごとのタイマーを始め、開始・終了時刻とサーバー時刻を受け取る
      // カスタムアプリだけドメインを付ける
      const apps = draft.apps.map((a) => ({ ...a, domain: customDomainOf(a.name) }));
      const result = await startLock({ apps });
      addLocks(result);
      // 一部だけ始められなかった時は、始められたアプリを外して残りだけもう一度試せるようにする
      // （始めたタイマーは止められないので、ここで全部をやり直しにはしない）
      if (result.failed.length > 0) {
        result.locks.forEach((l) => setDraftApp(l.name, null));
        setError(
          `${result.locks.map((l) => l.name).join('、')} はロックを始めました。` +
            `${result.failed.map((f) => f.name).join('、')} は始められませんでした（${result.failed[0].message}）`,
        );
        setIsLoading(false);
        return;
      }
      resetDraft();
      // ロック設定を始めたメイン画面まで履歴を戻す
      backTo(draft.startIdx, '/home');
    } catch (e) {
      // 対応していないアプリがあった → アプリ選択画面に戻して修正してもらう
      if (e instanceof UnsupportedAppError && e.names.length > 0) {
        setDraftUnsupported(e.names);
        backTo(draft.startIdx === null ? null : draft.startIdx + 1, '/select-app');
        return;
      }
      setError(e.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="screen wizard-screen">
      <WizardHeader step={2} title="最終確認" />

      <section className="card">
        <h3 className="card-label">制限するアプリ</h3>
        {draft.apps.map((a) => (
          <div key={a.name} className="confirm-row">
            <AppIcon name={a.name} size={32} />
            <span className="confirm-name">{a.name}</span>
            <span className="confirm-value">{formatMinutes(a.minutes)}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <h3 className="card-label">目的</h3>
        {/* 目的は1日の目標と一緒に決めたもの（ロックのたびには聞かない） */}
        <p className="confirm-purpose">{habit?.purpose ? `${habit.purpose}のため` : '設定なし'}</p>
        <p className="sheet-note">メニューの「1日の目標と目的」で変えられます</p>
      </section>

      <p className="warning-text">
        <TriangleAlert size={16} /> スタート後はキャンセルできません
      </p>

      {error && <p className="error-box">{error}</p>}

      <div className="bottom-bar">
        <button className="primary-button wide" onClick={handleStart} disabled={isLoading}>
          {error ? 'もう一度試す' : 'スタート'}
        </button>
      </div>

      {isLoading && (
        <div className="modal-overlay">
          <div className="loading">
            <div className="spinner" />
            <p>ロックを始めています…</p>
          </div>
        </div>
      )}
    </div>
  );
}
