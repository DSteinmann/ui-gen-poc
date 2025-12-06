# Device renderer

The smartphone renderer in this package consumes UI descriptions streamed from the core system and renders them with React. It now understands ergonomics hints so that the core can request larger tap targets without touching the core runtime.

## Ergonomics profiles

- Use `context.defaultErgonomicsProfile` to advertise the preferred profile (`standard` or `large-tap-targets`).
- Provide `context.supportedErgonomicsProfiles` to document the options the device understands.
- When the renderer receives `large-tap-targets` (or aliases such as `glove-mode`), it automatically bumps padding, font sizes, and control heights for supported components.

## Per-component sizing

Text, button, toggle, slider, and dropdown components accept a `size` prop. Valid values are `compact`, `standard`, `large`, or `auto` (the default). When omitted or set to `auto`, the renderer picks a size that matches the active ergonomics profile.

Example:

```json
{
  "context": {
    "defaultErgonomicsProfile": "large-tap-targets"
  },
  "components": [
    { "type": "text", "text": "Hallway lighting" },
    { "type": "button", "label": "Turn lights on", "size": "large" },
    { "type": "toggle", "label": "Auto mode", "checked": false }
  ]
}
```

With the profile set to `large-tap-targets`, this UI renders with spacious typography and 48–56px tap targets so it stays usable when the user is walking or wearing gloves. Setting `size` explicitly lets the core override the automatic choice on a per-component basis.
