# NOTES.md — 交接笔记（开工先读，收尾前更新）

分工：**`AGENTS.md` 是规矩**（什么必须问、什么不许做）；**这份是现状**（现在是什么样、为什么这样、哪里埋着雷、下一步干什么）。
`README_Dev.md` 是给"外部接手者"看的细节手册（长，按主题组织）；这份只留**当下有用**的东西。

更新时机：改了行为 / 踩了新坑 / 待办有进出 —— 收尾前回写本文件的「当前状态 / 坑 / 待办」。

---

## 1. 当前状态（2026-11-26 记）

| 项 | 值 |
|---|---|
| 版本 | **0.15.0**（`package.json` 与 `packages/core/package.json` 同号） |
| 发布 | npm 两个包 `latest` 都是 0.15.0；tag `v0.15.0`；GitHub Release 已发 |
| 分支 | `main` 干净，与 `origin/main` 同 sha |
| 门禁 | `node build.mjs --check` ✓ · `cd test && node all.mjs` **7651 通过 / 0 失败**（默认 TZ 与 `TZ=UTC` 各一次）· `node tools/check-host-allow.mjs` 11/0 ✓  ← 通过数会漂，写的是当时值 |
| 规模 | 来源 **61 款**（卡池/活动两侧）· `src/client` 63 个 .js + 11 个 .css · `test/` 50 个 `cases-*.mjs` + 458 个夹具目录 |
| 产品 | DSH 插件：侧栏按钮（轮播）+ 排期面板 + 设置页 + 来源健康页；核心抽成 `packages/core`（`createEngine`）供浏览器扩展等复用 |

数据流（理解代码的主线）：

```
30-game-*.js 的抓取器 → 解析器**直出条目事实**（title/roles/startTs/endTs/raw/source）
  → 50-refresh.js 的 mergeEntryRecord 收口（外显名归一 + 数组 title/show/roles 落盘）
  → 81-schedule-model.js 的 scheduleNormalize / scheduleItemOf（显示层：卡片读 show||title）
  → 82-schedule-view.js（面板渲染：卡片 / 悬停 / 探头）
```

---

## 2. 关键决策 + 理由

| 决策 | 理由 |
|---|---|
| `src/` 是唯一真源；`lib/` 与 `packages/core/core.mjs` 是**产物**，随源码一起提交 | 两个包（插件 + 中立 core）必须同源；`PLUGIN_VERSION` 由 `build.mjs` 注入，手改产物会被下次 build 覆盖 |
| 条目时间 = **绝对时刻**（ms）+ 条目自带 `tz`；文本按源站墙钟解析 | 同一份数据在 UTC 与 +08 机器上必须得同一个 ts（P4 口径） |
| 外显名只做**有源站证据的归一**（剥体裁尾巴 / 「新登場」领句 / 取「」真名 / 取核心名）；**不做程序截断** | 用户 2026-11-18 明确不做截断；长度交给面板 CSS 省略 + 悬停全文 |
| 探头/并列条的短名走 **opt-in** `extrasShowFromEntry`（默认关） | 共享数据层默认「并列条 = 源站原文」；一刀切会连带改 60 款来源。开的地方：`fgo-jp` 卡池、`endfield` 卡池，以及 imas/pjsk/uma/cytq/wqmt/yslz/hsr/genshin/wd/wuwa/fgo 等经解析器侧处理 |
| `roles` 是角色名**事实**；卡片"有角色就显示角色"，`banner`/`title`/悬停/提醒标题**仍逐字原文** | 显示与事实分离：源站原文可追溯，界面又不被长名撑爆 |
| golden 是**改造前冻结的字面量**，不是快照 | 见 `AGENTS.md`「回归 golden 纪律」：禁止改完再采集；差异要登记 + 逐字证明 + 反向守卫 + 反向证明 |
| 来源名**逐字**用源站名字，不加后缀/括注；「换默认源」与「改名」是两件事 | 见 `AGENTS.md`「用户可见文字（铁律）」；来源名在设置页下拉里逐字显示 |
| 起点未知：外显只认**两端明确**（`coversNow`）；「起点未知但终点未过」只有显式开 `includeOpenStart` 的来源才进悬停/数组 | 不猜起点、不拿未来期进外显；悬停/数组是"这条事实还值得看吗"，口径不同 |
| **无结束哨兵**：本批最大结束时间且 ≥2 条共用 ⇒ 视为无结束（`endTs=null`） | 否则"结束最晚"会选到 2030 年的常驻池（FGO 日服 `closedAt=1911653999` 这类） |
| 出厂隐藏 = **至少一侧未配置**的 9 条 | 隐藏"没配好"的，而不是隐藏"小众"的 |
| 发布：版本号**先问**；「发版」= 升号 + tag + Release + npm（一条龙）；notes **先审后发** | 见 `AGENTS.md` §0.1~0.4 |

