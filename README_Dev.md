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
- **钩子的 BOM 扫描走 Node**（2026-11-14）：`.githooks/pre-commit` 只负责调 `node tools/check-bom.mjs` 并看退出码；扫描本身（读暂存区 `-z` 列表、按扩展名过滤、比首 3 字节）在 Node 里。
  原实现用 `read -r -d ''`（**bash 专有**）：Ubuntu 的 `/bin/sh` 是 dash ⇒ `read: Illegal option -d`，循环一次都不执行、守卫**静默失效**（WSL 实测：带 BOM 的文件被成功提交）；
  macOS bash 3.2 与 Git Bash bash 5 反而正常，所以这个洞只在 Linux 上开。对应回归：`test/cases-bom-hook.mjs`。
- **三平台 CI 矩阵**（2026-11-14）：`verify.yml` 从 `ubuntu-latest` 扩成 `[ubuntu-latest, windows-latest, macos-latest]`。
  不装依赖（纯 Node 脚本 + 已入库夹具）⇒ 成本很低；macOS 上 darwin 通知断言会走真实 `osascript` 分支。
- `npm run check:bom`：单独跑 BOM 守卫（不提交也能用）；`npm run setup:hooks` 已改为 `node tools/setup-hooks.mjs`（cmd.exe 没有 `true`）。
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
│       ├── 24-parser-window.js # 当期窗口判定：补全起点 / 选当期 / 窗口文案 / 覆盖判定
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
│       ├── 30-game-bwiki-zspms-wikitext.js # 战双（wikitext）：卡池 = `Test4/活动旗帜`（2026-11-10 起默认）+ 活动日历/版本更新公告（均为活动侧备选）
│       ├── 30-game-zspms-official.js # 战双：**官方 CDN**「版本更新公告」（2026-11-11 起活动侧默认源；菜单 → 最近 3 篇 → HTML 正文抽档期）
│       ├── 30-game-bwiki-czn-wikitext.js # 卡厄斯梦境（wikitext）：Module:Gacha/data 的 Lua 表
│       ├── 30-game-bwiki-kedr-wikitext.js # 雪松（wikitext）：Template:首页游戏版本内容 的模板调用
│       ├── 30-game-bwiki-kedr-wiki.js   # 雪松社区归档页（往期动员，prop=text）+ 其抓取器
│       ├── 30-game-bwiki-dhmmr.js       # bwiki ⑧ 深空之眼（dhmmr）：SMW `action=ask` 的「卡池列表」子对象；只有卡池侧（活动页空壳 ⇒ 不接）
│       ├── 30-game-bwiki-register.js    # 本组 4 条 registerSource + GACHA/EVENT_FETCHERS 接线
│       ├── 30-game-biligame.js    # biligame 系：嘟嘟脸恶作剧 / 闪耀优俊少女
│       ├── 30-game-cygames.js     # Cygames：赛马娘 日服 / 国际服（umapyoi 备选）
│       ├── 30-game-komoe.js       # Komoe：赛马娘 繁中服（官方公告 CMS；卡池 + 活动同一条接口、按标题分流）
│       ├── 30-game-perfectworld.js # 完美世界：女神异闻录：夜幕魅影 / 异环
│       ├── 30-game-sunborn.js     # 散爆：少女前线2：追放
│       ├── 30-game-aniplex.js     # Aniplex / TYPE-MOON：Fate/Grand Order（国服 fgo.wiki + 日服 Atlas Academy）
│       ├── 30-game-sega.js        # 世嘉：初音未来：缤纷舞台 国服 / 繁中服 / 韩服（同源同形，只换 URL + tz）
│       ├── 30-game-yostar.js      # 悠星：星塔旅人
│       ├── 30-game-bluepoch.js    # 深蓝互动：重返未来：1999
│       ├── 30-game-wqmt.js        # 无期迷途（国服）：卡池 bwiki 追踪一览 + 活动 官方资讯 API + 开服锚点
│       ├── 30-game-miyoushe-bbs.js # 未定事件簿：米游社公告（卡池 + 活动；详情需 Referer www.miyoushe.com/wd/）
│       ├── 30-game-netease.js     # 时空中的绘旅人：官网新闻（official）+ 学院公告（update）列表 + 详情（卡池画廊 + 活动；缺年份补年/跨年）
│       ├── 30-game-pengpeng.js    # 夜幕之下（国服）：卡池 bwiki SMW ask（契约）+ 活动 TapTap tab 页的 SSR（Nuxt `__NUXT_DATA__`；旧 bwiki 公告为备选）
│       ├── 30-game-unconfigured.js # 炽焰天穹：只注册条目、来源留空未配置（本批唯一仍不接的）
│       ├── 30-game-batch2.js      # 2026-11-11 第二批：崩坏3 米哈游内容中台（卡池名称/角色 + 档期三级取值：`>>开放时间` → 同帖礼包【上架时间】 → 只出名称/角色；活动正文时间块）/ OurNotes 日服 SPICA（列表→前 5 条详情）/ 卡厄斯梦境 TapTap 官方（2026-11-13 改 topic 页 SSR：Nuxt devalue 解码 + 2 页固定请求；卡池「营救概率提升」标签 + 活动「活动时间」标签；同页维护窗映射；卡池载荷带活动字段供引擎复用）
│       ├── 30-game-ournotes-global.js # OurNotes **国际服**卡池 + 活动：默认源 = SPICA 数据 JSON（页面 `window._durl` 现解 → d-*.json；gachapages/events 一次拿全）；数据里是 JST 墙钟、展示按 UTC+8（钟面 −1h）；picks 按 **id** 查角色；池名与角色名按 zh→tw→en→ja 取（简中优先）；BHK 官方公告两条降为手动备选源
│       ├── 30-game-benghuai2.js   # 崩坏学园2（国服）：官网公告（列表 POST `{}` + 详情 GET；卡池 + 活动两侧同一条列表，轮内共享 1 次请求）
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
│   ├── all.mjs      # 统一门禁：聚 43 段用例（P5X / B1~B3 / P4~P9 / 蔚蓝档案 / 异环 / 赛马娘 GameTora / 明日方舟两阶段（举行 / 奖励领取）+ 明日方舟时间轴（整周期逐时刻扫描）+ 规则静态守卫 + 时区口径 + 侧栏轮播 + 到期提醒 + 来源健康 + README 结构图守卫 + core 产物守卫 + 设置页标题行（版本号 + Star 指引）+ 搜索与筛选 + 排期导出 .ics + 刷新频率「启动时」档 + 设置入口（两个面板的齿轮 + 三步跳转设置页）+ 设置页 title 文案（18 处定稿，三轮增删）+ 来源策略（默认源无自动兜底）+ bwiki 请求统一带 origin=* + P3 解析器直出数组（悬停由条目反生成）+ P4 展平（数组 ts=绝对时刻 / 「近期」收全部条目 / 计数·提醒·ics·轮播按条 / 跨时区渲染一致）+ category / tags 批 1+2+3（9 款把已在内存里的分类写进数组条目：逐字取值 + 档位 + 外显 + 多值拆分 + 旧键兼容 + 反证；批 3 把 `eventTier` 的 haystack 改成 OR 语义：`category` + `tags` + `name` 都参与）+ 2026-11-09 新接入 5 款（无期迷途两侧真源 / 夜幕之下卡池 / 未定·绘旅人已接两侧源 / 炽焰天穹仍留空未配置）+ 星铁卡池换官方公告 CMS + 「相对起点」锚定（星铁 10:00 / 无期迷途 14:00）+ 「起点未知 ≠ 已开始」+ 绝区零 bwiki 备选源「起点未知 = 已开始」的唯一例外 + 未定事件簿 / 时空中的绘旅人（米游社公告 + 官网新闻：卡池 + 活动 / 跨年补年 / 单侧失败隔离）+ 夜幕之下活动（TapTap tab 页 SSR：devalue 解码 + 区间解析复用 + 覆盖当前窗口才翻页 + 反向证明；旧 bwiki 公告源仍作备选）+ 刷新横幅（底部失败横条与「重试」已删 / 失败明细并入悬停：沿用判定 + 文字口径逐字不变）+ 赛马娘·繁中服（Komoe 官方公告：卡池/活动同一条接口 + 「維護結束後」起点未知）+ OurNotes 国际服（SPICA 数据 JSON：`_durl` 现解 → 卡池/活动一次拿全；JST 墙钟 → UTC+8 展示；picks 按 id 查角色；真夹具 + 反向证明））
│   ├── cases-*.mjs  # 各段用例（43 个文件 / 43 段，与 all.mjs 的 batches 一一对应；本批新增 cases-ournotes-global-spica）
│   ├── load.mjs     # 加载构建产物，取 exports.__regression（解析器 + env 工具 + 来源表）
│   ├── harness.mjs  # 夹具 fetch 注入 + check/section/summary + 契约与悬停断言
│   ├── lib-text.mjs # 悬停文本的共用判定（去重 / 相邻重复 / 「名称 ⏎ 只有区间」/ 分类前缀双写）
│   │                # 用法：cases-arknights-claim（真机逐字基线）与 cases-arknights-timeline（整周期）都调它
│   ├── registry-shim.mjs # 各批次注册表规格快照 + DRIFT 守卫（与运行时 SOURCES 核对 tz/name）
│   ├── legacy-golden.mjs # 改造前 oracle 的**字面量 golden** 读取器（fixtures/legacy-oracle-golden.json）
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
| `活动类型` | `category` | ≈ 我们的分类（`支线故事` / `登录活动` / `危机合约` / …）；**不是每页都有**（实测 8 条里 1 条为空）⇒ 缺失时 `category` 留空，由 `eventTier` 按**名称关键词**回退 |
| 结果键 / `fulltext`（页名） | `name`（+ `page`） | 页名本身可能就是「视相博物馆：演化」，分类前缀由 `labelOf(category, name)` 去重（不会拼成「视相博物馆：视相博物馆：演化」） |
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


**三态**（只改 arknights 的 payload 与提示框里的那几行，即 `30-game-hypergryph.js` 的 `prtsHoverNoteOf` / `prtsEventPayload`、`81-schedule-model.js` 的 `scheduleHoverNote` / `scheduleHoverText`、`82-schedule-view.js` 的 `hoverTextOf`；探头的解析逻辑 `scheduleHoverItems` 一个字没动 —— 该函数 P5 清理后已从产品删除，判据冻结在 `test/lib-text.mjs`）：

| 时刻 | 外显 `eventDates` | 独立提示字段 `eventHoverExtra`（只进提示框，插在该活动那一行**之后**） |
|---|---|---|
| now ≤ 活动结束（活动期） | `活动开始 ~ 活动结束`（与改造前逐字相同） | `<活动标签> 兑换截止   MM-DD HH:mm`（有兑换期时） |
| 活动结束 < now ≤ 兑换结束（兑换期） | `活动结束 ~ 兑换结束`（外显「还剩 X」因此指向兑换截止） | **不写这个键**（该活动的主行本身就是兑换区间，见下） |
| 没有「兑换结束时间」字段（或与活动结束同值） | 与改造前完全一致 | 不写这个键（不补猜 7 天） |

- 兑换期内的活动**仍然出现**（改造前会整条消失 —— 那正是奖励没领的时候）。
- **奖励领取期的候选在外显挑选中排最前**（`pickEventPrimary` 的第一个排序键，压过类别档位；见 2026-11-07 真机 bug：一条还剩 15 天的「支线故事」把兑换期只剩 3 天的活动挤出面板与「近期」）。判定只看 `phase === "claim"` —— 该字段只有本来源的两阶段候选会设置，其它游戏没有 ⇒ 行为不变；悬停排序 `sortEventItems`（结束时间升序全量）**不动**。
- **分类前缀去重**（`labelOf(category, name)`，纯函数）：活动名本身可能已经带分类前缀（PRTS 的 `视相博物馆：演化`）⇒ 不再拼成 `视相博物馆：视相博物馆：演化`。规则：`name` 以 `<category>：` / `<category>:` / `<category> ` 开头、或与 `category` 完全一致 ⇒ 原样返回 `name`，否则 `<category>：<name>`，没有 `category` ⇒ `name`（前缀比较大小写不敏感，幂等）。SMW 给的 `name` 是**页名**（不带分类前缀）⇒ 悬停行、payload 的 `event`、`eventShow`、提示行锚点**全部**走它 ⇒ 面板显示的那一串与提示框里出现的**同一串**。
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
3. **名称不重复**：`event` / `eventShow` / 悬停行标签 / 提示行锚点都不许带两层分类前缀。两条判据一起用：`labelOf(category, label) === label`（幂等）+ `doubledCategoryPrefixOf`（真的没拼第二下）—— 只靠幂等**抓不到**"多加了一层"（`labelOf` 对已带前缀的串是原样返回的）。
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
| `gametora.com` | 赛马娘国际服（卡池 + 活动） | 目前正常（真机在跑） |
| `api.atlasacademy.io` | Fate/Grand Order·日服（卡池 + 活动） | 实测两个端点都回 `ACAO: *`（2026-11-14）|
| `sekai-world.github.io` | 初音未来缤纷舞台卡池/活动 | 目前正常 |
| `gh-proxy.com` | 初音未来缤纷舞台默认源（第三方镜像） | ACAO 未知，镜像服务可能随时变 |
| `bang-dream-on.bushimo.jp` | BanG Dream! OurNotes | ACAO 是**回显 Origin**（不是 `*`）⇒ 对 `dsh-app://` 有风险 |
| `api.umapyoi.net` | 赛马娘 | 未验 |
| 用户自定义地址 | 设置页可填任意 URL | 目标站若不回 ACAO ⇒ 同样「网络不通」 |

处理方向（将来一次做完，不要逐个打补丁）：把这套判定做成**主机表**（`需要代理的 MediaWiki / 拒发 ACAO 的主机`），
在 `transportFetchRaw` 同一个收口点按表改道代理；并把 `origin=*` 也统一由收口点补（现在 prts 是 8 处手拼）。
另注意：改道代理后必须同步 `PROXY_ALLOW_HOSTS`（`src/index.js` 的白名单），否则会 403 `host-not-allowed`。
### P5 兼容层评估结论（2026-11-07；2026-11-08 清理了其中 4 类死代码）

P1~P4 之后数据真源是 `gacha[]` / `events[]`；`bannerHover` / `eventHover` 等已降级为**由条目反生成的兼容产物**。
逐字段普查（生产者已无人手拼；下表只列**仍在读**的地方）：

| 字段 | 仍在读的地方（生产） | 结论 |
|---|---|---|
| `bannerHover` | 新面板 tooltip `81-schedule-model.js:655` / `82-schedule-view.js:404`；**旧面板** `83-panel-shell.js:660`（渲染 title）+ `:148`（字段拷贝）；快照路由 / Result JSON；130+ 测试断言 | **保留** |
| `eventHover` | 同上 + `83:157` | **保留** |
| `eventHoverExtra` | tooltip 提示行插入 `81:639`（经 `scheduleHoverNote`）、`82:424`；旧面板拷贝 `83:155` | **保留，标废弃** |
| `eventShow` | `81:197` 的 `show` 计算（兑换期事项名）；`50-refresh.js:524` 数组构建的 compat 分支 | **保留，标废弃** |
| `eventClaimDates` | `65-remind.js:475` 双 deadline 的**兜底**（数组 `phase` 缺失时才用）；`50-refresh.js:537` 同上 | **保留，标废弃** |
| `bannerDatesRaw` / `eventDatesRaw` | 悬停原文（"补全文本 vs 源站原文"双文本是**刻意设计**，不是冗余） | **保留（设计）** |

#### 为什么现在不能删
1. **旧面板还在读**：`83-panel-shell.js` 的表格视图仍用 `bannerHover` / `eventHover` 作 `title`，`eventShow` / `eventHoverExtra` 也各自拷贝一份。旧面板退役是删字段的前置条件。
2. **对外契约**：`/api/gacha-calendar-snapshot.json` 与 Result JSON 直接透传整份 `lastData`，字段存在即被外部脚本可见；`ENGINE_SCHEMA_VERSION` 仍是 1，删字段属于破坏性变更，需要版本升级策略。
3. **老缓存容错**：`50-refresh.js:201-220` 对缺失字段做"沿用上一轮"，删字段后老缓存的退化为"该侧无数据"，需先确认用户可接受。

#### 标废弃的字段：可删的前提（三条同时满足才动）
- 旧面板退役（或旧面板改为读 `gacha[]` / `events[]`）
- 提醒改为只读 `events[].phase`（`65-remind.js` 删掉 `eventClaimDates` 兜底）
- `50-refresh.js` 的 `dataArrayEventMainOf` compat 分支删除（只保留解析器直出路径）
建议在 README 的"待废弃"表里登记，给出最早删除版本（例如再两个 minor 版本后）。

#### 死代码清理结果（P5 后一轮，2026-11-08）

上一版在这里列了 4 类"待清理"，本轮**先固化 oracle、再删实现**，结论：

| 项 | 结果 | 证据 |
|---|---|---|
| `bwikiGachaPayload` / `parseSmwActivity` 的 `emit=false` 分支 | **已删** | 两条路都没了 `!emit` 早退；原神/星铁/方舟三个调用方本来就只走直出 |
| `ns_biligame_activity_whmxEventHover` / `umaCnEventHover` / `umaCnPoolHover`（仅测试导出） | **已删** | 生产调用点一直是 `hoverRows(...)` + `dataArrayProduced*Of`；名字投影搬进 `test/cases-p9.mjs`（`legacy*HoverOf`） |
| `scheduleHoverItems`（悬停文本 → 并列条目） | **已删** | 自 P3c 起无生产调用方；判据冻结进 `test/lib-text.mjs` 的 `legacyHoverItemsOf`（明日方舟 §④ 与 cases-core ④ 继续调它） |
| `dataArrayExtrasFromEntriesOf` 的 `win` 分支 | **已删** | 生产条目一律给 `startTs/endTs/raw`；`win` 只服务已删除的 `legacySynthArrOf` |
| `ns_kedr_wiki_gachaKedrWiki`（旧抓取器） | **保留** | 见下面三条理由 —— 删它必然减少断言 |

`ns_kedr_wiki_gachaKedrWiki` 为什么没删（不是"忘了"）：
1. `test/registry-shim.mjs` 的 `SOURCES_P6` 在**模块加载期**就 `resolve("kedr-wiki.gachaKedrWiki")`，
   删导出会让整份门禁在 import 阶段就抛（不是一条红，是一片红）；
2. `test/cases-p6.mjs` 的"抓取器"小节**端到端调用它**（抓取成功 / 契约 / banner / roles / 窗口 / 悬停 /
   换期 / 全部过期 ⇒ null / null 过契约），约 10 条断言；删实现就等于删这些断言 ⇒ 违反"条数不减"；
3. `30-game-bwiki-kedr-wiki.js` 的文件头本来就写着「生产已改走 bwiki-wikitext；**本文件供回归测试**」——
   它是**有意保留的离线回归目标**，不是漏网的活代码。
⇒ 要真删，得先把 P6 那 10 条改写成"冻结 oracle 的测试内副本"（像 `legacyHoverItemsOf` 那样），
   并把 registry-shim 的 P6 快照指向活抓取器；本轮不做（风险大于收益）。

`buildPoolHover` / `buildEventHover` 现在也**没有生产调用方**了（emit 分支删掉后），但**故意保留**：
`test/cases-p3.mjs` ① 拿它们当"改造前手拼排版"的逐字节参照、`test/cases-tz.mjs` ① 用它们验 tz 口径、
`test/cases-rule-lint.mjs` 的静态守卫把它们当排版唯一真源（调用点必须传 tz）。删了这三处守卫一起失效。
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

### 悬停档期：原文 vs 格式化（2026-11-09，用户口径）

用户原话："**只有两种情况：raw 能完整解析成两端绝对时刻 ⇒ 格式化；否则 ⇒ 原文**"。实现只有两分支，在 `26-parser-hover.js` 的 `hoverWindowTextOf`：

1. `raw` 里含**相对表述** ⇒ 悬停**逐字写 raw**（即使两端 ts 都已锚定）。判据只有一份词表 `HOVER_RELATIVE_WINDOW_RE`（`版本更新后 / 版本结束 / 更新维护后 / 维护后 / 维护结束后 / 开服后 / 即日起…`，`hoverRawIsRelative` 是同一份判据的函数形态）—— 调用点与回归都不许另写一份。
2. 否则（`raw` 缺失，或两端本来就是绝对时刻）⇒ 现状 `fmtWindow(startTs, endTs, tz)`；缺时刻退回 `raw`。

为什么：相对起点在解析阶段被**锚**成具体时刻（星铁 10:00 / 无期迷途 14:00 / 维护窗口结束 / 公告发布时刻），格式化等于把"这是我们推的"印成"源站明说的" ⇒ 信息丢失（`2026/09/28 4.6版本更新后 - 2026/11/10 15:00` 被印成 `09-28 10:00 ~ …`）。`raw` 两端本来就是绝对时刻的（**FGO / 物华弥新 / 原神**…）**不受影响、悬停逐字不变**。

有意变化（悬停里的档期行由格式化改成源站原文）：**星铁**（官方 CMS / 米游社 / bwiki 备选）、**绝区零**、**战双帕弥什**（卡池 3 池同窗口 ⇒「末尾写一遍」那一行也走两分支）、**BanG Dream**、**少女前线2**、**星塔旅人**。**无期迷途没变** —— 它的 `wqmtWindowOf` 在**解析阶段**就把「开服后」写成锚点时刻（`raw` 里已经不含限定词）。**数组侧不变**：`50-refresh.js` 的数组派生仍用 `dataArrayWindowTextOf`（旧口径），因为数组的 `raw` 要被 `dataArrayWindowOf` 反解析回 ts，源站措辞解析不了。

