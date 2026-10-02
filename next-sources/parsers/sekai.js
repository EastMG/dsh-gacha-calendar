// next-sources/parsers/sekai.js —— PJSK 缤纷舞台（sekai-master-db cn-diff，GitHub Pages 静态 JSON）
//
// 契约：async (url, signal, tz) → 卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//                              活动侧 { event, eventDates, eventDatesRaw?, eventHover? }    （两侧都可为 null = 未公布）
//
// ⚠️ 实测（2026-10-02 夹具 `b1-sekai-gachas` 59 条 / `b1-sekai-events` 198 条）与任务给的形态的差别：
//   1. `gachas.json` 的 `gachaType` 是**字符串枚举**（beginner/normal/sureturn/subeginner/ceil/sunormal），
//      不是数字；`events.json` 的 `eventType` 也是字符串（marathon/cheerful_carnival/world_bloom）。
//   2. **`events.json` 里根本没有 `endAt` 字段**（这是任务给的字段形态里最需要纠正的一处）。
//      实测字段：startAt / aggregateAt / rankingAnnounceAt / distributionStartAt / closedAt / distributionEndAt。
//      本解析器把**活动游玩期**取为 `startAt ~ aggregateAt`（aggregateAt = 活动结束、开始统计的时刻），
//      并在 `eventDatesRaw` 里如实注明这个映射；`closedAt` 是结果公布时刻，不作窗口结束。
//   3. `gachas.json` 里有大量**长期池**：endAt 是 2099 哨兵（如 id 579「任务招募」2025-01-01 ~ 2099-12-30）。
//      它们不参与"当期"选择（见下），只在 hover 里报个数。
//
// 时区：UTC+8（`Asia/Shanghai`）。epoch 毫秒 = 绝对时刻，**不做时区换算**，`tz` 只用于渲染墙钟文本。
//   依据（夹具自洽，把"推测"变成了可验证的三条）：
//   ① 生日池 836「[桐谷遥]HAPPY BIRTHDAY 2026招募」startAt=1790784000000 → UTC+8 渲染正好是 2026-10-01 00:00
//      （桐谷遥生日当天 00:00；UTC+9 会渲染成 01:00，不成立）；
//   ② 月卡池 802「缤纷月卡招募」startAt=1788145200000 → UTC+8 是 2026-09-01 04:00（每月 1 日 04:00 换月卡）；
//   ③ 常规卡池轮换时刻 825/826… 都落在 UTC+8 的 12:00。
//
// ✅ 服区**已确认 = 国服（简体中文）**（2026-10-03 复核，推翻此前"存疑"的判断）：
//   · 仓库 description = "Project Sekai (Simplified Chinese) Master DB Difference"、
//     README = "Sekai Master Data Diff for CN server"（GitHub 原文）
//   · 同库 events / cards / cardEpisodes / characterProfiles **全为简体**
//     （`雨过天晴的启明星` / `卡牌剧情（上篇）` / `宫益坂女子学园`），
//     对照 `tc-diff` 同结构全繁体（`雨後的第一顆星` / `支線劇情（前篇）` / `宮益坂女子學園`）
//   · 官网 pjsk.nvsgames.cn 页脚 published by Nuverse；国服公测 2025-03-27
//
// ⚠️ 但两处**数据质量**问题必须知道（它们不是"区服标错"，是上游回填残留）：
//   ① `events.json` 首条 id=1「雨过天晴的启明星」startAt=1633762800000 = 2021-10-09 15:00(UTC+8)，
//      **早于国服公测**（2025-03-27）→ 该时间线是上游对齐/回填的产物，
//      拿它当"国服活动排期"会**失真**。
//   ② 部分条目名是繁体（59 条卡池里 18 条，如 gacha 16「新手應援起跑衝刺招募」）→
//      国服客户端为「世界」的回响回填 2020–2024 历史时**沿用了繁中串**（CN/TW 共用 Nuverse 6.4.0
//      结构）；2024-05 之后的记录全部是简体。
//      **不做机械繁转简**：两岸官方译法本就不同（`[新手应援]必定获得1名★4成员10连招募券招募`
//      vs 繁中服 `[新手應援]必中1名★4成員10連票券招募`），机械转换会产出第三种、非官方的字符串。

import { fetchJson, fmtWindow } from "../lib/env.js";

const DEFAULT_GACHA = "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json";
const DEFAULT_EVENT = "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json";
const LONG_MS = 400 * 86400e3;   // >400 天 = 长期/常驻池（2099 哨兵）
const HOVER_MAX = 20;

