# Tablet / Laptop Renderer

This package hosts a second UI device that targets large-format surfaces (tablets, laptops, wall displays). It shares the same core API flow as the smartphone renderer but adds a 12-column grid so the knowledge base can experiment with explicit layout hints without affecting the handset UI.

## Capabilities
- Registers as `device-tablet-001` with the core system and service registry.
- Streams UI payloads over WebSocket and renders them via React + CSS grid.
- Understands optional `layout` / `placement` objects per component so the LLM can pin controls to columns, specify spans, or flag overlay cards.
- Falls back to auto-layout when no placement metadata is provided.
- Honors the same action schema as the smartphone renderer (buttons, toggles, sliders, dropdowns, status cards, containers) plus all ergonomics/size hints.

## Running locally

```bash
cd packages/tablet-device
npm install
npm run server   # starts the device API + registration on :3012
npm run dev      # launches the Vite UI on :5174
```

Set `VITE_CORE_WS_URL`, `CORE_SYSTEM_URL`, and other env vars if you are not running inside Docker Compose.

## Layout hints reference
Each component may include a `layout`/`placement` object such as:

```json
{
  "type": "statusCard",
  "title": "Greenhouse climate",
  "value": "22.4 °C",
  "layout": {
    "region": "hero",
    "column": 1,
    "colSpan": 6,
    "rowSpan": 2
  }
}
```

Recognized properties: `region`, `column` (`col`/`x`), `colSpan` (`span`/`width`), `row`, `rowSpan` (`height`), `order`, `align`, `justify`, `minHeight`, `maxHeight`, and `layer` (for overlays). The renderer clamps values to a 12-column grid and gracefully degrades if metadata is missing or invalid.