> ⚠️ 2026-11-09 后续（同一轮）：上面这句「无期迷途没变」**已过时** —— `wqmtWindowOf` 在解析阶段丢掉「开服后」正是下一节修掉的那条。现在无期迷途、夜幕之下与整个 bwiki 通用层的悬停都印源站原文（数组侧口径不变，仍见上一段）。

### bwiki 通用层：`raw` = 源站原文、`display` = 补全文本（2026-11-09）

与星铁 `parseHsrWarp`（`30-game-hoyoverse.js`）同一套「条目事实」写法：解析器给每条事实都带
`{ ..., startTs, endTs, raw, display }`，两个文本字段**各管一件事**、**不许合并**：

- `raw` = 源站**原文**那一句。相对表述（`开服后 / 维护后 / 更新后 / 版本更新后 / 即日起`）**原样保留**，
  推断出来的钟点**不许**写进来；分隔符统一成 `~`；日期写法按来源原样（bwiki `2026年09月30日 10:00`、
  无期迷途 `11-11 开服后`）。
- `display` = **补全后**的可读文本（`MM-DD HH:MM ~ MM-DD HH:MM`，`fmtWindow` 按源站 tz 渲染）。源站只给
  日期 / 只给「开服后」时的补全规则在 `ns_bwiki_windowsFromCell`（缺时刻 00:00 / 23:59）与
  `wqmtEndOfPoint`（维护窗口结束 / 常量 14:00）里，逐条写在函数注释里。

载荷与悬停**各取一份**（谁也不许再让两个键取同一个值）：

| 出口 | 取哪一份 | 落点 |
| --- | --- | --- |
| `bannerDates` / `eventDates` | `display` | `ns_bwiki_gachaPayload` / `ns_bwiki_batchGachaPayloadOf` / `ns_bwiki_eventPayload` / `wqmtEventPayloadOf` |
| `bannerDatesRaw` / `eventDatesRaw` | `raw` | 同上 |
| 悬停 `hoverItems[].raw` | `raw` | `hoverTextFromItems` → `hoverWindowTextOf` 见相对词就印原文 |

两份文本的产出点只有两处：`30-game-bwiki-common.js` 的 `ns_bwiki_windowsFromCell`（一次给
`raw` + `display` + `startText`/`endText`），以及 `30-game-wqmt.js` 的 `wqmtWindowOf` /
`wqmtEndOfPoint`（`text` = 补全、`rawText` = 原文）。各游戏解析器只把它们原样搬进条目；
`30-game-bwiki-wikitext-common.js`（战双 / 卡厄斯 / 雪松）本来就 `fmtWindow` 出 dates、`first.raw` 出 Raw，
自动符合本约定，**不需要逐款改**。

为什么必须分开：`hoverRawIsRelative` 只认原文里的相对词。`raw` 一旦被写成补全后的 `14:00`，悬停就
再也判不出"这是开服后、钟点是我们推的"，面板会替源站"声称"一个它没给过的时刻（用户实测：无期迷途
显示 `10-27 14:00 ~ …` 而不是原文 `10-27 开服后 ~ …`）。回归见 `test/cases-new5.mjs` 的
「11-11 批在期：三段文本」与 `test/cases-hsr-official.mjs` ④ 的两条无期迷途断言。

⚠️ **数组侧口径不变**：主条 `raw` 直接取 `*DatesRaw`（源站原文），并列条的 `raw` 仍由
`dataArrayWindowTextOf` 从 ts 派生（它要被 `dataArrayWindowOf` 反解析回 ts，源站措辞会让 ts 变 null）。
所以数组里"主条原文 / 并列条派生文本"**有意不同**，`startTs`/`endTs` 逐条不变。


### 数据层数组（P1）/ 派生层（P2）/ 解析器直出（P3，2026-11-07）

**方向**（用户原话）：数据核心只放"事实"；"谁排第一"是**纯展示决策**，下移到显示层；表格与探头**共用同一份数组**（探头只是会动的 UI 组件，零数据语义）；面板对用户的行为保持等效。

**P1（数据层，已完成）**：**不动任何解析器**，在数据流入 `lastData` 前的那一层（`50-refresh.js` 的 `mergeEntryRecord`）从**现有字符串字段合成**两个数组；旧字符串字段一个都不删、值一字不改。数组顺序 = 结束时间升序（与悬停同口径），**不挑选"第一条"**。

**P2（派生层，已完成）**：显示层改读这两个数组 —— 表格那一行 = `sideViewOf(...).primary`、探头 = `.rest`，两处共用同一份数组；**不再解析悬停文本**（悬停 tooltip 仍读 `bannerHover` / `eventHover`，那是 P3 的事）。派生规则与兼容退化见下面「派生层（P2）」一节。

**P2 收尾（2026-11-07，方案 C「补事实、不藏差异」）**：数据层补了 `source` / `category` / `tags` / `preview` 四个事实字段，判重改为"引擎主行 + 悬停并列行各一条"；显示层加了**按游戏分派的规则表**；FGO 解析器额外给一份 `itemFacts`（类别通道）。结果是 34 个侧与改造前**逐字相等**（已知差异清零）。

**P3 第一批（2026-11-07，已完成）**：方向倒过来了 —— **解析器直接产数组**（真源），悬停字符串改由**同一份条目**反生成（不再手拼、也不再从文本反解数组）。本批只切 **3 款 6 条路径**（原神卡池+活动 / 明日方舟卡池+活动 / 鸣潮卡池+活动），其余 25 款仍走 P1 的合成路径（见下面「解析器直出（P3）」与「P3b 待办清单」）。

#### 字段形状（每个游戏都有）

