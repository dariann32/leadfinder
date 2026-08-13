// Kernlogik: Website auf veraltete Signale pruefen + Impressum-Kontaktdaten
// extrahieren. Plattformunabhaengig (kein Netlify- oder Vercel-spezifischer
// Code) -- laeuft unveraendert unter Node.js.

import * as cheerio from "cheerio";

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; LeadResearchBot/1.0)" };
const TIMEOUT_MS = 10_000;
const DELAY_MS = 1500; // Hoeflichkeitspause zwischen Requests -- nicht entfernen

const COPYRIGHT_YEAR_RE = /(?:©|copyright)\D{0,10}(\d{4})/gi;
const WORDPRESS_RE = /WordPress\s*4(?:\.\d+)*/i;

const EMAIL_RE = /[\w.\-+]+@[\w-]+\.[\w.-]+/;
// Deutsche Mobilnummern beginnen mit 015x/016x/017x (oder +49 15x/16x/17x)
const MOBILE_RE = /(?:\+49[\s\-/]?1|01)[5-7]\d[\d\s\-/]{5,20}/;
const PHONE_LABEL_RE = /(Mobil|Handy|Tel\.?|Telefon)\s*:?\s*([+\d][\d\s\-/()]{5,20})/i;
// Max. 2 Woerter (Vor- + Nachname), damit z.B. eine direkt folgende
// Strassenbezeichnung nicht faelschlich mit erfasst wird.
const OWNER_LABEL_RE =
  /(Inhaber(?:in)?|Geschäftsführer(?:in)?|Vertretungsberechtigte[r]?)\s*:?\s*([A-ZÄÖÜ][\wäöüß-]+(?:\s[A-ZÄÖÜ][\wäöüß-]+){0,1})/;

const IMPRESSUM_PATHS = ["/impressum", "/impressum/", "/impressum.html", "/kontakt", "/kontakt/"];

// Postleitzahl + Ort, z.B. "23552 Lübeck" -- gaengiges deutsches Adressformat.
// Bewusst nur ein Wort erfasst (robuster als mehrere), mehrteilige Ortsnamen
// wie "Bad Segeberg" werden dadurch nur teilweise erkannt -- in der Pipeline
// manuell korrigierbar.
const PLZ_ORT_RE = /\b\d{5}\s+([A-ZÄÖÜ][\wäöüß-]+)/;

// Grobe Branchenerkennung ueber Schluesselwoerter in URL + sichtbarem Text.
// Reihenfolge = Prioritaet bei mehreren Treffern.
const BRANCHEN = [
  { label: "Heizung", re: /heizung|sanit(ä|ae)r|klima/i },
  { label: "Elektro", re: /elektro|smart-?home|photovoltaik|\bpv\b/i },
  { label: "Maler", re: /\bmaler|putz|fassade/i },
  { label: "Fliesenleger", re: /fliesen/i },
  { label: "Tischler", re: /tischler|schreiner/i },
  { label: "Dachdecker", re: /dachdecker|zimmerei|dach\b/i },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: HEADERS, redirect: "follow", signal: controller.signal });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, url: resp.url, headers: resp.headers, text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function extractVisibleText(html) {
  const $ = cheerio.load(html);
  $("script, style").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

export function detectOldSignals(html, finalUrl) {
  const signals = [];
  if (finalUrl.startsWith("http://")) signals.push("kein HTTPS");
  if (WORDPRESS_RE.test(html)) signals.push("WordPress 4.x erkannt");

  const years = [...html.matchAll(COPYRIGHT_YEAR_RE)].map((m) => parseInt(m[1], 10));
  if (years.length) {
    const minYear = Math.min(...years);
    if (minYear < 2022) signals.push(`Copyright-Jahr ${minYear}`);
  }
  return signals;
}

// Einfache, abhaengigkeitsfreie Textaehnlichkeit (Jaccard ueber Wortmengen)
// als Ersatz fuer Pythons difflib.SequenceMatcher.
export function textSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}

