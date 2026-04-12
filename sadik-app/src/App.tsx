import React, { useContext, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { AppContext } from './context/AppContext';
import HeaderBar from './components/layout/HeaderBar';
import BottomNav from './components/layout/BottomNav';
import DashboardPage from './pages/DashboardPage';
import TasksPage from './pages/TasksPage';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import InsightsPage from './pages/InsightsPage';

function WakeWordNavigator() {
  const { wakeWordPending } = useContext(AppContext);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (wakeWordPending && location.pathname !== '/chat') {
      navigate('/chat', { state: { tab: 'voice' } });
    }
  }, [wakeWordPending, navigate, location.pathname]);

  return null;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <WakeWordNavigator />
        <div className="flex flex-col h-screen w-screen bg-bg-main">
          <HeaderBar />
          <main className="flex-1 overflow-y-auto pb-20">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
        <BottomNav />
      </BrowserRouter>
    </AppProvider>
  );
}
