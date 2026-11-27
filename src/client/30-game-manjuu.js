// src/client/30-game-manjuu.js —— 蛮啾网络：蓝色星原：旅谣（promilia 国服 / promilia-global 国际服）
//
// 用户 2026-11-27 口径（原话）：
//   「国服按顺序接官方 API（名称定为 官方公告）、promilia.wiki、TapTap，其中官方公告设为默认，
//     各自独立不做兜底补全；国际服接官方公告」
// ⇒ 国服卡池侧：默认 = 官方公告，备选 = promilia.wiki / TapTap（互不兜底、互不补全）；
//   国服活动侧：官方公告**没有**游戏内活动公告（27 条 notice + 1 条 activity 逐条读过，只有创作激励/概率公示/测试档期），
//     且游戏内活动公告走客户端签名通道（`prod-version-all-p3-cn.manjuu.com/version/client/v1_0/announce`，
//     匿名请求回 `{"code":150002,"message":"签名错误"}`）⇒ 用户 2026-11-27 定：**活动侧不挂官方公告**；
//     默认 = promilia.wiki（星原档案室），备选 = TapTap；
//   国际服：卡池 + 活动两侧都用官方公告（rgn1 站，繁体），单一来源。
//
// ── 源站事实（2026-11-27 实测）────────────────────────────────────────────────
// ① 官方公告 API（官网 https://azurpromilia.jimi-global.com 前端在用的接口）：
//      GET https://api-grp.manjuu.com/announce/web/announcement/{pagelist,pagelatestlist,getdetail}
//      GET https://api-grp-rgn1.jimi-global.com/announce/web/announcement/…（国际服/台港澳，繁体）
//    必带头：sign / timestamp / lang / sdk-version / device-id / grp-trace-id / grp-client-info。
//    **签名无密钥**：`sign = md5(timestamp + 按参数名排序的 "k=v&k=v")`（实测 2026-11-27，
//    国服 total=30 / 国际服 total=18；不带 sign 回 `{"code":150002,"msg":"签名错误"}`）。
//    `pagelist` 参数：type=notice|activity|news|latest|system、page、pageSize（实测上限 10）。
//    `getdetail?id=` → `{ type, title, contentUrl, startTime }`；正文是**静态 HTML**（ACAO `*`，可直连）。
//    卡池公告 = notice 里标题形如「弦定观测「桃笺为契」」的条目；正文含
//      `✦观测时间✦ 2026年11月26日开服后 - 2026年12月17日 03:59（UTC+8）` 与限定角色/灵子。
// ② promilia.wiki（星原档案室，**非官方**，国服口径，简体）：
//      GET https://promilia.wiki/events → 200 / 173KB，SSR HTML，robots 允许（只禁 /_admin/ 等）。
//    每张卡：`<article id="…" data-event-status="live|upcoming|permanent|undated|teaser|ended">`，
//    卡名 `<h3 class="events_cardTitle…">`，起止 `<dl class="events_when…">` 里两个
//    `<time dateTime="ISO+08:00">`，奖励名 `events_rewardName…`。观测卡标题形如「弦定 · 桃笺为契」；
//    站内写「辑点」（U+8F91），官方/插件术语是「羁点」（U+7F81）——**逐字保留源站写法**，不改名。
//    无 ACAO ⇒ 走宿主代理（`promilia.wiki` 已登记白名单）。无 ETag/Last-Modified ⇒ 每次整页。
// ③ TapTap 官方 tab（与 czn/pengpeng 同一条公共层 `ns_taptap_topicPostsOf`）：
//      https://www.taptap.cn/app/593829/topic?type=official（robots 允许 /app/*；无 ACAO ⇒ 走代理）
//    帖正文 200 字内即含「观测时间 / 活动时间」行（卡池帖：`「桃笺为契」弦定观测` 等）。
// tz：国服/国际服公告与 promilia.wiki 都是 **UTC+8** 墙钟（站内明写「北京时间」/`+08:00`）⇒ Asia/Shanghai。
// 「开服后」起点锚 = 公测开服时刻 **2026-11-26 10:00（UTC+8）**（官方定档公告 + 游戏内公告一致）。

