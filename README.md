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
- **倒计时显示**剩余时间，悬停查看卡池/活动全名原始文本
- **联网抓取**：各游戏来源独立（官网公告 / Wiki / 第三方站），失败自动降级；来源可在设置页切换或自定义地址
- **刷新提示**：顶行按「成功 / 卡池失败 / 活动失败 / 新卡池未公布 / 新活动未公布」归类，过长省略号截断，**悬停看逐条原因**；"来源报错"与"源站还没收录当期"分开算——前者计入失败，后者不算失败。某一列没拿到新数据时，该列悬停会补一行括号说明；若该列沿用了上次缓存，说明另起一行接在旧内容下面。游戏名悬停可看**上次完全成功的时间**
- **设置页**：自动刷新开关与频率（1–42 天）、展示顺序、条目显隐/删除、新增自定义条目（名称+图标+来源链接，内容由链接解析产出）

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

排期数据实时抓取自各游戏**官方公告 / Wiki / 第三方站**

## 安装

```bash
dsh plugin --profile desktop add dsh-gacha-calendar
```

或将仓库复制到 profile 的 `node_modules` 后重启 DSH Desktop。

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

**源站改版时只需改一处**：改 `src/client/30-parsers.js` 等核心文件 → `npm run build` → 两个包一起发版，
各平台重新构建即可。core 包的入口是 `packages/core/core.mjs`（由 `build.mjs` 生成，**不要手改**）。

- `src/` 是唯一真源，`lib/` 与 `packages/core/` 都是构建产物。
- 构建由 `build.mjs` 完成：把 `src/client/*.js` 按 `ORDER` 顺序原样拼接成
  `lib/client.js`（DSH 的 `__ModuleLoader__` 工厂形态）、把 `src/index.js` 复制成 `lib/index.js`、
  再把 core 主体包成 `packages/core/core.mjs`（ESM 导出 `createEngine`）。
  拼接是逐字节确定的，所以 `check` 能给出"一致/不一致"的确定结论。
- 源文件约定：**LF 换行、UTF-8 无 BOM、Tab 缩进**。`build.mjs` 会强制校验（带 BOM 会让
  DSH 启动直接失败，见 `.githooks/pre-commit`）；`.githooks/pre-commit` 还会在提交
  `src/**` 或 `lib/**` 时自动跑一次 `check`，防止有人绕过源码直接改产物。
- 历史说明：本仓库此前只提交了打包产物（没有 `src/`），`package.json` 里声明的
  `tsc && tsdown` 从未真正可用。当前构建脚本是从产物回填源码时一并落地的替代方案，
  目标是"改一处源码 → 确定性产出产物"，也便于把同一份解析/抓取核心复用到浏览器扩展。

## 插件结构

```
dsh-gacha-calendar/
├── build.mjs        # 构建脚本（确定性拼接 + --check 校验）
├── src/             # 唯一真源
│   ├── index.js     # host 端：配置 schema + 同源代理（CORS/Referer 反爬绕行，白名单域名）
│   └── client/      # web 端，按原产物 //#region 顺序切分（拼接顺序见 build.mjs 的 ORDER）
│       ├── 00-head.js       # DSH 模块加载壳 + react require
│       ├── 10-config.js     # 配置常量 / 刷新频率选项
│       ├── 20-sources.js    # SOURCES 来源注册表（11 款游戏 / 25 个来源）
│       ├── 30-parsers.js    # 全部解析器（纯函数）
│       ├── 40-fetchers.js   # 抓取器 + GACHA_FETCHERS / EVENT_FETCHERS 注册表
│       ├── 50-refresh.js    # 刷新编排、失败沿用旧值、提示归类
│       ├── 60-helpers.js    # 格式化 / 悬停 / 排序 helpers
│       ├── 70-styles.js     # 样式
│       ├── 80-components.js # React 组件（面板 + 设置页）
│       ├── 90-plugin.js     # apply(ctx)：slots / settingsScope / 悬停 marquee
│       └── 99-tail.js       # exports.apply / exports.inject
├── lib/             # 构建产物（npm 包只发布这里）
│   ├── index.js
│   └── client.js
├── package.json     # dsh.bundle.patch + dsh.client.inject（DSH 加载规范）
├── cordis.patch.yml # bundle patch
└── README.md
```

## License

MIT