```js
gacha:  [{ key, title, show, roles: string[], startTs, endTs, tz, raw, source,
           category?, tags?, preview?, longTerm? }]
events: [{ key, title, show, startTs, endTs, tz, raw, source,
           category?, tags?, preview?, phase?: { kind: "claim", startTs, endTs, show } }]
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
| `category` / `tags` | **类别事实**（可缺）：解析器知道类别时经 `itemFacts` 通道带进来（2026-11-08 起 9 款有来源，逐款见下文「category / tags 来源与现状」表）；**取不到就没有这个键**（不猜、不写空值）。多值来源（原神 SMW 的数组、绝区零/星铁「类型」列按 `<br />` 拆）⇒ 首项 `category`、其余 `tags` |
| `preview` | **预告稿标记**（可缺）：标题命中 `/予告|coming soon/i` 时为 `true`（与赛马娘老实现 `previewRank` 同一判据，见 `30-game-cygames.js:392`） |
| `phase` | 活动的**第二阶段**（明日方舟「奖励领取/兑换截止」）：只有来源给了 `eventClaimDates` 才有这个键。它是**一条独立的截止窗口**，不是第二个活动条目 |
| `longTerm` | P1 **不合成**（可选字段，留给结构化来源；归一函数会原样透传） |

**顺序 = 自然顺序（结束时间升序，与现有悬停一致），数据层不挑选"第一条"。** 外显哪一条由**显示层**决定（P2 起是 `sideViewOf`，见下）；`test/cases-core.mjs` ④-4 用赛马娘国服夹具钉住反证：外显那条（10-07 结束）在数组里排第 3，第 1 条是结束最早的「第1轮」。

#### 谁生成（`src/client/50-refresh.js`）

- `mergeEntryRecord(r, prevRec, nowTs, meta)` 末尾两行：来源若已给结构化数组就原样用（**P3 第一批起 3 款 6 条路径由解析器直出**，见下节），否则 `dataArrayGachaOf` / `dataArrayEventsOf` 合成。`meta = { id, tz }` 由 `engine-api.js` 的 `refresh()` 从条目上带进来（只用来生成 key 与 `tz` 字段）。
- **并列池怎么展开**（P2 收尾改了判重口径；⚠️ **P3c 起这段是历史**：合成器已删，现在并列条来自解析器直出的条目事实，判据仍是这三条）：当时复用显示层同一个 `scheduleHoverItems`（`bannerHover`/`eventHover` 的多行文本 → `[{ title, win }]`），再用 `dataArrayHoverPoolsOf` 里那三条判据（与外显同名 / 与**显示名**同名 / 「池名：外显名」这种整段包裹写法）—— 与 `81-schedule-model.js` 的 `scheduleHoverOnes` **逐字对应**。
  - ⚠️ **判重口径（2026-11-07 用户定，方案 C）**：不再按「起止时间 + 池名」把同一口池并成一条 —— 那是 P1 自己发明的判据，旧探头从来没有，它一直把「合并角色的主行」和「`池名：角色`」并列显示（物华弥新「繁霜春落：李小孩项链」、星铁「「我身即刃」…：千冶•刃」就是这么被丢掉的）。现在**引擎主行一条 + 悬停并列行各一条**，`source` 区分；只有"内容完全一样"（同标题 **且** 同起止）才去掉一条，并且**优先保留 `source:"primary"`** 那条。
  - ⚠️ `scheduleHoverItems` 当时在 2026-11-07 从 81 **逐字搬进 26-parser-hover.js**（`50-refresh.js` 也在 core 产物里，而 81 只属于渲染层）。**P5 清理（2026-11-08）它已从产品删除**：那两条区间正则与判据现在冻结在 `test/lib-text.mjs` 的 `legacyHoverItemsOf`（只给回归用）；`scheduleNoYear` 留在 26（`dataArrayExtrasFromEntriesOf` 仍在用）。
  - 两条区间正则的**起端也认「X.Y版本更新后」**（不是只有两端日期）：星铁 bwiki 把这种原文直接写进悬停（`「巡星之礼」第二十七期   4.6版本更新后 ~ 11-11 03:59`），不认就会把档期拼进**事件标题**。普查结论：其它 27 款的「版本更新后」已在各自解析器里折算成绝对时刻、悬停原文不含版本标签 ⇒ 只影响星铁（`test/cases-core.mjs` ④-9 有针对性断言）。注意这只影响**悬停逆解析**，`fillMissingStarts` / 「版本更新后」的换算一个字没动。
  - 解析不出并列池（`bannerHover` 为空 / 只有 1 条）⇒ 就 1 条，与今天显示等价。
- **归一**：`dataArray*ItemOf` 只做最少校验 —— 非对象元素**丢弃**、`startTs`/`endTs` **必须是 number 否则 `null`**（`"123"` / `NaN` / `Infinity` 全变 `null`）、文本字段缺了填空串、`roles` 不是数组就 `[]`、`source` 缺了填空串。**可选事实**（`category` / `tags` / `preview`）**有就原样保留、没有就不写这个键**（`preview` 只认 `true`，`tags` 空数组/`category` 空串都不产生键）⇒ `getCached()` 往返后事实不丢、也不会多出空值。缺数组（改造前的老缓存）⇒ **空数组**，形状固定。

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
| `sideViewOf(items, now, side, gameId?)` | 数组 → `{ primary, rest }`（`primary` = 这一格外显的那条，`rest` = 其余、**保持数组原顺序**；数组空 ⇒ `primary = null`） | 第 4 个参数命中**按游戏分派表**（见下）⇒ 走特化规则；**不传 gameId = 通用规则**：<br>**event**：`25-parser-order.js` 的 `pickEventPrimary`（claim 优先 → 类别档位（`category`/`tags` 读得到就用）→ endTs → startTs）。数组条目叫 `title`、`phase` 是对象 ⇒ 调用前做一层**只读适配**（`name = title`、`phase = phase.kind`），规则本体一个字不改。<br>**gacha**：`24-parser-window.js` 的 `selectCurrent` 的**时间口径** + 2026-11-09 用户拍板 B 的**角色优先** —— ① 只在**在期**的池里挑（`endTs >= now` 且起点缺失或 `<= now`，起点缺失 = 源站写「X.Y 版本更新后」⇒ 视为已开始）；② 在期的里**优先有角色的池**（`roles` 非空；`string[]` 与 `string` 两种形状都认，见 `scheduleHasRoles`）；③ 同一档里取**结束最早**；④ 并列按起点升序；⑤ 一条都不在期 ⇒ 取数组首条（= 结束最早的那条，不凭 now 另造） |
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
| `fgo` | event | `schedulePickFgoEvent`：覆盖 now → 类型档位（`category` = `Event` 压过 `Campaign`）→ `endTs` → `startTs` | `ns_fgo_pickRow`（`30-game-aniplex.js:139-150`） | 档位来自**源站第 4 列类型**（`Event` 不在 `EVENT_TIER1_RE` 里）⇒ 09-05 那侧会选 Campaign 的「3200万下载突破纪念活动」而不是 Event 的「失落的创世…」 |

`category` / `tags` 的来路：解析器若知道类别，额外返回 `itemFacts = { "<条目标题>": { category?, tags? } }`，数据层按标题贴到数组条目上（2026-11-08 起 9 款提供 `category`，其中终末地/原神/绝区零/星铁还给多值 `tags`；逐款见下文「category / tags 来源与现状」表）。取不到就**没有这个键**，显示层相应规则按"无类别事实"退化（不猜）。`preview` 由数据层按标题判据生成（`予告`/`coming soon`）。

**已知差异已清零**：`test/cases-core.mjs` ⑤-5 的等价性普查（17 款 / 34 个侧）现在 `diffs = 0` —— 原来 6 处（物华 gacha 少一行、星铁 gacha 少一行、物华/战双/赛马娘国服外显换位、赛马娘日服 gacha 换位）全部逐侧钉成**严格相等**；另有**反向证明**：把任一特化规则换回通用规则（`sideViewOf` 不传 gameId）⇒ 对应侧必红（实测把 `uma-jp` 与 `zspms:event` 两行从分派表拿掉时，⑤-5 立刻红在这两个侧；FGO 用 09-05 那侧单独钉住）。

**显示层（`src/client/82-schedule-view.js`）**：`cells` 存**数组本身**（`cells.set(key, g.gacha / g.events)`，与探头共用同一份）；`cellViews` 存派生结果；表格那一行 = `primary` 经 `scheduleNormalize` 渲染（主条直接走它 ⇒ 档期文本与今天**逐字一致**），探头 = `sideViewOf(...).rest`（内部先后仍是今天的 `schedulePickItem`）。2026-11-10 用户要求：**底部失败横条 + 「重试」已删**，失败信息并入刷新横幅的悬停明细（见「刷新横幅的汇总口径」一节）。

**兼容退化（P3c 起，2026-11-07 已删老路）**：`scheduleCellOf` **只读数据层数组**；数组为空（老 `lastData` / 这一侧真没数据）⇒ 返回 `null`，格子里写「该来源无数据」，**不抛错**。原来的 `fromArray === false` 兼容分支（`scheduleNormalize` + 逆解析悬停文本）连同 `scheduleHoverOnes` 已随 P3c 删除 —— 它已没有任何生产调用方（28 款默认源全部直出）。抓取失败时"显示旧数据"仍走 `mergeEntryRecord` 的沿回逻辑（`dataArrayInheritableOf`），不受影响。

**回归（`test/cases-core.mjs` ⑤，35 条）**：纯函数（空 / 单条 / 在期里结束最早 / 起点未知 / 并列起点 / claim 优先 / 类别档位 / 顺序稳定 / 不改输入）+ `scheduleItemOf` 同形 + **老 `lastData` ⇒ `null` 且不抛错** + 老路（oracle）输出与数组派生逐字相同 + **等价性普查**（34 个侧全部逐字相等）+ 原来 6 处已知差异的严格相等 + **反向证明**（通用规则与特化规则必须选出不同的那条）+ FGO 09-05 那侧（`category` 事实 + 特化规则缺一不可）。⚠️ 老路已从产品删除；**P5 清理后连老路的 oracle 也删了** —— 它的输出固化成了字面量
（`test/fixtures/legacy-oracle-golden.json` 的 `coreRows` / `coreSyntheticRows` / `coreFgo0905Rows`，
读取器 `test/legacy-golden.mjs`），断言因此是"**当前数组派生 == 冻结的字面量**"。字面量由 HEAD
`d3e9d35` 的 `legacyCellOf` 采出，**不随产品漂移** —— 否则"等价"就成了拿产品和自己比。

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
5. **不足 2 条 ⇒ 空串**（交回 UI 单条展示）；
6. 顺序 = **调用方给的**（卡池侧与 `poolHoverOrderOf` 同口径、活动侧与 `sortEventItems` 同口径）—— 鸣潮卡池悬停的**首行是"卡池活动类型"**（不是任何一口池），必须固定在首位，所以生成器**不排序**。

**已切的路径**（P3 第一批 3 款 6 条 + P3b 六批 + P3c 最后 3 款；**P3c 起 48 条路径全部直出、没有未切款**，见下面「P3 完成状态」）：

| 游戏 | 侧 | 生产者（文件:入口） | 数组条数（真机夹具 2026-11-07） |
|---|---|---|---|
| 原神 `genshin` | 卡池 | `26-parser-hover.js` 的 `bwikiGachaPayload(html, tz, { emitArrays:true, id:"genshin" })`（bwiki 往期祈愿；**星铁仍走老分支**） | 3（主条 + 2 口并列池） |
| 原神 `genshin` | 活动 | `30-game-hypergryph.js` 的 `parseSmwActivity(json, tz, { emitArrays:true, id:"genshin" })`（bwiki SMW `action=ask`，经 `fetchYsActivity`） | 5（主条 + 4 条并列活动） |
| 明日方舟 `arknights` | 卡池 | `30-game-hypergryph.js` 的 `fetchArknightsGacha`（官方公告 CMS） | 1（当期只有一口限时寻访） |
| 明日方舟 `arknights` | 活动 | `30-game-hypergryph.js` 的 `prtsEventPayload`（PRTS SMW 单请求；兑换期在 `phase`） | 3（含 1 条 claim 主条） |
| 鸣潮 `wuwa` | 卡池 | `30-game-kuro.js` 的 `parseWuwaNotice`（官方公告 `recommend` 组） | 4（主条=卡池类型 + 3 口角色池） |
| 鸣潮 `wuwa` | 活动 | `30-game-kuro.js` 的 `parseWuwaRecommendEvents` | 2 |

条目形状 = 记录里数组条目的形状（`title` / `show` / `roles?` / `startTs` / `endTs` / `tz` / `raw` / `source`，可选 `category` / `tags` / `preview` / `phase`）。`source:"primary"` = 引擎挑出的外显那条，其余 `"hover"`。

**P3b 进度（2026-11-07，逐批切换，每批独立 commit）**：目标 = 其余 25 款全部直出。回归在 `test/cases-p3.mjs`
的 P3b 段（路径表 `P3B_PATHS` + golden 文件 `test/fixtures/p3b-golden.json`；golden 于切换**之前**用
`node test/cases-p3.mjs --capture-p3b` 采集，**只补缺、不覆盖**，见该文件注释）。

| 批次 | 游戏（侧） | 生产者 | 数组条数（夹具） | 状态 |
|---|---|---|---|---|
| P3b-1 | 星铁 `hsr`（卡池 / 活动）、绝区零 `zzz`（卡池 / 活动）、崩坏3 `bh3`（活动；米游社备选）、米游社卡池（4 个 gids 共用） | `bwikiGachaPayload`（hsr 叠 `dedupeRoleNames`）、`genericEventPayload`（生成器补 `permanentCount`）、`fetchZzzGacha` / `parseZzzEventsOfficial`、`ns_miyoushe_{gacha,events}Miyoushe` | 5 / 3；1 / 3；1；1 | ✅ 已切 |
| P3b-2 | 物华弥新 `wuhuamixin`（卡池 / 活动）、战双帕弥什 `zspms`（卡池 / 活动）、卡厄斯梦境 `czn`（卡池）、雪松 `kedr`（卡池 / 活动） | `30-game-bwiki-wikitext-common.js` 的两个载荷（`ns_bwiki_wikitext_{gacha,event}Payload`）、`30-game-bwiki-common.js` 的两个载荷、`ns_biligame_activity_eventsWhmxOfficial` | 6 / 8；4 / 9；4；2 / 3 | ✅ 已切 |
| P3b-3 | 嘟嘟脸恶作剧 `ddlezj`（卡池 / 活动）、闪耀优俊少女国服 `uma-cn`（卡池 / 活动）、赛马娘日服 `uma-jp`（卡池 / 活动）、赛马娘国际服 `uma-global`（卡池 / 活动；活动侧这份 golden 是**官方公告**那版——夹具里无当期数据 ⇒ 只守空载荷，2026-11-14 起默认源换成 GameTora、这条 golden 改走备选源，见下面 2026-11-14 一节） | `ns_biligame_announce_{gacha,events}Ddlezj`、`ns_biligame_activity_{gacha,events}UmaCnOfficial`、`ns_umamusume_official_{gacha,events}UmaJpOfficial` / `...UmaGlobal`、`ns_cygames_gachaGameToraUma` | 2 / 3；1 / 1；2 / 3；1 / 0 | ✅ 已切 |
| P3b-4 | BanG Dream! `bandori`（卡池 / 活动）、PJSK `pjsk`（卡池 / 活动）、OurNotes `ournotes`（活动）、OurNotes 国际服 `ournotes-global`（活动） | `ns_bandori_{gacha,events}Bandori`、`ns_sekai_{gacha,events}Sekai`、`ns_ournotes_eventsOurNotes`、`ns_ournotes_global_{gacha,events}OurNotesGlobal` | 1 / 16；17 / 1；1；1 | ✅ 已切 |
| P3b-5 | Fate/Grand Order `fgo`（卡池 / 活动）、少女前线2 `gf2`（卡池 / 活动）、P5X `p5x`（卡池 / 活动）、异环 `nte`（卡池 / 活动）、星塔旅人 `stellasora`（卡池 / 活动） | `ns_fgo_{gacha,events}Fgo`、`ns_gf2_{gacha,events}Gf2`、`ns_p5x_{gacha,events}P5x`、`parseNteWanmei`、`ns_stellasora_{gacha,events}Stellasora` | 4 / 5；1 / 1；1 / 6；1 / 1；2 / 2 | ✅ 已切 |
| P3b-6 | 蔚蓝档案国服 `ba-cn`（卡池 / 活动）、重返未来 1999 `r1999`（卡池 / 活动） | `fetchBaCn` 的两条载荷路径（维护公告日志表 / 列表 `content` 块）、`fetchR99Notice`（游戏内公告） | 1 / 4；3 / 15 | ✅ 已切 |
| P3c | 蔚蓝档案国际服 `ba-global`（卡池 / 活动）、蔚蓝档案日服 `ba-jp`（卡池 + 活动）、终末地 `endfield`（卡池 + 活动） | `fetchGameKeeBa`（两侧各 1 条）、`parseBaJpNews`（日服官网新闻，多池 ⇒ 悬停多行）、`fetchCanmoeEndfield`（canmoe chunk，`canmoePoolHover` → `canmoePoolItems`）、`parseFzWikiActivities`（FZ Wiki 活动） | 1 / 1；3 / 1；3 / 6 | ✅ 已切 |
| P3c 补漏 | 蔚蓝档案国服 `ba-cn` 的**第三条**载荷路径（默认源第①步「维护更新说明」正文 `parseBaCnMaintText`；P3b-6 只切了 ②/③） | `parseBaCnMaintText`（单池单活动、无悬停） | 1 | ✅ 已切 |

**P3 完成状态（P3c，2026-11-07）**：**28 款默认源 / 48 条路径全部解析器直出**（`P3B_SWITCHED_EXPECT = 48`，
路径表里没有 `switched:false`）。兼容层已删（见下面「P3c 删掉的兼容层」）。P3c 的夹具全部**真抓**
（2026-11-07T01:19:55Z，`p3c-*` 共 15 份：GameKee 目录树 / 4 个 detail / CDN 正文、日服官网新闻、
canmoe 页面 + 它第一轮真的并发抓的 6 份 chunk、FZ Wiki 活动 REST），**不进 `map.json`**（沿用 P3 做法）。

**P3c 删掉的兼容层**（`git grep` 可证：`scheduleHoverOnes` / `dataArrayGachaOf` / `dataArrayEventsOf` /
`dataArrayHoverPoolsOf` 在 src 里**只剩注释提及**，没有定义或调用）：

| 位置 | 删掉的东西 | 为什么现在能删 |
|---|---|---|
| `81-schedule-model.js` | `scheduleHoverOnes`（32 行）+ `scheduleCellOf` 的 `fromArray === false` 兼容分支（7 行）+ `fromArray` 字段 | 显示层不再逆解析悬停文本；数组是唯一来源 |
| `50-refresh.js` | `dataArrayGachaOf`（18 行）/ `dataArrayEventsOf`（32 行）/ `dataArrayHoverPoolsOf`（5 行） | 没有解析器再走"从字符串合成"那条路（含 ba-cn 第①条补漏） |
| `82-schedule-view.js` | `cells.set` 的 `view.fromArray ? … : [primary].concat(rest)` 三分支 | 只有一条路径：`cells.set(key, g.gacha / g.events)` |

**老 `lastData` / 缺数组的退化行为（P3c 后的口径）**：`gacha` / `events` 缺数组 ⇒ 归一成**空数组** ⇒
显示层 `scheduleCellOf` 返回 `null` ⇒ 该格写「该来源无数据」，**不抛错**；抓取失败但上一轮有数据 ⇒
仍按 `dataArrayInheritableOf` 沿回上一轮的数组（"显示旧数据"）。`test/cases-core.mjs` ⑤-4 有针对性断言
（老缓存 ⇒ `null` 且不抛错）。⚠️ P3e 之后**已经没有"未切直出"的生产者**（28 款默认源 / 48 条默认路径 +
全部备选源 + 用户自定义地址都直出）；这条退化只剩"老 `lastData` / 这一侧真没数据"两种情形。

**收口的两点补充（P3b）**：① 生成器 `hoverLinesFromItems(items, kind, tz, { permanentCount })` —— 活动侧
末尾补 `以及常驻活动 N 项`（与 `buildEventHover` 同一句 `permanentLine`，不足 2 条时也带上）；
② `mergeEntryRecord` 收到解析器数组后**统一归一 + 按记录 id 重发 key**（`dataArrayProducedListOf`）——
解析器不必知道 `meta.id`（通用源 / 自定义条目拿不到），key 前缀由数据层裁成 `<id>:gacha:i`；③ `dataArrayExtrasFromEntriesOf` 补齐**悬停逆解析的两步口径**（不足 2 条 ⇒ 无并列条目；归一后同名只留第一条）—— 否则「解析器直出的数组」会与「从同一份悬停文本反解的数组」不一致（ddlezj 的「…（商店兑换时间）」、uma-cn 只有 1 条期间，就是这两条判据）。
**数据层收口**（`src/client/50-refresh.js`，P3 只加函数、不改语义）：

- `dataArrayProducedItemOf(raw, kind)` —— 解析器条目 → 记录条目（**复用**持久化白名单那份 `dataArray*ItemOf`，键顺序因此与 `getCached()` 往返一致；并按合成路径同一判据补 `preview`）。
- `dataArrayProducedListOf(list, prefix)` —— 排序 + 发 `key`（`<id>:gacha:<i>` / `<id>:event:<i>`）；**先摘掉条目上可能已有的 `key`**（`Object.assign` 会把刚发的 key 覆盖成空串）。
- `dataArrayExtrasFromEntriesOf(entries, main, now, { kind, tz })` —— 并列条目的**唯一实现**（三条判据 + "同标题同区间"去重）；解析器直出路径调它（P3c 之前还有一条"把悬停文本拆成 `{ title, win }` 再喂进来"的 `dataArrayHoverPoolsOf`，已删）⇒ 不会出现"文本里丢了两行、数组里还留着"。
- `mergeEntryRecord` 现在**只有一条路**：归一 + 按记录 id 重发 key（P3c 删掉了 `Array.isArray(rec.gacha) ? … : dataArrayGachaOf(…)` 那半个分支），末尾把 `gachaHoverItems` / `eventHoverItems` 两条**通道** `delete` 掉（与 `itemFacts` 同一性质：不进记录、不落盘）。

**时间戳口径（P4 已改，见「P4 展平」一节）**：`startTs` / `endTs` 现在是**绝对时刻**（`dataArrayWindowOf` 按**条目自己的 tz** 解析源站墙钟）。P3 阶段这里是 P1 的"本机时刻"，换绝对时刻必须**同时**改显示层渲染（`scheduleMeta` 按 `x.tz` 渲染），否则 34 个侧在 `TZ=UTC` 下会变红 —— 那是 P4 的活，已做（见「已知不等价①」的收尾说明）。

**回归（`test/cases-p3.mjs`，P3e 后 685 条）**：① 生成器排版规则逐条（3 空格 / 同窗口折叠 / <2 条 / 缺起止写原文 / `label` 优先 / 去重 / **与老 `buildPoolHover`·`buildEventHover` 逐字节相同**）；② 54 条路径（P3a 6 + P3b 41 + P3c 7）的 **12 个字符串字段 + 数组 golden**（`sansTs`）；③ 数组与**改造前的合成结果逐条相等**（含 `startTs`/`endTs`，UTC / +08 都成立）；④ **同源**：`hoverTextFromItems(条目事实)` 逐字等于载荷里的悬停文本；⑤ 通道不外泄。P3 新夹具 6 份 + P3c 15 份，**都不进 `map.json`**（免得改变其它批次对"默认源 404"的期望）。
⚠️ P3c 删掉合成器后，③ 的对照 oracle 挪进测试文件（`legacySynthArrOf`：拿**记录字符串 + 悬停文本**过 `dataArray*MainOf` + `scheduleHoverItems` + `dataArrayExtrasFromEntriesOf` 重算一遍）—— 它只读改造前的三样输入（字符串 / 悬停 / `itemFacts`），不读解析器直出的数组，所以"直出被削"仍会红（P3c 实测：把 endfield 卡池的并列条去掉 ⇒ ② 数组 golden + ③ 同时红）。
⚠️ **P5 清理（2026-11-08）后 ③ 的 oracle 也不在了**：`legacySynthArrOf` 的输出固化成字面量
（`test/fixtures/legacy-oracle-golden.json` 的 `p3Synth`，键 = `<路径 key>:<side>`，共 124 条），
`cases-p3.mjs` 里同名函数改成**按 key 查字面量**（缺键直接抛错，防止覆盖不全悄悄变绿）。

**反向证明**：把生成器的分隔符从 3 个空格改成 2 个 ⇒ `test/cases-p3.mjs` ①（`名称   + 3 空格`）与 ②（原神/明日方舟活动 golden）同时红；把 `dataArrayExtrasFromEntriesOf` 的三条判据去掉一条 ⇒ ② 的数组 golden 红。这是"悬停/数组同源"真的承重的证据。

#### P3 收尾状态（P3c，2026-11-07）

**28 款默认源 / 48 条路径全部直出**（P3a 3 款 6 条 + P3b 22 款 41 条 + P3c 3 款 6 条 + P3c 补漏 1 条）。
最后 3 款：`ba-global`（GameKee 609133 单源）、`ba-jp`（日服官网新闻，多池 ⇒ 悬停多行）、`endfield`
（canmoe chunk + FZ Wiki 活动）。**P3c 补漏**：`ba-cn` 的默认源第①步（「维护更新说明」正文
`parseBaCnMaintText`）P3b-6 漏切了 —— 它是被 `test/cases-core.mjs` ⑤-5 的 ba-cn 两侧红线抓出来的
（数组为空、老路非空 ⇒ diffs 里出现 `ba-cn:gacha` / `ba-cn:event`），补切后 34/34 恢复 `diffs = 0`。

**兼容层已删**（详情见上表）：`scheduleHoverOnes` / `scheduleCellOf` 的 `fromArray === false` 分支 /
`dataArrayGachaOf` / `dataArrayEventsOf` / `dataArrayHoverPoolsOf` 全部不存在了（`git grep` 只剩注释提及）。
老 `lastData` / 缺数组的退化 = **空数组 ⇒ 该侧「无数据」，不抛错**（P3e 起没有"未切直出"的生产者了）。

**P3d（2026-11-07）：备选来源已全部直出**。P3c 删掉合成器后，`altSources` / `eventAltSources`
（设置页**手动切源**时才走）里还有一批只产字符串 ⇒ 数组恒 null ⇒ 切过去那一侧显示「该来源无数据」。
本轮按同一个三段式（条目事实 → `hoverTextFromItems` → `dataArrayProduced*Of`）补齐 11 条备选路径
（8 组）：`arknights-prts`（PRTS 卡池一览）/ `arknights-event-list`（PRTS 活动一览）/
`wuwa-bwiki` / `wuwa-event-bwiki` / `zzz-bwiki` / `ba-global-nexon`（卡池+活动）/
`endfield-gachatracker` / `endfield-wiki-gg` / `endfield-game8` / `r1999-official`（卡池+活动）。
夹具 13 份（`test/fixtures/p3d-*`，**不进 `map.json`**，用例里用 `urlsOf` 就地映射），12 份真抓、
`p3d-wuwa-pool-bwiki` 手工构造（线上版式把角色列在计时器之前，宏内有说明）。golden =
`test/fixtures/p3d-golden.json`，由 `--capture-p3d` 在**切换前**采集（`git stash` 掉 src 再 build）。
`ba-global` 的**活动**侧在 P3c 就已经直出、且它的悬停文本/数组次序**随运行环境时区变**（`parseBaLogRows`
造本机墙钟、悬停却按 `tz` 渲染 ⇒ 非 UTC 机器整段偏 8 小时）—— 这是 P3d 之前就有的缺陷，本轮只断言
"数组非空 / 同源 / 切源后能渲染"，**不钉 golden**（钉了只会让 UTC 门禁红在与本批无关的地方）。

**回归规模**：`test/cases-p3.mjs` 54 条路径 × ① golden（12 字符串 + 数组非时间字段）/ ② 与合成结果
逐条相等（含 ts）/ ③ 同源（悬停 == `hoverTextFromItems(条目事实)`）三层断言；
`P3B_SWITCHED_EXPECT = 48` 让"切了没登记 / 登记了没切"都会红（现在没有未切路径）。
**P3d 追加**：11 条备选路径 ×（golden / 与合成结果逐条相等 / 同源 / 数组非空）+ **端到端手动切源**
（设置存储 `customUrls` / `customEventUrls` 写备选源标识 → `engine.refresh()` → `scheduleCellOf` 非 null，
即面板不再是「该来源无数据」）+ 注册表一致（用的就是设置页会选中的那个 fetcher）。

**P3e（2026-11-07）：自定义地址 + 全部备选源直出（P3 完成）**。P3d 之后还剩两类"只产字符串 ⇒ 数组恒 null
⇒ 切过去显示「该来源无数据」"的路径，本轮全部按同一个三段式（条目事实 → `hoverTextFromItems` →
`dataArrayProduced*Of`）补齐：

- **用户自定义地址**（`custom:<url>` / 自定义条目 / `allowGeneric`）：`tryParseGenericGacha` 的三条通用分支
  （`parseAllBwiki` 表 / `parseArknights` 轮换表 / `collectGenericGacha` 普通 HTML 表，前两条与末位兜底统一走
  新收口 `genericGachaPayloadOf`）与 `genericEventPayloadFromHtml`（含"两侧同址、活动侧复用卡池那次 HTML"分支）
  现在都直出 `gacha` / `events`。主条仍取自 `selectCurrent` 的字符串字段（值一字不改）；并列条目 = 覆盖当前的
  主池 / 活动 ⇒ **自定义地址第一次有悬停**（此前恒空），悬停与数组同源。解析失败（任意站、HTML 不匹配）照旧
  **不抛错**、该侧空数组（面板写失败/未命中，与今天一致）。
- **最后 5 条备选源**：本批点名的 `bandori-bestdori-gacha`（Bestdori 扭蛋）、`uma-jp-umapyoi`（赛马娘日服
  umapyoi）；**穷尽普查另抓出 3 条**同样只产字符串的：`bandori-bestdori-event`（Bestdori 活动）、
  `uma-global-gt`（赛马娘国际服 GachaTracker 英文）、`nte-ldshop`（异环 LDSHOP）。后两条与"终末地 GachaTracker
  / 鸣潮 Bwiki"同一口径（本源**没有**悬停 ⇒ `entries` 传空数组，只补"能显示"、不扩事实）。
- **独立 bug（`nte-ldshop` 真机 `base.getTime is not a function`）**：`parseLdshopRange(raw, now, tz)` 唯一的
  调用方 `parseLdshopPools` 传的是 `nowMs()`（数字），函数里却当 `Date` 用（`base.getTime()`）。修法只做类型归一
  （Date / 毫秒数都收，缺省仍走注入时钟），**时间口径一个字不动**。
- **顺带抓出的路由 bug**：8 个**活动备选源**登记成 `{ default: fn }`（genshin/hsr/zzz/bh3 的米游社、
  bandori/ournotes-global 官网、`uma-jp-bwiki`、`stellasora-bwiki`），而 `eventFetcherFor` 直接返回该对象 ⇒
  `await fetcher(...)` 抛 `fetcher is not a function`（切过去只看到「抓取失败」）。现在 `eventFetcherFor`
  统一解包成函数（两种登记形状都认）。
- 夹具 8 份（`test/fixtures/p3e-*`，**不进 `map.json`**）：`p3e-bandori-bestdori-gacha` / `p3e-bandori-bestdori-event`
  / `p3e-uma-umapyoi-gacha` / `p3e-uma-global-gt` / `p3e-nte-ldshop` 真抓（2026-11-07）；`p3e-custom-bwiki-html` /
  `p3e-custom-events-html` 是从现有真抓夹具抽出的 `parse.text`（自定义地址走"非 api.php 的普通 HTML"路径），
  `p3e-custom-nomatch` 手工构造（故意无表格）。回归在 `test/cases-p3.mjs` 的 P3e 段（① 自定义地址端到端 +
  解析失败不抛错；② 5 条备选路径 × 数组逐条相等（含 ts）/ 悬停同源 / 路由可调用；③ 切源端到端；④ nte-ldshop
  夹具级回归；⑤ 全部备选源路由可解出函数）。**"数组与改造前合成结果逐条相等"的口径不变**：对照 oracle 现在是
  冻结的字面量 `legacySynthArrOf`（`test/fixtures/legacy-oracle-golden.json` 的 `p3Synth`；P5 清理前由
  改造前的合成器采出，只读改造前的字符串 + 悬停，不读直出数组）。

**P3 待办清单（P3e 后仍然没做的）**：
1. ~~**时间戳换绝对时刻（P4）**~~ ⇒ **P4 已完成**（见「P4 展平」一节）。
2. **`category` / `tags` / 逐池角色表**：P3 只搬结构、不扩事实。

**P3 完成状态（P3e）**：**28 款默认源 / 48 条路径 + 全部备选源（20 条卡池 / 16 条活动）+ 用户自定义地址
（三条通用分支 + 复用分支）都直出数组**，面板任何一侧都不再因为"没切直出"而显示「无数据」；`test/cases-p3.mjs`
的 P3e ⑤ 有一条普查守卫（全部备选源都必须经注册表解出可调用抓取器）。

**反向证明（P3e 实测，红字见提交说明/会话记录；每条改回后都复跑全绿）**：
① **去掉 `bandori-bestdori-gacha` 的直出**（注释掉 `out.gacha = …`）⇒ `P3e 直出…数组非空（0 条）` /
`P3e 等价…逐条相等` / `P3e 端到端…切源后数组非空（0 条）` / `P3e 端到端…面板那一格能渲染（null）`
**四条同时红**（`结果：681 通过 / 4 失败`）；
② **去掉自定义地址的直出**（`genericGachaPayloadOf` 不再写 `out.gacha`）⇒ `P3e 自定义地址：卡池数组非空（0 条）` /
`P3e 自定义地址：面板卡池那一格能渲染（null）` / `P3e 自定义地址：卡池悬停非空且由条目生成` /
`P3e 自定义条目（两侧同址）：卡池数组非空（0 条）` / `P3e 自定义条目（两侧同址）：两格都能渲染`
**五条同时红**（`结果：680 通过 / 5 失败`）；
③ **把 `parseLdshopRange` 的类型归一改回去**（`const base = now || new Date(nowMs())`）⇒
`P3e 抓取（nteLdshop）：抓取器不抛错（base.getTime is not a function）` / `P3e nte-ldshop：parseLdshopPools 不抛错`
/ `P3e nte-ldshop：解析出 2 口池` 等**五条同时红**（`结果：679 通过 / 5 失败`），红字原文就是用户报的那句。

**P3 反向证明汇总（P3c / P3d / P3e 各自实测）**：见上面三段；共同点是"把直出拿掉 ⇒ 数组 golden /
等价 / 端到端**同时**红"，说明这几条断言是承重的，不是自说自话。

**反向证明（P3c 实测，红字见提交说明/会话记录；每条改回后都复跑全绿）**：
① **改坏直出**：把 endfield 卡池直出的并列条去掉（`poolItems.slice(0,1)`）⇒ `test/cases-p3.mjs`
的 ② `P3b golden（endfieldGacha）：gacha 非时间字段…` 与 ② `P3b 等价（endfieldGacha）…逐条相等`
同时红（③ 同源仍绿 —— 说明数组那一路是独立被钉住的）；
② **改坏反生成输入**：把 ba-jp 卡池条目的 label 从「池名：生徒」改成只有池名 ⇒ golden 的
`bannerHover` 与数组**同时**红（③ 同源仍绿：生成器自洽，抓不住的是"输入被改坏"，只有 golden 抓得住）；
③ **改坏 tz**：GameKee 直出数组的 tz 传成 `Asia/Shanghai`（应 UTC/Tokyo）⇒ `baGlobalGacha` 的数组
golden + 等价（两侧都红）；
④ **把兼容层偷偷加回来**（`scheduleCellOf` 又返回 `fromArray`）⇒ `test/cases-core.mjs` ⑤-4
「有数组 ⇒ 正常派生出主条」与 ⑤-5「等价性前置…没有偷偷长回 `fromArray` 兼容字段」同时红（28 个侧列出）。

**反向证明（P3d 实测，红字见提交说明/会话记录；两条改回后都复跑全绿）**：
① **去掉一条备选源的直出**（`parseEndfieldCurrent` 不再写 `out.gacha`）⇒ `endfieldWikigg` 的
`P3d golden…非时间字段不变` / `数组非空` / `P3d 等价…逐条相等` **以及端到端两条**
（`切源后数组非空（0 条）`、`面板那一格能渲染（scheduleCellOf = null）`）同时红 —— 这正是"手动切过去显示无数据"的机器版。
② **把悬停改成不再由条目生成**（`selectArknights` 的 `bannerHover` 直接给 `""`）⇒ `arknightsPrtsGacha`
的 golden（`bannerHover`）/ 等价（数组少了并列条）/ 同源（悬停 != 生成结果）三条同时红。

#### 已知不等价（P4 已清掉第 1 条；其余留着）

1. ~~**`startTs` / `endTs` 用的是"本机时刻"**~~ ⇒ **P4 已改成绝对时刻**：数组条目的 ts 由
   `dataArrayWindowOf(文本, now, 条目.tz)` 解析（源站墙钟 → epoch 毫秒），显示层按 `x.tz` 渲染回源站墙钟。
   所以同一份数据在 `TZ=UTC` / `+08` 下 **ts 逐字节相同、渲染文本也逐字相同**（不再是"差一个时区差"）。
   收尾代价（如实记）：① `test/cases-core.mjs` ⑤-5 的 34/34 等价性 oracle 同步改成"源站绝对时刻 +
   按源站 tz 渲染"（否则比的是旧缺陷与新行为）；② 星铁那 3 条「版本更新后 ~ …」的单边窗口现在也出条目
   （见 P4 一节的"单边窗口"）；③ 48 条路径的数组 golden 只动了 `hsrGacha` / `hsrEvent` 两条的
   `endTs: null → number`（单边窗口的直接结果）。
2. **并列池的 `show` = 标题本身**：悬停行只给"池名：角色"，没有结构化角色表 ⇒ 并列池那条 `show === title`、`roles = []`（主条的 `show`/`roles` 是完整的）。解析器直出每口池的角色表后可补（P3b）。
3. **卡池侧"跨池合并的角色表"没有拆开**：主条的 `roles` 仍是引擎给的那串合并角色（FGO 那种 13 个角色一行），不是"每口池自己的角色"。同样是 P3 的结构化来源才能拆。
4. **完全同名的悬停行只留一条**：`scheduleHoverItems`（P5 后只在 `test/lib-text.mjs` 里）对**完全同名**（归一后同串）的行只留第一条 —— 这是悬停解析的既有口径（与 `buildPoolHover` 的去重同源），不是 P1 发明的；数组沿用。**同一口池的两种写法**（合并角色的主条 vs 悬停里的 `池名：角色`）现在**都留着**（`source` 区分），只有内容完全一样（同标题 + 同区间）才去重并优先保 `primary`。

#### P4 展平（2026-11-07 完成）

**P4 与前 3 步的性质不同：这一步允许改变可见输出**（同一游戏的多个在期条目在「近期」里各占一行）。四件事：

**① 数组 ts 换绝对时刻（口径修正）**
- 改前（P1~P3）：`dataArrayWindowOf` 把窗口文本按**运行环境时区**读回 —— 同一份数据在 `TZ=UTC` 的机器上比 `+08`
  少 8 小时（README 的「已知不等价①」）。
- 改后：`dataArrayWindowOf(文本, now, 条目.tz)` 三步（都在 `50-refresh.js`，全是既有工具）：
  ① 用 `sourceWallParts(now, tz)` 把 `now` 换成"源站墙钟字段构成的本机 Date"（补年份/判跨年用**源站年**）；
  ② 让 `parseDisplayRange` 照常按本机墙钟解释（它只会有这一个口径）；③ 每个时刻按
  `sourceInstant(墙钟字段, tz)` 平移成**绝对毫秒**（与解析器造 ts、ics 导出同一个函数）。
  ⇒ 数组 ts 跨时区逐字节相同（`cases-p4flat` ① 把同一份 bandori 夹具在 UTC / +08 各跑一遍 refresh 逐字节比）。
- **单边窗口**：源站写「4.6版本更新后 ~ 11-10 15:00」时两端**各自独立解析** —— 起点 `null`（不编造）、终点是
  绝对时刻。星铁 5 条卡池因此 2 条 → 5 条可见（`scheduleMeta` 对起点未知的行只写「至 <终点>」，14 天迷你条只标终点那天）。
- **显示层渲染**：`scheduleMeta / scheduleWhen / scheduleMDHM / scheduleSameDay` 多了可选的 `tz` 参数；
  表格格子 / 探头 / 「近期」/ 留白卡一律传 `x.tz` ⇒ 渲染文本只由 `(ts, 条目 tz)` 决定，**与运行机器时区无关**
  （`cases-p4flat` ⑦ 在进程时区 UTC / +08 / +09 各渲染一遍逐行比对，并钉死两条字面量）。
- ⚠️ **不要**在 `parseDisplayRange` 里加 `tz` 参数：60-helpers 在 core 产物里位于**模块顶层**、15-env 的
  `sourceInstant` 在 `createEngine` 内部 ⇒ 那里 `typeof sourceInstant === "function"` 会静默退化成本机时区
  （2026-11-07 实测：core 产物的数组 ts 全体偏 8 小时，而 lib 是对的，P3 等价性在 +08 机器上红了一大片）。
  换算只能放在 `createEngine` 内的 `dataArrayWindowOf`。

**② 「近期」收全部条目（展平）**
- `81-schedule-model.js` 新增纯函数 `scheduleFlattenOf(games, now)` → `{ cells, cellViews, all }`：
  每侧 `scheduleCellOf` 的 **primary + rest 全部**逐条进 `all`（已结束的除外）；`82` 的 memo 只调它
  （原来那行"只 push 外显那一条"已删）。表格 / 探头仍用 `cellViews`（`sideViewOf` 决定露哪一条）。
- 行数（`cases-p4flat` ②，逐款钉住）：明日方舟 3（活动；兑换期在 `phase` 里不另算）、bandori 1 + 16、
  pjsk 17（卡池）、星铁 5 + 3。7 天窗口不变（`scheduleNear`），变的是"**按条**"而不是"按格"。
- **计数按条**：24 小时 / 7 天两段数字都是对 `all` 数条目（bandori 10-25 那一刻：**2 格却 13 条**在 24 小时内；
  pjsk 10-11：1 格 9 条 / 7 天 10 条）—— 若退回按格，数字会立刻掉到 2 / 1。
- **分页 / 轮播**：「近期」仍是每页 10 条、每 4 秒翻一页（`SCHEDULE_NEAR_LIMIT` / `SCHEDULE_SLOT_SECS` 未变）；
  条数变多只会让 `nearPages` 变大（`ceil(recent.length / 10)`），底部按钮写「展开全部 N 条」的 N 跟着变。
  留白卡（`SlotCard`）的 `list` 也是展平后的 `all`，所以它的 4 秒循环里条目变多（同样是"按条"的直接结果）。

**③ 提醒 / 轮播 / 导出 遍历 N 条**
- `65-remind.js` 的 `remindItemsOf`：**数组非空 ⇒ 逐条派生**（每条活动/每口池各一个 `end`；活动的
  `phase.kind === "claim"` 再额外派生一条 `event-claim` 的 `end`）。数组为空（老 `lastData`）仍走记录字符串路径
  （行为逐字不变）。同一 `T` 的多条在末尾**按 key 去重**（既有口径"同一时刻不弹两条"：bandori 一期 12 个活动
  结束时刻相同 ⇒ 只弹一条）。实测：pjsk 17 条卡池 → 8 条不同 deadline（清空数组只剩 1 条）。
- `81` 的 `tickerItemsOf`：数组非空 ⇒ 每条目一条轮播（`key` 用数组 key，文案用条目的 `show`）。
  **起点未知的条目不进轮播**（`dueKindOf` 要求两端都是 number；不编造开始时刻）—— 星铁 5+3 条里进 4 条。
- `60-helpers.js` 的 `icsEventsOf`：数组非空 ⇒ **每条目一个 VEVENT**（绝对 ts 直接用，不再二次换算）；
  活动条目若带**不同于主窗口**的 `phase` 且兑换截止还没过，再**额外**导出一个「… 兑换截止」事件
  （这是同一活动的第二阶段，不是未来活动）。数组条目 UID 由 `icsFallbackUidOf(摘要, 起, 止)` 生成
  （bandori 同起止的多条靠标题区分，否则会被日历当成同一个事件）；老路径 UID 形态不变。
  起点未知的条目不导出（日历必须两端都有），`skipped` 记 `bad-window`。

**④ 这一阶段改到的既有断言（逐条理由，不是放宽）**
1. `test/cases-core.mjs` ⑤-5 的 oracle：`legacyHoverOnes` 把悬停文本按**本机墙钟**读出的时刻改成
   `sourceInstant(…, 来源 tz)`，并给 oracle 行补 `tz`；行渲染改成 `scheduleMeta(x, now, x.tz)`。
   理由：P4 的 ts 口径是"源站绝对时刻"，老 oracle 继续用本机墙钟 = 要求保留被修掉的 8/1 小时偏差。
2. `test/cases-core.mjs` ⑤-5 星铁卡池行数 **2 → 5**，并新增"3 条单边窗口行文本以「至 」开头"的断言。
   理由：单边窗口（起止各自解析）是本阶段的口径修正，行数变化正是它带来的。
3. `test/arknights-timeline` 的「活动侧 end ≤ 2 条」→"= 在期条目数 + 兑换截止数"（数据驱动），
   「兑换期载荷两个 T 相同 ⇒ 只留一条」→ 在该时刻**仍然**只有一条 `T = 兑换截止` 且没有 `event-claim` 键
   （该载荷里三条活动都在期 ⇒ 总 end 从 1 条变 3 条）。理由：提醒改成按条派生。
4. 数组 golden 只动 `hsrGacha` / `hsrEvent` 两条：`endTs: null → number`（单边窗口），且 `hsrEvent` 顺序按
   `endTs` 重排（`巡星之礼` 11-11 从末位移到第二位）。理由：同上。
5. 其余既有断言一条没改；新用例 42 条（`cases-p4flat`）⇒ 总门禁 4554 → **4596 通过 / 0 失败**（UTC 与 +08 各跑一遍）。

**⑤ P5 待评估项（本阶段**没有**做、也不该顺手做）**
1. **每条活动自己的兑换截止**：`phase` 目前只有**主条目**带（`prtsEventPayload` 只给选中那条活动写
   `eventClaimDates`）⇒ 其余活动的 claim 窗口在数组里没有事实，提醒/ics 自然拿不到。要补得让解析器**逐条**给
   `phase`，并同步数组 golden 与显示层（表格/探头多一行还是仍只显示一条）。
2. **起点未知的条目进轮播 / 导出**：`dueKindOf` 与 ics 都要求两端都是 number。要支持就得改 `dueKindOf`
   （cases-ticker 有"null 起点 ⇒ ''"的旧断言）并决定"日历里 DTSTART 写什么"（拿终点当起点是编造）。
3. **单边窗口的跨年**：`11-10 15:00` 这类终点按 `now` 的源站年份补；真跨年（12 月看 01-05）时单边终点会落到
   过去。要修得给"只有终点"的文本一条与 `endsNextYear` 同级的规则（现在规则只在"两端都在"时成立）。
4. **「近期」页容量**：展平后 7 天窗口内最多可能 20+ 条（每页 10），是否改成 12/15 条或按高度自适应，等真机观感。


**P2 已知差异：已全部清零（2026-11-07 收尾，方案 C）**——原来的 6 处（探头的两行被并掉 + 4 款外显换位）靠"数据层补事实（`source` / `category` / `preview`）+ 显示层按游戏分派规则"消掉了；`test/cases-core.mjs` ⑤-5 的 34 个侧现在 `diffs = 0`，且每条特化规则都有反向证明（换回通用规则 ⇒ 对应侧必红）。各游戏缺什么事实：`category` / `tags` 的**逐款现状见下一节**（P2 收尾时只有 FGO 有 `category`、`tags` 无来源；2026-11-08 的批 1 补齐了 8 款、批 2 又给绝区零开了同一列）、**只有赛马娘日服的预告稿有 `preview`**（标题判据）；这些"没有"都是**如实留空**（没有这个键），显示层按无事实退化，不猜。

### category / tags 来源与现状（2026-11-08，批 1 + 批 2 + 批 3）

**字段名**：这两个字段此前叫 `cat`（缩写），2026-11-08 按用户要求全仓改名为 `category`
（`itemFacts` 的键、数组条目字段、`eventTier` 的读法、`opts.categoryFacts` 开关、测试字面量与 golden 的键名全部跟着改）。
老缓存的条目上可能仍是旧键 —— `dataArrayOptionalFactsOf`（`50-refresh.js`）**读入时把旧键当 `category` 的旧名接受**，
写出只写 `category`（下一次写盘自动迁完；`test/cases-category.mjs` ⑧ 一条用例钉住）。

**这两个字段是什么**：`gacha` / `events` 数组条目上的**可选事实**（形状见 50-refresh.js 的字段表）。
解析器若知道"这一条属于哪个类别"，通过 `itemFacts`（`{ "<条目标题>": { category?, tags? } }`）交给数据层
按标题贴到条目上（`dataArrayAttachFactsOf`）；也可以直接在条目上带 `category` / `tags` 再交给
`dataArrayProducedItemOf`（两条路径写出来的键序完全一样）。**唯一的消费方**是
`25-parser-order.js` 的 `eventTier` —— 它的 haystack 是 **OR 语义**（批 3，2026-11-08 用户拍板）：

```
haystack = [category] + [tags 逐项] + [name]      // 各段有值才参与，段间恰好一个空格
```

也就是 `category`、`tags`、`name` **都参与** `EVENT_TIER1_RE` 匹配（任一段命中即第一档），
再由 `81-schedule-model.js` 的 `sideViewOf` 决定面板那一格外显哪一条。

**为什么从 `category || name` 改成 OR**：旧写法"有类别就不再读名字"⇒ 批 1/批 2 把 `category`
补进数组条目之后，**名字里的档位词失效**，带「全息 / 极限 / 挑战 / 决战 / 深度巡防」的活动被降档
（线上真实行：绝区零「全息强袭战域」「深度巡防-三倍赏金」「极限裁决试炼」、星铁「不要笑挑战」
「酷得走火—宇宙！咻！咻！大挑战！」）。OR 语义把名字命中恢复回来，同时保留 category 的信息。
空值安全：`tags` 为 `null` / 未定义 / 非数组（老缓存、别的游戏）时逐项跳过，任意段缺失都不影响
另外两段，也不会把 `undefined` 拼进 haystack。

**批 3 的有意外显变化（3 条，全部在绝区零；`test/cases-category.mjs` ⑪ 逐条登记）**：

| 窗口 | 改前外显 | 改后外显 | 命中词 |
|---|---|---|---|
| 2025-01-29 ~ 2025-02-08 | 「全新放送」第十一期 / 「若能化作天琴」 / 「美梦如约而至」 | 「决战『金手指』之巅」 | 决战 |
| 2025-06-14 ~ 2025-06-28 | 「全新放送」第十一期 | 「全息强袭战域」 | 全息 |
| 2026-05-20 ~ 2026-05-24 | 「先遣赏金-区域巡防」第十四期 | 「极限裁决试炼」 | 极限 |

另有 2 条**只翻档位、不动外显**（「深度巡防-三倍赏金」2026-08-12~08-16 本来就是外显；
PJSK「这则故事承载着希望」名字里的「故事」命中、但该刻只有一条活动）。批 1/批 2 的 9 款在
**抓取那一刻**的档位与外显**都没变**（`EXPECT_TIER` / `EXPECT_PRIMARY` 一个字没改）。
FGO 的活动外显走特化规则 `schedulePickFgoEvent`（不读 `eventTier`）⇒ 本批对它零影响。

**硬口径（本批定的，后续照做）**：值必须来自**源站现有字段**，拿不到就**不写这个键**（不是空串、也不是猜的词）。

| 游戏 | 源站字段（位置） | 写入形态 | 现状 |
|---|---|---|---|
| 终末地 `endfield` | 活动卡片 `attrs.data.tags`（数组）· `30-game-hypergryph.js` 的 endfield 活动解析 | `tags[]`（itemFacts） | ✅ 批 1 补 |
| 重返未来1999 `r1999` | 公告段标题「『名称』类型」里的**类型** → `sec.kind`（`30-game-bluepoch.js` 的 `parseR1999Overview`） | `category`（itemFacts） | ✅ 批 1 补 |
| 明日方舟 `arknights` | PRTS SMW「活动类型」→ `parseArknightsSmwEvents` 的 `it.category` | `category` | ✅ 批 1 补（有的活动页**没有**这个字段 ⇒ 那条留空） |
| 原神 `genshin` | bwiki SMW 属性「类型」（是**数组**，如 `["角色获取","版本活动"]`） | 首项 `category` + 其余 `tags[]` | ✅ 批 1 补 |
| 星铁 `hsr` | 活动一览表的「类型」列（`22-fetcher-core.js` 的 `collectGenericEvents`） | `category`（多值时首项 + 其余 `tags[]`） | ✅ 批 1 补（只给 `id:"hsr"` 开 `categoryFacts`） |
| 绝区零 `zzz`（Bwiki 备选源） | 与星铁**同一张表、同一列**（同一个 `genericEventPayload`） | `category` + 其余 `tags[]` | ✅ 批 2 补（开 `categoryFacts`；多值按 `<br />` 拆，见下） |
| 女神异闻录5X `p5x` | 公告区块的类别行 → `block.category`（如 `活动更新` / `活动BOSS更新`） | `category` | ✅ 批 1 补 |
| PJSK `pjsk` | `events.json` 的 `eventType`（英文枚举：`marathon` / `cheerful_carnival` / `world_bloom`） | `category`（**原样**，不翻译） | ✅ 批 1 补；枚举→档位的映射留批 2 |
| FGO `fgo` | 活动表第 4 列的类型（`Event` / `Campaign` / `Other`） | `category` | ✅ 2026-11-07 已落地；批 1 只让 `EVENT_TIER1_RE` 认英文（见下） |
| 雪松 `kedr` | 模板参数「倒计时名称」→ `item.timer`（`赛季` / `活动` / `边境防卫`） | —（**故意不写**） | ❌ 批 1 判定**不该补**，理由见下 |
| 鸣潮 `wuwa` | 官方公告 `it.tag` 只是数字（5=活动 / 7=卡池），没有子类别 | — | ⏳ 批 2（数字映射） |
| 战双 `zspms` | SMW 有 `?类别` 属性，但当前查询只取 `?标题` / `?时间` | — | ⏳ 批 2 |
| 其余来源 | 响应里没有独立的类别 / 标签列（活动表往往只有"时间 + 名称"两列） | — | 未补（= 如实留空，档位按活动名回退） |

**「类型」列多值拆分（批 2，绝区零 + 星铁同一张表）**：源站把多个类型写在**同一个单元格**里，分隔符是
`<br />`（实测普查 240 行：`<br>` / `/` / `、` / `,` / `；` / `※` / 换行 全是 0 处，单元格内也没有 `<p>` / `<div>`）。
`stripTags` 会把 `<br />` 变成**空格** ⇒ 多值会粘成 `版本活动 常驻活动`（改造前的实际行为）。
`22-fetcher-core.js` 的 `categoryValuesOf` 因此**先按 `<br />` 拆、再逐段 stripTags**：
首项进 `category`、其余进 `tags[]`（与批 1 原神 SMW 数组的做法一致）；空单元格 ⇒ 两个键都不写。
绝区零的 **TAG 列本批不读**（留给后续决策）⇒ 条目上不会出现 `签到` / `战斗 拍照` 这些 TAG 词。
回归：`test/cases-category.mjs` ⑦ 用真抓夹具逐条钉死（含"没有空格粘串 / 没有 `<br` 残渣"），
**反向证明**：把拆分换成永不匹配的分隔符 ⇒ ⑦ 的 5 条断言立刻红（`版本活动 常驻活动`、`tags` 为空）。

**`EVENT_TIER1_RE` 的英文分支（批 1 唯一动的正则）**：加了 `\bEvent\b|\bCampaign\b`。
- `Event` / `Campaign` = FGO 的"活动正篇" ⇒ 第一档；`Other` = 第二档。
- **必须带 `\b` 词边界**：`Other` 不许被任何英文分支命中（它是第二档），`Events` / `Eventful` /
  `Campaigns` / `Campaigner` / `Pother` 这类更长或嵌在别的词里的写法也不算分类词
  （`test/cases-category.mjs` ⑤ 有逐条断言）。
- FGO 的**外显**其实走特化规则 `schedulePickFgoEvent`（`/^Event/i` 优先），所以这条正则改动对 FGO
  面板**没有可见影响**；它的作用是让通用 `eventTier` 与源站类型列口径一致（将来任何来源写英文分类词
  都不会被判成第二档）。

**雪松为什么不补 —— 批 3 之后这条理由已失效（但仍未补）**：批 1 当时的理由是"`eventTier` 有
`category` 就**只**看 `category`，补上雪松那三个类别词（`赛季` / `活动` / `边境防卫`，都不在
`EVENT_TIER1_RE` 里）会把靠「剧情」进第一档的活动名挡掉，于是外显从"剧情活动"退化成"战令通行证赛季""
（实测 2026-10-01）。**批 3 的 OR 语义正是为了消掉这个副作用**：现在名字始终参与 ⇒ 补 `category`
也不会降档（`test/cases-category.mjs` ④ 的 what-if 已改成钉住"不再退化"）。补 `category` 是另一次
改动（本批只改 haystack），所以条目上**仍然一个类别键都没有**；要补只需给
`ns_bwiki_wikitext_eventPayload` 加一个 `categoryOf` 选项并在雪松侧传 `x.timer`。

**本批唯一改变的外显**：终末地 2026-11-07 那一刻，面板活动格从「予众魂的新光影」（改造前按活动名判档，
全员第二档 ⇒ 取结束最早那条）变成「百趣演武」（源站 `tags`「挑战活动」= 第一档）。这是**对齐**：
引擎自己挑的外显（记录里的 `event`，`pickEventPrimary(activeActs)` 一直读 `tags`）本来就是「百趣演武」，
改造前面板与记录是**两套事实**。批 1 把这条事实补进数组后两者一致。其余 7 款 + FGO 的 34 个侧等价性
用例（`test/cases-core.mjs` ⑤-5）仍是 `diffs = 0`。
**批 2 加的绝区零外显不变**：2026-08-25 那一刻补 `category`/`tags` 前后都是「咔滋酥脆出餐计划」
（当期 6 条的类型都判不出第一档词 ⇒ 档位仍全为 2，仍按"结束最早 + 起点最早"选）——`test/cases-category.mjs` ③ 有断言。

**既有断言怎么处理的**：`test/cases-p3.mjs` 里的 golden 与等价性 oracle（`legacySynthArrOf`）都是
**改造前**的产物（条目上没有 `category` / `tags`），所以比较口径改成"**除 `category` / `tags` 外**逐字相等"
（`sansCategoryTags` / `sansCategoryTagsJson`）。文件里只做了一处机械改动：golden 中**本来就有**的那 5 条
键名的 `cat` → `category`（`legacy-oracle-golden.json` / `p3b-golden.json` 的 `array` 字符串），
**值一个字符都没动** —— 那是字段改名的同步，不是"改完再采集"（P3 的采集模式明确禁止后者）。
新增事实的**取值**由 `test/cases-category.mjs`（门禁最后一段，真夹具逐款逐字）钉住。


### 刷新横幅的汇总口径（2026-11-09 用户要求）

- **不再报「跳过 k 个」**：`buildScrapeInfo` 只输出「成功 N/M」+ 失败/未命中分类；
  未配置条目既不进分母、也不再单列计数。
- **未配置那一侧写进悬停明细**（与失败项同一种排版）：
  `未定事件簿 卡池未配置有效来源、活动未配置有效来源`
  （名字后一个空格、多项用「、」隔开，**不加【】**）。
- 判定：`SOURCES` 里该条目那一侧没写 `url` / `eventUrl` ⇒ 未配置；
  用户手动切到备选源时默认 url 仍在 ⇒ 不会误报。跟「抓取失败」分开展示。
- **失败明细并入悬停（2026-11-10 用户要求，底部失败横条 + 「重试」已删）**：
  `info` 一行保持原口径（`成功 N/M …`，**不**塞长原因）；失败项在 `lines` 里写成
  `赛马娘·日服 卡池失败：HTTP 502` —— 失败项只写原因（不写是否沿用旧值）
  **且**记录里该侧的数组还有条目（面板格子照旧显示的那份旧值；判据是
  `60-helpers.js` 的 `sideFailCarriedOver`，与删除前横条用 `scheduleNormalize` 非 null
  判的口径一致）。未命中 / 未配置两类不追加；「重试」能力由底栏「刷新」按钮承担。
  回归：`test/cases-scrape-fail.mjs`。

### 新接入的 5 款（2026-11-09）

用户原话：「五个都接入，暂时没有数据源的就留空未配置」。来源全部**实测过**（见各夹具
`response.txt.meta.json` 的 `capturedAt`），**有源的接全、无源的只注册条目**——
面板上不假装"配了一个源"。2026-11-14 用户拍板：**除 cytq 外全部默认展示**（本批 5 款里只有
cytq 仍出厂隐藏 = `defaultHidden: true`；设置页里勾上「展示」就出来）。

提醒侧跟着这两条规则走，**不需要**再同步任何"白名单"（2026-11-09 起提醒是取消列表制）：
出厂默认隐藏的条目（现在只剩 cytq）由「展示是上位」自动静默（`65-remind.js` 的 `REMIND_DEFAULT_HIDDEN_IDS`
带着 `defaultHidden` 那份副本，守卫见 `test/cases-remind.mjs` ⑱ 的 ⑨：它必须恰等于
`defaultHidden === true` 的集合）；**勾上「展示」就自动恢复提醒**（取消列表里没有它们），
这与"出厂每个条目都默认勾选"是同一条口径。

| id | 游戏 | 卡池源 | 活动源 | 状态 |
|---|---|---|---|---|
| `wqmt` | 无期迷途（国服） | bwiki「追踪一览」（`api.php?action=parse`，174 行） | 官方资讯 API `wqmt.aisnogames.com/api/news`（`ACAO:*` ⇒ 直连） | **两侧已接** |
| `pengpeng` | 夜幕之下（国服，曾用名「代号砰砰」） | bwiki **SMW `action=ask`**（`[[分类:契约]][[条目类型::契约]]`，11 条 / 9 条有窗口；2026-11-11 换源：旧 HTML 页在 `/ymzx` 已 #REDIRECT，标签写「Bwiki 契约（SMW）」） | **TapTap tab 页的 SSR**（`/app/746164/topic?type=official`，`?page=1/2` 最多 2 页；2026-11-13 换源：`webapiv2` 在 robots.txt 的 Disallow 路径下） | **两侧已接**；旧 bwiki `公告/` 降为 `eventAltSources` 手动备选 |
| `wd` | 未定事件簿 | 米游社公告 `forum_id=33`（2026-11-09 晚接上） | 同上（按标题分流） | **两侧已接** |
| `hlr` | 时空中的绘旅人 | 官网 `news/official/` 列表 + 详情（2026-11-09 晚接上） | 官网 `news/official/` + **`news/update/` 学院公告**（2026-11-10 增补；同一个抓取器抓两类列表） | **两侧已接**；活动侧现在出「缱绻假日」10-09~11-20，卡池侧无在期画廊 ⇒ 如实 null |
| `cytq` | 炽焰天穹（用户写作「炽焰苍穹」） | — | — | **未配置**（只注册条目） |

> ⚠️ 上表「状态」是 2026-11-09 **晚批**之后的现状；晚批之前 `pengpeng` 只有卡池侧、`wd` / `hlr` 两侧都未配置，
> 当天上午的旧结论不再成立。细节（源 / 代理 / 滞后）见下面「2026-11-09 晚：5 个侧的真实接入」一节。

**无期迷途两个解析器（`30-game-wqmt.js`）**

- 卡池：`追踪页面 | 开启时间 | 概率提升` 三列。池名与角色在源站是**一格**（`隐秘深渊-格芮芙、渡鸦…`），
  只有右侧每个名字都能在「概率提升」列里找到才拆开（对不上就整串当池名，不猜）；
  卡池类型取「开启时间」格里的加粗字（比行属性 `data-param1` 更细：`返场·限定追踪` vs `限定追踪`），
  通过 `itemFacts` 进 `gacha[]` 的 `category`。
- 角色合并口径与 `selectCurrent` **只差一条**：只合并**同批（`endTs` 相同）**的池。
  无期迷途同一时刻常规/活动/限定/统合/定向/联动**六类池并行**、角色互不重复，全合并会把十几个名字
  拼成一行且看不出"哪一批"。这个口径抽成了共用 helper `ns_bwiki_batchGachaPayloadOf`
  （`30-game-bwiki-common.js`，wqmt / pengpeng 共用），没有写第二份。
- 活动：列表 1 次 + 最新 6 条正文（`WQMT_EVENT_MAX_DETAILS`，列表**无分页**）。正文里两种窗口写法都认：
  ① `■「破碎防线·暗域」第35期开启，11月02日 05:00 ~ 12月14日 04:00`（两端都带 HH:MM 才算区间，
  防止把「将于X月X日结束」拼成假档期）；② `■活动时间：11月11日 开服后~12月09日 07:59`。
- **时区**：源站无标注，但时间一律是 `09:59:59` / `04:59` 这种"整点差一分" + 维护窗口 `10:00-14:00`
  ⇒ 按 **UTC+8** 解析（`tz: "Asia/Shanghai"`，判据写在文件头，**推定**不进悬停）。

**「开服后」怎么处理（这一批最容易出错的地方）**

卡池表 174 行**全部**写成 `YYYY-MM-DD 开服后`，没有一行给时刻。要写 `startTs` 就必须有
「开服时刻锚点」，机制是 `wqmtMaintAnchorsOf`：从**已经抓到的公告正文**里读
`维护时间：11月11日10:00-14:00` ⇒ 那一天的开服时刻 = 维护窗口的**结束**（14:00）。

- **有锚点** ⇒ 写 `startTs`，档期文本是正常的两端时刻（`11-11 14:00 ~ 12-09 07:59`）；
- **没有锚点** ⇒ **`startTs` 留 null，不猜**。卡池侧只抓 bwiki（默认源不跨站取数，见上面
  「来源策略：无自动兜底」），拿不到维护公告 ⇒ 2026-11-09 实测在期的 6 口池**全部没有锚点**
  （最新维护公告是 10-27，而在期池从 11-11 起）。`bannerDates` 于是写 `11-11 开服后 ~ 12-09 09:59`
  —— 与绝区零「3.3版本更新后 ~ 11-11 11:59」同一种降级，`dataArrayWindowOf` 对单边窗口只填 `endTs`。
  代价是起点未知按全仓口径「视为已开始」⇒ 11-11 才开的池子在 11-09 就显示成在期。
  **这是有意的**：实测维护窗口是 `10:00-14:00`，编一个 `10:00` 会差 4 小时，比"早两天看见"更糟。
  锚点机制的正/反两例由 `test/cases-new5.mjs` ③ 用合成正文钉住（不依赖源站当天发没发公告）。

### 2026-11-09 晚：5 个侧的真实接入（wd / hlr / pengpeng 活动；cytq 仍不接）

调研把上一版「没有可用源」的三条推翻了两条半。**这一节就是那 5 个侧的真实现状**（源 / 代理 /
已知滞后）；代码注释与夹具 meta 是同一份事实的落点。

| 侧 | 源（文件） | 代理 | 现状 / 已知滞后 |
| --- | --- | --- | --- |
| `wd` 卡池 | 米游社公告 `forum_id=33`（`30-game-miyoushe-bbs.js`） | **需要**（`bbs-api.miyoushe.com` 无 ACAO；详情必须带 `Referer: https://www.miyoushe.com/wd/`，只带 UA ⇒ 403） | 官方号 76089447 日更；列表 20 条 → 最多 5 篇详情 |
| `wd` 活动 | 同上（标题含 活动/征集/签到… 的分流） | 同上 | 起点写「11月5日更新后」⇒ `startTs=null`：**不进外显**、只进悬停 |
| `hlr` 卡池 | 官网 `hlr.163.com/news/official/` 列表 + 详情（`30-game-netease.js`） | **需要**（无 ACAO；详情带 `Referer: https://hlr.163.com/`） | 最新 2026-11-05；一页 6 条只抓前 3 篇详情；画廊名 + SSR 画灵（`叶瑄SSR[叠轨晨昏]` → `叠轨晨昏`） |
| `hlr` 活动 | 同上（每篇正文第一个窗口） | 同上 | 缺年份用 `artDate`（`时间：YYYY-MM-DD`）补；跨年实测 `2025-12-27 ~ 2026-01-05` |
| `pengpeng` 卡池 | bwiki「契约一览」（`30-game-pengpeng.js`，**本次未改**） | 需要（biligame 系一律走代理） | 表停在新一批 2026-09-10；当前时刻如实 null |
| `pengpeng` 活动 | bwiki `公告/` 前缀页 → 最新一页「…版本活动总览」（`30-game-pengpeng.js`） | 需要（同 biligame；接口本身回 `ACAO:*`，但全站口径仍走代理） | **wiki 数据滞后**：最新一版只到 2026-09-10（游戏仍在运营，1.0.54 / 2026-10-21）⇒ 当前时刻如实 null；来源标签写「Bwiki 公告（不可靠）」，**不标暂停** |
| `cytq` 炽焰天穹 | **仍不接**（`30-game-unconfigured.js`） | — | bwiki 只有 `cytq` 子站（无卡池表 / 无活动表）、官网无可抓接口 ⇒ 两侧 `url`/`eventUrl` 留空 |