//#region 常量
const NS_PRO_CN_API = "https://api-grp.manjuu.com/announce/web/announcement";
const NS_PRO_GL_API = "https://api-grp-rgn1.jimi-global.com/announce/web/announcement";
const NS_PRO_CN_LANG = "zh-Hans";
const NS_PRO_GL_LANG = "zh-Hant";
const NS_PRO_TZ = "Asia/Shanghai";
const NS_PRO_LAUNCH_TS = Date.UTC(2026, 10, 26, 2, 0, 0); // 2026-11-26 10:00 +08
const NS_PRO_WIKI_URL = "https://promilia.wiki/events";
const NS_PRO_TAPTAP_URL = "https://www.taptap.cn/app/593829/topic?type=official";
const NS_PRO_CN_LIST_URL = NS_PRO_CN_API + "/pagelist?type=notice&page=1&pageSize=10";
const NS_PRO_GL_LIST_URL = NS_PRO_GL_API + "/pagelist?type=notice&page=1&pageSize=10";
//#endregion

//#region 官方公告 API 的签名（md5，无密钥）
// 为什么自己写 md5：渲染进程没有 Node `crypto`，WebCrypto 只有 SHA 系列 ⇒ 只能纯 JS 实现。
// 只服务本文件，命名收敛在 `ns_pro_` 前缀下。
function ns_pro_md5(str) {
	const s = String(str);
	const bytes = [];
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 0x80) bytes.push(c);
		else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
		else if (c < 0xd800 || c >= 0xe000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
		else { i++; const cp = 0x10000 + (((c & 0x3ff) << 10) | (s.charCodeAt(i) & 0x3ff)); bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)); }
	}
	const n = bytes.length;
	const bitLen = n * 8;
	bytes.push(0x80);
	while (bytes.length % 64 !== 56) bytes.push(0);
	const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
	bytes.push(lo & 255, (lo >>> 8) & 255, (lo >>> 16) & 255, (lo >>> 24) & 255, hi & 255, (hi >>> 8) & 255, (hi >>> 16) & 255, (hi >>> 24) & 255);
	const add = (a, b) => (a + b) | 0;
	const rol = (x, c) => (x << c) | (x >>> (32 - c));
	const K = [];
	for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;
	const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
	let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
	for (let off = 0; off < bytes.length; off += 64) {
		const M = [];
		for (let i = 0; i < 16; i++) M[i] = bytes[off + i * 4] | (bytes[off + i * 4 + 1] << 8) | (bytes[off + i * 4 + 2] << 16) | (bytes[off + i * 4 + 3] << 24);
		let A = a0, B = b0, C = c0, D = d0;
		for (let i = 0; i < 64; i++) {
			let F, g;
			if (i < 16) { F = (B & C) | (~B & D); g = i; }
			else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
			else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
			else { F = C ^ (B | ~D); g = (7 * i) % 16; }
			const tmp = D;
			D = C; C = B;
			B = add(B, rol(add(add(A, F), add(K[i], M[g])), S[(i >> 4) * 4 + (i % 4)]));
			A = tmp;
		}
		a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
	}
	const hex = (x) => {
		let out = "";
		for (let i = 0; i < 4; i++) out += ((x >>> (i * 8)) & 255).toString(16).padStart(2, "0");
		return out;
	};
	return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

/** 参数对象 → `按 key 排序的 k=v&k=v`（签名与 query 用同一串，见文件头实测）。 */
function ns_pro_canonicalQueryOf(params) {
	return Object.keys(params).sort().map((k) => k + "=" + params[k]).join("&");
}