---

## 3. 坑（都踩过，别再踩）

1. **pnpm 路径已失效**：DSH 升级到 `DSH NEXT` 后，`%APPDATA%\DSH Desktop\runtime-commands\bin\pnpm.cmd` 里写的还是 `F:\DeepSeek\DeepSeek-Harness-Desktop\...\pnpm.mjs`（该目录已不存在）。
   用：`node "C:\Users\<user>\AppData\Local\Programs\DSH NEXT\resources\app.asar.unpacked\node_modules\pnpm\bin\pnpm.cjs"`。
2. **npm 11 的 staged publish**：报 `409 Cannot publish over previously published/staged version` 或 `404` 时，版本**往往已经在 registry**（Fastly packument 缓存延迟）。
   判定看 `npm view <包> dist-tags`，别重复发、更别改号重发。
3. **`~/.npmrc` 必须是 Automation token**（账号 Passkey 2FA、没有 6 位 TOTP）。token 失效的表现是 `npm whoami` → 401；别去猜 OTP 流程。
4. **`gh release create/edit` 必须在仓库目录执行**，在别处会 `fatal: not a git repository`。
5. **夹具命名守卫**：`test/map.json` 的键要匹配段前缀正则（`p3|p4|…|ba|bwiki|bandori|gf2|ournotes|fgo|uma|…`），新夹具按段命名（例：`p3c-endfield-fzwiki-gacha-1126`）。
6. **测试时间炸弹**：断言里不要写死绝对日期，用相对时间构造（曾被 11-20 03:59 这种时点卡红）。
7. **`build.mjs` 的 ORDER**：`05-version.js` 不能排第一 —— `const PLUGIN_VERSION` 会成全局词法绑定，V8 报 `Identifier already declared`。
8. **PowerShell 中文**：先设 UTF-8；写含中文的文件用 Node/Python 的 UTF-8（PS 5.1 的默认编码会坏）。`git commit -m` 带中文引号会触发 pathspec 错误 ⇒ 用 `git commit -F <文件>`。
9. **真实数据要走宿主代理**：`http://127.0.0.1:<端口>/api/gacha-calendar-proxy?url=…&referer=…&headers=…&contentType=…&origin=0`；直连部分源站会被 CORS/403 拦。
10. **改了 `src/` 必须 build**：`PLUGIN_VERSION` 靠 build 注入；不 build 则产物里还是旧版本号，插件不会因版本变化强制刷新，`build --check` 也会红。
11. **`displayNameNextOf` 的白名单会互相打架**：加体裁尾巴前先想"剥完会不会留下悬挂修饰词"（例：`…ピックアップガチャ開催！` 多剥一刀会剩「ピックアップ」）；已有 `DISPLAY_TAIL_DANGLING` 守卫，但新增尾巴仍要写反向断言。
12. **提醒/轮播读的是数组 `title`**，不是显示层 `show`：改显示名只影响卡片/探头，提醒文案要单独看。

---

## 4. 文件地图

```
src/client/                 63 个分片，build.mjs 按 ORDER 顺序拼接成 lib/client.js
  00-head.js                DSH 模块加载壳 + react require（必须第一）
  05-version.js             版本号占位符（build 注入，勿手改）
  10-config.js              配置常量
  15-env.js                 core 环境注入缝（transport / now / timer）
  20-source-core.js         SOURCES 容器 + registerSource
  21-fetcher-tables.js      两张抓取器表（GACHA_FETCHERS / EVENT_FETCHERS）
  22-fetcher-core.js        抓取公共设施（桥接 / 通用载荷 / 备选源解析）
  23-parser-time.js         时间解析（parseTime / parseRange / bwiki 时间表扫描）
  24-parser-window.js       当期窗口判定（补全起点 / 选当期 / 覆盖判定）
  25-parser-order.js        排序优先级（年份 / 跨年 / 永久 / 类别档位）
  26-parser-hover.js        悬停构造（hoverTextFromItems / buildEventHover / buildPoolHover）
  27-parser-text.js         文本工具（decodeEntities / numOrNull …）
  28-parser-hover-tools.js  悬停排版共用工具
  29-parser-register.js     中文/繁体时间解析 + 来源抓取器登记
  30-game-*.js              按厂商分文件（下方对照表）；共享工具在 30-game-*-common.js
  44-test-exports.js        纯函数测试出口（测试从这里拿 T.*）
  50-refresh.js             抓取收口 / mergeEntryRecord / 数据层数组（title/show/roles/ts/raw）
  60-helpers.js             通用工具（cleanRoleNames / 外显名归一 / 排序 / 默认设置）
  65-remind.js              到期提醒（桌面通知）
  80-shared-ui.js           共享 UI 片段
  81-schedule-model.js      排期模型（scheduleNormalize / scheduleItemOf / 轮播取数）
  82-schedule-view.js       面板视图（卡片 / 悬停 / 探头展开）
  83-panel-shell.js         面板外壳 / 布局
  84-settings-page.js       设置页
  90-plugin.js              插件入口（侧栏按钮注册）
  92-dsh-env.js             DSH 环境对接（settings scope / snapshot）
  99-tail.js                收尾
  engine-api.js / engine-head.js  core 引擎装配
  styles/*.css              11 个样式段（ORDER 见 build.mjs 的 CSS_ORDER）
src/index.js                宿主侧（schema / 代理路由 / snapshot handler / PROXY_ALLOW_HOSTS）
build.mjs                   产物生成 + `--check`（含版本注入、语法检查、类型声明生成）
packages/core/              抽出的核心包（gacha-calendar-core，版本跟随根包）
lib/                        产物（随仓库提交）：client.js / index.js / remind-core.mjs / types/
test/
  all.mjs                   总门禁（聚 50 段用例）
  harness.mjs               check / section / useFixtures / setFetchImpl 等
  load.mjs                  引擎加载（T 导出）
  map.json                  URL → 夹具 映射（键要匹配段前缀正则）
  fixtures/                 458 个夹具目录（response.txt + meta）
  legacy-golden.mjs         冻结 oracle 读取器（→ fixtures/legacy-oracle-golden.json）
  cases-*.mjs               50 个用例文件（core / p3~p9 / batch1~6 / 各游戏专项 …）
tools/                      check-host-allow / check-bom / require-publish-consent / setup-hooks
.githooks/pre-commit        BOM 守卫 + src↔lib 一致性
AGENTS.md                   规矩（必读）
NOTES.md                    这份
README.md                   用户看的（改前必须问）
README_Dev.md               开发者细节手册（长；按需最小改）
```

