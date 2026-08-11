const ORIGIN = 'https://event-department-portal.onrender.com';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const targetUrl = ORIGIN + url.pathname + url.search;

    const proxyHeaders = new Headers(request.headers);
    // Host должен указывать на Render, а не на сам воркер — иначе Render
    // не поймёт, какой сайт запрашивают (хотя у вас на сервисе всего один
    // сайт, это всё равно правильная практика для прокси).
    proxyHeaders.delete('host');

    // Cloudflare сама подставляет заголовок CF-Connecting-IP с настоящим
    // IP посетителя на границе своей сети — его невозможно подделать
    // клиенту. Пробрасываем именно его как X-Forwarded-For, иначе на
    // сервере все запросы через воркер будут выглядеть так, будто они
    // пришли с одного и того же IP (самого воркера). Это пригодится,
    // например, если в будущем на портале появится антиспам/рейт-лимит
    // или просто понадобится видеть реальные IP в логах Render.
    const realIP = request.headers.get('cf-connecting-ip');
    if (realIP) proxyHeaders.set('x-forwarded-for', realIP);

    const hasBody = !['GET', 'HEAD'].includes(request.method);
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: hasBody ? request.body : undefined,
      // duplex: 'half' обязателен спецификацией fetch, когда body — поток
      // (а не строка/буфер целиком) — без этого fetch кидает ошибку на
      // ЛЮБОМ запросе с телом (вход через Discord, заявка на Event Helper,
      // добавление участника в Состав, загрузка аватарки и т.д.).
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual', // на сайте нет серверных редиректов — просто отдаём ответ как есть
    });

    const originResponse = await fetch(proxyRequest);

    // Ответ (включая Set-Cookie для сессий, Cache-Control для картинок
    // и т.д.) пробрасываем без изменений.
    return new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: originResponse.headers,
    });
  },
};
