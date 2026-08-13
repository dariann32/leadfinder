import { head } from "@vercel/blob";

export default async function handler(request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) {
    return new Response(JSON.stringify({ error: "jobId fehlt" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const metadata = await head(`jobs/${jobId}.json`);
    const resp = await fetch(metadata.url);
    const state = await resp.json();
    return new Response(JSON.stringify(state), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Job nicht gefunden (noch nicht gestartet oder abgelaufen)" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
}
