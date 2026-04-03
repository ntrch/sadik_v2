import axios from 'axios';

const BASE_URL = 'http://localhost:8000';

export const http = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

http.interceptors.response.use(
  (r) => r,
  (err) => {
    console.error('API Error:', err?.response?.data || err.message);
    return Promise.reject(err);
  }
);

export default http;
