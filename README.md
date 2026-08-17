# CPU Evaluator

A local-only workbench for reviewing Computershare voice-intake conversations.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The app has no FastAPI service, Python environment, database, proxy, or second terminal. Workspace data is stored in the browser's local storage.

For prompt-driven ideal generation and LLM metrics, set `OPENAI_API_KEY` in `.env.local` (see `.env.example`). The Next.js server routes read that value; it is not sent to the browser.

First create a Global prompt in **Prompts**, and optionally add a Node prompt. Select their versions in the Evaluation Workspace before importing the CSV. The app generates one ideal action and ideal agent reply/tool event for every caller turn using those prompt sources. You can edit generated rows or import an ideal-behavior CSV; regeneration retains those manual overrides.
