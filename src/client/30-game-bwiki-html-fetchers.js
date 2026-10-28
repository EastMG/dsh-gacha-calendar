//#region 抓取器（契约：async (url, signal, tz) → 数据对象 | null；now 在最后、有默认值）
async function ns_bwiki_fetchHtml(url, signal) {
	return fetchMediaWikiText(url, { signal, mode: "proxy" });
}
// 物华弥新 国服 —— 卡池
async function ns_bwiki_gachaWhmx(url, signal, tz = "Asia/Shanghai", now) {
	const items = ns_bwiki_parseWhmxGacha(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_gachaPayload(items, tz, ns_bwiki_nowOf(now));
}
// 物华弥新 国服 —— 活动
async function ns_bwiki_eventsWhmx(url, signal, tz = "Asia/Shanghai", now) {
	const items = ns_bwiki_parseWhmxEvents(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now));
}
// 闪耀优俊少女 国服 —— 卡池（只用「已实装卡池」，预测只进 bannerHover 且标注为推算）
async function ns_bwiki_gachaUmaCn(url, signal, tz = "Asia/Shanghai", now) {
	const { live, predicted } = ns_bwiki_parseUmaCnGacha(await ns_bwiki_fetchHtml(url, signal), tz);
	const n = ns_bwiki_nowOf(now);
	// 预测表只用来让夹具测试断言解析结果，**不进悬停**（见 ns_bwiki_umaCnPredictHover 的说明）
	return ns_bwiki_gachaPayload(live, tz, n);
}
// 赛马娘 日服 —— 活动（bwiki 侧；页面为「往期活动」归档）
async function ns_bwiki_eventsUmaJp(url, signal, tz = "Asia/Tokyo", now) {
	const { items, permanent } = ns_bwiki_parseUmaJpEvents(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now), permanent);
}
// 战双帕弥什 国服 —— 卡池（研发记录）
async function ns_bwiki_gachaZspms(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseZspmsGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 雪松 —— 卡池（台架测试占位页）
async function ns_bwiki_gachaKedr(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseKedrGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 卡厄斯梦境 国服 —— 卡池（页面为空，预期 null）
async function ns_bwiki_gachaCzn(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseCznGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 星塔旅人 国服 —— 活动（首页活动日历，低可用性）
async function ns_bwiki_eventsStellasora(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_eventPayload(ns_bwiki_parseStellasoraEvents(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
//#endregion
