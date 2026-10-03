// src/client/35-parsers-bestdori.js
//
// 由 next-sources/parsers/bestdori.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_bestdori__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-bestdori.js —— BanG Dream!（Bestdori 社区数据库，取**简中服**时间段）
//
// 契约：async (url, signal, tz) → 卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//                              活动侧 { event, eventDates, eventDatesRaw?, eventHover? }    （两侧都可为 null = 未公布）
//
// ⚠️ 实测（2026-10-02 夹具 `b1-bestdori-gacha` / `b1-bestdori-events`）与任务给的简化形态的差别：
//   1. 两个文件都是**以 id 为 key 的对象**（不是数组）：gacha 2149 个键、events 345 个键。
//   2. 时间是 **字符串毫秒**（`"1462071600000"`），需要 Number()；缺失服区为 `null`。
//   3. 字段名实测：
//      gacha：{ resourceName, bannerAssetBundleName, gachaName[5], publishedAt[5], closedAt[5], type, newCards }
//      event：{ eventType, eventName[5], assetBundleName, startAt[5], endAt[5], … }
//      —— 任务里猜的 `eventName`/`startAt`/`publishedAt`/`closedAt` 全对，但**值是字符串**。
//
// 服区下标：0=日 1=英 2=繁中 **3=简中** 4=韩。
//   实测交叉验证（夹具里的 gacha 1「リリース記念ガチャ」五连名称）：
//     [0] リリース記念ガチャ / [1] Release Celebration Gacha / [2] 遊戲上線紀念轉蛋 / [3] 开服纪念招募 / [4] 오픈 기념 뽑기
//   → [3] 是**简体中文**，即简中服（本条目要的服区）。gacha 里带 CN 时间的有 1734 / 2149 条。
//
// 时区：UTC+8。UTC 毫秒本身就是**绝对时刻**，这里**不做任何时区换算**；
//   `tz`（Asia/Shanghai）只用于把绝对时刻渲染成源站墙钟文本（sourceWallParts/fmtWindow）。
//   交叉验证（调研文档 + 夹具）：官方 displayTime 2026-09-29 10:00 ↔ 简中服 startAt=1790647200000（=02:00Z）完全吻合。


const ns_bestdori_DEFAULT_GACHA = "https://bestdori.com/api/gacha/all.5.json";
const ns_bestdori_DEFAULT_EVENT = "https://bestdori.com/api/events/all.5.json";
const ns_bestdori_CN_INDEX = 3;                        // 简中服下标（见文件头实测）
const ns_bestdori_LONG_MS = 400 * 86400e3;             // >400 天 = 长期/常驻池（如 closedAt=2100-08-15）
const ns_bestdori_HOVER_MAX = 20;

