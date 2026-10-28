// ══════════════════════════════════════════════════════════════════════════════
// ② 卡厄斯梦境 国服（czn）—— `Module:Gacha/data` 的 Lua 表
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_CZN_TZ = "Asia/Shanghai";          // 推测：10:00 开池 / 02:00 关池，国服作息
const ns_bwiki_wikitext_CZN_MODULE_PAGE = "Module:Gacha/data";
// ⚠️ 页面名写 `Module:Gacha/data`，但返回的 `parse.title` 是 **`模块:Gacha/data`**（中文命名空间别名）——
//    别拿 title 反查页面名。URL 里的 `%3A` / `%2F` 就是这两个分隔符。
const ns_bwiki_wikitext_CZN_MODULE_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(ns_bwiki_wikitext_CZN_MODULE_PAGE)}&prop=wikitext&format=json`;
const ns_bwiki_wikitext_CZN_RECORD_PAGE = "卡池记录";
const ns_bwiki_wikitext_CZN_RECORD_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(ns_bwiki_wikitext_CZN_RECORD_PAGE)}&prop=wikitext&format=json`;
const ns_bwiki_wikitext_CZN_REFERER = "https://wiki.biligame.com/czn/";

// `2026-5-28 10:00:00`（月/日**不补零**，秒可省）→ { y, mo, d, h, mi }
function ns_bwiki_wikitext_cznStamp(text) {
	const m = /^\s*(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:[ \t]+(\d{1,2})\s*[:：]\s*(\d{2}))?(?:\s*[:：]\s*(\d{2}))?\s*$/.exec(String(text == null ? "" : text));
	if (!m) return null;
	const h = m[4] != null ? +m[4] : 0, mi = m[5] != null ? +m[5] : 0;
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi };
}
// Lua 表 → 6 期 [{ id, type, char, startTs, endTs, raw }]
// 实测形态（fixtures/p8-czn-module，999B，6 期）：
//   return { ["0001"] = { type = "主战员营救概率提升", start_date = "2026-5-28 10:00:00",
//                          end_date = "2026-6-17 02:00:00", link_char = "绯", }, … }
function ns_bwiki_wikitext_parseCznLua(wikitext, tz = ns_bwiki_wikitext_CZN_TZ) {
	const src = String(wikitext == null ? "" : wikitext);
	const items = [];
	const entryRe = /\[\s*"([^"]+)"\s*\]\s*=\s*\{([\s\S]*?)\}/g;
	let m;
	while ((m = entryRe.exec(src))) {
		const body = m[2];
		const f = {};
		for (const fm of body.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) f[fm[1]] = fm[2];
		const a = ns_bwiki_wikitext_cznStamp(f.start_date), b = ns_bwiki_wikitext_cznStamp(f.end_date);
		if (!a || !b) continue;
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) continue;                       // 源站错行 → 丢弃
		items.push({
			_i: items.length,
			id: m[1],
			type: f.type || "",
			char: f.link_char || "",
			startTs, endTs,
			raw: `${f.start_date} ~ ${f.end_date}`
		});
	}
	if (items.length === 0) throw new Error("czn-lua:no-entry");   // 结构变了（Lua 表被改/页面空）→ 抓取失败
	return items;
}
// 备选页 `卡池记录`（**只有 1 条**模板调用，2026/03，已过期；本文件只导出纯函数，不挂抓取器）：
//   {{Gacha|id=TEST|title=小春概率UP|type=救援概率UP|Start_Date=2026/03/22 8:59:00|End_Date=2026/03/27 8:59:00|UP=小春|banner=…}}
function ns_bwiki_wikitext_parseCznRecord(wikitext, tz = ns_bwiki_wikitext_CZN_TZ) {
	const src = String(wikitext == null ? "" : wikitext);
	const items = [];
	const callRe = /\{\{\s*Gacha\s*\|([\s\S]*?)\}\}/g;
	let m;
	while ((m = callRe.exec(src))) {
		const f = {};
		for (const part of m[1].split("|")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			f[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
		const a = ns_bwiki_wikitext_cznStamp(f["Start_Date"]), b = ns_bwiki_wikitext_cznStamp(f["End_Date"]);
		if (!a || !b) continue;
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) continue;
		items.push({
			_i: items.length,
			id: f.id || "",
			banner: f.title || "卡池",
			roles: f.UP || "",
			cat: f.type || "",
			startTs, endTs,
			raw: `${f["Start_Date"]} ~ ${f["End_Date"]}`
		});
	}
	return items;
}
// 卡池外显：**开始最新**的覆盖档（与 bestdori/sekai/stellasora 的"最新开始"同口径：
// 卡厄斯这 6 期是两两成对的三批，最新一批 = 赛季限定）
// ⚠️ 原先此处给 `ns_bwiki_wikitext_gachaPayload` 传了 header「卡厄斯梦境 bwiki Module:Gacha/data（Lua 表 6 期；tz=UTC+8 为推测）」
//    —— 那是悬停元信息（来源站名 / API 名 / 抓取条数 / 时区推定），按方案 A **整段删除**。
//    Lua 表页名/期数仍是**数据**（ns_bwiki_wikitext_CZN_MODULE_PAGE / items.length），注释与注册表里都有，不进悬停。
async function ns_bwiki_wikitext_gachaCzn(url, signal, tz = ns_bwiki_wikitext_CZN_TZ, now = nowMs()) {
	const items = ns_bwiki_wikitext_parseCznLua(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_CZN_MODULE_URL, signal, ns_bwiki_wikitext_CZN_REFERER), tz)
		.map((x) => ({ ...x, banner: `${x.type}（${x.char}）`, roles: x.char }));
	return ns_bwiki_wikitext_gachaPayload(items, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i) });
}
//#endregion
