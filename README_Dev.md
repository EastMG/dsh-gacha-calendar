# dsh-gacha-calendar 开发文档

## 构建

```bash
npm run build   # src/ → lib/（确定性拼接，无第三方依赖）
npm run check   # 只校验：src/ 拼出来的结果是否与产物一致（不写盘）
```

### 一个仓库，两个 npm 包

本仓库同时发布两个包，**源码只有一份**（抓取/解析核心）：

| npm 包 | 内容 | 谁用 |
|---|---|---|
| `dsh-gacha-calendar` | DSH 桌面端插件（已内联同一份 core，运行时不依赖 npm 解析） | DSH Desktop |
| [`gacha-calendar-core`](packages/core) | 平台中立的抓取核心：`createEngine({ transport, storage, now })`，零依赖、零宿主依赖 | 其它平台（浏览器插件 [`gacha-calendar-extension`](https://github.com/EastMG/gacha-calendar-extension)，开发中）等 |

```bash
npm run publish:plugin   # 发布 DSH 插件包（dsh-gacha-calendar）
npm run publish:core     # 发布中立核心包（gacha-calendar-core，版本号跟随根包）
```

**源站改版时只需改一处**：改 `src/client/23-parser-*.js`～`29-parser-*.js`（解析器共用工具，按职责分段）或对应的 `src/client/30-game-*.js` → `npm run build` → 两个包一起发版，各平台重新构建即可。

- `src/` 是唯一真源，`lib/` 与 `packages/core/` 都是**构建产物，不要手改**。
- `build.mjs` 做三件事：按 `ORDER` 原样拼接 `src/client/*.js` → `lib/client.js`（DSH 的 `__ModuleLoader__` 工厂形态）；复制 `src/index.js` → `lib/index.js`；把 core 主体包成 `packages/core/core.mjs`（ESM 导出 `createEngine`）。拼接逐字节确定，所以 `check` 能给出"一致/不一致"的确定结论；同时会把根 `package.json` 的版本号注入两个产物。
- 源文件约定：**LF 换行、UTF-8 无 BOM、Tab 缩进**（带 BOM 会让 DSH 启动直接失败）。`build.mjs` 会强制校验；`.githooks/pre-commit` 还会在提交 `src/**`、`lib/**`、`packages/**` 或 `build.mjs` 时自动跑一次 `check`，防止绕过源码直接改产物。
- **钩子怎么生效**：跑一次 `npm run setup:hooks` 把 `core.hooksPath` 指到 `.githooks`。它只是一条普通脚本，`npm install` 不会自动执行；等价于手工执行 `git config core.hooksPath .githooks`。
- 历史说明：本仓库此前只提交了打包产物（没有 `src/`），`package.json` 里声明的 `tsc && tsdown` 从未真正可用；当前构建脚本是从产物回填源码时落地的替代方案。

## 插件结构

```
dsh-gacha-calendar/
├── build.mjs        # 构建脚本
├── src/             # 唯一真源
│   ├── index.js     # host 端：配置 schema + 同源代理
│   └── client/      # web 端
│       ├── 05-version.js     # 插件版本号
│       ├── 00-head.js        # DSH 模块加载壳 + react require
│       ├── 10-config.js      # 默认配置 / 刷新频率选项
│       ├── 15-env.js         # core 环境缝：transport（含 bwiki 的 origin=* 收口）/ 时钟 / 计时器
│       ├── 20-source-core.js  # 来源容器 SOURCES + registerSource（模块顶层）
│       ├── 21-fetcher-tables.js # GACHA_FETCHERS / EVENT_FETCHERS（与游戏文件同层：每引擎一份）
│       ├── 22-fetcher-core.js # 抓取公共设施：抓取桥接 / 通用载荷 / 备选源解析
│       ├── 23-parser-time.js   # 时间解析：stripTags + parseTime/parseRange + bwiki 时间表扫描
│       ├── 24-parser-window.js # 当期窗口判定：补全起点 / 选当期 / 窗口文案 / 长期与覆盖判定
│       ├── 25-parser-order.js  # 排序优先级：年份与跨年规则 / 永久判定 / 类别档位
│       ├── 26-parser-hover.js  # 悬停构造：buildEventHover / buildPoolHover + bwiki 卡池载荷
│       ├── 27-parser-text.js   # 实体解码与文本工具：decodeEntities / decodeExtra / numOrNull / byNewestStart
│       ├── 28-parser-hover-tools.js # 悬停排版共用工具（新增来源那套）：hoverPool / hoverEvent
│       ├── 29-parser-register.js # 中文/繁体时间解析 + 来源抓取器登记（bh3 米游社备选源）
│       ├── 30-game-hoyoverse.js   # 米哈游：原神 / 星穹铁道 / 绝区零（含米游社备选源与崩坏3）
│       ├── 30-game-kuro.js        # 库洛：鸣潮
│       ├── 30-game-hypergryph.js  # 鹰角：明日方舟 / 终末地
│       ├── 30-game-bluearchive.js # 蔚蓝档案：国服 / 国际服 / 日服
│       ├── 30-game-bandori.js     # BanG Dream：国服手游 / OurNotes 日服 / 国际服（Bestdori 备选）
│       ├── 30-game-bwiki-common.js      # bwiki 公共段：文件头 + HTML 工具 / 日期解析 / 当期挑选（3 个 region）
│       ├── 30-game-bwiki-wuhuamixin.js  # bwiki ① 物华弥新（whmx）：卡池 + 活动解析
│       ├── 30-game-bwiki-uma-cn.js      # bwiki ② 闪耀优俊少女 国服（umamusume / 简中卡池）
│       ├── 30-game-bwiki-uma-jp.js      # bwiki ③ 赛马娘 日服（umamusume / 活动，Asia/Tokyo）
│       ├── 30-game-bwiki-zspms-html.js  # bwiki ④ 战双帕弥什（zspms / 研发记录，prop=text 形态）
│       ├── 30-game-bwiki-kedr-html.js   # bwiki ⑤ 雪松（kedrgame / 卡池信息，台架测试占位页）
│       ├── 30-game-bwiki-czn-html.js    # bwiki ⑥ 卡厄斯梦境（czn / 卡池记录，实测空页）
│       ├── 30-game-bwiki-stellasora.js  # bwiki ⑦ 星塔旅人（stellasora / 首页活动日历）
│       ├── 30-game-bwiki-html-fetchers.js # 上面 7 个 HTML 形态来源的抓取器
│       ├── 30-game-bwiki-wikitext-common.js # wikitext 形态公共段：取正文（parse.wikitext）/ 当期挑选 / 悬停
│       ├── 30-game-bwiki-zspms-wikitext.js # 战双（wikitext）：SMW ask 索引 + 版本更新公告正文 → 档期
│       ├── 30-game-bwiki-czn-wikitext.js # 卡厄斯梦境（wikitext）：Module:Gacha/data 的 Lua 表
│       ├── 30-game-bwiki-kedr-wikitext.js # 雪松（wikitext）：Template:首页游戏版本内容 的模板调用
│       ├── 30-game-bwiki-kedr-wiki.js   # 雪松社区归档页（往期动员，prop=text）+ 其抓取器
│       ├── 30-game-bwiki-register.js    # 本组 4 条 registerSource + GACHA/EVENT_FETCHERS 接线
│       ├── 30-game-biligame.js    # biligame 系：嘟嘟脸恶作剧 / 闪耀优俊少女
│       ├── 30-game-cygames.js     # Cygames：赛马娘 日服 / 国际服（umapyoi 备选）
│       ├── 30-game-perfectworld.js # 完美世界：女神异闻录：夜幕魅影 / 异环
│       ├── 30-game-sunborn.js     # 散爆：少女前线2：追放
│       ├── 30-game-aniplex.js     # Aniplex / TYPE-MOON：Fate/Grand Order
│       ├── 30-game-sega.js        # 世嘉：初音未来：缤纷舞台
│       ├── 30-game-yostar.js      # 悠星：星塔旅人
│       ├── 30-game-bluepoch.js    # 深蓝互动：重返未来：1999
│       ├── 44-test-exports.js # 回归出口：解析器 + env 工具 + 来源表
│       ├── 50-refresh.js     # 刷新编排、失败沿用旧值、提示归类
│       ├── 60-helpers.js     # 顶部提示归类 / 显隐判定 / 排序 / 角色名与倒计时格式化 / 启动刷新判定
│       ├── 65-remind.js      # 到期提醒（送达）判定 + 文案（**同时被单独拼成 lib/remind-core.mjs 给宿主**）
│       ├── engine-head.js    # core 外壳：createEngine（storage / listGames / getCached）
│       ├── engine-api.js     # 引擎 API：refresh / selfCheck / __test
│       ├── styles/*.css      # 样式（按原段落注释一个文件；build.mjs 的 CSS_ORDER 拼成产物里的 const STYLE）
│       ├── 80-shared-ui.js   # 共用小件：设置分区常量 / 打开设置面板 / 下载文本 / 游戏图标 + 预热
│       ├── 81-schedule-model.js # 新面板排期模型（纯函数）：取色 / 档期窗口 / 悬停文本 / 格式化 / 节拍 hook
│       ├── 82-schedule-view.js  # 新面板渲染层：轮播节拍 / 探头定位 / 留白卡 / ScheduleView / TickerFlipLines
│       ├── 83-panel-shell.js  # 面板外壳 CalendarPanel：订阅 / 刷新 / ticker 接线（旧表格是它内部的分支）
│       ├── 84-settings-page.js # 设置页 CalendarSettingsPage + 通知身份 / 测试通知的宿主路由封装
│       ├── 90-plugin.js      # apply(ctx)：slots / configForms / 悬停 marquee
│       ├── 92-dsh-env.js     # DSH 环境适配（直连 + 宿主代理）
│       └── 99-tail.js        # exports.apply / exports.inject
├── lib/             # 构建产物
│   ├── index.js / client.js
│   ├── remind-core.mjs # 宿主复用的提醒判定（= src/client/65-remind.js 原样 + export）
│   └── types/       # 类型声明
├── packages/core/   # 第二个产物：平台中立核心包 gacha-calendar-core
├── test/            # 离线夹具测试
│   ├── all.mjs      # 统一门禁：聚 31 段用例（P5X / B1~B3 / P4~P9 / 蔚蓝档案 / 异环 / 赛马娘 GameTora / 明日方舟两阶段（举行 / 奖励领取）+ 明日方舟时间轴（整周期逐时刻扫描）+ 规则静态守卫 + 时区口径 + 侧栏轮播 + 到期提醒 + 来源健康 + README 结构图守卫 + core 产物守卫 + 设置页标题行（版本号 + Star 指引）+ 搜索与筛选 + 排期导出 .ics + 刷新频率「启动时」档 + 设置入口（两个面板的齿轮 + 三步跳转设置页）+ 设置页 title 文案（11 处定稿）+ 来源策略（默认源无自动兜底）+ bwiki 请求统一带 origin=* + P3 解析器直出数组（悬停由条目反生成））
│   ├── cases-*.mjs  # 各段用例（31 个：cases-p5x / b1~b3 / p4~p9 / cases-ba / cases-pw / cases-uma-gt / cases-arknights-claim / cases-arknights-timeline / rule-lint / tz / ticker / remind / health / readme / core / star / filter / ics / refresh / settings-jump / settings-copy / sources / bwiki-cors / p3）
│   ├── load.mjs     # 加载构建产物，取 exports.__regression（解析器 + env 工具 + 来源表）
│   ├── harness.mjs  # 夹具 fetch 注入 + check/section/summary + 契约与悬停断言
│   ├── lib-text.mjs # 悬停文本的共用判定（去重 / 相邻重复 / 「名称 ⏎ 只有区间」/ 分类前缀双写）
│   │                # 用法：cases-arknights-claim（真机逐字基线）与 cases-arknights-timeline（整周期）都调它
│   ├── registry-shim.mjs # 各批次注册表规格快照 + DRIFT 守卫（与运行时 SOURCES 核对 tz/name）
│   ├── capture*.mjs # 抓真实响应生成夹具；run.mjs # 单段直跑
│   ├── map.json     # 请求 URL → 夹具路径（**入库**）
│   ├── ui/          # UI 渲染验证 harness（`npm run test:ui`：真 Chromium 里按真实产物 CSS 做**几何**断言；**不在默认门禁里**，无浏览器时优雅 skip）
│   └── fixtures/    # 真实响应快照（**已入库**（2026-10-18 起），重建方式见 test/README.md）
├── tools/           # 守卫脚本：require-publish-consent（发布闸门）/ check-host-allow（来源域名 vs 代理白名单）
├── archive/         # 历史原型，**不参与构建/运行**（remind = 到期提醒的早期 CLI 原型，见 archive/README.md）
├── assets/          # README 截图
├── .githooks/       # pre-commit：编码校验 + src/产物一致性
├── package.json     # dsh.bundle.patch + dsh.client.inject（DSH 加载规范）
├── cordis.patch.yml # bundle patch
└── LICENSE / README.md / README_Dev.md / AGENTS.md
```

### 刷新频率（`refreshMinutes`）

`refreshMinutes = 0` = **仅启动时刷新一次**：只在面板挂载（DSH 启动 / 页面加载）时刷一轮，运行期不排定时器；负数 / 非有限值才是脏配置（永不刷）。**出厂默认 = `0`（启动时）**；老配置由宿主**无条件**迁到 `0`（`migrateRefreshOnce`，标记 `refreshMigrated`；**不看旧值**，用户自己选过的档位也会被改成「启动时」—— 2026-10-31 用户要求）。

### bwiki 的 `origin=*`（CORS 收口点）

**事实**（2026-11-07 真机实测）：`wiki.biligame.com` 的 MediaWiki 接口只有带 `origin=*` 才回 `Access-Control-Allow-Origin`。不带时浏览器**直连**必定 `TypeError: Failed to fetch`（被上层归成「网络不通」），同一 URL 带 `&origin=*` 才 200；此前只是靠宿主代理（不受 CORS 限制）把问题盖住了 —— 所以仓里 22 处 bwiki 地址常量一直没带这个参数也没暴露。

**收口位置**：`src/client/15-env.js` 的两个 transport 出口 —— `transportFetchRaw`（直连）与 `proxyFetchText`（宿主代理）都先过纯函数 `withBwikiCors(url)`：主机是 `wiki.biligame.com` 或 `*.biligame.com` 且 query 里没有 `origin` ⇒ 追加 `origin=*`（无 query 用 `?`，有 query 用 `&`，有 `#hash` 补在 hash 前），其余原样返回（**不重序列化**：中文参数不会被 percent-encode）。因此**新增 bwiki 来源不必自己拼这个参数**，也**不要**再写第二份「拼 origin」的实现（回归在 `test/cases-bwiki-cors.mjs`：纯函数边界 + 两条出口的接线守卫 + 请求记账 + 其它站点逐字不变）。

**bwiki 还必须走代理**：dsh-app:// 源下 bwiki 不回 ACAO，直连会被 CORS 拦；代理在 Node 侧发请求不受限。

### 明日方舟两阶段（举行 / 奖励领取）

**事实**（2026-11-07 核实，改这块之前先看这条）：PRTS 装了 **SemanticMediaWiki 7.3.1**，`action=ask` **一次**就能把活动需要的四列全查出来 —— 所以活动侧的**默认来源**（设置页「活动来源」里的 **`PRTS 活动解析`**）就是这条单请求。原来的两条链路（「活动一览 HTML 解析起止」+「一次批量 query 取活动页 `{{活动信息}}` 的兑换期」）**降级成手动备选源**（**`PRTS 活动一览`**，见下面「来源策略」一节），不再自动参与默认路径：

```
https://prts.wiki/api.php?action=ask&format=json
  &query=[[活动开始时间::+]]|?活动类型|?活动开始时间|?活动结束时间|?兑换结束时间
  &sort=活动开始时间|order=desc|limit=30
```

**字段映射**（`src/client/30-game-hypergryph.js` 的 `parseArknightsSmwEvents`）：

| SMW 属性 / 字段 | 我们这边的字段 | 口径与注意事项 |
|---|---|---|
| `活动开始时间` | `startTs` | 活动开场 |
| `活动结束时间` | `stageEndTs` | **关卡关闭** = 实际举行结束（= 原「一览 `data-time` 的第二个值」） |
| `兑换结束时间` | `claimEndTs` | **兑换 / 奖励领取关闭**；**可缺**（实测 30 条里 6 条是空数组），也可能**与活动结束同值** ⇒ 那时 `claimEndTs = null`（= 没有兑换期） |
| `活动类型` | `cat` | ≈ 我们的分类（`支线故事` / `登录活动` / `危机合约` / …）；**不是每页都有**（实测 8 条里 1 条为空）⇒ 缺失时 `cat` 留空，由 `eventTier` 按**名称关键词**回退 |
| 结果键 / `fulltext`（页名） | `name`（+ `page`） | 页名本身可能就是「视相博物馆：演化」，分类前缀由 `labelOf(cat, name)` 去重（不会拼成「视相博物馆：视相博物馆：演化」） |
| 渲染值 `fmtWindow(startTs, stageEndTs, tz)` | `raw` | `timestamp` 是 **Unix 秒（UTC 绝对值）** ⇒ **直接 ×1000**；源站 tz 只参与**渲染**。⚠️ 不要照原神 SMW（`parseSmwActivity`）拿 `raw`（`"1/2026/11/6/19/59/0/0"`）再按 +08 重算 —— PRTS 的 `raw` 是 **UTC 墙钟**，那样会整体偏 8 小时 |

**抓取链路**（默认来源 `PRTS 活动解析` = `fetchArknightsEvents`）**一条**请求：

`transportFetchRaw(eventUrl + "&origin=*", { headers: rawHeaders(apiUrl) })`（与卡池侧同一条直连通道）→ `parseArknightsSmwEvents(json, tz)` → `prtsEventPayload(items, tz, now)`。
`eventUrl` 就是上面那条 `action=ask` 的 URL（`ARKNIGHTS_SMW_URL`，由 `ARKNIGHTS_SMW_QUERY` 编码而来）。

**退化路径**（三条，语义各不相同，别混成一种）：

| 情形 | 行为 |
|---|---|
| 空结果（`query.results` 是空对象） | 载荷 `null`（未公布），**不**硬凑过期档期 |
| 响应带 `query-continue-offset`（分页游标） | **不追页**：前 30 条按开始时间倒序已覆盖近一年；一次刷新始终只有 **1 条**请求（请求数断言见 `cases-arknights-claim.mjs` ②） |
| 请求失败 / 响应不是 JSON / 没有 `query.results` | **抛错**（这一侧记 down、面板显示「活动失败」）。**没有**"SMW 失败就回退解析活动一览 HTML"的自动路径：失败就是失败，绝不换站 —— 要用一览口径请在设置页把「活动来源」手动切成 `PRTS 活动一览`（备选源，见「来源策略」一节） |


**三态**（只改 arknights 的 payload 与提示框里的那几行，即 `30-game-hypergryph.js` 的 `prtsHoverNoteOf` / `prtsEventPayload`、`81-schedule-model.js` 的 `scheduleHoverNote` / `scheduleHoverText`、`82-schedule-view.js` 的 `hoverTextOf`；探头的解析逻辑 `scheduleHoverItems` 一个字没动）：

| 时刻 | 外显 `eventDates` | 独立提示字段 `eventHoverExtra`（只进提示框，插在该活动那一行**之后**） |
|---|---|---|
| now ≤ 活动结束（活动期） | `活动开始 ~ 活动结束`（与改造前逐字相同） | `<活动标签> 兑换截止   MM-DD HH:mm`（有兑换期时） |
| 活动结束 < now ≤ 兑换结束（兑换期） | `活动结束 ~ 兑换结束`（外显「还剩 X」因此指向兑换截止） | **不写这个键**（该活动的主行本身就是兑换区间，见下） |
| 没有「兑换结束时间」字段（或与活动结束同值） | 与改造前完全一致 | 不写这个键（不补猜 7 天） |

- 兑换期内的活动**仍然出现**（改造前会整条消失 —— 那正是奖励没领的时候）。
- **奖励领取期的候选在外显挑选中排最前**（`pickEventPrimary` 的第一个排序键，压过类别档位；见 2026-11-07 真机 bug：一条还剩 15 天的「支线故事」把兑换期只剩 3 天的活动挤出面板与「近期」）。判定只看 `phase === "claim"` —— 该字段只有本来源的两阶段候选会设置，其它游戏没有 ⇒ 行为不变；悬停排序 `sortEventItems`（结束时间升序全量）**不动**。
- **分类前缀去重**（`labelOf(cat, name)`，纯函数）：活动名本身可能已经带分类前缀（PRTS 的 `视相博物馆：演化`）⇒ 不再拼成 `视相博物馆：视相博物馆：演化`。规则：`name` 以 `<cat>：` / `<cat>:` / `<cat> ` 开头、或与 `cat` 完全一致 ⇒ 原样返回 `name`，否则 `<cat>：<name>`，没有 `cat` ⇒ `name`（前缀比较大小写不敏感，幂等）。SMW 给的 `name` 是**页名**（不带分类前缀）⇒ 悬停行、payload 的 `event`、`eventShow`、提示行锚点**全部**走它 ⇒ 面板显示的那一串与提示框里出现的**同一串**。
- 兑换期那一行的**事项名**（表格格子 / 「近期」/ 留白卡读的 `scheduleNormalize.show`）显示为 `<去重后的活动名> 兑换截止`（中间是**一个空格**，如 `视相博物馆：演化 兑换截止`）：payload 因此多带一个**只给显示**的 `eventShow`（只在兑换期出现，活动期没有这个键；随 `lastData` 持久化，`EVENT_FIELDS` / `CONTENT_FIELDS` 都已登记），`scheduleNormalize` 活动侧改成 `show = g.eventShow || title`。悬停里那条主行也用**同一串**（`prtsEventPayload` 的 `hoverActive`：兑换期的候选把 `name` 改成 `<活动标签> 兑换截止` 再交给 `buildEventHover`），所以它贡献的**只有一行**且就是兑换区间；`event` 一字不动（提醒标题、侧栏轮播、搜索匹配仍读 `event`），类型格仍是「活动」。
- **悬停里同一个区间只出现一次**（2026-11-07 真机 bug）：① 兑换期那条活动**不再生成提示行**（主行已经是兑换区间，再补一行就是逐字重复）；② 活动侧（`hoverTextOf` 表格格子 / `scheduleHoverText`「近期」行）**不再追加** `title ⏎ rawSrc` —— `eventHover` 已经是"每个活动一行"的完整信息，只有 `eventHover` 为空（当期只有 1 条活动）时才用 `title + 原文` 兜底；卡池侧维持原行为（悬停原文里没有这条池名时才补）。`scheduleHoverOnes` 同步跳过与外显事项名（`show`）同名的那条，兑换期的主行不会在探头里重复出现一条。
- 提示行走**独立提示字段 `eventHoverExtra`**（只进提示框，不进探头）：`eventHover` 仍**只由共用 `buildEventHover` 产出**（活动期的行与改造前逐字一致；兑换期那一行带「兑换截止」，见上一条）。`eventHoverExtra` 每两条一组（① 该活动的**标签** ② 提示行本身），`hoverTextOf`（表格格子）/ `scheduleHoverText`（「近期」行）都调 `scheduleHoverNote`，由它按标签把提示行**插在该活动那一行之后**（不再统一堆到末尾 —— 那样看不出是哪个活动的兑换截止）。不这么分开的话，表格格子会把 `eventHover` 解析成并列条目，`兑换截止` 那行就会变成格子里的一行**可见文字**（2026-11-06 真机 bug）。没有兑换期时**不写这个键**。
- 提示行与该活动自己那行**同一排版**：`名称` + **3 个空格** + `内容`；**不再写**「活动已于 … 结束，当前为奖励领取期（…）」这类解释句（2026-11-06 用户要求删掉）。
- `eventHoverExtra` 随 `lastData` 持久化（`50-refresh.js` 的 `EVENT_FIELDS` 与 `engine-head.js` 的 `CONTENT_FIELDS` 都已登记；活动列沿用旧值时 `mergeEntryRecord` 也一起沿回，否则刷新失败一次提示框就少一行）。
- 兑换期的 `eventDatesRaw` 用**同一份兑换区间**（日期格的 tooltip 与格子显示的区间不能互相打脸）；活动真正的起止仍完整写在 `eventHover` 的说明里。
- 因此**「活动期」的输出与改造前逐字节一致**（`test/cases-arknights-claim.mjs` ③用整段悬停做回归基线，④是「提示行不进 `eventHover`」的真机 bug 回归）。
- **两个 deadline 各自提醒**（2026-11-06）：`eventDates` 只负责**显示**（三态表，语义没变）；提醒侧要的是两条独立 deadline，所以活动期就额外带一个**只给提醒用**的 `eventClaimDates`（有兑换期才有，形如 `11-07 03:59 ~ 11-10 03:59`，没有就不写这个键）。`remindItemsOf` 据此在活动侧**多派生一条** `kind:"end"` 条目：key 的 side 段是 `event-claim`、`sideLabel = "奖励领取"`、`side` 仍是 `event`（不新增 `REMIND_SIDES`），与「活动结束」那条各按自己的 T 走 72/24/6/2 档位、去重状态也各自独立 ⇒ **只要刷新过一次拿到两个窗口，之后中途不再刷新，两个 deadline 也都会按时响**。两个 T 相同（刷新时已在兑换期，`eventDates` 本身就是兑换区间）⇒ 去重只留一条。该字段随 `lastData` 持久化（`50-refresh.js` 的 `EVENT_FIELDS` 与 `engine-head.js` 的 `CONTENT_FIELDS` 都已登记；否则序列化时会被过滤掉）。
- 奖励领取那条的通知文案与「活动结束」区分：事项行是 `奖励领取「<活动名>」`、正文时间段那行以 `奖励领取截止` 结尾（标题仍是「即将结束」）；其它侧的文案一个字没改。
- 夹具 `test/fixtures/arknights-smw-events/` 是**真实 SMW 响应**：本机出口对 `prts.wiki` 直连返回 403（Tengine，浏览器与 curl 一致），抓取经宿主侧 `web_fetch` 通道完成，正文按 JSON 语义**逐字**保存（`printouts` / `timestamp` / `raw` / `fulltext` / `fullurl` 全是源站原样）。为钉住逐字基线，只保留了 2026-11-07 那三条活动（视相博物馆：演化 / 感谢庆典2026限时签到 / 时间啊，向前！）的 `results`，并省略了真实响应里的 `query-continue-offset` 与 `query.meta`（解析器不许依赖它们，见上表"退化路径"）。它登记在 `test/map.json`，`cases-arknights-claim.mjs` 与 `cases-arknights-timeline.mjs` 都用**这一份**（不再有 overrides）。

### 明日方舟时间轴不变量（新增字段/阶段时先看这里）

**为什么有这一节**：2026-11-01 ~ 11-07 这一周里这套两阶段被连着改了 5 次，毛病全是"**时间走过去之后**才暴露"的（进兑换期整条消失、分类前缀拼两遍、提示框同一区间出现两遍、急的兑换期被不急的活动挤掉）。所以护栏不是"几个点"，而是**沿整条活动周期逐时刻跑完整链路**：`test/cases-arknights-timeline.mjs`（门禁第 15 段）用真机 2026-11-07 那三条活动的夹具，对下表每个时刻都跑 `EVENT_FETCHERS["arknights"]` → payload → `scheduleNormalize` → 悬停（表格格子 + 「近期」行两条路径）→ `remindItemsOf`/`remindTickOf` → `createEngine().getCached()`。

| 时刻（+08） | 断言要点 |
|---|---|
| 2026-10-23 16:00（开始前 1 天） | 三条都还没开 ⇒ 载荷 `null`，连半截字段都没有 |
| 2026-10-24 17:00（开场后 1 小时） | 活动期：无 `eventShow`，`eventDates` = 活动区间；单条活动 ⇒ 悬停走兜底两行式 |
| 2026-11-06 21:59（活动结束前 6 小时） | 三条都在活动期；外显按类别档位仍是「支线故事：时间啊，向前！」 |
| 2026-11-07 04:00（活动结束后 1 分钟） | 兑换期：外显切到视相，`eventShow` =「视相博物馆：演化 兑换截止」，`eventDates` = 兑换区间 |
| 2026-11-08 12:00（兑换期中间） | 同上（兑换期三态一致，不会"过一天又变一个样"） |
| 2026-11-10 02:59（兑换结束前 1 小时） | 同上（最后一个还能领的时刻） |
| 2026-11-10 04:59（兑换结束后 1 小时） | 视相**整条消失**（事件名、悬停、提示行里都不许再出现），只剩别的活动 |
| 2026-11-30 12:00（整周期结束） | 载荷 `null`；一次刷新仍然只有 1 条请求（SMW 单请求，没有"第二次批量请求"可省） |
| 2026-11-25 12:00（**兑换期第 4 天**） | 兑换期可以**长于 3 天**（「时间啊，向前！」= 11-22 03:59 ~ 11-29 03:59，共 7 天）⇒ 第 4 天照样有外显、`eventShow` =「支线故事：时间啊，向前！ 兑换截止」 |
| 2026-11-29 02:59（兑换期第 7 天，最后一个还能领的时刻） | 同上；**不许**在兑换期中途提前消失 |
| 跨年（12-30 开始 / 次年 01-05 结束，payload 纯函数） | `fmtWindow` 两端带年份；次年字段按 `tz` 解析不错年；兑换窗口自己跨年时 `eventClaimDates` 两端带年份 |
| 无「兑换结束时间」字段（夹具里那条登录活动） | 载荷键集合 = 改造前那四个（`event/eventDates/eventDatesRaw/eventHover`），**不多** `eventShow`/`eventClaimDates`/`eventHoverExtra` |
| 空结果（`query.results` 空对象） | 载荷 `null`（未公布）；抓取器不抛，仍然只发 1 条请求 |
| 请求失败（HTTP 503）/ 坏响应（没有 `query.results`） | **抛错**（`http-503` / `smw-bad-json`），不返回半截载荷；**没有**「自动回退解析一览 HTML」的路径（备选源只能手动切） |

每个时刻都查的六条不变量（改动前先确认这六条还成立）：

1. **悬停文本**：任意一行不重复、相邻两行不相同、不出现「名称单独一行 ⏎ 只有区间」的两行形态。谓词与断言在 `test/lib-text.mjs` 的 `assertHoverTextInvariants` —— 与 `cases-arknights-claim.mjs` ⑥ 共用**同一份实现**，不许再写第二份。⚠️ 当期只有 1 条活动时 `buildEventHover` 按契约返回空串、UI 退回默认两行式「名称 ⏎ 档期」，那是**合法兜底**（判据自动切成"纯档期行 ≤ 1 条"），不是 bug。
2. **阶段**：活动期没有 `eventShow`、`eventDates` = 活动区间；兑换期 `eventShow` = `<去重后的活动名> 兑换截止`、`eventDates` = 兑换区间；结束后该活动不再作为外显（悬停/提示行也不许再提）。
3. **名称不重复**：`event` / `eventShow` / 悬停行标签 / 提示行锚点都不许带两层分类前缀。两条判据一起用：`labelOf(cat, label) === label`（幂等）+ `doubledCatPrefixOf`（真的没拼第二下）—— 只靠幂等**抓不到**"多加了一层"（`labelOf` 对已带前缀的串是原样返回的）。
4. **提醒**：`remindItemsOf` + `remindTickOf` 在「活动结束前 72h」与「兑换截止前 72h」各发一次、key 不同（`arknights|event|end|…` vs `arknights|event-claim|end|…`），且**同一份 `lastData` 不刷新**也各发一次；兑换期载荷两个 T 相同 ⇒ 去重只留一条。
5. **不崩**：任何时刻抓取器都不抛；退化路径返回**改造前**那个数据形状（键集合逐一比对，不是"看着差不多"）。
6. **持久化**：载荷喂给 `createEngine().getCached()` 后，现有 4 个字符串字段 + 两阶段新增 3 个字段（`eventClaimDates` / `eventShow` / `eventHoverExtra`）一个不丢；活动列沿用旧值时这三者也一起沿回；没有兑换期的来源归一成空串（形状固定）。

**加新东西时改哪里**（照抄这段就够）：

- **payload 新增字段**（如以后的多活动数组 `events`、或第三种阶段）⇒ 四处同步：`src/client/50-refresh.js` 的 `EVENT_FIELDS`、`src/client/engine-head.js` 的 `CONTENT_FIELDS`（产物见 `packages/core/core.mjs`）、本节、**以及 `cases-arknights-timeline.mjs` 的 `PERSIST_BASE` / `PERSIST_NEW` 清单**（少了它测试不会红，只会悄悄少一个字段）。该文件 §五 会把清单里每个字段各喂一个互不相同的值走一遍真引擎归一 —— 白名单漏登记一个就必红。
- **时间轴上新增一种边界**（例如"开始前 2 小时"、更长的兑换期）⇒ 往该文件的 `MOMENTS` 数据表加一行（纯 payload 的边界，如跨年，加进 §二/§三 那几段小表），**不要**在下面写新的 `if` 分支；每行只描述"这一刻该看到什么"。
- **悬停排版变了** ⇒ 改 `test/lib-text.mjs` 的 `assertHoverTextInvariants` 与 `test/harness.mjs` 的 `assertHoverConvention`，两个用例文件都不用动。
- **别的来源也要两阶段** ⇒ 不要往 arknights 的用例里塞它的夹具；各来源自己的 `cases-*.mjs` 承担，但悬停结构判定继续调 `test/lib-text.mjs`。

**曾经的已知缺口（默认来源已随 SMW 改造消失；备选源 `PRTS 活动一览` 仍有）**：批量取 wikitext 时代的候选筛选是「一览结束 ≥ now−3 天」（`PRTS_CLAIM_LOOKBACK_MS`），而兑换期可以**长于 3 天**（真机「时间啊，向前！」= 11-22 03:59 结束、11-29 03:59 兑换截止 = 7 天）⇒ **兑换期第 4 天起**该活动不再进入候选、载荷变 `null`、面板上整条消失。默认的 SMW 口径**没有"候选筛选"这一步**（四列一次查全）⇒ 这个缺口在默认路径上不存在，`cases-arknights-timeline.mjs` 的 `M9`/`M10` 两个时刻就是这条的回归（兑换期第 4 天 / 第 7 天都必须还在）；**手动切到备选源时该缺口仍在**（那是备选链路的已知代价，不是 bug）。

### 来源策略：无自动兜底（2026-11-07）

**规则（用户拍板）**：一个**默认源**只抓它自己声明的那一个站点。主源失败 / 没数据时，**绝不在抓取器内部转身去抓第二个站点**；要看另一个站点的口径，由用户在设置页把来源切到对应**备选源**（`altSources` / `eventAltSources`）。理由：抓到的数据"来自哪个站"必须是用户选的那个 —— 悄悄换站会让面板显示一个用户没选过的来源，出错时也无从判断该关掉哪一边。

两种结局，**不许混**：

| 情形 | 返回 | 后果 |
|---|---|---|
| 主源**失败**（网络错 / 非 200 / 代理拒绝）或**结构异常**（接口改版） | **抛错** | 该侧记「失败」、沿用上次成功数据、来源健康里看得到原因 |
| 主源**结构正常但没有当期内容** | **`null`** | 该侧如实显示「新卡池未公布 / 活动未公布」 |

> 结构异常必须**抛**而不是 `null`：`null` 会把"源站改版"伪装成"官方还没公布"，面板上看不出问题（历史上终末地就这样静默失灵过）。各抓取器的哨兵错误名带 `-no-section` / `-no-dates` 后缀，`normErr` 会翻成「页面结构变了（解析出 0 条）」。

**已摘掉的 5 处**（全部是「默认源内部换站点」）：

| 默认源（fetcher） | 摘掉的行为 | 现在怎么拿备选口径 |
|---|---|---|
| 明日方舟 卡池 `fetchArknightsGacha` | 官方 CMS 无当期/失败 → PRTS 卡池一览 | 设置页切「PRTS 卡池一览」（`arknights-prts`） |
| 蔚蓝档案·日服 卡池 `fetchBaJpGacha` | 官网新闻 → GameKee 当期卡池 | 切「GameKee 当期卡池」（`ba-jp-gamekee`） |
| 绝区零 卡池 `fetchZzzGacha` | 官方公告 → Bwiki 往期调频 | 切「Bwiki 往期调频」（`zzz-bwiki`） |
| 鸣潮 卡池 `fetchWuwaGacha` | 官方公告 → Bwiki 角色轮换池 | 切「Bwiki 角色轮换池」（`wuwa-bwiki`） |
| 重返未来 1999 卡池 `fetchR99` | 游戏内公告（noticecp）→ 官网公告解析 | 切「官网公告+小米」（`r1999-official`） |

**保留的是"同源容错"（同一站点内的退化，不是换站）**，别一起删：

- 鸣潮 `fetchWuwaGacha`：`zh-Hans.json` 读不到 → **同目录**的 `notice.json`；`contentUrl` 缺省 → 由 entrypoint 的 URL 推导目录。
- 明日方舟 `fetchArknightsOfficialPools`：列表拿到后逐池取详情，**单个详情失败保留 brief 里解析到的角色**。
- 各源"同一页面换解析器 / 同一表多形态"（如 `parseArknights` 的标准 + 中坚 + 限时表、`parseBaJpNews` 的三种公告形态）都不受影响。
- 自定义来源（用户在设置里填的 URL）：`fetchR99` 对**非 noticecp** 地址走官网解析器 —— 那是用户明确填的地址，不是自动换站。

**备选源内部若确实要读第二个站点**（目前只有 `r1999-official` = 「官网公告+小米」）：备选源的 `label` 必须把这件事写出来（用户在设置页看到的就是这个 label），不能让它听起来只碰一个站点。

**活动侧的两个来源（明日方舟，2026-11-07 用户定名：「原来的还叫一览只是降级备选 新的SMW才叫解析」）**：

| 角色 | 来源名（= 设置页「活动来源」下拉里逐字显示的 label） | 实现 | 一次刷新请求数 | 抓取器键 |
|---|---|---|---|---|
| **默认** | **`PRTS 活动解析`**（`eventSource`） | PRTS SemanticMediaWiki：`action=ask` 一次取回「活动类型 / 开始 / 活动结束 / 兑换结束」四列（`fetchArknightsEvents`） | 1 | `EVENT_FETCHERS["arknights"].default` |
| **备选** | **`PRTS 活动一览`**（`eventAltSources[0].label`） | 旧的活动一览 HTML 解析（`collectPrtsEvents`）+ **一次**批量 wikitext 取 `{{活动信息}}` 的兑换结束时间（`fetchArknightsEventList`），从 `8de869d` 恢复 | 2 | `arknights-event-list` |

- **没有自动切换**（两个方向都没有）：默认源失败就**抛错**（这一侧记 down、沿用上次成功数据），绝不转身去抓一览；选了备选源时也不会回头试 SMW。要另一条口径，只能由用户在设置页把「活动来源」手动切过去；选择写进既有键 `customEventUrls`（与卡池来源 `customUrls` 同一套机制，没有新增键）。
- 两条链路都归一到**同一份三态载荷**（`prtsEventPayload` 的可选第 4 参 `pageTimes` 只由一览那条传，SMW 那条不传）：同一时刻、同一批活动，两条来源产出的 `event / eventDates / eventDatesRaw / eventHover / eventHoverExtra / eventClaimDates / eventShow` **逐字相同**（`cases-arknights-claim.mjs` ⑦ 的两条断言），下游显示 / 提醒 / 持久化都不看来源。
- 一览那条仍带批量时代的候选筛选（`PRTS_CLAIM_LOOKBACK_MS` = 3 天）：兑换期**长于 3 天**时第 4 天起该活动会从一览口径消失（默认 SMW 口径没有这一步，见上面「曾经的已知缺口」）。这是选备选源的已知代价，不是 bug。

**护栏**：`test/cases-sources.mjs`（门禁最后一段）。它对上面 5 个默认源各跑「主源失败」与「主源无当期」两种场景，断言 `calls` 里**没有任何一条请求落在第二个站点**（代理调用会先解出 `url=` 参数再记账），并故意给第二个站点路由一份**能解析出当期池**的响应 —— 只断言"结果为 null"挡不住回归，"换站成功"恰恰会返回有数据的对象。同时它验证手动切源（`GACHA_FETCHERS[alt.fetcher]`）仍能取到数据。活动侧的同款断言在 `test/cases-arknights-claim.mjs` ⑦（SMW 失败 ⇒ `calls` 里没有一览请求，备选侧同样给了能解析出数据的夹具）。

**加新来源时**：默认源失败就抛错，别写"再试另一个站"；要多个站点就给 `altSources` 加一条（`label` 写清它是什么站），并记得 `GACHA_FETCHERS` / `EVENT_FETCHERS` 登记（`test/all.mjs` 的聚合守卫会核对）。

### ⏸ 高危主机：dsh-app 源下可能被 CORS 拦（**暂时搁置**，2026-11-07 记录）

DSH 渲染进程的页面源是 `dsh-app://app`（自定义 scheme）。**有些站点不回 `Access-Control-Allow-Origin`**，
直连会被浏览器拦掉，症状是抓取被归为「网络不通」（时好时坏）。

已修：`wiki.biligame.com` / `*.biligame.com` ⇒ `transportFetchRaw` 强制走宿主代理（见上一节）。

**仍走直连、有同类风险（本次不修，先记档）**：

| 主机 | 用在哪 | 现状 / 风险 |
|---|---|---|
| `prts.wiki` | 明日方舟卡池备选、活动（SMW + 一览备选） | 目前正常（prts 会回 `ACAO: *`）；`origin=*` 仍由 8 处调用点各自手拼，未进收口点 |
| `gachatracker.app` | 终末地卡池备选 | 未验 |
| `gametora.com` | 赛马娘国际服卡池 | 目前正常（真机在跑） |
| `sekai-world.github.io` | 初音未来缤纷舞台卡池/活动 | 目前正常 |
| `gh-proxy.com` | 初音未来缤纷舞台默认源（第三方镜像） | ACAO 未知，镜像服务可能随时变 |
| `bang-dream-on.bushimo.jp` | BanG Dream! OurNotes | ACAO 是**回显 Origin**（不是 `*`）⇒ 对 `dsh-app://` 有风险 |
| `api.umapyoi.net` | 赛马娘 | 未验 |
| 用户自定义地址 | 设置页可填任意 URL | 目标站若不回 ACAO ⇒ 同样「网络不通」 |

处理方向（将来一次做完，不要逐个打补丁）：把这套判定做成**主机表**（`需要代理的 MediaWiki / 拒发 ACAO 的主机`），
在 `transportFetchRaw` 同一个收口点按表改道代理；并把 `origin=*` 也统一由收口点补（现在 prts 是 8 处手拼）。
另注意：改道代理后必须同步 `PROXY_ALLOW_HOSTS`（`src/index.js` 的白名单），否则会 403 `host-not-allowed`。
### 时区约定（显示 vs 源站原文）

两条口径，**别混**：

- **显示（倒计时 / 外显 / 换算后的时间）** = **用户本机时区**。入口是 `81-schedule-model.js` 的 `localWin` / `localWinText` / `localDatesOf`；它们调 `fmtWindow(ts)` **不传 tz**（= 本机时区）是**故意的**。
- **源站墙钟原文**（`bannerDatesRaw` / `eventDatesRaw` / 悬停 / 解析器产出的 `bannerDates`、`eventDates`）= **源站时区**（`SOURCES[].tz`）。凡是从 epoch 秒/毫秒生成这类文本，**必须**把 tz 传进去。

为什么抠这一条：2026-11-07 用户实测 `range2`（PRTS 一览）—— 起点取源站文本列、终点取 `data-time` 的 Unix 秒，旧代码终点用 `new Date(ts)`（**本机时区**）取字段 ⇒ `TZ=UTC` 机器上明日方舟活动区间 `11-15 03:59` 显示成 `11-14 19:59`（早 8 小时）。+08 机器上源站时区恰好等于本机，本地永远看不出来。

**护栏三条**：

1. **源码侧**：`test/cases-rule-lint.mjs` 静态扫描 `fmtWindow` / `fmtMdHm` / `fmtYmdHm` / `range2` 的每个调用点，必须带 `tz`；只有 4 处白名单（2 处显示层 + 2 处本机墙钟同源解析，源码注释逐条写了原因）。
2. **行为侧**：`test/cases-tz.mjs` ⑦ 对**两个游戏**（明日方舟 PRTS 一览 / 重返未来 1999 并列征集池）断言 `*Raw` 的**字面量**。期望值是写死的字符串、不是用当前进程 `Date` 现算 —— 门禁在 `TZ=UTC` 与 `TZ=Asia/Shanghai` 下各跑一遍，两边都过才叫"跨时区逐字相同"（外加 `cases-arknights-timeline.mjs` 的 `eventDatesRaw` 字面量断言）。
3. **API 侧**：`range2` 漏传 tz **直接抛错**（不再静默退回本机时区）；`fmtWindow` 的"无 tz = 本机"只允许显示层用（`24-parser-window.js` 的注释）。

> 唯一例外（已核实、本轮不改）：`30-game-bluearchive.js` 的两处 `fmtWindow(ts)`。它们的 ts 是 `new Date(y, mo-1, …)`（本机墙钟）**合成**的，解析与渲染同口径 ⇒ 文本在两种机器上都 roundtrip 成源站原文；真正的缺陷在**解析方向**（绝对时刻随机器变），只改渲染一侧反而会让文本偏 8 小时。

### 数据层数组（P1）/ 派生层（P2）/ 解析器直出（P3，2026-11-07）

**方向**（用户原话）：数据核心只放"事实"；"谁排第一"是**纯展示决策**，下移到显示层；表格与探头**共用同一份数组**（探头只是会动的 UI 组件，零数据语义）；面板对用户的行为保持等效。

**P1（数据层，已完成）**：**不动任何解析器**，在数据流入 `lastData` 前的那一层（`50-refresh.js` 的 `mergeEntryRecord`）从**现有字符串字段合成**两个数组；旧字符串字段一个都不删、值一字不改。数组顺序 = 结束时间升序（与悬停同口径），**不挑选"第一条"**。

**P2（派生层，已完成）**：显示层改读这两个数组 —— 表格那一行 = `sideViewOf(...).primary`、探头 = `.rest`，两处共用同一份数组；**不再解析悬停文本**（悬停 tooltip 仍读 `bannerHover` / `eventHover`，那是 P3 的事）。派生规则与兼容退化见下面「派生层（P2）」一节。

**P2 收尾（2026-11-07，方案 C「补事实、不藏差异」）**：数据层补了 `source` / `cat` / `tags` / `preview` 四个事实字段，判重改为"引擎主行 + 悬停并列行各一条"；显示层加了**按游戏分派的规则表**；FGO 解析器额外给一份 `itemFacts`（类别通道）。结果是 34 个侧与改造前**逐字相等**（已知差异清零）。

**P3 第一批（2026-11-07，已完成）**：方向倒过来了 —— **解析器直接产数组**（真源），悬停字符串改由**同一份条目**反生成（不再手拼、也不再从文本反解数组）。本批只切 **3 款 6 条路径**（原神卡池+活动 / 明日方舟卡池+活动 / 鸣潮卡池+活动），其余 25 款仍走 P1 的合成路径（见下面「解析器直出（P3）」与「P3b 待办清单」）。

#### 字段形状（每个游戏都有）

```js
gacha:  [{ key, title, show, roles: string[], startTs, endTs, tz, raw, source,
           cat?, tags?, preview?, longTerm? }]
events: [{ key, title, show, startTs, endTs, tz, raw, source,
           cat?, tags?, preview?, phase?: { kind: "claim", startTs, endTs, show } }]
```

| 字段 | 含义 |
|---|---|
| `title` | **数据名** = 源站原文名（卡池名 / 活动名） |
| `show` | **显示名** = 外显时真正显示的那串（卡池侧 = `cleanRoleNames(roles)`，活动侧 = `eventShow`） |
| `key` | `<gameId>:gacha:<index>` / `<gameId>:event:<index>`（index = **排序后的位置** ⇒ 跨刷新稳定） |
| `roles` | `string[]`，**原始**角色名（不做去修饰 —— 那是显示名的事）；并列池那条为空数组 |
| `startTs` / `endTs` | 毫秒；读不出档期 ⇒ `null`（不硬凑）。**P1 的口径 = 本机时刻**（`parseDisplayRange` 按运行环境时区解释源站墙钟）—— 见下面"已知不等价" |
| `tz` | 条目声明的源站时区（让下游知道那串时间按哪个墙钟读） |
| `raw` | 源站原文（`bannerDatesRaw` / `eventDatesRaw`；并列池那条 = 悬停里那行档期） |
| `source` | **这条是谁**（P2 收尾新增，恒有）：`"primary"` = 引擎给的外显那条；`"hover"` = 从悬停文本解析出的并列条目。旧探头**两者都显示** ⇒ 数组也两者都留，用 `source` 区分（不再按「同池」并掉，见下） |
| `cat` / `tags` | **类别事实**（可缺）：解析器知道类别时经 `itemFacts` 通道带进来（目前只有 FGO 活动表第 4 列的 `Event` / `Campaign` 填 `cat`）；**取不到就没有这个键**（不猜、不写空值）。`tags` 目前没有来源提供（字段与归一已就位，留给后续结构化来源） |
| `preview` | **预告稿标记**（可缺）：标题命中 `/予告|coming soon/i` 时为 `true`（与赛马娘老实现 `previewRank` 同一判据，见 `30-game-cygames.js:392`） |
| `phase` | 活动的**第二阶段**（明日方舟「奖励领取/兑换截止」）：只有来源给了 `eventClaimDates` 才有这个键。它是**一条独立的截止窗口**，不是第二个活动条目 |
| `longTerm` | P1 **不合成**（可选字段，留给结构化来源；归一函数会原样透传） |

**顺序 = 自然顺序（结束时间升序，与现有悬停一致），数据层不挑选"第一条"。** 外显哪一条由**显示层**决定（P2 起是 `sideViewOf`，见下）；`test/cases-core.mjs` ④-4 用赛马娘国服夹具钉住反证：外显那条（10-07 结束）在数组里排第 3，第 1 条是结束最早的「第1轮」。

#### 谁生成（`src/client/50-refresh.js`）

- `mergeEntryRecord(r, prevRec, nowTs, meta)` 末尾两行：来源若已给结构化数组就原样用（**P3 第一批起 3 款 6 条路径由解析器直出**，见下节），否则 `dataArrayGachaOf` / `dataArrayEventsOf` 合成。`meta = { id, tz }` 由 `engine-api.js` 的 `refresh()` 从条目上带进来（只用来生成 key 与 `tz` 字段）。
- **并列池怎么展开**（P2 收尾改了判重口径）：复用**显示层同一个** `scheduleHoverItems`（`bannerHover`/`eventHover` 的多行文本 → `[{ title, win }]`），再用 `dataArrayHoverPoolsOf` 里那三条判据（与外显同名 / 与**显示名**同名 / 「池名：外显名」这种整段包裹写法）—— 与 `81-schedule-model.js` 的 `scheduleHoverOnes` **逐字对应**。
  - ⚠️ **判重口径（2026-11-07 用户定，方案 C）**：不再按「起止时间 + 池名」把同一口池并成一条 —— 那是 P1 自己发明的判据，旧探头从来没有，它一直把「合并角色的主行」和「`池名：角色`」并列显示（物华弥新「繁霜春落：李小孩项链」、星铁「「我身即刃」…：千冶•刃」就是这么被丢掉的）。现在**引擎主行一条 + 悬停并列行各一条**，`source` 区分；只有"内容完全一样"（同标题 **且** 同起止）才去掉一条，并且**优先保留 `source:"primary"`** 那条。
  - ⚠️ `scheduleHoverItems` + 它的两条区间正则 + `scheduleNoYear` 已在 2026-11-07 **从 81 搬进 26-parser-hover.js**（逐字搬迁）：`50-refresh.js` 也在 core 产物里（`CORE_ORDER`），而 81 只属于渲染层。不搬就会变成"core 里调用一个不存在的函数"。
  - 两条区间正则的**起端也认「X.Y版本更新后」**（不是只有两端日期）：星铁 bwiki 把这种原文直接写进悬停（`「巡星之礼」第二十七期   4.6版本更新后 ~ 11-11 03:59`），不认就会把档期拼进**事件标题**。普查结论：其它 27 款的「版本更新后」已在各自解析器里折算成绝对时刻、悬停原文不含版本标签 ⇒ 只影响星铁（`test/cases-core.mjs` ④-9 有针对性断言）。注意这只影响**悬停逆解析**，`fillMissingStarts` / 「版本更新后」的换算一个字没动。
  - 解析不出并列池（`bannerHover` 为空 / 只有 1 条）⇒ 就 1 条，与今天显示等价。
- **归一**：`dataArray*ItemOf` 只做最少校验 —— 非对象元素**丢弃**、`startTs`/`endTs` **必须是 number 否则 `null`**（`"123"` / `NaN` / `Infinity` 全变 `null`）、文本字段缺了填空串、`roles` 不是数组就 `[]`、`source` 缺了填空串。**可选事实**（`cat` / `tags` / `preview`）**有就原样保留、没有就不写这个键**（`preview` 只认 `true`，`tags` 空数组/`cat` 空串都不产生键）⇒ `getCached()` 往返后事实不丢、也不会多出空值。缺数组（改造前的老缓存）⇒ **空数组**，形状固定。

#### 持久化白名单（六处点名的地方，漏一处就静默丢字段）

| # | 位置 | P1 的处理 |
|---|---|---|
| ① | `50-refresh.js` 的 `GACHA_FIELDS` | 加 `"gacha"`（否则解析器将来直出的结构化数组会被 `pickFields` 削掉）+ `"itemFacts"`（类别事实通道，见下） |
| ② | `50-refresh.js` 的 `EVENT_FIELDS` | 加 `"events"`（同上）+ `"itemFacts"`（FGO 活动表用它带 `Event`/`Campaign`） |
| ③ | `engine-head.js` 的 `CONTENT_FIELDS` / `normalizeRecord` | `CONTENT_FIELDS` **只收字符串**（数组会被削成空串）⇒ 在 `normalizeRecord` 里加了**单独的数组分支**（`dataArrayGachaListOf` / `dataArrayEventListOf`） |
| ④ | `83-panel-shell.js` 的渲染层逐字段拷贝 | 加 `gacha` / `events`（这一层是"抓取结果 → 渲染用条目"的显式拷贝；漏了 P2 只会看到"数组永远为空"） |
| ⑤ | `engine-head.js` 的 `listGames().defaults` | 登记 `gacha: []` / `events: []`（条目的出厂值里没有池/活动 ⇒ 恒空；登记是为了形状成套） |
| ⑥ | `60-helpers.js` 的 `customEntries` 白名单 | **刻意不登记**：那张表重建的是**条目定义**（抓什么 / 按哪个时区读），数组是**抓取结果**（住在 `lastData` 里，按 id 索引）。`84-settings-page.js` 的写入点枚举过：没有"把抓取结果写进 customEntries"的路径。 |

#### 回归（`test/cases-core.mjs` ④，65 条）

真实夹具四条线：**原神**（米游社；卡池侧正文无日期 ⇒ `gacha = []`，活动侧 1 条）、**明日方舟**（PRTS；`events` 3 条 + `phase`，悬停里那条「墟 兑换截止」不另算一条）、**FGO**（并列卡池真的展开成 4 条）、**赛马娘国服**（"数组第 1 条不是外显那条"的反证）。另守：12 个旧字符串字段与改造前（HEAD 39d41a5）**逐字相同**、`getCached()` 往返数组仍在（含 `phase` / 事实字段）、归一的最少校验、以及上面六处白名单的静态断言。

2026-11-07 再加一段**星铁真机**（夹具 `p4-hsr-bwiki-{warp,events}-1107`，按线上页面结构裁剪）：② `roles`/`show` 里同一角色不再出现两次（判重键 = 去掉括号属性后的角色名，载荷级、只在星铁开启）；③ `gacha` = **5 条**（引擎主行 1 + 悬停并列行 4，`source` 区分；同一口池的那两行都在，内容完全相同的行才去重且优先保 primary）；④ 事件标题不再被拼上档期（`「巡星之礼」第二十七期   4.6版本更新后 ~ 11-11 03:59` ⇒ 标题只有前半）。另有一条"只有星铁会产出带版本标签的悬停档期"的普查断言，以及 FGO / BanG Dream / 绝区零三家 `gacha` 数组**整段 JSON 逐字不变**（`startTs`/`endTs` 只比类型，理由见已知不等价①；`source` 是新增的必填事实，已写进 golden）。

#### 派生层（P2）：`sideViewOf` / `scheduleItemOf` / `scheduleCellOf`

三个函数都在 **`src/client/81-schedule-model.js`**（渲染层段，不出 core），由 `44-test-exports.js` 导出：

| 函数 | 做什么 | 规则来源 |
|---|---|---|
| `sideViewOf(items, now, side, gameId?)` | 数组 → `{ primary, rest }`（`primary` = 这一格外显的那条，`rest` = 其余、**保持数组原顺序**；数组空 ⇒ `primary = null`） | 第 4 个参数命中**按游戏分派表**（见下）⇒ 走特化规则；**不传 gameId = 通用规则**：<br>**event**：`25-parser-order.js` 的 `pickEventPrimary`（claim 优先 → 类别档位（`cat`/`tags` 读得到就用）→ endTs → startTs）。数组条目叫 `title`、`phase` 是对象 ⇒ 调用前做一层**只读适配**（`name = title`、`phase = phase.kind`），规则本体一个字不改。<br>**gacha**：`24-parser-window.js` 的 `selectCurrent` —— ① 只在**在期**的池里挑（`endTs >= now` 且起点缺失或 `<= now`，起点缺失 = 源站写「X.Y 版本更新后」⇒ 视为已开始）；② 在期的里取**结束最早**；③ 并列按起点升序；④ 一条都不在期 ⇒ 取数组首条（= 结束最早的那条，不凭 now 另造） |
| `scheduleItemOf(g, side, item, now)` | 数组条目 → 与 `scheduleNormalize` **同形**的渲染条目 | 记录自己那条外显（`item.title` == 记录的 `banner`/`event`）**直接走 `scheduleNormalize`** —— 卡池侧档期优先用记录里的绝对 `startTs/endTs`、活动侧走「源站原文 + tz」换算，数组里没有这两样（P1 只存 `raw` 与本机时刻），从数组重算会在 `TZ≠+08` 的机器上差一个时区。并列条目按 `startTs/endTs/raw` 组装（与今天 `scheduleHoverOnes` 同形）；两端都读不出 ⇒ `null`（与 `if (!r) continue` 一致） |
| `scheduleCellOf(g, side, now)` | 一格的**全部**条目 `{ primary, rest, fromArray }`；`null` = 这一侧没数据 | 有数组 ⇒ 上面两步（`fromArray = true`），并把 `g.id` 传给 `sideViewOf` 以命中的规则表；**数组不可用 ⇒ 兼容分支**（`fromArray = false`）：今天的老路（`scheduleNormalize` + 解析悬停文本），代码逐字搬自 P2 之前的 `82-schedule-view.js`。什么时候走到：老 `lastData`（P1 之前的缓存，归一后是空数组）/ 这一侧本来没数据 / 数组非空但派生不出主条（极端）|

#### 规则分派表（`schedulePickOf`，游戏 → 规则 → 对应老实现）

通用规则只对大多数来源成立；下面几款的老实现各有排序键，"零可见变化"要求逐字对齐 ⇒ 按游戏分派（**规则仍属显示层**，数据层只放事实）：

| 游戏 id | 生效侧 | 规则（`81-schedule-model.js`） | 对齐的老实现（文件:行） | 为什么通用规则复现不了 |
|---|---|---|---|---|
| `uma` / `uma-jp` / `uma-global` | 两侧 | `schedulePickUmaCurrent`：覆盖 now → `startTs` **最新** → **预告稿排后**（`preview` 事实，回退同一判据的标题匹配）→ `endTs` 更早 → 数组顺序（= 公告 id 的稳定替身） | `ns_umamusume_official_umaCurrentWindows`（`30-game-cygames.js:388-399`）；`pickUmaWindow` 取第 0 项（`:405-407`） | 日服 10-02 那侧外显是 **11-02 结束**的预告稿，通用"在期里结束最早"会选 10-13 结束的那条 |
| `uma-cn` | 两侧 | `schedulePickUmaCn`：**引擎主行优先**（`source:"primary"`）；老缓存没有该事实时退回上面的赛马娘规则 | `ns_biligame_activity_eventsUmaCnOfficial` / `gachaUmaCnOfficial`（`30-game-biligame.js:976` / `:956`） | 国服外显名 = `cleanTitle(公告标题)`（主行），悬停里那几行是**公告正文的「活动期间 / 第1轮 / 联赛报名期间」标签**；`pickUmaWindow` 只负责给档期，不是同一维度的候选 |
| `wuhuamixin` | 两侧 | `schedulePickWhmx`：**引擎主行优先**；老缓存兜底按 `endTs` 升序 → 同 `endTs` 取 `startTs` **更晚**那条 | `ns_biligame_activity_pickWhmxEvent`（`30-game-biligame.js:836-846`） | 同一理由（外显 = 公告标题），且它的 `rank`（小节名 vs 标题引号名）在数组里没有对应字段 |
| `zspms` | event | `schedulePickZspmsEvent`：覆盖 now → **该来源自己的类别词表**（含「演算」）→ `endTs` → `startTs` | `ns_bwiki_wikitext_zspmsEventCmp`（`30-game-bwiki-zspms-wikitext.js:242-246`） | 通用 `EVENT_TIER1_RE` 没有「演算」⇒ 09-25 那侧会选「主线剧情-远信回响」，老实现选「回路演算」 |
| `fgo` | event | `schedulePickFgoEvent`：覆盖 now → 类型档位（`cat` = `Event` 压过 `Campaign`）→ `endTs` → `startTs` | `ns_fgo_pickRow`（`30-game-aniplex.js:139-150`） | 档位来自**源站第 4 列类型**（`Event` 不在 `EVENT_TIER1_RE` 里）⇒ 09-05 那侧会选 Campaign 的「3200万下载突破纪念活动」而不是 Event 的「失落的创世…」 |

`cat` / `tags` 的来路：解析器若知道类别，额外返回 `itemFacts = { "<条目标题>": { cat?, tags? } }`，数据层按标题贴到数组条目上（**目前只有 FGO 活动表提供 `cat`**；`tags` 暂无来源 ⇒ 字段与归一就位但不产生）。取不到就**没有这个键**，显示层相应规则按"无类别事实"退化（不猜）。`preview` 由数据层按标题判据生成（`予告`/`coming soon`）。

**已知差异已清零**：`test/cases-core.mjs` ⑤-5 的等价性普查（17 款 / 34 个侧）现在 `diffs = 0` —— 原来 6 处（物华 gacha 少一行、星铁 gacha 少一行、物华/战双/赛马娘国服外显换位、赛马娘日服 gacha 换位）全部逐侧钉成**严格相等**；另有**反向证明**：把任一特化规则换回通用规则（`sideViewOf` 不传 gameId）⇒ 对应侧必红（实测把 `uma-jp` 与 `zspms:event` 两行从分派表拿掉时，⑤-5 立刻红在这两个侧；FGO 用 09-05 那侧单独钉住）。

**显示层（`src/client/82-schedule-view.js`）**：`cells` 存**数组本身**（`cells.set(key, g.gacha / g.events)`，与探头共用同一份）；`cellViews` 存派生结果；表格那一行 = `primary` 经 `scheduleNormalize` 渲染（主条直接走它 ⇒ 档期文本与今天**逐字一致**），探头 = `sideViewOf(...).rest`（内部先后仍是今天的 `schedulePickItem`）。失败横条改按**侧**判定（数组条目没有 `fail`），口径与改造前一致。

**兼容退化**：`scheduleCellOf` 的 `fromArray === false` 分支 —— **P3 可删**（等解析器直出结构化数组、老缓存彻底淘汰后）。

**回归（`test/cases-core.mjs` ⑤，35 条）**：纯函数（空 / 单条 / 在期里结束最早 / 起点未知 / 并列起点 / claim 优先 / 类别档位 / 顺序稳定 / 不改输入）+ `scheduleItemOf` 同形 + 兼容分支输出与老路逐字相同 + **等价性普查**（34 个侧全部逐字相等）+ 原来 6 处已知差异的严格相等 + **反向证明**（通用规则与特化规则必须选出不同的那条）+ FGO 09-05 那侧（`cat` 事实 + 特化规则缺一不可）。

#### 解析器直出（P3，第一批 2026-11-07）

**为什么倒过来**：P1 的数组是"从悬停文本反解"的 —— 悬停是**手拼**的、数组是**从那串文本猜**的，谁改了排版都会让两边**悄悄**错位（面板看起来仍然正常）。P3 让**条目成为事实**：解析器直接给 `gacha` / `events`，悬停文本由条目生成。

**反生成器**（`src/client/26-parser-hover.js`，与 `buildPoolHover` / `buildEventHover` 同处）：

| 函数 | 签名 | 做什么 |
|---|---|---|
| `hoverLinesFromItems(items, kind, tz)` | → `string[]` | 条目 → 悬停**行**（`kind` = `"gacha"` / `"event"`） |
| `hoverTextFromItems(items, kind, tz)` | → `string` | 行拼成一根字符串（`join("\n")`） |
| `hoverWindowTextOf(item, tz)` | → `string` | 一条的档期文本：两端 ts 都有 ⇒ `fmtWindow(ts, ts, tz)`；否则 `raw.trim()` |
| `poolHoverKept(pools)` / `poolHoverOrderOf(a,b)` | | 卡池列表的**去重**与**排序**（从 `buildPoolHover` 抽出来，悬停与数组共用同一份） |

复刻的排版规则（逐条对得上老的 `buildPoolHover` / `buildEventHover`）：
1. 活动侧每行 = `名称` + **3 个空格** + `MM-DD HH:MM ~ MM-DD HH:MM`；
2. 卡池侧每条两行 = `label || title` ⏎ 档期；
3. **窗口完全相同**时都只在**末尾**写一遍档期（活动侧每条只写名称）；
4. 缺起止（源站写"X.Y版本更新后"）⇒ 活动侧写 `名称   raw`、卡池侧档期行写 `raw`；没有 raw 就只写名称；
5. **不足 2 条 ⇒ 空串**（交回 UI 单条展示）；活动侧另按 `isLongTermEvent`（>120 天）剔掉常驻窗口；
6. 顺序 = **调用方给的**（卡池侧与 `poolHoverOrderOf` 同口径、活动侧与 `sortEventItems` 同口径）—— 鸣潮卡池悬停的**首行是"卡池活动类型"**（不是任何一口池），必须固定在首位，所以生成器**不排序**。

**已切的 3 款 6 条路径**（其余 25 款仍走 P1 的合成路径）：

| 游戏 | 侧 | 生产者（文件:入口） | 数组条数（真机夹具 2026-11-07） |
|---|---|---|---|
| 原神 `genshin` | 卡池 | `26-parser-hover.js` 的 `bwikiGachaPayload(html, tz, { emitArrays:true, id:"genshin" })`（bwiki 往期祈愿；**星铁仍走老分支**） | 3（主条 + 2 口并列池） |
| 原神 `genshin` | 活动 | `30-game-hypergryph.js` 的 `parseSmwActivity(json, tz, { emitArrays:true, id:"genshin" })`（bwiki SMW `action=ask`，经 `fetchYsActivity`） | 5（主条 + 4 条并列活动） |
| 明日方舟 `arknights` | 卡池 | `30-game-hypergryph.js` 的 `fetchArknightsGacha`（官方公告 CMS） | 1（当期只有一口限时寻访） |
| 明日方舟 `arknights` | 活动 | `30-game-hypergryph.js` 的 `prtsEventPayload`（PRTS SMW 单请求；兑换期在 `phase`） | 3（含 1 条 claim 主条） |
| 鸣潮 `wuwa` | 卡池 | `30-game-kuro.js` 的 `parseWuwaNotice`（官方公告 `recommend` 组） | 4（主条=卡池类型 + 3 口角色池） |
| 鸣潮 `wuwa` | 活动 | `30-game-kuro.js` 的 `parseWuwaRecommendEvents` | 2 |

条目形状 = 记录里数组条目的形状（`title` / `show` / `roles?` / `startTs` / `endTs` / `tz` / `raw` / `source`，可选 `cat` / `tags` / `preview` / `phase`）。`source:"primary"` = 引擎挑出的外显那条，其余 `"hover"`。

**数据层收口**（`src/client/50-refresh.js`，P3 只加函数、不改语义）：

- `dataArrayProducedItemOf(raw, kind)` —— 解析器条目 → 记录条目（**复用**持久化白名单那份 `dataArray*ItemOf`，键顺序因此与 `getCached()` 往返一致；并按合成路径同一判据补 `preview`）。
- `dataArrayProducedListOf(list, prefix)` —— 排序 + 发 `key`（`<id>:gacha:<i>` / `<id>:event:<i>`）；**先摘掉条目上可能已有的 `key`**（`Object.assign` 会把刚发的 key 覆盖成空串）。
- `dataArrayExtrasFromEntriesOf(entries, main, now, { kind, tz })` —— 并列条目的**唯一实现**（三条判据 + "同标题同区间"去重）；悬停文本路径（`dataArrayHoverPoolsOf`）与解析器直出路径都调它 ⇒ 不会出现"文本里丢了两行、数组里还留着"。
- `mergeEntryRecord` 的两个分支**没改**：来源给了数组就原样用（`Array.isArray(rec.gacha) ? rec.gacha : dataArrayGachaOf(...)`），只是把 `gachaHoverItems` / `eventHoverItems` 两条**通道**在末尾 `delete` 掉（与 `itemFacts` 同一性质：不进记录、不落盘）。

**时间戳口径不变（重要）**：`startTs` / `endTs` **仍是 P1 的本机时刻**（`dataArrayWindowOf`：把窗口文本按运行环境时区读回）。改成绝对时刻要连显示层探头一起改（`scheduleMeta` 用 `new Date(ts)` 渲染），否则 34 个侧在 `TZ=UTC` 下会变红 —— 那是 P4（见「已知不等价①」）。

**回归（`test/cases-p3.mjs`，77 条）**：① 生成器排版规则逐条（3 空格 / 同窗口折叠 / <2 条 / 缺起止写原文 / 长期过滤 / `label` 优先 / 去重 / **与老 `buildPoolHover`·`buildEventHover` 逐字节相同**）；② 6 条路径的 **12 个字符串字段 + 数组 golden**（`sansTs`；golden 是写死的字面量，取自 HEAD 跑同一批夹具）；③ 数组与**改造前的合成结果逐条相等**（把解析器给的数组摘掉、让旧合成器照同一份字符串字段再合成 —— 含 `startTs`/`endTs`，UTC / +08 都成立）；④ **同源**：`hoverTextFromItems(条目事实)` 逐字等于载荷里的悬停文本；⑤ 通道不外泄。新夹具 6 份（`p3-genshin-bwiki-gacha` / `p3-genshin-smw-events` / `p3-arknights-official-{list,detail-4916}` / `p3-wuwa-{entry,zh-hans}`），**不进 `map.json`**（免得改变其它批次对"默认源 404"的期望）。

**反向证明**：把生成器的分隔符从 3 个空格改成 2 个 ⇒ `test/cases-p3.mjs` ①（`名称   + 3 空格`）与 ②（原神/明日方舟活动 golden）同时红；把 `dataArrayExtrasFromEntriesOf` 的三条判据去掉一条 ⇒ ② 的数组 golden 红。这是"悬停/数组同源"真的承重的证据。

#### P3b 待办清单（本批**没做**的，按现成路径排好）

1. **其余 25 款切解析器直出**：`bwikiGachaPayload` 的星铁分支（`dedupeRoleNames`）、`selectArknights`（PRTS 卡池备选）、`pickCurrent(parseAllBwiki)`（绝区零 bwiki 备选）、`zspms` / `whmx` / `kedr` / `czn` / `stellasora` / `fgo` / `gf2` / `bandori` / `pjsk` / `p5x` / `nte` / `r1999` / `ba-*` / `uma-*` / `endfield` / `ddlezj` / `ournotes` 等 —— 统一按本批的三段式改：**条目事实 → `hoverTextFromItems` → `dataArrayProducedListOf`**。
2. **`hoverTextFromItems` 接住永久计数行**：`buildEventHover` 的 `permanentCount` 参数（`以及常驻活动 N 项`）还没有进生成器；切"有常驻活动"的来源（如星铁活动一览）时要补 `hoverLinesFromItems(items, kind, tz, { permanentCount })`。
3. **时间戳换绝对时刻**（P4）：`dataArrayWindowOf` 不再按本机时区回算，同时把显示层探头（`scheduleMeta` / `scheduleItemOf`）的渲染口径改成"按条目 `tz` 渲染"——这两个必须**同一批**改，否则 34 侧等价性在 UTC 下变红。
4. **`cat` / `tags` / 逐池角色表**：P3 只搬结构、不扩事实（原神 SMW 的「类型」、bwiki 每口池自己的 5 星列表都还没进数组 —— 加了会同时改变数组与显示层规则，属独立一批）。
5. **删 `scheduleCellOf` 的兼容分支**（`fromArray === false`）：等 25 款都切完、老缓存彻底淘汰后删（`README_Dev` 的这一节就是它的死亡通知）。
6. **`50-refresh.js` 的合成函数**（`dataArrayGachaOf` / `dataArrayEventsOf` / `dataArrayHoverPoolsOf`）：全部切完后与兼容分支一起删；本批它们在**其余 25 款**上仍是唯一路径，不能删。

#### 已知不等价（如实记，留给 P4）

1. **`startTs` / `endTs` 用的是"本机时刻"**：P1 直接 `parseDisplayRange(源站原文)`，**没做**"源站 tz → 本机"换算。于是在 `TZ≠+08` 的机器上，数组里的 ts 会比显示层换算后的小时**差一个时区差**（+08 机器上一致）。P2 用「主条直接走 `scheduleNormalize`」把**显示文本**这一面避开了（等价性用例在 UTC / +08 都逐字相等）；**P3 第一批也刻意沿用这个口径**（解析器直出的数组同样由窗口文本回算 —— 换成绝对时刻会让探头档期文本在 UTC 下变 8 小时，34 侧等价性立刻变红）；要彻底消掉得**同时**改「数据层口径 + 显示层探头渲染」，留 P4。
2. **并列池的 `show` = 标题本身**：悬停行只给"池名：角色"，没有结构化角色表 ⇒ 并列池那条 `show === title`、`roles = []`（主条的 `show`/`roles` 是完整的）。解析器直出每口池的角色表后可补（P3b）。
3. **卡池侧"跨池合并的角色表"没有拆开**：主条的 `roles` 仍是引擎给的那串合并角色（FGO 那种 13 个角色一行），不是"每口池自己的角色"。同样是 P3 的结构化来源才能拆。
4. **完全同名的悬停行只留一条**：`scheduleHoverItems` 对**完全同名**（归一后同串）的行只留第一条 —— 这是悬停逆解析的既有口径（与 `buildPoolHover` 的去重同源），不是 P1 发明的；数组沿用。**同一口池的两种写法**（合并角色的主条 vs 悬停里的 `池名：角色`）现在**都留着**（`source` 区分），只有内容完全一样（同标题 + 同区间）才去重并优先保 `primary`。

**P2 已知差异：已全部清零（2026-11-07 收尾，方案 C）**——原来的 6 处（探头的两行被并掉 + 4 款外显换位）靠"数据层补事实（`source` / `cat` / `preview`）+ 显示层按游戏分派规则"消掉了；`test/cases-core.mjs` ⑤-5 的 34 个侧现在 `diffs = 0`，且每条特化规则都有反向证明（换回通用规则 ⇒ 对应侧必红）。各游戏缺什么事实：**只有 FGO 有 `cat`**（源站类型列）、**只有赛马娘日服的预告稿有 `preview`**（标题判据）、`tags` **暂无来源**；这些"没有"都是**如实留空**（没有这个键），显示层按无事实退化，不猜。

### 为什么插件要改宿主的槽位布局

- **事实**：宿主把 `sidebar.footer.action` 渲染成 `<div data-slot="sidebar.footer.action" style="display:contents">`，它的父容器是 `display:flex; flex-wrap:nowrap` 的**一行**。同一槽位上多个插件的整宽入口会变成同一行的 flex 兄弟、互相挤压（DSH Desktop 源码注释的原话是 "crush each other"）。
- **做法**：`src/client/styles/sidebar-footer.css`（在 `build.mjs` 的 `CSS_ORDER` 末尾）把该槽位改成 `flex-direction:column`，子项 `flex:none`，并加 `max-height:min(40vh,240px)` + `overflow-y:auto`（入口多了能滚、不顶穿侧栏）；侧栏收起成图标栏时 `align-items:center`。
- **门槛（关键）**：桌面壳已经自己注入 CSS 接管同一槽位（旧壳 `flex-direction:column`，Desktop NEXT 用 `display:grid` + `grid-column:1/-1`），并在 `<html>` 上挂 `data-dsh-sidebar-footer-balanced` / `data-dsh-sidebar-footer-compat`。两边都是 `!important` ⇒ 靠**特异性**分胜负，而我们的选择器更长，**没有门槛就会盖掉桌面壳**。所以每条规则都写成 `html:not([data-dsh-sidebar-footer-balanced]):not([data-dsh-sidebar-footer-compat]) body …`，只在**桌面壳未接管**（网页端）时生效。
- **第二道门槛（2026-10-30）**：三条规则的选择器末尾都追加了 `:has(> * + *)` —— 槽位里**至少两个直系子项**（至少两个入口）才匹配。槽位里只有本插件一个入口时整段规则完全不生效（等于没装），这样"只有我们一个入口"的环境里宿主布局保持原样，影响面最小；`:has()` 是额外一层，双 `:not()` 门槛仍在。
- **选择器依据**（实测，不是猜）：`data-slot` 属性确实存在于宿主 DOM —— DSH NEXT 的 slots 渲染器给每个槽位挂这个属性（`<html>` 上没有任何 `data-dsh-sidebar-footer-*`）；收起态用的 `[class*="collapsed"]` 命中宿主侧栏根节点的 `GgXflG_collapsed` 一类类名（模块哈希前缀 + `collapsed`）。
- **注册项**：该槽位的宿主契约只列 `id` / `order` / `label`（`order` 升序、默认 0），**没有 `priority`** —— 旧写法 `priority:-10` 根本不被读，已换成 `order:-10`（仍在最上）；`label` 用 thunk（`() => SETTINGS_SECTION_LABEL`），图标栏提示跟得住语言切换。

### 跳到本插件设置页（两个面板的「设置」齿轮）

**结论：DSH 没有"打开设置到指定节"的 API**。`settings.openSettingsDocument` 是给 AI 打开**配置文档**的，不是 UI 跳转；`Ctrl+Alt+,` 是 Electron **应用级**加速键，合成的键盘事件无效（都不触发宿主动作）。设置面板是 modal，`open` / `activeId` 都是组件私有 state，打开后按 `rows[0]` 兜底、停在导航第一项。

**旧方案已失效**：旧实现找"`aria-haspopup="dialog"` 且无障碍名像设置"的侧栏触发器，再在下拉里挑本插件那一节。2026-10-31 在活的 DSH NEXT GUI 上核实：侧栏底部**只剩账号菜单**（`aria-haspopup="menu"`），那个 dialog 触发器已不存在 ⇒ 整条链静默失效。旧面板的设置按钮当时就是因此被 `SETTINGS_BUTTON_VISIBLE = false` 藏起来的（现在已恢复 `true`）。

**现在的实现**（`80-shared-ui.js` 的 `openPluginSettingsSection`，两个面板共用）是**合成点击**三步，每步都轮询到 deadline（`SETTINGS_NAV_TIMEOUT_MS` / `SETTINGS_NAV_POLL_MS`，不写死 sleep）：

1. 点 `[data-slot="sidebar.settings"] button[aria-label*="账号"]`（实测命中 `button[aria-label="账号菜单"]`）。兜底：侧栏底部 `[class*="settingsArea"]` 里**唯一**带 `aria-haspopup` 的 button —— 多个候选就放弃，绝不猜。
2. 等 `[role="menu"]` 出现（菜单是 body 级 portal）⇒ 点文本**以「设置」开头**的项（实际文本形如「设置Ctrl+Alt+,」）。
3. 等 `[role="dialog"]` 出现 ⇒ 在 `dialog nav` 里找文本**全等**「二游日历」的按钮并点；退到 `aria-label` 全等。只在 `dialog nav` 里找，不做整篇文档兜底，并且排除本插件自己的面板（`.gacha-cal-pop`，否则面板触发器同名会把"点设置"变成"自己开自己"）。

失败**不抛异常、不弹窗**：返回 `{ ok, step, reason }` 并 `console.warn`，三种情况分别可辨 —— `account-menu-missing`（找不到账号菜单）/ `settings-item-missing`（菜单里没有设置项）/ `plugin-section-missing`（设置开了但导航里没有本插件那一节）；另外 `settings-dialog-missing` 表示点完菜单项后设置面板根本没打开。三步判定抽成纯函数 `settingsJumpPickOf` / `settingsJumpPlanOf`（假 DOM 快照即可离线复跑，见 `test/cases-settings-jump.mjs`），`openPluginSettingsSection` 只负责取元素、点、等。

**入口**：旧面板 = 刷新按钮右边的 `gacha-cal-refresh` 齿轮（13px / 24 viewBox）；新面板 = 底栏「刷新」右侧最外侧的 `gacha-cal-sched-gear`（16 viewBox / `strokeWidth: 1.5`，经 props `onOpenSettings` 传入，**没传就不渲染**）。两边都是先 `setOpen(false)` 关掉本面板再跳转。

## 本机只读快照接口（给自动化脚本用）

浏览器半每次把合并好的数据写入 `lastData` 设置后，会顺手 POST 一份镜像给**宿主内存**里的只读路由
`/api/gacha-calendar-snapshot.json`（实现在 `src/index.js` 的 `snapshotHandler` / 客户端在 `src/client/92-dsh-env.js` 的 `publishSnapshot`）。
这样本机脚本（定时任务、其它面板）直接用 HTTP 读合并后的排期数据，不必去解析 DSH 的设置库。

```bash
# 端口换成你 DSH 实际监听的端口
curl http://127.0.0.1:<DSH端口>/api/gacha-calendar-snapshot.json
```

- `GET` 返回 `{ "at": <毫秒时间戳>, "data": { … } }`；`data` 与设置里的 `lastData` 是同一份 JSON。
- 还没发布过数据时返回 `204 No Content`（等面板刷新一次即可）。
- **只接受回环地址**（`127.0.0.1` / `::1` / `::ffff:127.*`），并拒绝 `Sec-Fetch-Site: cross-site` —— 快照不对外网/局域网开放。
- 只读：没有任何写设置的接口；`POST` 只接收浏览器半回传的 `{ at, data }` 镜像。
- 快照**只在宿主内存**里：DSH 重启或插件卸载即清空（卸载时会显式置空，避免重载后先读到旧数据）。
- ⚠️ 客户端那一跳**不能用 `keepalive`**：keepalive 的请求体上限是 64KB，而 `lastData` 约 200KB，用了会被浏览器直接丢弃且静默失败。

## 到期提醒（送达）—— 一份判定，三条装载路径

判定与文案只有一处实现：`src/client/65-remind.js`。`build.mjs` 把它**原样**拼进三个地方：

| 产物 | 谁在用 | 说明 |
|---|---|---|
| `lib/client.js` | 面板（设置页开关的读取口径 `remindOnOf`） | 与其它 `src/client/*.js` 同一次拼接 |
| `packages/core/core.mjs` | 扩展 / 原生平台 | 平台无关，判定可单测 |
| `lib/remind-core.mjs` | **宿主半边** `src/index.js` | 尾部只多几行 `export`，前半段与源文件逐字节相同（`--check` 会校验） |

为什么宿主不复用 `packages/core/core.mjs`：那个文件是 `createEngine` 的载体（28 个解析器全在里面），而发布包（`package.json` 的 `files`）只带 `lib/`；为了两百行判定去拉一份完整的 core，既慢又放大故障面。

宿主每一轮（默认 30 分钟 + 启动后 5 秒先来一轮）：

1. 读配置 → `remindOn === false` 或 `lastData` 为空就跳过；
2. `lastData` 的档期文本 + **源站 tz** → 绝对档期 → 条目（tz 表是 `SOURCES[].tz` 的副本，因为宿主读不到 `SOURCES`；守卫见 `test/cases-remind.mjs`）；
3. 拿去重状态判「这一轮该发哪几条」；
4. 逐条送达：Windows 用 `powershell.exe -EncodedCommand` 弹 WinRT toast（脚本在 `src/index.js` 的 `toastScriptOf` 里生成，**不落地 .ps1、不引用 `tools/`**），macOS 用系统自带的 `osascript -e 'display notification …'`（脚本在 core 的 `remindAppleScriptOf` 里生成）。两者在宿主里收敛成**同一个出口** `deliverToast`（平台 → 通道的判定是 core 的 `notifyChannelOf`；Windows / macOS 之外没有通道 ⇒ 只记日志、状态按已发落盘）。发之前**每轮只判定一次**通知身份（**仅 Windows 有**）：设置页启用过「二游日历」⇒ 用 `NOTIFY_AUMID`；否则 / 探测失败 ⇒ 回退 Windows PowerShell 自带的 AUMID（身份问题绝不能让提醒发不出去）。身份状态**先读 `<状态目录>\identity.json`**（毫秒级；探测一次 ≈0.9 秒，缓存在这里就不必每轮再付）；**没有缓存 / 缓存读坏也不等探测**：GET 先回保守值（未启用 + 配置名）再把探测丢到后台，`apply()` 里还有一次启动预热（`void`，不 await）⇒ 读取路径永不卡在 PowerShell 上，探到后下一次读取自动纠正；
5. 状态原子写回 `<状态目录>\host-state.json`（Windows `%LOCALAPPDATA%\dsh-gacha-calendar`、macOS `~/Library/Application Support/dsh-gacha-calendar`、Linux `$XDG_DATA_HOME/dsh-gacha-calendar` 或 `~/.local/share/dsh-gacha-calendar`，解析规则见下面的「跨平台」）；身份缓存 `identity.json`（仅 Windows 会写）同样原子写（`.tmp` → rename），超过 24h 只在后台补探一次纠正（GET 仍先回文件内容）；后台探测单飞且**推迟到下一拍**（`setTimeout(0)`：探测的同步前缀是一次扫开始菜单的 `readdirSync`，直接在 GET / apply 的调用栈里跑会把 0.5ms 变成 80~120ms）；日志追加到同目录 `remind.log`（超 256KB 自动只留后半段）。

几个踩过的坑，改这块之前先看：

- **`config.xxx` 不是裸值**。本插件所有设置字段都标了 `.volatile()`，DSH 交给 `apply` 的是 `{ get(), [Symbol.for("cosmokit.volatile.write")] }` 引用对象 —— 直接 `cfg.remindOn === false` / `typeof cfg.lastData === "string"` **永远不成立且不报错**，表现就是"提醒永远不发"。统一走 `configValueOf()` 解包。
- **定时器必须挂在 `ctx.effect` 的 disposer 里清理**。设置页每写一次都会让插件整体重载；漏清就是每次改设置多叠一个看不见的定时器。
- **通知身份（AUMID）是可选功能，不是安装步骤**。默认用 Windows PowerShell 自带的 AUMID，横幅顶部就显示「Windows PowerShell」；用户在设置页点「启用」后，宿主才会往**当前用户**开始菜单写 `<notifyName>.lnk`（默认 `二游日历.lnk`，名字可在同一行的窄输入框里改；文件名先过 core 的 `notifyNameOf` 清洗：非法文件名字符换空格、空 ⇒ 默认、超长截 40 字、Windows 保留设备名 ⇒ 默认）并绑定 `System.AppUserModel.ID = DshGachaCalendar.Reminder`（`notifyIdentityEnableScript`，内联 C# `IPropertyStore`；**只在 `HKCU\Software\Classes\AppUserModelId\<AUMID>` 写 DisplayName 不够** —— 实测 toast 弹不出来）。**改名 = 先删旧的再按新名字重建**：删除只认「AUMID 等于我们的」那条 .lnk（与文件名无关 ⇒ 绝不碰用户自己的快捷方式），且目标名字已被别人的快捷方式占用时回 `shortcut-name-taken`、**一个文件都不动**。「移除」只删快捷方式、保留注册表键（没有快捷方式时它不会被用到）。判断走 `remindIdentityOf`（纯函数，4 种组合有测试），失败一律回退。
- **失败不记已发**：某条送达失败时它对应的档位会被回滚，下一轮重试，直到成功或条目过期作废。
- ⚠️ **只在 DSH 运行期间生效**：宿主随 DSH 起停，DSH 关掉就没人盯着了（换来的好处是装插件零安装步骤，不碰系统计划任务；开始菜单那条是可选、可随时移除的）。

### 跨平台（Windows / macOS / Linux）

DSH 官方只承诺 **Windows + macOS**（Linux 有安装产物，但不作硬要求）。插件按这个前提做过一次审计，能力边界如下：

| 能力 | Windows | macOS | Linux |
|---|---|---|---|
| 面板 / 刷新 / 设置 / 快照接口 | ✅ | ✅ | ✅（浏览器侧 + 同源 HTTP，与平台无关） |
| 到期提醒送达 | WinRT toast（内联 PowerShell 5.1 + AUMID） | 系统通知：`osascript -e 'display notification …'`（系统自带，零额外依赖） | ❌ 只记日志（状态按已发落盘，不会每轮重试刷日志） |
| 通知身份（自定义横幅应用名） | ✅ 开始菜单 `.lnk` + `AppUserModelID` | ❌ 不需要（设置页显示「系统通知」并灰掉按钮） | ❌ 无此概念 —— **且整条送达链路不存在**（`notifyChannelOf` 返回 `none`，只记日志） |
| 状态 / 日志目录 | `%LOCALAPPDATA%\dsh-gacha-calendar` | `~/Library/Application Support/dsh-gacha-calendar` | `$XDG_DATA_HOME/dsh-gacha-calendar` 或 `~/.local/share/dsh-gacha-calendar` |

几条实现约定（改这块之前先看）：

- 平台判断只有一处出口：core 的 `notifyChannelOf(process.platform)` → `winrt-toast` / `osascript` / `none`，送达统一走 `deliverToast`；宿主里**没有**"先试 PowerShell、失败再说"这种路径。
- 目录解析是 core 的纯函数 `hostStateDirOf(env, platform, home)`：只认**绝对路径**的 env 值（`LOCALAPPDATA` 缺失 / 空串 / 相对路径一律当没有 ⇒ 退 `os.homedir()`），连 home 都拿不到时由宿主退到系统临时目录 —— 不会出现 `undefined/...`，也不会把状态写进宿主进程的 cwd。
- 通知身份（开始菜单 / AUMID / `IPropertyStore` / `HKCU\Software\Classes\AppUserModelId`）是 **Windows 专有**：非 Windows 上探测、预热、缓存读写全部短路，GET 回 `supported:false`，POST 回 `{ ok:false, error:"windows-only" }`（结构化结果，不抛）。
- macOS 通知失败**不致命**：`osascript` 起不来 / 返回非 0 ⇒ 与 Windows 同一条"送达失败、下一轮重试"状态机；AppleScript 字面量转义在 `remindAppleScriptOf`（有单测）。系统通知权限 / 勿扰模式关掉时横幅可能不显示，与 Windows 的专注助手同类。
- ⚠️ **macOS 未真机验证**：开发机是 Windows，macOS 分支只有纯函数单测 + 静态守卫，门禁在 Windows 与 Linux（WSL，同 CI 的 ubuntu-latest）上跑绿。真机首次跑时先看 `~/Library/Application Support/dsh-gacha-calendar/remind.log`。

## 待废弃的一次性迁移（目标移除：2026-11-30 之后）

「启动时补一笔配置」这类迁移**过期就没意义了**（用户原话：过一段时间之后要求把这种迁移逻辑彻底移除）。
保留期的唯一用途是覆盖"很久没启动过 DSH 的老用户"：老配置被迁过一轮后，新装用户根本走不到迁移代码。

目标移除时间统一写成**字面日期 `2026-11-30`**（2026-10-31 定，之后即可整体删除），**不要**改成"3 个月后"这类相对表述。
两个迁移函数上方各有一个 `⏳ 待废弃的一次性迁移` 注释块（含删除方法与涉及键），`apply()` 里的 `void …` 调用处各有一行指向它的短注释；注释块、调用处短注释与本表由 `test/cases-refresh.mjs` ⑭⑧ 守着。

| 迁移 | 涉及配置键 | 代码位置（函数） | 目标移除时间 | 删除步骤 |
|---|---|---|---|---|
| 新面板默认值迁移（2026-10-28） | `newPanelMigrated`；`newPanel` 的旧默认 `false` | `src/index.js` 的 `migrateNewPanelOnce`（含上方注释块） | 2026-11-30 之后 | ① 删函数；② 删 `apply()` 里的 `void migrateNewPanelOnce(ctx, config, settingsCtx.settings);`；③ 删 `newPanelMigrated` 键（`src/index.js` 的 schema + `src/client/engine-head.js` 的 `CONFIG_KEYS`，并同步 `src/client/10-config.js` / `src/client/*` 里的说明注释）；④ 删测试（`test/cases-health.mjs` ⑨、`test/cases-refresh.mjs` ⑭ 里对它的引用）与本表这一行；⑤ `node build.mjs` |
| 刷新频率迁移（2026-10-31） | `refreshMigrated`；`refreshMinutes` 的旧默认 `1440` | `src/index.js` 的 `migrateRefreshOnce`（含上方注释块） | 2026-11-30 之后 | ① 删函数；② 删 `apply()` 里的 `void migrateRefreshOnce(ctx, config, settingsCtx.settings);`；③ 删 `refreshMigrated` 键（`src/index.js` 的 schema + `src/client/10-config.js` 的 `DEFAULT_SETTINGS` + `src/client/engine-head.js` 的 `CONFIG_KEYS`）；④ 删测试（`test/cases-refresh.mjs` ⑭）与本表这一行；⑤ `node build.mjs` |

### 排查过、但**不**属于一次性迁移的兼容代码

`grep -n "Migrated\|migrate\|一次性迁移\|兼容"` 还会命中一批**常驻**兼容逻辑。它们不是"老配置迁一轮就作废"，
而是解析器 / 读取路径**永远**要吃的多种输入形状 —— **不设移除期**，别照上表删：

| 位置 | 是什么 | 为什么不删 |
|---|---|---|
| `src/client/60-helpers.js` 的 `eventFail` 兜底 | 旧 `lastData` 里 `eventFail` 是**字符串**（`"event-down"` / `"no-match"` / 错误原文） | `lastData` 是**用户数据**，升级后缓存里永远是上一版写下的旧形状 |
| `src/client/30-game-hypergryph.js` 的「限时寻访」表、活动三种历史结构 | 源站 wikitext 的历史表格 / 段结构 | 输入来自**源站页面**，不是本地配置；源站历史段落一直在 |
| `src/client/30-game-bwiki-*.js` / `15-env.js` / `50-refresh.js` / `84-settings-page.js` | `{timestamp}` / 裸字符串 / 缺字段、`tz` 未声明、老宿主少字段 | 外部输入的**形态差异**（源站 / 老宿主），不是一次性配置迁移 |
| `src/client/10-config.js` 的 `DEFAULT_SETTINGS` | 各配置键的缺省值 | 缺省值长期有效 |

## 待办（2026-10-25 整理）

### 做（按优先级）

1. **侧栏轮播（展示，✅ 已完成 2026-10-25）**：
   - ✅ 侧栏按钮**单行轮播**（替代原小红点）：有卡池/活动在 N 小时内**结束**时（开始方向 2026-10-28 起停用，见下面的判定口径），
     「[图标] 二游日历」与「[游戏图标] 事项名 · 3 小时」**整行连同图标**竖向翻页，
     每 5 秒切一格；**交叉**序列（2026-10-25 三次定稿）= 每两条轮播条目之间插回一次原按钮
     （`[原按钮, 条目1, 原按钮, 条目2, …]`，长度 2n；n=0 时只有原按钮、不滚动）；
     **翻页方向**（四次定稿）= 按**切换次数**四步一循环 上 → 下 → 下 → 上（不是"条目/按钮"交替），
     第 0 拍（挂载）用 down 兜底；**类名 = 视觉方向**（`.is-up` = 新内容从下方进 /
     `.is-down` = 新内容从上方进，对应 keyframes `50%→0` / `-50%→0`）。
     ⚠️ 方向必须从 `tickerDirAt(单调切换序)` 取，不能用 `stepAt(shownStep).dir`：格号每 2n
     回卷一次、方向按切换次数走 4 步，回卷时取到 `tickerDirAt(0)` 的兜底 down 会丢相位
     （n=2 时真机就是"连着三次都往下"）。
     悬停暂停，`prefers-reduced-motion: reduce` 时完全不滚动、静态钉在第一条。
     **C 方案（2026-10-25 二次定稿）**：文字优先显示**事项名**（卡池=那一期的角色名 / 活动=活动名），
     游戏身份靠**图标**（idle 格 = 日历图标，条目格 = 该游戏 `icon`，16px，跟着整行一起翻）；
     分隔符是「 · 」（**前后都有空格**，`.gacha-cal-btn-st` 因此用 `white-space:pre`）。
     设置页把原来的那个单行下拉拆成**两个控件**（2026-10-25 三次定稿）：
     **开关** `tickerOn`（默认 **开**，关掉 = 完全不轮播、窄侧栏也不出红点）+
     **范围** `tickerHours`（12 / 24 / 48 / 72 小时，默认 **72**；「关闭」不再是档位）。
     ⚠️ `tickerOn` / `tickerHours` 必须同时出现在 `DEFAULT_SETTINGS`、`src/index.js` schema
     与 `engine-head.js` 的 `CONFIG_KEYS` 三处（漏了就会"设了不生效"）。
     ⚠️ **轮播不分游戏**（2026-10-25 定稿，用户明确纠正）：轮播**只有**「全局开关 + 范围」两个设置，
     内容 = **所有展示中游戏的条目**，没有任何逐游戏筛选；`tickerItemsOf` / `tickerPickOf` 的签名里
     也**没有**逐游戏参数（早期版本按列表过滤，已删除）。设置页游戏列表里那一列是**「提醒」**
     （见下面第 2 项；2026-10-30 起**已恢复显示**，送达侧真的按它过滤），**轮播不读它**。
   - ✅ 判定口径（**只判结束**；开始方向已暂时停用，原因见下）：即将结束 = 已开始（`startTs <= now`）且 `endTs ∈ (now, now + N 小时]`；
     即将开始 = `startTs ∈ (now, now + N 小时]`（公式留档，该方向已停用）。纯函数 `dueKindOf`（`60-helpers.js`，返回
     `"" / "end" / "start"`；当前只会返回 `"" / "end"`）+ 窗口换算 `dueWindowOf` / `tickerItemsOf`（`81-schedule-model.js`，
     复用面板外显那条「源站文本 + tz → 本机墙钟」链，所以轮播与面板"还剩 X"永远同源）。
     ⚠️ 2026-10-28：**开始方向暂时停用** —— 解析器只产出「覆盖当前时刻」的窗口，startTs 永远 <= now，真实数据里不会命中；代码保留、注释写明恢复方法。
     老的 `isExpiringSoon`（只判结束）语义未动，仍由老用例守着
     （⚠️ 它现在**没有运行时消费者**，只剩测试；轮播已改走 `dueKindOf`，现在只判结束）。
    - ✅ 逐游戏钩子**不属于轮播**（2026-10-25 定稿，用户明确纠正）：轮播没有"按游戏勾选"，
      只有上面那一个全局开关 + 一个范围；`tickerItemsOf` / `tickerPickOf` 的签名里也没有逐游戏参数。
      游戏列表里那一列是**「提醒」**（属于下面第 2 项的「到期提醒（送达）」；2026-10-30 起
      **已恢复显示**，见第 2 项），**轮播不读它**。
   - ✅ 轮播感知数据变化：按钮与面板同属 `CalendarPanel`，复用面板已有的 `scope.subscribe`
     （刷新写回 `lastData`/`lastRefresh` → 快照推送 → 重渲染）+ 已有的每分钟时钟，**没有新增订阅**。
   - 降级：窄侧栏（`wide === false`）**没有可滚动的那一行** ⇒ 仍用小红点（`.gacha-cal-dot`）。
   - ⚠️ 这只是**展示**：到点**不会主动通知**，不看 DSH 就不知道 —— 主动送达见下面第 2 项。
   - 守卫：`test/cases-ticker.mjs`（结束方向口径 + 轮播开关新语义/默认值守卫 + 轮播选取/每格结构 +
     文本/tz 换算 + 设置页两控件与默认值（tickerOn=true / tickerHours=72）+ 交叉序列
     （`tickerStepsOf`：长度 2n、`[idle,1,idle,2,…]`、n=0 只有 idle）+ 方向四步循环（逐格 dir；
     类名 = 视觉方向，两组 keyframes `50%→0`（.is-up）/ `-50%→0`（.is-down）；
     外加 8 拍推演：n=2 与 n=4 都必须走出 down,up,down,down,up,up,down,down）
     + 轮播样式静态守卫：固定 22px 窗口 / 状态不截断 /
     分隔符带前导空格 / fill-mode 只用 backwards / reduce 置 none / 图标在行内且 16px）。
2. **到期提醒（送达，✅ 已完成 2026-10-27）**：
   - 定义（用户 2026-10-25 明确区分）：**到点主动送达通知**，让你不看 DSH 也知道 —— 这才是「到期提醒」。
   - ✅ 已实现（2026-10-27）：**Windows 系统通知**（toast），结束前 **72/24/6/2** 小时（开始前 24/2 小时**已暂时停用**，见第 1 项的判定口径）；
     同一件事多个档位同时到期**只发最紧急那一档**，条目过期即作废。判定与文案在 `src/client/65-remind.js`
     （core，纯函数可单测），送达在宿主 `src/index.js` 的 `registerRemindTimer`（默认 30 分钟一轮 +
     启动后 5 秒先来一轮）。架构与踩过的坑见上面「到期提醒（送达）—— 一份判定，三条装载路径」一节。
     设置项 = `remindOn`（默认开，设置页有开关）/ `remindEndNodes` / `remindStartNodes`（字符串）。
     设置页只显示结束那一行**胶囊**（72/24/6/2，可选集合就是出厂档位、不做自定义输入；开始那一行 2026-10-28 起已注释掉）：
     点一下立即写回**归一化串**（降序、逗号分隔），全部取消 ⇒ 写**空串** = 该方向不提醒
     （判定侧口径见 `65-remind.js` 的 `remindNodesOf`：显式空串 ⇒ 空档；键缺失 / 内容非法 ⇒ 回落默认）。
     ⚠️ **只在 DSH 运行期间生效**（插件宿主随 DSH 起停）。
   - 仍未做：数字角标（桌面/任务栏）。
    - ✅ **逐游戏白名单（设置页「提醒」列）已完成 2026-10-30**：
      · ⚠️ **2026-10-26 曾整列隐藏、2026-10-30 已恢复**：送达没实现时勾了没有效果 ⇒ 用常量
        `SHOW_REMIND_COLUMN`（`80-shared-ui.js`）把**表头 / 每行复选框 / 空列表提示 /
        网格列宽**四处一起藏起来；送达开始真的按它过滤后，常量改回 `true`，整列恢复。
      · 设置项 = `remindGames`（`string[]`）—— 设置页游戏列表的**「提醒」**列，每行一个复选框；
        写入只走逐行的复选框（批量「全部提醒」按钮 2026-10-30 按用户要求删掉了，不恢复）；
      · 默认值 = 出厂时**展示中**的 23 个条目 id（所有 `defaultHidden !== true` 的来源；默认隐藏的
        bh3 / ournotes / ournotes-global / czn / ddlezj **不在**里面）：`10-config.js` 的
        `DEFAULT_SETTINGS.remindGames` 与宿主 `src/index.js` 的 `REMIND_GAMES_DEFAULT`（schema 默认值
        与"配置读坏"的兜底共用它），由 `test/cases-ticker.mjs` 的守卫钉住；
        `engine-head.js` 的 `CONFIG_KEYS` 也含它；
      · 语义 = **普通列表**：列表里有谁就提醒谁，**空数组 = 一个都不提醒**（没有"空 = 全部"的哨兵）；
        设置页在白名单为空时显示一句「未勾选任何游戏 ⇒ 不提醒」；
      · 判定唯一入口 = 纯函数 `remindGameAllowed`（`65-remind.js`）—— 2026-10-30 从 `60-helpers.js`
        搬进来，因为宿主半边只装 `65-remind.js`（`lib/remind-core.mjs`），放在别处宿主只能抄第二份；
      · ✅ **送达侧已消费**（2026-10-30）：宿主 `runRemindRound` 读 `remindGames`（`configValueOf`
        解包）→ `remindGamesOf` 归一 → `remindAllowedTickOf` **在判定节点之前**过滤条目，并且把状态里
        不属于白名单的键一并清掉（未勾选 ⇒ 不提醒 **且**状态不留痕，之后勾上会正常提醒）。
        脏值策略：非数组 ⇒ 回落出厂默认；数组里的非字符串元素忽略；**空数组仍是"全不提醒"**。
        每轮 `remind.log` 都带一个「不在「提醒」列表跳过 N 条」的计数。
      - ⚠️ **已知风险（用户 2026-10-30 明确要求的行为，不是 bug）**：默认被排除的那 5 个来源
        （bh3 / ournotes / ournotes-global / czn / ddlezj）**静默不提醒** —— 界面上不会有任何提示，
        只有设置页那一列与 `remind.log` 的跳过计数能看出来；要收它们的提醒得手动勾上。
        **轮播不读它**（轮播只有 `tickerOn` + `tickerHours`，见第 1 项）。
   - 守卫：`test/cases-ticker.mjs` ④/⑧ —— 白名单语义 + 默认值 == 展示中来源 + schema 一致
     + 列恢复后**五处入口都在** + **反向守卫**（轮播链路与函数签名里都不许出现逐游戏列表）；
     `test/cases-remind.mjs` ⑱ —— **行为**用例（拿假条目 + 假 settings 跑真判定）：只提醒白名单内、
     跳过的不写已发状态、空白名单全不提醒、事后勾上下一轮照常提醒、旧状态键被清理、宿主接线与日志格式。
3. **解析器自检（✅ 已完成 2026-10-28）**（原「来源健康看板」的重构升级）：每源展示最近成功时间 / 连续失败次数 / 失败原因，
   并加"N 天连续 nomatch 即提示源可能改版或停更"（踩过的坑：异环公告改段落写法、雪松源页面停更）。
   - ✅ 实现：**健康记录由「立即检查」（`engine.selfCheck()`）写入，与面板刷新无关**（2026-10-28 用户决策：
     刷新只做数据轮转，只写 `lastData` / `lastRefresh` / `lastSource` / `lastVersion`）。自检跑完逐源累积，
     写进**独立**设置键 `sourceHealth`（不污染 `lastData`），另写 `healthCheckedAt`（每次自检必写，
     设置页据此显示「上次自检 X 前」/「从未自检」）；判定是 core 的
     纯函数 `sourceHealthRoundOf` / `sourceHealthNextOf` / `sourceHealthOf`（`60-helpers.js`），
     状态 = 正常 / 连续失败 / 疑似改版停更 / 从未成功；N = `SOURCE_HEALTH_NOMATCH_DAYS = 7`
     （连续 nomatch 的**跨度**满 7 天才提示，不是"连抓 7 次"）。设置页里**一张卡**装完：标题「解析器自检」
     + **「上次自检 X 前」/「从未自检」** + 按钮「立即检查」+ 来源健康列表（健康列表**永远可见**，
     没记录时也给一行状态；默认只列**不健康**的来源，全正常时只占一行）。「来源健康」已替代原来的手动自检
     卡片（两者不再并列为两块），守卫见 `test/cases-health.mjs`。
   - ✅ 2026-10-28 二次重做（原话「很简陋，整个重做，做好看点」）：那一块 = 标题行 + **状态条**
     （6px 状态圆点 / 主文案 / 右侧次要信息 / 展开按钮）+ **四列网格**（游戏名 / 状态胶囊 / 原因 /
     最近成功；默认只列异常，展开后健康行灰点弱化）；空状态一行、自检报告一行小徽章。样式在
     `src/client/styles/health.css`（进 `build.mjs` 的 `CSS_ORDER`）。
   - ✅ 2026-10-28 解耦（用户决策：**只有「立即检查」写健康记录，与面板刷新无关**）：`refresh()` 里那段
     折算 / 比较 / 写入 / `healthSaveError` 全部删除，`selfCheck()` 成为唯一写入口（口径与原来逐字相同，
     另**每次**写 `healthCheckedAt`）；`sourceHealthOf` 的 `lastRefreshAt` 显示补偿随之删除（刷新已不是
     "这些源最近成功过"的证据）。健康存档读写仍**尽力而为** —— 失败只记内存标记 `healthSaveError`
     （`engine-api.js`，另见 `engine.healthSaveError()`），**不影响自检报告**；设置页空状态据此区分
     「还没做过自检」与「写了但被宿主拒绝」。守卫见 `test/cases-health.mjs` ④b / ⑤ / ⑤a–c / ⑥ / ⑦。
4. **搜索与筛选（✅ 已完成 2026-10-28；「分组」跳过 —— `SOURCES` 里没有地区字段，不硬造）**：设置页来源列表加"搜游戏名"+ 分组（国服/日服/国际服）+ 只看已启用；
   面板内加按卡池/角色名搜索（现在的 28 个来源只能靠"展示"开关逐条关）。
5. **排期导出 .ics（✅ 已完成 2026-10-28）**：把当期窗口导出成一次性快照（可导入手机日历）。
   ⚠️ 只能是**快照**、不能是订阅：网游排期是"一次性数据"，没有稳定的公开 iCal 源。
   - ✅ 实现：纯函数 `icsEventsOf` / `icsOf`（`60-helpers.js`）判定在期并产出确定性 iCalendar（CRLF / 75 octets 折行 / 转义），时间 = 源站墙钟 + `tz` → UTC，设置页「游戏列表」按钮组里的「导出 .ics」走 Blob 下载、不新增宿主路由；守卫见 `test/cases-ics.mjs`。
6. ⏸ **搁置（2026-10-28 用户决定，本次不做）** **抽卡计划 / 攒抽追踪**：目标角色 + 当前保底/预算 + 倒计时。属重功能，分阶段做（先"目标角色 + 倒计时"）。
7. **架构重整（拆文件 + CSS 抽出）** —— 按「**一个文件一个职责**」拆，**不按行数硬切**（各文件当前行数以文件为准，不列举）：
   ① ✅ 2026-10-28 完成：`80-components.js` 按**界面**拆成 5 段 —— `80-shared-ui.js`（共用小组件）/
      `81-schedule-model.js` + `82-schedule-view.js`（新面板的模型与渲染层）/
      `83-panel-shell.js`（面板外壳，旧表格是它内部的条件分支，没有独立文件）/
      `84-settings-page.js`（设置页）。拆点全落在原文件的空行上，`lib/client.js` **逐字节不变**；
      静态守卫改读 `test/load.mjs` 的 `readComponentsSource()`（拼回原文，断言一条没改）；
   ② 原 `70-styles.js`（CSS 全藏在一个模板字符串里） → 抽成真正的 `styles/*.css`，构建时拼接
      （这条最值：现在"反引号必须恰好 2 个、注释必须配平"，已经踩过两次）；
      ✅ 2026-10-28 完成：拆成 `src/client/styles/*.css`（先 9 个文件；之后 2026-10-28 设置页重做加 `health.css`、2026-10-30 加 `sidebar-footer.css`，现共 **11 个** —— 个数以 `build.mjs` 的 `CSS_ORDER` 为准；按原段落注释切、内容原样搬运），
      `build.mjs` 用独立的 `CSS_ORDER` 拼回 `const STYLE = \`…\`;` —— **`lib/client.js` 逐字节不变**，
      守卫见 `test/cases-ticker.mjs` ⑧（含 CSS_ORDER ↔ styles/ 一一对应）。
   ③ ✅ 2026-10-28 完成：原 `30-game-bwiki.js`（多个游戏的 bwiki 源合集）按文件里**已有的 `//#region` 分段**
      机械拆成 15 个 `30-game-bwiki-*.js`（一游戏/一段一文件，不重新分类、不合并；拆点全落在原文件的
      空行上 ⇒ `lib/client.js` **逐字节不变**），`build.mjs` 的 ORDER/CORE_ORDER 原位换成这 15 行；
   ④ ✅ 2026-10-28 完成：`25-parser-shared.js` 按**职责**拆成 7 个 `2x-parser-*.js` —— 时间解析 `23-parser-time.js` /
      当期窗口判定 `24-parser-window.js` / 排序优先级 `25-parser-order.js` / 悬停构造 `26-parser-hover.js` /
      实体与文本工具 `27-parser-text.js` / 悬停排版共用工具 `28-parser-hover-tools.js` /
      中文时间与来源登记 `29-parser-register.js`。拆点全落在原文件的空行上 ⇒ `lib/client.js` **逐字节不变**；
      静态守卫改读 `test/load.mjs` 的 `readParserSharedSource()`（拼回原文，断言一条没改）；
   ⑤ **不拆**单游戏文件（一个厂商/游戏的闭环 = 有界的内聚单元，行数多少都不成为拆的理由）；
   ⑥ **不按行数**把某个解析器切成"上半/下半"（会制造"半个解析器"这种坏边界）；
   ⑦ 约束：构建按 `build.mjs` 的 ORDER 拼接 ⇒ 拆完必须同步 ORDER；零依赖保持不变；
   ⑧ **不做** minify（本地加载、收益低，且要引 devDependency，破坏"零依赖 + CI 不装包"）。
8. **分发/曝光**：`awesome-dsh-plugin` 提 PR；核对 `dshplugin.net` 条目；README 加一张动图；
   `package.json` 补 `keywords`；GitHub 仓库补 topics；npm 页面确认 README 已是最新。

### 待论证 / 待定

9. **core 独立成仓库**：倾向**暂不**。core 由 `src/client/` 生成、与 UI 交织，拆开要先重构
   （fetch/parse 与渲染分离）；而且 npm 上已有独立包 `gacha-calendar-core`，独立仓库的边际收益低。
   等浏览器扩展真正启动时再评估。
10. **优化滚动手感**：探头 `position:fixed` 与"原生滚轮"的固有矛盾，属"选了体验优先"的已知取舍。
11. **留白卡循环长度**：当前循环全部在期条目（约 38 条 ≈ 2.5 分钟一轮），是否限长待定。

12. **AI 协作署名（提交 trailer）** —— **已研究，存档不启用**。
   结论：`Co-Authored-By` 是 GitHub/GitLab **认**的标准 git trailer（提交页显示协作者、计入贡献图；
   邮箱绑定账号才带头像，否则只是名字）。Claude Code 默认加 `Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`、
   Copilot CLI 也加；**DSH 本体没有这套**，官方署名走 `powered_by_dsh` 徽章（文档/PR 正文）。
   现实效果一般（无头像、不显眼）⇒ 决定**不加 trailer、保持现状**；需要时再启用：
   提交末尾 `Co-Authored-By: DeepSeek Harness <noreply@deepseek.com>`，PR 正文 `Generated with DeepSeek Harness`。

### 不做（已决定，不再讨论）

- **主源失败自动回落备选**（含"人工确认的半自动换源"）：用户 2026-10-25 决定**保留现状**。
  理由：备选可能更慢/更易被限流；回落成功但数据口径不同会长久静默不一致；
  失败时多打请求会放大对方的异常流量判定；而"提示 + 一键切换"也会引入新的交互与状态。
  现状（失败就显示失败、原文照旧）已经足够清晰。

### 已完成（2026-10-25 核实后从待办移除）

- ~~新面板也吃悬停 marquee~~：**已实现**——新面板长名类都包了 `.gacha-cal-inner`，
  `90-plugin.js` 的 marquee 是"面板 + 设置页共用"的全局机制。
- ~~新版面板的悬停补失败结论~~：**已全部完成**（2026-10-28，日期格见 `scheduleDateHover`）——
  名字格带 `sideFailText`，日期格补同口径结论（失败 / 沿用旧值 / 无数据三种情况，正常态不补提示）。
- ✅ **日期格悬停补失败结论**（2026-10-28 完成，commit `b4d680c`；`scheduleDateHover` 在 `81-schedule-model.js`）——
  原「做（按优先级）」第 9 项，做完后移到本节。
