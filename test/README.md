# test/ —— 解析器的离线夹具测试

## 怎么跑

```bash
node build.mjs        # 测试跑的是**构建产物** lib/client.js，改完 src/ 必须先 build
node test/all.mjs     # 离线门禁（走夹具）——这是门禁
```

`all.mjs` 会依次跑注册表守卫 + 夹具卫生 + **36 段**用例（P5X / B1 / B2 / B3 / P4 / P5 / P6 / P7 / P8 / P9 / 蔚蓝档案 / 异环 / 赛马娘 GameTora / 明日方舟两阶段（举行 / 奖励领取，SMW 单请求）+ 明日方舟时间轴（整周期逐时刻扫描）+ 规则静态守卫 + 时区口径 + 侧栏轮播 + 到期提醒 + 来源健康 + README 结构图守卫 + core 产物守卫 + 设置页标题行（版本号 + Star 指引）+ 搜索与筛选 + 排期导出 .ics + 刷新频率「启动时」档 + 设置入口（两个面板的齿轮 + 三步跳转设置页）+ 设置页 title 文案（11 处定稿）+ 来源策略（默认源无自动兜底）+ bwiki 请求统一带 `origin=*`（CORS 收口点）+ P3 解析器直出数组（悬停由条目反生成）+ **P4 展平**（数组 ts=绝对时刻 / 「近期」收全部条目 / 计数·提醒·ics·轮播按条 / 跨时区渲染一致）+ **category / tags 批 1**（8 款把已在内存里的分类写进数组条目：逐字取值 + 档位 + 外显 + 反证）+ **2026-11-09 新接入 5 款**（无期迷途两侧真源 / 夜幕之下卡池 / 未定事件簿·时空中的绘旅人·炽焰天穹留空未配置）+ **星铁卡池换官方公告 CMS**（bwiki 降为备选）+ **「相对起点」锚定**（星铁 10:00 / 无期迷途 14:00）+ **「起点未知 ≠ 已开始」** + **绝区零 bwiki 备选源的唯一例外**（`unknownStartIsActive`：只对这一条放行「起点未知 = 已开始」，其余来源仍严格；反向证明见那一段））。

## 为什么测试改成跑构建产物（2026-10-03）

用户要求「把 next-sources 合并进原 source，不留 next-source」。原先新增来源的解析器是
`next-sources/parsers/*.js`（ESM 模块，测试直接 `import` 源码，再由一个外部生成器内联进插件）。

现在它们压平成了 `src/client/42-parsers-*.js`（压平后见 `src/client/30-game-*.js`，按厂商/系列合并）—— 与 `30-parsers.js`（压平后拆成 22-fetcher-core.js 与 23~28-parser-* 各段）同性质的**普通拼接段**
（`build.mjs` 按 ORDER 原样拼成一个 IIFE）。普通段没有 `export`，所以测试改为：

1. `node build.mjs`
2. 加载 `lib/client.js`，取 `exports.__regression`（由 `src/client/44-test-exports.js` 定义）

这与仓库里另外 22 套门禁脚本的做法完全一致（它们也都要先 build 再加载产物）。

