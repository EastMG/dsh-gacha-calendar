// src/client/35-parsers-ournotes.js
//
// 由 next-sources/parsers/ournotes.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_ournotes__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-ournotes.js —— BanG Dream! OurNotes 日服（bushimo 官方 WordPress REST）
//
// 契约：async (url, signal, tz) → { event, eventDates, eventDatesRaw?, eventHover? } | null
//   本来源**只有活动/公告侧单侧**（没有卡池专用源）——按任务书只写 event 侧。
//
// ── 可直连（mode="direct"）──────────────────────────────────────────────────
//   调研实测 `https://bang-dream-on.bushimo.jp` 的 ACAO **回显 Origin**
//   → 是环境里仅有的三个可直接 fetch 的源之一（另两个是 api.umapyoi.net / sekai-world.github.io）。
//   注意：registry 里声明的 mode 与这里 fetchJson 传的 mode **必须一致**。
//
// ── 实测形态（2026-10-01/02 抓夹具 fixtures/ournotes-list）──────────────────
// 列表：GET /wp-json/wp/v2/posts?per_page=20&page=1
//   → 标准 WP REST 数组，每项 { id, date, date_gmt, link, title{rendered}, excerpt{rendered}, content{rendered}, … }
//   ⚠️ **不能加 `_fields=id,date,date_gmt,link,title` 裁剪**（任务书给的省流写法）：
//      活动区间藏在 `excerpt`/`content` 里，只取 title/date 就只剩"公告发布时刻"，
//      拿不到任何「举办期间」。夹具实测：288 的活动区间 `2026年9月24日(木)～10月28日(水)14:59`
//      只出现在 content 里，excerpt 里没有。
//   ⚠️ 这是**新游戏**：全站只有 11 篇公告（2026-01 建站 → 2026-09），
//      其中只有 6 篇带日期区间，属正常状态，不是抓取失败。
//
// ── 时区 Asia/Tokyo（**实测**，非推测）──────────────────────────────────────
//   逐条比对 `date` 与 `date_gmt`：全部相差 **9 小时**
//   （例：id=389 `date=2026-09-21T16:30:30` / `date_gmt=2026-09-21T07:30:30`）→ JST=UTC+9。
//
// ── 取值策略 ────────────────────────────────────────────────────────────────
//   公告不是排期表：一篇公告里可能完全没有日期（如 id=389「動作環境について」），
//   也可能有多个不相干的区间（直播时刻、展会日程、活动期间）。
//   所以：① 按 date_gmt 倒序遍历公告；② 从 title+excerpt+content 抽「日期[时刻]～日期[时刻]」区间；
//        ③ 外显取**第一条覆盖当前时刻**的区间（没有则取最新一篇的第一条区间）；
//        ④ hover 逐行列出所有覆盖当前的区间（附所属公告标题）。
//   只给"一个日期"的句子（「9月24日(木)に決定しました！」）**不算区间** → 不产出，不硬凑。


const ns_ournotes_OURNOTES_LIST_URL = "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1";
const ns_ournotes_OURNOTES_TZ = "Asia/Tokyo";

// lib/env.js 的 decodeEntities 未覆盖的常见实体（公告里 `&hellip;` 之类）
const ns_ournotes_ENT_EXTRA = { hellip: "…", middot: "·", times: "×", mdash: "—", ndash: "–", nbsp: " ", amp: "&", quot: '"', apos: "'" };
function ns_ournotes_decodeExtra(s) {
	return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
		const v = ns_ournotes_ENT_EXTRA[String(k).toLowerCase()];
		return v != null ? v : m;
	}));
}
function ns_ournotes_plain(html) { return ns_ournotes_decodeExtra(textOf(html)); }
function ns_ournotes_ournotesTitle(x) {
	const t = x && x.title;
	if (t && typeof t === "object") return ns_ournotes_decodeExtra(t.rendered || "").replace(/\s+/g, " ").trim();
	return ns_ournotes_decodeExtra(t || "").replace(/\s+/g, " ").trim();
}

