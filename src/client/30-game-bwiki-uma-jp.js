//#region ③ 赛马娘 日服（umamusume / page=活动）—— 时区硬标注 Asia/Tokyo
// 页面只有一张表，标题是「往期活动」（**归档**，不是当期排期），100 行；表头 `活动时间 | 图 | 名称 | 类型`。
//   时间写法 `2025/12/26 11:00~ 2026/01/08 10:59`（开始 ~ 结束）。
//   第 1 行是常驻（`常驻~ 常驻`，无日期）→ 只计入常驻条数，不进当期排序。
//   ⚠️ 实测最新一条 2025/12/26 ~ 2026/01/08（页面缓存时间 2026-10-01）→ 当期无覆盖 → null。
//   ⚠️ 源站有错行 `2025/04/10 11:00~ 2024/04/18 10:59` → endTs<=startTs 被整行丢弃。
function ns_bwiki_parseUmaJpEvents(html, tz = "Asia/Tokyo") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return { items: [], permanent: 0 };
	const cands = ns_bwiki_findTablesByHeaders(tables, ["活动时间", "名称", "类型"]);
	if (cands.length === 0) throw new Error("bwiki-uma-jp-event:no-table");
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[0].text), tz);
	const items = [];
	let permanent = 0;
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c0.text, tz, orient);
		if (wins.length === 0) {
			if (/常驻|永久|長期|长期/.test(c0.text)) permanent++;
			return;
		}
		items.push({
			_i: i,
			event: c2.text || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")) || "活动",
			cat: c3.text, img: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")),
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return { items, permanent };
}
//#endregion