| 文件 | 作用 |
|---|---|
| `load.mjs` | 加载 `lib/client.js`，导出 `T`（`__regression`：17 个解析器模块的全部符号 + env 工具 + 来源/抓取器表） |
| `harness.mjs` | 夹具 fetch 注入、`check/section/summary`、契约与悬停断言 |
| `lib-text.mjs` | **悬停文本的共用判定**（`linesOf` / `dupLinesOf` / `consecutiveDupOf` / `bareTwoLineFormOf` / `eventRowsOf` / `noteRowsOf` / `doubledCategoryPrefixOf` / `assertHoverTextInvariants`）：`cases-arknights-claim.mjs` 与 `cases-arknights-timeline.mjs` 都 import 这一份，不许各写一套 |
| `registry-shim.mjs` | **注册表形态的测试侧快照**（见下） |
| `all.mjs` | 统一门禁 |
| `cases-*.mjs` | 各段用例（36 个：14 个批次 + `cases-rule-lint` 规则守卫 + `cases-tz` 时区口径 + `cases-ticker` 侧栏轮播 + `cases-remind` 到期提醒 + `cases-health` 来源健康 + `cases-readme` 结构图守卫 + `cases-core` core 守卫 + `cases-star` 设置页标题行（版本号 + Star 指引）+ `cases-filter` 搜索与筛选（设置页搜游戏名/只看已启用 + 面板按卡池·角色名过滤）+ `cases-ics` 排期导出 .ics（快照 / 折行 / 转义 / 在期判定）+ `cases-refresh` 刷新频率「启动时」档（`refreshMinutes=0` 的判定 / 定时器 / 设置页 / schema / 一次性迁移（**无条件**迁到 0）+ 待废弃标记守卫）+ `cases-settings-jump` 设置入口（三步跳转的纯判定 + 两个面板的齿轮静态守卫）+ `cases-settings-copy` 设置页 title 文案（11 处定稿：5 条改写 + 6 条删除；旧文案反向守卫）+ `cases-sources` **来源策略**（5 个默认抓取器主源失败/无数据时**不请求第二个站点**：断言 `calls` 里没有备选站 host + 失败抛错 / 无当期返回 null + 手动切源 altSources 仍取数）+ `cases-bwiki-cors` **bwiki 请求统一带 `origin=*`**（`withBwikiCors` 的纯函数边界：无 query 用 `?` / 已有 query 用 `&` / 已有 origin 不动 / 大小写·端口·hash / `*.biligame.com` / 幂等 + 两条 transport 出口（直连 `transportFetchRaw` / 代理 `proxyFetchText`）的接线守卫 + 战双 bwiki 实际请求记账（改造前缺这个参数的两条）+ 非 bwiki 站点逐字不变）+ `cases-p3` **解析器直出数组**（P3 第一批 + P3b 六批 + P3c 最后 3 款，共 54 条路径：悬停生成器的排版规则逐条（3 空格分隔 / 同窗口折叠 / <2 条给空串 / 缺起止写原文 / 长期过滤 / 与 `buildPoolHover`·`buildEventHover` 逐字节相同）+ 原神（bwiki 往期祈愿 / SMW 活动）、明日方舟（官方公告 / PRTS SMW）、鸣潮（官方公告链）54 条路径的**12 个字符串字段与数组 golden** 逐字不变（golden 于切换前采集、只补缺） + 数组与改造前合成结果逐条相等 + 悬停 == `hoverTextFromItems(条目事实)` 同源证明 + 条目事实通道不外泄）+ `cases-arknights-claim` 明日方舟两阶段（PRTS **SMW 单请求** `action=ask` 一次取「活动类型 / 开始 / 活动结束 / 兑换结束」；三态 + 空结果/请求失败/坏响应三条退化 + 解析纯函数八种边界 + 分类前缀去重 `labelOf` / 提示行插入位置 / 一条请求的记账断言 + 分页不追页；另有活动备选源「PRTS 活动一览」（手动切换才走；SMW 失败时断言 `calls` 里没有一览请求））+ `cases-p4flat` **P4 展平**（数组 ts=绝对时刻（按条目 tz 解析源站墙钟，含「X.Y 版本更新后」单边窗口）/ 同一份夹具在 TZ=UTC 与 +08 下逐字节相同 / 「近期」按条展开（明日方舟 3 · 星铁 5+3 · pjsk 17 · bandori 1+16）/ 24 小时与 7 天计数按条（bandori 2 格 13 条）/ 提醒·ics·轮播遍历 N 条（含兑换截止）/ 跨时区渲染文本逐字相同 / 渲染层静态守卫）+ `cases-arknights-timeline` 明日方舟**时间轴**（用真机 2026-11-07 三条活动，对「开始前 1 天 / 开场后 1h / 活动结束前 6h / 进兑换期 / 兑换期中 / 兑换结束前 1h / 兑换结束后 1h / 整周期结束」逐时刻跑完整链路：悬停三条结构不变量 + 阶段 + 名称去重 + 双 deadline 提醒 + 不崩 + 持久化；另有跨年、无兑换期字段、空结果/请求失败两条退化路径、兑换期长于 3 天不消失（M9/M10）与提醒/沿用旧值深挖）+ `cases-category` **category / tags 批 1+2**（`events[]` 条目的 `category` / `tags` 逐款逐字（真夹具：终末地 tags / 重返未来1999 / 明日方舟 / 原神 / 星铁 / 绝区零（多值按 `<br />` 拆）/ P5X / PJSK / FGO；雪松**故意不补**并钉住"补了会退化"）+ `eventTier` 档位 + 显示层 `scheduleCellOf` 外显（唯一有意变化 = 终末地 予众魂的新光影 → 百趣演武）+ `EVENT_TIER1_RE` 英文分支（`Event`/`Campaign` 第一档、`Other` 第二档、`\b` 防误命中）+ 反证（摘掉 category/tags ⇒ 档位/外显回退）+ 老缓存里旧字段名的读入兼容）+ `cases-new5` **2026-11-09 新接入 5 款**（无期迷途：bwiki 追踪一览 → 池名 / 卡池类型 / 起止 / 概率提升角色 + 官方资讯 API → 活动名 / 起止（「开服后」走维护公告锚点，无锚点则不写 startTs）；夜幕之下：bwiki 契约一览（活动侧未配置）；未定事件簿 / 时空中的绘旅人 / 炽焰天穹：只注册条目、来源留空未配置 —— 不抓取 / 不抛错 / 自检算 unconfigured 而不是 down；三条 hover 逐字 + gacha[] / events[] 逐条 + `cases-hsr-official` **星铁换官方公告 CMS**（真夹具 6 条公告：正文累积判重 / 当期合并 2 个 5★ / 10:00 锚点 / upcoming 分支 / 起点未知 ⇒ null）+ `anchorStartOf` 三态 × 两款锚点（12 组）+ 「起点未知 ≠ 已开始」（无期迷途 11-11 批与星铁 4.7 批不进外显·近期·提醒 + 反向证明） |
| `capture.mjs` / `capture-p8.mjs` | 抓真实响应存夹具 |
| `ui/` | **UI 渲染验证 harness**（`npm run test:ui`）：真 Chromium 里按真实产物 CSS 做几何断言。**不在默认门禁里**，见文末那节 |
| `map.json` | URL → 夹具 的映射索引（**已入库**） |
| `fixtures/` | 真实响应快照（**已入库**，约 14MB；重建/刷新见下） |

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

