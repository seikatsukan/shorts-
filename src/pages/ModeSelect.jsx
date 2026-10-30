import { useNavigate } from 'react-router-dom';
import { CalendarClock, Timer } from 'lucide-react';
import { useApp } from '../store/AppContext';

// 使い方のモードを選ぶ（最初に1回。固定時間をキャンセルした後にもう一度）
// - 自分でロック: 1日の目標時間を決め、使いたくない時に自分でロックする
// - 固定時間で自動ロック: 曜日と時間帯を決めておくと、毎週その時間は自動でロックされる。一時解除が使える
// 途中で変えられるのは「自分でロック」→「固定時間」だけ（成長はリセット）。固定時間はキャンセルが反映されるまで変えられない
export default function ModeSelect() {
  const navigate = useNavigate();
  const { chooseTimerMode } = useApp();

  return (
    <div className="screen mode-screen">
      <h2 className="page-title">使い方を選んでください</h2>
      <p className="page-subtitle">あとから変えられるのは「自分でロック」→「固定時間」だけです</p>

      <button
        className="mode-card"
        onClick={() => {
          chooseTimerMode();
          navigate('/home', { replace: true });
        }}
      >
        <span className="mode-icon">
          <Timer size={26} />
        </span>
        <span className="mode-body">
          <strong>自分でロック</strong>
          <span className="mode-lead">これから勉強・集中したい時に</span>
          <span>使いたくない時に、その場で自分でロック。1日の目標時間を達成した日が続くとスライムが育ちます。</span>
          <span className="mode-tags">
            <span>目標時間</span>
            <span>お休みチケット</span>
          </span>
        </span>
      </button>

      <button className="mode-card" onClick={() => navigate('/fixed-setup')}>
        <span className="mode-icon">
          <CalendarClock size={26} />
        </span>
        <span className="mode-body">
          <strong>固定時間で自動ロック</strong>
          <span className="mode-lead">毎日の習慣にしたい人に</span>
          <span>
            曜日と時間帯を決めておくと、その時間は毎週自動でロック。一時解除を使わずに過ごせた日が続くとスライムが育ちます。
          </span>
          <span className="mode-tags">
            <span>毎週くり返し</span>
            <span>一時解除チケット</span>
          </span>
        </span>
      </button>

      <p className="mode-note">固定時間は、始めた後はキャンセルしない限り変えられません。キャンセルは翌朝以降の承認で反映されます。</p>
    </div>
  );
}
