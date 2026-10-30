import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, ChevronLeft, Smartphone, Cloud, Download, ShieldCheck, Power, Layers, Timer, CalendarClock, Sparkles,
  Coins, Eye, EyeOff, ExternalLink,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { AuthError, logIn as logInApi, signUp } from '../auth';

const STEPS = ['準備', '使い方', 'アカウント'];

// Step 1: スマホの準備（最初の1回だけ）
// ブロックは Cloudflare Zero Trust（ユーザー自身のアカウント）がスマホの 1.1.1.1 アプリ（WARP）の通信に対して行う。
// 証明書の手順は cf-rules（バックエンド）が「手でやる手順」として返すものと同じ
const SETUP_SLIDES = [
  {
    icon: Smartphone,
    title: '準備は最初の1回だけ',
    body: 'このアプリは Cloudflare（無料）の\n仕組みで、スマホの通信を止めます。\n使う前に、次の3つを用意します。\n\n① Cloudflare のアカウント\n② 1.1.1.1 アプリ\n③ Cloudflare の証明書',
  },
  {
    icon: Cloud,
    title: '① Cloudflare に登録',
    body: 'Cloudflare のアカウントを作り、\nZero Trust の無料プランを始めます。\nこの時に決める「チーム名」は\n② で使うのでメモしておきます。',
    links: [{ label: 'Cloudflare に登録', href: 'https://dash.cloudflare.com/sign-up' }],
  },
  {
    icon: Download,
    title: '② 1.1.1.1 アプリを入れる',
    body: '「1.1.1.1」アプリを入れて、\nメニュー →「アカウント」→\n「Cloudflare Zero Trust にログイン」で\nチーム名を入れて参加します。',
    links: [
      { label: 'App Store', href: 'https://apps.apple.com/app/id1423538627' },
      { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.cloudflare.onedotonedotonedotone' },
    ],
  },
  {
    icon: ShieldCheck,
    title: '③ 証明書を入れる',
    body: 'ブロックを正しく効かせるために、\nCloudflare の証明書をスマホに入れて\n信頼します。iPhone は、入れた後に\n設定 → 一般 → 情報 →\n証明書信頼設定 でオンにします。',
  },
  {
    icon: Power,
    title: '1.1.1.1 はオンのまま',
    body: '1.1.1.1 アプリがオフだと\nロックが効きません。\n普段からオンにしておきましょう。\n\nこのアプリと Cloudflare のつなぎ方は\nログインの後に案内します。',
  },
];

// Step 2: アプリの使い方
const USAGE_SLIDES = [
  {
    icon: Layers,
    title: '使い方は2つ',
    body: 'ログインした後に、どちらかを選びます。\n\n・自分でロック\n・固定時間で自動ロック\n\n「自分でロック」からは、あとで\n固定時間に変えられます。',
  },
  {
    icon: Timer,
    title: '自分でロック',
    body: '使いたくない時に、アプリと時間\n（20分・30分・1時間など）を選んで\nスタートします。\n始めたロックは、最後まで\nキャンセルできません。',
  },
  {
    icon: CalendarClock,
    title: '固定時間で自動ロック',
    body: '「平日 9:00〜17:00 は YouTube」のように\n曜日・時間帯・アプリを決めると、\n毎週その時間は自動でロックされます。\nやめる時は、翌朝に承認が必要です。',
  },
  {
    icon: Sparkles,
    title: '続けるとスライムが育つ',
    body: '目標を達成した日（固定時間では\n一時解除を使わなかった日）が続くと\nスライムの色が変わり、21日で銀色に。\nできなかった日は1つ戻ります。',
  },
  {
    icon: Coins,
    title: 'コインでチケットを買う',
    body: 'ロックをやりきるとコインがもらえます。\n自分でロックでは「お休みチケット」、\n固定時間では「一時解除チケット」を\nコインで買えます。',
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

      {step === 1 && <Carousel key="setup" slides={SETUP_SLIDES} onDone={() => setStep(2)} />}
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
        {slides.map(({ icon: Icon, title, body, links }) => (
          <section key={title} className="onboarding-page">
            <div className="onboarding-icon">
              <Icon size={56} strokeWidth={1.5} />
            </div>
            <h2>{title}</h2>
            <p>{body}</p>
            {/* 登録ページ・アプリのストアなど（別のタブで開く） */}
            {links && (
              <div className="onboarding-links">
                {links.map((l) => (
                  <a key={l.href} className="onboarding-link" href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.label} <ExternalLink size={14} />
                  </a>
                ))}
              </div>
            )}
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