/** 官方公告 API 的请求头（含 sign/timestamp；实测缺一即 `签名错误`）。 */
function ns_pro_apiHeadersOf(lang, query) {
	const timestamp = Math.ceil(nowMs());   // core 纯净度：不许裸 nowMs()（build 守卫）
	return {
		"content-type": "application/json",
		"sdk-version": "1.2.3",
		lang,
		"device-id": "6f1a7d2c-9b4e-4a55-8f3d-2c7e1a9b0d44",
		"grp-trace-id": "trace-" + timestamp,
		"grp-client-info": JSON.stringify({
			platform: "web",
			UA: typeof navigator === "object" && navigator ? String(navigator.userAgent || "") : "",
			device_language: lang,
			device_timezone: NS_PRO_TZ,
			grp_trace_id: "trace-" + timestamp,
			url_path: "/home/news",
			url_query: "",
			referrer: "",
			url_raw: ""
		}),
		sign: ns_pro_md5(timestamp + query),
		timestamp: String(timestamp)
	};
}

/** 官方公告 API：GET `base + path?query`（走宿主代理；签名头见上）。 */
async function ns_pro_apiGetOf(apiBase, path, params, lang, signal) {
	const query = ns_pro_canonicalQueryOf(params);
	const url = apiBase + path + "?" + query;
	const headers = ns_pro_apiHeadersOf(lang, query);
	const text = await fetchText(url, { headers, signal });
	let json;
	try { json = JSON.parse(text); } catch { throw new Error("promilia-bad-json"); }
	if (!json || typeof json !== "object") throw new Error("promilia-bad-json");
	if (Number(json.code) !== 0) throw new Error("promilia-api-" + String(json.msg || json.code));
	return json;
}

/** 官方公告正文（contentUrl 指向静态 HTML，实测 `ACAO: *` ⇒ 直连）。 */
async function ns_pro_noticeTextOf(contentUrl, signal) {
	const html = await fetchText(contentUrl, { mode: "direct", signal });
	return decodeHtmlEntities(String(html == null ? "" : html))
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
//#endregion

//#region 「观测时间 / 活动时间」窗口解析（官方公告正文 + TapTap 帖正文共用）
// 实测两种写法：
//   · `✦观测时间✦ 2026年11月26日开服后 - 2026年12月17日 03:59（UTC+8）`
//   · `【活動時間】2026年11月26日 開服後 ~ 2026年12月17日 03:59`
// 起点写「开服后」⇒ 锚到公测开服时刻；写「版本更新后」⇒ **起点未知，如实留 null**（不猜）。
const NS_PRO_WINDOW_LABEL_RE = /(?:观测|觀測|活动|活動)\s*[时時]?[间間]\s*[✦★▶\s]*[:：]?\s*([^\n]{4,120})/;
const NS_PRO_DATE_RE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})\s*[:：]\s*(\d{2}))?/;

/** 文本 → `{ startTs, endTs, raw }`；没有完整窗口 ⇒ null。 */
function ns_pro_windowOf(text, now, tz) {
	const s = String(text == null ? "" : text);
	const lab = NS_PRO_WINDOW_LABEL_RE.exec(s);
	if (!lab) return null;
	const line = lab[1];
	const parts = line.split(/\s*(?:[-~～—－]|至)\s*/);
	if (parts.length < 2) return null;
	const parseSide = (raw) => {
		const m = NS_PRO_DATE_RE.exec(raw);
		if (!m) return null;
		const y = m[1] == null ? null : Number(m[1]);
		const mo = Number(m[2]), d = Number(m[3]);
		const h = m[4] == null ? null : Number(m[4]);
		const mi = m[5] == null ? null : Number(m[5]);
		return { y, mo, d, h, mi, raw: String(raw).trim() };
	};
	const a = parseSide(parts[0]);
	const b = parseSide(parts.slice(1).join(" "));
	if (!b) return null;
	const hint = sourceWallParts(now, tz);
	let ey = b.y;
	if (ey == null) { ey = inferYear(null, b.mo, hint); if (ey == null) return null; if (endsNextYear(a ? a.mo : b.mo, a ? a.d : b.d, b.mo, b.d)) ey += 1; }
	const endTs = sourceInstant(ey, b.mo, b.d, b.h == null ? 23 : b.h, b.mi == null ? 59 : b.mi, tz);
	let startTs = null;
	if (a) {
		if (/开服后|開服後/.test(a.raw)) startTs = NS_PRO_LAUNCH_TS;
		else if (a.y == null && a.h == null) startTs = null;
		else {
			let sy = a.y;
			if (sy == null) { sy = inferYear(null, a.mo, hint); if (sy == null) return null; }
			startTs = sourceInstant(sy, a.mo, a.d, a.h == null ? 0 : a.h, a.mi == null ? 0 : a.mi, tz);
		}
	}
	if (!(endTs > (startTs == null ? 0 : startTs))) return null;
	return { startTs, endTs, raw: line.trim() };
}

