// src/client/35-parsers-stellasora.js
//
// 由 next-sources/parsers/stellasora.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_stellasora__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-stellasora.js —— 星塔旅人 国服（悠星官方 CMS API）
//
// 来源（2026-10-02 实测「已验证可达」）：
//   类型目录  GET /api/resource/news-type
//   列表      GET /api/resource/news?index=1&size=N&type=<latest|notice|news|activity>
//   详情      GET /api/resource/news/<id>
//   同源反代 —— bundle 原文：`const Ye="/"; function j(s){return x({url:`${Ye}api/${s}`})}`
//   （⚠️ 真实 host 是**官网同源**，不是独立 API 域名；我先前试 `*.yostar.net` 等全 DNS 不可达）
//
// 可抓取性：服务端裸 GET，**无 token / 无签名**；响应 **无 ACAO** → 必须 mode:"proxy"
//
// 时区：Asia/Shanghai
//   · publishTime 是 epoch ms，直接是绝对时刻，无需换算
//   · 正文档期是**国服墙钟**（如 `2026/10/01 04:00 ~ 2026/10/31 03:59`，04:00 日切 = 国服特征）
//   · ⚠️ 源站**未显式标注时区** → 标「推测」
//     ⚠️ 「时区是推测」这类实现说明**只留在代码注释里**，**绝不进悬停文本**
//        （用户 2026-10-03：悬停里的元信息——来源站名/URL/时区推定/抓取条数/内部 id/实现说明——彻底删掉）。
//
// ── 列表里哪个分类装什么（实测）──────────────────────────────
//   type=notice   (349 条)  ← **卡池 + 活动说明**都在这里，本解析器主用
//   type=latest   (366 条)  同上 + 新闻
//   type=activity (15 条)   基本是**线下/周边**（BW 展会、联动、周边上新）→ 不作为游戏内活动
//   type=news     (2 条)    首曝/定档类新闻
//
// ── 详情正文的档期形态（实测）────────────────────────────────
//   `▌招募时间<br>2026/09/29 维护结束后 ~ 2026/10/20 10:59<br>`
//   `▌开放时间<br>2026/09/01 04:00 ~ 2026/10/01 03:59<br>`
//   `▌售卖时间<br>2026/10/01 04:00 ~ 2026/10/31 03:59<br>`
//   ⇒ 统一形态：`▌<环节>时间<br> <起点> ~ <终点>`；起点可能是「维护结束后」（相对锚点）
//
//   ⚠️ 起点是「维护结束后」时**没有绝对时刻**：用该公告的 publishTime 当锚点，
//      并标 `startInferred: true`。绝不硬造一个假时刻。

const ns_stellasora_STELLA_BASE = "https://stellasora.yostar.cn";
const ns_stellasora_STELLA_TZ = "Asia/Shanghai";   // 推测：源站未标注，但 04:00 日切与国服一致

function ns_stellasora_stellaListUrl(type = "notice", size = 20, index = 1) {
	return `${ns_stellasora_STELLA_BASE}/api/resource/news?index=${index}&size=${size}&type=${type}`;
}
function ns_stellasora_stellaDetailUrl(id) {
	return `${ns_stellasora_STELLA_BASE}/api/resource/news/${id}`;
}

// ── 正文 → 纯文本（保留 `<br>` 换行；档期是 `<br>` 分隔的，不能直接压成空格）──
function ns_stellasora_brText(html) {
	let t = String(html == null ? "" : html);
	t = t.replace(/<br\s*\/?>/gi, "\n");
	t = t.replace(/<\/(?:p|div|li|tr|h\d)>/gi, "\n");
	t = t.replace(/<[^>]+>/g, "");
	t = decodeEntities(t);
	t = t.replace(/[ \t\u00a0\u3000]+/g, " ");
	return t.trim();
}

// ── 日期令牌子 ──
// `2026/09/29 09:00` / `2026-09-29 09:00` / `09/29 09:00`（省年份，用锚点年）
const ns_stellasora_YMD_RE = /(?:(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2}))(?:\s*(\d{1,2}):(\d{2}))?/;
const ns_stellasora_MD_RE = /(?<!\d)(\d{1,2})[\/\-.](\d{1,2})(?:\s*(\d{1,2}):(\d{2}))?/;
const ns_stellasora_REL_START_RE = /维护结束后|维护后|更新结束后|更新后/;

