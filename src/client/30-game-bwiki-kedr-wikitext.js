// ══════════════════════════════════════════════════════════════════════════════
// ③ 雪松（kedrgame）—— `Template:首页游戏版本内容` 的 `{{时间进度条|…}}` 调用
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_KEDR_TZ = "Asia/Shanghai";         // 推测：每期 05:00 换池（与 P6 社区页旁证一致）
// ⚠️ **必须带 `Template:` 前缀**：不带前缀返回 `{"code":"missingtitle"}`（HTTP 仍 200）；
//    返回的 `parse.title` 是 `模板:首页游戏版本内容`（中文命名空间别名）。
const ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE = "Template:首页游戏版本内容";
function ns_bwiki_wikitext_kedrTemplateUrl(page = ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE) {
	return `https://wiki.biligame.com/kedrgame/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
const ns_bwiki_wikitext_KEDR_TEMPLATE_URL = ns_bwiki_wikitext_kedrTemplateUrl();
const ns_bwiki_wikitext_KEDR_REFERER = "https://wiki.biligame.com/kedrgame/";

// `{{时间进度条|开始时间=2026/10/02 05:00|结束时间=2026/10/09 05:00|名称=【精英集结·支援】西尔维亚|链接=…|倒计时名称=…}}`
// → 参数对象数组。`<!-- -->` 注释块先剥掉（页尾注释里有一堆 `{{板块|按钮|…}}`，虽不含时间进度条，防患于未然）。
function ns_bwiki_wikitext_kedrTemplateCalls(wikitext) {
	const src = String(wikitext == null ? "" : wikitext).replace(/<!--[\s\S]*?-->/g, "");
	const out = [];
	const re = /\{\{\s*时间进度条\s*\|([^{}]*)\}\}/g;
	let m;
	while ((m = re.exec(src))) {
		const params = {};
		for (const part of m[1].split("|")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
		out.push(params);
	}
	return out;
}
// `2026/10/02 05:00`（月/日不补零，秒可省）
function ns_bwiki_wikitext_kedrStamp(text) { return ns_bwiki_wikitext_cznStamp(text); }
// 卡池 vs 活动分流（任务书口径）：含 `精英集结`/`演习`（雪松的抽卡系统叫「动员」，池名形如【精英集结·支援】）= 卡池；
// 含 `活动`/`赛季`/`通行证`/`剧情` = 活动。
function ns_bwiki_wikitext_kedrIsGacha(name) { return /精英集结|演习|动员|卡池/.test(String(name == null ? "" : name)); }
function ns_bwiki_wikitext_kedrIsEvent(name) {
	const n = String(name == null ? "" : name);
	if (ns_bwiki_wikitext_kedrIsGacha(n)) return false;
	return /活动|赛季|通行证|剧情|战令|防卫|挑战/.test(n);
}
// `【精英集结·支援】西尔维亚` → `西尔维亚`（`】` 之后就是 UP 角色）
function ns_bwiki_wikitext_kedrRoleFromName(name) {
	const m = /】\s*(.+?)\s*$/.exec(String(name == null ? "" : name));
	return m ? m[1].trim() : "";
}
// 模板 wikitext → { gacha:[…], event:[…], skipped }
// **一条时间进度条都没有 → 抛错**（模板被清空/改版 = 结构性损坏，不当"未公布"）
function ns_bwiki_wikitext_parseKedrTemplate(wikitext, tz = ns_bwiki_wikitext_KEDR_TZ) {
	const calls = ns_bwiki_wikitext_kedrTemplateCalls(wikitext);
	if (calls.length === 0) throw new Error("kedr-template:no-call");
	const gacha = [], event = [];
	let skipped = 0;
	calls.forEach((p, i) => {
		const name = String(p["名称"] || "").trim();
		const a = ns_bwiki_wikitext_kedrStamp(p["开始时间"]), b = ns_bwiki_wikitext_kedrStamp(p["结束时间"]);
		if (!name || !a || !b) { skipped++; return; }            // 缺名称/档期 → 跳过，不硬造
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) { skipped++; return; }
		const item = {
			_i: i, name, startTs, endTs,
			raw: `${p["开始时间"]} ~ ${p["结束时间"]}`,
			link: p["链接"] || "", timer: p["倒计时名称"] || ""
		};
		if (ns_bwiki_wikitext_kedrIsGacha(name)) gacha.push({ ...item, banner: name, roles: ns_bwiki_wikitext_kedrRoleFromName(name) });
		else if (ns_bwiki_wikitext_kedrIsEvent(name)) event.push(item);
		else skipped++;
	});
	if (gacha.length + event.length === 0) throw new Error("kedr-template:no-window");
	return { gacha, event, skipped, calls };
}
// ⚠️ 原先这里有个 _KEDR_HEADER：「雪松 bwiki Template:首页游戏版本内容（社区维护；【精英集结】/【演习】= 卡池，
//    活动/赛季/通行证/剧情 = 活动；tz=UTC+8 为推测）」——悬停元信息（来源站名/页面名/分流口径/时区推定），
//    按方案 A **整段删除**（分流规则仍在 ns_bwiki_wikitext_kedrIsGacha / ns_bwiki_wikitext_kedrIsEvent 的注释里）。
// 卡池：开始最新的覆盖档（该模板是**当期**面板，两条卡池同窗口 → 取文档顺序第一条）
async function ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz = ns_bwiki_wikitext_KEDR_TZ, now = nowMs()) {
	const { gacha } = ns_bwiki_wikitext_parseKedrTemplate(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_KEDR_TEMPLATE_URL, signal, ns_bwiki_wikitext_KEDR_REFERER), tz);
	return ns_bwiki_wikitext_gachaPayload(gacha, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i) });
}
// 活动：开始最新的覆盖档（个人剧情活动 > 战令通行证赛季 / 边境防卫）
// ⚠️ cat / tags 批 1（2026-11-08）：**故意不补** `cat`。源站确实给了类别词（模板参数「倒计时名称」，
//    即 `item.timer`：赛季 / 活动 / 边境防卫），但把它当 `cat` 会让档位判定**退化**：
//    `eventTier` 的判据是 `cat || tags` 优先、读不到才回退**活动名**，而这三个词都不在
//    `EVENT_TIER1_RE` 里 ⇒ 原本靠名字命中第一档的「个人剧情活动第1期：【新机动队故事】」会被打成第二档，
//    外显从它变成「战令通行证赛季」（实测 2026-10-01，见 test/cases-cat.mjs 的钉住用例）。
//    用户口径（批 1 硬约束②）：补 cat/tags **不许**动已可见输出，除非那是有意的档位改进 ——
//    这里不是改进，所以留空。要改成"照源站写"只需一行：给 eventPayload 加回 `catOf` 并传 `x.timer`。
async function ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz = ns_bwiki_wikitext_KEDR_TZ, now = nowMs()) {
	const { event } = ns_bwiki_wikitext_parseKedrTemplate(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_KEDR_TEMPLATE_URL, signal, ns_bwiki_wikitext_KEDR_REFERER), tz);
	return ns_bwiki_wikitext_eventPayload(event, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i), nameOf: (x) => x.name });
}
//#endregion
