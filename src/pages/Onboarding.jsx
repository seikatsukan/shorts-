import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, ChevronLeft, Monitor, Wifi, Power, Lock, Target, Timer, Coins, ChartBar, Eye, EyeOff,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { AuthError, logIn as logInApi, signUp } from '../auth';

const STEPS = ['PCの準備', '使い方', 'アカウント'];

// Step 1: PCサーバーの起動・設定
const PC_SLIDES = [
  {
    icon: Monitor,
    title: 'PCでサーバーを起動',
    body: 'このアプリはPCと一緒に使います。\nまずPCで SNS Blocker のサーバーを\n起動してください。',
  },
  {
    icon: Wifi,
    title: '同じWi-Fiにつなぐ',
    body: 'スマホとPCを\n同じWi-Fiに接続してください。\nスマホからPCへロックを依頼します。',
  },
  {
    icon: Power,
    title: 'PCは起動したままに',
    body: 'ロック中はPCのサーバーを\n起動したままにしてください。\nPCがアプリをブロックします。',
  },
];

// Step 2: アプリの使い方
const USAGE_SLIDES = [
  {
    icon: Lock,
    title: 'アプリと時間を選ぶ',
    body: '「ロックする」から制限したいアプリと\n時間（20分・30分・1時間など）を\n選びます。',
  },
  {
    icon: Target,
    title: '目的を決める',
    body: '空いた時間で何をするか\n（勉強・昼寝・スポーツなど）を\n決めておけます。スキップもOK。',
  },
  {
    icon: Timer,
    title: 'スタートしたら最後まで',
    body: 'ロック中は残り時間が表示されます。\n一度始めたロックは\nキャンセルできません。',
  },
  {
    icon: Coins,
    title: 'コインでスライムが進化',
    body: '10分ロックするごとにコインが1枚。\nコインが貯まるとスライムが進化して\n大きくなります。',
  },
  {
    icon: ChartBar,
    title: '記録をふりかえる',
    body: 'メニューの「週/月のまとめ」で\nどのアプリをどれだけ制限できたか\n確認できます。',
  },
];

export default function Onboarding() {
  const { tutorialSeen, markTutorialSeen } = useApp();
  // 一度説明を見た端末（ログアウト後など）は、説明を飛ばしてログイン画面から始める
  const [step, setStep] = useState(tutorialSeen ? 3 : 1);
  const [accountMode, setAccountMode] = useState(tutorialSeen ? 'login' : 'signup');

  const goToAccount = (mode) => {
    markTutorialSeen();
    setAccountMode(mode);
    setStep(3);
  };

  return (
    <div className="screen onboarding-screen">
      <header className="top-bar">
        {step > 1 ? (
          <button className="icon-button" onClick={() => setStep(step - 1)} aria-label="前のステップへ">
            <ChevronLeft size={24} />
          </button>
        ) : (
          <div style={{ width: 40 }} />
        )}
        {step < 3 ? (
          // すでにアカウントを持っている人は説明を飛ばしてログインへ
          <button className="text-button" onClick={() => goToAccount('login')}>
            ログイン
          </button>
        ) : (
          <div style={{ width: 40 }} />
        )}
      </header>

      <StepIndicator current={step} />

      {step === 1 && <Carousel key="pc" slides={PC_SLIDES} onDone={() => setStep(2)} />}
      {step === 2 && <Carousel key="usage" slides={USAGE_SLIDES} onDone={() => goToAccount('signup')} />}
      {step === 3 && <AccountForm key={accountMode} initialMode={accountMode} />}
    </div>
  );
}