- **「版本更新后」的口径**：`pengpeng` 活动页每行都写 `2026/9/10 版本更新后 - …`，与 `wd` 的
  `11月5日更新后` 同一种「起点未知」。按全仓 2026-11-09 口径：`startTs = null`，**不进外显**，
  仍进悬停（`coveredOrOpen`，悬停里原样印源站原文）。
- **别把 wiki 停更当游戏停运**：`pengpeng` 活动最新数据比游戏落后约 1 个版本，这是社区 wiki 的
  维护节奏，不是游戏暂停。面板/设置页的文案只写「wiki 数据滞后」。
- `wd` / `hlr` 的 `defaultHidden` 已改为 false（2026-11-14 用户拍板：除 cytq 外全部默认展示）。
- 代理白名单：`bbs-api.miyoushe.com` 早已在 `PROXY_ALLOW_HOSTS` 里（星铁/原神那批米游社公告加的）；
  本次只新增 `hlr.163.com`。`wiki.biligame.com` 本来就在。
- 回归：`test/cases-wd-hlr.mjs`（wd 卡池/活动 + hlr 卡池/活动 + 跨年 + 单侧失败隔离 + 反证）与
  `test/cases-pengpeng-event.mjs`（公告列表 → 最新总览 → 活动名 + 起止 + wiki 滞后 null + 反证）。
  （⚠️ 该文件的默认源 2026-11-11 已换成 TapTap feed JSON，bwiki `公告/` 只作为备选源回归 ——
  见下面「2026-11-11：夜幕之下活动侧抓取从 HTML 正则换成 TapTap feed JSON」一节。）

