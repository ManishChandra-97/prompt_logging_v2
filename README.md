# CPU Evaluator

A local-only workbench for reviewing Computershare voice-intake conversations.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The app has no FastAPI service, Python environment, database, proxy, or second terminal. Workspace data is stored in the browser's local storage.

For LLM metrics, set `OPENAI_API_KEY` in `.env.local` (see `.env.example`). The Next.js judge route reads that server-side value; it is not sent to the browser.

After importing a CSV, choose the ideal next action for each caller input and edit the ideal agent reply/tool event as needed. Analysis uses those choices as the reference behavior. Suggestions follow the empty-field order: shareholder status → relationship (only for non-shareholders) → company → intent → summary. They also handle one shareholder-status retry, multi-company/multi-intent disambiguation, and the three-attempt company-resolution fallback.
