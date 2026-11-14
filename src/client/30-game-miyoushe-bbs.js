// src/client/30-game-miyoushe-bbs.js —— 未定事件簿（国服）：米游社公告（卡池 + 活动）
//
// ── 为什么换到米游社公告（2026-11-09 调研）──────────────────────────────────
// 旧调研说 `wd.mihoyo.com` 的公告 CMS 停在 2025-04-02、bwiki 子站（`cxbs`）停在 2024-03-22
// ⇒ 当时只注册条目、来源留空。本批重新实测：**米游社（bbs-api.miyoushe.com）未定事件簿版块
// forum_id=33 仍在日更**（官方号 uid 76089447，最新一条 2026-11-07 20:06），列表/详情都通。
//
//  列表 GET /post/wapi/getForumPostList?forum_id=33&is_good=false&is_hot=false&page_size=20&sort_type=2
//        裸 GET 200 / 131,563 B / retcode 0 / 20 条。每条的 `post.content` 预览里就带
//        「▶活动时间：…」（详情里的正文是同一段的完整版）。
//  详情 GET /post/wapi/getPostFull?post_id=<id>
//        **必须带 Referer: https://www.miyoushe.com/wd/**（只带 UA ⇒ 403；与星铁/原神那套
//        米游社公告同一个 Referer 门）。
//        → data.post.post.content = HTML（`<p>` 段落 + 图片 div）
//
//  字段：卡池[名称 ✓ 角色 ✓ 起止 ✓]、活动[名称 ✓ 起止 ✓]
//  代理：**必须**（响应不回 ACAO；`bbs-api.miyoushe.com` 已在宿主 PROXY_ALLOW_HOSTS 里）
//  懒加载：一次刷新 = 1 次列表 + 最多 5 篇详情（卡池/活动**各自**一份，互不影响）。
//
// ── 时间怎么写 ────────────────────────────────────────────────────────────────
//  卡池正文：「▶活动时间：2026年10月30日11:00-11月13日11:00」
//  活动正文：「▶活动时间：2026年11月5日更新后-11月12日04:00」
//  开始端可能写 `更新后`（= **起点未知**，不许猜钟点）；结束端一定带 `HH:MM`。
//  年份只写在开始端 ⇒ 结束端继承开始端年份；结束月日早于开始月日 ⇒ 跨年。
//  `更新后` 的起点按全仓口径「起点未知 ≠ 已开始」：`startTs = null`，
//    · **不进外显**（`coversNow` 要求两端都明确）⇒ 面板不会把 11-05 才开的池子当成 11-04 就在开；
//    · **仍进悬停**（`coveredOrOpen`）⇒ 事实不丢，悬停里印源站原文「2026年11月5日更新后 ~ …」。
//  可选锚点：同列表的「11月5日08:00停服更新公告」可以给出真实的开服时刻，但本批**刻意不强依赖**
//  它 —— 公告有时晚发/改期，猜错比"起点未知"更糟（与无期迷途 `开服后` 同一套取舍）。
//
// ── 两份文本（与 bwiki 通用层同一约定）────────────────────────────────────────
//   raw     = 源站原文那一句（`2026年10月30日11:00 ~ 11月13日11:00`，分隔符统一成 `~`）
//   display = 补全文本（`10-30 11:00 ~ 11-13 11:00`；起点未知时写 `11-05 更新后 ~ 11-12 04:00`）
//  外显取 display，悬停取 raw（`hoverWindowTextOf` 见到「更新后」会原样印 raw）。
//
// ── 名称 / 角色口径 ──────────────────────────────────────────────────────────
//  标题 `<池名/活动名>丨<副标题>`：取 `丨` 之前那一段当名字（`轮替女神之影更新` → 去掉尾缀
//  `更新/开启/预告` → `轮替女神之影`）；没有 `丨` 就用整条标题。
//  角色 = 正文里 `SSR/SSS/SR/MR【…】` 的**思绪名**（与 `30-game-netease.js` 的画灵名同口径），
//  多个用「、」连接。例：`莫弈SSS【雪愿相宜】` → `雪愿相宜`。
//
// ── 失败语义 ─────────────────────────────────────────────────────────────────
//  · 列表 HTTP 非 2xx / 不是 JSON / `retcode !== 0` / `data.list` 不是数组 → **抛**（该侧记失败）；
//  · 列表为空 → null（源站没数据 = 未公布）；
//  · 单篇详情 404/410 / `retcode 1101/1102`（post not exist）→ 跳过该篇；
//    全部候选都失败且出现过硬错 → **抛**（别把 403/封禁静默成「未公布」）；
//  · 抓到正文但没有任何窗口覆盖 now → null（不硬凑过期档期）。
//
// ── 时区 ──
//  正文墙钟是国服 UTC+8（源站未标注，按国服惯例推定；只写在注释里，不进悬停）。

		const WD_TZ = "Asia/Shanghai";
		const WD_LIST_URL = "https://bbs-api.miyoushe.com/post/wapi/getForumPostList?forum_id=33&is_good=false&is_hot=false&page_size=20&sort_type=2";
		const WD_DETAIL_BASE = "https://bbs-api.miyoushe.com/post/wapi/getPostFull";
		// 详情端点的 Referer 门（实测：只带 UA ⇒ 403 / 带 miyoushe.com/wd/ ⇒ 200）
		const WD_REFERER = "https://www.miyoushe.com/wd/";
		const WD_MAX_DETAILS = 5;

		// 标题分流：卡池关键词优先（`雪愿相宜丨活动女神之影开启` 同时含"活动"与"女神之影"）。
		// ⚠️ 活动词表里**不放「登录」**：本周实测列表里「部分安卓设备登录时闪退问题处理说明」
		//    会因此被误判成活动，白白多抓一篇详情（其余词也验过：闪退/修复/更新都不含）。
		const WD_GACHA_KW = /女神之影|概率提升|限时返场|概率UP|启示/;
		const WD_EVENT_KW = /活动|征集|赛事|签到|庆典|有奖|话题|抽奖|投票|答题|委托|福利/;

		function wdDetailUrl(postId) {
			return `${WD_DETAIL_BASE}?post_id=${encodeURIComponent(String(postId))}`;
		}

		function wdParseList(json) {
			if (!json || typeof json !== "object") throw new Error("wd-bad-shape");
			if (json.retcode !== 0) throw new Error("wd-retcode-" + json.retcode);
			const list = json.data && json.data.list;
			if (!Array.isArray(list)) throw new Error("wd-bad-list");
			const out = [];
			for (const it of list) {
				const p = it && it.post;
				if (!p || p.post_id == null || p.post_id === "") continue;
				const sec = Number(p.created_at);
				out.push({
					// 源站是字符串；URL 与夹具都按它拼
					postId: String(p.post_id),
					subject: String(p.subject || "").replace(/\s+/g, " ").trim(),
					createdTs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : null
				});
			}
			return out;
		}

		function wdParseDetail(json) {
			if (!json || typeof json !== "object") throw new Error("wd-bad-shape");
			if (json.retcode !== 0) throw new Error("wd-retcode-" + json.retcode);
			const p = json.data && json.data.post && json.data.post.post;
			if (!p || p.post_id == null) throw new Error("wd-bad-post");
			return {
				postId: String(p.post_id),
				subject: String(p.subject || "").replace(/\s+/g, " ").trim(),
				content: String(p.content || "")
			};
		}

		function wdClassify(subject) {
			const t = String(subject == null ? "" : subject);
			if (WD_GACHA_KW.test(t)) return "gacha";
			if (WD_EVENT_KW.test(t)) return "event";
			return "unknown";
		}

		// 「这篇拿不到」≠「这一侧失败」：详情对不存在的 post 回 HTTP 200 + retcode 1101/1102
		function wdIsMissing(err) {
			const m = String((err && err.message) || err || "");
			return /\b(404|410)\b/.test(m) || /wd-retcode-(1101|1102)\b/.test(m);
		}

		// ── 时间窗口 ────────────────────────────────────────────────────────────
		// 完整日期 `2026年10月30日11:00` / `2026年11月5日更新后`，或省年份 `11月13日11:00`。
		const WD_POINT_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(\d{1,2})\s*[:：]\s*(\d{2})|(更新后))?|(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(\d{1,2})\s*[:：]\s*(\d{2})|(更新后))?/g;
		const WD_CONNECTOR_RE = /^\s*[-~～〜—–－至到]\s*$/;

		function wdPointsOf(text) {
			const s = String(text == null ? "" : text);
			const out = [];
			WD_POINT_RE.lastIndex = 0;
			let m;
			while ((m = WD_POINT_RE.exec(s))) {
				if (m[0] === "") { WD_POINT_RE.lastIndex++; continue; }
				const abs = m[1] != null;
				out.push({
					start: m.index,
					end: m.index + m[0].length,
					y: abs ? +m[1] : null,
					mo: abs ? +m[2] : +m[7],
					d: abs ? +m[3] : +m[8],
					h: abs ? (m[4] != null ? +m[4] : null) : (m[9] != null ? +m[9] : null),
					mi: abs ? (m[5] != null ? +m[5] : null) : (m[10] != null ? +m[10] : null),
					open: (abs ? m[6] : m[11]) === "更新后"
				});
			}
			return out;
		}

		// 正文 → 窗口事实 [{ startTs, endTs, raw, display }]（按区间去重，保留文档顺序）
		function wdWindowsOf(text, tz = WD_TZ) {
			const s = String(text == null ? "" : text);
			const toks = wdPointsOf(s);
			const out = [];
			const seen = new Set();
			for (let i = 0; i + 1 < toks.length; i++) {
				const a = toks[i], b = toks[i + 1];
				if (!WD_CONNECTOR_RE.test(s.slice(a.end, b.start))) continue;
				// 端点必须能定：起点要「完整日期 + 时刻」或「完整日期 + 更新后」；终点要时刻
				if (a.y == null) continue;
				if (a.h == null && !a.open) continue;
				if (b.h == null) continue;
				const endY = b.y != null ? b.y : a.y + (endsNextYear(a.mo, a.d, b.mo, b.d) ? 1 : 0);
				const startTs = a.open ? null : sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
				const endTs = sourceInstant(endY, b.mo, b.d, b.h, b.mi, tz);
				if (startTs != null && !(endTs > startTs)) continue;
				const key = (startTs == null ? "open" : startTs) + "|" + endTs;
				if (seen.has(key)) continue;
				seen.add(key);
				const aRaw = s.slice(a.start, a.end).replace(/\s+/g, " ").trim();
				const bRaw = s.slice(b.start, b.end).replace(/\s+/g, " ").trim();
				// 跨年时 display 两端都带年份（与 fmtWindow 同一规则）；起点未知时保留「更新后」，
				// 不编造钟点（`startTs = null` 那一侧本来就进不了外显）。
				const endWall = sourceWallParts(endTs, tz);
				const startWall = a.open ? { y: a.y, mo: a.mo, d: a.d } : sourceWallParts(startTs, tz);
				const sameYear = startWall.y === endWall.y;
				let startText;
				if (a.open) {
					startText = sameYear
						? `${pad2(a.mo)}-${pad2(a.d)} 更新后`
						: `${a.y}-${pad2(a.mo)}-${pad2(a.d)} 更新后`;
				} else {
					startText = sameYear ? fmtMdHm(startTs, tz) : fmtYmdHm(startTs, tz);
				}
				const endText = sameYear ? fmtMdHm(endTs, tz) : fmtYmdHm(endTs, tz);
				out.push({ startTs, endTs, raw: `${aRaw} ~ ${bRaw}`, display: `${startText} ~ ${endText}` });
			}
			return out;
		}

		// 正文里的思绪名（`莫弈SSS【雪愿相宜】` → 雪愿相宜）。只认带稀有度前缀的【…】，
		// 避免把【女神之泪】【泪之痕】这类道具当成角色。
		const WD_CARD_RE = /(?:SSR|SSS|SR|MR)\s*(?:思绪|画灵)?\s*【([^】]+)】/g;
		function wdRolesOf(text) {
			const s = String(text == null ? "" : text);
			const out = [], seen = new Set();
			WD_CARD_RE.lastIndex = 0;
			let m;
			while ((m = WD_CARD_RE.exec(s))) {
				const n = m[1].replace(/[（(].*$/, "").trim();
				if (!n || seen.has(n)) continue;
				seen.add(n);
				out.push(n);
			}
			return out.join("\u3001");
		}

		// 标题 → 名字：`轮替女神之影更新丨左然SSR【风烛引归】限时返场` → `轮替女神之影`
		function wdNameOf(subject) {
			const s = String(subject == null ? "" : subject).replace(/\s+/g, " ").trim();
			const head = s.split("丨")[0].trim();
			return head.replace(/(?:更新|开启|预告)$/, "").trim() || s;
		}

		// ── 抓取：列表 → 按标题分流 → 逐篇详情 → 抽窗口 ──────────────────────────
		async function wdCollectSide(listUrl, signal, tz, want) {
			const listJson = await fetchJson(listUrl || WD_LIST_URL, { signal, mode: "proxy", referer: WD_REFERER });
			const items = wdParseList(listJson);
			if (items.length === 0) return null;
			const cands = items.filter((it) => wdClassify(it.subject) === want).slice(0, WD_MAX_DETAILS);
			if (cands.length === 0) return null;
			const rows = [];
			let okCount = 0, firstHardErr = null;
			for (const it of cands) {
				let d;
				try {
					d = wdParseDetail(await fetchJson(wdDetailUrl(it.postId), { signal, mode: "proxy", referer: WD_REFERER }));
				} catch (e) {
					if (!wdIsMissing(e) && !firstHardErr) firstHardErr = e;
					continue;
				}
				okCount++;
				const text = textOf(d.content || "");
				const subject = d.subject || it.subject;
				const name = wdNameOf(subject);
				const roles = wdRolesOf(text);
				for (const w of wdWindowsOf(text, tz)) rows.push({ ...w, subject, name, roles, postId: d.postId });
			}
			// 一篇都没拿到、且出现过硬错（403 / 567 / 坏 JSON）⇒ 抛出去（别把封禁静默成未公布）
			if (okCount === 0) {
				if (firstHardErr) throw firstHardErr;
				return null;
			}
			return rows;
		}

		async function fetchWdGacha(url, signal, tz = WD_TZ) {
			const at = nowMs();
			const rows = await wdCollectSide(url, signal, tz, "gacha");
			if (!rows || rows.length === 0) return null;
			// 外显：两端都明确且覆盖 now（起点未知的池**不**进外显）
			const live = rows.filter((r) => coversNow(r, at));
			if (live.length === 0) return null;
			live.sort((a, b) => (a.endTs - b.endTs) || ((a.startTs == null ? Infinity : a.startTs) - (b.startTs == null ? Infinity : b.startTs)));
			const first = live[0];
			// 悬停：在期 ∪ 起点未知但终点未过（全仓口径，见文件头）
			const hoverItems = rows.filter((r) => coveredOrOpen(r, at)).sort(poolHoverOrderOf).map((r) => {
				const label = r.roles ? `${r.name}\uFF1A${r.roles}` : r.name;
				return { title: label, label, startTs: r.startTs, endTs: r.endTs, raw: r.raw };
			});
			const hover = hoverTextFromItems(hoverItems, "gacha", tz);
			const out = {
				banner: first.name,
				roles: first.roles,
				bannerDates: first.display,
				bannerDatesRaw: first.raw,
				startTs: first.startTs,
				endTs: first.endTs,
				...(hover ? { bannerHover: hover } : {})
			};
			out.gacha = dataArrayProducedGachaOf(out, hoverItems, { id: "wd", tz }, at);
			out.gachaHoverItems = hoverItems;
			return out;
		}

		async function fetchWdEvents(url, signal, tz = WD_TZ) {
			const at = nowMs();
			const rows = await wdCollectSide(url, signal, tz, "event");
			if (!rows || rows.length === 0) return null;
			const live = rows.filter((r) => coversNow(r, at));
			if (live.length === 0) return null;
			live.sort((a, b) => (a.endTs - b.endTs) || ((a.startTs == null ? Infinity : a.startTs) - (b.startTs == null ? Infinity : b.startTs)));
			const first = live[0];
			const hoverItems = rows.filter((r) => coveredOrOpen(r, at))
				.sort((a, b) => (a.endTs - b.endTs) || ((a.startTs == null ? Infinity : a.startTs) - (b.startTs == null ? Infinity : b.startTs)))
				.map((r) => ({ title: r.name, startTs: r.startTs, endTs: r.endTs, raw: r.raw }));
			const hover = hoverTextFromItems(hoverItems, "event", tz);
			const out = {
				event: first.name,
				eventDates: first.display,
				eventDatesRaw: first.raw,
				...(hover ? { eventHover: hover } : {})
			};
			out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "wd", tz }, at);
			out.eventHoverItems = hoverItems;
			return out;
		}

		// ── 条目 ──
		registerSource({
			id: "wd",
			defaultHidden: false,
			tz: WD_TZ,
			name: "未定事件簿",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/bd/c8/ad/bdc8ad3c-1bd5-debe-90b9-e67ea22578de/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
			source: "米游社公告",
			url: WD_LIST_URL,
			eventSource: "米游社公告",
			eventUrl: WD_LIST_URL
		});

		GACHA_FETCHERS["wd"] = (url, signal, tz) => fetchWdGacha(url, signal, tz);
		EVENT_FETCHERS["wd"] = {
			default: (url, signal, tz) => fetchWdEvents(url, signal, tz)
		};