### 2026-11-11：赛马娘·繁中服（`uma-tw`）

- **源**：Komoe 官方公告 CMS —— `GET https://l11-web-api.komoejoy.com/game/website/content/107075/2/list?pageNum=1&pageSize=20&region=3`
  （`107075` = 游戏 id；`type=2` 才是公告；`region=3` = 繁中区）。卡池与活动**同一条接口**、按标题分流：
  卡池 = 含 `轉蛋`/`特選`（**先判** —— `培育劇本開幕轉蛋` 属卡池）、活动 = 含 `活動`/`競賽`/`培育劇本`/`紀念`；
  `機率公告` / `每天1次免費轉蛋` / `結束` / `預告`·`即將舉辦` 一律不进（判据见 `src/client/30-game-komoe.js` 文件头）。
- **档期**：正文 `舉辦期間` / `特選期間` 标签后的 `M/D H:MM ～ M/D H:MM`（只取第一段窗口块，块内多行全收）。
  起点写「維護結束後」⇒ `startTs = null`（不进外显，只进悬停/数组）；缺年份用 `publish_time` 补
  （共用 `inferYear` / `endsNextYear`）。
- **代理**：**需要**。`l11-web-api.komoejoy.com` 已登记进 `src/index.js` 的 `PROXY_ALLOW_HOSTS`
  （响应 `ACAO` 只放行 `https://uma.komoejoy.com`），且请求必须带 `Referer: https://uma.komoejoy.com/`。
- **回归**：`test/cases-uma-tw.mjs`（真夹具 `uma-tw-list` 逐字断言 + 两侧共用 1 次请求 + 「維護結束後」不进外显 + 反证）。

**「未配置」在数据与 UI 里的表达（三处，全部不产生 fail）**

1. **刷新**：`50-refresh.js` 的 `fetchEntry` 第一行 `if (!source.url && !source.eventUrl)` ⇒
   `{ ok:true, reason:"skipped" }`：不抓取、不计成功、不计失败；
2. **来源健康 / 自检**：`engine-api.js` 的 `describe()` 对 `!url` 的一侧给
   `{ state:"unconfigured", text:"未配置来源" }`，进 `summary.unconfigured` 而**不是** `down`
   —— 设置页那行结论是「… / 未配置 N / 失败 M」两个独立数字。**现在只剩 `cytq` 走这条路径**
   （`pengpeng` 的活动侧已在 2026-11-09 晚接上）。
3. **面板**：该侧没有外显条目 ⇒ `scheduleCellOf` 返回 `null`，格子里写「该来源无数据」（灰底），
   刷新横幅的悬停明细里也不会出现失败项（`isDown(gachaFail|eventFail)` 都是 false）；
   2026-11-10 起底部失败横条已删，失败信息只走刷新横幅悬停。
   设置页「卡池来源 / 活动来源」下拉里那一侧显示裸「未配置」（`getDefaultSourceName`）。

断言在 `test/cases-new5.mjs` ⑤（只剩 `cytq`：`fetchEntry` 的 `reason` / `selfCheck` 的
`unconfigured = 2` / "一个请求都没发" / `scheduleCellOf` 与 `scheduleNormalize` 都返回 null）。

**已知限制（都写进代码注释了）**：① 无期迷途卡池的起点要靠维护公告锚点（2026-11-09 起取不到就退常量
14:00，见下一节）；② 夜幕之下的 **bwiki** 表在 2026-10-01 之后没有新行（最新一批 09-10）—— 卡池侧仍如实
null，活动侧 2026-11-10 已换 TapTap tab（能出「新风同行」11-05~11-19）；
③ 时空中的绘旅人：官方通稿稀疏，**2026-11-10 起同一个抓取器加抓 `news/update/` 学院公告**（每周一条），
详情预算为卡池侧 2+2 篇、活动侧 2+5 篇；活动侧现在出「缱绻假日」10-09~11-20。
④ 战双帕弥什卡池侧 **2026-11-10 起以 bwiki `Test4/活动旗帜` 为准**（结构化当期池），版本更新公告降为
`altSources`；⑤ P5X 的「只有日期、没有时刻」窗口统一按 **起 00:00 / 止 23:59**（仓库通用约定）。


### 2026-11-11：战双活动侧换 `Test4/活动日历`；夜幕之下卡池侧不接 TapTap

- **战双帕弥什 活动侧**：默认源 = `Test4/活动日历`（`action=parse&page=Test4%2F活动日历&prop=wikitext&format=json&formatversion=2`），
  解析模板行 `{{活动日历|名称|开始|结束}}`（`Template:活动日历` 的位置参数 1/2/3；同义具名参数也认）。
  实测 2026-11-11T00:58+08：HTTP 200 / 729B / **10 条**，首条「远信回响」主线
  `2026/09/24 11:00 ~ 2026/11/05 5:00`，末条「新增涂装试玩」同窗口 ⇒ **当前全部过期 ⇒ 活动侧 null**（未公布）。
  过期不是抓取失败：真夹具 `test/fixtures/p8-zspms-calendar`，回归 `test/cases-p8.mjs` P8-7
  （注入 10-20 的时刻能出 9 条在期、10-19 收的「悍猎季风」不进外显/悬停）。
  旧「SMW ask 索引 → 最新版本更新公告正文」降为 `eventAltSources`（抓取器键仍 `zspms-bwiki-notice`，与卡池侧共用）。
- **官方公告接口（探测到、本批未接）**：官网 `zspms.kurogame.com` 是 SPA，数据在
  `https://media-cdn-zspms.kurogame.com/pnswebsite/website2.0/json/G144/`：
  `ArticleMenu.json`（217 条，`ACAO: *`）与 `article/<articleId>.json`（正文 HTML，`ACAO: *`）。
  实测 `article/5682.json` = 《流光抛诸寰宇》版本更新公告（发布于 2026-11-03 17:26），正文里
  `2026年11月5日版本更新后 - 2026年12月17日05:00` 出现 **12 次** ⇒ **当前版本有档期**（比 bwiki 新）。
  未接原因：正文是 HTML 富文本，小节名在 `<strong>` 里（不是 `==` 标题层级），活动名/容器名的区分要另写一套
  解析器；本轮按任务书只把 bwiki 活动日历设为默认。宿主 `PROXY_ALLOW_HOSTS` 不含
  `media-cdn-zspms.kurogame.com`，但该域 `ACAO: *` ⇒ 若接，走 `mode:"direct"` 即可，不需要动白名单。
  （**2026-11-11 晚已接**：活动侧默认源换成官方 CDN，实测走 `mode:"proxy"` + 已登记
  `PROXY_ALLOW_HOSTS`；见下面「战双帕弥什活动侧默认源换成官方 CDN」一节。）
- **夜幕之下 卡池侧**：**不动**（三选一里的 C）。bwiki「契约一览」最后编辑 2026-09-24（`list=recentchanges`），
  最新窗口 `2026/09/10 ~ 2026/10/01` ⇒ 当前 null。TapTap 只有应用简介里的
  「10月22日…「幸福无罪论」活动契约限时开启」（**无年份、无结束日**；11-12 的新版本档期只在图片里）：
  单边窗口在仓库没有合法载荷（`ns_bwiki_batchGachaPayloadOf` 用 `coversNow`，两端都要），
  强行喂进数组会被显示层当「长期」（`scheduleItemOf`：`endTs == null ? 0`）。
  也不把默认换成 TapTap：它只能产出单边窗口 ⇒ 外显恒 null（等于用「永远空」换掉 bwiki 的「等补档」）。
  回归钉住 `test/cases-new5.mjs` ④(d)；完整取舍写在 `src/client/30-game-pengpeng.js` 文件头的
  「卡池侧 2026-11-11 复核」段。


### 2026-11-11（晚）：战双帕弥什活动侧默认源换成**官方 CDN**「版本更新公告」

- **为什么换**：`Test4/活动日历` 只抄到 2026/11/05 ⇒ 面板从 11-06 起空窗；官方 CDN 的
  《流光抛诸寰宇》版本更新公告（2026-11-03 发布）已经把 11-05 版本更新那批写到 **12-17**。
- **默认源**：`eventUrl` = `https://media-cdn-zspms.kurogame.com/pnswebsite/website2.0/json/G144/ArticleMenu.json`，
  `eventSource` = 「官方公告」。抓取链路 = 菜单 → 按标题匹配「版本更新公告」（清洗后匹配，**不写死 id**，
  实测 217 条里命中 49 篇；菜单本身**不是**时间序）→ 按发布时间倒序取**最近 3 篇** →
  逐篇 `article/<id>.json` 的 `articleContent`（HTML 富文本）解析档期。共 4 个请求，全走宿主代理。
- **降级**：bwiki 两页都保留为 `eventAltSources`（设置页可手动切）：
  「Bwiki 活动日历」抓取器键 `zspms-bwiki-calendar`、
  「Bwiki 更新公告」抓取器键 `zspms-bwiki-notice`；卡池侧不动（仍是 `Test4/活动旗帜`）。
