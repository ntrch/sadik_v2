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
    const ext       = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'webm';
    const formData  = new FormData();
    formData.append('audio', audioBlob, `recording.${ext}`);
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

  listDevices: () => http.get('/api/voice/devices').then((r) => r.data),
};
