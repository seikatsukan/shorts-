import { isIos } from '../device';

// Cloudflare の準備の手順（説明ページの概要と、連携の画面の「やり方を見る」で使う）
//
// 2026-11 時点の Cloudflare のドキュメントに合わせた内容
// - スマホは「Cloudflare One Agent」アプリで Zero Trust に参加する。1.1.1.1 アプリでの Zero Trust へのログインは 2026-05 で終わった
// - スマホを参加させる前に、管理画面で「誰が参加できるか」（Device enrollment permissions）を決めておく
// - 証明書は管理画面からダウンロードして手で入れる（スマホでは自動で入らない。iPhone は Safari でしか入れられない）
// 管理画面は英語で、メニューの名前は変わることがある

export const CF_LINKS = {
  signup: { label: 'Cloudflare に登録', href: 'https://dash.cloudflare.com/sign-up' },
  dashboard: { label: 'Zero Trust の管理画面', href: 'https://one.dash.cloudflare.com/' },
  appStore: { label: 'App Store', href: 'https://apps.apple.com/app/id6443476492' },
  googlePlay: { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.cloudflare.cloudflareoneagent' },
};

const MENU_NOTE = '管理画面は英語です。メニューの名前が少し違う時は、近い名前のものを選んでください。';

// Cloudflare に登録して、Zero Trust を始める
export const SIGNUP_GUIDE = {
  sections: [
    {
      steps: [
        '「Cloudflare に登録」から、メールアドレスとパスワードでアカウントを作る',
        '管理画面のメニューから「Zero Trust」を開く',
        'チーム名を決める（例: taro-block）。あとでアプリに入れるのでメモしておく',
        'プランは「Free」（無料）を選ぶ。支払い方法の入力を求められますが、無料プランなら請求されません',
      ],
    },
  ],
  links: [CF_LINKS.signup],
};

// スマホを自分のチームに参加させる（管理画面で許可 → アプリで参加）
export const AGENT_GUIDE = {
  sections: [
    {
      title: 'A. 管理画面で、自分のスマホの参加を許可する',
      steps: [
        'Zero Trust の管理画面で「Team & Resources」→「Devices」→「Device profiles」→「Management」を開く',
        '「Device enrollment permissions」の「Manage」を押す',
        '「Policies」に、自分のメールアドレスを許可するルールを足す（Selector は「Emails」、Value は自分のメールアドレス）',
        '「Login methods」で「One-time PIN」を選んで保存する',
      ],
      note: MENU_NOTE,
    },
    {
      title: 'B. アプリでチームに参加する',
      steps: [
        '「Cloudflare One Agent」アプリを入れる（「1.1.1.1」アプリではありません）',
        'アプリを開き、案内に沿って進めてプライバシーポリシーに同意する',
        'メモしておいたチーム名を入れる',
        'メールアドレスを入れ、届いた確認コード（PIN）を入れる',
        '「VPN プロファイルをインストール」を押して許可する',
        'スイッチをオン（接続済み）にする',
      ],
    },
  ],
  links: [CF_LINKS.dashboard, CF_LINKS.appStore, CF_LINKS.googlePlay],
};

// Cloudflare の証明書を入れて信頼する（iPhone と Android で手順が違う）
export const certGuide = () => ({
  sections: [
    isIos()
      ? {
          steps: [
            'iPhone の Safari で Zero Trust の管理画面を開く（Safari 以外では証明書を入れられません）',
            '「Traffic policies」→「Traffic settings」→「Certificates」で証明書を選び、「More actions」から .pem でダウンロードする',
            '「ファイル」アプリの「最近使った項目」で、ダウンロードしたファイルを開く',
            '「設定」アプリの上に出る「プロファイルがダウンロードされました」→「インストール」',
            '「設定」→「一般」→「情報」→「証明書信頼設定」で、Cloudflare の証明書をオンにする',
          ],
          note: MENU_NOTE,
        }
      : {
          steps: [
            'スマホのブラウザで Zero Trust の管理画面を開く',
            '「Traffic policies」→「Traffic settings」→「Certificates」で証明書を選び、「More actions」から .crt でダウンロードする',
            '「設定」アプリで「証明書」と検索し、「CA 証明書」を選ぶ',
            'ダウンロードしたファイルを選んでインストールする',
          ],
          note: `${MENU_NOTE} Android は機種によって「設定」の中の場所が違います。`,
        },
  ],
  links: [CF_LINKS.dashboard],
});

// Cloudflare One Agent を消せないようにする（消すとロックが効かなくなるため）
// iPhone はスクリーンタイムで「App の削除」を許可しない。Android には同じ設定が標準では無い
export const appLockGuide = () => ({
  sections: [
    isIos()
      ? {
          steps: [
            '「設定」→「スクリーンタイム」を開き、スクリーンタイムをオンにする',
            '「スクリーンタイム・パスコードを使用」でパスコードを決める（家族や友だちに決めてもらうと、自分では外せなくなります）',
            '「コンテンツとプライバシーの制限」をオンにする',
            '「iTunes および App Store での購入」→「App の削除」を「許可しない」にする',
          ],
          note: 'iOS のバージョンによって、項目の名前が少し違うことがあります。',
        }
      : {
          steps: ['Cloudflare One Agent を消さないようにしてください（Android には、アプリの削除を止める設定が標準ではありません）'],
        },
  ],
  links: [],
});
