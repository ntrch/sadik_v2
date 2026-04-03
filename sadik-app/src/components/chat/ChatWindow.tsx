import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { ChatMessage as ChatMsg, chatApi } from '../../api/chat';
import ChatMessage from './ChatMessage';
import { AppContext } from '../../context/AppContext';

export default function ChatWindow() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast, triggerEvent, returnToIdle } = useContext(AppContext);

  useEffect(() => {
    chatApi.getHistory().then(setMessages).catch(() => {});
    return () => { if (returnTimer.current) clearTimeout(returnTimer.current); };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLoading(true);

    const tempMsg: ChatMsg = {
      id: Date.now(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);
    setTyping(true);
    triggerEvent('processing');

    try {
      const res = await chatApi.sendMessage(text);
      triggerEvent('assistant_speaking');
      const history = await chatApi.getHistory();
      setMessages(history);
      if (returnTimer.current) clearTimeout(returnTimer.current);
      returnTimer.current = setTimeout(() => returnToIdle(), 2000);
    } catch {
      showToast('Mesaj gönderilemedi', 'error');
      returnToIdle();
    }
    setTyping(false);
    setLoading(false);
  }, [input, loading, showToast, triggerEvent, returnToIdle]);

  const handleClear = async () => {
    await chatApi.clearHistory().catch(() => {});
    setMessages([]);
    showToast('Sohbet geçmişi temizlendi');
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <h1 className="text-xl font-bold text-text-primary">Sohbet</h1>
        <button onClick={handleClear}
          className="p-2 rounded-btn text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors"
          title="Geçmişi temizle">
          <Trash2 size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && !typing && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm gap-2">
            <p>SADIK ile sohbet etmeye başlayın.</p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {typing && (
          <div className="flex items-end gap-2 animate-fade-in">
            <div className="w-7 h-7 rounded-full bg-accent-blue/20 border border-accent-blue/30 flex items-center justify-center flex-shrink-0 mb-4">
              <span className="text-accent-blue text-xs">S</span>
            </div>
            <div className="bg-bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 bg-text-muted rounded-full typing-dot" />
                <span className="w-1.5 h-1.5 bg-text-muted rounded-full typing-dot" />
                <span className="w-1.5 h-1.5 bg-text-muted rounded-full typing-dot" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-6 py-4 border-t border-border flex-shrink-0">
        <div className="flex gap-3 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
            placeholder="Bir mesaj yazın..."
            className="flex-1 bg-bg-input border border-border rounded-btn px-4 py-2.5 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent-blue transition-colors resize-none"
            style={{ maxHeight: '120px' }}
          />
          <button onClick={handleSend} disabled={!input.trim() || loading}
            className="p-2.5 bg-accent-blue hover:bg-accent-blue-hover text-white rounded-btn transition-colors disabled:opacity-40 flex-shrink-0">
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
