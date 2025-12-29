# Eval Harness

A lightweight CLI that replays the knowledge-base evaluation suite prompts against any OpenAI-compatible chat-completions endpoint. It collects responses, highlights potential failures (based on heuristic keyword checks), and stores a JSON transcript you can review during presentations.

## Installation

From the repo root:

```sh
cd packages/eval-harness
npm install
```

## Running evaluations

With the repo-level `.env` configured, you can simply run:

```sh
npm start
```

The start script loads `../../.env` (or `.env.local`) and forwards any LLM/Kb settings to the harness automatically. Extra CLI flags are still honored, e.g. `npm start -- --dry-run`.

If you prefer to call the CLI directly:

```sh
npm run eval -- \
  --endpoint http://localhost:1234/v1/chat/completions \
  --model "gpt-4.1-mini"
```

### Useful flags

- `--suite <path>`: Path to the eval suite JSON. Defaults to `../knowledge-base/eval-suite.json`.
- `--output <dir>`: Directory for JSON results. Defaults to `./results`.
- `--model <name>`: Model identifier passed to the chat endpoint.
- `--endpoint <url>`: Chat-completions URL. Falls back to `EVAL_LLM_ENDPOINT`, then `LLM_ENDPOINT`.
- `--kb-url <url>`: Optional base URL of the running knowledge-base service (e.g., `http://localhost:3005`). When supplied, the harness fetches `/documents` before falling back to `kb-data.json`.
- `--schema <path>`: When running in KB mode, schema JSON to forward in `/query` requests. Defaults to `../tablet-device/schema.json`.
- `--api-key <key>`: Adds `Authorization: Bearer <key>` to requests (useful for OpenRouter or OpenAI).
- `--provider <name>`: Optional hint for logging (`openrouter`, `openai`, `local`).
- `--mode <chat|kb>`: `chat` (default) calls the LLM endpoint directly. `kb` POSTs each scenario to the knowledge-base `/query` API to exercise the full pipeline.
- `--dry-run`: Skip LLM calls and just print the prompts that would be sent.

### KB (full-pipeline) mode

```sh
npm start -- \
  --mode kb \
  --kb-url http://localhost:3005
```

In this mode, each scenario is POSTed to `KB_URL/query` with the output schema attached. The KB performs retrieval + LLM calls, and the harness captures the returned UI JSON, flags heuristics, and records latency. Use this when you want metrics that reflect the entire device-selection stack rather than the raw model alone.

### Environment variables

- `EVAL_LLM_ENDPOINT` or `LLM_ENDPOINT`
- `EVAL_LLM_MODEL` or `LLM_MODEL`
- `EVAL_API_KEY`, `OPENROUTER_API_KEY`, or `OPENAI_API_KEY`
- `EVAL_KB_URL` to point at a live knowledge-base instance
- `EVAL_MODE` to default the harness to `chat` or `kb`

Environment values are used as fallbacks when flags are omitted.

## Output

Each execution writes a timestamped JSON file (e.g., `results/run-2025-12-09T18-30-00Z.json`) containing:

- scenario metadata (id, name, tags, prompt)
- the prompt payload sent to the LLM
- raw API response
- extracted answer text
- heuristic flags (e.g., failure signals detected)
- latency measurements
- overall summary (successes/warnings/errors + average latency)

