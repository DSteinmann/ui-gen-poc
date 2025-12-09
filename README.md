# Integrated Masters Project (IMP)

Intelligent Modular Panel (IMP) is an end-to-end playground for auto-generating UIs for IoT “Things”. A core service discovers devices, Thing Descriptions, and auxiliary capabilities, then asks a requirements-aware LLM to craft schema-conformant interfaces that downstream devices render in real time.

## Key capabilities
- **Multi-Thing orchestration** – a single device can receive controls for every registered Thing (light switch, TractorBot, etc.) because the core aggregates their action catalogs and the KB instructs the LLM to tag controls with `thingId`.
- **Guardrailed LLM prompts** – the knowledge base injects strict instructions (“only these action ids”), enforces JSON schema responses, and retries when the model ignores tool calls.
- **Action registry + WoT parsing** – Thing Descriptions feed directly into the action registry, normalizing transport metadata so devices can invoke actions without hard-coded URLs.
- **Capability-driven tooling** – external services (e.g., user activity detection) register as “capabilities” that the LLM can call via JSON Tool APIs during UI generation.
- **Real-time delivery** – Devices maintain WebSocket connections to the core; whenever the KB returns a UI, the core broadcasts it immediately and caches the latest payload per device.

## Architecture

The stack now consists of cooperating Node services plus web/device front-ends:

1. **Core System + Registry (`packages/core-system`)** – hosts the service/device registry, ingests Thing Descriptions, maintains the action registry, selects target devices, and orchestrates every UI-generation request against the knowledge base.
2. **Knowledge Base (`packages/knowledge-base`)** – lightweight RAG service that scores requirement documents, injects guardrails/tool metadata, and calls the configured LLM (OpenRouter or local endpoint) for both device selection and UI generation.
3. **Capability providers** – optional services (e.g., `packages/activity-recognition`) that expose telemetry. The core summarizes them for the LLM and exposes JSON “tool” descriptors so the model can fetch live data.
4. **Things service (`packages/things`)** – simulates multiple WoT Things (living room light switch, TractorBot Spock). Each Thing registers with the core so its actions are discoverable.
5. **Devices** –
   - `packages/device`: smartphone-style controller application plus its device API (`device/src/api.js`).
   - `packages/tablet-device`: large-format tablet/laptop dashboard with a 12-column grid-aware renderer and matching device API.
   - `packages/voice-device`: audio-first headset simulator.
   These register their supported UI components and receive live UI payloads over WebSocket.

A dockerized workflow also runs supporting utilities like the LM endpoint proxy and the knowledge-base data volume.

## Running with Docker Compose

The repository now ships with a Docker Compose workflow that launches all project services (core-system + registry, knowledge-base, activity-recognition, device API, and device UI) in a single command.

1. Ensure Docker is installed and running. If you are using LM Studio or another model host, expose it at `http://localhost:1234/v1/chat/completions` or update the `LLM_ENDPOINT` environment variable before starting the stack.
2. From the repository root, build and start the services:

   ```bash
   docker compose up --build
   ```

   The first run can take a few minutes while images are built. Subsequent `docker compose up` calls reuse the cached layers.

3. Once the containers are healthy you can access the services at:
   - Service registry API: `http://localhost:3000`
   - Core system UI orchestration API: `http://localhost:3001`
   - Knowledge base: `http://localhost:3005`
   - Activity recognition service: `http://localhost:3003`
   - Device API service: `http://localhost:3002`
   - Device UI preview (Vite dev server): `http://localhost:5173`
   - Tablet device API service: `http://localhost:3012`
   - Tablet device UI preview: `http://localhost:5174`

4. A named Docker volume `knowledge-base-data` persists the knowledge-base `kb-data.json` file across container restarts. To reset the knowledge base, remove the volume: `docker volume rm ui-gen-poc_knowledge-base-data`.

5. Stop the stack with `Ctrl+C`, then optionally clean up containers with `docker compose down`.

### Customising the Docker stack

- Override any service URL or port via environment variables in `docker-compose.yml`. For example, set `LLM_ENDPOINT` to point at a remote model endpoint.
- The device UI container uses Vite’s dev server for hot reload. Mount the repository into the container or rebuild the image to pick up source code changes.

## Local Development (manual services)

You can still run the services directly with Node.js for iterative development. Make sure you have Node.js and npm installed, then install dependencies and start each package individually or use the `scripts/manage-services.sh` helper to orchestrate the processes.

1. Install dependencies in the repo root with `npm install` (workspaces handle each package).
2. Start the services you need (e.g., `npm run dev --workspace packages/core-system`). The device UI uses Vite, so `npm run dev --workspace packages/device` launches hot reload.
3. Point the knowledge base at your preferred LLM via `OPENROUTER_API_KEY` or `LLM_ENDPOINT`.
4. Use the `/registry` endpoint on the core (`http://localhost:3001/registry`) to confirm devices, Things, and capability modules are registered.

## Troubleshooting & common issues
- **LLM invents commands** – ensure the core passes actual Thing actions (check `/things/{id}/actions`) and that `knowledge-base` has the latest build with the strict instruction block.
- **No UI appears on devices** – confirm the device registered (`/registry`), then check WebSocket logs (`docker compose logs device-api -f`). Cached UIs live in the core’s memory; hitting `/generate-ui` manually will trigger a refresh.
- **Capability errors** – the core logs warnings when a capability module is missing or lacks an endpoint. Use `/registry` to verify the capability record.
- **Resetting the KB** – remove the `knowledge-base-data` volume or delete `packages/knowledge-base/kb-data.json` (when running locally) to re-seed the requirement documents.

## Project history (condensed)
- Started as a single-device PoC with hardcoded endpoints.
- Added WebSocket streaming, better action metadata, and service registry support.
- Introduced the knowledge-base service and schema-filtered LLM prompting.
- Enforced strict action usage and tool-calling, eliminating invented commands.
- Removed device-specific assumptions so UIs can target any Thing at runtime.
- Extended the schema/core prompts to expose every registered Thing, enabling multi-Thing control from a single UI payload.
