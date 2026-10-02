# next-sources —— 新增游戏来源解析器（**独立模块，未合并进插件**）

> 用户要求：「把目前能稳定抓到的写出解析器，不要求两侧都有，有一个就行，暂时不合并进插件本身」。
> 所以本目录**完全独立于插件本体**：`src/`、`lib/`、`package.json` **零改动**，将来要合并时按契约搬过去即可。

## 一句话说明

把调研确认「能稳定抓取」的游戏来源写成**抓取器 + 解析器**，配**离线夹具测试**。
契约与插件 `src/client/40-fetchers.js` 完全一致，所以能原样搬进插件。

```bash
cd next-sources
node test/all.mjs           # 离线门禁（走夹具，557 项）
node test/all.mjs --live    # 打真实网络抽检夹具是否过期（不作为门禁）
```

## 现状：15 个来源 / 23 个侧

| id | 游戏 · 服务器 | 侧 | 来源 | 抓取 | 时区 | 当期状态 |
|---|---|---|---|---|---|---|
| `p5x` | P5X 国服 | 卡池+活动 | 完美世界官方 HTML | 代理 | UTC+8（推测） | ✅ |
| `gf2` | 少女前线2 国服 | 卡池+活动 | 散爆官方 API | 代理 | UTC+8（有旁证） | ✅ |
| `bandori` | BanG Dream 国服 | 卡池+活动 | biligame 官方公告 | 代理 | UTC+8（**已交叉验证**） | ✅ |
| `bandori-bestdori` | BanG Dream 国服 | 卡池+活动 | Bestdori | 代理 | UTC+8（同上） | ✅ |
| `ournotes` | BanG Dream OurNotes 日服 | 活动 | 官方 WP REST | **直连** | JST（**实测**） | ✅ |
| `fgo` | FGO 国服 | 卡池+活动 | fgo.wiki | 代理 | UTC+8（**已交叉验证**） | ✅ |
| `pjsk` | PJSK 缤纷舞台 | 卡池+活动 | sekai-master-db | **直连** | UTC+8（推测） | ✅ |
| `uma-jp-umapyoi` | 赛马娘 日服 | 卡池 | umapyoi API | **直连** | JST（**硬标注**） | ✅ |
| `wuhuamixin` | 物华弥新 国服 | 卡池+活动 | bwiki | 代理 | UTC+8（推测） | 卡池✅ / 活动无当期内容 |
| `uma-cn` | 闪耀优俊少女 国服 | 卡池 | bwiki 简中卡池 | 代理 | UTC+8（推测） | ✅（⚠️ 见下） |
| `uma-jp-bwiki` | 赛马娘 日服 | 活动 | bwiki（往期归档） | 代理 | JST（硬标注） | 无当期内容 |
| `zspms` | 战双帕弥什 国服 | 卡池 | bwiki 研发记录 | 代理 | UTC+8（推测） | 停在 2024Q1 |
| `kedrgame` | 雪松 | 卡池 | bwiki 卡池信息 | 代理 | UTC+8（推测） | 占位页 |
| `czn` | 卡厄斯梦境 国服 | 卡池 | bwiki 卡池记录 | 代理 | UTC+8（推测） | 空页 |
| `stellasora` | 星塔旅人 国服 | 活动 | bwiki 首页日历 | 代理 | UTC+8（假设） | 停在 2026-04 |

**「无当期内容」不是 bug**：抓取器能正常抓到页面，但页面里**没有覆盖当前时刻的档期**
→ 按插件语义**如实返回 `null`（未公布）**，**不硬凑过期档期**。
（这条是你点名要的：「找不到就换下一个，不要浪费时间」——同理，抓不到当期就如实说没有。）

## 三个必须知道的风险（已写进代码注释，不藏）

1. **`uma-cn`（闪耀优俊少女）不是官方时刻表**
   bwiki 正文写着「简中卡池加速 -> 简中预测时间 -185天 / +423天」——简中服时刻是 wiki
   按日服时差**推算**的。解析器只用「已实装卡池」表做外显；「预测卡池」的推算只进悬停并**显式标注**。
   佐证：预测表里还留着日服原始年份（`八骏赛马娘卡池 20230911` 被平移到 2026-09），且外推到 **2029 年**。

