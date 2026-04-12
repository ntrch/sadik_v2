import React, { useState } from 'react';
import { MessageSquare, Mic } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import ChatWindow from '../components/chat/ChatWindow';
import VoiceAssistant from '../components/voice/VoiceAssistant';

interface LocationState {
  tab?: 'voice';
}

export default function ChatPage() {
  const location = useLocation();
  const state = location.state as LocationState | null;
  const [activeTab, setActiveTab] = useState<'chat' | 'voice'>(state?.tab === 'voice' ? 'voice' : 'chat');

  return (
    <div className="h-full flex flex-col p-4 page-transition">
      {/* Tab selector */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-sm font-semibold transition-all ${
            activeTab === 'chat'
              ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
              : 'bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
          }`}
        >
          <MessageSquare size={18} className={activeTab === 'chat' ? 'text-accent-purple' : ''} />
          Sohbet
        </button>
        <button
          onClick={() => setActiveTab('voice')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-sm font-semibold transition-all ${
            activeTab === 'voice'
              ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
              : 'bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
          }`}
        >
          <Mic size={18} className={activeTab === 'voice' ? 'text-accent-cyan' : ''} />
          Sesli
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'chat' ? <ChatWindow /> : <VoiceAssistant />}
      </div>
    </div>
  );
}
