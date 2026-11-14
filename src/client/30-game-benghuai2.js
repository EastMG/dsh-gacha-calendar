// src/client/30-game-benghuai2.js —— 崩坏学园2 国服（bh2）：**官网公告**（卡池 + 活动两侧）
//
// ══ 源站事实（2026-11-15 实测）════════════════════════════════════════════════
// 列表：`POST https://www.benghuai.com/news/getNotice` → `{ retcode:1, msg:"获取成功", data:{…} }`
//       `data` 四个栏目：`new` / `version` / `gach` / `event`（各 60 条，**已按发布时间从新到旧**）。
//       条目形态：`{ feature:"20", id:"20104735", title:"妮娜&黛尔塔", time:"2026-11-09 00:00:00", type:"2" }`
//       `type`：1=活动 / 2=祈愿 / 3=版本 / 0=其他；`feature` 细分祈愿种类（见下 FEATURE_LABEL）。
// 详情：`GET https://www.benghuai.com/news/getNoticeByID?id=<id>` → `{ retcode:1, data:{ title, text, time, … } }`
//       `text` 是 HTML 富文本，**档期与 UP 都在里面**：
//         · 档期：`活动时间：` / `【活动时间】` / `【开启时间】` + `11月9日 00:00 ~ 11月19日 24:00`
//         · UP  ：`本期UP装备:` 列表 / `第N使魔碎片:` + 表格首列 / 梦想祈愿的「UP装备如下」分段表
//
// ══ 真实抓包：站点自己怎么发这两个请求（不是猜的）════════════════════════════════
// `https://www.benghuai.com/news` 的 `news.js`（`static-event.benghuai.com/new_mihoyo_homepage/js/news.js`）：
//   getAllNotice : `$.ajax({ type:"POST", url: base_url+"news/getNotice", dataType:"json", async:false })`
//                  ——**没有 data、没有自定义头** ⇒ 实际是「空 body 的 POST」（浏览器只带默认头）。
//   getNoticeByID: `$.ajax({ type:"POST", url: base_url+"news/getNoticeByID?id="+id, dataType:"json" })`
//                  ——同样是空 body POST；`id` 在 **query**，不在 body。
// 实测（2026-11-15，curl/Invoke-WebRequest 复现）：
//   · 列表：GET / 空 body POST / `{}` body POST **都回 200 与同一份 31,206 B JSON**（服务端不看方法/body）
//   · 详情：GET 200（2,968 B），`id` 必须是 query 参数
// ⇒ 本文件按任务书用 **POST 列表 + GET 详情**；但宿主代理只在 body 非空时才发 POST
//   （`src/index.js` 的 `method = body !== "" ? "POST" : "GET"`），空 body 会被降级成 GET。
//   所以列表请求送 **body `{}`**（源站忽略 body，实测与空 body 同响应），Content-Type 用宿主默认的
//   `application/json; charset=utf-8`；这既保住了 POST 契约，又不需要新增"空 body POST"通道。
//   ⚠️ 别把 body 改成 `""`：那会被宿主降级成 GET；也别去掉 body —— 两者都会让"真 POST"静默消失。
//
// ══ 请求数 ═════════════════════════════════════════════════════════════════════
//   列表 1 次（**两侧共享**：同一轮刷新内用按轮次的 promise 缓存，见 `ns_bh2_listJsonOf`）
//   + 每条候选详情 1 次（每侧最多取 `ns_bh2_MAX_DETAILS` 条；列表按发布时间倒序，
//     当期池可能不是最新那条：2026-11-15 实测「少女的心愿」是第 4 条、仍开着）
//   ⇒ 单侧稳态 2 次（列表 + 1 条详情）；两侧一轮 = 1 + 6 + 6 = 13 次（当期在最前面时会少一些）。
//
// ══ 口径 ═══════════════════════════════════════════════════════════════════════
//   · tz = Asia/Shanghai（源站是国服官网，`time` 是 UTC+8 墙钟）
//   · 源站日期**不带年份**（`11月9日`）⇒ 借公告发布时间的年份补（共用 `inferYear`）；
//     ⚠️ `inferYear` 只覆盖"往回退一年"（`mo > hint.mo + 6`），「公告 12 月发、档期在 1 月」这个
//     **往前进一年**的方向由本文件先判（见 `ns_bh2_windowOf` 里 `hint && sm + YEAR_HINT_MONTH_GAP < hint.mo`）；
//     结束月日早于开始 ⇒ 次年（共用 `endsNextYear`）
//   · `24:00` 按次日 00:00 算（`sourceInstant` 的 Date.UTC 天然进位；`raw` 仍留源站原文）
//   · 只有日期没有时分 ⇒ 起 00:00 / 止 23:59（仓库通用约定）
//   · 外显 = 覆盖 now 的池里**结束最早**的那口；活动外显走共用 `pickEventPrimary`
//   · 悬停/数组一律由 `hoverTextFromItems` + `dataArrayProducedGachaOf` / `dataArrayProducedEventsOf`
//     生成（不新造字段、不手拼字符串）
//
// ══ 失败语义 ═══════════════════════════════════════════════════════════════════
//   · 列表结构变了（没有 `data` / 四个栏目一条都取不到）⇒ 抛错（不是 nomatch）
//   · 详情全抓失败 ⇒ 抛第一个错；详情抓到但一条档期都解不出（正文改版）⇒ 抛 `bh2:no-window`
//   · 结构正常、但没有任何一条覆盖 now ⇒ `null`（未公布；过期档期不冒充当期）
//   · 没有档期段的公告（周边/问卷/礼包上架…）逐条跳过，不算失败
const ns_bh2_TZ = "Asia/Shanghai";
const ns_bh2_LIST_URL = "https://www.benghuai.com/news/getNotice";
const ns_bh2_DETAIL_URL = "https://www.benghuai.com/news/getNoticeByID?id=";
const ns_bh2_REFERER = "https://www.benghuai.com/news";
// 每侧取多少条详情：当期可能排在第 4 条（2026-11-15 实测），6 条覆盖约两周的公告量。
const ns_bh2_MAX_DETAILS = 6;
// `feature` → 祈愿种类（站点 JS 的同一张映射：18 公主 / 19 魔女 / 20 使魔 / 21 魔法少女 / 22 梦想）
const ns_bh2_FEATURE_LABEL = {
	18: "公主祈愿", 19: "魔女祈愿", 20: "使魔祈愿", 21: "魔法少女祈愿", 22: "梦想祈愿"
};

