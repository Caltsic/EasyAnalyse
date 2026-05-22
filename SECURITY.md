# Security Policy / 安全策略

## 中文

## 支持版本

当前只支持最新发布版本和 `main` 主干上的最新提交。旧版本中的漏洞会根据风险、复现难度和修复成本决定是否回补。

## 报告漏洞

请不要在公开 issue 中披露可利用安全细节。推荐使用 GitHub Security Advisory：

https://github.com/Caltsic/EasyAnalyse/security/advisories/new

如果 advisory 不可用，请创建一个不包含利用细节的普通 issue，说明“需要私下报告安全问题”，maintainer 会安排私下沟通。

报告时请尽量提供：

- 受影响版本或 commit。
- 影响范围。
- 复现步骤或最小样例。
- 可能的攻击路径。
- 是否涉及 API key、SecretStore、本地文件、移动分享链接、Provider 请求或电路 JSON。
- 建议修复方向。

## 处理承诺

- Maintainer 会优先确认报告是否有效。
- 高风险问题应先私下修复、验证、发布，再公开细节。
- 如果问题影响 API key、SecretStore、Provider 请求、移动分享或本地文件访问，会优先处理。
- 修复发布后，release notes 会说明影响和升级建议，但不会公开不必要的利用细节。

## 安全边界

EASYAnalyse 当前涉及：

- 本地电路 JSON 文件。
- 本地设置与 SecretStore。
- 外部模型 Provider 请求。
- 局域网只读移动快照。
- Tauri 桌面应用权限。

不要把 API key、私钥、证书、生产凭据或未公开硬件设计提交到仓库。

## English

## Supported Versions

Only the latest release and the latest commit on `main` are actively supported. Backports for older versions are decided based on risk, reproducibility, and fix cost.

## Reporting A Vulnerability

Do not disclose exploitable security details in public issues. Prefer GitHub Security Advisory:

https://github.com/Caltsic/EasyAnalyse/security/advisories/new

If advisory reporting is unavailable, open a public issue without exploit details and state that you need to report a security issue privately. A maintainer will arrange private follow-up.

Please include:

- Affected version or commit.
- Impact scope.
- Reproduction steps or a minimal sample.
- Possible attack path.
- Whether it involves API keys, SecretStore, local files, mobile share links, Provider requests, or circuit JSON.
- Suggested fix direction.

## Response Expectations

- Maintainers will prioritize validating the report.
- High-risk issues should be fixed, verified, and released privately before details are public.
- Issues affecting API keys, SecretStore, Provider requests, mobile sharing, or local file access have priority.
- Release notes will describe impact and upgrade guidance after a fix, without unnecessary exploit detail.

## Security Boundaries

EASYAnalyse currently involves:

- Local circuit JSON files.
- Local settings and SecretStore.
- External model Provider requests.
- LAN read-only mobile snapshots.
- Tauri desktop application permissions.

Do not commit API keys, private keys, certificates, production credentials, or unreleased hardware designs.

