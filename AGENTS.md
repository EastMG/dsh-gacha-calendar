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

## 发版规范（完整版：权限 → 版本号 → 说明 → 流程 → 核对）

> 本节把原本散在会话总结 / 交接说明里的发版规则收进仓库，**每条都注明出处**；
> 与上文冲突时以本节为准（最近更新：2026-11-26）。

### 0.1 每一次发版，版本号都**必须先问用户**

用户 2026-11-26 原话：「**本来每一次发版就都要先问版本号**」。

- 即使当轮已经说了「发版 / 发 release」，也**不等于**授权我挑号：先给「建议 vX.Y.Z + 依据（这批改了什么）」，**等用户拍板**再改 `version`。
- 记录佐证（历史版本号都是用户点名的）：
  - 「版本号按你指定升到 **v0.9.0**」（`_digest_dbfa9111.txt`）
  - 「重做这次commit **版本号改成v0.8.15**」（会话总结 T63）
- **严禁自作主张跳号**：曾出现我改到 v0.9.0、用户要求 reset 改回 0.8.15（会话总结「反复重申的约定」第 3 条）。

### 0.2 「发版」授权范围（用户 2026-11-26 定：**「发版」含 npm**）

| 用户说的 | 授权范围 |
|---|---|
| **「发版」** | 升号（问过之后）+ tag + GitHub Release + **npm 发布（`gacha-calendar-core` 与 `dsh-gacha-calendar` 两个包）** —— 一条龙，不必再单独问 npm |
| 「发 release」（旧措辞） | 交接说明 2026-09-21 的记录是**不含 npm**；今天起以「发版」为准，听到旧措辞**先问一句**是不是也发 npm |

注意：说「发版」只授权**流程**，**不授权我挑版本号**（见 0.1）。

### 0.3 Release 说明：先审后发 + 固定格式

**先审后发**（同上文「对外文字」）：先把 notes 全文贴给用户，等「发」；发出去的必须逐字等于用户看过的那一版。

**格式**（会话总结「反复重申的约定」第 1 条为底；其中「以 `实测：…` 收尾」一条已按用户 2026-11-26 要求**去掉**）：

- 首行 `<type>: vX.Y.Z <中文一句话>`，`type ∈ fix / feat / style / refactor / docs / chore / build / release …`
- body 用 `- ` 分条，写「**改了什么 + 为什么**」
- release 说明与 commit 消息**同构**（纯文本，title = 版本号）
- **隔版本发布**时，release 说明必须补**跳过版本的 changelog**，且**每项前缀版本号**

**排版**（v0.14.1 起的实际写法，供对齐）：按 `## 主题` 分组（例：「## 修复」「## 外显名」），条目纯 `- ` 平铺；**不要**写成 `### 1./2./3.` 小标题 + 大段解释段落（2026-11-26 因自造排版被指出过一次）。

### 0.4 发版流程（按序，缺一步不许做下一步）

1. **问版本号** → 用户拍板
2. 改 `package.json` 与 `packages/core/package.json` 的 `version`（同一个号）→ `node build.mjs` 重新注入 `PLUGIN_VERSION`
3. 门禁 M=0：`node build.mjs --check`、`cd test && node all.mjs`（默认 TZ 与 `TZ=UTC` 各一次）、`node tools/check-host-allow.mjs`
4. `git commit -m "chore(release): vX.Y.Z"` → `git push origin HEAD:main`
5. `git tag -a vX.Y.Z -m "vX.Y.Z"` → `git push origin vX.Y.Z`
6. 起草 release notes → **贴给用户审** → 等到「发」
7. 在**仓库目录**执行 `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <utf8文件>`（`gh` 需要 git 仓库上下文，在别处执行会 `fatal: not a git repository`）
8. npm 发布（**「发版」已含，无需再问**）：**先 core 后 plugin**，见下节
9. 核对四项再收工：`npm view <包> dist-tags` 两包都 = vX.Y.Z；`git describe --tags --exact-match` = vX.Y.Z；`origin/main` sha = 本地；`npm pack --dry-run` 的 shasum 与 registry 的 `dist.shasum` 一致

### 0.5 npm 发布的技术前提（踩过的坑，别再踩）

- 账号 `eastmorning` 用 **Passkey 2FA**、**没有 6 位 TOTP** ⇒ 发布必须用 **Automation 型 token**，写进 `~/.npmrc` 的 `//registry.npmjs.org/:_authToken=<automation token>`。
- 动手前先验：`npm whoami` 与 `pnpm whoami` 都应回 `eastmorning`；**401 = token 失效** ⇒ 换 token，不要去猜 OTP 流程。
- 用 **pnpm** 发布：`pnpm publish --cache "F:\DeepSeek\DeepSeek-Workplace\DSH-Workplace-01\.npm-cache"`（npm 11 的 staged 发布流程会给出 409 / 404 的混淆报错）。
- 报 `409 Cannot publish over previously published/staged version` ⇒ 该版本**其实已在 registry**（Fastly 对 packument 有缓存延迟），用 `npm view <包> dist-tags` 复核，**不要重复发、也不要改号重发**。
- 顺序：先 `packages/core`（`gacha-calendar-core`），再仓库根（`dsh-gacha-calendar`）。
- `DSH_ALLOW_PUBLISH=1` 是**脚本级**硬门禁（`tools/require-publish-consent.mjs`），只拦 `npm run publish:*`；直接用 `pnpm publish` 可以绕过它 —— **能绕过 ≠ 获授权**。

### 0.6 版本号与「已发布」的关系

- 未获授权时：版本号**停在最后一次已发布的号上**，改代码不动 `version`。
- **纯文档改动（README / AGENTS 等）不升版本号**（用户 2026-09-21 定，交接说明 §33）。
- 代码改动才升号；**改了号必须重新 build**，否则产物里留着旧号、`build --check` 会红。
- 版本号推进与代码改动一一对应，**不跳号**。

## 文档修改纪律

用户 2026-10-28 明确要求：

- **`README.md`（用户看的那份）：必须经用户审批**。不许随开发顺手改；要改先把改动内容给用户看，等明确同意。
- **`README_Dev.md`**：按需改，但不要主动扩写；只在"待办状态变了 / 事实性错误"时做最小改动。
- **`test/README.md`**：跟着测试结构走（段数等有机器守卫），必要时才动，最小改动。
- 这条规则同样约束**派给子代理的任务书**：不许写"文档同步""更新 README"这类泛化指令，只能点名具体文件和具体改动。
- **在 AGENTS.md 里引用 PR / issue 时写 `pull/123`，不要写 `#123` 或 `PR #123`**：带 `#` 的写法会被 GitHub 自动关联，在那个 PR 的时间线上留下一条「引用了这个 PR」的记录，且**无法撤回**（只能靠 force push 改写历史，代价是全部 tag 失效）。


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