// ⚠️ 必须先"挖掉"已匹配的完整年月日，再找省略年份的月日。
//    否则 `2026/09/29 维护结束后` 里的 `09/29` 会被 ns_stellasora_MD_RE 当成"省年份的月日"匹配到，
//    于是走错分支、把「维护结束后」的相对锚点丢掉（本仓库实测踩过这个坑）。
function ns_stellasora_maskYmd(s) {
	return s.replace(new RegExp(ns_stellasora_YMD_RE.source, "g"), (m) => "\u0000".repeat(m.length));
}

// 从一段文本解析一个「起点 ~ 终点」区间。返回 { startTs, endTs, raw, startInferred } 或 null
function ns_stellasora_parseStellaWindow(segText, tz = ns_stellasora_STELLA_TZ, anchorTs = null) {
	const s = String(segText == null ? "" : segText).replace(/\s*\n\s*/g, " ").trim();
	if (!s) return null;
	// 先看有没有显式区间分隔符
	const sepMatch = /[~～〜－—–]/.exec(s);
	const anchorParts = anchorTs != null ? sourceWallParts(anchorTs, tz) : null;

	// ① 起点：相对锚点（「维护结束后」）优先于裸日期 → 绝对日期（完整年月日） → 绝对日期（省年份）
	//
	// ⚠️ 顺序很重要：源站写的是 `2026/09/29 维护结束后 ~ 2026/10/20 10:59` —— **日期与「维护结束后」同时出现**。
	//    若让 ns_stellasora_YMD_RE 先命中，起点会变成 `09-29 00:00`（那天零点），但真实开局是**维护结束**那一刻。
	//    故「维护结束后」优先，用公告发布时刻当锚点并标 startInferred
	//    （与仓库既有惯例一致：FGO 的 `即日起` / 绝区零的 `4.6版本更新后` 起点都标 inferred 并写进 raw）。
	//    未出现该词时，`2026/10/01 04:00` 这类显式起点照常按原样解析。
	//    ⚠️ 2026-10-03：`startInferred` **只作内部标记**（供 raw / 调试用），**不再写进悬停** ——
	//       旧悬停里的「（起点按公告发布时刻推断）」是**实现说明**，用户要求元信息彻底删掉。
	let startTs = null, startInferred = false, startRaw = "";
	const relMatch = ns_stellasora_REL_START_RE.exec(s);
	const head = sepMatch ? s.slice(0, sepMatch.index) : s;
	const ymd1 = ns_stellasora_YMD_RE.exec(head);
	const md1 = !ymd1 ? ns_stellasora_MD_RE.exec(ns_stellasora_maskYmd(head)) : null;

	if (relMatch && anchorTs != null) {
		// 「维护结束后」：用公告发布时刻当锚点，并标记为推断值
		startTs = anchorTs;
		startInferred = true;
		startRaw = relMatch[0];
	} else if (ymd1) {
		startTs = sourceInstant(+ymd1[1], +ymd1[2], +ymd1[3], ymd1[4] != null ? +ymd1[4] : 0, ymd1[5] != null ? +ymd1[5] : 0, tz);
		startRaw = ymd1[0];
	} else if (md1 && anchorParts) {
		startTs = sourceInstant(anchorParts.y, +md1[1], +md1[2], md1[3] != null ? +md1[3] : 0, md1[4] != null ? +md1[4] : 0, tz);
		startRaw = md1[0];
	} else if (relMatch) {
		// 「维护结束后」但**没有锚点** → 无法定位绝对时刻 → 交给下面的 null 分支（不硬造）
		startTs = null;
	}

	// ② 终点（必须在分隔符之后）
	let endTs = null, endRaw = "";
	if (sepMatch) {
		const tail = s.slice(sepMatch.index + sepMatch[0].length);
		const ymd2 = ns_stellasora_YMD_RE.exec(tail);
		const md2 = !ymd2 ? ns_stellasora_MD_RE.exec(ns_stellasora_maskYmd(tail)) : null;
		if (ymd2) {
			endTs = sourceInstant(+ymd2[1], +ymd2[2], +ymd2[3], ymd2[4] != null ? +ymd2[4] : 23, ymd2[5] != null ? +ymd2[5] : 59, tz);
			endRaw = ymd2[0];
		} else if (md2) {
			// 省年份：月份比起点小（或同月日更小）→ 跨年
			let y = anchorParts ? anchorParts.y : null;
			const sParts = startTs != null ? sourceWallParts(startTs, tz) : null;
			if (sParts) {
				y = sParts.y;
				if (+md2[1] < sParts.mo || (+md2[1] === sParts.mo && +md2[2] < sParts.d)) y = sParts.y + 1;
			}
			if (y != null) {
				endTs = sourceInstant(y, +md2[1], +md2[2], md2[3] != null ? +md2[3] : 23, md2[4] != null ? +md2[4] : 59, tz);
				endRaw = md2[0];
			}
		}
	}

	if (startTs == null || endTs == null) return null;
	if (!(endTs > startTs)) return null;
	return { startTs, endTs, raw: s, startInferred };
}