/** 卡池标题 → 池名前的类别（弦定/羁点/始源/恒常/恒序）+ 池名；不像卡池 ⇒ null。 */
const NS_PRO_POOL_TYPE_RE = /(弦定|羈點|羈点|羁点|辑点|輯點|始源|恆常|恒常|恆序|恒序)\s*(?:观测|觀測)?\s*\u300C([^\u300D]{1,30})\u300D/;
function ns_pro_poolOf(text) {
	const m = NS_PRO_POOL_TYPE_RE.exec(String(text == null ? "" : text));
	if (!m) return null;
	return { type: m[1], pool: m[2] };
}

/** 正文里的限定五星角色/灵子名（`限定五星角色「涂山小玉（猛攻·风&光）」`）。 */
function ns_pro_rolesOf(text) {
	const s = String(text == null ? "" : text);
	const out = [];
	const re = /限定五星(?:角色|灵子|靈子)\u300C([^\u300D]{1,40})\u300D/g;
	let m;
	while ((m = re.exec(s))) {
		const name = m[1].replace(/（[^）]*）|\([^)]*\)/g, "").trim();
		if (name && out.indexOf(name) < 0) out.push(name);
	}
	return out.join("、");
}
//#endregion

/** 池类别优先级：角色限定（弦定）> 灵子限定（羁点/辑点）> 新手（始源）> 常驻（恒常/恒序）。 */
const NS_PRO_POOL_RANK = [["弦定", 0], ["羈点", 1], ["羁点", 1], ["辑点", 1], ["始源", 2], ["恆常", 3], ["恒常", 3], ["恆序", 4], ["恒序", 4]];
function ns_pro_poolRankOf(item) {
	const s = String((item && item.banner) || "");
	for (const [k, v] of NS_PRO_POOL_RANK) if (s.indexOf(k) >= 0) return v;
	return 9;
}