## 夹具怎么重建 / 刷新

夹具是「抓包存档」（123 个目录（246 个文件）、合计约 14 MB，单文件最大约 4 MB）。它们是**某时点的快照、
源站改版后本就该重抓**。**2026-10-18 起已入库**（见 `.gitignore`），这样 CI 与干净克隆都能跑全量门禁。
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

## UI 渲染验证 harness（`test/ui/`）—— **不在默认门禁里**

```bash
npm run test:ui     # = node test/ui/harness.mjs
```

前面那些用例都是"在构建产物里 grep 文本"，抓不到**几何**问题 —— 最近几个 bug 全是这类：
侧栏底栏三行间距不匀（14px vs 8px）＋横向滚动条、设置页搜索框的放大镜与占位文字**重叠**
（行内 style 的 padding 压过类规则）、新面板刷新图标偏大。于是有了这一套：把上面这些问题变成
一条命令能跑的断言。

它怎么工作（关键：量的是**真实 CSS 布局结果**，不是 CSS 文本）：

1. 按 `build.mjs` 的 `CSS_ORDER` 拼出 `src/client/styles/*.css` 的**真实产物 CSS**（顺序即层叠顺序）；
2. `page.setContent()` 一个静态页面：真实 CSS + `test/ui/fixtures.mjs` 里**照抄组件渲染结果**的 DOM 片段；
3. 对 `getBoundingClientRect` / `getComputedStyle` / `getBBox` 做断言：A 底栏槽位（两个入口竖排 / 单入口不生效 /
   无横向滚动）、B 底栏间距（相邻间隙两两相等且 = 8px）、C 搜索框（放大镜右边界 < 文字起点、外壳高 20）、
   D 图标规格（刷新 vs 齿轮、两处放大镜）、E 近期行（行高 = 图标 26 + 上下 padding）、F 通用溢出扫描；
4. 同一批断言跑**两遍**：干净宿主 / 宿主强制 `input{padding:0 14px}`，两遍都必须过。

**需要 Playwright（Chromium）**。没装不报错：打印装法 + `结果：0 通过 / 0 失败（已跳过）` + exit 0。

```bash
npm install --no-save --no-package-lock playwright@1   # 不写进 devDependencies
npx playwright install chromium
```

**为什么不进 `test/all.mjs`、也不进 CI**：CI 是 ubuntu 且没有浏览器，为一个本地视觉门禁用每次 CI
都拖一份浏览器依赖不划算；它也比夹具门禁慢（要起浏览器）。所以它是**按需手动跑的一道门**，
红灯退出码非 0（可直接接进任何脚本）。

已知盲区（别指望它）：颜色/对比度与主题令牌是否好看、字体渲染与字重观感、动画**过程**
（`prefers-reduced-motion: reduce` 下量的都是落定态）、"看起来挤不挤"这类主观判断；
宿主用 `!important` 强压 `input` 内边距时，面板底栏那枚放大镜仍会与文字重叠（它靠 input 的
左内边距避让）—— harness 会打印诊断行说明这一点，但**不计分**（设置页那套并排结构不受影响）。

