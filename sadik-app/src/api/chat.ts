import http from './http';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ChatResponse {
  response: string;
  message: ChatMessage;
}

export const chatApi = {
  /**
   * Send a chat message.
   * @param voiceMode  When true, the backend uses a shorter voice-optimised
   *                   system prompt that produces 2-3 sentence responses.
   */
  /**
   * @param voiceMode  When true, backend uses a shorter voice-optimised prompt.
   * @param signal     Optional AbortSignal to cancel the request mid-flight.
   */
  sendMessage: (content: string, voiceMode = false, signal?: AbortSignal) =>
    http
      .post<ChatResponse>(
        '/api/chat/message',
        { content, voice_mode: voiceMode },
        { signal },
      )
      .then((r) => r.data),
  getHistory: () => http.get<ChatMessage[]>('/api/chat/history').then((r) => r.data),
  clearHistory: () => http.delete('/api/chat/history'),
};
