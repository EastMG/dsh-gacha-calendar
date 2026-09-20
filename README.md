# dsh-gacha-calendar

DeepSeek Harness 桌面端侧边栏插件：一键查看主流二游的**当期卡池与活动起止**，支持联网自动刷新，支持手动添加或删除条目。
全程使用 DeepSeek Harness 进行 Vibe Coding 开发。

## 截图

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-1.png" width="32%" alt="排期面板">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-2.png" width="32%" alt="面板详情">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-3.png" width="32%" alt="设置页">
</p>

## 功能

- 侧边栏底部「📅 二游排期」按钮 → 悬浮面板，按行展示每款游戏的当期卡池、卡池起止、当期活动、活动起止
- **倒计时**显示剩余时间；悬停看卡池/活动的完整名称与源站原文
- **刷新提示**（顶行）：按「成功 / 卡池失败 / 活动失败 / 新卡池未公布 / 新活动未公布」归类，悬停看逐条原因；"来源报错"计入失败、"源站还没收录当期"不算失败；某列沿用上次缓存时，悬停里另起一行说明。游戏名悬停可看**上次完全成功的时间**
- **自动刷新**：启动时判一次——插件更新（缓存不是当前版本产出的）与首次安装会**强制刷一次，不看自动刷新开关**（悬停格式、来源地址、解析器、样式等改动一刷新即生效）；其余按设置间隔（1–42 天）到点才刷，间隔从**上次成功刷新**起算
- **来源可换**：各游戏来源独立（官方公告 / 官方 Wiki / 第三方站），失败自动回退备选源；设置页可切换来源或填自定义地址
- **设置页**：自动刷新开关与频率、展示顺序、条目显隐/删除、新增自定义条目（名称+图标+来源链接，内容由链接解析产出）
- **解析器自检**（设置页按钮）：逐个来源跑一遍，报告「哪个源解析不出当期内容 / 哪个源抓取报错」——源站改版后一键定位问题；只读，不改动设置与缓存

内置覆盖 11 款游戏：

| 游戏 | 服务器 |
|---|---|
| 原神 | 国服 |
| 崩坏：星穹铁道 | 国服 |
| 绝区零 | 国服 |
| 鸣潮 | 国服 |
| 明日方舟 | 国服 |
| 明日方舟：终末地 | 国服 |
| 蔚蓝档案 | 国服 |
| 蔚蓝档案 | 国际服 |
| 蔚蓝档案 | 日服 |
| 重返未来：1999 | 国服 |
| 异环 | 国服 |

## 数据来源

排期数据实时抓取自各游戏**官方公告 / 官方 Wiki / 第三方站**——bwiki、PRTS、wiki.gg、Game8、GameKee、Canmoe、GachaTracker、ldshop、小米游戏中心等。
无联网数据时对应列显示为空；单列抓取失败则沿用上次成功数据，并在悬停里标注。

## 安装

```bash
dsh plugin --profile desktop add dsh-gacha-calendar
```

或将仓库复制到 profile 的 `node_modules` 后重启 DSH Desktop。

> 适用于 DSH Desktop（peer 依赖 `@deepseek-ai/*@^0.1.1-rc.2`）；插件本身零运行时依赖。

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
| [`gacha-calendar-core`](packages/core) | 平台中立的抓取核心：`createEngine({ transport, storage, now })`，零依赖、零宿主依赖 | 其它平台（开发中） |

```bash
npm run publish:plugin   # 发布 DSH 插件包（dsh-gacha-calendar）
npm run publish:core     # 发布中立核心包（gacha-calendar-core，版本号跟随根包）
```

**源站改版时只需改一处**：改 `src/client/30-parsers.js` 等核心文件 → `npm run build` → 两个包一起发版，各平台重新构建即可。

