// Vercel Function (Web-Handler-Format: Request rein, Response raus).
// Antwortet sofort mit 202 und verarbeitet die URLs danach im Hintergrund
// weiter (waitUntil, moeglich dank Fluid Compute). Die Gesamtlaufzeit ist
// weiterhin durch maxDuration begrenzt (siehe vercel.json + README), daher
// eher fuer kleinere/mittlere Listen gedacht.

import { waitUntil } from "@vercel/functions";
import { put } from "@vercel/blob";
import { processUrl, DELAY_MS } from "../lib/scraper.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveState(jobId, state) {
  await put(`jobs/${jobId}.json`, JSON.stringify(state), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function runJob(jobId, urls, state) {
  for (const url of urls) {
    try {
      const result = await processUrl(url.trim());
      if (result) state.results.push(result);
    } catch (err) {
      state.results.push({ url, error: String(err?.message || err) });
    }
    state.checked += 1;
    await saveState(jobId, state);
    await sleep(DELAY_MS);
  }
  state.status = "done";
  state.finishedAt = new Date().toISOString();
  await saveState(jobId, state);
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  let jobId, urls;
  try {
    ({ jobId, urls } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: "Ungueltiger Request-Body" }), { status: 400 });
  }

  if (!jobId || !Array.isArray(urls) || urls.length === 0) {
    return new Response(JSON.stringify({ error: "jobId und urls erforderlich" }), { status: 400 });
  }

  const state = {
    status: "running",
    total: urls.length,
    checked: 0,
    results: [],
    startedAt: new Date().toISOString(),
  };

  try {
    await saveState(jobId, state);
  } catch (err) {
    // Haeufigste Ursache: kein Blob Store mit dem Projekt verbunden, oder
    // Deploy fand vor dem Verbinden statt (fehlendes Token). Siehe README.
    return new Response(
      JSON.stringify({ error: "Speichern in Vercel Blob fehlgeschlagen. Ist ein Blob Store mit dem Projekt verbunden? Siehe README.", details: String(err?.message || err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  waitUntil(runJob(jobId, urls, state));

  return new Response(JSON.stringify({ jobId }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}
