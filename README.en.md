# Petri

[中文](README.md)

A lightweight platform for observing how coding agents talk to model APIs: run real agent tasks through a capture proxy, keep the full raw request/response traffic (headers and streaming events included), and compare across agents, versions, models, and feature flags.

## Features

- Multiple agents: codex, claude code, pi, opencode, omp; local or docker execution
- Capture proxy in front of any OpenAI / Anthropic compatible upstream, raw traffic preserved in full
- Five request views: JSON / Rendered / Events / Raw / Headers
- Observe the wire-level difference of agent feature flags; side-by-side run comparison

## Usage

```bash
npm install
npm run server   # backend :8787
npm run dev      # frontend :5199
```

## Data layout

| Path | Contents |
|---|---|
| `~/.petri/agents/<agent>/<version>` | agent install cache |
| `~/.petri/runs/<run-id>/` | per-run runtime state (isolated home) |
| `~/.petri/bodies/<run-id>/` | captured request/response bodies |
| `~/.petri/petri.db` | run / request / model config metadata |


