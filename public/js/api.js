// Небольшая обёртка над fetch: JSON по умолчанию, аккуратная обработка ошибок.
const api = {
  async get(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    return api._parse(res);
  },
  async send(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return api._parse(res);
  },
  post(url, body) { return api.send('POST', url, body); },
  put(url, body) { return api.send('PUT', url, body); },
  del(url) { return api.send('DELETE', url); },
  async upload(url, formData) {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', body: formData });
    return api._parse(res);
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
