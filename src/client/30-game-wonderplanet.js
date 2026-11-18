// src/client/30-game-wonderplanet.js —— WonderPlanet：粉碎狂热·日服（crashfever）
//
// 职责（2026-11-16 按厂商重排）：由 30-game-bwiki-batch5.js 拆出；条目 + 解析器 + 抓取器 + 登记都在本文件。
// 源：bwiki SMW `action=ask` 查 `类别::卡池`（标题 / 时间 / 结束时间 / 类别，limit=500 一次拿全；只有卡池侧）。
// 复用关系：bwiki 公共层 —— 30-game-bwiki-common.js 的载荷生成器（`ns_bwiki_batchGachaPayloadOf`）
//   与 2026-11-16 移入同文件的 `ns_b5_*` 时间锚 helper；符号名 `ns_crashfever_*` 原样保留。
// 请求预算：1 次/轮（没有独立缓存：一页即一期）。tz = Asia/Tokyo（源站墙钟 JST）。

// ── 源站事实（2026-11-15 实测；夹具见 test/fixtures/b5-*）────────────────────────
// ⚠️ bwiki 对无 `Referer` 的裸请求回 567（WAF 挑战页）⇒ 每个请求都必须带
//    `Referer: https://wiki.biligame.com/`（统一走 `fetchJson(..., { referer })`，bwiki 主机由
//    `15-env.js` 收口改走宿主代理 —— 与既有 bwiki 源同一条通道）。
//
// ① crashfever / 粉碎狂热（CrashFever）（中文 wiki）
//    GET …/crashfever/api.php?action=ask&format=json&query=<enc>
//    query = `[[类别::卡池]]|?标题|?时间|?结束时间|?类别|limit=500`
//    `类别` 是**属性**（不是分类），值为 `卡池`；`时间`/`结束时间` 都是 `_dat`（raw 带时分）。
//    实测 166 行、**一次拿全**（`limit=500` 生效、无 `query-continue-offset`）。页「添加卡池预设」
//    是模板页，printouts 没有时间 ⇒ 解析时跳过（结构性坏行 ≠ 结构损坏）。
//    页 `超Fever祭典【傅柯】` 的 wikitext（`{{卡池信息|时间=…|结束时间=…}}`）与 ask 结果逐字一致。

//#region ① CrashFever（crashfever）：SMW `类别::卡池`（卡池侧）
// 2026-11-15 修正：CrashFever 是**日服**（bwiki 首页「日服角色图鉴 / 最新卡池」）——
// SMW 的 `时间` 墙钟按 JST 记（165 口池里 60 口 = 15:00，正是日服换池时刻；
// 同池页内渲染写 14:00 是北京时间的同一时刻）⇒ 条目时区 = Asia/Tokyo。
const ns_crashfever_TZ = "Asia/Tokyo";
const ns_crashfever_KEY_TAG = "类别";
const ns_crashfever_KEY_TITLE = "标题";
const ns_crashfever_KEY_START = "时间";
const ns_crashfever_KEY_END = "结束时间";
const ns_crashfever_QUERY = `[[${ns_crashfever_KEY_TAG}::卡池]]`
	+ `|?${ns_crashfever_KEY_TITLE}|?${ns_crashfever_KEY_START}|?${ns_crashfever_KEY_END}|?${ns_crashfever_KEY_TAG}|limit=500`;
const ns_crashfever_URL = "https://wiki.biligame.com/crashfever/api.php?action=ask&format=json&query="
	+ encodeURIComponent(ns_crashfever_QUERY);

function ns_crashfever_parseAsk(json, tz = ns_crashfever_TZ) {
	const results = ns_b5_resultsOf(json, "crashfever-ask");
	const rows = [];
	let i = 0;
	for (const [, v] of Object.entries(results)) {
		if (!v || typeof v !== "object") continue;
		const p = v.printouts;
		if (!p || typeof p !== "object") continue;
		const banner = String(ns_b5_textOf(p[ns_crashfever_KEY_TITLE])).replace(/\s+/g, " ").trim();
		const sp = ns_b5_pointOfPrintout(p[ns_crashfever_KEY_START]);
		const ep = ns_b5_pointOfPrintout(p[ns_crashfever_KEY_END]);
		if (!banner || !sp || !ep) continue;                            // 模板页（添加卡池预设）没有时间 ⇒ 跳过
		const startTs = ns_b5_tsOf(sp, false, tz);
		const endTs = ns_b5_tsOf(ep, true, tz);
		if (!(endTs > startTs)) continue;
		rows.push({
			_i: i++,
			banner,
			roles: "",
			category: ns_b5_listOf(p[ns_crashfever_KEY_TAG]).join("、"),
			startTs,
			endTs,
			raw: `${ns_b5_stampOf(sp)} ~ ${ns_b5_stampOf(ep)}`,
			display: fmtWindow(startTs, endTs, tz),
			isMain: true
		});
	}
	if (rows.length === 0) throw new Error("crashfever-ask:no-rows");
	// 排序**稳定化**（不是新口径）：同一时刻开的多口池在 SMW 里不保证顺序 ⇒ 按「开始 desc →
	// 结束 asc → 池名」定死，避免外显在同期几口池之间乱跳（同 dhmmr 的理由）
	rows.sort((a, b) => (b.startTs - a.startTs) || (a.endTs - b.endTs) || (a.banner < b.banner ? -1 : a.banner > b.banner ? 1 : 0));
	rows.forEach((r, k) => { r._i = k; });
	return rows;
}
function ns_crashfever_payloadOf(items, tz, now) {
	return ns_bwiki_batchGachaPayloadOf(Array.isArray(items) ? items : [], tz, now, { id: "crashfever" });
}
async function ns_crashfever_gacha(url, signal, tz = ns_crashfever_TZ, now = nowMs()) {
	const target = String(url == null ? "" : url) === "" ? ns_crashfever_URL : String(url);
	const json = await fetchJson(target, { referer: ns_b5_REFERER, signal, mode: "proxy" });
	return ns_crashfever_payloadOf(ns_crashfever_parseAsk(json, tz), tz, ns_bwiki_nowOf(now));
}
//#endregion

registerSource({
	id: "crashfever",
	// 活动侧未配置（`eventUrl` 为空）⇒ 出厂隐藏（用户 2026-11-19 口径）。
	defaultHidden: true,
	tz: ns_crashfever_TZ,
	name: "粉碎狂热·日服",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/96/9a/78/969a78f3-9c5f-e0d8-23bd-db2153b133ad/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: ns_crashfever_URL,
	source: "Bwiki 卡池一览",
	eventUrl: ""
});

GACHA_FETCHERS["crashfever"] = (url, signal, tz, now) => ns_crashfever_gacha(url, signal, tz, now);