2. **`p5x` 的卡池/活动不是官方独立栏目**
   官方 `/news/gamebroad/`（卡池）与 `/news/gameevent/`（活动）**已停更 2 年**（2024-10 / 2024-09）。
   只有 `/news/gamenews/`（版本更新公告）在更新 → 两侧都从它正文抽档期。
   另：公告只给日期不给时刻 → 起止补 `04:00 / 03:59`，属**推算**。

3. **`pjsk` 的服区存疑**
   `sekai-master-db-cn-diff` 首条事件 ≈2021-10-08，更像**繁中服**而非国服；但时区同为 UTC+8，不影响换算。

## 契约（与插件完全一致）

```js
// 抓取器：async (url, signal, tz) => 数据对象 | null
//   null = 未公布；结构性损坏 → 抛错（该侧算抓取失败）
// 卡池侧：{ banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, event?, eventDates? }
// 活动侧：{ event, eventDates, eventDatesRaw?, eventHover? }
// bannerDates 文本：`MM-DD HH:MM ~ MM-DD HH:MM`（跨年时两端带 YYYY-）
```

两条铁律（仓库里都踩过坑，这里继续守）：

1. **`bannerDates` 用源站墙钟原文**，绝对时刻用 `sourceInstant(...)` 按 `tz` 换算。
2. **`now` 不放第二参**，签名一律 `(url, signal, tz)`。

## 目录结构

```
next-sources/
├── CONVENTIONS.md          各批次的实现约定（照抄模式）
├── registry.js             聚合注册表（合并各批 registry-b*.js）
├── registry-{p5x,b1,b2,b3}.js   各批片段（分文件避免并发冲突）
├── lib/env.js              传输 + 时区 + 文本工具
├── parsers/                p5x | bwiki | umapyoi | bestdori | sekai | gf2 | bandori | ournotes | fgo
├── test/
│   ├── harness.mjs         校验框架（夹具 fetch 注入、契约断言）
│   ├── capture.mjs         抓真实响应存夹具
│   ├── all.mjs             **统一门禁**
│   ├── run.mjs             P5X 早期入口（保留）
│   └── cases-{p5x,b1,b2,b3}.mjs
└── fixtures/               真实响应快照（**未入库**，见下）
```

## 夹具未入库 —— 怎么重建

夹具是「抓包存档」（27 个文件共 **12.1 MB**，单文件最大 4.2 MB）。它们是**某时点的快照、
源站改版后本就该重抓**，且体积大，所以**不提交到仓库**；本地已有，测试照常全绿。
换台机器或想刷新夹具时：

```bash
cd next-sources
node test/capture.mjs <夹具名> <真实url> [referer]
# 例：node test/capture.mjs uma-umapyoi https://api.umapyoi.net/api/v1/gacha
```

会写入 `fixtures/<名>/response.txt`（+ `.meta.json` 记录来源 URL 与抓取时间）
并自动登记 `test/map.json`（**这个文件已入库**，它记录了"哪个 URL 对应哪个夹具"）。

⚠️ **抓 bwiki 要限速**：高频请求会被腾讯 EdgeOne WAF 拦成 **HTTP 567**（返回 7KB 的挑战页、
不是 JSON）。需要 20~30 秒间隔重试，并**校验 body 是不是 JSON**，否则会把挑战页当成正常响应存下来。

## 怎么合并进插件（将来）

1. `parsers/*.js` → `src/client/40-fetchers.js`（或按需拆到 `30-parsers.js`）
2. `registry.js` 的条目 → `src/client/20-sources.js` 的 `SOURCES`
3. 抓取器 → `GACHA_FETCHERS` / `EVENT_FETCHERS`
4. 跑仓库既有门禁：`node build.mjs --check` + 21 套验证脚本

**注意**：移植时要确认 `now` 参数位置（见上文铁律 2），这是历史上出过静默 bug 的地方。