// ── 正文 → 全部带标签的档期 ──
// 返回 [{ label, startTs, endTs, raw, startInferred }]，按出现顺序
function ns_stellasora_parseStellaWindows(html, tz = ns_stellasora_STELLA_TZ, anchorTs = null) {
	const text = ns_stellasora_brText(html);
	const out = [];
	// `▌<标签>时间` 后面紧跟一段（到下一个 ▌ 或结尾）
	const marks = [...text.matchAll(/▌\s*([^\n]{0,20}?时间)\s*\n?([^\n]*)/g)];
	for (const m of marks) {
		const label = m[1].replace(/\s+/g, "");
		const seg = (m[2] || "").trim();
		const w = ns_stellasora_parseStellaWindow(seg, tz, anchorTs);
		if (w) out.push({ label, ...w });
	}
	// 兜底：正文里存在「A ~ B」但没有 ▌标签
	if (out.length === 0) {
		for (const line of text.split("\n")) {
			const w = ns_stellasora_parseStellaWindow(line, tz, anchorTs);
			if (w) out.push({ label: "", ...w });
		}
	}
	return out;
}

// ── 分类：招募（卡池） / 活动 ──
// 实测标题形态：
//   卡池  「空白的稚梦」限时招募开启 / 「沐于温情笑意中」限时招募开启
//   活动  「猎影合围Beta」活动说明 / 「月华窃梦人」活动说明 / 「联合讨伐」活动说明
//   排除  维护更新说明 / 版本内容一览 / 版本活动一览 / 概率公示
function ns_stellasora_stellaIsGacha(title) {
	return /招募/.test(String(title || ""));
}
function ns_stellasora_stellaIsEvent(title) {
	const t = String(title || "");
	if (ns_stellasora_stellaIsGacha(t)) return false;
	if (/维护|更新说明|版本内容|版本活动一览|概率公示|封禁|处罚|问卷/.test(t)) return false;
	return /活动说明|活动开启|活动一览|活动预告/.test(t) || /活动/.test(t);
}
// 卡池标题 → 干净的卡池名：去掉「限时招募开启」等尾巴
function ns_stellasora_stellaGachaName(title) {
	return String(title || "").replace(/(限时|限定)?招募(开启|说明|一览)?[！!。.]?$/, "").trim() || String(title || "").trim();
}

