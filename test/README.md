# test/ —— 解析器的离线夹具测试

## 怎么跑

```bash
node build.mjs        # 测试跑的是**构建产物** lib/client.js，改完 src/ 必须先 build
node test/all.mjs     # 离线门禁（走夹具）——这是门禁
```

`all.mjs` 会依次跑注册表守卫 + 夹具卫生 + **13 段**用例（P5X / B1 / B2 / B3 / P4 / P5 / P6 / P7 / P8 / P9 + 规则静态守卫 + README 结构图守卫 + core 产物守卫）。

## 为什么测试改成跑构建产物（2026-10-03）

用户要求「把 next-sources 合并进原 source，不留 next-source」。原先新增来源的解析器是
`next-sources/parsers/*.js`（ESM 模块，测试直接 `import` 源码，再由一个外部生成器内联进插件）。

现在它们压平成了 `src/client/42-parsers-*.js` —— 与 `30-parsers.js` 同性质的**普通拼接段**
（`build.mjs` 按 ORDER 原样拼成一个 IIFE）。普通段没有 `export`，所以测试改为：

1. `node build.mjs`
2. 加载 `lib/client.js`，取 `exports.__regression`（由 `src/client/44-test-exports.js` 定义）

这与仓库里另外 22 套门禁脚本的做法完全一致（它们也都要先 build 再加载产物）。

| 文件 | 作用 |
|---|---|
| `load.mjs` | 加载 `lib/client.js`，导出 `T`（`__regression`：17 个解析器模块的全部符号 + env 工具 + 来源/抓取器表） |
| `harness.mjs` | 夹具 fetch 注入、`check/section/summary`、契约与悬停断言 |
| `registry-shim.mjs` | **注册表形态的测试侧快照**（见下） |
| `all.mjs` | 统一门禁 |
| `cases-*.mjs` | 各段用例（13 个：10 个批次 + `cases-rule-lint` 规则守卫 + `cases-readme` 结构图守卫 + `cases-core` core 守卫） |
| `capture.mjs` / `capture-p8.mjs` | 抓真实响应存夹具 |
| `map.json` | URL → 夹具 的映射索引（**已入库**） |
| `fixtures/` | 真实响应快照（**未入库**，见下） |

### 关于 `registry-shim.mjs`

批次注册表里每条来源是**结构化**形态 `{ gacha: { url, kind, mode, fetcher }, … }`，
其中 `kind`/`mode` 是**构建期**信息（决定走代理还是直连、用哪个解析器）；插件运行时已把它转成
扁平形态并把 `mode` 固化进抓取器闭包 —— 所以运行时的 `SOURCES` 里**没有** `kind`/`mode`，
而聚合守卫正需要断言它们。批次文件随本次合并删除，于是这份数据以**自动导出的快照**形式留在测试侧：

- `SOURCES_B1…P9` = **各批次自己的**数组（合并前）—— 批次的"注册表结构"小节测的是它
- `NEXT_SOURCES` = 最终合并结果 —— `all.mjs` 的聚合守卫测的是它

> 两者**必须分清**：合并逻辑是 `BASE → P8 → P9`，**按 id 覆盖**。例如 `wuhuamixin` 在 B2 里是
> bwiki（`kind=wiki`），合并后被 P9 覆盖成 biligame-activity（`kind=official-api`）。
> （早先误把批次数组写成"按 id 过滤合并结果"，导致 B2/P6/P8 的结构断言全线失败 —— 已纠正。）

文件末尾有 **DRIFT 守卫**：合并结果里每个 id 若在运行时 `SOURCES` 里存在，`tz`/`name` 必须一致；
插件侧改了来源声明而忘了同步快照就会报出来。

## 夹具未入库 —— 怎么重建

夹具是「抓包存档」（108 个目录（216 个文件）、合计十几 MB，单文件最大约 4 MB）。它们是**某时点的快照、
源站改版后本就该重抓**，且体积大，所以**不提交到仓库**（见 `.gitignore`）；本地已有，测试照常全绿。
换台机器或想刷新夹具时：

```bash
node test/capture.mjs <夹具名> <真实url> [referer]
# 例：node test/capture.mjs uma-umapyoi https://api.umapyoi.net/api/v1/gacha
```

会写入 `fixtures/<名>/response.txt`（+ `.meta.json` 记录来源 URL 与抓取时间）
并自动登记 `test/map.json`。

⚠️ **抓 bwiki 要限速**：高频请求会被腾讯 EdgeOne WAF 拦成 **HTTP 567**（返回 7KB 的挑战页、
不是 JSON）。需要 20~30 秒间隔重试，并**校验 body 是不是 JSON**，否则会把挑战页当成正常响应存下来。

⚠️ **合成夹具**：少数源站不可达（如 OurNotes 国际服），夹具是**手写的**并在 `.meta.json` 里标
`synthetic: true` + 原因。这类夹具**无法按源站重抓** —— 新克隆上相关断言会退化，需要留意。

## 契约（与插件本体完全一致）

```js
// 抓取器：async (url, signal, tz) => 数据对象 | null
//   null = 未公布；结构性损坏 → 抛错（该侧算抓取失败）
// 卡池侧：{ banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
// 活动侧：{ event, eventDates, eventDatesRaw?, eventHover? }
// bannerDates 文本：`MM-DD HH:MM ~ MM-DD HH:MM`（跨年时两端带 YYYY-）
```

两条铁律（仓库里都踩过坑，这里继续守）：

1. **`bannerDates` 用源站墙钟原文**，绝对时刻用 `sourceInstant(...)` 按 `tz` 换算。
2. **`now` 不放第二参**，签名一律 `(url, signal, tz)`（`now` 只作为最后一位、带默认值）。

## 悬停排版铁律（2026-10-03 方案 A）

悬停**只允许有名称与档期**，且必须调共用工具，不许各写各的：

- 卡池：`hoverPool(pools, tz)` → `池名：角色` ⏎ `档期`
- 活动：`hoverEvent(items, tz)` → `名称 + 3 空格 + 档期`

元信息（来源站名 / URL / 时区推定 / 抓取条数 / 内部字段名 / 任何「（…）」实现说明）**一律不进悬停**。
⚠️ 特别注意 `bannerDatesRaw` / `eventDatesRaw` —— UI 的默认两行式会**直接显示**它们
（取 `*DatesRaw || *Dates`），所以也不能往里塞说明文字。

## 已知风险（不藏，代码注释里也有）

1. **`uma-cn`（闪耀优俊少女）不是官方时刻表**：bwiki 正文写着「简中卡池加速 -> 简中预测时间
   -185天 / +423天」，简中服时刻是 wiki 按日服时差**推算**的。解析器只用「已实装卡池」表做外显。
2. **`p5x` 的卡池/活动不是官方独立栏目**：`/news/gamebroad/` 与 `/news/gameevent/` 已停更 2 年，
   只有 `/news/gamenews/`（版本更新公告）在更新 → 两侧都从它正文抽档期；公告只给日期不给时刻
   → 起止补 `04:00 / 03:59`，属**推算**。
3. **「无当期内容」不是 bug**：抓取器能正常抓到页面，但页面里没有覆盖当前时刻的档期
   → 按插件语义**如实返回 `null`（未公布）**，**不硬凑过期档期**。
