//#region ⑥ 卡厄斯梦境 国服（czn / page=卡池记录）—— ⚠️ 实测为空页
// `prop=text` 全文只有 `模板:Gacha` 一个链接，**无表格、无日期**（wiki 侧该模板已不存在/不产出内容）。
// 同 wiki 站内搜索 "卡池" 只命中 4 页（卡池记录 / 首页 / 首页-PC端 / 首页-移动端），没有更好的卡池页。
// ⇒ 返回 []，抓取器据此返回 null（如实"抓到了页面但当期没内容"）。若日后 wiki 补全为 CardSelect 表，
//    本解析器按 whmx 同款表头（开放时间/活动名称）兜底解析。
function ns_bwiki_parseCznGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const cands = ns_bwiki_findTablesByHeaders(tables, ["开放时间"]);
	if (cands.length === 0) return [];                         // 有表但不是卡池表 → 视为无内容
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[2].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c2.text, tz, orient);
		if (wins.length === 0) return;
		items.push({
			_i: i,
			banner: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c0.html, "alt")) || c0.text || "卡池",
			roles: ns_bwiki_linkTitles(c1.html).join("、"),
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
//#endregion
