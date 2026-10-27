import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './store/AppContext';
import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import AppSelect from './pages/AppSelect';
import PurposeSelect from './pages/PurposeSelect';
import Confirm from './pages/Confirm';
import Stats from './pages/Stats';
import './App.css';

// ログインしていなければ（初めての利用者・ログアウト後）説明ページ、していればメイン画面
function Entry() {
  const { account } = useApp();
  return account ? <Navigate to="/home" replace /> : <Onboarding />;
}

// ログインが必要な画面
function RequireAccount({ children }) {
  const { account } = useApp();
  return account ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <div className="app-container">
          <Routes>
            <Route path="/" element={<Entry />} />
            <Route path="/home" element={<RequireAccount><Home /></RequireAccount>} />
            <Route path="/select-app" element={<RequireAccount><AppSelect /></RequireAccount>} />
            <Route path="/select-purpose" element={<RequireAccount><PurposeSelect /></RequireAccount>} />
            <Route path="/confirm" element={<RequireAccount><Confirm /></RequireAccount>} />
            <Route path="/stats" element={<RequireAccount><Stats /></RequireAccount>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AppProvider>
  );
}
