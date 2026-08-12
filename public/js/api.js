// Небольшая обёртка над fetch: JSON по умолчанию, аккуратная обработка ошибок.
const api = {
  // Короткий timeout: лучше быстро показать ошибку, чем держать белый экран ~50с.
  _timeoutMs: 12_000,

  async get(url) {
    return api._fetchWithRetry('GET', url);
  },
  async send(method, url, body) {
    const res = await api._fetch(method, url, {
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return api._parse(res);
  },
  post(url, body) { return api.send('POST', url, body); },
  put(url, body) { return api.send('PUT', url, body); },
  del(url) { return api.send('DELETE', url); },
  async upload(url, formData) {
    const res = await api._fetch('POST', url, { body: formData });
    return api._parse(res);
  },

  async _fetchWithRetry(method, url, init) {
    try {
      const res = await api._fetch(method, url, init);
      return api._parse(res);
    } catch (err) {
      // Не ретраим таймаут (AbortError) и HTTP-ошибки — только обрыв сети.
      if (err.status || err.aborted) throw err;
      await new Promise((r) => setTimeout(r, 400));
      const res = await api._fetch(method, url, init);
      return api._parse(res);
    }
  },

  async _fetch(method, url, init = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), api._timeoutMs);
    try {
      return await fetch(url, {
        method,
        credentials: 'same-origin',
        ...init,
        signal: ctrl.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        const e = new Error('Сервер не отвечает. Подождите пару секунд и обновите страницу.');
        e.status = 0;
        e.aborted = true;
        throw e;
      }
      const e = new Error('Сеть недоступна или соединение оборвалось. Попробуйте ещё раз.');
      e.status = 0;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },

  async _parse(res) {
    let data = null;
    try { data = await res.json(); } catch (e) { /* пустой ответ */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Ошибка запроса (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
};
