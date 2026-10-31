// 端末に保存したデータ（コイン・スライム・予定・記録）を消されにくくするための処理
//
// データはブラウザの localStorage にある。電源を切っても消えないが、次の時は消えることがある。
// - iPhone の Safari: 7日間そのサイトを開かないと消す。ホーム画面に追加して開いた時は対象外
// - 容量が足りない時: ブラウザが古いデータから消す。persist() を許可されると消さなくなる
// サーバーに保存するようになったら、ここは要らなくなる

// ホーム画面に追加したアプリとして開いているか
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

// iPhone / iPad か（ホーム画面に追加する手順が Android と違う）
export const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ブラウザに「容量が足りなくてもこのサイトのデータは消さないで」と頼む（許可されるかはブラウザ次第）
export function requestPersistentStorage() {
  navigator.storage?.persist?.().catch(() => {});
}

// ホーム画面に追加する手順（説明ページとメイン画面のお知らせで使う）
export const installSteps = () =>
  isIos()
    ? 'Safari の下にある共有ボタン（□に↑）\n→「ホーム画面に追加」→「追加」'
    : 'Chrome の右上の「︙」\n→「ホーム画面に追加」\n（または「アプリをインストール」）';
