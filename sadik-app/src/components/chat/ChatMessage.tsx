import React from 'react';
import { Bot } from 'lucide-react';
import { ChatMessage as ChatMsg } from '../../api/chat';

interface Props {
  message: ChatMsg;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex items-end gap-2 animate-fade-in ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-accent-blue/20 border border-accent-blue/30 flex items-center justify-center flex-shrink-0 mb-4">
          <Bot size={14} className="text-accent-blue" />
        </div>
      )}
      <div className={`max-w-[75%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed
          ${isUser
            ? 'bg-accent-blue text-white rounded-br-md'
            : 'bg-bg-card border border-border text-text-primary rounded-bl-md'}`}>
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        <span className="text-xs text-text-muted px-1">{formatTime(message.created_at)}</span>
      </div>
    </div>
  );
}
