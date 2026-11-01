// 画面（dist）を配り、API へのパスだけを cf-rules-api に渡す。パスは変えずにそのまま渡す
const API_PATHS = /^\/(api|auth|cloudflare)(\/|$)/;

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (API_PATHS.test(pathname)) return env.API.fetch(request);
    return env.ASSETS.fetch(request);
  },
};
