// Небольшая обёртка над fetch: JSON по умолчанию, аккуратная обработка ошибок.
// На free Render/Neon первый запрос после простоя может оборваться
// (ERR_CONNECTION_CLOSED) — для GET делаем один повтор после короткой паузы.
const api = {
  _timeoutMs: 25_000,

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
      // Повторяем только сетевые сбои / таймаут — не 4xx/5xx от сервера.
      if (err.status) throw err;
      await new Promise((r) => setTimeout(r, 800));
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
        signal: ctrl.signal,
        ...init,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        const e = new Error('Сервер не отвечает. Подождите пару секунд и обновите страницу.');
        e.status = 0;
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
