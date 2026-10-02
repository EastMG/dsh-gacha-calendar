// next-sources/registry.js —— 独立来源注册表（**不合并进插件**）
//
// 本文件只做**聚合**：各批次把条目写在自己的 `registry-b*.js` 里（避免同名文件并发冲突），
// 这里统一导出。条目契约与插件 `src/client/40-fetchers.js` 一致，将来可原样搬过去。
//
// ── 时区取值与依据（2026-10-02 调研 + 各批实测，详见各 registry-b*.js 与调研文档）──
//   · 国服一律 UTC+8。**大多为推测**（源站普遍不写时区），但有三处已获硬证据/交叉验证：
//       - BanG Dream 国服：官方 displayTime=2026-09-29 10:00 ↔ Bestdori CN startAt=2026-09-29 02:00Z
//       - FGO 国服：SMW `开始时间` 是 UTC，与国服表墙钟**严格差 8 小时**
//       - 少前2：API `Date` 口径（发布 18:31、维护 09:00~12:00、【迭代回廊】05:00 刷新点）
//   · 赛马娘日服 = Asia/Tokyo（**硬标注**：bwiki 正文「日服卡池时间记录统一为日本时间」）
//   · OurNotes 日服 = Asia/Tokyo（**实测**：`date` 与 `date_gmt` 差 9 小时）
//   · PJSK = UTC+8（**推测**；区服**已确认 = 国服**，证据见 registry-b1.js 注）
//
// ── 可用性现状（"当期有数据" = 窗口覆盖 now；不覆盖则抓取器如实返回 null = 未公布）──
//   可用：p5x / uma-jp-umapyoi / bandori-bestdori / pjsk / gf2 / bandori / ournotes / fgo / wuhuamixin(卡池)
//   当前无数据（抓取器就绪但源站无当期内容）：见 registry-b2.js —— 那 5 侧**如实返回 null**
//
//   ⚠️ p5x 的卡池/活动**不是**官方独立栏目：官方 /news/gamebroad/ 与 /news/gameevent/
//      实测**已停更 2 年**（2024-10 / 2024-09）；只有 /news/gamenews/（版本更新公告）在更新。
//      故 p5x 两侧都读 gamenews，从正文抽「YYYY年M月D日—M月D日」档期。

import { NEXT_SOURCES as P5X_SOURCES } from "./registry-p5x.js";
import { SOURCES_B1 } from "./registry-b1.js";
import { SOURCES_B2 } from "./registry-b2.js";
import { SOURCES_B3 } from "./registry-b3.js";
import { SOURCES_P4 } from "./registry-p4.js";
import { SOURCES_P5 } from "./registry-p5.js";
import { SOURCES_P6 } from "./registry-p6.js";
import { SOURCES_P7 } from "./registry-p7.js";
import { SOURCES_P8 } from "./registry-p8.js";
import { SOURCES_P9, EXTRA_GACHA_FETCHERS_P9, EXTRA_EVENT_FETCHERS_P9 } from "./registry-p9.js";
import { EXTRA_GACHA_FETCHERS, EXTRA_EVENT_FETCHERS } from "./registry-extras.js";

// ── 合并规则：**后来者覆盖同 id 的先前条目**（Map 的 set 保留首次插入位置，所以顺序稳定）──
// 为什么不是"重复就抛错"：P8/P9 是**对既有条目的补强/取代**，本就该覆盖：
//   · P8 的 `zspms` / `czn` / `kedr` 取代 B2 的旧页面源（旧页面停更/空页）
//   · P9 的 `wuhuamixin`（补活动侧）/ `uma-cn`（官方源取代 wiki 推算表）
// 若改成"重复即抛错"，这些补强就没法落进来（它们的 id 必须与原条目相同，才能让用户看见同一个游戏）。
const byId = new Map();
for (const s of [...P5X_SOURCES, ...SOURCES_B1, ...SOURCES_B2, ...SOURCES_B3, ...SOURCES_P4, ...SOURCES_P5, ...SOURCES_P6, ...SOURCES_P7]) {
	if (byId.has(s.id)) throw new Error("next-sources 注册表 id 重复（同一批内不该重复）: " + s.id);
	byId.set(s.id, s);
}
for (const s of [...SOURCES_P8, ...SOURCES_P9]) byId.set(s.id, s);   // 覆盖
const ALL = [...byId.values()];

// ── 备选源守卫 ──
// 插件契约：`gachaFetcherFor` 查 `GACHA_FETCHERS[alt.fetcher]`（扁平表）；
//           `eventFetcherFor` 查 `EVENT_FETCHERS[source.id][alt.fetcher]`（**按条目 id 分组**）。
// 这里在汇总期就校验每个 altSources/eventAltSources 引用的 fetcher 都被登记了，
// 且 URL 与条目自身不同（否则永远命不中自己的备选）。
{
	// P9 也自带一组备选抓取器（`uma-cn-bwiki` / `ournotes-global-*`），一起纳入守卫
	const gachaKeys = new Set([...Object.keys(EXTRA_GACHA_FETCHERS), ...Object.keys(EXTRA_GACHA_FETCHERS_P9)]);
	const eventTables = { ...EXTRA_EVENT_FETCHERS, ...EXTRA_EVENT_FETCHERS_P9 };
	const problems = [];
	for (const s of ALL) {
		for (const a of s.altSources || []) {
			if (!gachaKeys.has(a.fetcher)) problems.push(`${s.id}.altSources 的 fetcher「${a.fetcher}」未登记`);
			if (!a.url) problems.push(`${s.id}.altSources 缺 url（altSourceId 靠 url 命中）`);
		}
		for (const a of s.eventAltSources || []) {
			const tbl = eventTables[s.id];
			if (!tbl || !tbl[a.fetcher]) problems.push(`${s.id}.eventAltSources 的 fetcher「${a.fetcher}」未在 EVENT 表[${JSON.stringify(s.id)}] 登记`);
			if (!a.url) problems.push(`${s.id}.eventAltSources 缺 url（altSourceId 靠 url 命中）`);
		}
	}
	if (problems.length) throw new Error("备选源登记有问题：\n  - " + problems.join("\n  - "));
}

export const NEXT_SOURCES = ALL;

// 便捷查询
export function findSource(id) { return NEXT_SOURCES.find((s) => s.id === id) || null; }
export function listIds() { return NEXT_SOURCES.map((s) => s.id); }
// 统计：既可用于门禁守卫，也可用于"当前实际有数据的来源"清单
export function stats() {
	const sides = [];
	for (const s of NEXT_SOURCES) {
		if (s.gacha) sides.push({ id: s.id, side: "gacha" });
		if (s.event) sides.push({ id: s.id, side: "event" });
	}
	return { sources: NEXT_SOURCES.length, sides: sides.length, ids: listIds() };
}
