# next-sources 各批次要照抄的模式

> 本目录**独立于插件本体**（不合并）。权威说明见父目录
> `dsh-gacha-calendar-新增游戏来源调研-2026-10-02.md`（每个来源的实测证据）。

## 文件分工（**严格只写自己批次的文件，不要动别人的**）

| 谁 | 写这些 |
|---|---|
| **各批次** | `parsers/<game>.js`、`fixtures/<name>/*`、`test/cases-<batch>.mjs`、`registry-<batch>.js` |
| Lead（已完成，**别改**） | `lib/env.js`、`registry.js`、`test/harness.mjs`、`test/capture.mjs`、`test/run.mjs`、`parsers/p5x.js` |

## 契约（必须一致，与插件 `src/client/40-fetchers.js` 相同）

```js
// 抓取器：async (url, signal, tz) => 数据对象 | null
//   null = 未公布（抓到页面但当期没内容）；结构性损坏 → 抛错（该侧算抓取失败）
// 卡池侧：{ banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, event?, eventDates?, eventDatesRaw?, eventHover? }
// 活动侧：{ event, eventDates, eventDatesRaw?, eventHover? }
// bannerDates 文本形态：`MM-DD HH:MM ~ MM-DD HH:MM`（跨年时两端带 YYYY-）
```

**两条铁律**（仓库里都踩过坑）：

1. **`bannerDates` 用源站墙钟原文**（不要拿 `Date` 再解释一遍）。
   绝对时刻用 `sourceInstant(...)` 按 `tz` 换算；文本用 `sourceWallParts`/`fmtWindow` 按 `tz` 渲染。
2. **`now` 不要放在第二参**。签名一律 `(url, signal, tz)`，`now` 靠后并自带默认值。
   （仓库历史 bug：`now` 收到 `tz` 字符串 → `startTs <= now` 恒 false → 静默"未公布"。）

## 可用工具（从 `../lib/env.js` import）

```js
fetchText(url, { referer, headers, signal, mode })  // mode="proxy"(默认) | "direct"
fetchJson(url, opts)                                // 同上，返回已解析 JSON（坏 JSON 抛 bad-json）
fetchMediaWikiText(url, opts)                       // api.php 专用：自动加 &origin=*，取 parse.text
sourceInstant(y, mo, d, h, mi, tz)                  // 源站墙钟 → 绝对毫秒
sourceWallParts(ts, tz)                             // 绝对毫秒 → 源站墙钟字段 {y,mo,d,h,mi}
fmtWindow(startTs, endTs, tz)                       // → "MM-DD HH:MM ~ MM-DD HH:MM"
fmtMdHm(ts, tz)
stripTags(html) / decodeEntities(s) / textOf(html)
```

**`mode` 怎么定**（调研实测 ACAO）：只有这三个是 `"direct"`，其余一律 `"proxy"`：
`api.umapyoi.net`、`sekai-world.github.io`、`bang-dream-on.bushimo.jp`。

## 抓夹具

```bash
cd next-sources
node test/capture.mjs <夹具名> <真实url> [referer]
# 例：node test/capture.mjs uma-umapyoi https://api.umapyoi.net/api/v1/gacha
```
它会写 `fixtures/<夹具名>/response.txt`（+ `.meta.json`）并登记 `test/map.json`。
**需要多页/多次请求的来源，就抓多个夹具名**（如 `-list` / `-detail`）。

## 写测试用例（`test/cases-<batch>.mjs`）

照这个骨架（**离线跑夹具**，不要依赖网络）：

```js
import { useFixtures, check, section, assertContract } from "./harness.mjs";
import { findSource } from "../registry-<batch>.js";

export default async function run() {
  useFixtures();                       // ← 装了夹具 fetch，解析器无需改动
  section("<批次名>");
  const src = findSource("<id>");
  const g = await src.gacha.fetcher(src.gacha.url, undefined, src.tz);   // 可能为 null
  assertContract("<显示名>", "gacha", g);
  check("<显示名> 卡池 banner 合理", !!g && g.banner.length > 0, JSON.stringify(g && g.banner));
}
```
`assertContract(label, side, data)` 会守卫字段名/文本形态/`endTs > startTs`；
`data` 为 `null` 时视为"未公布"，合法（但**如果源站明明有数据却返回 null，就是 bug**）。

## 注册表片段（`registry-<batch>.js`）

```js
import { gachaXxx, eventsXxx } from "./parsers/xxx.js";
export const SOURCES_<BATCH> = [
  { id: "xxx", name: "显示名", tz: "Asia/Shanghai",
    gacha: { url: "…", fetcher: gachaXxx, kind: "official-api|official-html|wiki|third-party", mode: "proxy" },
    event: { url: "…", fetcher: eventsXxx, kind: "…", mode: "…" } }
];
```
**只有一侧就只写一侧**（用户明确说"不要求两侧都有"）。

## 做完必须自测通过

```bash
cd next-sources && node test/run.mjs
```
（`run.mjs` 会加载你的 `cases-<batch>.mjs`。若它还没加载，说明 Lead 还没汇总——你就先本地临时 import 跑一遍，确认全绿再报。）
