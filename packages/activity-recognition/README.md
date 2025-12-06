# Activity Recognition Service

This capability simulates a context sensor that reports the user's current activity state to the core system. The service exposes REST endpoints (e.g., `GET /activity`) and rotates through known states on an interval so the core and devices can react without additional hardware.

## Reported states

| id             | Description                                                              | Ergonomics preference |
| -------------- | ------------------------------------------------------------------------ | --------------------- |
| `hands-free`   | User hands are available for precise touch interaction.                  | `standard`            |
| `hands-occupied` | User hands are busy; downstream UIs should prefer audio guidance.        | `voice-first` focus   |
| `running`      | User is running, so interactions must stay short with large tap targets. | `large-tap-targets`   |

Each state payload is returned from `GET /activity` (and the capability tool call) with `id`, `description`, `timestamp`, and `confidence`. The new `running` state also adds `ergonomicsProfile: "large-tap-targets"`, which the knowledge base uses to set `context.defaultErgonomicsProfile` and request `size: "large"` controls in the smartphone renderer.

## Manual control

- `POST /activity/state` with `{ "state": "hands-free" | "hands-occupied" | "running" }` pins the simulator to a specific state.
- `POST /activity/next` advances to the next entry in the rotation list.
- `GET /activity/states` lists all available states along with their metadata.

Use these endpoints while testing ergonomics changes to quickly switch between compact, voice-first, and large-tap-target scenarios.
