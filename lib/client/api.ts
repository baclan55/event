'use client';

const TIMEOUT_MS = 12_000;

export class ApiError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

async function parse(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error || `Ошибка запроса (${response.status})`, response.status);
  return data;
}

async function request(method: string, url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await parse(await fetch(url, { method, credentials: 'same-origin', ...init, signal: controller.signal }));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === 'AbortError') throw new ApiError('Сервер не отвечает. Обновите страницу и попробуйте ещё раз.');
    throw new ApiError('Сеть недоступна. Проверьте соединение и повторите попытку.');
  } finally {
    window.clearTimeout(timer);
  }
}

export const api = {
  get: (url: string) => request('GET', url),
  send: (method: string, url: string, body?: unknown) => request(method, url, {
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  post: (url: string, body?: unknown) => api.send('POST', url, body),
  put: (url: string, body?: unknown) => api.send('PUT', url, body),
  del: (url: string) => request('DELETE', url),
  upload: (url: string, body: FormData) => request('POST', url, { body }),
};
