# Milestone 5 Runbook：真实 Provider

M4 验收通过后自动执行。实现 OpenAI-compatible、DeepSeek preset、Anthropic adapter、timeout/cancel/retry/context budget。用户已授权真实模型调用优先接入 DeepSeek，并已提供该项目专用 API key。

本机 secret 引用：

```text
DeepSeek API key file: /home/ubuntu/.config/EasyAnalyse/secrets/deepseek_api_key
```

执行要求：

- 真实 Provider 首选 DeepSeek preset。
- API key 明文不得写入仓库、主文档、sidecar、普通设置、导出配置、prompt 日志或 Telegram。
- 自动化测试应优先使用 mock；如确需真实 API smoke test，只做低成本最小调用，并在 Telegram/commit 摘要中只记录“DeepSeek smoke test passed/failed”，不记录 key。
- 若真实 API 调用出现高额费用风险、频繁失败、额度/速率限制、或需要改变默认模型调用策略，暂停询问用户。