- **解析口径**：活动名住在 `<strong>` 里（`四、像素嚼嚼乐` / `4）活动时间` / `「揽光一瞬」` 三种都是整行加粗），
  清洗掉 `【】「」◆▌` 等装饰符与序号；起点写「版本更新后」⇒ **`startTs = null`**（仓库 2026-11-09 口径：
  起点未知 ≠ 已开始）⇒ 这类条目**不进外显**，只在悬停/数组里按**源站原文**列出（到 12-16/12-17）；
  外显仍是两端都明确且覆盖 now 的那条。缺年份共用 `inferYear`、跨年共用 `endsNextYear`；
  维护窗口（`停服维护：05:00 - 11:00`）与句子里的研发池档期都不当活动。
- **实测（2026-11-11T12:00+08 活网）**：外显 = 「诸星迷寂-BOSS挑战」11-06 10:00 ~ 11-30 05:00；
  悬停 14 条（在期 1 + 起点未知但终点未过 13，含「尽心者尽美-角色试玩关」「7日登录签到奖励」等到 12-17）。
- **白名单**：`media-cdn-zspms.kurogame.com` 已登记进宿主 `PROXY_ALLOW_HOSTS`（响应 `ACAO: *`，但仍走代理口径）。
  真夹具 `test/fixtures/p8-zspms-cdn-{menu,art5682,art5467,art5306}`，回归 `test/cases-p8.mjs` P8-8。
- **卡池侧确认**：官方 CDN 里**没有**结构化卡池字段（卡池只出现在公告正文的句子里：`…研发池获得`），
  与 bwiki `Test4/活动旗帜` 同源同期 ⇒ 卡池侧维持 bwiki，不接。


### 2026-11-11：夜幕之下活动侧抓取从 HTML 正则换成 **TapTap feed JSON**

- **为什么换**：2026-11-10 接的是 TapTap tab 的**服务端渲染 HTML**（正则切
  `moment-article__link` / `summary--title` / `chat-text-render`）。类名一改版就整片归零；
  同一份数据其实有结构化来源 —— 页面自己就发 `webapiv2` 请求。
- **新源**（`eventUrl`）：`https://www.taptap.cn/webapiv2/feed/v7/by-group`
  + `X-UA=<页面请求里那串>&type=official&group_id=924367&limit=10&sort=created&__times=0&status=0&with_hot_comment=true&from=<偏移>`。
  `topic.title` / `topic.summary` 拿标题与**纯文本**正文（换行是真 `\n`），`moment.id_str` 拼帖子链接。
  实测 200 / 167 KB（HTML 那份 359 KB）。仍需宿主代理（无 ACAO；`www.taptap.cn` 早已登记）。
- **`X-UA`**：缺了源站回 400 `INVALID_XUA`（`"INVALID_XUA: InvalidArgument: XUA is empty"`）。
  值照页面自己的请求抄；`UID=` 留空实测也 200 ⇒ 不把会话 UUID 写死进源码。
- **区间解析函数一行没动**：`pengpengTaptapWindowsOf`（两端要自带年份 / 起点「版本更新后」⇒ `startTs = null`
  / 只有日期 ⇒ 00:00~23:59）原样复用，换的只是"文本从哪来"。
- **翻页**：`from` 是偏移（不是页码）；`PENGPENG_TAPTAP_MAX_PAGES = 3` 封顶，并且
  「整页解析出的活动**全都已结束**就停」⇒ 不会无限翻。为什么要第 2 页：每页 10 帖，仍在期但公告更早的
  活动在 `from=10`（实测「画廊夜游」10-29 ~ 11-12 就在那一页）。
- **标签**：活动侧 `eventSource` 仍是「TapTap」（换源不改标签）；卡池侧 `source` 改成
  「Bwiki 契约一览（停更）」—— 停更的是那张 wiki 表（最后编辑 2026-09-24），不是游戏。
- **实测（2026-11-11 活网）**：外显 = 「新风同行」`11-05 05:00 ~ 11-19 04:59`（源站原文
  `2026年11月5日 05:00 - 2026年11月19日 04:59`），悬停 2 行（画廊夜游 10-29 ~ 11-12 在前）；共 3 个请求。
- **夹具 / 回归**：`test/fixtures/pengpeng-taptap-feed-p{1,2,3}`（`from=0/10/20`，2026-11-11 真抓，
  只保留 `moment.{id_str,created_time,topic{title,summary}}` + `data.total/next_page`）；
  回归 `test/cases-pengpeng-event.mjs`（注册 / 30 帖解析 / 当期逐字 / 5 条反向证明 / 翻页失败隔离 /
  bwiki 备选源 / 早停）。旧的 `pengpeng-taptap-official{,-p2}`（HTML）已删。


> ⚠️ **已废弃（2026-11-13）**：下文描述的 `webapiv2` 链路已被替换——`taptap.cn/robots.txt` 明确 `Disallow: /webapiv2/`，
> 现在改用 robots 允许的 `/app/<id>/topic?type=official` 页（SSR 解码）、请看下方 2026-11-13 那一节。

### 2026-11-11：崩坏3 卡池档期（697 文本）+ 卡厄斯梦境卡池换 TapTap 详情

**① 崩坏3 `bh3` 卡池：档期改从文本取**（`src/client/30-game-batch2.js`）

- 现状：`content_v2_user` appId=`b9d5f96cd69047eb`、`iChanId=697` 已接，能出名称/角色但**没有档期**
  （`dtEndTime` 30/30 恒 `2035-01-01 00:00:00` 占位 ⇒ 当权威就等于把整批挪到 2035）。
- 实测（2026-11-11 10:30 +08 复核；`bh3-content-gacha` 夹具与活网**逐字节相同**）：697 正文里**部分类别**
  有 `>>开放时间` 文本块（跃升武装 / 跃升补给 / 庆典角色·装备 / 时光追忆 / 服装补给…）；标准双池
  （角色补给 / 装备补给）只有图片 `>>补给信息`，但**同帖**「商城礼包【上架时间】」的文字窗口与补给窗口一致
  （跃升武装 / 跃升补给两条同帖文本互证：礼包 `11月6日12:00~11月26日04:00` == 同帖 `>>开放时间`）。
- 取值：`>>开放时间` → 同帖「【上架时间】」→ 都没有 ⇒ 只出名称/角色（`bannerDates` 留空）。**`dtEndTime` 不读**；
  `dtStartTime` 只作年份线索与「帖已发布」判据（实测 跃升武装帖 `dtStartTime`=11-03 18:30，而 `>>开放时间`
  写 11-06 12:00 —— 前者是内容上线时刻，不是开池时刻）。在期池并列时按「开始更晚 → 帖更晚」取外显。
- 活网（2026-11-11 10:38 +08）：修前 `bannerDates=""` / `gacha` 1 条（ts=null）；修后
  `11-06 12:00 ~ 11-26 04:00` / `gacha` 4 条（装备补给琉璃朱燧、跃升武装、跃升补给、时光追忆 10-30~11-13）。
- 回归：`test/cases-batch2.mjs` ①（三级取值逐条 + 3 条反证：抹掉 `>>开放时间` / 抹掉【上架时间】 / 2035 不进载荷）。

**② 卡厄斯梦境 `czn`：卡池从 bwiki 换成 TapTap 官方 tab（列表 → 逐帖详情）**

- 端点：列表 `https://www.taptap.cn/webapiv2/feed/v7/by-group?X-UA=…&type=official&group_id=974342&limit=10&sort=created&from=0`；
  详情 `https://www.taptap.cn/webapiv2/moment/v3/detail?X-UA=…&id=<帖 id>`。正文 = `data.first_post.contents.json`
  （block 数组，`paragraph` 取 `children[].text`）。两者都**无 ACAO** ⇒ 走宿主代理（`www.taptap.cn` 已登记）。
  列表首页 10 帖 → 逐帖详情（`NS_BATCH2_CZN_MAX_DETAILS = 10`，不翻页；按标题挑会漏掉长文里的卡池分节）。
- 卡池：「`■ …营救概率提升`」分节 → 池名（分节标题原文）+ 角色（分节标题里的 `「」`，正文里的不算）
  + 起止（`概率提升期间：` / `概率提升时间：` 那一行）。没有 `■` 分节的单帖公告整帖算一条池。
  「维护结束后 / 维护开始前」按**同帖**维护窗（`◈更新时间：` 后那一行）映射；同帖没有那一天维护窗
  ⇒ 该端点如实留空（实测 `2026/12/02 维护开始前` 的 12-02 维护窗不在同帖 ⇒ `endTs=null`，`display` 印源站原文）。
- 活动：同帖维护窗 + `■ 活动 – …` 的【活动时间】；**营救概率提升不再算活动**（此前摘要路径双计）。
  两端留空的行走仓库口径（`coveredOrOpen`）不进外显/悬停/数组，但解析结果里保留（测试逐条钉住）。
- 标签：卡池 / 活动都「TapTap 官方」；bwiki `Module:Gacha/data` 降为 `altSources`（键 `czn-bwiki`，解析器未动，
  `cases-p3` 的 golden 改走该备选源后逐字不变）。
- 活网（2026-11-11 10:38 +08）：卡池 修前 `null`（bwiki 停更）→ 修后「常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」
  营救概率提升即将开始」`11-04 02:00 ~ 11-25 02:00`（角色 蒂菲拉、蒂亚娜）；活动 修前 2 条（含营救帖 = 双计）
  → 修后 1 条（维护窗 `11-11 08:00 ~ 11-11 13:00`）。
- 夹具：`czn-taptap-feed`（列表）+ `czn-taptap-moment-<帖 id>` ×10（详情），2026-11-11T10:35+08 真抓、整份原样入库；
  旧 `czn-taptap-official`（SSR HTML，440 KB）**已删**。回归 `test/cases-batch2.mjs` ③（5 条反向证明）。

### 2026-11-12：卡厄斯梦境 `czn` TapTap 抓取加固（WAF 限流）

- 起因：TapTap 在阿里云 WAF 后面，限流时回 `text/html`（正文含 `aliyun_waf`）。此前每轮刷新卡池 / 活动**各自**
  跑一趟「1 列表 + 10 详情」= 22 个请求，且任意一份详情失败整侧就记「抓取异常」。
- 抓取口径（`src/client/30-game-batch2.js`）：
  · 两侧共享同一份 docs：模块级缓存（`NS_BATCH2_CZN_DOCS_CACHE`），key = 完整 feed URL，TTL 30 s（`nowMs()` 判过期），
    **只有抓成功才写缓存**（失败下一轮重试）。
  · 按标题挑详情（`更新 / 版本 / 维护 / 公告 / 活动 / 一览 / 概率提升 / 预告`）：成功 3 份即早停
    （`NS_BATCH2_CZN_DETAIL_TARGET`；feed 是 `sort=created` ⇒ 最近 3 份命中帖覆盖当期）；`NS_BATCH2_CZN_MAX_DETAILS`
    10 → 4，只作失败时的兜底上限。一帖都没命中 ⇒ 抛 `czn-no-title-match`（不退回 10 帖全抓）。
  · 单帖详情失败 ⇒ 跳过；≥1 份成功照常出数据；**全部失败才抛错**（该侧记 down），失败的 docs 不入缓存。
- 回归（`test/cases-batch2.mjs` ③ / ③-2 / ③-3）：整轮 1 列表 + 3 详情 = 4 次（修前 22）；标题命中 3 帖逐条；
  同 now 二次刷新 0 请求 / +29 s 命中 / +31 s 重抓；单帖 500 跳过仍出数据、更新帖 500 时卡池照常且活动侧如实
  nomatch；全失败两侧 down；10 帖全命中仍只抓 3 份、全失败时每侧最多 4 次。反向证明：去掉缓存读 ⇒ 请求数断言
  红 9 条；去掉失败跳过 ⇒ 单帖失败用例红 7 条（均当场还原）。
- 活网（2026-11-12 22:3x +08，宿主代理 `127.0.0.1:63738`）：TapTap 仍被 WAF 拦 —— 列表 `status 200` /
  `text/html` 16010 B / 含 `aliyun_waf`；隔数分钟重试一次仍同。如实结论：这次**没取到数据**，两侧记 down，
  整轮只发 **2 个请求**（每侧 1 次列表、0 次详情）—— 失败路径也不再先扇出 22 次。正常轮的 4 次请求由夹具门禁钉住。

### 2026-11-13：卡厄斯梦境 `czn` 改抓 robots 允许的 topic SSR 页（删除 webapiv2）

- 合规事实：`https://www.taptap.cn/robots.txt` 明确 `Disallow: /webapi/` 与 `Disallow: /webapiv2/`；
  旧实现走的 `webapiv2/feed/v7/by-group` + `webapiv2/moment/v3/detail` 两个接口都被禁。
  实测允许路径 `https://www.taptap.cn/app/759688/topic?type=official[&page=N]`：200 / text/html / 无 WAF，
  SSR `window.__NUXT_DATA__` 里带每帖 `moment.topic.title / summary / created_time`。
- 抓取：固定 2 页（`NS_BATCH2_CZN_PAGES = 2`；第 2 页由 `ns_batch2_cznTopicUrlOf(2)` 拼 `&page=2`），
  每次抓取 2 个请求；单页失败跳过、两页都失败才 down。页面无 ACAO ⇒ 仍走宿主代理（`www.taptap.cn` 在白名单）。
  **删除**：feed / detail 两个 URL、`X-UA`、按标题挑详情与早停、`NS_BATCH2_CZN_DOCS_CACHE`（TTL 30 s 共享缓存）。
- 解码：`__NUXT_DATA__` 是 Nuxt 的 **devalue** 编码（JSON 数组；元素为字面量或**数字下标引用**；
  `ShallowReactive / Reactive / Ref / EmptyRef / Date / Set / Map / BigInt / RegExp / URL / Object` 是特殊容器）。
  `ns_batch2_cznDevalueOf` 最小实现：每下标 memo + 容器先入 memo 再填（`state` 有自引用环，不 memo 会栈溢出）；
  未知 tag 当普通数组解；下标越界返回 null。`ns_batch2_cznPostsOf` 按「哪个 `data.<hash>` 节点带 `list[]`」
  找帖（hash 每页/每次构建会变），不写死。
- 解析：卡池帖 = 标题或正文首行含 `营救概率提升`（首行是 `-活动内容：` 这类列表项时池名退帖子标题）；
  池名 = 公告标题那一行，角色 = 池名里的 `「」`；期间只取 `概率提升时间：` / `活动时间：` 标签那一行。
  活动 = 同帖 `◈更新时间：` 维护窗 + `活动时间：` 标签（`➤活动时间：` / `〓活动时间〓` / `【活动时间】`）；
  `即日起～<绝对终点>` 的起点锚该帖 `created_time`（没有就留空，不拿 now 猜）。卡池帖的 `➤活动时间：`
  是池的档期 ⇒ 不算活动（不双计）。`维护结束后/前` 用**同页**维护窗映射（p1 的池帖引用同页更新介绍帖的窗）；
  `2026/12/02 维护开始前` 在 p1/p2 都没有对应窗 ⇒ endTs=null（不猜）。
- 活网（2026-11-13 22:40 +08，node 直连；计数 wrapper）：修前（webapiv2）卡池 null / 活动 null、4 个请求
  （1 feed + 3 详情，全部 200，但解析不出当期）；修后卡池「常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始」
  `11-04 02:00 ~ 11-25 02:00`、活动「卡厄思小课堂」`11-11 17:00 ~ 12-01 23:59`，整轮 **2 个请求**
  （p1 + p2；活动侧复用卡池载荷 0 请求）。两侧 gachaFail / eventFail 均 null。
- 夹具：`czn-taptap-topic-p1`（182,074 B）/ `czn-taptap-topic-p2`（156,379 B），2026-11-13T22:29~22:30+08 真抓；
  只保留 `<script id="__NUXT_DATA__">…</script>` 原文（payload 未改，meta.trim 写明；原页 416,735 / 382,736 B）。
  旧 `czn-taptap-feed` + `czn-taptap-moment-*` ×10 **已删**。
- 回归：`test/cases-batch2.mjs` ③ / ③-2 / ③-3 / 反证（decode 环 / 池判据 / 标签行 / 同页维护窗 / `即日起` 锚点 /
  双计守卫 / bwiki 备选源仍在），全批 5820 通过 / 0 失败（UTC 与 +08 同值）。

### 2026-11-11：嘟嘟脸恶作剧换 TapTap（列表 → 详情）；夜幕之下卡池换 bwiki SMW ask

- **嘟嘟脸 `ddlezj`**：默认源（卡池 + 活动）= **TapTap 官方账号**（国服 `group_id=957044`，
  `webapiv2/feed/v7/by-group` → `webapiv2/moment/v3/detail`）。旧 B 站代理公告 API 自 2026-06 起冻结
  （列表最新一条 2026-06-22），降为两侧 `altSources`，抓取器键 `ddlezj-biligame`（该源正文自标 UTC+9
  ⇒ 抓取器自己钉 `+540`；条目 tz 改为 TapTap 的 `Asia/Shanghai`）。
  列表里的 `topic.summary` **只有 200 字**（卡池段在正文深处）⇒ 必须抓详情：正文 =
  `first_post.contents.json` 的段落块（不是 HTML）。`维护后` 的起点用**同帖顶部**那次维护的时刻
  （`YYYY/MM/DD HH:MM 进行维护更新`），**日期不同就不补**（起点未知 ⇒ 不产出）。
  实测（2026-11-11）：卡池「全新使徒【波朗】限时概率上升」`11-05 10:00 ~ 11-19 09:59`、活动
  「主题剧院【篡夺与越轨之间】」同窗 + 悬停 9 条；一次刷新 1 次列表 + 3 份详情（第三帖全结束即停）。
  夹具 `p6-ddlezj-taptap-feed-p{1,2}` / `p6-ddlezj-taptap-detail-{866691594919610832,
  854437201591667060,846447554991229760,811237759342608610}`；回归 `test/cases-p6.mjs` 的 P6-6。
- **夜幕之下 `pengpeng` 卡池**：旧写法抓 HTTP 表（`action=parse&page=契约一览`）；实测该页在
  **`/ymzx`** 这个 wiki 上已是 `#REDIRECT [[契约图鉴]]`（1059 字节，无 `<table>`）⇒ 改抓同一份数据的
  **SMW `action=ask`**（`[[分类:契约]][[条目类型::契约]]|?名称|?契约类型|?活动开始|?活动结束|?推荐风格`，
  实测 200 / 11 条、9 条有窗口，全部 `05:00` 起 / `04:59:59` 止）。池名 = `名称`、角色列 = `推荐风格`；
  **不做「按固定 N 天外推」**（9 期里 6 期 14 天、3 期 21 天）。末条止 **2026-09-10** ⇒ 当前如实 nomatch。
  `source` 标签由「Bwiki 契约一览（停更）」改成 **「Bwiki 契约（SMW）」**。
  夹具 `pengpeng-ask`（+ `pengpeng-contract-redirect` 作反向证明）；回归 `test/cases-new5.mjs` ④。
  ⚠️ 事实提醒：`wiki.biligame.com/pengpeng` 与 `wiki.biligame.com/ymzx` 是**两个不同的 wiki**
  （`gamecenter_wiki_pengpeng-pre_` / `gamecenter_wiki_ymzx-pre_`）。前者的「契约一览」仍是 18 行 HTML
  表、末条 2026-10-01 且最后编辑 2026-09-24（比后者新 1 期、多 6 期历史）；`#REDIRECT` 只发生在后者。


### 2026-11-13：嘟嘟脸 / 夜幕之下活动侧改抓 TapTap **tab 页 SSR**（robots 允许路径）

> ⚠️ 上一节的「嘟嘟脸默认源 = webapiv2」已被下面这一节**取代**（robots 是硬约束）：活动侧改抓
> tab 页 SSR、卡池侧置空未配置，webapiv2 两套降为手动备选；B 站公告备选行为不变。

- **起因（硬事实）**：`https://www.taptap.cn/robots.txt` 有 `Disallow: /webapi/` 与
  `Disallow: /webapiv2/`。上面两节把默认源指到 `webapiv2`（feed 列表 / moment 详情）**违反 robots**，
  且实测会被 WAF 拦。允许抓的是给人看的 tab 页：
  `https://www.taptap.cn/app/<appId>/topic?type=official`（实测 200、无 WAF、服务端渲染）。
- **SSR 形态**：页面里 `<script id="__NUXT_DATA__">` 是一段 **Nuxt devalue** 编码的一维数组
  （对象的值是**数组下标**、数组可带 `["ShallowReactive", n]` 标签、共享引用）。
  共用解码在 `22-fetcher-core.js` 的 `ns_taptap_topicPostsOf`（只解原始值/对象/普通数组；
  结构变了抛 `taptap-topic:*`，**不静默降成"未公布"**）；帖子字段 =
  `moment.id_str` / `moment.publish_time` / `moment.topic.title` / `moment.topic.summary`。
  `summary` 只有**前 200 字**：活动档期（`活动时间：…`）恰在里面；**卡池正文不在**。