const toTs = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const byNewestStart = (a, b) => (b.startTs - a.startTs)
	|| ((a.endTs == null ? Infinity : a.endTs) - (b.endTs == null ? Infinity : b.endTs))
	|| ((a.id || 0) - (b.id || 0));

// ── 卡池侧 ──
// 覆盖当前时刻的**有界**池里取 startTs 最新的一期当"当期招募"；长期池不参与（只在 hover 报个数）。
export function parseSekaiGachas(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!Array.isArray(json)) throw new Error("sekai-gacha-bad-shape");
	const pools = [];
	for (const g of json) {
		if (!g || typeof g !== "object") continue;
		const s = toTs(g.startAt), e = toTs(g.endAt);
		const name = typeof g.name === "string" ? g.name.trim() : "";
		if (!name || s == null || e == null || e <= s) continue;
		pools.push({ id: g.id, name, type: String(g.gachaType || ""), startTs: s, endTs: e, long: e - s > LONG_MS });
	}
	if (pools.length === 0) throw new Error("sekai-gacha-bad-shape");
	const active = pools.filter((x) => x.startTs <= now && x.endTs >= now);
	const bounded = active.filter((x) => !x.long).sort(byNewestStart);
	const cur = bounded[0] || null;
	if (!cur) return null;

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 同名同期（实测：阶梯招募/高级礼物招募各按角色重复 4~6 条）→ 合并成一行并标 ×n
	const pooled = [];
	for (const p of bounded) {
		const hit = pooled.find((x) => x.name === p.name && x.startTs === p.startTs && x.endTs === p.endTs);
		if (hit) hit.n += 1; else pooled.push({ ...p, n: 1 });
	}
	const shown = pooled.slice(0, HOVER_MAX).map((p) => `${p.name}（${p.type}）${p.n > 1 ? `×${p.n}` : ""}  ${fmtWindow(p.startTs, p.endTs, tz)}`);
	if (pooled.length > shown.length) shown.push(`…另有 ${pooled.length - shown.length} 组同期招募未列出`);
	const longN = active.length - bounded.length;
	if (longN > 0) shown.push(`另有 ${longN} 个长期/常驻招募（endAt 是 2099 之类的哨兵值，未计入"当期"）`);

	return {
		banner: cur.name,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		bannerHover: shown.length >= 2 ? shown.join("\n") : ""
	};
}

// ── 活动侧 ──
// 活动窗口 = startAt ~ aggregateAt（**源站无 endAt**，见文件头 ②；aggregateAt 缺失时退回 closedAt）
export function parseSekaiEvents(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!Array.isArray(json)) throw new Error("sekai-event-bad-shape");
	const rows = [];
	for (const e of json) {
		if (!e || typeof e !== "object") continue;
		const s = toTs(e.startAt);
		const agg = toTs(e.aggregateAt);
		const end = agg != null ? agg : toTs(e.closedAt);   // 源站无 endAt：优先 aggregateAt
		const name = typeof e.name === "string" ? e.name.trim() : "";
		if (!name || s == null || end == null || end <= s) continue;
		rows.push({ id: e.id, name, type: String(e.eventType || ""), startTs: s, endTs: end, closedAt: toTs(e.closedAt) });
	}
	if (rows.length === 0) throw new Error("sekai-event-bad-shape");
	const active = rows.filter((x) => x.startTs <= now && x.endTs >= now).sort(byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 源站没有"活动起止"这一对字段名 → 悬停里注明映射，避免读者以为 endAt 是从源站直接读到的
	const raw = `${dates}（源站无 endAt：结束取 aggregateAt${cur.closedAt != null ? `；closedAt=${fmtWindow(cur.closedAt, cur.closedAt, tz).split(" ~ ")[0]} 为结果公布` : ""}）`;
	const hover = active.length >= 2
		? active.map((x) => `${x.name}（${x.type}）  ${fmtWindow(x.startTs, x.endTs, tz)}`).join("\n")
		: "";
	return { event: cur.name, eventDates: dates, eventDatesRaw: raw, eventHover: hover };
}

// 抓取器：mode="direct"（实测 sekai-world.github.io = GitHub Pages 静态资源，带 ACAO）
export async function gachaSekai(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || DEFAULT_GACHA, { signal, mode: "direct" });
	return parseSekaiGachas(data, now, tz);
}
export async function eventsSekai(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || DEFAULT_EVENT, { signal, mode: "direct" });
	return parseSekaiEvents(data, now, tz);
}

export { LONG_MS as SEKAI_LONG_MS };
