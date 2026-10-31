import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './store/AppContext';
import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import AppSelect from './pages/AppSelect';
import Confirm from './pages/Confirm';
import Stats from './pages/Stats';
import ModeSelect from './pages/ModeSelect';
import FixedSetup from './pages/FixedSetup';
import FixedHome from './pages/FixedHome';
import './App.css';

// ログインしていなければ（初めての利用者・ログアウト後）説明ページ、していればメイン画面
// Google のログインから戻ってきた時は、サーバーに確かめ終わるまで何も出さない
function Entry() {
  const { account, sessionChecked } = useApp();
  if (account) return <Navigate to="/home" replace />;
  return sessionChecked ? <Onboarding /> : null;
}

// ログインと使い方のモードが必要な画面（ログインしていなければ説明ページ、モードが未選択ならモード選択へ）。mode を指定するとそのモードの時だけ（違えばメイン画面へ）
function RequireMode({ mode: only, children }) {
  const { account, mode } = useApp();
  if (!account) return <Navigate to="/" replace />;
  if (!mode) return <Navigate to="/mode" replace />;
  if (only && mode !== only) return <Navigate to="/home" replace />;
  return children;
}

// メイン画面はモードごとに別
function HomeByMode() {
  const { mode } = useApp();
  return mode === 'fixed' ? <FixedHome /> : <Home />;
}

// モードを選ぶ画面・固定時間の予定の画面（固定時間を始めた後は開かない）
function RequireNotFixed({ children }) {
  const { account, mode } = useApp();
  if (!account) return <Navigate to="/" replace />;
  return mode === 'fixed' ? <Navigate to="/home" replace /> : children;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <div className="app-container">
          <Routes>
            <Route path="/" element={<Entry />} />
            <Route path="/mode" element={<RequireNotFixed><ModeSelect /></RequireNotFixed>} />
            <Route path="/fixed-setup" element={<RequireNotFixed><FixedSetup /></RequireNotFixed>} />
            <Route path="/home" element={<RequireMode><HomeByMode /></RequireMode>} />
            <Route path="/select-app" element={<RequireMode mode="timer"><AppSelect /></RequireMode>} />
            <Route path="/confirm" element={<RequireMode mode="timer"><Confirm /></RequireMode>} />
            <Route path="/stats" element={<RequireMode mode="timer"><Stats /></RequireMode>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AppProvider>
  );
}
