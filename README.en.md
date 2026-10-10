# Petri

[中文](README.md)

A lightweight platform for observing how coding agents talk to model APIs: run real agent tasks through a capture proxy, keep the full raw request/response traffic (headers and streaming events included), and compare across agents, versions, models, and feature flags.

![screenshot](docs/screenshot.png)

## Motivation

In post-training, you need to see exactly what an agent sends to the model API and what the model returns: how the tools list is composed, which beta headers are negotiated, what changes in the request when a feature flag is enabled, whether the upstream proxy rewrites fields. None of this is visible from the agent's own logs or abstraction layers — only from raw wire traffic.

General-purpose packet capture tools don't understand agent semantics; traffic can't be organized by task, and there's no comparison across runs or configurations.

Petri starts with observation: coding agents run real tasks through a capture proxy, raw traffic is preserved in full, and everything is organized, inspected, and compared per run.

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


