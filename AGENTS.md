# AGENTS.md — 开发流程铁律（先读这个）

本文件固化用户于 **2026-09-30** 明确定下的流程。**未获新的明确指令前，一直有效。**

用户原话：

> 从现在开始，每次开发修改依旧自动commit到GitHub，但版本号升级、release/tag、npm发布
> 都改成手动，没有明确指令不自动进行。

## 自动做（无需询问）

- 改 `src/`（**`src/` 是唯一真源**），然后跑 `node build.mjs` 生成 `lib/` 与 `packages/core/`
- 跑门禁直到全绿：`node build.mjs --check`，以及仓库同级的 16 套验证脚本
- `git add` + `git commit`
- `git push origin HEAD:main`

## 必须先拿到用户明确指令（默认一律不做）

- **升级版本号**（改 `package.json` 的 `version`）
- **打 tag**（`git tag -a vX.Y.Z`）
- **GitHub Release**（`gh release create`）
- **npm 发布**（`npm run publish:plugin` / `npm run publish:core`）

「明确指令」= 用户在当轮消息里**点名要求**发布 / 升级 / 打 tag。
**"改完了"、"继续"、"可以" 这类不算。** 只报告"已改完并通过门禁"**不等于**授权发布。

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

- 详细规则与背景：`dsh-gacha-calendar-浏览器扩展移植_交接说明.md` §0
- `pre-commit` hook 另有一道守卫：BOM 检查 + `src/`↔`lib/` 一致性（见 `.githooks/pre-commit`）
