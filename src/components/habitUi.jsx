import { COLORS, MAX_STAGE, STEP_DAYS } from '../habit';

// 2つのモード（自分でロック・固定時間で自動ロック）で共通の、スライムの成長の表示

// 色が変わる日（0, 3, 7, 14, 21日目）
const MILESTONES = STEP_DAYS.reduce((acc, d) => [...acc, acc[acc.length - 1] + d], [0]);
const TOTAL_DAYS = MILESTONES[MILESTONES.length - 1];

// 21日分の道のり。1マスが1日で、色が変わる日に次の色の丸を置く
// 達成した日はその区間の色で塗り、今日のマスは点滅させる（今日達成するとここまで進む）
export function ColorTrack({ stage, progress, done }) {
  const filledDays = stage === MAX_STAGE ? TOTAL_DAYS : MILESTONES[stage] + progress;
  const items = [];
  COLORS.forEach((color, k) => {
    items.push(
      <span
        key={`c${k}`}
        className={`track-color${k <= stage ? ' reached' : ''}${k === stage ? ' current' : ''}`}
        style={{ '--c': color.hex }}
        title={k === 0 ? color.name : `${MILESTONES[k]}日目で${color.name}`}
      >
        <span className="track-label">{k === 0 ? 'スタート' : `${MILESTONES[k]}日`}</span>
      </span>,
    );
    if (k === MAX_STAGE) return;
    for (let d = MILESTONES[k]; d < MILESTONES[k + 1]; d++) {
      const isToday = d === filledDays && !done && stage < MAX_STAGE;
      items.push(
        <span
          key={`d${d}`}
          className={`track-day${d < filledDays ? ' filled' : ''}${isToday ? ' today' : ''}`}
          style={{ '--c': COLORS[k + 1].hex }}
        />,
      );
    }
  });
  return (
    <div className="color-track" role="img" aria-label={`21日のうち ${filledDays}日 進んでいます`}>
      {items}
    </div>
  );
}

const formatDay = (t) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// fixed: 固定時間モードの結果か（成功・失敗の言い方と、もらったコインを変える）
function eventText(e, fixed) {
  const coins = fixed && e.coins > 0 ? `　🪙+${e.coins}` : '';
  if (fixed) {
    switch (e.type) {
      case 'up':
        return `${COLORS[e.from].name} → ${COLORS[e.to].name} に進化！（${e.streak}日連続）${coins}`;
      case 'success':
        return `一時解除なしでやりきった！（${e.streak}日連続）${coins}`;
      case 'down':
        return `一時解除を使った → ${COLORS[e.from].name} から ${COLORS[e.to].name} に戻りました${coins}`;
      default:
        return e.continued
          ? `一時解除を使った（色はこれ以上下がりません）${coins}`
          : `一時解除を使った → 連続記録が 0 に戻りました${coins}`;
    }
  }
  switch (e.type) {
    case 'up':
      return `${COLORS[e.from].name} → ${COLORS[e.to].name} に進化！（${e.streak}日連続）`;
    case 'success':
      return `目標達成！（${e.streak}日連続）`;
    case 'ticket':
      return e.kind === 'extra'
        ? '目標に届かず → 買ったお休みチケットで守りました'
        : '目標に届かず → 今週のお休みチケットで守りました';
    case 'down':
      return `目標に届かず → ${COLORS[e.from].name} から ${COLORS[e.to].name} に戻りました`;
    default:
      return e.continued ? '目標に届かず（色はこれ以上下がりません）' : '目標に届かず → 連続記録が 0 に戻りました';
  }
}

// 毎日の判定結果（進化・退化・チケット使用など）。fixed: 固定時間モードの結果か
export function HabitReport({ events, onClose, fixed = false }) {
  // 失敗が続いた日は1行にまとめる（例: 10/30〜11/4）
  const rows = [];
  for (const e of events) {
    const last = rows[rows.length - 1];
    if (e.continued && last?.continued) last.until = e.day;
    else rows.push({ ...e });
  }
  const up = events.some((e) => e.type === 'up');
  const down = events.some((e) => e.type === 'down');
  // 見出しは中身に合わせて具体的に
  const only = (type) => events.every((e) => e.type === type);
  const [emoji, title] = up
    ? ['✨', '進化した！']
    : down
      ? ['💧', '色が1つ戻りました']
      : only('success')
        ? fixed
          ? ['🎯', '一時解除なしでやりきった！']
          : ['🎯', '今日の目標を達成！']
        : only('ticket')
          ? ['🎫', 'お休みチケットで守りました']
          : only('miss')
            ? ['💧', fixed ? '一時解除を使いました' : '目標に届きませんでした']
            : ['📅', '前回からの結果'];

  return (
    <div className="modal-overlay">
      <div className="modal habit-report">
        <p className="result-emoji">{emoji}</p>
        <h2>{title}</h2>
        <ul className="report-list">
          {rows.map((e, i) => (
            <li key={i} className={`report-${e.type}`}>
              <span className="report-day">
                {formatDay(e.day)}
                {e.until && `〜${formatDay(e.until)}`}
              </span>
              <span>{eventText(e, fixed)}</span>
            </li>
          ))}
        </ul>
        <button className="primary-button" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