- **嘟嘟脸 `ddlezj`**：
  - 活动侧默认 = tab 页（`30-game-biligame.js` 的 `eventsDdlezjTopic`）。每帖摘要只出**第一个**活动段
    （`一、主题剧院【…】` + `活动时间：…`），「维护后」的起点用同帖顶部
    `YYYY/MM/DD HH:MM 进行维护更新`（**日期不同 ⇒ 起点留空、不产出**，复用原解析）。
  - 卡池侧**默认置空**（注册项 `url: ""` = 未配置、不抓；设置页下拉写裸「未配置」）——
    SSR 里没有卡池正文，而能拿到卡池正文的 webapiv2 在 Disallow 路径下。
  - webapiv2 的**卡池**链原样保留为 `altSources[0]`，标签逐字 **「TapTap（不可靠）」**
    （键 `ddlezj-taptap-gacha`；只有用户手动切过去才请求）；旧 B 站公告仍是第二个卡池备选 + 活动备选。
  - 实测（2026-11-13 活网）：活动 = 「主题剧院【篡夺与越轨之间】」`11-05 10:00 ~ 11-19 09:59`，
    一页覆盖当期 ⇒ **1 个请求**；卡池侧 0 请求、无失败。
  - 夹具 `p6-ddlezj-taptap-topic-p{1,2}`（只留 `__NUXT_DATA__` 段，meta 记 url / capturedAt / trim）；
    回归 `test/cases-p6.mjs` P6-6（注册 / SSR → 活动逐字 / 1 请求 / fetchEntry 不抓卡池 /
    手动备选卡池仍可用 / 反向证明 / 覆盖不到才翻第 2 页）。
- **夜幕之下 `pengpeng`**：活动侧默认同样改成 tab 页（`fetchPengpengTaptapEvents` 只换"文本从哪来"，
  `pengpengTaptapWindowsOf` / `pengpengTaptapActivitiesOf` 一行没动）。翻页 = `?page=N`，
  上限 **2 页**，**第 1 页覆盖当前窗口就停**（与嘟嘟脸同口径）。活动侧用户可见标签仍是「TapTap」。
  卡池侧（bwiki SMW ask）不动。实测（2026-11-11）：新风同行 `11-05 05:00 ~ 11-19 04:59`，1 个请求；
  10-30 那天第 1 页无在期活动 ⇒ 翻第 2 页拿到画廊夜游（2 个请求）。
  夹具 `pengpeng-taptap-topic-p{1,2}`；回归 `test/cases-pengpeng-event.mjs`（注册 / SSR 解析 /
  当期逐字 / 反向证明 / 第 2 页抓挂隔离 / bwiki 备选 / 翻页）。
- **未动**：卡厄斯梦境 `czn` 的 TapTap 链（本批范围外，仍走 webapiv2）；README.md；版本号 / tag / 发布。

### 2026-11-13（晚）：夜幕之下卡池默认置空 + 两个 bwiki 备选；「未配置」的一侧不再沿用旧值

- **卡池默认置空**（`30-game-pengpeng.js`）：`url: ""`、不写 `source`（口径同 ddlezj），设置页写裸「未配置」。
  两个备选（只在设置页手动选中才请求）：
  1. 「Bwiki（停更）」= /ymzx 的 SMW `action=ask`（原默认源；抓取器键 `pengpeng-bwiki-ask`）
  2. 「Bwiki 表格（停更）」= /pengpeng「契约一览」HTML 表（新解析器 `pengpengTablePoolsOf`，
     `action=parse&prop=text`；抓取器键 `pengpeng-bwiki-table`）
- **为什么两个都留**：/ymzx SMW 结构最好但内容停更（11 条 / 9 条有窗口，末条止 2026-09-10 04:59）；
  /pengpeng 同一页面仍是活表，实测 2026-11-13 200 / 48920 字节，18 行 = 表头 1 + 有窗口 15 + 「长期」2，
  最新行「天才不必孑立 | 遴选 | 2026/09/10 05:00 ~ 2026/09/24 04:59 | 科技部长」⇒ 比 SMW 新 1~2 期。
- **表格列**：契约 | 开放时间 | 概率提升的风格（**3 列**，不是 4 列）——「遴选 / 活动」是契约格里
  `<span class="ymzx-qiyue-tag">` 的标签。契约名 / 风格名取 `<span style="font-weight:bold;">`
  （格子里图片的 alt 也含名字，直接读整格会重复）。时间 `YYYY/MM/DD HH:MM:SS`、tz=Asia/Shanghai；
  「长期」两行没有两端 ⇒ 跳过；类型只留在条目事实上，不写 `category`（与 ask 解析器同形状）。
- **活网结果（2026-11-13）**：15 条有窗口、最新止于 2026-09-24 04:59 ⇒ 当前没有在期池，抓取器如实
  `null`（nomatch，不抛错）。夹具 `test/fixtures/pengpeng-table`（48920 字节，正文与 11-09 那份
  `pengpeng-bwiki` 逐字相同，只差 NewPP 缓存时间）。
- **真机 bug 修复**（`50-refresh.js`）：ddlezj 卡池 `url=""` 后，面板仍显示旧的「全新使徒【波朗】
  11-05~11-19」。根因 = `mergeEntryRecord` 的"沿回旧值"分支只判"本轮没拿到"，没判"这一侧根本没配
  来源" ⇒ 未配置的一侧把上一次成功的数据永久沿回。修法：`fetchEntry` 在本轮结果上带 `gachaNone` /
  `eventNone`（skipped 与超时两条分支同口径），`mergeEntryRecord` 对这两侧**不沿回、不写 stale**
  ⇒ 显示层走「该来源无卡池 / 活动数据」。真机 `settings.yaml` 的 `customUrls` / `customEventUrls`
  实测都是 `'{}'`，不是设置在顶替默认源。
- **回归**：`cases-new5` ④（表格逐字 / 15 条 / 长期跳过 / 多风格 / 在期载荷 / 当前 null）+ ①（注册形态）
  + ⑤b（先有数据 ⇒ url="" ⇒ 再刷新 ⇒ 该侧为空；覆盖 ddlezj 与 cytq）；`cases-pengpeng-event` ① 同步。
  反向证明：把 `pengpengTablePoolsOf` 改成返回 `[]` ⇒ 3 条 ✗ + `pengpeng-no-table` 抛出；
  把 `gachaNone/eventNone` 临时置 false ⇒ 4 条 ✗，`banner` 仍为「全新使徒【波朗】… 11-05~11-19」。

### 2026-11-14：Fate/Grand Order·**日服**接入（Atlas Academy 数据导出）

- **新增条目** `fgo-jp`（与国服 `fgo` 相邻、**国服那条一个字节没动**）：`name` = 「Fate/Grand Order·日服」，
  `tz` = `Asia/Tokyo`，`defaultHidden` = false；卡池 `source` 与活动 `eventSource` 都是「Atlas Academy」。
- **两个端点**（同域 ⇒ `mode: "direct"`，已登记进 `tools/check-host-allow.mjs` 的 `DIRECT_HOSTS`，
  **不**进 `PROXY_ALLOW_HOSTS`）：卡池 `https://api.atlasacademy.io/export/JP/nice_gacha.json`
  （2,018,335 B / 4334 条）、活动 `https://api.atlasacademy.io/basic/JP/event/search?ongoing=true`（14,301 B / 65 条）；
  两个都实测 200 且 `Access-Control-Allow-Origin: *`。时间是 **epoch 秒**。
- **解析口径**（`30-game-aniplex.js` 的「FGO 日服」段）：`openedAt/closedAt`（活动 `startedAt/endedAt`）
  ×1000 → 毫秒；外显 = 覆盖 now 且**结束最晚**（同结束比开始、再比 id，保证确定）；
  `roles` **留空**（`featuredSvtIds` 是数字 id、`pickupId` 不带名字 ⇒ 不新造角色名）；
  池名里的 `\n` 排版收敛成**一个空格**（外显/悬停都是单行），全角空格不动。
- **无结束哨兵**（这条是本源最容易错的地方）：源站用远未来表示"永久开放"——卡池 `closedAt = 1911653999`
  （2030-07-30T14:59:59Z，本批 6 条共用）、活动 `endedAt = 1893423600`（2030-01-01 00:00 JST，49 条共用）。
  判据 = **本批最大的结束秒且至少两条共用** ⇒ 判为无结束（`endTs = null`），不参与选当期、不进悬停
  （否则"结束最晚"会把 2030 年才结束的「ストーリー召喚」当当期）。
  活动侧同一条 campaign 会被多个 id 重复列出（实测 `消費AP 50%DOWN` 等各有一组同名同窗）⇒ 条目层按
  「名称 + 起止」去掉**完全相同**的重复行；同名不同窗的仍然都留（数组那边仍走既有「归一后同名只留第一条」）。
- **失败 vs 未公布**：不是数组（含 `{}`）⇒ 抛 `fgo-jp-{gacha,event}-bad-shape`；没有一条覆盖 now ⇒ `null`。
- **夹具**：`fgo-jp-gacha` 是**裁剪过**的原响应（8 条：3 条当期池 + 两侧边界 + 3 条无结束哨兵；
  原 2.0MB 不入库，取舍见 `response.txt.meta.json` 的 `trim`）；`fgo-jp-event` **原样 65 条**（14KB，
  裁掉哨兵行会让判据在夹具里失效）。
- **回归**：`test/cases-b3.mjs` ⑪（注册逐字 / 当期池名与秒级 ts / JST 档期 / 活动名 + 起止 /
  哨兵不进外显与悬停 / 「结束最晚 ≠ 还在期」/ 反证：`openedAt` 抹 null ⇒ 不进外显、`{}` ⇒ 抛错、
  2031 年与空数组 ⇒ null）。
- **实测（2026-11-14，本机直连，NOW = 2026-11-14T00:00Z）**：当期池 = 03:59:59Z 结束的那 3 口里的
  50044231「真冬の水着スペシャル ぐだぐだぷにぷにウォーズ！ 高杉晋作ピックアップ召喚」
  （11-13 18:00 ~ 12-02 12:59 JST；29 口在期池里取结束最晚、同窗按 id 升序）；当期活动 = 71735「絆獲得量アップ」
  （11-01 00:00 ~ 12-31 23:59 JST，16 条在期去重后 14 行悬停）。

### 2026-11-14：赛马娘·国际服**活动侧**换源（官方公告 → GameTora）

- **起因**：`umamusume.com` 已**整站 403**（连 robots.txt / sitemap.xml / wp-json 都是 199B 的 Apache
  错误页）⇒ 站点级 IP 封禁，官方接口不能再当活动侧默认。
- **新默认**：`eventUrl` = `https://gametora.com/data/manifests/umamusume.json`（**与卡池同一个 manifest**），
  标签「GameTora」（不带语言括号，用户 2026-11-14 拍板：卡池侧 `source` 同改）；再按 manifest 里
  `events/story-events` 的 hash 取
  `https://gametora.com/data/umamusume/events/story-events.<hash>.json` ⇒ 活动侧 **2 次 GET**（hash 不写死）。
- **名称 / 档期口径**：名称**只取** `name_zh_tw`（繁中译名）——缺 `name_zh_tw` 的条目**直接跳过**
  （不进外显 / `events` 数组 / `eventHoverItems`），**不拿英文名兜底**（用户 2026-11-14 拍板：
  回退到 en 纯浪费）；档期**只用** `start_en` / `end_en`（`*_zh_tw` 那套是日服档期），epoch **秒** → 毫秒。
  条目筛选 = `start_en && end_en && name_zh_tw`；
  外显 = 覆盖 now 且 `end_en` 最晚的一条；一条都不覆盖 ⇒ null（nomatch，不是失败）。
  manifest 缺 `events/story-events` / 表不是数组 ⇒ 抛「GameTora 数据接口失败」（抓取异常）。
- **备选**：官方接口原样保留为 `eventAltSources`，标签逐字「官方公告（英文 · 不可靠）」。
- **轮内复用**：卡池与活动都要同一个 manifest ⇒ 一轮刷新只发一次（`refreshAll` 期间的
  `beginFetchRound` / `endFetchRound`；轮外——设置页「测试来源」、用例直调——一律现取）。
- **回归**：`test/cases-uma-gt.mjs` ⑦~⑨（夹具 `uma-gt-story-events` 原样 57 条：id 1022 的名称/档期/
  秒→毫秒 + `name_zh_tw` 缺失 ⇒ 该条跳过（此刻只有它覆盖 now ⇒ null，不显示英文名）+ manifest 缺键抛错
  + `start_en` 空不进外显 + 表非数组抛错 + 轮内请求数）；
  `test/cases-p3.mjs` / `test/cases-core.mjs` 的旧 golden 仍钉**官方公告**那版 ⇒ 那两处改走备选源（先例：
  2026-11-11 的 ddlezj）。
- **实测（2026-11-14，本机直连）**：在期 = id 1022「甜蜜回憶・午茶時光」`11-09 22:00 ~ 11-23 21:59`（UTC）；
  活动侧单侧 2 次请求（manifest 11,502B + 表 119,375B）；一轮刷新（卡池 + 活动）共 5 次、manifest 命中 1 次。

### 2026-11-14：初音未来：缤纷舞台 **繁中服 / 韩服**（`pjsk-tc` / `pjsk-kr`）

- **源**：与国服**同源同形**（Sekai-World 的 `sekai-master-db-tc-diff` / `sekai-master-db-kr-diff`，与
  `-cn-diff` 同一套 sekai-master-db 派生仓）。`gachas.json` = `{id, gachaType, name, startAt, endAt}`；
  `events.json` = `{id, eventType, name, startAt, aggregateAt}`（**没有 `endAt`** —— 活动游玩期取
  `startAt ~ aggregateAt`，与国服同一条映射）。池名 / 活动名**直接就是本地语言原文**（繁中 / 韩文）。
- **解析器复用**：直接调用国服那套 `ns_sekai_parseSekaiGachas` / `ns_sekai_parseSekaiEvents`
  （`src/client/30-game-sega.js`），**只换 URL 与 tz**；`roles` 仍为空串（与国服一致，不新造）。
- **入口实测（2026-11-14，HEAD + 真 GET）**：三个候选对两个服**全部 200 + `Access-Control-Allow-Origin: *`**
  —— `raw.githubusercontent.com/.../{tc,kr}-diff/main/gachas.json`、
  `gh-proxy.com/<同一个 raw 地址>`、`sekai-world.github.io/sekai-master-db-{tc,kr}-diff/gachas.json`
  （Pages 版**存在**）。四个文件的字节数：繁中 gachas 4,443,816 / events 1,480,360；韩 gachas 4,245,811 /
  events 1,435,245；经 gh-proxy 取回的字节与直连 raw **完全相同**（sha256 一致）。
- **主源 / 备选**：主源 = gh-proxy 包 raw（国服惯例）；备选 = Pages 版（`altSources` / `eventAltSources`）。
  **没有新增直连域名**（`gh-proxy.com` / `sekai-world.github.io` 本来就在 `tools/check-host-allow.mjs`
  的 `DIRECT_HOSTS` 里），也**没有**把 raw 直连再列成第二个主源 —— 4MB+ 的文件只发一遍（一轮刷新 4 次 GET：
  两个服 × 卡池/活动）。
- **tz 依据（2026-11-14，夹具自洽）**：生日池 856「[東雲彰人]HAPPY BIRTHDAY 2026招募」`startAt=1794038400000`
  ⇒ `Asia/Taipei` 渲染 **2026-11-08 00:00**（生日当天零点）；韩服同一池 `1794034800000` ⇒ `Asia/Seoul`
  同样渲染 00:00（两地差 1 小时正是 UTC+8 / UTC+9）；常规池轮换落在**当地 12:00**、活动起于**当地 15:00**。
- **夹具（裁剪过，4MB 级不入库）**：`sekai-tc-gachas` / `sekai-tc-events` / `sekai-kr-gachas` /
  `sekai-kr-events`。源站 58/200 条（繁中）与 56/199 条（韩）→ 只留**卡池 3 条**（854 前一条边界 /
  859 覆盖 now / 861 后一条边界）+ **活动 5 条**（183/184 前、185 覆盖 now、187/188 后）；
  保留对象的字段与取值**逐字未改**，只是删掉了未选中的条目（meta 的 `note` 记了裁剪口径）。
- **回归**：`test/cases-b1.mjs` 的 B1-5 ①~④ —— 注册（id / 名称 / tz / `defaultHidden: false` /
  两侧 url 与标签逐字 / 备选源 / 抓取器登记）、解析（当期池名与活动名逐字 + `startTs`/`endTs` 与源站 ms
  逐毫秒一致）、反证（抹掉 `startAt` 或 `endAt` ⇒ 外显为 `null`；`events.json` 换成 `{}` ⇒ 抛
  `sekai-event-bad-shape` 而不是 nomatch）、引擎整轮（4 次请求 / 无重复 / 两侧都不 fail）。
  来源总数 34 → 36（`cases-core` / `cases-new5` 同步），`REMIND_TZ_BY_ID` 补两条（`cases-remind` ⑦ 守卫）。

### 星铁换官方公告 CMS + 「相对起点」锚定 + 「起点未知 ≠ 已开始」（2026-11-09）


用户当轮拍板的三条规则。**三条互相咬合，改一条要同时看另两条**。

**① 星铁卡池默认源 = 官方公告 CMS**（`30-game-hoyoverse.js`）

- 端点：`content_v2_user/app/1963de8dc19e461c/getContentList?iChanId=257&iPageSize=200&iPage=1&sLangKey=zh-cn`
  （一页 200 条，正文 `sContent` **在列表里就给了** ⇒ 一次刷新 1 个请求；host 已在 `PROXY_ALLOW_HOSTS`）。
- 条目识别**只看正文特征**（正文里出现 `跃迁时间为`），不靠标题白名单：标题会变，而
  「Fate[UBW] 联动跃迁说明」这种没有该句式的公告也就不会被误收（它是"12:00 后长期开放"）。
- ⚠️ 正文**累积**：后一期会把前一期窗口再抄一遍（4.6其二 抄了 4.6其一 的「真珠」）⇒
  必须**收集全部窗口**再按 `(角色, 起点, 终点)` 判重，**不能取第一条公告就完事**。
- 选法：覆盖 now 的窗口**全部**合并角色 → 空档期取"下一个要开的"那一批（同一 `startTs`）→
  只剩起点未知的行就如实列出（不算在期）→ 都没有 ⇒ `null`（未公布）。
- bwiki「历史跃迁」降为 `altSources[0]`（`fetcher: "hsr-bwiki"`，走旧抓取器），设置页可手动切。

**② 「相对起点」统一锚定**（`23-parser-time.js` 的 `anchorStartOf(text, anchorHour, tz, hint?)`）

| 源站写法 | 结果 |
| --- | --- |
| `2026/09/28 4.6版本更新后` / `2026/09/28` | 该日 `anchorHour`:00（源站时区） |
| `10月27日 开服后`（无年份） | 借 `hint` 补年份后同上；补不出 ⇒ `null` |
| `4.7版本更新后`（**只有版本，没有日期**） | `null`（起点未知，绝不猜） |
| 已写绝对时刻（`2026/10/21 12:00`） | 原样返回（锚点不生效） |

- **星铁 `anchorHour = 10`**（版本更新 06:00 开始、预计 5 小时 ⇒ 开服 10:00，+08）；
- **无期迷途 `anchorHour = 14`**（官方公告「维护时间：X日10:00-14:00」，开服 = 窗口结束）。
  卡池侧为了拿到这份窗口，在同一次刷新里串行补 2 个请求（资讯列表 1 次 + 最新维护公告正文 1 次，
  `wqmtGachaAnchorsOf`）；**取不到就退常量 14:00**（`WQMT_OPEN_FALLBACK_HOUR`），不影响出数据。
- 旧实现（星铁 bwiki 那种"日期+版本标签"）走的是 `VERSION_UPDATE_ANCHOR = 04:00`，**本批没动**：
  它只影响 bwiki 备选里的活动/旧表，而星铁卡池已经不吃那条路了。

**③ 起点未知 ≠ 已开始**（`24-parser-window.js` 的 `coversNow`）

- `coversNow` 现在**两端都必须明确**（`startTs != null && endTs != null` 且 `startTs <= now <= endTs`）。
  旧口径 `startTs == null ||` 那个分支正是"未来池假在期"的根源（无期迷途 11-11 批、星铁 4.7 批、
  绝区零 `X.Y版本更新后` 上半都是这么变成"在期"的）。
- 受到影响的三处判定：`selectCurrent` 的 `inWindow`（不再用 `hadOpenStart` 兜底）、
  `81-schedule-model.js` 的 `sideViewOf`（gacha 在期过滤）与 `scheduleItemOf`（起点未知 ⇒
  `state = "wait"`，`scheduleWhen` 写「开始时间未知」，不进「近期」/提醒/24 小时计数）。
- **事实不丢**：悬停与数据数组仍列出这些行（`coveredOrOpen` = 在期 ∪ 起点未知但终点未过），
  只是不冒充"在期"。**代价（有意的，宁可少显示）**：
  - 绝区零 **bwiki 备选源**整页都是 `X.Y版本更新后` ⇒ 一切到备选就「该来源无数据」（默认官方源不受影响）
    —— **这一条已按下面 ④ 的例外放行**（2026-11-09 晚）；
  - 星铁 **bwiki 备选**只剩两端明确的那口池当外显，`4.6/4.7版本更新后` 的几口池只出现在悬停里；
  - 星铁**活动一览**（bwiki，仍是默认活动源）里写成 `4.6版本更新后` 的活动同样只进悬停。
- 反向证明（改回旧口径 ⇒ 红）见 `test/cases-hsr-official.mjs` ④ 与 `test/cases-core.mjs` ⑤ 的
  `APPROVED_DIFF`（白名单只有 `hsr:gacha` / `hsr:event` 两个键，并有守卫防止它扩大）。

**④ 例外：绝区零 bwiki 备选源「起点未知 = 已开始」**（2026-11-09 晚，用户选 B，全仓**唯一**例外）

- 用户原话：**「选 B，绝区零的 bwiki 不收录未来卡池」**。
- **依据**：`altSources` 的「Bwiki 往期调频」（fetcher `zzz-bwiki`）那一页**不收录未来卡池** ——
  2026-11-09 实测整页每行起点都写 `X.Y版本更新后`、终点是具体日期，也就是"列出来的池必然已经开过"。
  所以对这一页把"起点未知"当"已开始"是**安全**的（旧口径下它本来也是这么显示的）。
