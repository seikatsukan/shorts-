import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, Cloud, LogOut, Minus, X } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { SetupGuide } from '../components/SetupGuide';
import { AGENT_GUIDE, SIGNUP_GUIDE, appLockGuide, certGuide } from '../data/setupGuide';

// Cloudflare との連携（ログインの後に1回。メニューからも開ける）
//   ① 連携する: Cloudflare の画面で、このアプリがブロックの設定を書き込むのを許可する
//   ② 設定を仕上げる: サーバーが初期設定（POST /cloudflare/setup）をし、残りの手でやる手順にチェックを付けてもらう
// 済んだらメイン画面へ（モードが未選択ならモード選択へ）

// Cloudflare から戻ってきた時の ?cloudflareError=<reason>（cf-rules の OAuthCallbackError と同じ）
const CALLBACK_ERRORS = {
  denied: 'Cloudflare の画面で連携が許可されませんでした。',
  expired: '連携を始めてから時間が経ちすぎました。最初からやり直してください。',
  missing_cookie: '連携を始めたのと別の画面で戻ってきたようです。このアプリの中からもう一度お試しください。',
  user_mismatch: '連携を始めた時と別のアカウントでログインしています。',
};
const callbackErrorText = (reason) =>
  `${CALLBACK_ERRORS[reason] ?? '連携できませんでした。'}もう一度お試しください。`;

// 自動でする初期設定（true: 済み / false: できなかった / null: 確認できなかった）
const AUTO_SETTINGS = [
  { key: 'tlsDecryptEnabled', label: '通信の中身を確かめる設定' },
  { key: 'gatewayProxyEnabled', label: 'Cloudflare One Agent の通信を通す設定' },
];

// 手でやる手順（サーバーが返す文）を、分かりやすい見出しとやり方に置き換える。知らない文はそのまま出す
// サーバーの文は「WARP（1.1.1.1 アプリ）」のままだが、今は Cloudflare One Agent アプリで参加する（data/setupGuide.js）
// アプリで参加してから証明書を入れる順に並べる
const manualStepView = (step) => {
  if (step.includes('WARP') || step.includes('1.1.1.1') || step.includes('Zero Trust 組織')) {
    return { order: 0, title: 'Cloudflare One Agent アプリで、自分のチームに参加する', guide: AGENT_GUIDE };
  }
  if (step.includes('証明書')) {
    return { order: 1, title: 'Cloudflare の証明書を入れて、信頼する', guide: certGuide() };
  }
  return { order: 2, title: step, guide: null };
};

// サーバーの手順に無いが、アプリ側で足す手順（最後に出す）
const APP_LOCK_STEP = 'app-lock';
const LOCAL_STEPS = () => [
  { step: APP_LOCK_STEP, title: 'Cloudflare One Agent を消せないようにする', guide: appLockGuide() },
];

export default function CloudflareConnect() {
  const navigate = useNavigate();
  const {
    cloudflare, cloudflareReady, cloudflareChecked, cloudflareCheckError, cloudflareCallbackError,
    refreshCloudflare, connectCloudflare, runCloudflareSetup, confirmCloudflareSetup, logOut,
  } = useApp();
  const connected = !!cloudflare?.connected;
  // メニューから開いた時（済んでいる時）は戻れる。済んでいない時は、別のアカウントに変えられるようにログアウトを出す
  const header = (
    <header className="top-bar">
      {cloudflareReady ? (
        <button className="icon-button" onClick={() => navigate('/home')} aria-label="戻る">
          <ChevronLeft size={24} />
        </button>
      ) : (
        <div style={{ width: 40 }} />
      )}
      {!cloudflareReady && (
        <button
          className="text-button"
          onClick={() => {
            logOut();
            navigate('/', { replace: true });
          }}
        >
          <LogOut size={16} /> ログアウト
        </button>
      )}
    </header>
  );

  // 前に確かめた状態が無く、サーバーに確かめている途中
  if (!cloudflare && !cloudflareChecked) {
    return (
      <div className="screen connect-screen">
        {header}
        <p className="empty-text">確認しています…</p>
      </div>
    );
  }

  return (
    <div className="screen connect-screen">
      {header}
      <h2 className="page-title">Cloudflare と連携</h2>
      <p className="page-subtitle">
        ロックは、あなたの Cloudflare にブロックの設定を書き込んで行います。最初に1回だけ連携します。
      </p>

      <ol className="connect-steps">
        <li className={connected ? 'done' : 'active'}>
          <span className="connect-step-circle">{connected ? <Check size={14} strokeWidth={3} /> : 1}</span>
          連携する
        </li>
        <li className={cloudflareReady ? 'done' : connected ? 'active' : ''}>
          <span className="connect-step-circle">{cloudflareReady ? <Check size={14} strokeWidth={3} /> : 2}</span>
          設定を仕上げる
        </li>
      </ol>

      {cloudflareCheckError && !cloudflare && (
        <div className="error-box">
          <p>{cloudflareCheckError}</p>
          <button className="text-button" onClick={refreshCloudflare}>
            もう一度確かめる
          </button>
        </div>
      )}

      {connected ? (
        <SetupStep
          accountName={cloudflare.accountName}
          setup={cloudflare.setup}
          ready={cloudflareReady}
          runSetup={runCloudflareSetup}
          onDone={() => {
            confirmCloudflareSetup();
            navigate('/home', { replace: true });
          }}
        />
      ) : (
        <ConnectStep callbackError={cloudflareCallbackError} connect={connectCloudflare} />
      )}
    </div>
  );
}

