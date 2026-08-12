// Исходящий HTTP(S)-прокси для Discord (OAuth fetch, REST, WebSocket undici).
// С многих VDS (РФ) discord.com / 162.159.*:443 недоступен напрямую —
// Connect Timeout. Задайте один из URL:
//   DISCORD_PROXY=http://user:pass@host:port
//   HTTPS_PROXY=...  /  HTTP_PROXY=...
//
// Должен вызываться ДО первого fetch / создания discord.js Client
// (см. src/server.js, src/bot/standalone.js).

const { ProxyAgent, setGlobalDispatcher, getGlobalDispatcher } = require('undici');

let configuredUrl = null;

function resolveProxyUrl() {
  return (
    (process.env.DISCORD_PROXY || '').trim() ||
    (process.env.HTTPS_PROXY || '').trim() ||
    (process.env.https_proxy || '').trim() ||
    (process.env.HTTP_PROXY || '').trim() ||
    (process.env.http_proxy || '').trim() ||
    ''
  );
}

function applyOutboundProxy() {
  const url = resolveProxyUrl();
  if (!url) {
    console.log(
      '[proxy] DISCORD_PROXY/HTTPS_PROXY не задан — Discord идёт напрямую. ' +
      'При Connect Timeout до 162.159.* задайте прокси или вынесите event-bot.'
    );
    return null;
  }
  try {
    const agent = new ProxyAgent(url);
    setGlobalDispatcher(agent);
    configuredUrl = url.replace(/\/\/([^/@]+)@/, '//***@'); // без пароля в логах
    console.log(`[proxy] Исходящий прокси включён: ${configuredUrl}`);
    return agent;
  } catch (err) {
    console.error('[proxy] Не удалось настроить прокси:', err.message);
    return null;
  }
}

function getRestAgent() {
  if (!configuredUrl && !resolveProxyUrl()) return undefined;
  try {
    return getGlobalDispatcher();
  } catch (_) {
    return undefined;
  }
}

module.exports = { applyOutboundProxy, getRestAgent, resolveProxyUrl };
