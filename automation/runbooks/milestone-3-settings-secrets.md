# Milestone 3 Runbook：Settings + Secrets

M2 验收通过后自动执行。实现设置中心、主题、Provider/Model 配置和 API key secret store。用户已提供该项目专用 DeepSeek API key，明文只允许存放在仓库外的本机 secret 文件，不得写入 git、主文档、sidecar、普通设置、规划文档或 Telegram。

已配置本机 secret 引用：

```text
DeepSeek API key file: /home/ubuntu/.config/EasyAnalyse/secrets/deepseek_api_key
```

实现设置/密钥存储时应优先迁移或引用该 secret；若需要更换为 OS keychain，应先保证明文不会进入仓库，并更新 automation handoff。
