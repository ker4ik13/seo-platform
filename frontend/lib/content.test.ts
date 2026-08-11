import assert from "node:assert/strict";
import test from "node:test";
import { getMarketingPage } from "./content.ts";
import { locales } from "./locales.ts";

test("marketing pages have bounded SEO metadata and complete localized sections", () => {
  for (const locale of locales) {
    const page = getMarketingPage(locale);

    assert.ok(page.title.length >= 30 && page.title.length <= 65);
    assert.ok(page.description.length >= 110 && page.description.length <= 170);
    assert.ok(page.heroTitle.length >= 30 && page.heroTitle.length <= 70);
    assert.equal(page.capabilities.length, 6);
    assert.equal(page.workflow.length, 4);
    assert.equal(page.integrations.length, 3);
    assert.ok(page.faqs.length >= 8);
    assert.equal(new Set(page.navigation.map((item) => item.href)).size, page.navigation.length);
    assert.equal(new Set(page.faqs.map((faq) => faq.question)).size, page.faqs.length);
  }
});

test("Russian home page covers the primary commercial and live product clusters", () => {
  const page = getMarketingPage("ru");
  const searchableCopy = JSON.stringify(page).toLocaleLowerCase("ru-RU");
  const requiredPhrases = [
    "seo-платформа",
    "seo-сервис",
    "сервис для seo-специалиста",
    "сбор семантического ядра",
    "проверка частотности запросов",
    "мониторинг позиций сайта",
    "проверка позиций сайта",
    "яндексе и google",
    "управление seo-проектами",
    "автоматизация seo",
    "xmlstock",
    "арсенкин"
  ];

  for (const phrase of requiredPhrases) {
    assert.ok(searchableCopy.includes(phrase), `Missing primary SEO phrase: ${phrase}`);
  }
});
