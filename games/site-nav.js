/* The MTB East site header for the pages that aren't Next.js pages: the Sofa to Singletrack app (src/App.jsx, which
   imports this through src/lib/siteNav.js) and the games hub (games/index.html, which loads it as a module script).
   The website's security policy allows same-origin scripts only -- no inline scripts -- so this must stay a separate
   file. It is a plain ES module with no imports so a browser can load it as-is.

   What it does: asks the website for GET /api/site-nav (3 s limit), checks the shape, and draws the header from it.
   When that fails it draws FALLBACK_SITE_NAV instead. FALLBACK_SITE_NAV is a fallback copy of src/lib/site-nav.ts
   (SITE_NAV) in the MTB East Website repo: keep it matching, but the fetched list wins whenever the site answers, so a
   stale copy only shows when the site can't be reached. The pure parts are tested in src/lib/siteNav.test.mjs.

   Markup: desktop = top-level links with <details> dropdown groups (tap/click to open, keyboard works without any
   script); below the site's xl breakpoint = logo, "Enter a race" and a hamburger <details> whose panel lists every link
   under group headings, as the website's MobileNav does. The right-hand action is "Sign in" or "My Account" depending on
   /api/programme/me. Styles: games/site-nav.css (imported by the app too). */

export const FALLBACK_SITE_NAV = Object.freeze({
  home: { href: "/", label: "Home" },
  links: [
    {
      label: "Events",
      items: [
        { href: "/league", label: "League" },
        { href: "/league/rules", label: "Rules" },
        { href: "/league#prices", label: "Prices" },
        { href: "/league/start-list", label: "Riders entered" },
        { href: "/festival", label: "Festival" },
        { href: "/sportive", label: "Sportive" },
        { href: "/regional-champs", label: "Regional Champs" },
      ],
    },
    { href: "/results", label: "Results" },
    { href: "/news", label: "News" },
    {
      label: "Get Involved",
      items: [
        { href: "/coaching", label: "Coaching" },
        { href: "/programme", label: "Sofa to Singletrack" },
        { href: "/programme/games", label: "Games" },
        { href: "/volunteering", label: "Volunteers" },
        { href: "/partners", label: "Partners" },
        { href: "/academy", label: "Academy" },
      ],
    },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact & FAQs" },
  ],
  actions: {
    enter: { label: "Enter a race", href: "/account/upcoming" },
    signIn: { label: "Sign in", href: "/account/login" },
    account: { label: "My Account", href: "/account" },
    signOut: null,
  },
});

// ---- Pure parts (no browser needed) -------------------------------------------------------------------------------

function cleanText(value, max = 60) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length ? t.slice(0, max) : null;
}

/** Only a path on this site: starts with one "/", no scheme, no protocol-relative "//", nothing odd. */
function cleanHref(value) {
  if (typeof value !== "string") return null;
  const h = value.trim();
  if (!h || h.length > 200 || !h.startsWith("/") || h.startsWith("//") || h.includes("\\") || /\s/.test(h)) return null;
  return h;
}

function cleanItem(value) {
  if (!value || typeof value !== "object") return null;
  const href = cleanHref(value.href);
  const label = cleanText(value.label);
  return href && label ? { href, label } : null;
}

/** Turns whatever /api/site-nav answered into a nav the renderer trusts, dropping anything malformed. Returns null when
 * there are no usable links at all (the caller then uses the fallback); a missing home or action falls back one by one. */
export function normaliseSiteNav(json, fallback = FALLBACK_SITE_NAV) {
  if (!json || typeof json !== "object" || !Array.isArray(json.links)) return null;
  const links = [];
  for (const entry of json.links) {
    if (!entry || typeof entry !== "object") continue;
    if (Array.isArray(entry.items)) {
      const label = cleanText(entry.label);
      const items = entry.items.map(cleanItem).filter(Boolean);
      if (label && items.length) links.push({ label, items });
    } else {
      const item = cleanItem(entry);
      if (item) links.push(item);
    }
  }
  if (!links.length) return null;
  const actions = json.actions && typeof json.actions === "object" ? json.actions : {};
  return {
    home: cleanItem(json.home) || fallback.home,
    links,
    actions: {
      enter: cleanItem(actions.enter) || fallback.actions.enter,
      signIn: cleanItem(actions.signIn) || fallback.actions.signIn,
      account: cleanItem(actions.account) || fallback.actions.account,
      signOut: null,
    },
  };
}

