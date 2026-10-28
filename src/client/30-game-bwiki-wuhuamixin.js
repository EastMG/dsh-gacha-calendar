//#region ① 物华弥新（whmx）
// 卡池页「限时招集档案」：`<table id="CardSelectTr" class="CardSelect wikitable sortable col-fold">`
//   表头 `活动名称 | UP器者 | 开放时间 | 备注`，113 行数据；**名称/UP 都只在 <img alt> / <a title> 属性里**
//   （正文 text 是空的），所以必须读属性。行属性 `data-param1` 是招集类型（新实装器者·限定 …）。
//   时间写法：`2026年09月30日 10:00 ~ 10月22日 09:59`（终点省年份）；远古行有 `2024年4月19日开服后~…`。
function ns_bwiki_parseWhmxGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];                       // 空页 → 无候选
	const cands = ns_bwiki_findTablesByHeaders(tables, ["开放时间", "活动名称"]);
	if (cands.length === 0) throw new Error("bwiki-whmx-gacha:no-table");   // 结构变了 → 抓取失败
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[2].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c2.text, tz, orient);
		if (wins.length === 0) return;
		const banner = ns_bwiki_cleanImgName(ns_bwiki_attrOf(c0.html, "alt")) || c0.text || ns_bwiki_attrOf(r.attrs, "data-param1") || "限时招集";
		const roles = ns_bwiki_linkTitles(c1.html).join("、") || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt"));
		items.push({
			_i: i, banner, roles, cat: ns_bwiki_attrOf(r.attrs, "data-param1"), note: c3.text,
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
// 活动页「活动」：同款 CardSelect 表，表头 `活动时间 | 图 | 名称 | 类型 | 备注`，63 行数据。
// ⚠️ 实测最新一条 = 2025/05/01（页面缓存时间 2026-10-01，即内容确实停在 2025-05）→ 当期无覆盖 → null。
function ns_bwiki_parseWhmxEvents(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const cands = ns_bwiki_findTablesByHeaders(tables, ["活动时间", "名称", "类型"]);
	if (cands.length === 0) throw new Error("bwiki-whmx-event:no-table");
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 5 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[0].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3, c4] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c0.text, tz, orient);
		if (wins.length === 0) return;
		items.push({
			_i: i,
			event: c2.text || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")) || "活动",
			cat: c3.text, img: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")), note: c4.text,
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
//#endregion