- `src/` 是唯一真源，`lib/` 与 `packages/core/` 都是**构建产物，不要手改**。
- `build.mjs` 做三件事：按 `ORDER` 原样拼接 `src/client/*.js` → `lib/client.js`（DSH 的 `__ModuleLoader__` 工厂形态）；复制 `src/index.js` → `lib/index.js`；把 core 主体包成 `packages/core/core.mjs`（ESM 导出 `createEngine`）。拼接逐字节确定，所以 `check` 能给出"一致/不一致"的确定结论；同时会把根 `package.json` 的版本号注入两个产物。
- 源文件约定：**LF 换行、UTF-8 无 BOM、Tab 缩进**（带 BOM 会让 DSH 启动直接失败）。`build.mjs` 会强制校验；`.githooks/pre-commit` 还会在提交 `src/**`、`lib/**`、`packages/**` 或 `build.mjs` 时自动跑一次 `check`，防止绕过源码直接改产物。
- **钩子怎么生效**：`npm install` 会自动执行 `prepare` 脚本把 `core.hooksPath` 指到 `.githooks`。若跳过了 install，手工执行一次即可：`git config core.hooksPath .githooks`。
- 历史说明：本仓库此前只提交了打包产物（没有 `src/`），`package.json` 里声明的 `tsc && tsdown` 从未真正可用；当前构建脚本是从产物回填源码时落地的替代方案。

## 插件结构

```
dsh-gacha-calendar/
├── build.mjs        # 构建脚本（确定性拼接 + --check 校验 + 版本注入）
├── src/             # 唯一真源
│   ├── index.js     # host 端：配置 schema + 同源代理（白名单域名，绕 CORS/Referer 反爬）
│   └── client/      # web 端（下列顺序即 build.mjs 的 ORDER）
│       ├── 05-version.js     # 插件版本号（占位符，构建时由 package.json 注入）
│       ├── 00-head.js        # DSH 模块加载壳 + react require
│       ├── 10-config.js      # 默认配置 / 刷新频率选项
│       ├── 15-env.js         # core 环境缝：transport / 时钟 / 计时器
│       ├── 20-sources.js     # SOURCES 来源注册表（11 款游戏：默认源 + 备选源）
│       ├── 30-parsers.js     # 全部解析器（纯函数）
│       ├── 40-fetchers.js    # 抓取器 + GACHA_FETCHERS / EVENT_FETCHERS 注册表
│       ├── 50-refresh.js     # 刷新编排、失败沿用旧值、提示归类
│       ├── 60-helpers.js     # 格式化 / 悬停 / 排序 / 启动刷新判定
│       ├── engine-head.js    # core 外壳：createEngine（storage / listGames / getCached）
│       ├── engine-api.js     # 引擎 API：refresh / selfCheck / __test
│       ├── 70-styles.js      # 样式
│       ├── 80-components.js  # React 组件（面板 + 设置页）
│       ├── 90-plugin.js      # apply(ctx)：slots / settingsScope / 悬停 marquee
│       ├── 92-dsh-env.js     # DSH 环境适配（直连 + 宿主代理）
│       └── 99-tail.js        # exports.apply / exports.inject
├── lib/             # 构建产物（npm 包只发布这里）
│   ├── index.js / client.js
│   └── types/       # 类型声明（package.json 的 types 指向它）
├── packages/core/   # 第二个产物：平台中立核心包 gacha-calendar-core
├── assets/          # README 截图
├── .githooks/       # pre-commit：编码校验 + src/产物一致性
├── package.json     # dsh.bundle.patch + dsh.client.inject（DSH 加载规范）
├── cordis.patch.yml # bundle patch
└── LICENSE / README.md
```

## 致谢

- [MAA1999/M9A](https://github.com/MAA1999/M9A)——重返未来：1999 的逐期「征集时间」依赖官方**游戏内公告**接口，该接口线索来自它的 `tools/activity_data`。

## 免责声明

- 本项目为个人非营利项目，与各游戏厂商、发行商及官方/社区 Wiki 均无隶属或合作关系。
- 卡池、活动等排期数据均抓取自各游戏**公开的官方公告与社区 Wiki、第三方站**，图标与截图的版权同样归原权利方所有；本项目只做信息聚合展示，不提供也不存储任何游戏资源。
- **如有侵权，请提 [Issue](https://github.com/EastMG/dsh-gacha-calendar/issues) 告知，我会尽快删除相关内容（侵删）。**

## License

MIT
