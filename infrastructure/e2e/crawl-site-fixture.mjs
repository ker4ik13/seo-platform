import http from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import assert from "node:assert/strict";

/** Real public HTTP through the test stand's Caddy; crawler DNS/SSRF checks stay enabled. */
export async function crawlSiteFixture(t) {
  assert.equal(process.env.SEO_PLATFORM_E2E_CONFIRM, "CREATE_TEST_DATA");
  assert.equal(process.env.SEO_PLATFORM_PUBLIC_URL, "https://144.31.221.28:3000");
  const suffix = randomUUID().slice(0, 8), host = `crawl-${suffix}.144.31.221.28.nip.io`, serverName = `srv_crawl_fixture_${suffix}`;
  assert.equal((await lookup(host, { family: 4 })).address, "144.31.221.28");
  const events = [], state = { header: undefined };
  const html = (title, body, head = "") => `<!doctype html><html lang="ru"><head><title>${title}</title><meta name="description" content="Тестовые страницы для настоящей проверки обхода сайта, без пользовательских и платёжных данных.">${head}</head><body><h1>${title}</h1>${body}<p>${"Текст контрольной страницы. ".repeat(30)}</p></body></html>`;
  const server = http.createServer((request, response) => {
    const path = new URL(request.url, `http://${host}`).pathname;
    const event = { path, method: request.method, status: 200, conditional: request.headers["if-none-match"] ?? null, agent: request.headers["user-agent"] ?? "" }; events.push(event);
    const send = (code, type, body, headers = {}) => { event.status = code; response.writeHead(code, { "Content-Type": type, ...headers }); response.end(body); };
    if (path === "/robots.txt") return send(200, "text/plain", "User-agent: SeoPlatformCrawler\nDisallow: /blocked/\nUser-agent: Googlebot\nDisallow: /google-blocked/\nUser-agent: YandexBot\nDisallow: /yandex-blocked/\nUser-agent: *\nAllow: /\n");
    if (path === "/sitemap.xml") return send(200, "application/xml", `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/services/", "/blocked/", "/header-only/"].map((path) => `<url><loc>http://${host}${path}</loc></url>`).join("")}</urlset>`);
    if (path === "/") return send(200, "text/html", html("Контрольный сайт", ["/services/", "/services/old/", "/blocked/", "/agent-meta/", "/header-only/", "/no-follow/", "/google-blocked/", "/yandex-blocked/"].map((url) => `<a href="${url}">Страница ${url}</a>`).join("")));
    if (path === "/services/old/") return send(301, "text/html", "", { Location: "/services/new/" });
    if (path === "/services/") {
      const headers = { ETag: '"service-v1"', ...(state.header ? { "X-Robots-Tag": state.header } : {}) };
      if (request.headers["if-none-match"] === '"service-v1"') return send(304, "text/html", "", headers);
      return send(200, "text/html", html("Услуги", '<a href="/services/new/" rel="nofollow">Новая услуга</a><h2>Заголовок раздела</h2><img src="/image.png" alt="Пример"><link rel="alternate" hreflang="en" href="/services/?lang=en">'), headers);
    }
    if (path === "/agent-meta/") return send(200, "text/html", html("Директивы по роботам", "", '<meta name="googlebot" content="noindex"><meta name="yandex" content="index, follow">'));
    if (path === "/header-only/") return send(200, "text/html", html("HTTP noindex", ""), { "X-Robots-Tag": "noindex" });
    if (path === "/no-follow/") return send(200, "text/html", html("Не переходить", '<a href="/never-discovered/">Нельзя добавлять при respectNofollow</a>', '<meta name="robots" content="nofollow">'));
    if (["/services/new/", "/google-blocked/", "/yandex-blocked/", "/blocked/", "/never-discovered/"].includes(path)) return send(200, "text/html", html(`Страница ${path}`, ""));
    return send(404, "text/html", html("Не найдено", ""));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port, admin = `http://127.0.0.1:2019/config/apps/http/servers/${serverName}`;
  t.after(async () => { await fetch(admin, { method: "DELETE", headers: { Origin: "http://127.0.0.1:2019" } }); server.close(); await once(server, "close"); });
  const previous = await fetch(admin); assert.equal(previous.ok, false, "Never overwrite an existing Caddy fixture");
  const configured = await fetch(admin, { method: "PUT", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:2019" }, body: JSON.stringify({ listen: ["144.31.221.28:80"], automatic_https: { disable: true }, routes: [{ match: [{ host: [host] }], handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `127.0.0.1:${port}` }] }] }] }) });
  assert.ok(configured.ok, `Test fixture Caddy configuration rejected: ${configured.status} ${await configured.text()}`);
  const root = `http://${host}/`; assert.equal((await fetch(root)).status, 200);
  return { domain: host, root, events, setHeader(value) { state.header = value; } };
}