export async function checkWayback(url) {
  const targetDate = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);
  const stamp = targetDate.toISOString().slice(0, 10).replace(/-/g, "");
  const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${stamp}`;

  const apiResp = await fetchWithTimeout(apiUrl);
  if (!apiResp || !apiResp.ok) return null;

  let data;
  try {
    data = JSON.parse(apiResp.text);
  } catch {
    return null;
  }
  const snapshot = data?.archived_snapshots?.closest;
  if (!snapshot?.available) return null;

  const snapResp = await fetchWithTimeout(snapshot.url);
  if (!snapResp) return null;

  return {
    snapshotDate: (snapshot.timestamp || "").slice(0, 8),
    snapshotText: extractVisibleText(snapResp.text),
  };
}

export function findImpressumUrl(baseUrl, html) {
  const $ = cheerio.load(html);
  let found = null;
  $("a[href]").each((_, el) => {
    if (found) return;
    const text = $(el).text().trim().toLowerCase();
    const href = ($(el).attr("href") || "").toLowerCase();
    if (text.includes("impressum") || href.includes("impressum")) {
      found = new URL($(el).attr("href"), baseUrl).toString();
    }
  });
  return found;
}

export function extractCompanyName(html) {
  const $ = cheerio.load(html);
  let title = $("title").first().text().trim();
  // Haeufige Trenner/Suffixe abschneiden ("Firma XY - Startseite" etc.)
  title = title.split(/[|\-–—]/)[0].trim();
  if (title) return title;
  return $("h1").first().text().trim();
}

export function extractCity(text) {
  const match = PLZ_ORT_RE.exec(text);
  return match ? match[1].trim() : "";
}

export function detectBranche(url, text) {
  const haystack = `${url} ${text}`;
  for (const { label, re } of BRANCHEN) {
    if (re.test(haystack)) return label;
  }
  return "";
}

export function extractContactInfo(text) {
  const info = { inhaber: "", email: "", mobil: "" };

  const ownerMatch = OWNER_LABEL_RE.exec(text);
  if (ownerMatch) info.inhaber = ownerMatch[2].trim();

  const emailMatch = EMAIL_RE.exec(text);
  if (emailMatch) info.email = emailMatch[0];

  const mobileMatch = MOBILE_RE.exec(text);
  if (mobileMatch) {
    info.mobil = mobileMatch[0].trim();
  } else {
    const labelMatch = PHONE_LABEL_RE.exec(text);
    if (labelMatch) info.mobil = labelMatch[2].trim();
  }

  return info;
}

async function getImpressumContact(baseUrl, homepageHtml) {
  const found = findImpressumUrl(baseUrl, homepageHtml);
  const candidates = [];
  if (found) candidates.push(found);
  for (const path of IMPRESSUM_PATHS) {
    const candidate = new URL(path, baseUrl).toString();
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }

  for (const url of candidates) {
    const resp = await fetchWithTimeout(url);
    await sleep(DELAY_MS);
    if (resp && resp.status === 200) {
      const text = extractVisibleText(resp.text);
      const info = extractContactInfo(text);
      if (info.email || info.mobil || info.inhaber) {
        return { ...info, impressumUrl: url, ort: extractCity(text) };
      }
    }
  }
  return { inhaber: "", email: "", mobil: "", impressumUrl: "", ort: "" };
}

// Prueft eine einzelne URL komplett und liefert entweder ein Ergebnis-Objekt
// (Hot Lead) oder null (kein Treffer).
export async function processUrl(url) {
  const resp = await fetchWithTimeout(url);
  if (!resp || !resp.ok) return null;

  const html = resp.text;
  const signals = detectOldSignals(html, resp.url);
  const lastModified = resp.headers.get("last-modified") || "";

  let isOldLastMod = false;
  if (lastModified) {
    const lmDate = new Date(lastModified);
    if (!isNaN(lmDate) && lmDate < new Date(Date.now() - 730 * 24 * 60 * 60 * 1000)) {
      isOldLastMod = true;
      signals.push(`Last-Modified: ${lastModified}`);
    }
  }

  let waybackNote = "";
  const currentText = extractVisibleText(html);
  const wayback = await checkWayback(resp.url);
  if (wayback) {
    const similarity = textSimilarity(currentText, wayback.snapshotText);
    if (similarity > 0.85) {
      waybackNote = `~${Math.round(similarity * 100)}% identisch seit ${wayback.snapshotDate}`;
      signals.push("Seite kaum veraendert (Wayback)");
    }
  }

  if (signals.length === 0 && !isOldLastMod) return null; // kein Hot Lead

  const contact = await getImpressumContact(resp.url, html);
  const branche = detectBranche(resp.url, currentText);

  return {
    url,
    firma: extractCompanyName(html),
    ort: contact.ort,
    branche,
    signale: signals.join("; "),
    lastModified,
    wayback: waybackNote,
    inhaber: contact.inhaber,
    email: contact.email,
    mobilTel: contact.mobil,
    impressumUrl: contact.impressumUrl,
  };
}

export { DELAY_MS };
