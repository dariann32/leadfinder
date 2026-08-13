# Lead-Finder + Pipeline (Vercel-Version)

Zwei Seiten:

- **`/` (`public/index.html`)** — Lead-Finder: URLs prüfen, Hot Leads finden.
- **`/pipeline.html`** — CRM: gefundene Leads verwalten, Status-Pipeline,
  Notizen, Wiedervorlage-Termine. Erreichbar über den "Pipeline →"-Link auf
  der Startseite oder direkt.

## Bausteine

- **Frontend:** `public/index.html`, `public/pipeline.html`
- **Lead-Finder-Job:** `api/check.mjs` — antwortet sofort (202) und
  verarbeitet die URLs danach per `waitUntil()` im Hintergrund weiter
- **Fortschritt/Ergebnisse:** `api/status.mjs`
- **CRM:** `api/leads.mjs` — GET (Liste), POST (Import/Anlegen), PATCH
  (Status/Notiz/Wiedervorlage aktualisieren), DELETE
- **Speicherung:** [Vercel Blob](https://vercel.com/docs/vercel-blob) — ein
  JSON-Objekt pro Lead-Finder-Job (`jobs/<jobId>.json`) und ein JSON-Array
  für alle Pipeline-Leads (`leads/all.json`)

## Wichtiger Unterschied zur Netlify-Version

Vercel-Functions laufen (Stand 2026, mit aktiviertem Fluid Compute)
standardmäßig bis zu **5 Minuten (300 Sekunden)** pro Aufruf — das ist in
`vercel.json` bereits gesetzt. Bei ca. 5–10 Sekunden pro URL passen dort
**grob 20–30 URLs pro Lauf** hinein. Für längere Listen die URLs auf
mehrere Durchläufe aufteilen. Bereits geprüfte Treffer bleiben dabei
erhalten, nur der Lauf selbst stoppt.

## Deployment / Update in dein bestehendes Repo

1. Alle Dateien aus diesem Paket in dein Repo kopieren (überschreibt
   `public/index.html`, `api/`, `lib/`, `vercel.json`, `package.json`,
   ergänzt `public/pipeline.html` und `api/leads.mjs`). Zu GitHub pushen.
2. Vercel deployt automatisch bei jedem Push (falls das Projekt bereits
   verbunden ist, wie bei dir).
3. **Blob Store muss existieren und verbunden sein** (Dashboard → Storage →
   Create Database → Blob → mit dem Projekt verbinden). Danach einmal
   "Redeploy" klicken, damit die Umgebungsvariable im laufenden Deployment
   ankommt.
4. **Fluid Compute prüfen:** Settings → Functions → aktiviert?

## Fehlersuche, wenn "es nicht funktioniert"

Die häufigsten Ursachen, in dieser Reihenfolge prüfen:

1. **Kein Blob Store verbunden.** Symptom: Klick auf "Prüfung starten"
   liefert sofort einen Fehler, oder `/pipeline.html` zeigt dauerhaft eine
   leere Liste, obwohl importiert wurde. `api/check.mjs` gibt jetzt bei
   diesem Fehler eine klare Meldung zurück ("Speichern in Vercel Blob
   fehlgeschlagen…") statt eines generischen 500ers — im Browser die
   Konsole (F12 → Network/Console) prüfen, ob genau diese Meldung erscheint.
2. **Redeploy nach dem Verbinden des Blob Stores vergessen.** Die
   Umgebungsvariable wird erst im nächsten Deployment wirksam.
3. **Fluid Compute nicht aktiv.** Dann bricht die Hintergrundverarbeitung
   nach der Standard-Zeit ab, bevor auch nur eine URL geprüft wurde.
4. **Genaue Fehlermeldung fehlt noch?** Vercel-Dashboard → Projekt → Tab
   "Logs" (oder "Functions" → jeweilige Function) zeigt die echte
   Fehlermeldung aus der laufenden Function — meistens eindeutig.

## Lokal testen (optional)

```bash
npm install -g vercel
npm install
vercel dev
```

## Grenzen

- Siehe Hinweis oben zur 5-Minuten-Grenze pro Lauf.
- Die Kontakt-/Firmen-/Orts-/Branchenerkennung ist eine Heuristik (Regex +
  Keyword-Matching) — Ergebnisse vor der Nutzung stichprobenartig prüfen
  und in der Pipeline bei Bedarf manuell korrigieren.
- `leads/all.json` ist ein einzelnes JSON-Array. Bei gleichzeitigen
  Änderungen aus zwei geöffneten Tabs kann die zuletzt gespeicherte
  Version die andere überschreiben (last write wins) — für den
  Solo-Einsatz in der Praxis kein Problem.

