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
//   · PJSK = UTC+8（**推测**；且服区存疑，见 registry-b1.js 注）
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

// 合并全部条目；若出现重复 id 直接抛错（汇总期就暴露，别留到运行期静默覆盖）
const ALL = [...P5X_SOURCES, ...SOURCES_B1, ...SOURCES_B2, ...SOURCES_B3];
const seen = new Set();
for (const s of ALL) {
	if (seen.has(s.id)) throw new Error("next-sources 注册表 id 重复: " + s.id);
	seen.add(s.id);
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
