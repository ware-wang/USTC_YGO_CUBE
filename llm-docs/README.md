# LLM Docs

这个目录是给**后续接手该项目的模型**准备的。

目标只有一个：**让下一个模型在最短时间内知道项目是什么、现在做到哪了、下一步该干什么、从哪里下手调试。**

## 文件索引

- `PROJECT_MAP.md` — 项目结构、核心模块、关键链路
- `WORKLOG.md` — 工作记录，按日期追加
- `NEXT_STEPS.md` — 当前建议优先做的事、风险点、验收标准
- `DEBUGGING_RUNBOOK.md` — 启动、联调、排障、回归检查
- `OPEN_QUESTIONS.md` — 尚未确认的问题、需要继续验证的点

## 当前状态摘要

截至 2026-05-27：

- 项目已确认是 **Cube Draft + neos-ts + ygopro/ocgcore bridge** 的组合架构。
- 已修复一批高优先级问题，重点是 **neos 自动入房链路** 和 **事件名不一致**。
- 当前推荐的浏览器对战入口是：
  - 自动：`/neos/duelroom?passwd=...&player=...`
  - 手动：`/neos/match`
- `/neos/duelroom` 默认应连接：
  - `<当前主机>:7911`
- 运行时应优先使用：
  - **Node 20**

## 给后续模型的约定

1. **先看这个目录，再改代码。**
2. 修完任何真实问题后：
   - 更新 `WORKLOG.md`
   - 更新 `NEXT_STEPS.md`
   - 如果调试流程变化，更新 `DEBUGGING_RUNBOOK.md`
3. 如果你发现 README 与代码行为不一致：
   - 优先修代码或文档中的一方
   - 然后在 `WORKLOG.md` 写清楚这次修正
4. 尽量记录：
   - 复现方式
   - 真实根因
   - 修法
   - 如何验证

## 快速切入路线

如果你只有 5 分钟：

1. 读 `PROJECT_MAP.md`
2. 读 `WORKLOG.md` 最新一节
3. 读 `NEXT_STEPS.md`
4. 按 `DEBUGGING_RUNBOOK.md` 启动和验证