// HTML → 逐行纯文本（**每个表格单元格/段落一行**：使魔碎片表的首列、UP 列表都靠行边界切）
function ns_bh2_linesOf(html) {
	const raw = String(html == null ? "" : html)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|section|table|tbody|ul|ol)\s*>/gi, "\n")
		.replace(/<[^>]*>/g, "");
	return decodeExtra(raw)
		.replace(/\u00a0/g, " ")
		.split(/\r?\n/)
		.map((l) => l.replace(/[ \t]+/g, " ").trim())
		.filter(Boolean);
}
// 列表 JSON → `{ gach, event }`（各自按发布时间从新到旧）。结构不对就抛。
function ns_bh2_listOf(json) {
	const data = json && json.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bh2:bad-list");
	const rowOf = (v) => {
		if (!v || typeof v !== "object") return null;
		const id = v.id == null ? "" : String(v.id).trim();
		const title = String(v.title == null ? "" : v.title).replace(/\s+/g, " ").trim();
		const published = String(v.time == null ? "" : v.time).trim();
		if (!id || !title) return null;
		const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(published);
		return {
			id, title, published,
			feature: Number(v.feature) || 0,
			hint: m ? { y: +m[1], mo: +m[2] } : null
		};
	};
	const pick = (arr) => (Array.isArray(arr) ? arr.map(rowOf).filter(Boolean) : []);
	const gach = pick(data.gach);
	const event = pick(data.event);
	if (gach.length === 0 && event.length === 0) throw new Error("bh2:empty-list");
	const byNew = (a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0);
	return { gach: gach.sort(byNew), event: event.sort(byNew) };
}
// 详情 JSON → `{ title, text, feature }`。正文缺失 = 结构性损坏（这一条算抓取失败，由调用方决定是否跳过）。
function ns_bh2_detailOf(json) {
	const data = json && json.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bh2:bad-detail");
	const text = typeof data.text === "string" ? data.text : "";
	if (!text.trim()) throw new Error("bh2:no-text");
	return {
		title: decodeExtra(String(data.title == null ? "" : data.title)).replace(/\s+/g, " ").trim(),
		text,
		feature: Number(data.feature) || 0
	};
}
// 正文 → 档期。标签必须是「活动时间 / 开启时间 / 活动日期 / 活动期限」之一（`售卖时间`、`问卷填写时间`
// 明确**不认**：那是礼包/问卷，不是活动档期）。
const NS_BH2_WINDOW_RE = new RegExp(
	"(?:活动时间|开启时间|活动日期|活动期限)[^0-9]{0,6}"
	+ "(\\d{1,2})月(\\d{1,2})日\\s*(?:(\\d{1,2}):(\\d{2}))?\\s*"
	+ "[~～\\-–—至到]\\s*"
	+ "(\\d{1,2})月(\\d{1,2})日\\s*(\\d{1,2}):(\\d{2})"
);
function ns_bh2_windowOf(text, hint, tz) {
	const m = NS_BH2_WINDOW_RE.exec(String(text == null ? "" : text));
	if (!m) return null;
	const sm = +m[1], sd = +m[2];
	const sh = m[3] == null ? 0 : +m[3];
	const si = m[4] == null ? 0 : +m[4];
	const em = +m[5], ed = +m[6], eh = +m[7], ei = +m[8];
	// 年份：`inferYear` **只覆盖"往回退一年"**（`mo > hint.mo + 6` ⇒ 上一年），
	// 而「公告 12 月发、档期落在 1 月」需要**往前进一年** —— 它没管这个方向。
	// 实测（2026-11-15，用本函数自己的导出跑）：hint={y:2025,mo:12} + `活动时间：1月1日 00:00 ~ 1月10日 24:00`
	// 旧代码给 **2025-01-01 ~ 2025-01-11**（错一年 ⇒ 整条被判"已结束"、元旦活动不显示）。
	// 这里按同一条 6 个月的界先判"次年"，其余仍交给 `inferYear`（跨年 12→1 由 `endsNextYear` 管，是另一件事）。
	const sy = (hint && sm + YEAR_HINT_MONTH_GAP < hint.mo)
		? hint.y + 1
		: inferYear(null, sm, hint);                            // 没有发布时间的线索 ⇒ null（不猜年份）
	if (sy == null) return null;
	const ey = endsNextYear(sm, sd, em, ed) ? sy + 1 : sy;
	const startTs = sourceInstant(sy, sm, sd, sh, si, tz);
	const endTs = sourceInstant(ey, em, ed, eh, ei, tz);
	if (!(endTs > startTs)) return null;
	const raw = m[0].replace(/^[^0-9]*/, "").replace(/\s+/g, " ").trim();
	return { startTs, endTs, raw, display: fmtWindow(startTs, endTs, tz) };
}
// UP 名单（源站三种写法，逐条见文件头）：
//   ① 使魔祈愿：`第N使魔碎片:` 之后紧跟的**表格首列**（= 碎片/使魔名）
//   ② 梦想祈愿：`UP装备如下：` + 分段表；取**覆盖 now 的那一段**（不覆盖 → 全部分段，去重）
//   ③ 其余（公主/魔女）：`本期UP装备[:：]` 之后、停止标记之前的名字行
const NS_BH2_UP_STOP_RE = /^(活动时间|活动期间|活动规则|活动奖励|活动说明|其他可能获得|UP装备如下|本期魔女)/;
const NS_BH2_SEG_RE = /^(\d{1,2})月(\d{1,2})日(\d{1,2}):(\d{2})[~～](\d{1,2})月(\d{1,2})日(\d{1,2}):(\d{2})$/;
function ns_bh2_upRolesOf(lines, win, now, tz) {
	const isName = (s) => s.length >= 2 && s.length <= 24
		&& !/^[>*·•\-–—\s]+$/.test(s) && !/^集齐\d+颗/.test(s) && !/^\d+$/.test(s)
		&& !/[:：]$/.test(s);                                  // 行尾冒号 = 说明标签（`Tips：` / `开放时间：`）
	const dedup = (arr) => [...new Set(arr)];
	// ① 使魔
	if (lines.some((l) => /^第[一二三四五六七八九十]+使魔碎片/.test(l))) {
		const out = [];
		for (let i = 0; i < lines.length; i++) {
			if (!/^第[一二三四五六七八九十]+使魔碎片/.test(lines[i])) continue;
			for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
				if (isName(lines[j])) { out.push(lines[j]); break; }
			}
		}
		return dedup(out).join("、");
	}
	// ② 梦想（分段表）
	// ⚠️ 标记**不能锚在行首**：源站把「…可以选择当前主题的任意六个装备来进行祈愿哦！UP装备如下：」
	//    写在同一段里（`<p>` 一行）⇒ 用 `test` 而不是 `^` 锚定；取它**之后**的行开始切分段。
	const di = lines.findIndex((l) => /UP装备如下/.test(l));
	if (di >= 0) {
		const hint = sourceWallParts(win.startTs, tz);
		const segs = [];
		let cur = null;
		for (let i = di + 1; i < lines.length; i++) {
			const l = lines[i];
			if (NS_BH2_UP_STOP_RE.test(l)) break;
			const sm = NS_BH2_SEG_RE.exec(l);
			if (sm) {
				const segWin = ns_bh2_windowOf(`活动时间 ${l}`, hint, tz);
				cur = { win: segWin, names: [] };
				segs.push(cur);
				continue;
			}
			if (/^(开放时间|UP装备)$/.test(l)) continue;
			if (cur && isName(l)) cur.names.push(l);
		}
		if (segs.length > 0) {
			// 只认**覆盖 now 的那一段**：分段表就是"每几天换一批 UP"，拼全部分段等于把整期的装备
			// 都印到当期那一行上。不覆盖任何分段（源站有缺口 / now 在池外）⇒ 空串（不猜是哪批）。
			const hit = segs.find((s) => s.win && coversNow(s.win, now));
			return hit ? dedup(hit.names).join("、") : "";
		}
	}
	// ③ 本期UP装备（公主 / 魔女）
	const ui = lines.findIndex((l) => /本期UP装备/.test(l));
	if (ui >= 0) {
		const out = [];
		for (let i = ui + 1; i < lines.length; i++) {
			const l = lines[i];
			if (NS_BH2_UP_STOP_RE.test(l)) break;
			if (/^自选UP组合装备[①-⑩]/.test(l)) continue;
			if (isName(l)) out.push(l);
		}
		return dedup(out).join("、");
	}
	return "";
}
// 一条公告 → 条目事实（卡池侧填 `banner` / `roles`；活动侧填 `name`）
function ns_bh2_itemOf(detail, row, kind, tz, now) {
	const lines = ns_bh2_linesOf(detail.text);
	const win = ns_bh2_windowOf(lines.join("\n"), row.hint, tz);
	if (!win) return null;                                      // 这条公告没有档期段（礼包/问卷/周边）
	const title = detail.title || row.title;
	if (kind === "gach") {
		const feature = detail.feature || row.feature;
		return {
			_i: 0,
			banner: title,
			roles: ns_bh2_upRolesOf(lines, win, now, tz),
			category: ns_bh2_FEATURE_LABEL[feature] || "祈愿",
			...win,
			isMain: true
		};
	}
	return { _i: 0, name: title, ...win };
}
// 卡池载荷：外显 = 结束最早的在期池；悬停/数组 = **全部在期池**（每池自己那行「池名：UP」）。
// 不复用 `ns_bwiki_batchGachaPayloadOf` 的「同批合并角色」：崩坏学园2 同期可开 2~3 口**不同种类**的
// 祈愿（公主/使魔），合并会把 20+ 个 UP 名拼到一口池上，看不出是哪一批。
function ns_bh2_gachaPayloadOf(items, tz, now) {
	const active = (Array.isArray(items) ? items : []).filter((it) => coversNow(it, now));
	if (active.length === 0) return null;
	const first = active.slice().sort((a, b) => (a.endTs - b.endTs) || ((a._i || 0) - (b._i || 0)))[0];
	const hoverItems = active.slice().sort(poolHoverOrderOf).map((it) => {
		const label = `${it.banner}${it.roles ? `\uFF1A${it.roles}` : ""}`;
		return { title: label, label, startTs: it.startTs, endTs: it.endTs, raw: it.raw };
	});
	const hover = hoverTextFromItems(hoverItems, "gacha", tz);
	// 类别事实按标题贴（`dataArrayAttachFactsOf` 的通道）：主条标题 = 池名，并列条标题 = `池名：UP`
	const facts = {};
	for (const it of active) {
		if (!it.category) continue;
		facts[it.banner] = { category: it.category };
		if (it.roles) facts[`${it.banner}\uFF1A${it.roles}`] = { category: it.category };
	}
	const out = {
		banner: first.banner,
		roles: first.roles || "",
		bannerDates: first.display,
		bannerDatesRaw: first.raw || "",
		startTs: first.startTs,
		endTs: first.endTs
	};
	if (hover) out.bannerHover = hover;
	if (Object.keys(facts).length) out.itemFacts = facts;
	out.gacha = dataArrayProducedGachaOf(out, hoverItems, { id: "bh2", tz }, now);
	out.gachaHoverItems = hoverItems;
	return out;
}
// 活动载荷：外显走 `pickEventPrimary`（档位 → 结束最早），悬停/数组 = 全部在期活动（`sortEventItems` 同序）
function ns_bh2_eventPayloadOf(items, tz, now) {
	const active = sortEventItems((Array.isArray(items) ? items : []).filter((it) => coversNow(it, now)));
	if (active.length === 0) return null;
	const primary = pickEventPrimary(active) || active[0];
	const hoverItems = active.map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
	const hover = hoverTextFromItems(hoverItems, "event", tz);
	const out = {
		event: primary.name,
		eventDates: primary.display,
		eventDatesRaw: primary.raw,
		...(hover ? { eventHover: hover } : {})
	};
	out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "bh2", tz }, now);
	out.eventHoverItems = hoverItems;
	return out;
}
// ── 列表的**轮内**共享（卡池 + 活动两侧同一条 URL，只该发一次）────────────────────
// 用法与 30-game-cygames.js 的 GameTora manifest 同一套：按 `fetchRoundSeqOf()` 判定"同一轮"，
// 轮外（设置页「测试来源」/离线用例直调抓取器）**不缓存**（跨轮复用会拿到过期公告）。
let ns_bh2_listRoundSeq = -1;
let ns_bh2_listPromise = null;
function ns_bh2_listJsonOf(signal) {
	const seq = fetchRoundSeqOf();
	if (fetchRoundActive() && seq === ns_bh2_listRoundSeq && ns_bh2_listPromise) return ns_bh2_listPromise;
	const p = fetchJson(ns_bh2_LIST_URL, {
		referer: ns_bh2_REFERER,
		signal,
		mode: "proxy",
		body: {}                         // 见文件头：body 非空才会真的发 POST；`{}` 与源站空 body 等价
	});
	if (!fetchRoundActive()) return p;
	ns_bh2_listRoundSeq = seq;
	ns_bh2_listPromise = p;
	p.catch(() => {                     // 失败不入缓存（下一次刷新要重试，别把错误钉死一整轮之后）
		if (ns_bh2_listPromise === p) { ns_bh2_listPromise = null; ns_bh2_listRoundSeq = -1; }
	});
	return p;
}
// 一侧的抓取器：列表 → 前 N 条详情 → 条目事实（`gach` / `event`）
async function ns_bh2_sideOf(key, signal, tz, now) {
	const list = ns_bh2_listOf(await ns_bh2_listJsonOf(signal));
	const rows = list[key];
	if (rows.length === 0) return null;                          // 该栏目一条都没有 ⇒ 未公布
	const items = [];
	let ok = 0, firstErr = null;
	for (const row of rows.slice(0, ns_bh2_MAX_DETAILS)) {
		let detail;
		try {
			detail = ns_bh2_detailOf(await fetchJson(ns_bh2_DETAIL_URL + encodeURIComponent(row.id), {
				referer: ns_bh2_REFERER, signal, mode: "proxy"
			}));
		} catch (e) {
			if (!firstErr) firstErr = e;                          // 单条失败 ⇒ 跳过，其余照用
			continue;
		}
		ok++;
		const item = ns_bh2_itemOf(detail, row, key === "gach" ? "gach" : "event", tz, now);
		if (!item) continue;
		item._i = items.length;
		items.push(item);
	}
	if (ok === 0) throw firstErr || new Error("bh2:no-detail");
	if (items.length === 0) throw new Error("bh2:no-window");     // 正文改版 = 结构性损坏
	return items;
}
async function ns_bh2_gacha(url, signal, tz = ns_bh2_TZ, now = nowMs()) {
	const at = ns_bwiki_nowOf(now);
	return ns_bh2_gachaPayloadOf(await ns_bh2_sideOf("gach", signal, tz, at), tz, at);
}
async function ns_bh2_events(url, signal, tz = ns_bh2_TZ, now = nowMs()) {
	const at = ns_bwiki_nowOf(now);
	return ns_bh2_eventPayloadOf(await ns_bh2_sideOf("event", signal, tz, at), tz, at);
}

// ── 注册 ───────────────────────────────────────────────────────────────────────
// 两侧同一条来源（官网公告列表）：标签按任务书提议「官网公告」（等用户复核）。
registerSource({
	id: "bh2",
	defaultHidden: false,
	tz: "Asia/Shanghai",
	name: "崩坏学园2",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/3e/98/27/3e98278c-da90-7fad-e045-97098507c98d/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: ns_bh2_LIST_URL,
	source: "官网公告",
	eventUrl: ns_bh2_LIST_URL,
	eventSource: "官网公告"
});
GACHA_FETCHERS["bh2"] = (url, signal, tz, now) => ns_bh2_gacha(url, signal, tz, now);
EVENT_FETCHERS["bh2"] = Object.assign(EVENT_FETCHERS["bh2"] || {}, {
	default: (url, signal, tz, now) => ns_bh2_events(url, signal, tz, now)
});