- **怎么实现的**：来源条目上一个显式开关 `unknownStartIsActive: true`（`registerSource` 的
  `altSources` / `eventAltSources` 元素可带，全仓只有这 1 条带）。它由那一条**自己的抓取器**读出、
  交给 `selectCurrent(items, now, { unknownStartIsActive })`；抓取器只在设置里**手动选中**该备选源时
  才会被执行（`gachaFetcherFor` 命中 `altSourceId`）⇒ 天然"只对该来源生效"。
- **落点只有一个**：`24-parser-window.js` 的 `selectCurrent`（`inWindow`）。`coversNow` /
  `sideViewOf` / `scheduleItemOf` **保持严格**——放行之后 `fillMissingStarts` 已经把起点补成具体时刻，
  载荷 `bannerDates` 是一段可解析的绝对窗口，下游看到的与 2026-11-09 之前逐字相同。
- **为什么别的来源不适用**：星铁 bwiki 备选（`hsr-bwiki`）**收录未来池**（「4.6/4.7版本更新后 ~ …」
  在开池前几周就挂在页上），同样放行会立刻重现 2026-11-09 修掉的"未来池假在期"。所以这个开关
  **不是**全局配置项（不进 `DEFAULT_SETTINGS` / `CONFIG_KEYS`，设置页看不到），只逐条挂在来源声明上。
- **回归**：`test/cases-zzz-bwiki.mjs`（第 36 段）钉住 ①开关只有 1 条 / 不在设置项里、②端到端切源后
  有数据且 `state === "live"`、③同一页换没有开关的抓取器仍严格、④星铁 bwiki 仍严格、
  ⑤默认源在同样情形下仍严格、⑥反向证明（把开关改成 `false` ⇒ 同一页立刻 `null`）。
  `test/cases-p3.mjs` 的 P3d ⑤（绝区零 bwiki 备选）因此**回到**改造前的 golden / 等价 oracle，
  原先那几条"已批准差异"断言已删除。


### 卡池侧挑池：全局「有角色优先」（2026-11-09 用户拍板 B）+ 星塔扫描深度 50

- **规则（全仓）**：卡池侧挑池 = **在期 ⇒ 有角色优先 ⇒ 结束最早 ⇒ 起点升序 ⇒ 数组原顺序**。
  · 显示层唯一落点：`81-schedule-model.js` 的 `sideViewOf`（gacha 通用分支；`schedulePickOf` 的特化款
    仍走各自规则，不受影响）；「有角色」= `roles` 非空，`string[]`（P1 之后）与 `string`（旧缓存）两种
    形状都认（`scheduleHasRoles`）。
  · 星塔**记录自己**的外显（`banner/roles/bannerHover` 的那口池）由 `30-game-yostar.js` 的
    `ns_stellasora_stellaPickOrderOf` 用**同一把尺**挑；数组与悬停的**行序**仍由 `poolHoverOrderOf`
    （档期序）决定，本轮**不改**数组顺序。
- **为什么需要它**：卡池侧最常见的「无角色池」是星塔秘纹池 / 星铁光锥池 / 原神武器池 —— 它们常比角色池
  更早结束，只按「结束最早」会把它们顶到外显 ⇒ 面板首行只剩池名（没有角色可看）。有角色池之间才比时间。
- **数据层的现实（别误读）**：数组里**只有主条带 `roles`**（`dataArrayExtrasFromEntriesOf` 只给并列条
  title / show / ts / raw），所以这条规则实际等价于「在期里优先记录自己那口主条（它有角色时）」——
  面板因此与 `banner` / 悬停里那口有角色的池一致。逐路径 × 三时刻的**有意变化**登记在
  `test/cases-p3.mjs` 的 `P3B_GACHA_PICK`（czn ×3、r1999 ×1；都是「面板从无角色的并列条改回记录自己
  那口角色池」）。
- **星塔挑池键**（`ns_stellasora_stellaPickOrderOf`）：roles 是第一档（不再是「窗口全等才插手」的星塔特例）
  → 结束最早 → 起点升序 → 文档顺序（`row.order`；旧的 `id` 倒序已删）。
- **扫描深度**：一页 **50 条**（`STELLA_SCAN_SIZE`），且**只在还没扫到「上一期已结束」**（本页出现
  `endTs < now` 的档期）时才翻第 2 页，最多 2 页（`STELLA_SCAN_PAGES`）。注册表 url 里的 `size=20`
  只是地址模板，`ns_stellasora_stellaPageUrl` 统一改写 `size`/`index`（用户改地址也压不低扫描深度）。
- **roles**：每个池条目都写 `roles`（只收「5星旅人」= 角色；秘纹池留空），主条 `roles` 由解析器直接给，
  不再靠 `50-refresh.js` 从 `rec.roles` 反算 ⇒ `show` 有角色时是去修饰的角色名、秘纹池退回池名。
- **已知偏差（C 项，本任务不修）**：起点写「维护结束后」时用**该公告的 `publishTime`** 当锚点
  ⇒ 同批两篇公告的 `publishTime` 差 <1 秒时，两池 `startTs` 不等（10-02 夹具就是这样）。新口径下
  两池分别是角色池「沐于温情笑意中」（艾蕾）与秘纹池「空白的稚梦」⇒ 角色池胜出（banner 回到 golden 原值）。
- **回归**：`test/cases-p7.mjs` ⑨（live 11-09 / 11-12 两份夹具、扫描深度 / 翻页 / 最多 2 页的反向接线点）；
  `test/cases-p3.mjs` 的 `P3B_STELLA_ROLES` 登记 10-02 的「roles 如实写出」（`艾蕾`；banner 不变），
  `P3B_GACHA_PICK` 登记显示层的逐路径变化。
  ⚠️ live **11-09 外显 = 「邂逅源初之剑」**（`5星旅人「尘沙(源初)」`，10-20 批、~11-10 10:59）：它也是
  角色池、且比 10-27 的「乘光而起的星之砂」（~11-17）更早到期 ⇒ 按这把尺就该它先露。任务书原先预期
  11-09 露「乘光而起的星之砂」，但 4930 的正文写的是 5★**旅人**（不是秘纹池）——这条事实已在
  `test/cases-p7.mjs` 的断言注释里写明。

### ba-cn 跳过「临时」维护公告（2026-11-09）

- **ba-cn 卡池**（`30-game-bluearchive.js` 的 `fetchBaCn`）：扫「维护更新说明」时，运营的
  「10月30日**临时**维护更新说明」也会命中"维护时间 + 14 天覆盖 now"，且排在 10-29 正式公告之前；
  老代码在这里 `break`，而临时公告正文 0 条招募/活动 ⇒ 整列「新卡池未公布」。现在**跳过临时公告、
  继续往下找**覆盖 now 的那篇（10-29 ⇒ 艾利 / 庚 两池，10-29 14:00 ~ 11-12 13:59）。判定以**标题含
  「临时」**为主（临时维护 / 临时维护更新 /【临时】… 全覆盖），正文只作标题漏写时的兜底（清洗后前三行
  出现「临时维护」）。全部被跳过 ⇒ 仍按现状返回 `null`（未公布，不硬凑）。回归：`test/cases-ba.mjs`
  的 `ba-cn/1030`（真夹具 `test/fixtures/ba-cn-list-1030`，真抓后按真实结构保留 1996/1995 两篇）。
- **uma-global 活动【已撤回「空壳 ⇒ nomatch」】**（`30-game-cygames.js` 的 `parseUmaIndex`，契约说明见
  uma-global 注册项注释）：国际服英文公告 `api/ajax/pr_info_index` / `pr_info_detail` **只认 POST**，
  且必须带 `Content-Type: application/json`。**GET 恒返回 HTTP 200 + 21 字节 `{"response_code":200}`**
  （无 `information_list`）—— 这枚空壳是「方法 / 请求体没送到」的退化响应，**不是**「当期没有内容」的
  契约。基于 GET 探针得出的「200 空壳归 nomatch」会把「transport 把 POST 降级成 GET」这种真故障悄悄
  咽掉，故**整体撤回**：`parseUmaIndex` 恢复原语义（`response_code !== 1` 一律抛 `uma-bad-response`，
  该侧如实报失败），夹具 `p5-uma-global-empty-shell` 与 `test/cases-p5.mjs` 的 P5-7 段一并删除。
  排查顺序：**若某侧只剩空壳，先看请求方法 / Content-Type，再看源站**。


### 2026-11-11 解析修补（第一批，6 处）

都是"源站形态变了 ⇒ 解析取不到在期数据"的当班 bug；每处都用当日真抓夹具钉住，并带一条反向证明。

- **hlr 学院公告翻页**（`30-game-netease.js`）：`/news/update/` 首页 11-09 起新增 4 条
  「B站渠道资产找回」公告，把 `10月1日新增内容公告`（缱绻假日 10-09 ~ 11-20，content 1316283）
  挤到 `index_2.html`；旧实现只读首页 ⇒ 活动空窗。现在**首页 + 第 2 页合并**（`HLR_LIST_MAX_PAGES = 2`，
  候选数达到该类配额即停），并给 `hlrListPageUrlOf`。回归：`test/cases-wd-hlr.mjs` ⑩
  （`hlr-update-list-1109` / `hlr-update-list-1109-p2`，反向证明 = 第 2 页失败 ⇒ null）。
- **ba-global 活动**（`30-game-bluearchive.js` 的 `fetchGameKeeBa`）：GameKee 目录树里那条改名为
  **「国际服当期攻略」**（content 728357），旧匹配 `includes("活动")` 永不命中 ⇒ 活动名恒空。
  国际服放宽为 `活动|攻略`（日服保持原逻辑）。回归：`test/cases-ba.mjs` ⑤
  （`ba-gk-tree-1109` / `ba-gk-detail-728357` / `ba-gk-blocks-1109`）。
- **ba-jp 卡池回退**（同文件 `parseBaJpNews`）：最新募集 `id=708` 的实施期间从 11-11 17:00 JST 才开始，
  旧实现取到第一篇就 `break` ⇒ 空；现在**扫到有覆盖 now 的池为止**，回退到仍在期的 `id=704`。
  同时起点「メンテナンス後」的锚点从"最新一篇维护公告"改成**该条募集往上最近那篇**（704 ⇒ 705 的 19:00，
  旧全局值是 709 的 17:00，会晚于 704 的终点）。回归：`test/cases-ba.mjs` ⑤（`ba-jp-news-1111`）。
- **p5x 卡池**（`30-game-perfectworld.js`）：公告 264741 的「都市更新 / 限定扭蛋复刻」
  （活动时间 2026-10-22 ~ 12-24）在期，但卡池只收含「契约」的区块；而「契约更新」的档期是**裸行**
  `2026年9月24日-2026年11月19日`（没有 `活动时间：` 前缀）。现在**裸档期行也认**
  （`P5X_BARE_TIME_RE`，整行就是区间才算），并把「扭蛋」纳入卡池区块候选。回归：`test/cases-p5x.mjs`
  末尾真机 5.4.2 段（10-01 只靠裸行出契约、12-01 只靠扭蛋候选出限定扭蛋复刻，12-25 两侧过期 ⇒ null）。
- **wqmt 活动候选配额**（`30-game-wqmt.js`）：11-09 起「装束 / 档案 / 影像捕获 / MBCC前瞻」密集发布，
  把真正写档期的 10/27 维护公告（id=2099）挤到第 7 位，旧配额 6 截断 ⇒ 活动空窗。
  `WQMT_EVENT_MAX_DETAILS` 6 → 10（列表 + 10 篇正文，仍远低于 20s 超时）。回归：`test/cases-new5.mjs` ⑥
  （`wqmt-news-list-1111` + 前 10 条正文；反向证明 = 截回前 6 条 ⇒ null）。
- **ournotes-global 语种**（`30-game-bandori.js`）：注册参数 `lang=zh-tw` 恒返回 `total_count:0`，
  改 `lang=en` 同刻返回 19 条；详情参数必须叫 `news_id`（用 `id` 回 `code:-400`），且 id 要以原始字符串传
  （18 位转 Number 丢精度）。`OURNOTES_GLOBAL_LIST_URL` 仍是 zh-tw（它是"空响应"真夹具的来源、也是无参兜底），
  注册项与详情走 en。回归：`test/cases-p9.mjs` P9-6b（真夹具 `p9-ournotes-global-en-*`；
  19 条全是 6~9 月开服期公告，当前时刻两侧仍如实 null）。

门禁：`node build.mjs` + `--check` + `cd test && node all.mjs` 在 `TZ=UTC` 与 `TZ=Asia/Shanghai`
各一遍，均为 **5448 通过 / 0 失败**（改动前 5407）。


### 2026-11-11：移除「窗口超过 120 天 = 长期/常驻」判定

事实：`LONG_TERM_MAX_WINDOW_DAYS` / `isLongTermWindow` / `isLongTermEvent`、`pickCovering` 的 `dropLongTerm`、5 个剔除调用点、bestdori/sekai 的 `LONG_MS` 与 `long` 标记、蔚蓝档案的 `keepLongTerm` / `longTerm` 全部删除；长窗口只按「是否覆盖 now」判定，原神 294 天（`「巡历雪境，凝铸锋锐」新手`）与明日方舟 363 / 236 天（`卫戍协议：卫戍协议·规程` / `集成战略：沉沦者的黑流树海`）窗口因此出现在 `events[]` 与悬停里（`isPermanentEvent` 与「以及常驻活动 N 项」不受影响）。


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
- ✅ **macOS 已真机验证（2026-11-14，macOS 26.6.2）**：`node build.mjs --check` 与 `node all.mjs` 在 Mac 上全绿；测试通知走真实 `osascript` 并返回 `ok:true`。这一轮一并修掉三处**只在 macOS 上才踩**的坑：darwin 断言写死 `ok === false`（Mac 自带 `/usr/bin/osascript` ⇒ 必红）、`.githooks/pre-commit` 缺可执行位（git 直接忽略 ⇒ 守卫静默失效）、钩子里 `$( )` 内的 `case` 被 macOS 的 bash 3.2 拒绝解析（补上可执行位后会拦掉每一次提交）。
- ⚠️ **横幅能不能显示仍取决于系统权限**：Sequoia 起 `display notification` 由「脚本编辑器」代发，必须在「系统设置 → 通知 → 脚本编辑器」里允许；未允许时 `osascript` 仍返回 0、插件按"已送达"落盘 ⇒ 排查时先看 `~/Library/Application Support/dsh-gacha-calendar/remind.log`。

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
    - ✅ **逐条目提醒开关（设置页「提醒」列）—— 2026-11-09 改成「默认全部勾选 + 取消列表」**：
      · ⚠️ **2026-10-26 曾整列隐藏、2026-10-30 已恢复**：送达没实现时勾了没有效果 ⇒ 用常量
        `SHOW_REMIND_COLUMN`（`80-shared-ui.js`）把**表头 / 每行复选框 / 空列表提示 /
        网格列宽**四处一起藏起来；送达开始真的按它过滤后，常量改回 `true`，整列恢复。
      · 用户原话（2026-11-09）：「**改成每个条目的提醒都默认勾选，但展示开关是提醒开关的上位，
        若展示开关关闭（包括默认关闭和用户手动关闭）则提醒开关关闭且置灰**」。
      · 设置项 = `remindOffGames`（`string[]`，**取消列表**）—— 设置页游戏列表的**「提醒」**列；
        出厂 `[]` ⇒ **每个条目都默认勾选**；列表里只装用户**手动取消**的那几条。
        写入只走逐行的复选框（批量「全部提醒」按钮 2026-10-30 按用户要求删掉了，不恢复）；
        勾上 = 从列表里摘掉，取消 = 并入（幂等）。
      · ⭐ **不变量：「展示」是提醒的上位**。生效提醒 = 条目**展示中** ∧ **不在** `remindOffGames` 里。
        展示关着（出厂 `defaultHidden` 没被 `shown` 打开，或用户手动 `hidden`）⇒ 该行复选框
        **未勾选且置灰**（`disabled`），点不动；**而且展示关时什么都不写** —— 所以重新打开展示
        ⇒ 不需要任何数据动作就回到勾选（那是 `remindEntryShownOf` 现算的，不是把旧值搬回去）。
        判定只有一处实现：`65-remind.js` 的 `remindEntryShownOf` / `remindGameAllowed` /
        `remindAllowedTickOf`（2026-10-30 从 `60-helpers.js` 搬进来，因为宿主半边只装
        `65-remind.js` = `lib/remind-core.mjs`，放在别处宿主只能抄第二份）。
        它与面板的 `isEntryHidden` 是**两份实现、同一套规则**（hidden / defaultHidden+shown），
        等价性由 `test/cases-remind.mjs` ⑱ 逐来源 × 逐组合钉住。
      · 出厂默认值：`10-config.js` 的 `DEFAULT_SETTINGS.remindOffGames = []` 与宿主
        `src/index.js` 的 `REMIND_OFF_GAMES_DEFAULT = []`（schema 默认值与"配置读坏"的兜底共用它）；
        `engine-head.js` 的 `CONFIG_KEYS` 也含它（三处成套的守卫见 `test/cases-ticker.mjs` ④）。
      · ✅ **送达侧已消费**：宿主 `runRemindRound` 读 `remindOffGames` + `hidden` + `shown`
        （都经 `configValueOf` 解包）→ `remindOffGamesOf` 归一 → `remindAllowedTickOf`
        **在判定节点之前**过滤条目，并且把状态里不属于"生效提醒"的键一并清掉
        （没展示 / 被取消 ⇒ 不提醒 **且**状态不留痕，之后勾上或重新打开会正常提醒）。
        脏值策略：非数组 ⇒ 回落 `[]`（= 谁都没取消，**不静默丢提醒**）；数组里的非字符串元素忽略。
        每轮 `remind.log` 都带一个「未展示或已取消提醒跳过 N 条」的计数。
      · 🔁 **一次性迁移（`migrateRemindOnce`，宿主 `apply` 里 `void` 触发）**：老配置里的
        `remindGames`（旧**白名单**）在 `remindMigrated !== true` 时被翻译成取消列表 ——
        `remindOffGames = 全部条目 id − 旧白名单`，与 `remindMigrated: true` **同一笔**写入；
        旧配置里根本没有这个键（从没动过那一列）⇒ 只写标记（出厂 `[]` 已是"全部勾选"），
        旧值是脏的（不是数组）同样只写标记。「全部条目 id」= `REMIND_TZ_BY_ID` 的键（内置 33 款，
        与 `SOURCES` 的 id 集合有守卫）+ 配置里 `customEntries` 的 id。迁移只跑一次：
        标记写过之后用户再怎么改都不再被覆写。旧键 `remindGames` 因此**只读地**留在宿主 schema 里
        （**刻意不给 default**：默认值会让新装用户看起来像"存过一份空白名单"，迁移正好迁反），
        迁移窗口结束后连同 `migrateRemindOnce` 一起删（函数注释写了删除方法）。
        ⚠️ 迁移的边界：出厂默认隐藏的条目也会被写进取消列表（旧白名单里本来就没有它们）⇒
        老用户之后**首次**把某个出厂隐藏的条目打开时，「提醒」那一格是未勾选的（点一下即可）。
        新装用户不受影响（出厂 `[]`）。**轮播不读它**（轮播只有 `tickerOn` + `tickerHours`，见第 1 项）。
   - 守卫：`test/cases-ticker.mjs` ④/⑧ —— 生效语义（展示上位 / 默认全勾 / 脏值）
     + `remindOffGames` / `remindMigrated` 三处成套 + 列恢复后**入口都在** + 「展示关 ⇒ 置灰且
     不写数据」的静态守卫 + **反向守卫**（轮播链路与函数签名里都不许出现逐条目提醒）；
     `test/cases-remind.mjs` ⑱ —— **行为**用例（拿假条目 + 假 settings 跑真判定）：默认全勾 /
     手动取消不提醒且不留痕 / 展示关不提醒（即使在取消列表外）/ 展示关→开自动恢复 /
     出厂隐藏要靠 shown 打开 / 旧状态键被清理 / 两份「展示中」判定等价 / 宿主接线与日志格式；
     `test/cases-remind.mjs` ⑲ —— **迁移**用例（真跑宿主 `migrateRemindOnce`）：旧白名单 →
     其余全部进取消列表、只跑一次、没旧值只写标记、旧值脏了只写标记、自定义条目也算、
     update 抛错不崩、`apply` 里 `void` 触发。
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

### 待办：对话工具（Dsh ctx.tools）—— 2026-11-09 记录，暂缓

DSH 本身提供工具注册表（`@deepseek-ai/dsh-tools` 的 `ctx.tools`，
`ctx.tools.register(defineTool({...}))`）：注册后 schema 自动进系统提示词，**模型在对话里就能直接调用**。
本插件目前只用了 UI 槽位（`settings.section` / `sidebar.footer.action`），**没有注册任何工具**。

可行的候选工具（待评估）：
- `gacha_upcoming(within_hours)`：返回 N 小时内到期的条目（游戏 / 侧 / 事项名 / 截止时刻 / 剩余）
- `gacha_status()`：返回来源健康摘要（哪些抓取失败 / 哪些未配置）
- `gacha_refresh()`：触发一轮刷新（需评估权限与幂等性）

接入要求：`cordis.patch.yml` 增加工具插件入口 + 实现 `defineTool` + 对应用例。
注意：工具面向模型，对外文案要求与面板一致；README.md 的功能清单属审批制，加工具后需用户确认才能改。
状态：**用户 2026-11-09 指示「加入待办，稍后处理」** ⇒ 本次不实现。

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
