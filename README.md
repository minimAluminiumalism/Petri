# Petri

[English](README.en.md)

观测 coding agent 与模型 API 之间流量的轻量平台：让真实的 agent 任务经由抓包代理执行，完整保留原始请求/响应（含 headers 与流式事件），支持跨 agent、版本、模型、feature flag 的对比。

![screenshot](docs/screenshot.png)

## 动机

Post-train 阶段需要精确观察 agent 发给模型 API 的请求和模型返回的响应：tools 列表如何构成、beta header 如何协商、feature flag 开启后报文发生了什么变化、上游代理是否改写了字段。这些信息无法从 agent 自身的日志或抽象层获得，只能通过 wire-level 的原始报文确认。

通用抓包工具不了解 agent 语义，报文无法按任务组织，也不支持跨运行、跨配置的对比。

Petri 从观测这一件事切入：让 coding agent 通过抓包代理执行真实任务，完整保留原始流量，以 run 为单位组织、检查与对比。

## 功能

- 多家 agent:codex、claude code、pi、opencode、omp;local / docker 执行
- 抓包代理转发任意 OpenAI / Anthropic 兼容上游，原始报文完整留档
- 请求详情：JSON / Rendered / Events / Raw / Headers 五种视图
- 观测 agent feature flag 在 wire 上的实际差异，run 之间并排对比

## 使用

```bash
npm install
npm run server   # 后端 :8787
npm run dev      # 前端 :5199
```

## 数据位置

| 路径 | 内容 |
|---|---|
| `~/.petri/agents/<agent>/<version>` | agent 安装缓存 |
| `~/.petri/runs/<run-id>/` | run 运行时状态（隔离 home) |
| `~/.petri/bodies/<run-id>/` | 抓包请求/响应体 |
| `~/.petri/petri.db` | run / 请求 / 模型配置元数据 |