// ── 日文日期区间令牌 ──
// 令牌化而不是一条大正则：日文公告里「年」可省、「月」在末段可省（`10月17日(土)・18日(日)`）、
// 时刻可省、分隔符有 `～`/`〜`/`~`/`・` 多种 —— 用一条正则的可选组会互相吃掉，走令牌清楚得多。
//   DATE：年?(可选) 月?(可选) 日 + 可选 (曜日)
//   TIME：HH:MM（全角冒号也算）
//   SEP ：~ ～ 〜 〰 － - – — ・
const ns_ournotes_JP_TOKEN = /(?:(20\d{2})\s*年)?\s*(?:(\d{1,2})\s*月)?\s*(\d{1,2})\s*日(?:\s*[（(][^）)]{0,6}[）)])?|(\d{1,2})\s*[:：]\s*(\d{2})|([~\uff5e\u301c\u3030\uff0d\-\u2013\u2014]|・)/g;

// 从一段文本抽区间。返回 [{ startTs, endTs, raw }]（同 raw 去重）
//   起点**必须**带月份（防止把「5日連続」「30日間」这类裸"日"当窗口起点）
//   末段可省"月"（`・18日(日)`）→ 月份取起点月，日小于起点日则进一个月
//   末段缺时刻 → 全天（00:00 / 23:59）；起点缺时刻 → 00:00
function ns_ournotes_parseOurNotesWindows(text, tz = ns_ournotes_OURNOTES_TZ, hint = null) {
	const out = [];
	const seen = new Set();
	const s = String(text == null ? "" : text);
	ns_ournotes_JP_TOKEN.lastIndex = 0;
	const toks = [];
	let m;
	while ((m = ns_ournotes_JP_TOKEN.exec(s)) !== null) {
		toks.push({
			date: m[3] != null ? { y: m[1] ? +m[1] : null, mo: m[2] != null ? +m[2] : null, d: +m[3] } : null,
			time: m[4] != null ? { h: +m[4], mi: +m[5] } : null,
			sep: m[6] || null,
			at: m.index,
			end: m.index + m[0].length
		});
		if (m[0] === "") ns_ournotes_JP_TOKEN.lastIndex++;
	}
	const hintParts = hint != null ? sourceWallParts(hint, tz) : null;
	let i = 0;
	while (i < toks.length) {
		const t0 = toks[i];
		if (!t0.date || t0.date.mo == null) { i++; continue; }
		let j = i + 1;
		let startTime = null;
		if (toks[j] && toks[j].time) { startTime = toks[j].time; j++; }
		if (!(toks[j] && toks[j].sep)) { i++; continue; }
		j++;
		let endDate = null, endTime = null;
		if (toks[j] && toks[j].date) { endDate = toks[j].date; j++; }
		if (toks[j] && toks[j].time) { endTime = toks[j].time; j++; }
		if (!endDate && !endTime) { i++; continue; }

		// 年份：源站常只写月日 → 取公告年份
		const y1 = t0.date.y != null ? t0.date.y : (hintParts ? hintParts.y : null);
		if (y1 == null) { i++; continue; }
		let y2, mo2, d2;
		if (endDate) {
			mo2 = endDate.mo != null ? endDate.mo : t0.date.mo;
			d2 = endDate.d;
			y2 = endDate.y != null ? endDate.y : y1;
			if (endDate.y == null) {
				if (mo2 < t0.date.mo || (mo2 === t0.date.mo && d2 < t0.date.d)) {
					// 末段只写「日」且比起点日小 → 视为下一个月
					if (endDate.mo == null) { mo2 = t0.date.mo + 1; if (mo2 > 12) { mo2 = 1; y2 = y1 + 1; } }
					else y2 = y1 + 1;
				}
			}
		} else {
			mo2 = t0.date.mo; d2 = t0.date.d; y2 = y1;
		}
		const h1 = startTime ? startTime.h : 0, mi1 = startTime ? startTime.mi : 0;
		const h2 = endTime ? endTime.h : 23, mi2 = endTime ? endTime.mi : 59;
		const startTs = sourceInstant(y1, t0.date.mo, t0.date.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
		if (!(endTs > startTs)) { i++; continue; }
		const raw = s.slice(t0.at, toks[j - 1].end).trim();
		if (!seen.has(raw)) { seen.add(raw); out.push({ startTs, endTs, raw }); }
		i++;
	}
	return out;
}

// ── 公告集合 → [{ id, title, dateTs, windows }]（按 date_gmt 倒序）──
function ns_ournotes_parseOurNotesPosts(json, tz = ns_ournotes_OURNOTES_TZ) {
	if (!Array.isArray(json)) throw new Error("ournotes-bad-json");
	return json
		.filter((p) => p && p.id != null)
		.map((p) => {
			const hint = ns_ournotes_parseOurNotesInstant(p.date, tz);
			const hay = [
				ns_ournotes_ournotesTitle(p),
				ns_ournotes_plain(p.excerpt && p.excerpt.rendered),
				ns_ournotes_plain(p.content && p.content.rendered)
			].join("\n");
			return {
				id: p.id,
				title: ns_ournotes_ournotesTitle(p),
				dateText: p.date || "",
				dateTs: hint,
				windows: ns_ournotes_parseOurNotesWindows(hay, tz, hint)
			};
		})
		.sort((a, b) => (b.dateTs || 0) - (a.dateTs || 0));
}

// WP 的 `date` 是**源站本地时间且不带时区后缀**（"2026-09-21T16:30:30"）→ 按 tz 解释为墙钟
function ns_ournotes_parseOurNotesInstant(s, tz = ns_ournotes_OURNOTES_TZ) {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

// 外显挑选：第一条"覆盖当前时刻"的区间（按公告倒序、区间原序）；都没有则取最新一篇的第一条区间
function ns_ournotes_selectOurNotesPrimary(entries, now) {
	const list = Array.isArray(entries) ? entries : [];
	for (const p of list) for (const w of p.windows) if (w.startTs <= now && w.endTs >= now) return { post: p, win: w };
	for (const p of list) if (p.windows.length) return { post: p, win: p.windows[0] };
	return null;
}

// ── 抓取器（活动侧单侧）──
async function ns_ournotes_eventsOurNotes(url, signal, tz = ns_ournotes_OURNOTES_TZ) {
	const listUrl = url || ns_ournotes_OURNOTES_LIST_URL;
	// mode 必须与 registry-<batch>.js 里声明的 "direct" 一致（本目录只有 3 个源可直连）
	const json = await fetchJson(listUrl, { signal, mode: "direct" });
	if (!Array.isArray(json)) throw new Error("ournotes-bad-json");
	if (json.length === 0) return null;
	const posts = ns_ournotes_parseOurNotesPosts(json, tz);
	const now = Date.now();
	const picked = ns_ournotes_selectOurNotesPrimary(posts, now);
	if (!picked || !picked.win) return null;
	const active = [];
	for (const p of posts) for (const w of p.windows) if (w.startTs <= now && w.endTs >= now) active.push({ p, w });
	// 悬停格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover）：`名称` + 3 空格 + `档期`，
	// **名称在前**（旧实现「档期在前、名称在后」，与本体相反 —— 用户 2026-10-03 反馈的偏差②）。
	// 名称用公告标题（这是该站的"活动名"来源）；行内不再附来源站名/URL/时区推定等元信息。
	// ⚠️ 只有 1 条当期窗口时 hoverEvent 返回 "" → **不设 eventHover**，由 UI 走默认两行式
	//    「名称 ⏎ 档期」（实测夹具里覆盖当期的只有 1 条：288 那篇）。
	const list = (active.length ? active : [picked]).map(({ p, w }) => ({
		name: p.title,
		startTs: w.startTs,
		endTs: w.endTs,
		raw: w.raw
	}));
	const eventHover = hoverEvent(list, tz);
	return {
		event: picked.post.title,
		eventDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		eventDatesRaw: picked.win.raw,
		...(eventHover ? { eventHover } : {})
	};
}
