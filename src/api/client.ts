import axios from 'axios';
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from '../auth/tokenStorage';

type RefreshResponse = {
  accessToken: string;
  refreshToken: string;
};

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://10.0.2.2:8080';
let onAuthFailure: (() => void) | null = null;

export function setAuthFailureHandler(handler: (() => void) | null) {
  onAuthFailure = handler;
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let waiters: Array<(token: string | null) => void> = [];

function resolveWaiters(token: string | null) {
  waiters.forEach((w) => w(token));
  waiters = [];
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await axios.post<RefreshResponse>(`${API_BASE_URL}/auth/refresh`, { refreshToken });
    await saveTokens(response.data.accessToken, response.data.refreshToken);
    return response.data.accessToken;
  } catch {
    await clearTokens();
    onAuthFailure?.();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const original = error?.config;

    if (status !== 401 || !original || original._retry) {
      return Promise.reject(error);
    }

    original._retry = true;

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        waiters.push((token) => {
          if (!token) {
            reject(error);
            return;
          }
          original.headers.Authorization = `Bearer ${token}`;
          resolve(api(original));
        });
      });
    }

    isRefreshing = true;
    const newToken = await refreshAccessToken();
    isRefreshing = false;
    resolveWaiters(newToken);

    if (!newToken) {
      return Promise.reject(error);
    }

    original.headers.Authorization = `Bearer ${newToken}`;
    return api(original);
  }
);
