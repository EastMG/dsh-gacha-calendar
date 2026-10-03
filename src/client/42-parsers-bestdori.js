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
// 长期/常驻池阈值：**用本体那一条**（LONG_TERM_MAX_WINDOW_DAYS = 120）。
// ⚠️ 2026-10-03 收敛：这里原本是 400 天，与本体/sekai 的 120 天**不是同一个值** ——
//    同一条规则不该有两个值。实测影响：夹具里 22 个窗口落在 (120, 400] 天之间
//    （「新手限定 / 回归纪念 / 每日免费 / 少女们的回忆 / 开服纪念」这类长期池），
//    在 400 天下会被误判成"当期"。当前真实在架池恰好 0 个落在该区间，故属**潜在**不一致。
const ns_bestdori_LONG_MS = LONG_TERM_MAX_WINDOW_DAYS * 864e5;

// ⚠️ 2026-10-03 收敛：本文件原有 `toTs`（宽容版）与 `byNewestStart` —— 前者与 sekai 那份**语义不同**、
//    后者与 sekai 那份逐字相同（差别只在 `Number(a.id)` 与 `a.id`）。均已统一到
//    `41-sources-shared.js` 的 `numOrNull` / `byNewestStart`。

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
		const p = numOrNull(v.publishedAt[ns_bestdori_CN_INDEX]);
		const c = numOrNull(v.closedAt[ns_bestdori_CN_INDEX]);
		if (!name || p == null || c == null || c <= p) continue;   // 该服区没出这期 → 跳过
		pools.push({ id: k, name: String(name), type: String(v.type || ""), startTs: p, endTs: c, long: c - p > ns_bestdori_LONG_MS });
	}
	if (!sawIndexed) throw new Error("bestdori-gacha-bad-shape");   // 结构变了（不再有 publishedAt/closedAt 数组）
	const active = pools.filter((x) => coversNow(x, now));
	const bounded = active.filter((x) => !x.long).sort(byNewestStart);
	const cur = bounded[0] || null;
	if (!cur) return null;   // 抓到数据但没有"当期"有界窗口 = 未公布（长期池不算当期）

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 同一期招募可能被源站多处登记（同名同窗口）→ 先去重成一条（本体没有「×n」记法，也不该有重复行）。
	// ⚠️ 2026-10-03 改：这里原本**手搓悬停**（`名称（类型枚举）×n  档期` 单行式 + 「另有 N 个未列出」
	//    + 「结束时间是 2100 之类的哨兵值」这类元信息），与本体/其它来源的
	//    「池名 ⏎ 档期」两行式不一致 —— 本备选源没被方案 A 的悬停审计覆盖到（它只是 altSources 里的一个）。
	//    现在改用共用 hoverPool：排版只有一处实现。
	const seen = new Set();
	const uniq = bounded.filter((p) => {
		const k = `${p.name}|${p.startTs}|${p.endTs}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
	const hover = hoverPool(uniq.map((p) => ({ name: p.name, startTs: p.startTs, endTs: p.endTs })), tz);

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
		const s = numOrNull(v.startAt[ns_bestdori_CN_INDEX]);
		const e = numOrNull(v.endAt[ns_bestdori_CN_INDEX]);
		if (!name || s == null || e == null || e <= s) continue;
		rows.push({ id: k, name: String(name), type: String(v.eventType || ""), startTs: s, endTs: e });
	}
	if (!sawIndexed) throw new Error("bestdori-event-bad-shape");
	const active = rows.filter((x) => coversNow(x, now)).sort(byNewestStart);
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
