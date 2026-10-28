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

**源站改版时只需改一处**：改 `src/client/25-parser-shared.js` 或对应的 `src/client/30-game-*.js` → `npm run build` → 两个包一起发版，各平台重新构建即可。

- `src/` 是唯一真源，`lib/` 与 `packages/core/` 都是**构建产物，不要手改**。
- `build.mjs` 做三件事：按 `ORDER` 原样拼接 `src/client/*.js` → `lib/client.js`（DSH 的 `__ModuleLoader__` 工厂形态）；复制 `src/index.js` → `lib/index.js`；把 core 主体包成 `packages/core/core.mjs`（ESM 导出 `createEngine`）。拼接逐字节确定，所以 `check` 能给出"一致/不一致"的确定结论；同时会把根 `package.json` 的版本号注入两个产物。
- 源文件约定：**LF 换行、UTF-8 无 BOM、Tab 缩进**（带 BOM 会让 DSH 启动直接失败）。`build.mjs` 会强制校验；`.githooks/pre-commit` 还会在提交 `src/**`、`lib/**`、`packages/**` 或 `build.mjs` 时自动跑一次 `check`，防止绕过源码直接改产物。
- **钩子怎么生效**：`npm install` 会自动执行 `prepare` 脚本把 `core.hooksPath` 指到 `.githooks`。若跳过了 install，手工执行一次即可：`git config core.hooksPath .githooks`。
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
│       ├── 15-env.js         # core 环境缝：transport / 时钟 / 计时器
│       ├── 20-source-core.js  # 来源容器 SOURCES + registerSource（模块顶层）
│       ├── 21-fetcher-tables.js # GACHA_FETCHERS / EVENT_FETCHERS（与游戏文件同层：每引擎一份）
│       ├── 22-fetcher-core.js # 抓取公共设施：抓取桥接 / 通用载荷 / 备选源解析
│       ├── 25-parser-shared.js # 共用判定（当期 / 长期 / 年份）+ 悬停排版 + 实体解码 + 时间 + 选择
│       ├── 30-game-hoyoverse.js   # 米哈游：原神 / 星穹铁道 / 绝区零（含米游社备选源与崩坏3）
│       ├── 30-game-kuro.js        # 库洛：鸣潮
│       ├── 30-game-hypergryph.js  # 鹰角：明日方舟 / 终末地
│       ├── 30-game-bluearchive.js # 蔚蓝档案：国服 / 国际服 / 日服
│       ├── 30-game-bandori.js     # BanG Dream：国服手游 / OurNotes 日服 / 国际服（Bestdori 备选）
│       ├── 30-game-bwiki.js       # bwiki 系：物华弥新 / 战双 / 卡厄斯 / 雪松
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
│   ├── all.mjs      # 统一门禁：聚 23 段用例（P5X / B1~B3 / P4~P9 / 蔚蓝档案 / 异环 / 赛马娘 GameTora + 规则静态守卫 + 时区口径 + 侧栏轮播 + 到期提醒 + 来源健康 + README 结构图守卫 + core 产物守卫 + 设置页标题行（版本号 + Star 指引）+ 搜索与筛选 + 排期导出 .ics）
│   ├── cases-*.mjs  # 各段用例（23 个：cases-p5x / b1~b3 / p4~p9 / cases-ba / cases-pw / cases-uma-gt / rule-lint / tz / ticker / remind / health / readme / core / star / filter / ics）
│   ├── load.mjs     # 加载构建产物，取 exports.__regression（解析器 + env 工具 + 来源表）
│   ├── harness.mjs  # 夹具 fetch 注入 + check/section/summary + 契约与悬停断言
│   ├── registry-shim.mjs # 各批次注册表规格快照 + DRIFT 守卫（与运行时 SOURCES 核对 tz/name）
│   ├── capture*.mjs # 抓真实响应生成夹具；run.mjs # 单段直跑
│   ├── map.json     # 请求 URL → 夹具路径（**入库**）
│   └── fixtures/    # 真实响应快照（**已入库**（2026-10-18 起），重建方式见 test/README.md）
├── tools/           # 守卫脚本：require-publish-consent（发布闸门）/ check-host-allow（来源域名 vs 代理白名单）
├── assets/          # README 截图
├── .githooks/       # pre-commit：编码校验 + src/产物一致性
├── package.json     # dsh.bundle.patch + dsh.client.inject（DSH 加载规范）
├── cordis.patch.yml # bundle patch
└── LICENSE / README.md / README_Dev.md / AGENTS.md
```

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
4. 逐条 `powershell.exe -EncodedCommand` 弹 WinRT toast（脚本在 `src/index.js` 的 `toastScriptOf` 里生成，**不落地 .ps1、不引用 `tools/`**）。发之前**每轮只判定一次**通知身份：设置页启用过「二游日历」⇒ 用 `NOTIFY_AUMID`；否则 / 探测失败 ⇒ 回退 Windows PowerShell 自带的 AUMID（身份问题绝不能让提醒发不出去）。身份状态**先读 `%LOCALAPPDATA%\dsh-gacha-calendar\identity.json`**（毫秒级；探测一次 ≈0.9 秒，缓存在这里就不必每轮再付）；**没有缓存 / 缓存读坏也不等探测**：GET 先回保守值（未启用 + 配置名）再把探测丢到后台，`apply()` 里还有一次启动预热（`void`，不 await）⇒ 读取路径永不卡在 PowerShell 上，探到后下一次读取自动纠正；
5. 状态原子写回 `%LOCALAPPDATA%\dsh-gacha-calendar\host-state.json`；身份缓存 `identity.json` 同样原子写（`.tmp` → rename），超过 24h 只在后台补探一次纠正（GET 仍先回文件内容）；后台探测单飞且**推迟到下一拍**（`setTimeout(0)`：探测的同步前缀是一次扫开始菜单的 `readdirSync`，直接在 GET / apply 的调用栈里跑会把 0.5ms 变成 80~120ms）；日志追加到同目录 `remind.log`（超 256KB 自动只留后半段）。

几个踩过的坑，改这块之前先看：

- **`config.xxx` 不是裸值**。本插件所有设置字段都标了 `.volatile()`，DSH 交给 `apply` 的是 `{ get(), [Symbol.for("cosmokit.volatile.write")] }` 引用对象 —— 直接 `cfg.remindOn === false` / `typeof cfg.lastData === "string"` **永远不成立且不报错**，表现就是"提醒永远不发"。统一走 `configValueOf()` 解包。
- **定时器必须挂在 `ctx.effect` 的 disposer 里清理**。设置页每写一次都会让插件整体重载；漏清就是每次改设置多叠一个看不见的定时器。
- **通知身份（AUMID）是可选功能，不是安装步骤**。默认用 Windows PowerShell 自带的 AUMID，横幅顶部就显示「Windows PowerShell」；用户在设置页点「启用」后，宿主才会往**当前用户**开始菜单写 `<notifyName>.lnk`（默认 `二游日历.lnk`，名字可在同一行的窄输入框里改；文件名先过 core 的 `notifyNameOf` 清洗：非法文件名字符换空格、空 ⇒ 默认、超长截 40 字、Windows 保留设备名 ⇒ 默认）并绑定 `System.AppUserModel.ID = DshGachaCalendar.Reminder`（`notifyIdentityEnableScript`，内联 C# `IPropertyStore`；**只在 `HKCU\Software\Classes\AppUserModelId\<AUMID>` 写 DisplayName 不够** —— 实测 toast 弹不出来）。**改名 = 先删旧的再按新名字重建**：删除只认「AUMID 等于我们的」那条 .lnk（与文件名无关 ⇒ 绝不碰用户自己的快捷方式），且目标名字已被别人的快捷方式占用时回 `shortcut-name-taken`、**一个文件都不动**。「移除」只删快捷方式、保留注册表键（没有快捷方式时它不会被用到）。判断走 `remindIdentityOf`（纯函数，4 种组合有测试），失败一律回退。
- **失败不记已发**：某条送达失败时它对应的档位会被回滚，下一轮重试，直到成功或条目过期作废。
- ⚠️ **只在 DSH 运行期间生效**：宿主随 DSH 起停，DSH 关掉就没人盯着了（换来的好处是装插件零安装步骤，不碰系统计划任务；开始菜单那条是可选、可随时移除的）。
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
     （见下面第 2 项；2026-10-26 起整列**暂时隐藏**），**轮播不读它**。
   - ✅ 判定口径（**只判结束**；开始方向已暂时停用，原因见下）：即将结束 = 已开始（`startTs <= now`）且 `endTs ∈ (now, now + N 小时]`；
     即将开始 = `startTs ∈ (now, now + N 小时]`（公式留档，该方向已停用）。纯函数 `dueKindOf`（`60-helpers.js`，返回
     `"" / "end" / "start"`；当前只会返回 `"" / "end"`）+ 窗口换算 `dueWindowOf` / `tickerItemsOf`（`81-schedule-model.js`，
     复用面板外显那条「源站文本 + tz → 本机墙钟」链，所以轮播与面板"还剩 X"永远同源）。
     ⚠️ 2026-10-28：**开始方向暂时停用** —— 解析器只产出「覆盖当前时刻」的窗口，startTs 永远 <= now，真实数据里不会命中；代码保留、注释写明恢复方法。
     老的 `isExpiringSoon`（只判结束）语义未动，仍由老用例守着
     （⚠️ 它现在**没有运行时消费者**，只剩测试；轮播已改走 `dueKindOf`，现在只判结束）。
    - ✅ 逐游戏钩子**不属于轮播**（2026-10-25 定稿，用户明确纠正）：轮播没有"按游戏勾选"，
      只有上面那一个全局开关 + 一个范围；`tickerItemsOf` / `tickerPickOf` 的签名里也没有逐游戏参数。
      游戏列表里那一列是**「提醒」**（给下面第 2 项的「到期提醒（送达）」预留；2026-10-26 起整列
      **暂时隐藏**，见第 2 项），**轮播不读它**。
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
   - 仍未做：数字角标（桌面/任务栏）；**逐游戏白名单的 UI**（见下，且见下面那条 ⚠️）。
    - ✅ **逐游戏钩子已预留**（2026-10-25 定稿；送达实现时要**消费它**）：
      · ⚠️ **2026-10-26 起整列暂时隐藏**（用户要求）：送达没实现，勾了没有效果 ⇒ 设置页用常量
        `SHOW_REMIND_COLUMN = false`（`80-shared-ui.js`）把**表头 / 每行复选框 / 「全部提醒」按钮 /
        表头上方概括 / 网格列宽**五处一起藏起来。**不是删除**：配置键、schema、`CONFIG_KEYS`、
        纯函数 `remindGameAllowed` 与写入链路都保留，送达实现时把常量改回 `true` 即可整列恢复。
      · 设置项 = `remindGames`（`string[]`）—— 恢复后是设置页游戏列表的**「提醒」**列，每行一个复选框；
        顶部批量按钮「全部提醒」= 把当前**展示中**的 id 一次性写进白名单；
      · 默认值 = 出厂时**展示中**的 23 个条目 id（所有 `defaultHidden !== true` 的来源；默认隐藏的
        bh3 / ournotes / ournotes-global / czn / ddlezj **不在**里面），同时写在 `10-config.js` 的
        `DEFAULT_SETTINGS.remindGames` 与 `src/index.js` schema 的 `default(...)`，
        由 `test/cases-ticker.mjs` 的守卫钉住；`engine-head.js` 的 `CONFIG_KEYS` 也含它；
      · 语义 = **普通列表**：列表里有谁就提醒谁，**空数组 = 一个都不提醒**（没有"空 = 全部"的哨兵）；
      · 判定唯一入口 = 纯函数 `remindGameAllowed`（`60-helpers.js`）；
      - ⚠️ 目前**没有运行时消费者**：2026-10-27 落地的送达按用户给的规格只认**三个键**
        （`remindOn` / `remindEndNodes` / `remindStartNodes`），**没有**按这份逐游戏列表过滤 ——
        所以勾了仍然没有效果。恢复这一列 UI 之前要先把"送达是否按它过滤"定下来（当时列还是隐藏的，
        按它过滤会让默认被排除的 5 个来源（bh3 / ournotes / ournotes-global / czn / ddlezj）
        静默不提醒，反而像 bug）。**轮播不读它**（轮播只有 `tickerOn` + `tickerHours`，见第 1 项）。
    - 守卫：`test/cases-ticker.mjs` ④ —— 白名单语义 + 默认值 == 展示中来源 + schema 一致
      + **反向守卫**（轮播链路与函数签名里都不许出现逐游戏列表）；
      另有静态守卫钉住"`SHOW_REMIND_COLUMN = false` 时五处入口全部不可见"（防有人只藏一半）。
3. **解析器自检（✅ 已完成 2026-10-28）**（原「来源健康看板」的重构升级）：每源展示最近成功时间 / 连续失败次数 / 失败原因，
   并加"N 天连续 nomatch 即提示源可能改版或停更"（踩过的坑：异环公告改段落写法、雪松源页面停更）。
   - ✅ 实现：引擎每轮刷新后逐源累积，写进**独立**设置键 `sourceHealth`（不污染 `lastData`）；判定是 core 的
     纯函数 `sourceHealthRoundOf` / `sourceHealthNextOf` / `sourceHealthOf`（`60-helpers.js`），
     状态 = 正常 / 连续失败 / 疑似改版停更 / 从未成功；N = `SOURCE_HEALTH_NOMATCH_DAYS = 7`
     （连续 nomatch 的**跨度**满 7 天才提示，不是"连抓 7 次"）。设置页「来源健康」只列**不健康**的来源
     （全正常时只占一行），守卫见 `test/cases-health.mjs`。
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
   ② `70-styles.js`（CSS 全藏在一个模板字符串里） → 抽成真正的 `styles/*.css`，构建时拼接
      （这条最值：现在"反引号必须恰好 2 个、注释必须配平"，已经踩过两次）；
      ✅ 2026-10-28 完成：拆成 `src/client/styles/*.css`（9 个文件，按原段落注释切、内容原样搬运），
      `build.mjs` 用独立的 `CSS_ORDER` 拼回 `const STYLE = \`…\`;` —— **`lib/client.js` 逐字节不变**，
      守卫见 `test/cases-ticker.mjs` ⑧（含 CSS_ORDER ↔ styles/ 一一对应）。
   ③ `30-game-bwiki.js` → 它其实是**多个游戏**的 bwiki 源，按文件里**已有的 `//#region` 分段**
      拆成"一游戏一文件"（分段是现成的，机械拆分、不重新分类）；
   ④ `25-parser-shared.js` → 按**职责**拆：时间解析 / 当期窗口判定 / 悬停构造 / 排序优先级；
   ⑤ **不拆**单游戏文件（一个厂商/游戏的闭环 = 有界的内聚单元，行数多少都不成为拆的理由）；
   ⑥ **不按行数**把某个解析器切成"上半/下半"（会制造"半个解析器"这种坏边界）；
   ⑦ 约束：构建按 `build.mjs` 的 ORDER 拼接 ⇒ 拆完必须同步 ORDER；零依赖保持不变；
   ⑧ **不做** minify（本地加载、收益低，且要引 devDependency，破坏"零依赖 + CI 不装包"）。
8. **分发/曝光**：`awesome-dsh-plugin` 提 PR；核对 `dshplugin.net` 条目；README 加一张动图；
   `package.json` 补 `keywords`；GitHub 仓库补 topics；npm 页面确认 README 已是最新。
9. **日期格悬停补失败结论**：新面板**名字格**的悬停已带失败/沿用旧值结论，**日期格**已补上同口径结论（2026-10-28 完成：失败 / 沿用旧值 / 无数据三种情况，正常态不补提示）。

### 待论证 / 待定

10. **core 独立成仓库**：倾向**暂不**。core 由 `src/client/` 生成、与 UI 交织，拆开要先重构
   （fetch/parse 与渲染分离）；而且 npm 上已有独立包 `gacha-calendar-core`，独立仓库的边际收益低。
   等浏览器扩展真正启动时再评估。
11. **优化滚动手感**：探头 `position:fixed` 与"原生滚轮"的固有矛盾，属"选了体验优先"的已知取舍。
12. **留白卡循环长度**：当前循环全部在期条目（约 38 条 ≈ 2.5 分钟一轮），是否限长待定。

13. **AI 协作署名（提交 trailer）** —— **已研究，存档不启用**。
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
- ~~新版面板的悬停补失败结论~~（部分完成）：名字格已带 `sideFailText` 结论，只剩日期格（见第 9 项）。
