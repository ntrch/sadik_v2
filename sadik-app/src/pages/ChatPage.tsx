import React from 'react';
import { MessageSquare } from 'lucide-react';
import ChatWindow from '../components/chat/ChatWindow';

export default function ChatPage() {
  return (
    <div className="h-full flex flex-col p-4 page-transition">
      {/* Page header */}
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-accent-red/15">
          <MessageSquare size={24} className="text-accent-red" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-text-primary">Sohbet</h1>
          <p className="text-sm text-text-muted">Sadık ile yazılı asistan</p>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <ChatWindow />
      </div>
    </div>
  );
}
