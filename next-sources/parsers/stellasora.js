// next-sources/parsers/stellasora.js —— 星塔旅人 国服（悠星官方 CMS API）
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
import { fetchJson, sourceInstant, sourceWallParts, fmtWindow, pad2, decodeEntities } from "../lib/env.js";

export const STELLA_BASE = "https://stellasora.yostar.cn";
export const STELLA_TZ = "Asia/Shanghai";   // 推测：源站未标注，但 04:00 日切与国服一致

export function stellaListUrl(type = "notice", size = 20, index = 1) {
	return `${STELLA_BASE}/api/resource/news?index=${index}&size=${size}&type=${type}`;
}
export function stellaDetailUrl(id) {
	return `${STELLA_BASE}/api/resource/news/${id}`;
}

// ── 正文 → 纯文本（保留 `<br>` 换行；档期是 `<br>` 分隔的，不能直接压成空格）──
function brText(html) {
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
const YMD_RE = /(?:(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2}))(?:\s*(\d{1,2}):(\d{2}))?/;
const MD_RE = /(?<!\d)(\d{1,2})[\/\-.](\d{1,2})(?:\s*(\d{1,2}):(\d{2}))?/;
const REL_START_RE = /维护结束后|维护后|更新结束后|更新后/;

// ⚠️ 必须先"挖掉"已匹配的完整年月日，再找省略年份的月日。
//    否则 `2026/09/29 维护结束后` 里的 `09/29` 会被 MD_RE 当成"省年份的月日"匹配到，
//    于是走错分支、把「维护结束后」的相对锚点丢掉（本仓库实测踩过这个坑）。
function maskYmd(s) {
	return s.replace(new RegExp(YMD_RE.source, "g"), (m) => "\u0000".repeat(m.length));
}

