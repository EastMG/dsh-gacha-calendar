// src/client/35-parsers-sekai.js
//
// 由 next-sources/parsers/sekai.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_sekai__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-sekai.js —— PJSK 缤纷舞台（sekai-master-db cn-diff，GitHub Pages 静态 JSON）
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


const ns_sekai_DEFAULT_GACHA = "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json";
const ns_sekai_DEFAULT_EVENT = "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json";
// 长期/常驻池阈值：**对齐本体** `EVENT_MAX_WINDOW_DAYS = 120`（本体对"长期/常驻玩法"的定义）。
// 旧值 400 天只够挡住 2099 哨兵值，会放过 365 天的**永久**池 ——
// 实测 `新手限定★4自选阶梯招募`（03-26 16:00 ~ 次年 03-26 15:59，整 365 天）就是这样漏进"当期招募"的
// （用户 2026-10-03 要求「规则和原来一致」）。限时招募最长约 1 个月，120 天阈值不会误伤。
const ns_sekai_LONG_MS = 120 * 86400e3;

const ns_sekai_toTs = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ns_sekai_byNewestStart = (a, b) => (b.startTs - a.startTs)
	|| ((a.endTs == null ? Infinity : a.endTs) - (b.endTs == null ? Infinity : b.endTs))
	|| ((a.id || 0) - (b.id || 0));

// ── 卡池侧 ──
// 覆盖当前时刻的**有界**池里取 startTs 最新的一期当"当期招募"；长期池（2099 哨兵等）不参与"当期"，
// 也不进悬停（它们恒在架，列出来是噪音）。
function ns_sekai_parseSekaiGachas(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!Array.isArray(json)) throw new Error("sekai-gacha-bad-shape");
	const pools = [];
	for (const g of json) {
		if (!g || typeof g !== "object") continue;
		const s = ns_sekai_toTs(g.startAt), e = ns_sekai_toTs(g.endAt);
		const name = typeof g.name === "string" ? g.name.trim() : "";
		if (!name || s == null || e == null || e <= s) continue;
		pools.push({ id: g.id, name, type: String(g.gachaType || ""), startTs: s, endTs: e, long: e - s > ns_sekai_LONG_MS });
	}
	if (pools.length === 0) throw new Error("sekai-gacha-bad-shape");
	const active = pools.filter((x) => x.startTs <= now && x.endTs >= now);
	const bounded = active.filter((x) => !x.long).sort(ns_sekai_byNewestStart);
	const cur = bounded[0] || null;
	if (!cur) return null;

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 悬停 = 全部当期**有界**池（长期池不参与"当期"，见上）。每池一行池名 + 档期，窗口完全相同则
	// 档期只在末尾写一遍 —— 排版交给共用工具 hoverPool（与本体 buildPoolHover 逐字一致）。
	// 源站没有角色名 → name 就用池名本身（对应本体的「池名：角色」里的池名位置）。
	// 池名里的「（ceil）」等后缀来自 `gachaType` 枚举，**不是源站原文** → 不进悬停；
	// 同名同窗的阶梯/高级礼物招募多条各自成行（源站如此，不再合并成 ×n）。
	const hover = hoverPool(bounded.map((p) => ({ name: p.name, startTs: p.startTs, endTs: p.endTs })), tz);
	// 只有 1 个当期池 → hover 为 ""，**不设 bannerHover**，由 UI 走默认两行式「banner ⏎ bannerDates」
	return {
		banner: cur.name,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}

// ── 活动侧 ──
// 活动窗口 = startAt ~ aggregateAt（**源站无 endAt**，见文件头 ②；aggregateAt 缺失时退回 closedAt）
function ns_sekai_parseSekaiEvents(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!Array.isArray(json)) throw new Error("sekai-event-bad-shape");
	const rows = [];
	for (const e of json) {
		if (!e || typeof e !== "object") continue;
		const s = ns_sekai_toTs(e.startAt);
		const agg = ns_sekai_toTs(e.aggregateAt);
		const end = agg != null ? agg : ns_sekai_toTs(e.closedAt);   // 源站无 endAt：优先 aggregateAt
		const name = typeof e.name === "string" ? e.name.trim() : "";
		if (!name || s == null || end == null || end <= s) continue;
		rows.push({ id: e.id, name, type: String(e.eventType || ""), startTs: s, endTs: end, closedAt: ns_sekai_toTs(e.closedAt) });
	}
	if (rows.length === 0) throw new Error("sekai-event-bad-shape");
	const active = rows.filter((x) => x.startTs <= now && x.endTs >= now).sort(ns_sekai_byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// ⚠️ 降级逻辑（保留）：源站 `events.json` **没有** `endAt` 字段，活动游玩期取 `startAt ~ aggregateAt`
	//    （aggregateAt = 活动结束、开始统计的时刻）；aggregateAt 缺失时退回 `closedAt`。
	//    这句说明是**实现细节**，只留在代码注释里，**不进悬停**。
	// `eventDatesRaw`：既有约定是"保留源站原文"，这里如实记录上面那次映射（本体也有条目这么做）。
	// `eventDatesRaw` 就写格式化档期本身：UI 的默认两行式会直接显示它
	// （`eventDatesRaw || eventDates`），所以**不能**在这儿夹带说明文字
	// —— 用户 2026-10-03 明确要求「元信息彻底删掉」。实测旧版把说明拼进来后，
	//    面板上出现了 `09-30 15:00 ~ 10-09 20:59（源站无 endAt：结束取 aggregateAt；…）` 这种尾巴。
	const raw = dates;
	// 悬停 = 全部当期活动，结束时间升序逐行「名称 + 3 空格 + 档期」（档期由共用工具 fmtWindow 格式化，
	// 与本体 buildEventHover 逐字一致）。**不排序**由工具负责 → 这里先排好序再传。
	// 只有 1 条 → 工具返回 ""，不设 eventHover，由 UI 走默认两行式「event ⏎ eventDates」。
	const ordered = active.slice().sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs));
	const hover = hoverEvent(ordered.map((x) => ({ name: x.name, startTs: x.startTs, endTs: x.endTs })), tz);
	return {
		event: cur.name,
		eventDates: dates,
		eventDatesRaw: raw,
		...(hover ? { eventHover: hover } : {})
	};
}

// 抓取器：mode="direct"（实测 sekai-world.github.io = GitHub Pages 静态资源，带 ACAO）
async function ns_sekai_gachaSekai(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_sekai_DEFAULT_GACHA, { signal, mode: "direct" });
	return ns_sekai_parseSekaiGachas(data, now, tz);
}
async function ns_sekai_eventsSekai(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_sekai_DEFAULT_EVENT, { signal, mode: "direct" });
	return ns_sekai_parseSekaiEvents(data, now, tz);
}
