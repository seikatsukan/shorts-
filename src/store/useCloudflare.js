import { useCallback, useEffect, useState } from 'react';
import { CLOUDFLARE_DISCONNECTED_EVENT, connectCloudflare, fetchCloudflare, setupCloudflare } from '../api';

// Cloudflare との連携の状態と操作（AppContext から使う）
//
// user.cloudflare: 最後にサーバーから受け取った状態 { connected, accountName, setup } | null（まだ確かめていない）
//   起動した時・ログインした時にサーバーに確かめ直す。通信できない時は最後の状態のまま使う
// user.cloudflareReady: 「手でやる手順」（証明書など）を済ませたとユーザーが確かめたか
//   API では確かめられないので、チェックを付けてもらう。連携が切れたら false に戻す
// ロックの画面は、連携していて cloudflareReady の時だけ開ける（App.jsx の RequireCloudflare）

// Cloudflare から戻ってきた時に付く ?cloudflareError=<reason> を読み、アドレスからは消しておく
// （画面を作る前に1回だけ読むため、ここで読む）
const callbackParams = new URLSearchParams(window.location.search);
const initialCallbackError = callbackParams.get('cloudflareError');
if (initialCallbackError) {
  callbackParams.delete('cloudflareError');
  const query = callbackParams.toString();
  window.history.replaceState(window.history.state, '', window.location.pathname + (query ? `?${query}` : ''));
}

export function useCloudflare({ user, userId, updateUser }) {
  // このログインで、サーバーに確かめ終わったか（確かめた userId を持つ）
  const [checkedFor, setCheckedFor] = useState(null);
  const [checkError, setCheckError] = useState(null);
  const [callbackError, setCallbackError] = useState(initialCallbackError);

  const save = useCallback(
    (c) =>
      updateUser((u) => ({
        ...u,
        cloudflare: { connected: c.connected, accountName: c.accountName ?? null, setup: c.setup ?? null },
        cloudflareReady: c.connected ? u.cloudflareReady : false,
      })),
    [updateUser],
  );

  // 確かめ直す（通信できなかった時のやり直しボタン）
  const refreshCloudflare = useCallback(async () => {
    if (!userId) return;
    try {
      save(await fetchCloudflare());
      setCheckError(null);
    } catch (e) {
      setCheckError(e.message);
    } finally {
      setCheckedFor(userId);
    }
  }, [userId, save]);

  // ログインした時（アカウントが変わった時）に確かめる
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchCloudflare()
      .then((c) => {
        if (cancelled) return;
        save(c);
        setCheckError(null);
      })
      .catch((e) => !cancelled && setCheckError(e.message))
      .finally(() => !cancelled && setCheckedFor(userId));
    return () => {
      cancelled = true;
    };
  }, [userId, save]);

  // ロックなどの操作が CLOUDFLARE_NOT_CONNECTED になった時（Cloudflare 側で連携を外したなど）
  useEffect(() => {
    const onLost = () => save({ connected: false, accountName: null, setup: null });
    window.addEventListener(CLOUDFLARE_DISCONNECTED_EVENT, onLost);
    return () => window.removeEventListener(CLOUDFLARE_DISCONNECTED_EVENT, onLost);
  }, [save]);

  return {
    cloudflare: user.cloudflare ?? null,
    cloudflareReady: !!user.cloudflare?.connected && !!user.cloudflareReady,
    cloudflareChecked: checkedFor === userId,
    cloudflareCheckError: checkError,
    cloudflareCallbackError: callbackError,
    refreshCloudflare,
    // Cloudflare の認可画面へ移動する（戻ってきたら起動し直しになり、上で確かめ直す）
    connectCloudflare: async () => {
      setCallbackError(null);
      await connectCloudflare();
    },
    // 初期設定をして、結果を保存する
    runCloudflareSetup: async () => {
      const setup = await setupCloudflare();
      updateUser((u) => ({ ...u, cloudflare: { ...u.cloudflare, setup } }));
      return setup;
    },
    // 手でやる手順を済ませた
    confirmCloudflareSetup: () => updateUser((u) => ({ ...u, cloudflareReady: true })),
  };
}