// 卡池载荷：**不**跨池合并角色（蓝原同一时刻并行跑「弦定/羁点」两口池，角色与灵子不是一回事；
// bwiki 的 batch 生成器会把同结束时刻的池合并成一行并把角色表并起来 —— 那样「花之舞」（灵子）
// 会跑到「涂山小玉」（角色）旁边，是错的事实，所以本来源自己收口）。
function ns_pro_gachaPayloadOf(items, tz, now, id) {
	const listed = (Array.isArray(items) ? items : []).filter((it) => coveredOrOpen(it, now));
	const active = listed.filter((it) => coversNow(it, now));
	if (active.length === 0) return null;
	const orderOf = (a, b) => (ns_pro_poolRankOf(a) - ns_pro_poolRankOf(b)) || (a.endTs - b.endTs) || ((a._i || 0) - (b._i || 0));
	const main = active.slice().sort(orderOf)[0];
	const hoverItems = listed.slice().sort(orderOf).map((it) => {
		const label = it.banner + (it.roles ? `\uFF1A${it.roles}` : "");
		return { title: label, label, startTs: it.startTs, endTs: it.endTs, raw: it.raw };
	});
	const hover = hoverTextFromItems(hoverItems, "gacha", tz);
	const dates = fmtWindow(main.startTs == null ? main.endTs : main.startTs, main.endTs, tz);
	const out = {
		banner: main.banner,
		roles: main.roles || "",
		bannerDates: dates,
		bannerDatesRaw: main.raw || dates,
		startTs: main.startTs,
		endTs: main.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
	out.gacha = dataArrayProducedGachaOf(out, hoverItems, { id, tz }, now);
	out.gachaHoverItems = hoverItems;
	return out;
}

//#region ① 官方公告（国服 / 国际服）
/** 公告列表（notice 类，2 页共 20 条足够覆盖当期与下一期）。 */
async function ns_pro_noticeRowsOf(apiBase, lang, signal) {
	const rows = [];
	for (let page = 1; page <= 2; page++) {
		const json = await ns_pro_apiGetOf(apiBase, "/pagelist", { type: "notice", page, pageSize: 10 }, lang, signal);
		const data = json.data || {};
		const pageRows = Array.isArray(data.rows) ? data.rows : [];
		for (const r of pageRows) rows.push(r);
		if (pageRows.length < 10) break;
	}
	if (rows.length === 0) throw new Error("promilia-official:no-rows");
	return rows;
}

/** 卡池条目事实：notice → getdetail → 正文 → 「观测时间」窗口。 */
async function ns_pro_officialGachaItemsOf(apiBase, lang, now, tz, signal) {
	const rows = await ns_pro_noticeRowsOf(apiBase, lang, signal);
	const pools = rows.filter((r) => ns_pro_poolOf(r && r.title));
	const items = [];
	let i = 0;
	for (const r of pools) {
		const det = await ns_pro_apiGetOf(apiBase, "/getdetail", { id: r.id }, lang, signal);
		const detData = det.data || {};
		const text = detData.contentUrl ? await ns_pro_noticeTextOf(detData.contentUrl, signal) : "";
		const win = ns_pro_windowOf(text, now, tz);
		if (!win) continue;
		const title = String(detData.title || r.title || "").trim();
		items.push({
			_i: i++,
			banner: title,
			roles: ns_pro_rolesOf(text),
			startTs: win.startTs,
			endTs: win.endTs,
			raw: win.raw,
			display: fmtWindow(win.startTs == null ? win.endTs : win.startTs, win.endTs, tz),
			category: (ns_pro_poolOf(title) || {}).type || "",
			isMain: true
		});
	}
	return items;
}

/** 活动条目事实：公告正文里带「活动时间」的条目（国服 notice 里没有；国际服在 activity 类里）。 */
async function ns_pro_officialEventItemsOf(apiBase, lang, now, tz, signal) {
	// 国服的「活动」类公告（`activity`）只有创作激励/网页活动，游戏内活动公告在 notice 里也没出现过
	// （实测 2026-11-27 全 30 条逐一读过）⇒ 这里两类型都扫，扫到什么算什么，扫不到就当"未公布"。
	const rows = [];
	for (const type of ["notice", "activity"]) {
		for (let page = 1; page <= 2; page++) {
			const json = await ns_pro_apiGetOf(apiBase, "/pagelist", { type, page, pageSize: 10 }, lang, signal);
			const data = json.data || {};
			const pageRows = Array.isArray(data.rows) ? data.rows : [];
			for (const r of pageRows) rows.push(r);
			if (pageRows.length < 10) break;
		}
	}
	const items = [];
	let i = 0;
	for (const r of rows) {
		if (ns_pro_poolOf(r && r.title)) continue;
		let text = "";
		let detData = {};
		try {
			const det = await ns_pro_apiGetOf(apiBase, "/getdetail", { id: r.id }, lang, signal);
			detData = det.data || {};
			text = detData.contentUrl ? await ns_pro_noticeTextOf(detData.contentUrl, signal) : "";
		} catch { continue; }
		const win = ns_pro_windowOf(text, now, tz);
		if (!win) continue;
		// 「即日起」类起点：锚到**源站自己的发布时间**（`getdetail` 的 `startTime`，不是 now）——
		// 与 czn 的「即日起～<绝对终点>」锚在 created_time 同一条口径（源站事实，不是猜）。
		let startTs = win.startTs;
		if (startTs == null && /即日起|即日|今日起|即刻起|即日開跑|今日開啟/.test(win.raw)) {
			const pub = Number(detData.startTime);
			if (Number.isFinite(pub) && pub > 0 && pub < win.endTs) startTs = pub;
		}
		items.push({
			_i: i++,
			event: String(r.title || "").trim(),
			startTs,
			endTs: win.endTs,
			raw: win.raw,
			display: fmtWindow(startTs == null ? win.endTs : startTs, win.endTs, tz)
		});
	}
	return items;
}

async function ns_pro_officialGachaOf(apiBase, lang, signal, tz, now) {
	const at = ns_bwiki_nowOf(now);
	const items = await ns_pro_officialGachaItemsOf(apiBase, lang, at, tz, signal);
	return ns_pro_gachaPayloadOf(items, tz, at, lang === NS_PRO_GL_LANG ? "promilia-global" : "promilia");
}
async function ns_pro_officialEventsOf(apiBase, lang, signal, tz, now) {
	const at = ns_bwiki_nowOf(now);
	const items = await ns_pro_officialEventItemsOf(apiBase, lang, at, tz, signal);
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, at, 0, lang === NS_PRO_GL_LANG ? "promilia-global" : "promilia", { includeOpenStart: true });
}
//#endregion

