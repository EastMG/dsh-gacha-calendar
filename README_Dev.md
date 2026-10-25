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
| [`gacha-calendar-core`](packages/core) | 平台中立的抓取核心：`createEngine({ transport, storage, now })`，零依赖、零宿主依赖 | 其它平台 浏览器插件［`gacha-calendar-extension`］(https://github.com/EastMG/gacha-calendar-extension) 等 开发中 |

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
│       ├── engine-head.js    # core 外壳：createEngine（storage / listGames / getCached）
│       ├── engine-api.js     # 引擎 API：refresh / selfCheck / __test
│       ├── 70-styles.js      # 样式
│       ├── 80-components.js  # React 组件（面板 + 设置页）
│       ├── 90-plugin.js      # apply(ctx)：slots / configForms / 悬停 marquee
│       ├── 92-dsh-env.js     # DSH 环境适配（直连 + 宿主代理）
│       └── 99-tail.js        # exports.apply / exports.inject
├── lib/             # 构建产物
│   ├── index.js / client.js
│   └── types/       # 类型声明
├── packages/core/   # 第二个产物：平台中立核心包 gacha-calendar-core
├── test/            # 离线夹具测试
│   ├── all.mjs      # 统一门禁：聚 18 段用例（P5X / B1~B3 / P4~P9 / 蔚蓝档案 / 异环 / 赛马娘 GameTora + 规则静态守卫 + 时区口径 + 到期提醒 + README 结构图守卫 + core 产物守卫）
│   ├── cases-*.mjs  # 各段用例（18 个：cases-p5x / b1~b3 / p4~p9 / cases-ba / cases-pw / cases-uma-gt / rule-lint / tz / remind / readme / core）
│   ├── load.mjs     # 加载构建产物，取 exports.__regression（解析器 + env 工具 + 来源表）
│   ├── harness.mjs  # 夹具 fetch 注入 + check/section/summary + 契约与悬停断言
│   ├── registry-shim.mjs # 各批次注册表规格快照 + DRIFT 守卫（与运行时 SOURCES 核对 tz/name）
│   ├── capture*.mjs # 抓真实响应生成夹具；run.mjs # 单段直跑
│   ├── map.json     # 请求 URL → 夹具路径（**入库**）
│   └── fixtures/    # 真实响应快照（**未入库**，重建方式见 test/README.md）
├── tools/           # 守卫脚本：require-publish-consent（发布闸门）/ check-host-allow（来源域名 vs 代理白名单）
├── assets/          # README 截图
├── .githooks/       # pre-commit：编码校验 + src/产物一致性
├── package.json     # dsh.bundle.patch + dsh.client.inject（DSH 加载规范）
├── cordis.patch.yml # bundle patch
└── LICENSE / README.md / README_Dev.md / AGENTS.md
```

## 待办（2026-10-25 整理）

### 做（按优先级）

1. **到期提醒**（**MVP 已完成 2026-10-25，只剩系统通知**）：
   - ✅ 侧栏按钮**小红点**：有卡池/活动在 N 小时内结束时亮（悬停/读屏能说出是哪几项）；
     设置页「到期提醒」= 关闭 / 12 / 24 / 48 小时，默认 **24**，键名 `remindHours`（0 = 关闭）。
   - ✅ 判定口径：某侧**已开始**（`startTs <= now`）且 `endTs ∈ (now, now + N 小时]`（未开始/已结束都不算）。
     纯函数 `isExpiringSoon`（`60-helpers.js`）+ 窗口换算 `remindWindowOf` / `remindDueOf`（`80-components.js`，
     复用面板外显那条「源站文本 + tz → 本机墙钟」链，所以红点与面板"还剩 X"永远同源）。
   - ✅ 红点感知数据变化：按钮与面板同属 `CalendarPanel`，复用面板已有的 `scope.subscribe`
     （刷新写回 `lastData`/`lastRefresh` → 快照推送 → 重渲染）+ 已有的每分钟时钟，**没有新增订阅**。
   - ⬜ 待做：**系统通知**（DSH 通知 API 还没接）、数字角标（现在是纯红点，避免抢眼）。
   - 守卫：`test/cases-remind.mjs`（①~⑥ 口径 + 文本/tz 换算 + 关闭短路）。
2. **解析器自检**（原「来源健康看板」的重构升级）：每源展示最近成功时间 / 连续失败次数 / 失败原因，
   并加"N 天连续 nomatch 即提示源可能改版或停更"（踩过的坑：异环公告改段落写法、雪松源页面停更）。
3. **搜索与筛选**：设置页来源列表加"搜游戏名"+ 分组（国服/日服/国际服）+ 只看已启用；
   面板内加按卡池/角色名搜索（现在的 28 个来源只能靠"展示"开关逐条关）。
4. **排期导出 .ics**：把当期窗口导出成一次性快照（可导入手机日历）。
   ⚠️ 只能是**快照**、不能是订阅：网游排期是"一次性数据"，没有稳定的公开 iCal 源。
5. **抽卡计划 / 攒抽追踪**：目标角色 + 当前保底/预算 + 倒计时。属重功能，分阶段做（先"目标角色 + 倒计时"）。
6. **架构重整（拆文件 + CSS 抽出）** —— 按「**一个文件一个职责**」拆，**不按行数硬切**：
   ① `80-components.js`(2096) → 按**界面**拆：新面板 / 旧表格 / 设置页 / 共用小组件；
   ② `70-styles.js`(439，CSS 全藏在一个模板字符串里) → 抽成真正的 `styles/*.css`，构建时拼接
      （这条最值：现在"反引号必须恰好 2 个、注释必须配平"，已经踩过两次）；
   ③ `30-game-bwiki.js`(1466) → 它其实是**多个游戏**的 bwiki 源，按文件里**已有的 `//#region` 分段**
      拆成"一游戏一文件"（分段是现成的，机械拆分、不重新分类）；
   ④ `25-parser-shared.js`(915) → 按**职责**拆：时间解析 / 当期窗口判定 / 悬停构造 / 排序优先级；
   ⑤ **不拆**单游戏文件（`30-game-aniplex` 等 ~1000 行 = 一个厂商/游戏的闭环，是有界的内聚单元）；
   ⑥ **不按行数**把某个解析器切成"上半/下半"（会制造"半个解析器"这种坏边界）；
   ⑦ 约束：构建按 `build.mjs` 的 ORDER 拼接 ⇒ 拆完必须同步 ORDER；零依赖保持不变；
   ⑧ **不做** minify（本地加载、收益低，且要引 devDependency，破坏"零依赖 + CI 不装包"）。
7. **分发/曝光**：`awesome-dsh-plugin` 提 PR；核对 `dshplugin.net` 条目；README 加一张动图；
   `package.json` 补 `keywords`；GitHub 仓库补 topics；npm 页面确认 README 已是最新。
8. **日期格悬停补失败结论**：新面板**名字格**的悬停已带失败/沿用旧值结论，**日期格**还没有（小项）。

### 待论证 / 待定

9. **core 独立成仓库**：倾向**暂不**。core 由 `src/client/` 生成、与 UI 交织，拆开要先重构
   （fetch/parse 与渲染分离）；而且 npm 上已有独立包 `gacha-calendar-core`，独立仓库的边际收益低。
   等浏览器扩展真正启动时再评估。
10. **优化滚动手感**：探头 `position:fixed` 与"原生滚轮"的固有矛盾，属"选了体验优先"的已知取舍。
11. **留白卡循环长度**：当前循环全部在期条目（约 38 条 ≈ 2.5 分钟一轮），是否限长待定。

### 不做（已决定，不再讨论）

- **主源失败自动回落备选**（含"人工确认的半自动换源"）：用户 2026-10-25 决定**保留现状**。
  理由：备选可能更慢/更易被限流；回落成功但数据口径不同会长久静默不一致；
  失败时多打请求会放大对方的异常流量判定；而"提示 + 一键切换"也会引入新的交互与状态。
  现状（失败就显示失败、原文照旧）已经足够清晰。

### 已完成（2026-10-25 核实后从待办移除）

- ~~新面板也吃悬停 marquee~~：**已实现**——新面板长名类都包了 `.gacha-cal-inner`，
  `90-plugin.js` 的 marquee 是"面板 + 设置页共用"的全局机制。
- ~~新版面板的悬停补失败结论~~（部分完成）：名字格已带 `sideFailText` 结论，只剩日期格（见第 8 项）。