// ① 連携する
function ConnectStep({ callbackError, connect }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      await connect(); // Cloudflare の画面へ移動する
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <>
      <section className="card connect-card">
        <div className="connect-icon">
          <Cloud size={28} />
        </div>
        <p>
          ボタンを押すと Cloudflare の画面が開きます。ログインして「許可」を押すと、このアプリに戻ってきます。
        </p>
        <p className="connect-note">まだ Cloudflare に登録していない人は、先に登録して Zero Trust の無料プランを始めてください。</p>
        <SetupGuide guide={SIGNUP_GUIDE} label="登録のやり方を見る" />
      </section>

      {(error || callbackError) && <p className="error-box">{error ?? callbackErrorText(callbackError)}</p>}

      <div className="bottom-bar">
        <button className="primary-button wide" disabled={loading} onClick={handleConnect}>
          {loading ? '移動中…' : 'Cloudflare と連携する'}
        </button>
      </div>
    </>
  );
}

// ② 設定を仕上げる（自動の初期設定 → 手でやる手順にチェック）
function SetupStep({ accountName, setup, ready, runSetup, onDone }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [checked, setChecked] = useState(() => new Set());

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      await runSetup();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }, [runSetup]);

  // 済んでいない時は、開いた時に1回だけ自動で初期設定をする（何度呼んでもよい API）
  const startedRef = useRef(false);
  useEffect(() => {
    if (ready || startedRef.current) return;
    startedRef.current = true;
    run();
  }, [ready, run]);

  const steps = setup?.manualSteps ?? [];
  const autoFailed = AUTO_SETTINGS.some(({ key }) => setup?.[key] === false);
  const canFinish =
    !!setup && !running && !autoFailed && [...steps, APP_LOCK_STEP].every((s) => checked.has(s));
  const toggle = (step) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });

  return (
    <>
      <section className="card">
        <p className="connect-account">
          <Check size={16} /> 連携しました{accountName && <span>（{accountName}）</span>}
        </p>
        <h3 className="connect-heading">自動でする設定</h3>
        <ul className="connect-auto">
          {AUTO_SETTINGS.map(({ key, label }) => {
            const value = setup?.[key];
            return (
              <li key={key}>
                <span>{label}</span>
                {running ? (
                  <span className="connect-status">設定中…</span>
                ) : value === true ? (
                  <span className="connect-status ok">
                    <Check size={14} /> 済み
                  </span>
                ) : value === false ? (
                  <span className="connect-status ng">
                    <X size={14} /> できませんでした
                  </span>
                ) : (
                  <span className="connect-status">
                    <Minus size={14} /> 確認できませんでした
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {(error || autoFailed) && !running && (
          <div className="error-box">
            <p>{error ?? '設定できなかった項目があります。'}</p>
            <button className="text-button" onClick={run}>
              もう一度設定する
            </button>
          </div>
        )}
      </section>

      {setup && (
        <section className="card">
          <h3 className="connect-heading">スマホで自分でやること</h3>
          <p className="connect-note">上から順に進めてください。アプリからは確かめられないので、済んだらチェックを付けます。</p>
          <ul className="connect-manual">
            {[
              ...steps.map((step) => ({ step, ...manualStepView(step) })).sort((a, b) => a.order - b.order),
              ...LOCAL_STEPS(),
            ].map(({ step, title, guide }, i) => {
              const isChecked = ready || checked.has(step);
              return (
                <li key={step}>
                  <label>
                    <input type="checkbox" checked={isChecked} disabled={ready} onChange={() => toggle(step)} />
                    <span>
                      <span className="connect-manual-no">{i + 1}</span>
                      {title}
                    </span>
                  </label>
                  {guide && <SetupGuide guide={guide} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!ready && (
        <div className="bottom-bar">
          <button className="primary-button wide" disabled={!canFinish} onClick={onDone}>
            設定が終わった
          </button>
        </div>
      )}
    </>
  );
}
