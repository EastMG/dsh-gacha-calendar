# dsh-gacha-calendar

DeepSeek Harness 桌面端侧边栏插件：一键查看主流二游的**当期卡池与活动起止日历**，支持联网自动刷新，支持手动添加或删除条目。
全程使用 DeepSeek Harness 进行 Vibe Coding 开发。

## 截图

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-1.png" width="32%" alt="排期面板">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-2.png" width="32%" alt="面板详情">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-3.png" width="32%" alt="设置页">
</p>

## 功能

- 侧边栏底部「📅 二游日历」按钮 → 悬浮面板，按行展示每款游戏的当期卡池、卡池起止、当期活动、活动起止
- **倒计时**显示剩余时间；悬停看卡池/活动的完整名称与源站原文
- **刷新提示**：按「成功 / 卡池失败 / 活动失败 / 新卡池未公布 / 新活动未公布」归类，悬停看逐条原因；"来源报错"计入失败、"源站还没收录当期"不算失败；某列沿用上次缓存时，悬停里另起一行说明。游戏名悬停可看**上次完全成功的时间**
- **自动刷新**：按设置间隔（1–42 天）进行自动刷新，间隔从**上次成功刷新**起算
- **来源可换**：各游戏来源独立（官方公告 / 官方 Wiki / 第三方站），失败自动回退备选源；设置页可切换来源或填自定义地址
- **设置页**：自动刷新开关与频率、展示顺序、条目显隐/删除、新增自定义条目（名称+图标+来源链接，内容由链接解析产出）
- **解析器自检**：逐个来源跑一遍，报告「哪个源解析不出当期内容 / 哪个源抓取报错」——源站改版后一键定位问题；只读，不改动设置与缓存

目前已覆盖 **28 款游戏**：

| 游戏 | 服务器 | 注释 |
|---|---|---|
| 原神 | 国服 |  |
| 崩坏：星穹铁道 | 国服 |  |
| 绝区零 | 国服 |  |
| 崩坏3 | 国服 | 暂不可用 |
| 鸣潮 | 国服 |  |
| 明日方舟 | 国服 |  |
| 明日方舟：终末地 | 国服 |  |
| 蔚蓝档案 | 国服 |  |
| 蔚蓝档案 | 国际服 |  |
| 蔚蓝档案 | 日服 |  |
| BanG Dream！少女乐团派对 | 国服 |  |
| BanG Dream！OurNotes | 日服 | 暂不可用 |
| BanG Dream！OurNotes | 国际服 | 暂不可用 |
| 物华弥新 | 国服 |  |
| 战双帕弥什 | 国服 |  |
| 卡厄斯梦境 | 国服 | 暂不可用 |
| 雪松 | 国服 |  |
| 嘟嘟脸恶作剧 | 国服 | 暂不可用 |
| 闪耀！优俊少女 | 国服 |  |
| 赛马娘 | 日服 |  |
| 赛马娘 | 国际服 |  |
| 女神异闻录：夜幕魅影 | 国服 |  |
| 异环 | 国服 |  |
| 少女前线2：追放 | 国服 |  |
| Fate/Grand Order | 国服 |  |
| 初音未来：缤纷舞台 | 国服 |  |
| 星塔旅人 | 国服 |  |
| 重返未来：1999 | 国服 |  |

## 数据来源

排期数据实时抓取自各游戏**官方公告 / 官方 Wiki / 第三方站**——bwiki、PRTS、wiki.gg、Game8、GameKee、Canmoe、GachaTracker、ldshop、小米游戏中心等。采用**克制的抓取策略**设计，普通用户正常使用时的抓取请求不会影响网站正常运行。

## 安装

```bash
dsh plugin --profile desktop add dsh-gacha-calendar
```

或将仓库复制到 profile 的 `node_modules` 后重启 DSH Desktop。

> 适用于 DSH Desktop：`@deepseek-ai/dsh*` 的 peer 范围为 `>=0.1.1-rc.2 <0.3.0`
> （覆盖 0.1.x 与 0.2.x 两条运行时线；`cordis ^4.0.1`、`schemastery >=3.18.0 <4`）；
> 插件本身零运行时依赖。

## 开发

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
│   ├── all.mjs      # 统一门禁：聚 13 段用例（P5X / B1~B3 / P4~P9 + 规则静态守卫 + README 结构图守卫 + core 产物守卫）
│   ├── cases-*.mjs  # 各段用例（13 个：cases-p5x / b1~b3 / p4~p9 / rule-lint / readme / core）
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
└── LICENSE / README.md / AGENTS.md
```

## 致谢

- [MAA1999/M9A](https://github.com/MAA1999/M9A)——对《重返未来：1999》逐期「征集时间」的获取手段受到**M9A**的启发。
- [yoimiya-kokomi/miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin)——对 miHoYo/HoYoverse 公告接口的获取手段受到**miao-plugin**的启发。
- [jacket-sikaha/game-schedule](https://github.com/jacket-sikaha/game-schedule)——对 miHoYo/HoYoverse 公告接口的获取手段受到**game-schedule**的启发。
- [BTMuli/ShufflePlay](https://github.com/BTMuli/ShufflePlay)——对 miHoYo/HoYoverse 公告接口的获取手段受到**ShufflePlay**的启发。
- [UIGF-org/mihoyo-api-collect](https://github.com/UIGF-org/mihoyo-api-collect)——对 miHoYo/HoYoverse 的 `appId` 与公告接口的查证受到**mihoyo-api-collect**的启发。
- [Sekai-World/sekai-master-db-cn-diff](https://github.com/Sekai-World/sekai-master-db-cn-diff)——《初音未来：缤纷舞台》国服卡池与活动排期的**数据来源**。

## 免责声明

- 本项目为非营利性质的个人项目，与各游戏厂商、发行商及官方/社区 Wiki 均不存在隶属或合作关系。
- 卡池、活动等排期数据均取自各游戏**公开的官方公告与社区 Wiki、第三方站**，图标与截图的版权同样归原权利方所有；本项目仅作信息聚合展示，不提供亦不存储任何游戏资源。
- **图标资源使用外链**，来自游戏官网自有静态资源或应用商店列表图标。
- **如权利人认为本项目展示的内容侵犯其合法权益，请通过 [Issue](https://github.com/EastMG/dsh-gacha-calendar/issues) 告知，核实后将尽快删除相关内容。**

## License

MIT
