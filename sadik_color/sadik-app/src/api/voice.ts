import http from './http';
import axios from 'axios';

export const voiceApi = {
  /**
   * Send *audioBlob* to Whisper and return the Turkish transcript.
   * Pass an AbortSignal to cancel the request mid-flight.
   */
  stt: async (audioBlob: Blob, signal?: AbortSignal, prompt?: string): Promise<string> => {
    // Use the actual MIME type from the Blob so Whisper can identify the format.
    const mime      = audioBlob.type || 'audio/webm';
    const ext       = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
    const filename  = `recording.${ext}`;
    console.log('[Voice] STT request:', { size: audioBlob.size, type: mime, filename });
    const formData  = new FormData();
    formData.append('audio', audioBlob, filename);
    if (prompt) formData.append('prompt', prompt);

    const response = await axios.post('http://localhost:8000/api/voice/stt', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
      signal,
    });
    return response.data.text;
  },

  /**
   * Request TTS audio for *text*.  Returns a Blob (audio/mpeg).
   * Pass an AbortSignal to cancel the request mid-flight.
   */
  tts: async (text: string, signal?: AbortSignal): Promise<Blob> => {
    const response = await axios.post(
      'http://localhost:8000/api/voice/tts',
      { text },
      { responseType: 'blob', timeout: 30000, signal },
    );
    return response.data;
  },

  /**
   * Streaming voice-chat: sends *text* to the backend which streams LLM tokens
   * → TTS per sentence.
   *
   * Wire frame format (typed length-prefix):
   *   [1 byte type][4 bytes big-endian uint32 length][length bytes payload]
   *   type 0x01 = MP3 audio chunk
   *   type 0x00 = JSON metadata {"text": "<full_reply>", "tool_calls_used": [...]} — last frame
   *   type 0x02 = JSON tool_status {"type":"tool_status","tool_name":str,"phase":"executing"|"completed"}
   *
   * The *onChunk* callback is invoked for each MP3 Blob as it arrives so the
   * caller can queue and play chunks sequentially without waiting for the full
   * response.
   *
   * The optional *onToolEvent* callback is invoked for each tool_status frame
   * so the UI can show an indicator while a tool is executing.
   *
   * Returns the full plain-text reply from the metadata frame (for display).
   */
  voiceChatStream: async (
    text: string,
    history: Array<{ role: string; content: string }>,
    onChunk: (audioBlob: Blob, sentenceIndex: number) => void,
    signal?: AbortSignal,
    onToolEvent?: (event: { type: 'tool_status'; tool_name: string; phase: 'executing' | 'completed' }) => void,
  ): Promise<string> => {
    const response = await fetch('http://localhost:8000/api/voice/voice-chat-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, history }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Voice chat stream failed: ${response.status}`);
    }

    const reader  = response.body!.getReader();
    let   buffer  = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
    let   index   = 0;
    let   replyText = '';

    const append = (a: Uint8Array<ArrayBuffer>, b: Uint8Array): Uint8Array<ArrayBuffer> => {
      const out = new Uint8Array(a.length + b.length) as Uint8Array<ArrayBuffer>;
      out.set(a);
      out.set(b, a.length);
      return out;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) buffer = append(buffer, value);

      // Drain all complete frames: [1 type][4 length][payload]
      while (buffer.length >= 5) {
        const frameType = buffer[0];
        const payloadLen = new DataView(buffer.buffer, buffer.byteOffset + 1, 4).getUint32(0, false);
        if (buffer.length < 5 + payloadLen) break;  // incomplete frame — wait
        const payload = buffer.slice(5, 5 + payloadLen);
        buffer = buffer.slice(5 + payloadLen);

        if (frameType === 0x01) {
          // Audio frame
          const blob = new Blob([payload], { type: 'audio/mpeg' });
          onChunk(blob, index++);
        } else if (frameType === 0x00) {
          // Metadata frame — extract reply text and log tool_calls_used
          try {
            const meta = JSON.parse(new TextDecoder().decode(payload)) as {
              text?: string;
              tool_calls_used?: Array<{ name: string; args_summary: string }>;
            };
            replyText = meta.text ?? '';
            if (meta.tool_calls_used && meta.tool_calls_used.length > 0) {
              console.log('[VoiceStream] tool_calls_used:', meta.tool_calls_used);
            }
          } catch {
            console.warn('[VoiceStream] Failed to parse metadata frame');
          }
        } else if (frameType === 0x02) {
          // Tool status frame
          if (onToolEvent) {
            try {
              const event = JSON.parse(new TextDecoder().decode(payload)) as {
                type: 'tool_status';
                tool_name: string;
                phase: 'executing' | 'completed';
              };
              onToolEvent(event);
            } catch {
              console.warn('[VoiceStream] Failed to parse tool_status frame');
            }
          }
        }
      }
    }

    return replyText;
  },

  listDevices: () => http.get('/api/voice/devices').then((r) => r.data),
};
