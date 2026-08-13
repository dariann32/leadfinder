// Ein einziges JSON-Array in Vercel Blob als Speicher fuer alle Leads
// (leads/all.json). Fuer den persoenlichen Gebrauch voellig ausreichend;
// bei gleichzeitigen Schreibzugriffen aus zwei Tabs koennen sich Aenderungen
// theoretisch ueberschreiben (last write wins) -- fuer den Solo-Einsatz kein
// praktisches Problem.

import { head, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

const LEADS_KEY = "leads/all.json";
const STATUSES = ["Neu", "Erreicht", "Interessiert", "Will Webseite", "Gewonnen", "Verloren"];

async function loadLeads() {
  try {
    const metadata = await head(LEADS_KEY);
    const resp = await fetch(metadata.url);
    return await resp.json();
  } catch {
    return [];
  }
}

async function saveLeads(leads) {
  await put(LEADS_KEY, JSON.stringify(leads), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(request) {
  if (request.method === "GET") {
    const leads = await loadLeads();
    return json(leads);
  }

  if (request.method === "POST") {
    // Import: nimmt ein Array von Lead-Objekten entgegen (z.B. Ergebnisse
    // des Lead-Finders oder ein geparster CSV-Import) und fuegt neue Leads
    // hinzu. Duplikate werden anhand der URL erkannt und uebersprungen.
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Ungueltiger Request-Body" }, 400);
    }

    const incoming = Array.isArray(body) ? body : body?.leads;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return json({ error: "Erwarte ein Array von Leads" }, 400);
    }

    const leads = await loadLeads();
    const existingUrls = new Set(leads.map((l) => l.url));
    let added = 0;

    for (const raw of incoming) {
      const url = (raw.url || "").trim();
      if (!url || existingUrls.has(url)) continue;
      existingUrls.add(url);
      leads.push({
        id: randomUUID(),
        url,
        firma: raw.firma || "",
        ort: raw.ort || "",
        branche: raw.branche || "",
        inhaber: raw.inhaber || "",
        email: raw.email || "",
        mobilTel: raw.mobilTel || "",
        impressumUrl: raw.impressumUrl || "",
        signale: raw.signale || "",
        status: "Neu",
        notiz: "",
        wiedervorlage: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      added += 1;
    }

    await saveLeads(leads);
    return json({ added, skipped: incoming.length - added, total: leads.length });
  }

  if (request.method === "PATCH") {
    // Einzelnes Lead aktualisieren (Status, Notiz, Wiedervorlage-Datum).
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Ungueltiger Request-Body" }, 400);
    }

    const { id, status, notiz, wiedervorlage } = body || {};
    if (!id) return json({ error: "id erforderlich" }, 400);
    if (status !== undefined && !STATUSES.includes(status)) {
      return json({ error: `status muss einer von: ${STATUSES.join(", ")}` }, 400);
    }

    const leads = await loadLeads();
    const lead = leads.find((l) => l.id === id);
    if (!lead) return json({ error: "Lead nicht gefunden" }, 404);

    if (status !== undefined) lead.status = status;
    if (notiz !== undefined) lead.notiz = notiz;
    if (wiedervorlage !== undefined) lead.wiedervorlage = wiedervorlage;
    lead.updatedAt = new Date().toISOString();

    await saveLeads(leads);
    return json(lead);
  }

  if (request.method === "DELETE") {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return json({ error: "id erforderlich" }, 400);

    const leads = await loadLeads();
    const filtered = leads.filter((l) => l.id !== id);
    if (filtered.length === leads.length) return json({ error: "Lead nicht gefunden" }, 404);

    await saveLeads(filtered);
    return json({ deleted: id });
  }

  return json({ error: "Method not allowed" }, 405);
}