//#region ② promilia.wiki（星原档案室，社区源）
const NS_PRO_WIKI_CARD_RE = /<article id="([^"]+)"[^>]*data-event-status="([a-z]+)"[^>]*>([\s\S]*?)<\/article>/g;
const NS_PRO_WIKI_TITLE_RE = /<h3[^>]*class="events_cardTitle[^"]*"[^>]*>([\s\S]*?)<\/h3>/;
const NS_PRO_WIKI_WHEN_RE = /<dl class="events_when[^"]*">([\s\S]*?)<\/dl>/;
const NS_PRO_WIKI_REWARD_RE = /class="events_rewardName[^"]*">([\s\S]*?)<\/span>/g;
const NS_PRO_WIKI_POOL_RE = /^(弦定|辑点|羁点|始源|恒常|恒序)\s*·\s*(.+)$/;

function ns_pro_wikiTextOf(html) {
	return decodeHtmlEntities(String(html == null ? "" : html)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** /events HTML → 卡片数组 `{ id, status, title, startTs, endTs, roles }`（顺序 = 源站顺序）。 */
function ns_pro_wikiCardsOf(html) {
	const s = String(html == null ? "" : html);
	const out = [];
	let m;
	NS_PRO_WIKI_CARD_RE.lastIndex = 0;
	while ((m = NS_PRO_WIKI_CARD_RE.exec(s))) {
		const body = m[3];
		const tm = NS_PRO_WIKI_TITLE_RE.exec(body);
		if (!tm) continue;
		const title = ns_pro_wikiTextOf(tm[1]);
		if (!title) continue;
		const when = NS_PRO_WIKI_WHEN_RE.exec(body);
		const times = when ? [...when[1].matchAll(/dateTime="([^"]+)"/g)].map((x) => Date.parse(x[1])) : [];
		const startTs = Number.isFinite(times[0]) ? times[0] : null;
		const endTs = Number.isFinite(times[1]) ? times[1] : null;
		const roles = [];
		NS_PRO_WIKI_REWARD_RE.lastIndex = 0;
		let rm;
		while ((rm = NS_PRO_WIKI_REWARD_RE.exec(body))) {
			const name = ns_pro_wikiTextOf(rm[1]).replace(/\s*[×xX]\s*\d+\s*$/, "").trim();
			if (name && roles.indexOf(name) < 0) roles.push(name);
		}
		out.push({ id: m[1], status: m[2], title, startTs, endTs, roles: roles.join("、") });
	}
	if (out.length === 0) throw new Error("promilia-wiki:no-card");
	return out;
}

async function ns_pro_wikiGachaOf(url, signal, tz, now) {
	const at = ns_bwiki_nowOf(now);
	const html = await fetchText(url, { referer: "https://promilia.wiki/", signal });
	const cards = ns_pro_wikiCardsOf(html);
	const items = [];
	let i = 0;
	for (const c of cards) {
		const pm = NS_PRO_WIKI_POOL_RE.exec(c.title);
		if (!pm) continue;
		if (c.startTs == null && c.endTs == null) continue;
		items.push({
			_i: i++,
			banner: c.title,
			roles: c.roles,
			startTs: c.startTs,
			endTs: c.endTs,
			raw: fmtWindow(c.startTs == null ? c.endTs : c.startTs, c.endTs, tz),
			category: pm[1] === "辑点" ? "羁点" : pm[1]
		});
	}
	if (items.length === 0) return null;
	return ns_pro_gachaPayloadOf(items, tz, at, "promilia");
}

async function ns_pro_wikiEventsOf(url, signal, tz, now) {
	const at = ns_bwiki_nowOf(now);
	const html = await fetchText(url, { referer: "https://promilia.wiki/", signal });
	const cards = ns_pro_wikiCardsOf(html);
	const items = [];
	let i = 0;
	for (const c of cards) {
		if (NS_PRO_WIKI_POOL_RE.test(c.title)) continue;              // 观测卡归卡池侧
		if (c.status === "ended" || c.status === "teaser") continue;   // 已结束/未定档不收
		if (c.startTs == null && c.endTs == null) continue;
		items.push({ _i: i++, event: c.title, startTs: c.startTs, endTs: c.endTs, raw: fmtWindow(c.startTs == null ? c.endTs : c.startTs, c.endTs, tz) });
	}
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, at, 0, "promilia", { includeOpenStart: true });
}
//#endregion

//#region ③ TapTap 官方 tab（公共层 ns_taptap_topicPostsOf）
async function ns_pro_taptapPostsOf(url, signal) {
	const posts = [];
	for (let page = 1; page <= NS_TAPTAP_TOPIC_MAX_PAGES; page++) {
		const pageUrl = ns_taptap_topicPageUrl(url, page);
		let html;
		try { html = await fetchText(pageUrl, { referer: "https://www.taptap.cn/", signal }); } catch { continue; }
		for (const p of ns_taptap_topicPostsOf(html)) posts.push(p);
		// 不早停：两口池（角色/灵子）的公告分落两页，只取第 1 页会漏掉另一口。
		if (page < NS_TAPTAP_TOPIC_MAX_PAGES) await new Promise((r) => r());
	}
	if (posts.length === 0) throw new Error("promilia-taptap:no-post");
	return posts;
}

async function ns_pro_taptapGachaOf(url, signal, tz, now) {
	const at = ns_bwiki_nowOf(now);
	const posts = await ns_pro_taptapPostsOf(url, signal);
	const items = [];
	let i = 0;
	for (const p of posts) {
		// 卡池帖：标题本身就是公告标题（`羁点观测「绯影入怀」现已开启`）；正文首行是「亲爱的星临者，…即将开启。」
		// 这种叙述句 ⇒ 只在正文里取**池名事实那一段**（`弦定观测「桃笺为契」`），不整行当名字。
		let banner = ns_pro_poolOf(p.title) ? p.title : "";
		if (!banner) {
			for (const line of String(p.text || "").split("\n")) {
				const m = NS_PRO_POOL_TYPE_RE.exec(line);
				if (m) { banner = m[0]; break; }
			}
		}
		if (!banner) continue;
		const win = ns_pro_windowOf(p.text, at, tz);
		if (!win) continue;
		items.push({ _i: i++, banner: banner.trim(), roles: ns_pro_rolesOf(p.text), startTs: win.startTs, endTs: win.endTs, raw: win.raw, category: (ns_pro_poolOf(banner) || {}).type || "" });
	}
	if (items.length === 0) return null;
	return ns_pro_gachaPayloadOf(items, tz, at, "promilia");
}

async function ns_pro_taptapEventsOf(url, signal, tz, now) {
	const at = ns_bwiki_nowOf(now);
	const posts = await ns_pro_taptapPostsOf(url, signal);
	const items = [];
	let i = 0;
	for (const p of posts) {
		if (ns_pro_poolOf(p.title)) continue;
		// 论坛「有奖互动 / 有奖活动」是运营抽奖，不是游戏内活动 ⇒ 不收（与「网页与渠道」同口径）。
		if (/有奖互动|有獎互動|有奖活动|有獎活動|抽奖|抽獎/.test(p.title)) continue;
		const win = ns_pro_windowOf(p.text, at, tz);
		if (!win) continue;
		items.push({ _i: i++, event: p.title, startTs: win.startTs, endTs: win.endTs, raw: win.raw });
	}
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, at, 0, "promilia", { includeOpenStart: true });
}
//#endregion