const ns_bestdori_toTs = (v) => {
	if (v == null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
const ns_bestdori_byNewestStart = (a, b) => (b.startTs - a.startTs)
	|| ((a.endTs == null ? Infinity : a.endTs) - (b.endTs == null ? Infinity : b.endTs))
	|| ((Number(a.id) || 0) - (Number(b.id) || 0));

// ── 卡池侧 ──
// 覆盖当前时刻的**有界**（≤400 天）简中池里取 startTs 最新的一期当"当期卡池"；
// 长期/常驻池（miracle/free 等，closedAt 常是 2100 哨兵）不参与选择，只在 hover 里报个数。
function ns_bestdori_parseBestdoriGacha(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bestdori-gacha-bad-shape");
	const keys = Object.keys(json);
	let sawIndexed = false;
	const pools = [];
	for (const k of keys) {
		const v = json[k];
		if (!v || typeof v !== "object") continue;
		if (!Array.isArray(v.publishedAt) || !Array.isArray(v.closedAt)) continue;
		sawIndexed = true;
		const name = Array.isArray(v.gachaName) ? v.gachaName[ns_bestdori_CN_INDEX] : null;
		const p = ns_bestdori_toTs(v.publishedAt[ns_bestdori_CN_INDEX]);
		const c = ns_bestdori_toTs(v.closedAt[ns_bestdori_CN_INDEX]);
		if (!name || p == null || c == null || c <= p) continue;   // 该服区没出这期 → 跳过
		pools.push({ id: k, name: String(name), type: String(v.type || ""), startTs: p, endTs: c, long: c - p > ns_bestdori_LONG_MS });
	}
	if (!sawIndexed) throw new Error("bestdori-gacha-bad-shape");   // 结构变了（不再有 publishedAt/closedAt 数组）
	const active = pools.filter((x) => x.startTs <= now && x.endTs >= now);
	const bounded = active.filter((x) => !x.long).sort(ns_bestdori_byNewestStart);
	const cur = bounded[0] || null;
	if (!cur) return null;   // 抓到数据但没有"当期"有界窗口 = 未公布（长期池不算当期）

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 同名同期（同一期招募在多处登记）→ 合并成一行并标 ×n，hover 才不会被重复行刷屏
	const pooled = [];
	for (const p of bounded) {
		const hit = pooled.find((x) => x.name === p.name && x.startTs === p.startTs && x.endTs === p.endTs);
		if (hit) hit.n += 1; else pooled.push({ ...p, n: 1 });
	}
	const shown = pooled.slice(0, ns_bestdori_HOVER_MAX).map((p) => `${p.name}（${p.type}）${p.n > 1 ? `×${p.n}` : ""}  ${fmtWindow(p.startTs, p.endTs, tz)}`);
	if (pooled.length > shown.length) shown.push(`…另有 ${pooled.length - shown.length} 个同期卡池未列出`);
	const longN = active.length - bounded.length;
	if (longN > 0) shown.push(`另有 ${longN} 个长期/常驻卡池（结束时间是 2100 之类的哨兵值，未计入"当期"）`);

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
function ns_bestdori_parseBestdoriEvents(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bestdori-event-bad-shape");
	const keys = Object.keys(json);
	let sawIndexed = false;
	const rows = [];
	for (const k of keys) {
		const v = json[k];
		if (!v || typeof v !== "object") continue;
		if (!Array.isArray(v.startAt) || !Array.isArray(v.endAt)) continue;
		sawIndexed = true;
		const name = Array.isArray(v.eventName) ? v.eventName[ns_bestdori_CN_INDEX] : null;
		const s = ns_bestdori_toTs(v.startAt[ns_bestdori_CN_INDEX]);
		const e = ns_bestdori_toTs(v.endAt[ns_bestdori_CN_INDEX]);
		if (!name || s == null || e == null || e <= s) continue;
		rows.push({ id: k, name: String(name), type: String(v.eventType || ""), startTs: s, endTs: e });
	}
	if (!sawIndexed) throw new Error("bestdori-event-bad-shape");
	const active = rows.filter((x) => x.startTs <= now && x.endTs >= now).sort(ns_bestdori_byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 活动一般只有一期在期；多期时 hover 逐行列出（与插件 buildEventHover 同约定：<2 条返回 ""）
	const hover = active.length >= 2
		? active.map((x) => `${x.name}（${x.type}）  ${fmtWindow(x.startTs, x.endTs, tz)}`).join("\n")
		: "";
	return { event: cur.name, eventDates: dates, eventDatesRaw: dates, eventHover: hover };
}

// 抓取器：mode="proxy"（实测 bestdori.com 无 ACAO，必须走宿主代理）
async function ns_bestdori_gachaBestdori(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_bestdori_DEFAULT_GACHA, { signal });
	return ns_bestdori_parseBestdoriGacha(data, now, tz);
}
async function ns_bestdori_eventsBestdori(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_bestdori_DEFAULT_EVENT, { signal });
	return ns_bestdori_parseBestdoriEvents(data, now, tz);
}
