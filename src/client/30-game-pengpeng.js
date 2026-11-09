// src/client/30-game-pengpeng.js —— 夜幕之下（国服；曾用名「代号砰砰」，2026-06-05 公测）
//
// **只有卡池源**（2026-11-09 实测 200，夹具 test/fixtures/pengpeng-bwiki）：
//   bwiki「契约一览」= MediaWiki `api.php?action=parse`（HTML 表，18 行 / 45KB）
//     列：契约 | 开放时间 | 概率提升的风格
//     行例：隐秘的归属 | 2026/09/10 05:00:00 ~ 2026/10/01 04:59:59 | 杯中藏锋 | 活动
//
// ── 活动侧旧源（2026-11-09 接入；2026-11-10 起降为 eventAltSources 手动备选）：bwiki `公告/` ──
// 旧结论是「官方只有逐条公告页（无列表接口），bwiki 也没有活动一览页」⇒ 当时留空未配置。
// 本批重新实测：bwiki `公告/` 前缀下共 **88 页**，其中 5 页以「版本活动总览」结尾，
// 每页 5~6 行「活动时间：」，**小节名就是活动名**：
//   列表  api.php?action=query&generator=allpages&gapprefix=公告/&gaplimit=100&format=json&formatversion=2
//         `origin=*` 由 `withBwikiCors` 统一补；实测 200、`ACAO: *`（但全站口径仍走宿主代理，见 15-env.js）
//   详情  api.php?action=parse&page=<页名>&prop=wikitext&format=json&formatversion=2
//         模板：{{公告页面|公告发布日期=2026-09-10|公告内容=…}}
//         正文：'''◈「共举昨日之酒·上」版本签到'''<br>
//               活动时间：2026/9/10 版本更新后 - 2026/10/1 4:59<br>
// 取**最新一页** = `pageid` 最大（MediaWiki 自增；标题里没有日期，不能按标题排）。
// 起点「版本更新后」= **起点未知** ⇒ `startTs = null`（与 wd 同口径：不进外显、进悬停）。
//
// ⚠️ 已知滞后：该 wiki 最新一版只到 **2026-09-10**（比游戏落后约 1 个版本；游戏本身仍在运营，
//    1.0.54 / 2026-10-21）。所以此刻抓到的活动全部已结束 ⇒ 如实 `null`（未公布），
//    **绝不**把九月档期当成"当前活动"。设置页的来源标签写明
//    「Bwiki 公告（wiki 数据滞后）」—— 停更的是 wiki，不是游戏，不要标成"暂停"。
//
// ── 2026-11-09 23:1x 真机复测（结论：解析链路正常，nomatch 是「wiki 停更」）─────────
//  经宿主代理抓真接口：`action=query&generator=allpages&gapprefix=公告/` = 88 页（只有 title/pageid）；
//  再按标题发 `action=parse&prop=wikitext`（**不是**读 revisions —— 那才是拿不到正文的写法），
//  最新总览「共举昨日之酒·上」解析出 5 条：
//    彷徨往昔 ｜ 2026/9/12 5:00 ~ 2026/9/29 4:59（两端明确）
//    「共举昨日之酒·上」版本签到 / 吾血浓于酒 / 灰色酒路 / 橡木廊柜台 ｜ 2026/9/10 版本更新后 ~ …
//  ⇒ 「活动名 + 起止」都能解。真因：wiki `list=recentchanges` 最后编辑 = **2026-09-24**，
//  最新档期 10-01 04:59 就结束了 ⇒ 当前时刻如实 null。等 wiki 补档即恢复，抓取器不需要改
//  （回归 `test/cases-pengpeng-event.mjs` ③ 用期内 now 断言有数据、④ 用真机 now 断言 null）。
//
// ── 活动侧（2026-11-10 改）：默认源 = **TapTap 官方 tab** ────────────────────────
// 旧默认源 `bwiki 公告/` 已停更 6 周（最新一版 2026-09-10）⇒ 面板活动列长期空窗。
// 新源：`https://www.taptap.cn/app/746164/topic?type=official`（翻页 `&page=2`），实测
//   200 / 359 KB / 每页 10 帖；官方帖正文里直接写：
//     🍃【新风同行】限时活动 即将开启
//     ▸活动时间：2026年11月5日 05:00 - 2026年11月19日 04:59
//   ⇒ 解析成「活动名 + 起止」（名称取标题里的【…】短语；没有【】就用整条标题）。
// 为什么是 HTML 正则而不是接口：TapTap 的帖子列表是**服务端渲染**的 HTML，没有可用的公开 JSON；
//   页面上稳定的锚点是 `<a class="tap-router moment-article__link" href="/moment/…">` +
//   `span.moment-article__summary--title` + `div.chat-text-render` 的 `<p>`。
// 需宿主代理：HTML **无 ACAO**（`www.taptap.cn` 已登记进 PROXY_ALLOW_HOSTS）。
// 翻页：`PENGPENG_TAPTAP_PAGES = 2` —— 每页 10 帖，第 2 页能捞到仍在期、但公告早于最近 10 帖的活动
//   （实测「画廊夜游」10-29 ~ 11-12 就在第 2 页）；第 2 页抓挂不影响第 1 页结果。
// 口径：
//   · 只认 `活动时间：` 那一行（`更新时间：` 是维护窗口、`折扣时间：` 是商城折扣，都不算活动）
//   · 两端都要**自带年份**才解；只有 `10月29日 …` 的（如【家族遗藏】）**不解**——不猜当前年
//     （与 hlr 同一口径：没有年份来源就 nomatch，绝不拿"今年"顶）
//   · 起点「版本更新后 / 维护后」= **起点未知** ⇒ startTs = null（与 wd 同口径：不进外显、进悬停）
//   · 只有日期没有时分 ⇒ 起 00:00 / 止 23:59（仓库通用约定，同 bwiki `windowsFromCell` 注释）
//
// ── 时区 ──
// 源站无标注；时间写成 `05:00:00 ~ 04:59:59`（凌晨 5 点换池 + 结束前一秒），是国服 UTC+8 口径
// ⇒ tz = Asia/Shanghai（推定，只写在这里，不进悬停）。
//
// ── 卡池类型（category）──
// 「契约」列里有个 `遴选 / 活动` 标签（`<span class="ymzx-qiyue-tag">`），就是卡池类型；
// 长期池（`开放时间` 列写「长期」）没有这个标签 ⇒ 不写 category。
//
// ── 长期池（「长期的呼唤」「起始的契约」）──
// `开放时间` 列写 `长期` ⇒ 读不出窗口（`coversNow` 要求 endTs 非空），**如实跳过**：
// 没有结束时刻就算不出倒计时，画不出来。屏幕上的代价只是这两口常驻池不进日历。

		const PENGPENG_TZ = "Asia/Shanghai";
		const PENGPENG_BWIKI_URL = "https://wiki.biligame.com/pengpeng/api.php?action=parse&page=契约一览&prop=text&format=json&formatversion=2";
		// 活动侧旧源（现为 eventAltSources 手动备选）：bwiki `公告/` 前缀页列表
		const PENGPENG_EVENT_URL = "https://wiki.biligame.com/pengpeng/api.php?action=query&generator=allpages&gapprefix="
			+ encodeURIComponent("公告/") + "&gaplimit=100&format=json&formatversion=2";
		const PENGPENG_EVENT_OVERVIEW_RE = /版本活动总览$/;
		const PENGPENG_MAX_OVERVIEWS = 1;
		// 活动侧默认源：TapTap 官方 tab（国服）
		const PENGPENG_TAPTAP_URL = "https://www.taptap.cn/app/746164/topic?type=official";
		const PENGPENG_TAPTAP_REFERER = "https://www.taptap.cn/app/746164/topic?type=official";
		const PENGPENG_TAPTAP_PAGES = 2;

		// 「契约」列：名称住在最后一个加粗 span 里（长期池也有），类型标签是另一枚 span
		const PENGPENG_NAME_RE = /<span\b[^>]*style="[^"]*font-weight\s*:\s*bold[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
		const PENGPENG_TAG_RE = /<span\b[^>]*class="[^"]*ymzx-qiyue-tag[^"]*"[^>]*>([\s\S]*?)<\/span>/i;

		// 一行「契约」单元格 → { name, category }
		function pengpengNameOf(html) {
			const s = String(html == null ? "" : html);
			const tag = s.match(PENGPENG_TAG_RE);
			const category = tag ? stripTags(tag[1]).trim() : "";
			PENGPENG_NAME_RE.lastIndex = 0;
			let m, name = "";
			// 取**最后一个**加粗 span：角色的 `<span style="font-weight:bold">` 只出现在名称上，
			// 但取最后一个能顺带避开将来源站在前面再加别的加粗块。
			while ((m = PENGPENG_NAME_RE.exec(s))) name = stripTags(m[1]).trim();
			if (!name) {
				// 兜底：整格文本去掉类型标签（`遴选天才不必孑立` → `天才不必孑立`）
				name = stripTags(s).trim();
				if (category && name.indexOf(category) === 0) name = name.slice(category.length).trim();
			}
			return { name, category };
		}

		// HTML → 逐条 `{ banner, roles, category, startTs, endTs, raw, isMain }`（与 whmx 同形）
		function pengpengPoolsOf(html, tz) {
			const tables = ns_bwiki_findTablesByHeaders(ns_bwiki_eachTable(String(html == null ? "" : html)), ["契约", "开放时间"]);
			const out = [];
			let i = 0;
			for (const tbl of tables) {
				for (const r of ns_bwiki_tableRows(tbl)) {
					const cells = r.cells || [];
					if (cells.length < 3) continue;
					// 时间列交给 bwiki 系共用的日期解析（`2026/09/10 05:00:00 ~ 2026/09/24 04:59:59`）；
					// `长期` 只有一个点 ⇒ 返回 []，如实跳过（见文件头）。
					const win = ns_bwiki_windowsFromCell(cells[1].text, tz, "startFirst")[0];
					if (!win) continue;
					const { name, category } = pengpengNameOf(cells[0].html);
					if (!name) continue;
					out.push({
						banner: name,
						roles: ns_bwiki_linkTitles(cells[2].html).join("\u3001"),
						category,
						startTs: win.startTs,
						endTs: win.endTs,
						// 两份文本（约定见 `30-game-bwiki-common.js` 文件头）：
						//   raw = 源站原文那一句（`2026/09/10 05:00:00 ~ 2026/09/24 04:59:59`）
						//   display = 补全后的可读文本（`MM-DD HH:MM ~ MM-DD HH:MM`，源站 tz）
						// ⚠️ 原先这里把**格式化后**的字符串塞进 `raw` ⇒ 原文丢了、且与 display 同值。
						raw: win.raw,
						display: win.display,
						isMain: true,
						_i: i++
					});
				}
			}
			return out;
		}

		// 抓取器（契约：async (url, signal, tz) → 数据对象 | null；now 在最后、有默认值）
		// bwiki 是 biligame 系主机 ⇒ 必须走宿主代理（见 15-env.js 的 CORS 收口点）
		async function ns_pengpeng_gachaPengpeng(url, signal, tz = PENGPENG_TZ, now) {
			const html = await fetchMediaWikiText(url, { signal, mode: "proxy" });
			const items = pengpengPoolsOf(html, tz);
			if (items.length === 0) throw new Error("pengpeng-no-table");
			return ns_bwiki_batchGachaPayloadOf(items, tz, typeof now === "number" && Number.isFinite(now) ? now : nowMs(), { id: "pengpeng" });
		}

		// ── 活动侧：`公告/*` 版本活动总览 ────────────────────────────────────────
		function pengpengOverviewPagesOf(json) {
			if (!json || typeof json !== "object") throw new Error("pengpeng-bad-shape");
			const pages = json.query && json.query.pages;
			if (!Array.isArray(pages)) throw new Error("pengpeng-bad-list");
			return pages
				.map((p) => ({ title: String((p && p.title) || ""), pageid: Number(p && p.pageid) || 0 }))
				.filter((p) => p.title.indexOf("公告/") === 0 && PENGPENG_EVENT_OVERVIEW_RE.test(p.title))
				.sort((a, b) => b.pageid - a.pageid);
		}

		function pengpengOverviewUrl(title) {
			return "https://wiki.biligame.com/pengpeng/api.php?action=parse&page="
				+ encodeURIComponent(String(title)) + "&prop=wikitext&format=json&formatversion=2";
		}

		function pengpengWikitextOf(json) {
			if (!json || typeof json !== "object") throw new Error("pengpeng-bad-shape");
			const wt = json.parse && json.parse.wikitext;
			if (typeof wt !== "string") throw new Error("pengpeng-bad-wikitext");
			return wt;
		}

		// `'''◈「共举昨日之酒·上」版本签到'''<br>` → `「共举昨日之酒·上」版本签到`
		function pengpengHeadingOf(line) {
			const s = String(line == null ? "" : line).replace(/'''/g, "").replace(/◈/g, "");
			return stripTags(s).replace(/\s+/g, " ").trim();
		}

		// `2026/9/10 版本更新后` / `2026/9/12 5:00` / `2026/10/1 4:59`
		const PENGPENG_EVENT_POINT_RE = /(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*(\d{1,2})\s*[:：]\s*(\d{2}))?(?:\s*(版本更新后))?/g;
		const PENGPENG_EVENT_CONNECTOR_RE = /^\s*[-~～〜—–－至到]\s*$/;

		function pengpengEventPointsOf(text) {
			const s = String(text == null ? "" : text);
			const out = [];
			PENGPENG_EVENT_POINT_RE.lastIndex = 0;
			let m;
			while ((m = PENGPENG_EVENT_POINT_RE.exec(s))) {
				if (m[0] === "") { PENGPENG_EVENT_POINT_RE.lastIndex++; continue; }
				out.push({
					start: m.index,
					end: m.index + m[0].length,
					y: +m[1],
					mo: +m[2],
					d: +m[3],
					h: m[4] != null ? +m[4] : null,
					mi: m[5] != null ? +m[5] : null,
					open: m[6] === "版本更新后"
				});
			}
			return out;
		}

		// 一行「活动时间：…」→ 窗口事实（起点未知 = startTs null，display 保留「版本更新后」）
		function pengpengEventWindowsOf(text, tz = PENGPENG_TZ) {
			const s = String(text == null ? "" : text);
			const toks = pengpengEventPointsOf(s);
			const out = [];
			const seen = new Set();
			for (let i = 0; i + 1 < toks.length; i++) {
				const a = toks[i], b = toks[i + 1];
				if (!PENGPENG_EVENT_CONNECTOR_RE.test(s.slice(a.end, b.start))) continue;
				if (a.h == null && !a.open) continue;
				if (b.h == null) continue;
				const endY = a.y + (endsNextYear(a.mo, a.d, b.mo, b.d) ? 1 : 0);
				const startTs = a.open ? null : sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
				const endTs = sourceInstant(endY, b.mo, b.d, b.h, b.mi, tz);
				if (startTs != null && !(endTs > startTs)) continue;
				const key = (startTs == null ? "open" : startTs) + "|" + endTs;
				if (seen.has(key)) continue;
				seen.add(key);
				const aRaw = s.slice(a.start, a.end).replace(/\s+/g, " ").trim();
				const bRaw = s.slice(b.start, b.end).replace(/\s+/g, " ").trim();
				const endWall = sourceWallParts(endTs, tz);
				const startWall = a.open ? { y: a.y } : sourceWallParts(startTs, tz);
				const sameYear = startWall.y === endWall.y;
				const startText = a.open
					? (sameYear ? `${pad2(a.mo)}-${pad2(a.d)} 版本更新后` : `${a.y}-${pad2(a.mo)}-${pad2(a.d)} 版本更新后`)
					: (sameYear ? fmtMdHm(startTs, tz) : fmtYmdHm(startTs, tz));
				const endText = sameYear ? fmtMdHm(endTs, tz) : fmtYmdHm(endTs, tz);
				out.push({ startTs, endTs, raw: `${aRaw} ~ ${bRaw}`, display: `${startText} ~ ${endText}` });
			}
			return out;
		}

		// 一页 wikitext → 活动事实 [{ name, startTs, endTs, raw, display }]
		function pengpengOverviewActivitiesOf(wikitext, tz = PENGPENG_TZ) {
			const lines = String(wikitext == null ? "" : wikitext).split(/\r?\n/);
			const out = [], seen = new Set();
			let heading = "";
			for (const line of lines) {
				if (line.indexOf("◈") >= 0) heading = pengpengHeadingOf(line);
				if (line.indexOf("活动时间") < 0 || !heading) continue;
				for (const w of pengpengEventWindowsOf(line, tz)) {
					const key = heading + "|" + (w.startTs == null ? "open" : w.startTs) + "|" + w.endTs;
					if (seen.has(key)) continue;
					seen.add(key);
					out.push({ name: heading, ...w });
				}
			}
			return out;
		}

		async function fetchPengpengEvents(url, signal, tz = PENGPENG_TZ) {
			const at = nowMs();
			const listJson = await fetchJson(url || PENGPENG_EVENT_URL, { signal, mode: "proxy" });
			const pages = pengpengOverviewPagesOf(listJson);
			if (pages.length === 0) return null;
			const rows = [];
			let okCount = 0, firstHardErr = null;
			for (const page of pages.slice(0, PENGPENG_MAX_OVERVIEWS)) {
				let json;
				try {
					json = await fetchJson(pengpengOverviewUrl(page.title), { signal, mode: "proxy" });
				} catch (e) {
					if (!firstHardErr) firstHardErr = e;
					continue;
				}
				okCount++;
				for (const x of pengpengOverviewActivitiesOf(pengpengWikitextOf(json), tz)) rows.push(x);
			}
			if (okCount === 0) {
				if (firstHardErr) throw firstHardErr;
				return null;
			}
			if (rows.length === 0) return null;
			// 外显：两端都明确且覆盖 now（「版本更新后」那一批**不**进外显）
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
			out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "pengpeng", tz }, at);
			out.eventHoverItems = hoverItems;
			return out;
		}

		// ══ 活动侧（2026-11-10）：TapTap 官方 tab ═══════════════════════════════════
		// 页面形态（真夹具 pengpeng-taptap-official / -p2）：
		//   <a class="tap-router moment-article__link" href="/moment/866427359920655283?group_id=924367">
		//     <span class="moment-article__summary--title …">🍃【新风同行】限时活动 即将开启</span>
		//     <div class="chat-text-render …"><p class="">…<br>▸活动时间：2026年11月5日 05:00 - 2026年11月19日 04:59<br>…</p></div>
		//   </a>
		// ⇒ 逐帖切段：锚点用 `moment-article__link`（正文/标题都在它里面），标题取 summary--title，正文取 <p>。
		function pengpengTaptapPageUrl(base, page) {
			const u = String(base == null ? "" : base).trim() || PENGPENG_TAPTAP_URL;
			if (page <= 1) return u;
			return u + (u.includes("?") ? "&" : "?") + "page=" + page;
		}

		// HTML → [{ title, url, text }]（文档顺序 = 从新到旧）
		function pengpengTaptapPostsOf(html) {
			const s = String(html == null ? "" : html);
			const marks = [...s.matchAll(/<a\b[^>]*\bmoment-article__link\b[^>]*>/gi)].map((m) => {
				const href = /\bhref="([^"]*\/moment\/\d+[^"]*)"/i.exec(m[0]);
				return { index: m.index, href: href ? href[1] : "" };
			});
			const out = [];
			for (let i = 0; i < marks.length; i++) {
				const start = marks[i].index;
				const end = i + 1 < marks.length ? marks[i + 1].index : Math.min(s.length, start + 30000);
				const seg = s.slice(start, end);
				const t = /<span\b[^>]*class="[^"]*moment-article__summary--title[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(seg);
				const title = t ? decodeEntities(stripTags(t[1])).replace(/\s+/g, " ").trim() : "";
				const paras = [...seg.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
					.map((m) => decodeEntities(m[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")))
					.map((x) => x.replace(/[ \t\u00a0]+/g, " ").trim())
					.filter(Boolean);
				const text = paras.join("\n");
				if (!marks[i].href) continue;
				const url = /^https?:\/\//i.test(marks[i].href) ? marks[i].href : "https://www.taptap.cn" + marks[i].href;
				out.push({ title, url, text });
			}
			return out;
		}

		// 标题 → 活动名：`🍃【新风同行】限时活动 即将开启` → `新风同行`；没有【】⇒ 用整条标题
		function pengpengTaptapNameOf(title) {
			const s = String(title == null ? "" : title).replace(/\s+/g, " ").trim();
			const m = /【([^】]{2,30})】/.exec(s);
			return m ? m[1].trim() : s;
		}

		// 一行「活动时间：…」→ 窗口事实。
		// 支持：`2026年11月5日 05:00 - 2026年11月19日 04:59`（两端绝对）
		//       `2026年10月22日版本更新后 - 2026年12月3日 04:59`（起点相对 ⇒ startTs=null）
		//       `2026年11月5日 - 2026年11月19日`（只有日期 ⇒ 00:00 / 23:59）
		// ⚠️ 两端都必须**自带年份**：源站写 `10月29日 5:00 - 11月12日 04:59`（【家族遗藏】）时没有年份来源
		//    ⇒ 整条不解（不猜当前年，与 hlr 同口径）。raw 保留源站原文（分隔符统一成 `~`）。
		const PENGPENG_TAPTAP_POINT_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(\d{1,2})\s*[:：]\s*(\d{2})|(版本更新后|维护结束后|维护后|更新后))?/g;
		const PENGPENG_TAPTAP_CONNECTOR_RE = /^\s*[-~～〜—–－至到]\s*$/;

		function pengpengTaptapWindowsOf(text, tz = PENGPENG_TZ) {
			const s = String(text == null ? "" : text);
			const toks = [];
			PENGPENG_TAPTAP_POINT_RE.lastIndex = 0;
			let m;
			while ((m = PENGPENG_TAPTAP_POINT_RE.exec(s))) {
				if (m[0] === "") { PENGPENG_TAPTAP_POINT_RE.lastIndex++; continue; }
				toks.push({
					start: m.index, end: m.index + m[0].length,
					y: +m[1], mo: +m[2], d: +m[3],
					h: m[4] != null ? +m[4] : null,
					mi: m[5] != null ? +m[5] : null,
					rel: m[6] || ""
				});
			}
			const out = [];
			const seen = new Set();
			for (let i = 0; i + 1 < toks.length; i++) {
				const a = toks[i], b = toks[i + 1];
				if (!PENGPENG_TAPTAP_CONNECTOR_RE.test(s.slice(a.end, b.start))) continue;
				// 端点：起点 = 显式时刻 / 相对（未知）/ 只有日期（00:00）；终点 = 显式时刻 / 只有日期（23:59）
				const startTs = a.rel ? null : sourceInstant(a.y, a.mo, a.d, a.h == null ? 0 : a.h, a.mi == null ? 0 : a.mi, tz);
				const endTs = b.rel
					? null
					: sourceInstant(b.y, b.mo, b.d, b.h == null ? 23 : b.h, b.mi == null ? 59 : b.mi, tz);
				if (endTs == null) continue;                                    // 终点是相对表述 ⇒ 没有绝对时刻，丢掉
				if (startTs != null && !(endTs > startTs)) continue;
				const key = (startTs == null ? "open" : startTs) + "|" + endTs;
				if (seen.has(key)) continue;
				seen.add(key);
				const aRaw = s.slice(a.start, a.end).replace(/\s+/g, " ").trim();
				const bRaw = s.slice(b.start, b.end).replace(/\s+/g, " ").trim();
				const endWall = sourceWallParts(endTs, tz);
				const sameYear = a.y === endWall.y;
				const startText = startTs == null
					? (sameYear ? `${pad2(a.mo)}-${pad2(a.d)} ${a.rel}` : `${a.y}-${pad2(a.mo)}-${pad2(a.d)} ${a.rel}`)
					: (sameYear ? fmtMdHm(startTs, tz) : fmtYmdHm(startTs, tz));
				const endText = sameYear ? fmtMdHm(endTs, tz) : fmtYmdHm(endTs, tz);
				out.push({ startTs, endTs, raw: `${aRaw} ~ ${bRaw}`, display: `${startText} ~ ${endText}` });
			}
			return out;
		}

		// 一页 HTML → 活动事实 [{ name, url, startTs, endTs, raw, display }]
		function pengpengTaptapActivitiesOf(html, tz = PENGPENG_TZ) {
			const out = [];
			const seen = new Set();
			for (const post of pengpengTaptapPostsOf(html)) {
				const name = pengpengTaptapNameOf(post.title);
				for (const line of post.text.split("\n")) {
					if (!/活动时间\s*[:：]/.test(line)) continue;               // 更新时间/折扣时间不算活动
					for (const w of pengpengTaptapWindowsOf(line, tz)) {
						const key = name + "|" + (w.startTs == null ? "open" : w.startTs) + "|" + w.endTs;
						if (seen.has(key)) continue;
						seen.add(key);
						out.push({ name, url: post.url, ...w });
					}
				}
			}
			return out;
		}

		async function fetchPengpengTaptapEvents(url, signal, tz = PENGPENG_TZ) {
			const at = nowMs();
			const base = url || PENGPENG_TAPTAP_URL;
			const rows = [];
			let postCount = 0;
			for (let page = 1; page <= PENGPENG_TAPTAP_PAGES; page++) {
				let html;
				try {
					html = await fetchText(pengpengTaptapPageUrl(base, page), { signal, mode: "proxy", referer: PENGPENG_TAPTAP_REFERER });
				} catch (e) {
					if (page === 1) throw e;                                    // 第 1 页失败 = 真失败
					break;                                                      // 第 2 页失败 ⇒ 用第 1 页结果
				}
				const posts = pengpengTaptapPostsOf(html);
				postCount += posts.length;
				for (const x of pengpengTaptapActivitiesOf(html, tz)) rows.push(x);
			}
			// 有响应但一帖都没解析出来 = 页面结构变了 ⇒ 抛错（抓取失败 ≠ 未公布）
			if (postCount === 0) throw new Error("pengpeng-taptap:no-post");
			if (rows.length === 0) return null;
			// 外显 = **文档顺序里第一条覆盖 now 的**（列表从新到旧 ⇒ 最新公布的那条当期活动；
			// 与 hlr 的"第一条覆盖 now = 当前最新一期"同一口径）
			const live = rows.filter((r) => coversNow(r, at));
			if (live.length === 0) return null;
			const first = live[0];
			// 悬停 = 全部在期 / 起点未知但终点未过，按结束时间升序（与旧活动侧同一排版）
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
			out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "pengpeng", tz }, at);
			out.eventHoverItems = hoverItems;
			return out;
		}

		// ── 条目 ──
		registerSource({
			id: "pengpeng",
			defaultHidden: true,
			tz: PENGPENG_TZ,
			name: "夜幕之下",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/3f/59/95/3f599572-4d8c-f4f3-0270-1ee72e007926/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
			url: PENGPENG_BWIKI_URL,
			source: "Bwiki",
			// 活动侧默认源 = TapTap 官方 tab（国服）；旧 bwiki 公告源降为手动备选
			eventUrl: PENGPENG_TAPTAP_URL,
			eventSource: "TapTap 官方（国服）",
			eventAltSources: [
				{ label: "Bwiki 公告（wiki 数据滞后）", url: PENGPENG_EVENT_URL, fetcher: "pengpeng-bwiki" }
			]
		});

		GACHA_FETCHERS["pengpeng"] = (url, signal, tz) => ns_pengpeng_gachaPengpeng(url, signal, tz);
		EVENT_FETCHERS["pengpeng"] = {
			default: (url, signal, tz) => fetchPengpengTaptapEvents(url, signal, tz),
			"pengpeng-bwiki": (url, signal, tz) => fetchPengpengEvents(url, signal, tz)
		};