//#region 条目登记
registerSource({
	id: "promilia",
	// 两侧都有源 ⇒ 出厂默认展示（与 2026-11-19 的「未配置才隐藏」口径一致）。
	defaultHidden: false,
	tz: NS_PRO_TZ,
	name: "蓝色星原：旅谣",
	// 官方日服 App Store 图标（`itunes.apple.com/lookup?id=6787982572` 实测 200，512×512）；国服官网页只有 favicon。
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/15/6c/47/156c471a-e3fc-5fba-a0be-8f640e876515/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: NS_PRO_CN_LIST_URL,
	source: "官方公告",
	altSources: [
		// 用户 2026-11-27 定名：显示名 =「星原档案室」（站名），不写域名。
		{ label: "星原档案室", url: NS_PRO_WIKI_URL, fetcher: "promilia-wiki-gacha" },
		{ label: "TapTap", url: NS_PRO_TAPTAP_URL, fetcher: "promilia-taptap-gacha" }
	],
	// 活动侧：官方公告没有游戏内活动公告（见文件头）⇒ 用户 2026-11-27 定：**删掉活动侧的官方公告**，
	// 活动 = 默认「星原档案室」（promilia.wiki）+ 备选 TapTap。
	eventUrl: NS_PRO_WIKI_URL,
	eventSource: "星原档案室",
	eventAltSources: [
		{ label: "TapTap", url: NS_PRO_TAPTAP_URL, fetcher: "promilia-taptap-event" }
	]
});