厂商文件 → 来源 id（61 款，便于按 id 定位代码）：

```
hoyoverse   genshin hsr zzz bh3 bh2 wd
kuro        wuwa zspms
cygames     uma-jp uma-global uma-tw uma-kr uma-cn pcr-jp pcr-tw gbf
bandori     bandori ournotes ournotes-global
papergames  yslz wxnn nikki4
perfectworld p5x nte tof
netease     hlr yys
idolmaster  gakumas shinycolors millisita deresute shanison
sega        pjsk pjsk-tc pjsk-kr
bluearchive ba-cn ba-global ba-jp
hypergryph  arknights endfield
aniplex     fgo fgo-jp
hl          hl hl-jp
wonderplanet crashfever
mixi        gwdz
dmm         kancolle
smilegate   czn
longyuan    wuhuamixin
naroda      kedr
aurogan     bjhl
aisno       wqmt
aojiao      gachaparty
baio        pengpeng
bluepoch    r1999
epidgames   ddlezj
gongguo     reso
neowiz      browndust2
sunborn     gf2
wfskey      cytq
yostar      stellasora
```

---

## 5. 待办

### A. 要先定产品口径才能动（全量审计里的「可疑」项）

- `arknights` 卡池空：默认 URL 只有公告 brief，没有寻访档期字段（要抓公告详情或 PRTS 卡池页）。
- `wxnn` 两侧空：档期全在公告长图里（要 OCR）。
- `czn` 活动起点是「即日起」推定（估算窗口）；卡池外显带「即将开始」措辞（可剥）。
- `wqmt`「灰烬之潮 第16期」「灰烬之途」源站无档期文本，无法判定是否漏。
- `uma-tw` / `uma-cn` 活动外显：取**活动本体**还是**当前阶段**。
- `fgo-jp` 活动外显：是否优先 `eventQuest`；常驻加成（如絆獲得量アップ 到 12-31）会不会顶掉在期活动。

### B. 功能缺口（未配来源，不是解析 bug）

`hl` 卡池 · `tof` 活动 · `reso` 活动 · `ddlezj` 卡池 · `pengpeng` 卡池。

### C. 已定的取舍（**不要再当 bug 修**）

- 并列条默认显示源站原文，只有开 opt-in 的侧才短名（其余 20 侧里 6 侧已判「源站无结构化短名 ⇒ 不改」）。
- 卡片显示合并后的 `roles` 是设计（`ba-cn` / `wqmt` / `wuwa` / `bh2` 等）；`banner` 与 `roles` 不同源属于"当期合并"口径，不是错。
- `pjsk` 三服的英文活动名、`ba-jp` 自带副标题的活动名：判为真名，不改。
- 探头/并列条里判为不改的：`fgo` 活动、`fgo-jp` 活动（只有活动名，无结构化短名）。

### D. 运维

- npm **Automation token** 目前用的是旧交接记录里找回的那个，建议轮换（换新后只改 `~/.npmrc` 一行）。
- `~/.npmrc` 的原文件备份在 `~/.npmrc.bak-20261126`（里面是已失效的 token）。