import React, { useContext, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { AppContext } from './context/AppContext';
import Sidebar from './components/layout/Sidebar';
import DashboardPage from './pages/DashboardPage';
import TasksPage from './pages/TasksPage';
import FocusPage from './pages/FocusPage';
import ChatPage from './pages/ChatPage';
import VoicePage from './pages/VoicePage';
import SettingsPage from './pages/SettingsPage';

/**
 * Listens for wakeWordPending from AppContext and navigates to /voice
 * when detected on a different page. Renders nothing.
 */
function WakeWordNavigator() {
  const { wakeWordPending } = useContext(AppContext);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (wakeWordPending && location.pathname !== '/voice') {
      navigate('/voice');
    }
  }, [wakeWordPending, navigate, location.pathname]);

  return null;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <WakeWordNavigator />
        <div className="flex h-screen w-screen overflow-hidden bg-bg-main">
          <Sidebar />
          <main className="flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/focus" element={<FocusPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/voice" element={<VoicePage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AppProvider>
  );
}
