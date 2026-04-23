---
feature_ids: [F051]
topics: [startup, networking, proxy, devx]
doc_kind: note
created: 2026-04-23
---

# F051 Discussion: 单端口统一入口网关

## User Request

> “能不能一键启动一个代理服务器，用户直接走一个端口就好了 剩下的代理服务器来路由，这样用户其实关注的也少只要关注一个端口就好了”

## Clarified Direction

经过本轮讨论，边界收敛为：

- 生产环境必须走统一入口
- 统一入口默认端口为 `7000`
- 内部默认端口保持前端 `7002`、后端 `7001`
- 开发环境可以继续前后端分开运行
- 可额外提供一个 `dev:gateway`，用于本地模拟生产单入口

## Key Tradeoff

不把“生产统一入口”强行扩展成“所有环境都必须经过网关”。原因是开发阶段更强调调试效率，而用户真正关心的是生产访问路径是否单一。

## Outcome

本轮实现采用独立 Node 网关，而不是把生产入口职责耦合进 Next：

- 生产：`7000` 统一入口，转发到 `7001/7002`
- 开发：保留 `pnpm dev`
- 模拟生产：新增 `pnpm dev:gateway`
