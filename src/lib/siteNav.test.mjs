import { test } from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_SITE_NAV, normaliseSiteNav, flattenNav, currentHref, accountAction, loadSiteNav } from "./siteNav.js";

const isItem = (v) => typeof v.href === "string" && v.href.startsWith("/") && typeof v.label === "string" && v.label.length > 0;

test("the fallback is a complete nav: home, links with groups, and the three actions", () => {
  assert.ok(isItem(FALLBACK_SITE_NAV.home));
  assert.ok(FALLBACK_SITE_NAV.links.length >= 5);
  for (const entry of FALLBACK_SITE_NAV.links) {
    if (Array.isArray(entry.items)) {
      assert.ok(entry.label && entry.items.length > 0 && entry.items.every(isItem), entry.label);
    } else {
      assert.ok(isItem(entry), entry.label);
    }
  }
  const labels = flattenNav(FALLBACK_SITE_NAV).map((i) => i.label);
  assert.ok(labels.includes("Sofa to Singletrack") && labels.includes("Games") && labels.includes("Results"));
  assert.equal(FALLBACK_SITE_NAV.actions.enter.href, "/account/upcoming");
  assert.equal(FALLBACK_SITE_NAV.actions.signIn.href, "/account/login");
  assert.equal(FALLBACK_SITE_NAV.actions.account.href, "/account");
  assert.equal(FALLBACK_SITE_NAV.actions.signOut, null);
  assert.ok(!JSON.stringify(FALLBACK_SITE_NAV).includes("Rider Login"));
});

test("normalising keeps a well-formed answer as it is (home, groups, flat links, actions)", () => {
  const json = JSON.parse(JSON.stringify(FALLBACK_SITE_NAV));
  const nav = normaliseSiteNav(json);
  assert.deepEqual(nav, FALLBACK_SITE_NAV);
});

test("normalising drops malformed entries and fills missing pieces from the fallback", () => {
  const nav = normaliseSiteNav({
    links: [
      { href: "/results", label: "  Results " },
      { href: "https://elsewhere.example/x", label: "Off-site" },
      { href: "//evil.example", label: "Protocol-relative" },
      { href: "/no-label" },
      { label: "Events", items: [{ href: "/league", label: "League" }, { href: "javascript:alert(1)", label: "Bad" }, null] },
      { label: "Empty group", items: [{ label: "no href" }] },
      "junk",
      null,
    ],
    actions: { enter: { href: "/account/upcoming", label: "Enter a race" }, signIn: { href: "http://x/", label: "Nope" } },
  });
  assert.deepEqual(nav.links, [
    { href: "/results", label: "Results" },
    { label: "Events", items: [{ href: "/league", label: "League" }] },
  ]);
  assert.deepEqual(nav.home, FALLBACK_SITE_NAV.home, "no home given: the fallback's");
  assert.deepEqual(nav.actions.enter, { href: "/account/upcoming", label: "Enter a race" });
  assert.deepEqual(nav.actions.signIn, FALLBACK_SITE_NAV.actions.signIn, "an off-site sign-in link is refused");
  assert.deepEqual(nav.actions.account, FALLBACK_SITE_NAV.actions.account);
  assert.equal(nav.actions.signOut, null);
});

test("normalising refuses answers with nothing usable", () => {
  assert.equal(normaliseSiteNav(null), null);
  assert.equal(normaliseSiteNav("nav"), null);
  assert.equal(normaliseSiteNav({}), null);
  assert.equal(normaliseSiteNav({ links: [] }), null);
  assert.equal(normaliseSiteNav({ links: [{ href: "mailto:a@b.c", label: "x" }] }), null);
  assert.equal(normaliseSiteNav({ links: "not a list" }), null);
});

test("the current link is the longest matching path, ignoring index.html, queries and hashes", () => {
  const nav = FALLBACK_SITE_NAV;
  assert.equal(currentHref(nav, "/programme/index.html"), "/programme");
  assert.equal(currentHref(nav, "/programme/"), "/programme");
  assert.equal(currentHref(nav, "/programme/games/index.html"), "/programme/games", "Games, not Sofa to Singletrack");
  assert.equal(currentHref(nav, "/programme/games"), "/programme/games");
  assert.equal(currentHref(nav, "/league/rules?x=1#top"), "/league/rules");
  assert.equal(currentHref(nav, "/league"), "/league", "the plain link, not the #prices one");
  assert.equal(currentHref(nav, "/league/start-list/2027/3"), "/league/start-list");
  assert.equal(currentHref(nav, "/"), "/", "home only matches the root");
  assert.equal(currentHref(nav, "/index.html"), "/");
  assert.equal(currentHref(nav, "/somewhere-else"), null);
  assert.equal(currentHref(nav, "/somewhere-else", "/programme"), "/programme", "the default when nothing matches");
  assert.equal(currentHref(nav, "/programmes"), null, "a prefix of letters is not a parent path");
  assert.equal(currentHref(nav, undefined, "/programme"), "/programme");
});

test("the account action is Sign in (with a return address) or My Account", () => {
  const nav = FALLBACK_SITE_NAV;
  assert.deepEqual(accountAction(nav, null, "/programme"), { label: "Sign in", href: "/account/login?next=%2Fprogramme" });
  assert.deepEqual(accountAction(nav, { signedIn: false }, null), { label: "Sign in", href: "/account/login" });
  assert.deepEqual(accountAction(nav, { signedIn: true }, "/programme"), { label: "My Account", href: "/account" });
  const withQuery = { ...nav, actions: { ...nav.actions, signIn: { label: "Sign in", href: "/account/login?a=1" } } };
  assert.equal(accountAction(withQuery, null, "/programme/games").href, "/account/login?a=1&next=%2Fprogramme%2Fgames");
});

test("loading uses the answer when it is good, and the fallback when it is slow, failing or odd", async () => {
  const good = { home: { href: "/", label: "Home" }, links: [{ href: "/results", label: "Results" }], actions: {} };
  const okFetch = async () => ({ ok: true, json: async () => good });
  const loaded = await loadSiteNav(okFetch);
  assert.deepEqual(loaded.links, good.links);
  assert.deepEqual(loaded.actions.enter, FALLBACK_SITE_NAV.actions.enter, "missing actions come from the fallback");

  assert.equal(await loadSiteNav(async () => ({ ok: false, status: 503 })), FALLBACK_SITE_NAV);
  assert.equal(await loadSiteNav(async () => { throw new Error("offline"); }), FALLBACK_SITE_NAV);
  assert.equal(await loadSiteNav(async () => ({ ok: true, json: async () => ({ links: [] }) })), FALLBACK_SITE_NAV);
  assert.equal(await loadSiteNav(async () => ({ ok: true, json: async () => { throw new Error("not json"); } })), FALLBACK_SITE_NAV);

  const never = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const started = Date.now();
  assert.equal(await loadSiteNav(never, { timeoutMs: 30 }), FALLBACK_SITE_NAV, "a slow answer gives the fallback");
  assert.ok(Date.now() - started < 1000);
});
