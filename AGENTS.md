# AGENTS.md — 开发流程铁律（先读这个）

本文件固化用户于 **2026-09-30** 明确定下的流程。**未获新的明确指令前，一直有效。**

用户原话：

> 从现在开始，每次开发修改依旧自动commit到GitHub，但版本号升级、release/tag、npm发布
> 都改成手动，没有明确指令不自动进行。

## 自动做（无需询问）

- 改 `src/`（**`src/` 是唯一真源**），然后跑 `node build.mjs` 生成 `lib/` 与 `packages/core/`
- 跑门禁直到全绿：`node build.mjs --check`，以及 `cd test && node all.mjs`（**全绿即可**，不写死通过数——数字会漂）
  - 注：仓库同级的 `probe*.mjs` 是临时探针、`test/run.mjs` 是早期入口，**都不属于门禁**；CI 跑的也只有上面两条
- `git add` + `git commit`
- `git push origin HEAD:main`

## 必须先拿到用户明确指令（默认一律不做）

- **升级版本号**（改 `package.json` 的 `version`）
- **打 tag**（`git tag -a vX.Y.Z`）
- **GitHub Release**（`gh release create`）
- **npm 发布**（`npm run publish:plugin` / `npm run publish:core`）

「明确指令」= 用户在当轮消息里**点名要求**发布 / 升级 / 打 tag。
**"改完了"、"继续"、"可以" 这类不算。** 只报告"已改完并通过门禁"**不等于**授权发布。

## 文档修改纪律

用户 2026-10-28 明确要求：

- **`README.md`（用户看的那份）：必须经用户审批**。不许随开发顺手改；要改先把改动内容给用户看，等明确同意。
- **`README_Dev.md`**：按需改，但不要主动扩写；只在"待办状态变了 / 事实性错误"时做最小改动。
- **`test/README.md`**：跟着测试结构走（段数等有机器守卫），必要时才动，最小改动。
- 这条规则同样约束**派给子代理的任务书**：不许写"文档同步""更新 README"这类泛化指令，只能点名具体文件和具体改动。

## 提交前必须确认门禁真的绿了

- 只看 `结果：N 通过 / M 失败` 里的 **M 是否 = 0**；出现「失败项：」就是红，不看总数。
- 脚本里 `commit` 之前必须显式判断测试退出码，**红了不许提交**（2026-10-25 曾红着提交，main 红过一次）。
- `node build.mjs --check` 与 `cd test && node all.mjs` 两条都要过。

## 对外文字（PR 评论 / Issue / Release notes / 其它公开回帖）

**永远先把原文给用户看，等用户回「发」才发。**

发出去的必须就是用户看过的那一版：**一个字不加、一个标点不改、不加任何解释性括号**。

- 起草 → 展示 → 用户可能要改 → 改完再展示 → 直到用户明确说「发」；
- 「发」只对**那一条文本**有效，下一条要重新确认；
- 不允许"顺手补一句更清楚""顺手加个链接说明"——那都是自作主张；
- 已经发出去但用户改过之后，**不要再动它**（别二次修改、别删了重发）。

## 硬门禁

`publish:plugin` / `publish:core` 的第一步是 `tools/require-publish-consent.mjs`：
没有环境变量 `DSH_ALLOW_PUBLISH=1` 就直接退出，**不会发布**。

只有拿到明确指令后才这样放行：

```
PowerShell : $env:DSH_ALLOW_PUBLISH='1'; npm run publish:plugin
POSIX      : DSH_ALLOW_PUBLISH=1 npm run publish:plugin
```

## 未获发布授权时的版本号

版本号**停在最后一次已发布的号上**；改代码但不动 `version`，等指令来了再一起升号发布。

## 相关

- 详细规则与背景：本地文档，不进仓库
- `pre-commit` hook 另有一道守卫：BOM 检查 + `src/`↔`lib/` 一致性（见 `.githooks/pre-commit`）