registerSource({
	id: "promilia-global",
	defaultHidden: false,
	tz: NS_PRO_TZ,
	name: "蓝色星原：旅谣 · 国际服",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/15/6c/47/156c471a-e3fc-5fba-a0be-8f640e876515/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: NS_PRO_GL_LIST_URL,
	source: "官方公告",
	eventUrl: NS_PRO_GL_LIST_URL,
	eventSource: "官方公告"
});

GACHA_FETCHERS["promilia"] = (url, signal, tz, now) => ns_pro_officialGachaOf(NS_PRO_CN_API, NS_PRO_CN_LANG, signal, tz, now);
GACHA_FETCHERS["promilia-wiki-gacha"] = (url, signal, tz, now) => ns_pro_wikiGachaOf(url || NS_PRO_WIKI_URL, signal, tz, now);
GACHA_FETCHERS["promilia-taptap-gacha"] = (url, signal, tz, now) => ns_pro_taptapGachaOf(url || NS_PRO_TAPTAP_URL, signal, tz, now);
GACHA_FETCHERS["promilia-global"] = (url, signal, tz, now) => ns_pro_officialGachaOf(NS_PRO_GL_API, NS_PRO_GL_LANG, signal, tz, now);

EVENT_FETCHERS["promilia"] = {
	default: (url, signal, tz, now) => ns_pro_wikiEventsOf(url || NS_PRO_WIKI_URL, signal, tz, now),
	"promilia-taptap-event": (url, signal, tz, now) => ns_pro_taptapEventsOf(url || NS_PRO_TAPTAP_URL, signal, tz, now)
};
EVENT_FETCHERS["promilia-global"] = {
	default: (url, signal, tz, now) => ns_pro_officialEventsOf(NS_PRO_GL_API, NS_PRO_GL_LANG, signal, tz, now)
};
//#endregion
