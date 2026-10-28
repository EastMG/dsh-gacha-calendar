//#region ⑦ 星塔旅人 国服（stellasora / page=首页 的「活动日历」区块）—— ⚠️ 低可用性
// 区块形如：
//   `<div class="activity-item"><img alt="Banner bossrush 5.png" …>
//      <div class="activity-time" data-end-time="2026-04-01T02:59:59">计算中...</div>
//      <div class="activity-date">2026/03/01</div></div>`
// 只有 2 项；**没有活动名文本字段**（只能取立绘文件名）、剩余时间由页面 JS 现算（静态是「计算中...」）。
// `data-end-time` 是**不带时区**的 ISO → 按源站墙钟（国服 UTC+8）解释（**假设**，见 registry-b2.js）。
// ⚠️ 实测两项分别止于 2026-04-01 / 2026-04-07（页面静态计数「当前正在进行的活动有 0 个」）→ 当期无覆盖 → null。
function ns_bwiki_parseStellasoraEvents(html, tz = "Asia/Shanghai") {
	const out = [];
	const re = /<div class="activity-item">([\s\S]*?)<div class="activity-date"\s*>([^<]*)<\/div>/g;
	let m, i = 0;
	while ((m = re.exec(String(html)))) {
		const block = m[1];
		const endIso = ns_bwiki_attrOf(block, "data-end-time");
		const startText = m[2].replace(/\s+/g, " ").trim();
		const alt = ns_bwiki_attrOf(block, "alt");
		const sp = ns_bwiki_parsePoints(startText)[0];
		const em = String(endIso).match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
		if (!sp || !em) continue;
		const startTs = sourceInstant(sp.y, sp.mo, sp.d, 0, 0, tz);
		const endTs = sourceInstant(+em[1], +em[2], +em[3], +em[4], +em[5], tz);
		if (!(endTs > startTs)) continue;
		out.push({
			_i: i++,
			event: ns_bwiki_cleanImgName(alt) || "活动",
			cat: "活动日历", img: ns_bwiki_cleanImgName(alt), imgRaw: alt,
			startTs, endTs, raw: `${startText} ~ ${endIso}`
		});
	}
	return out;
}
//#endregion
