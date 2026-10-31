import { useState } from 'react';
import { Sheet } from './ui';
import { installSteps, isStandalone } from '../device';

// ブラウザのまま使っている人に、ホーム画面に追加するよう勧める（メイン画面の上に出す）
// 「あとで」を押したら、この端末では3日間出さない
const DISMISS_KEY = 'sns-blocker:install-hint-dismissed';
const HIDE_DAYS = 3;

function dismissedRecently() {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < HIDE_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function InstallHint() {
  const [hidden, setHidden] = useState(() => isStandalone() || dismissedRecently());
  const [isOpen, setIsOpen] = useState(false);
  if (hidden) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // 保存できなくても、今は閉じる
    }
    setHidden(true);
  };

  return (
    <>
      <div className="notice-card">
        <p>
          <strong>ホーム画面に追加して使ってください。</strong>
          ブラウザのままだと、しばらく開かない間にコインやスライムが消えることがあります。
        </p>
        <div className="notice-actions">
          <button className="text-button" onClick={dismiss}>
            あとで
          </button>
          <button className="text-button" onClick={() => setIsOpen(true)}>
            やり方
          </button>
        </div>
      </div>

      {isOpen && (
        <Sheet title="ホーム画面に追加する" onClose={() => setIsOpen(false)}>
          <p className="install-steps">{installSteps()}</p>
          <p className="sheet-desc">
            追加したら、ホーム画面のアイコンから開いてください。iPhone では、ブラウザで使っていたデータが引き継がれないことがあります。その時はもう一度ログインして始めてください。
          </p>
          <button className="primary-button full" onClick={() => setIsOpen(false)}>
            OK
          </button>
        </Sheet>
      )}
    </>
  );
}
