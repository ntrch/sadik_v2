import React, { useContext, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MessageSquare, Mic } from 'lucide-react';
import { AppProvider } from './context/AppContext';
import { AppContext } from './context/AppContext';
import HeaderBar from './components/layout/HeaderBar';
import BottomNav from './components/layout/BottomNav';
import DashboardPage from './pages/DashboardPage';
import TasksPage from './pages/TasksPage';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import InsightsPage from './pages/InsightsPage';
import MemoryPage from './pages/MemoryPage';
import VoiceAssistant from './components/voice/VoiceAssistant';

/**
 * Tab selector for the /chat route. Lives at App level so the persistent
 * VoiceAssistant (mounted once, never unmounted) can overlay the chat body
 * without getting torn down by route/tab changes.
 */
function ChatTabs() {
  const { voiceUiVisible, setVoiceUiVisible } = useContext(AppContext);
  return (
    <div className="flex items-center gap-2 px-4 pt-4">
      <button
        onClick={() => setVoiceUiVisible(false)}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-sm font-semibold transition-all ${
          !voiceUiVisible
            ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
            : 'bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
        }`}
      >
        <MessageSquare size={18} className={!voiceUiVisible ? 'text-accent-purple' : ''} />
        Sohbet
      </button>
      <button
        onClick={() => setVoiceUiVisible(true)}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-sm font-semibold transition-all ${
          voiceUiVisible
            ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
            : 'bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
        }`}
      >
        <Mic size={18} className={voiceUiVisible ? 'text-accent-cyan' : ''} />
        Sesli
      </button>
    </div>
  );
}

/**
 * Layout chrome that can read context/router hooks. Splits so we can place
 * <ChatTabs /> conditionally by route while keeping <VoiceAssistant />
 * mounted for the entire app lifetime.
 */
function AppShell() {
  const location = useLocation();
  const { voiceUiVisible, setVoiceUiVisible, wakeWordPending } = useContext(AppContext);
  const onChatRoute = location.pathname === '/chat';

  // When the user leaves /chat, the voice tab is no longer visible, but the
  // VoiceAssistant keeps running in the background. On returning to /chat we
  // default back to the chat tab unless an ongoing turn is speaking/listening.
  useEffect(() => {
    if (!onChatRoute && voiceUiVisible) setVoiceUiVisible(false);
  }, [onChatRoute, voiceUiVisible, setVoiceUiVisible]);

  // Wake-word: surface the voice tab if the user happens to be on /chat, but
  // never force-navigate away from another page — the voice flow runs in the
  // background and the user stays where they are.
  useEffect(() => {
    if (wakeWordPending && onChatRoute) setVoiceUiVisible(true);
  }, [wakeWordPending, onChatRoute, setVoiceUiVisible]);

  return (
    <div className="flex flex-col h-screen w-screen bg-bg-main">
      <HeaderBar />
      {onChatRoute && <ChatTabs />}
      <main className="flex-1 overflow-y-auto pb-20 relative">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        <div
          aria-hidden={!(onChatRoute && voiceUiVisible)}
          className={
            onChatRoute && voiceUiVisible
              ? 'absolute inset-0 bg-bg-main overflow-y-auto'
              : 'hidden'
          }
        >
          <VoiceAssistant />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </AppProvider>
  );
}
