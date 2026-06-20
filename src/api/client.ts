import axios from 'axios';
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from '../auth/tokenStorage';

type RefreshResponse = {
  accessToken: string;
  refreshToken: string;
};

type CachedGetResponse = {
  etag: string;
  data: unknown;
};

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://10.0.2.2:8080';

export function getApiErrorMessage(error: any, fallback = 'Request failed'): string {
  if (error?.code === 'ECONNABORTED') {
    return 'The request is taking longer than expected. Please try again in a moment.';
  }
  if (!error?.response) {
    return 'Cannot reach the server. Check your connection or try again in a moment.';
  }
  return error.response?.data?.message || error.response?.data?.error || fallback;
}

let onAuthFailure: (() => void) | null = null;
const conditionalGetCache = new Map<string, CachedGetResponse>();

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

function conditionalCacheKey(config: any): string | null {
  if (String(config?.method ?? 'get').toLowerCase() !== 'get' || !config?.url) return null;
  const params = config.params ? JSON.stringify(config.params) : '';
  return `${config.baseURL ?? ''}${config.url}?${params}`;
}

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const cacheKey = conditionalCacheKey(config);
  const cached = cacheKey ? conditionalGetCache.get(cacheKey) : null;
  if (cached) config.headers['If-None-Match'] = cached.etag;
  (config as any)._conditionalCacheKey = cacheKey;
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
    conditionalGetCache.clear();
    onAuthFailure?.();
    return null;
  }
}

api.interceptors.response.use(
  (response) => {
    const cacheKey = (response.config as any)._conditionalCacheKey as string | null;
    const etag = response.headers?.etag as string | undefined;
    if (cacheKey && etag && response.status === 200) {
      conditionalGetCache.delete(cacheKey);
      conditionalGetCache.set(cacheKey, { etag, data: response.data });
      if (conditionalGetCache.size > 250) {
        const oldest = conditionalGetCache.keys().next().value as string | undefined;
        if (oldest) conditionalGetCache.delete(oldest);
      }
    }
    return response;
  },
  async (error) => {
    const status = error?.response?.status;
    const original = error?.config;

    if (status === 304 && original?._conditionalCacheKey) {
      const cached = conditionalGetCache.get(original._conditionalCacheKey);
      if (cached) {
        return Promise.resolve({
          ...error.response,
          status: 200,
          statusText: 'OK',
          data: cached.data,
          config: original,
        });
      }
    }

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