// ① ━ ② ━ ③
function StepIndicator({ current }) {
  return (
    <ol className="stepper" aria-label={`ステップ ${current} / ${STEPS.length}`}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'active' : '';
        return (
          <li key={label} className={`stepper-item ${state}`} aria-current={n === current ? 'step' : undefined}>
            {i > 0 && <span className="stepper-line" />}
            <span className="stepper-circle">{n < current ? <Check size={14} strokeWidth={3} /> : n}</span>
            <span className="stepper-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// 横スワイプで説明を見せる。最後のスライドで「次へ」
function Carousel({ slides, onDone }) {
  const scrollerRef = useRef(null);
  const [page, setPage] = useState(0);
  const isLast = page === slides.length - 1;

  // スクロール位置から今のスライドを求める
  const handleScroll = (e) => {
    const el = e.currentTarget;
    setPage(Math.round(el.scrollLeft / el.clientWidth));
  };

  const goTo = (index) => {
    const el = scrollerRef.current;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <>
      <div className="onboarding-scroller" ref={scrollerRef} onScroll={handleScroll}>
        {slides.map(({ icon: Icon, title, body }) => (
          <section key={title} className="onboarding-page">
            <div className="onboarding-icon">
              <Icon size={56} strokeWidth={1.5} />
            </div>
            <h2>{title}</h2>
            <p>{body}</p>
          </section>
        ))}
      </div>

      <div className="onboarding-footer">
        <div className="dots">
          {slides.map((s, i) => (
            <button
              key={s.title}
              className={i === page ? 'dot active' : 'dot'}
              onClick={() => goTo(i)}
              aria-label={`${i + 1}枚目`}
            />
          ))}
        </div>
        <div className="onboarding-action">
          {isLast ? (
            <button className="primary-button" onClick={onDone}>
              次へ
            </button>
          ) : (
            <p className="swipe-hint">横にスワイプ →</p>
          )}
        </div>
      </div>
    </>
  );
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// Step 3: 新規アカウント作成 / ログイン
function AccountForm({ initialMode }) {
  const navigate = useNavigate();
  const { logIn } = useApp();
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isSignup = mode === 'signup';
  const trimmedEmail = email.trim();
  const errors = {
    email: !trimmedEmail
      ? 'メールアドレスを入力してください'
      : !isEmail(trimmedEmail)
        ? 'メールアドレスの形式が正しくありません'
        : null,
    password: !password
      ? 'パスワードを入力してください'
      : isSignup && password.length < 8
        ? 'パスワードは8文字以上にしてください'
        : null,
    confirm: isSignup && confirm !== password ? 'パスワードが一致しません' : null,
  };
  const hasError = Object.values(errors).some(Boolean);

  const switchMode = (next) => {
    setMode(next);
    setSubmitted(false);
    setError(null);
    setPassword('');
    setConfirm('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (hasError) return;
    setLoading(true);
    setError(null);
    try {
      const account = await (isSignup ? signUp : logInApi)({ email: trimmedEmail, password });
      logIn(account);
      navigate('/home', { replace: true });
    } catch (err) {
      setError(err instanceof AuthError ? err.message : '通信に失敗しました。もう一度お試しください');
      setLoading(false);
    }
  };

  return (
    <form className="account-form" onSubmit={handleSubmit} noValidate>
      <h2 className="page-title">{isSignup ? 'アカウントを作成' : 'ログイン'}</h2>
      <p className="page-subtitle">
        {isSignup ? '記録やコインを保存するためにアカウントを作ります' : '登録したメールアドレスでログインします'}
      </p>

      <div className="segmented" role="tablist">
        <button type="button" role="tab" aria-selected={isSignup} className={isSignup ? 'active' : ''} onClick={() => switchMode('signup')}>
          新規登録
        </button>
        <button type="button" role="tab" aria-selected={!isSignup} className={!isSignup ? 'active' : ''} onClick={() => switchMode('login')}>
          ログイン
        </button>
      </div>

      <div className="account-fields">
        <label className="field">
          <span className="field-label">メールアドレス</span>
          <input
            className="text-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            placeholder="example@mail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {submitted && errors.email && <span className="field-error">{errors.email}</span>}
        </label>

        <label className="field">
          <span className="field-label">パスワード</span>
          <div className="password-input">
            <input
              className="text-input"
              type={showPassword ? 'text' : 'password'}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              placeholder={isSignup ? '8文字以上' : ''}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="icon-button small"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {submitted && errors.password && <span className="field-error">{errors.password}</span>}
        </label>

        {isSignup && (
          <label className="field">
            <span className="field-label">パスワード（確認）</span>
            <input
              className="text-input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {submitted && errors.confirm && <span className="field-error">{errors.confirm}</span>}
          </label>
        )}
      </div>

      {error && <p className="error-box">{error}</p>}

      <div className="bottom-bar">
        <button type="submit" className="primary-button wide" disabled={loading}>
          {loading ? (isSignup ? '作成中…' : 'ログイン中…') : isSignup ? 'アカウントを作成' : 'ログイン'}
        </button>
      </div>
    </form>
  );
}