/** Every link in order: home, then each top-level link or each item of a group. */
export function flattenNav(nav) {
  const out = [nav.home];
  for (const entry of nav.links) {
    if (Array.isArray(entry.items)) out.push(...entry.items);
    else out.push(entry);
  }
  return out;
}

/** "/programme/index.html?x#y" -> "/programme"; "/league#prices" -> "/league"; "/" stays "/". */
function pathOf(href) {
  let p = String(href).split(/[?#]/)[0];
  if (p.endsWith("/index.html")) p = p.slice(0, -"/index.html".length);
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

/** Which link is the page we're on: the longest link path that equals the page path or is one of its parents, so
 * /programme/games/index.html is "Games" and not "Sofa to Singletrack". Returns the link's own href as written (so it
 * can be compared with the rendered links), or defaultHref when nothing matches (local dev at "/", say). */
export function currentHref(nav, pathname, defaultHref = null) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return defaultHref;
  const path = pathOf(pathname);
  let best = null;
  let bestLength = -1;
  for (const item of flattenNav(nav)) {
    const p = pathOf(item.href);
    const hit = p === "/" ? path === "/" : path === p || path.startsWith(p + "/");
    if (hit && p.length > bestLength) {
      best = item.href;
      bestLength = p.length;
    }
  }
  return best === null ? defaultHref : best;
}

/** The right-hand button: "My Account" when signed in, otherwise "Sign in" carrying a return address (?next=) so the
 * website brings the visitor back here afterwards. */
export function accountAction(nav, account, returnTo = null) {
  if (account && account.signedIn) return nav.actions.account;
  const signIn = nav.actions.signIn;
  if (!returnTo) return signIn;
  const joiner = signIn.href.includes("?") ? "&" : "?";
  return { label: signIn.label, href: `${signIn.href}${joiner}next=${encodeURIComponent(returnTo)}` };
}

/** Fetches /api/site-nav with a time limit; any failure (offline, slow, 5xx, odd shape) gives the fallback. */
export async function loadSiteNav(fetchImpl, { url = "/api/site-nav", timeoutMs = 3000, fallback = FALLBACK_SITE_NAV } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => { if (controller) controller.abort(); }, timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller ? controller.signal : undefined, credentials: "omit" });
    if (!res || !res.ok) return fallback;
    return normaliseSiteNav(await res.json(), fallback) || fallback;
  } catch (e) {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Drawing the header (browser only) ----------------------------------------------------------------------------

function h(doc, tag, attrs = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

function link(doc, item, current, extraClass = "") {
  const isCurrent = current !== null && item.href === current;
  return h(doc, "a", {
    href: item.href,
    class: [extraClass, isCurrent ? "current" : ""].filter(Boolean).join(" ") || null,
    "aria-current": isCurrent ? "page" : null,
    text: item.label,
  });
}

function groupHasCurrent(group, current) {
  return current !== null && group.items.some((item) => item.href === current);
}

/** Draws the whole header into `root` (an empty <header id="mtbe-site-nav">, or the static one in games/index.html).
 * `current` is the href to mark as the page we're on (see currentHref); `account` is { signedIn } or null (unknown =
 * signed out until /api/programme/me says otherwise); `returnTo` is where "Sign in" should bring the visitor back to. */
export function renderSiteNav(root, nav, { current = null, account = null, returnTo = null, logoSrc = "/brand/logo-on-black.png" } = {}) {
  if (!root) return;
  const doc = root.ownerDocument;
  const action = accountAction(nav, account, returnTo);
  const accountLink = (extraClass) => h(doc, "a", { href: action.href, class: `btn-account ${extraClass}`.trim(), "data-account-link": "", text: action.label });

  const desktop = h(doc, "nav", { class: "links", "aria-label": "Primary" }, [
    link(doc, nav.home, current, "home-btn"),
    ...nav.links.map((entry) =>
      Array.isArray(entry.items)
        ? h(doc, "details", { class: "group" }, [
            h(doc, "summary", { class: groupHasCurrent(entry, current) ? "current" : null, text: entry.label }),
            h(doc, "div", { class: "dropdown" }, [h(doc, "div", {}, entry.items.map((item) => link(doc, item, current)))]),
          ])
        : link(doc, entry, current),
    ),
  ]);

  const panelItems = [nav.home, ...nav.links].map((entry) =>
    Array.isArray(entry.items)
      ? h(doc, "li", { class: "group-block" }, [
          h(doc, "p", { class: "heading", text: entry.label }),
          h(doc, "ul", {}, entry.items.map((item) => h(doc, "li", {}, [link(doc, item, current)]))),
        ])
      : h(doc, "li", {}, [link(doc, entry, current)]),
  );

  const menu = h(doc, "details", { class: "menu" }, [
    h(doc, "summary", { "aria-label": "Menu" }, [h(doc, "span", { class: "bars", "aria-hidden": "true" }, [h(doc, "i"), h(doc, "i"), h(doc, "i")])]),
    h(doc, "div", { class: "panel" }, [
      h(doc, "nav", { "aria-label": "Primary mobile" }, [h(doc, "ul", {}, panelItems), accountLink("panel-account")]),
    ]),
  ]);

  const inner = h(doc, "div", { class: "inner" }, [
    h(doc, "a", { class: "home", href: nav.home.href }, [h(doc, "img", { src: logoSrc, alt: "MTB east — home" })]),
    desktop,
    h(doc, "div", { class: "actions" }, [
      h(doc, "a", { href: nav.actions.enter.href, class: "btn-enter", text: nav.actions.enter.label }),
      accountLink(""),
      menu,
    ]),
  ]);

  root.replaceChildren(inner);
}

/** Swaps "Sign in" for "My Account" (or back) once /api/programme/me has answered, without redrawing the header (which
 * would shut a menu the visitor has just opened). */
export function updateSiteNavAccount(root, nav, account, returnTo = null) {
  if (!root) return;
  const action = accountAction(nav, account, returnTo);
  root.querySelectorAll("[data-account-link]").forEach((a) => {
    a.setAttribute("href", action.href);
    a.textContent = action.label;
  });
}

/** Behaviour on top of what <details> gives for free: one dropdown open at a time, close on a tap outside, on Escape
 * (focus back on the group's own button) and after a link is chosen. Listens on `root` and the document, so the header
 * can be redrawn underneath it. Returns a function that removes the listeners. */
export function wireSiteNav(root) {
  if (!root || root.dataset.navWired) return () => {};
  const doc = root.ownerDocument;
  root.dataset.navWired = "1";

  const closeAll = (except) => {
    root.querySelectorAll("details[open]").forEach((d) => {
      if (d === except) return;
      const hadFocus = d.contains(doc.activeElement);
      d.open = false;
      if (hadFocus) {
        const summary = d.querySelector("summary");
        if (summary) summary.focus();
      }
    });
  };
  // "toggle" doesn't bubble, so listen in the capture phase.
  const onToggle = (e) => { if (e.target && e.target.open) closeAll(e.target); };
  const onClick = (e) => { if (e.target && e.target.closest && e.target.closest("a[href]")) closeAll(); };
  const onPointerDown = (e) => { if (!root.contains(e.target)) closeAll(); };
  const onKey = (e) => { if (e.key === "Escape") closeAll(); };

  root.addEventListener("toggle", onToggle, true);
  root.addEventListener("click", onClick);
  doc.addEventListener("pointerdown", onPointerDown);
  doc.addEventListener("keydown", onKey);
  return () => {
    root.removeEventListener("toggle", onToggle, true);
    root.removeEventListener("click", onClick);
    doc.removeEventListener("pointerdown", onPointerDown);
    doc.removeEventListener("keydown", onKey);
    delete root.dataset.navWired;
  };
}

/** The static pages (games/index.html): the markup already in the HTML works without any script; this upgrades it to
 * the live list and the real signed-in state. `data-current` names the link to mark when the address doesn't match
 * anything, `data-return-to` is where "Sign in" comes back to. */
export async function bootStaticSiteNav(root, { defaultHref = null, returnTo = null, meUrl = "/api/programme/me" } = {}) {
  wireSiteNav(root);
  const nav = await loadSiteNav((url, options) => fetch(url, options));
  const current = currentHref(nav, root.ownerDocument.location.pathname, defaultHref);
  renderSiteNav(root, nav, { current, account: null, returnTo });
  try {
    const res = await fetch(meUrl, { credentials: "same-origin" });
    const json = res.ok ? await res.json() : null;
    updateSiteNavAccount(root, nav, { signedIn: Boolean(json && json.signedIn) }, returnTo);
  } catch (e) {
    /* offline or not answering: stays "Sign in" */
  }
}

if (typeof document !== "undefined") {
  const root = document.getElementById("mtbe-site-nav");
  if (root && root.hasAttribute("data-static-nav")) {
    bootStaticSiteNav(root, { defaultHref: root.getAttribute("data-current"), returnTo: root.getAttribute("data-return-to") });
  }
}