// 卡池正文 → 该池的 UP 角色/秘纹名（悬停里「池名：角色」的右半边）。
// 实测形态（详情首段，**招募说明**里紧跟其后）：
//   「…全新5星旅人「艾蕾」招募概率提升！」          → 艾蕾
//   「…全新5星秘纹「睡前童话」招募概率提升！」      → 睡前童话
// 只取**首个**匹配（4 星行一定写在 5 星行之后，如「活动期间，4星旅人「师渺」「璟麟」…」）；
// 抓不到就返回 ""，悬停行退回只写池名 —— 与本体 `label = banner + (roles ? "：" + roles : "")` 同构，
// **绝不臆造**一个角色名。
const ns_stellasora_STELLA_NEW_FIVE_STAR_RE = /全新\s*5\s*星[^「」]{0,8}「([^「」]{1,24})」/;
const ns_stellasora_STELLA_FIVE_STAR_RE = /5\s*星[^「」]{0,8}「([^「」]{1,24})」/;
function ns_stellasora_stellaFeaturedName(html) {
	const t = ns_stellasora_brText(html);
	const m = ns_stellasora_STELLA_NEW_FIVE_STAR_RE.exec(t) || ns_stellasora_STELLA_FIVE_STAR_RE.exec(t);
	return m ? m[1].trim() : "";
}

// ── 列表解析 ──
function ns_stellasora_parseStellaList(json) {
	if (!json || json.code !== 0 || !json.data || !Array.isArray(json.data.rows)) throw new Error("stella-bad-json");
	return json.data.rows
		.filter((x) => x && x.id != null)
		.map((x) => ({
			id: x.id,
			title: decodeEntities(String(x.title || "")).trim(),
			publishTs: typeof x.publishTime === "number" ? x.publishTime : null,
			type: x.type || "",
			typeLabel: x.typeLabel || "",
			url: x.link || ""
		}))
		.sort((a, b) => (b.publishTs || 0) - (a.publishTs || 0));
}

// ── 抓详情并按标题分流，选出「覆盖 now」的条目 ──
// side: "gacha" | "event"
// 返回 { entry, win, candidates } 或 null
async function ns_stellasora_collectStellaSide(url, signal, tz, now, side) {
	const listUrl = url || ns_stellasora_stellaListUrl("notice");
	const list = ns_stellasora_parseStellaList(await fetchJson(listUrl, { signal, mode: "proxy" }));
	const want = side === "gacha" ? ns_stellasora_stellaIsGacha : ns_stellasora_stellaIsEvent;
	const candidates = [];
	// 列表按时间倒序；只扫前若干条，每篇抓一次详情
	for (const row of list.slice(0, 20)) {
		if (!want(row.title)) continue;
		let detail = null;
		try {
			const dj = await fetchJson(ns_stellasora_stellaDetailUrl(row.id), { signal, mode: "proxy" });
			detail = dj && dj.code === 0 && dj.data && dj.data.news ? dj.data.news : null;
		} catch { continue; }   // 单篇失败不拖垮整体
		if (!detail) continue;
		const anchorTs = row.publishTs != null ? row.publishTs : null;
		const wins = ns_stellasora_parseStellaWindows(detail.content, tz, anchorTs);
		// featured：该篇正文里的 UP 主推（卡池悬停「池名：角色」用；活动侧不用）
		const featured = ns_stellasora_stellaFeaturedName(detail.content);
		for (const w of wins) candidates.push({ row, win: w, featured });
	}
	if (candidates.length === 0) return null;
	// 覆盖 now 的里，取「起点最新」的那条（并列时取终点更晚的）
	const covering = candidates.filter((c) => c.win.startTs <= now && c.win.endTs >= now);
	if (covering.length === 0) return null;
	covering.sort((a, b) => (b.win.startTs - a.win.startTs) || (b.win.endTs - a.win.endTs) || (b.row.id - a.row.id));
	return { picked: covering[0], covering };
}

