# CPU Evaluator

A local-only workbench for reviewing Computershare voice-intake conversations.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The app has no FastAPI service, Python environment, database, proxy, or second terminal. Workspace data is stored in the browser's local storage.

For LLM metric evaluation and failure tracing, set `OPENAI_API_KEY` in `.env.local` (see `.env.example`). The Next.js server routes read that value; it is not sent to the browser.

Create a Global prompt in **Prompts**, and optionally add Node prompts; in Assistant mode, create one Assistant prompt. Import the actual conversation CSV, select metrics, and analyze it directly. Every failed metric includes the failed conversation IDs, affected agent turns or conversation-level omission, evaluation rationale, matching policy excerpts, and a suggested prompt refinement.
