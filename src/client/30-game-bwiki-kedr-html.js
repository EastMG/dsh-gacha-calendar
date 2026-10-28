//#region ⑤ 雪松（kedrgame / page=卡池信息）—— ⚠️ 台架测试占位页，可能已停更
// 该页**没有任何表格**，只有两个小节「台架测试[一]」「台架测试[二]」，正文形如：
//   `<b>===时间===</b>：2024/12/7-2024/12/13`（**只有日期、没有时刻**）
//   第二段是 `？-？`（未填）。→ 实测唯一可解析的窗口 = 2024/12/07 ~ 2024/12/13，早于当期 → null。
//   ⚠️ 风险标注：最近编辑 2025-08-01、页面自称「台架测试」；但同 wiki 有 `历史卡池-精英集结-1.0.0-*`、
//      `游戏内部公告(2026.6/7)` 等更新页面，说明 wiki 还活着、只是本页不再是有效数据源。
function ns_bwiki_parseKedrGacha(html, tz = "Asia/Shanghai") {
	const re = /={2,}\s*时间\s*={2,}\s*(?:<\/b>)?\s*[:：]?\s*([^<]*)/g;
	const items = [];
	let m, i = 0;
	while ((m = re.exec(String(html)))) {
		const value = m[1].replace(/\s+/g, " ").trim();
		const w = ns_bwiki_windowsFromCell(value, tz, "startFirst")[0];
		if (!w) continue;
		items.push({
			_i: i++,
			banner: ns_bwiki_headingBefore(html, m.index) || "卡池",
			roles: "", cat: "台架测试", note: value,
			startTs: w.startTs, endTs: w.endTs, raw: value
		});
	}
	return items;
}
//#endregion