// 从一段文本解析一个「起点 ~ 终点」区间。返回 { startTs, endTs, raw, startInferred } 或 null
export function parseStellaWindow(segText, tz = STELLA_TZ, anchorTs = null) {
	const s = String(segText == null ? "" : segText).replace(/\s*\n\s*/g, " ").trim();
	if (!s) return null;
	// 先看有没有显式区间分隔符
	const sepMatch = /[~～〜－—–]/.exec(s);
	const anchorParts = anchorTs != null ? sourceWallParts(anchorTs, tz) : null;

	// ① 起点：相对锚点（「维护结束后」）优先于裸日期 → 绝对日期（完整年月日） → 绝对日期（省年份）
	//
	// ⚠️ 顺序很重要：源站写的是 `2026/09/29 维护结束后 ~ 2026/10/20 10:59` —— **日期与「维护结束后」同时出现**。
	//    若让 YMD_RE 先命中，起点会变成 `09-29 00:00`（那天零点），但真实开局是**维护结束**那一刻。
	//    故「维护结束后」优先，用公告发布时刻当锚点并标 startInferred
	//    （与仓库既有惯例一致：FGO 的 `即日起` / 绝区零的 `4.6版本更新后` 起点都标 inferred 并写进 raw）。
	//    未出现该词时，`2026/10/01 04:00` 这类显式起点照常按原样解析。
	let startTs = null, startInferred = false, startRaw = "";
	const relMatch = REL_START_RE.exec(s);
	const head = sepMatch ? s.slice(0, sepMatch.index) : s;
	const ymd1 = YMD_RE.exec(head);
	const md1 = !ymd1 ? MD_RE.exec(maskYmd(head)) : null;

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
		const ymd2 = YMD_RE.exec(tail);
		const md2 = !ymd2 ? MD_RE.exec(maskYmd(tail)) : null;
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
export function parseStellaWindows(html, tz = STELLA_TZ, anchorTs = null) {
	const text = brText(html);
	const out = [];
	// `▌<标签>时间` 后面紧跟一段（到下一个 ▌ 或结尾）
	const marks = [...text.matchAll(/▌\s*([^\n]{0,20}?时间)\s*\n?([^\n]*)/g)];
	for (const m of marks) {
		const label = m[1].replace(/\s+/g, "");
		const seg = (m[2] || "").trim();
		const w = parseStellaWindow(seg, tz, anchorTs);
		if (w) out.push({ label, ...w });
	}
	// 兜底：正文里存在「A ~ B」但没有 ▌标签
	if (out.length === 0) {
		for (const line of text.split("\n")) {
			const w = parseStellaWindow(line, tz, anchorTs);
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
export function stellaIsGacha(title) {
	return /招募/.test(String(title || ""));
}
export function stellaIsEvent(title) {
	const t = String(title || "");
	if (stellaIsGacha(t)) return false;
	if (/维护|更新说明|版本内容|版本活动一览|概率公示|封禁|处罚|问卷/.test(t)) return false;
	return /活动说明|活动开启|活动一览|活动预告/.test(t) || /活动/.test(t);
}
// 卡池标题 → 干净的卡池名：去掉「限时招募开启」等尾巴
export function stellaGachaName(title) {
	return String(title || "").replace(/(限时|限定)?招募(开启|说明|一览)?[！!。.]?$/, "").trim() || String(title || "").trim();
}

// ── 列表解析 ──
export function parseStellaList(json) {
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
async function collectStellaSide(url, signal, tz, now, side) {
	const listUrl = url || stellaListUrl("notice");
	const list = parseStellaList(await fetchJson(listUrl, { signal, mode: "proxy" }));
	const want = side === "gacha" ? stellaIsGacha : stellaIsEvent;
	const candidates = [];
	// 列表按时间倒序；只扫前若干条，每篇抓一次详情
	for (const row of list.slice(0, 20)) {
		if (!want(row.title)) continue;
		let detail = null;
		try {
			const dj = await fetchJson(stellaDetailUrl(row.id), { signal, mode: "proxy" });
			detail = dj && dj.code === 0 && dj.data && dj.data.news ? dj.data.news : null;
		} catch { continue; }   // 单篇失败不拖垮整体
		if (!detail) continue;
		const anchorTs = row.publishTs != null ? row.publishTs : null;
		const wins = parseStellaWindows(detail.content, tz, anchorTs);
		for (const w of wins) candidates.push({ row, win: w });
	}
	if (candidates.length === 0) return null;
	// 覆盖 now 的里，取「起点最新」的那条（并列时取终点更晚的）
	const covering = candidates.filter((c) => c.win.startTs <= now && c.win.endTs >= now);
	if (covering.length === 0) return null;
	covering.sort((a, b) => (b.win.startTs - a.win.startTs) || (b.win.endTs - a.win.endTs) || (b.row.id - a.row.id));
	return { picked: covering[0], covering };
}

// 悬停：列出全部覆盖 now 的档期（带标签）
function stellaHover(covering, tz, nameOf) {
	return covering
		.map((c) => `${fmtWindow(c.win.startTs, c.win.endTs, tz)}   ${nameOf(c.row)}` + (c.win.startInferred ? "（起点按公告发布时刻推断）" : ""))
		.join("\n");
}

// ── 卡池侧 ──
export async function gachaStellasora(url, signal, tz = STELLA_TZ, now = Date.now()) {
	const got = await collectStellaSide(url, signal, tz, now, "gacha");
	if (!got) return null;
	const { picked, covering } = got;
	return {
		banner: stellaGachaName(picked.row.title),
		bannerDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		bannerDatesRaw: picked.win.raw,
		startTs: picked.win.startTs,
		endTs: picked.win.endTs,
		event: "",
		eventDates: "",
		eventHover: stellaHover(covering, tz, (r) => stellaGachaName(r.title))
	};
}

// ── 活动侧 ──
export async function eventsStellasora(url, signal, tz = STELLA_TZ, now = Date.now()) {
	const got = await collectStellaSide(url, signal, tz, now, "event");
	if (!got) return null;
	const { picked, covering } = got;
	return {
		event: picked.row.title,
		eventDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		eventDatesRaw: picked.win.raw,
		eventHover: stellaHover(covering, tz, (r) => r.title)
	};
}

// 供测试：从一篇详情 JSON 直接算档期
export function stellaWindowsFromDetail(detailJson, tz = STELLA_TZ) {
	const n = detailJson && detailJson.data && detailJson.data.news;
	if (!n) throw new Error("stella-bad-detail");
	const anchorTs = typeof n.publishTime === "number" ? n.publishTime : null;
	return parseStellaWindows(n.content, tz, anchorTs);
}
