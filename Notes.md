# Notes

## Implementation changes
- created first PoC of system with simple, hardcoded endpoints and calls
- Introduced a new WebSocket connection for real-time UI updates.
- Added error handling for WebSocket connection and message parsing.
- Implemented a mechanism to derive the thing ID from action metadata.
- Enhanced action execution with improved status messaging and error handling.
- Updated the action registry to support retrieval of actions by thing ID.
- Modified the thing registration and heartbeat processes to ensure actions are recorded and updated correctly.
- Updated the service registry to include actions associated with each thing.

## Project timeline & progress
- **Foundational PoC:** Started with a single-device smartphone UI calling hardcoded endpoints. Core/knowledge-base components were stubbed and there was no concept of capabilities, registries, or schema filtering.
- **Real-time UX pass:** Added WebSocket broadcasting so devices receive regenerated UIs instantly, plus better health checking and action execution telemetry.
- **Action abstraction:** Built the action registry (with the Thing Description provider) so WoT Thing Descriptions automatically register actions, and the device could infer `thingId` from descriptors instead of relying on hardcoded IDs.
- **Knowledge-base integration:** Introduced the requirement KB microservice, migrated UI generation to an LLM-driven flow, and wired schema/tool metadata through the core so prompts reference only supported components.
- **LLM guardrails:** Tightened prompts to ban invented commands, provided explicit action lists, and added capability-tool reminders to reduce hallucinations. Implemented strict schema enforcement with retry logic if the model ignored tools.
- **Device neutrality:** Removed light-switch assumptions from the smartphone API, pushed generic action translation into the core, and parameterized device registrations via env vars so Docker deployments can point to any Thing.
- **Multi-Thing awareness:** Core now aggregates every registered Thing’s actions, shares `availableThings` with the KB, and schema components accept `thingId`, enabling a single UI/session to control multiple Things (e.g., the light switch and TractorBot).

## Problems encountered & resolutions
- **LLM inventing actions:** Early prompts caused outputs like `"setPower"`. Added explicit "STRICT REQUIREMENT" instructions, passed concrete action descriptors, and validated action IDs inside the device before dispatching.
- **Device-specific assumptions:** The smartphone UI initially inlined `thing-light-switch-001`. We scrubbed those defaults, moved translation logic into the core, and ensured env settings inject the desired Thing at runtime.
- **Stale action registry:** Thing registrations sometimes missed actions after heartbeats. Fixes included refreshing actions on registration, ensuring `ensureThingActions` caches per Thing, and exposing `/things/:id/actions` for debugging.
- **Service startup ordering:** Docker compose races caused the device or KB to miss registrations. Added retries, ensured dependencies register with the service registry, and hardened error logs to surface misconfigurations quickly.
- **Multi-Thing gaps:** Even after the action helper aggregated everything, the KB schema still hinted only one Thing. We updated schema context and KB prompts to describe all registered Things and require `thingId` on controls.

These notes should help future contributors understand how the system evolved from a single-Thing PoC into a multi-service orchestration layer with guardrailed LLM-generated UIs.