// ── 悬停 ──────────────────────────────────────────────────────────
// 一律走 `lib/env.js` 的 hoverPool / hoverEvent（与本体 buildPoolHover / buildEventHover **逐字同格式**）。
//
// 为什么不再自己拼字符串（2026-10-03 修，用户点名「新增游戏的悬停样式/格式/规则和原来的差别很大」）：
//   ① 旧实现把**元信息/实现说明**塞进了悬停 —— 主要是行尾的「（起点按公告发布时刻推断）」，
//      那本是 `startInferred` 的**实现说明**。本体条目**从不**在悬停里写这些 →
//      **直接删掉，且不改放到别的字段**；说明只留在本文件注释里（见 ns_stellasora_parseStellaWindow 与下方 ③）。
//   ② 旧实现是「档期在前、名称在后」；本体一律 `名称 + 3 空格 + 档期` → 交回 hoverEvent 排版。
//   ③ `startInferred` 的**判定逻辑原样保留**（「维护结束后」→ 用该公告 publishTime 当锚点，
//      不硬造时刻）；变的只是"不再把它写成悬停文案"。
//
// 卡池池项：`{ name, label, startTs, endTs, raw }`。
//   name  = 池名（与面板外显 `banner` 同一个字符串）
//   label = 「池名：角色」（角色抓不到就 = 池名）—— 与本体 `label = banner + (roles ? "：" + roles : "")` 同构
function ns_stellasora_stellaPoolItems(covering) {
	return covering.map((c) => {
		const name = ns_stellasora_stellaGachaName(c.row.title);
		return {
			name,
			label: c.featured ? `${name}：${c.featured}` : name,
			startTs: c.win.startTs,
			endTs: c.win.endTs,
			raw: c.win.raw
		};
	});
}

// 活动项：`{ name, startTs, endTs, raw }`。**排序由调用方负责**（hoverEvent 不排序），
// 这里照本体 sortEventItems 同序：结束时间升序（越快结束越靠前），同结束时间再按开始时间升序。
function ns_stellasora_stellaEventItems(covering) {
	return covering
		.map((c) => ({ name: c.row.title, startTs: c.win.startTs, endTs: c.win.endTs, raw: c.win.raw }))
		.sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs));
}

// ── 卡池侧 ──
async function ns_stellasora_gachaStellasora(url, signal, tz = ns_stellasora_STELLA_TZ, now = Date.now()) {
	const got = await ns_stellasora_collectStellaSide(url, signal, tz, now, "gacha");
	if (!got) return null;
	const { picked, covering } = got;
	// ⚠️ 卡池列的悬停字段是 **bannerHover**（面板 `title: g.bannerHover || gachaTitle`；
	//    50-refresh 的 `pickFields(g.data, GACHA_FIELDS)` 也只留 bannerHover）——
	//    旧实现写的是 `eventHover`，运行时被丢弃 = 卡池悬停**根本没生效**。
	const hover = hoverPool(ns_stellasora_stellaPoolItems(covering), tz);
	const out = {
		banner: ns_stellasora_stellaGachaName(picked.row.title),
		bannerDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		bannerDatesRaw: picked.win.raw,
		startTs: picked.win.startTs,
		endTs: picked.win.endTs,
		event: "",
		eventDates: ""
	};
	// hoverPool 在「当期池 < 2」时返回 ""：此时**不设** bannerHover，交回 UI 的默认两行式
	// 「池名：角色」⏎「档期」—— 不要自己再补一行，那正是与本体不一致的来源。
	if (hover) out.bannerHover = hover;
	return out;
}

// ── 活动侧 ──
async function ns_stellasora_eventsStellasora(url, signal, tz = ns_stellasora_STELLA_TZ, now = Date.now()) {
	const got = await ns_stellasora_collectStellaSide(url, signal, tz, now, "event");
	if (!got) return null;
	const { picked, covering } = got;
	const hover = hoverEvent(ns_stellasora_stellaEventItems(covering), tz);
	const out = {
		// 外显 = 该公告标题（源站的活动名写法；本次**不改**外显与档期字段的内容）。
		// 悬停里的名称与它同源同字，故「外显能看到的活动名」在悬停里也一定看得到。
		event: picked.row.title,
		eventDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		eventDatesRaw: picked.win.raw
	};
	// hoverEvent 在「当期活动 < 2」时返回 ""：此时**不设** eventHover，
	// 交回 UI 的默认两行式「活动名」⏎「档期|原文」。
	if (hover) out.eventHover = hover;
	return out;
}

// 供测试：从一篇详情 JSON 直接算档期
function ns_stellasora_stellaWindowsFromDetail(detailJson, tz = ns_stellasora_STELLA_TZ) {
	const n = detailJson && detailJson.data && detailJson.data.news;
	if (!n) throw new Error("stella-bad-detail");
	const anchorTs = typeof n.publishTime === "number" ? n.publishTime : null;
	return ns_stellasora_parseStellaWindows(n.content, tz, anchorTs);
}
