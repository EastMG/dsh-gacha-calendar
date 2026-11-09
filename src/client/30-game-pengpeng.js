// src/client/30-game-pengpeng.js —— 夜幕之下（国服；曾用名「代号砰砰」，2026-06-05 公测）
//
// **只有卡池源**（2026-11-09 实测 200，夹具 test/fixtures/pengpeng-bwiki）：
//   bwiki「契约一览」= MediaWiki `api.php?action=parse`（HTML 表，18 行 / 45KB）
//     列：契约 | 开放时间 | 概率提升的风格
//     行例：隐秘的归属 | 2026/09/10 05:00:00 ~ 2026/10/01 04:59:59 | 杯中藏锋 | 活动
//
// ── 活动侧（2026-11-09 接入）：bwiki `公告/` 前缀页 ───────────────────────────
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
//    **绝不**把九月档期当成"当前活动"。设置页/失败横条里的来源标签写明
//    「Bwiki 公告（wiki 数据滞后）」—— 停更的是 wiki，不是游戏，不要标成"暂停"。
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
		// 活动侧：`公告/` 前缀页列表（`gapprefix` 里的 `/` 编码成 `%2F`，MediaWiki 解成同一个值）
		const PENGPENG_EVENT_URL = "https://wiki.biligame.com/pengpeng/api.php?action=query&generator=allpages&gapprefix="
			+ encodeURIComponent("公告/") + "&gaplimit=100&format=json&formatversion=2";
		const PENGPENG_EVENT_OVERVIEW_RE = /版本活动总览$/;
		const PENGPENG_MAX_OVERVIEWS = 1;

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

		// ── 条目 ──
		registerSource({
			id: "pengpeng",
			defaultHidden: true,
			tz: PENGPENG_TZ,
			name: "夜幕之下",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/3f/59/95/3f599572-4d8c-f4f3-0270-1ee72e007926/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
			url: PENGPENG_BWIKI_URL,
			source: "Bwiki",
			eventUrl: PENGPENG_EVENT_URL,
			// 标签如实写「wiki 数据滞后」：停更的是社区 wiki，不是游戏（见文件头）
			eventSource: "Bwiki 公告（wiki 数据滞后）"
		});

		GACHA_FETCHERS["pengpeng"] = (url, signal, tz) => ns_pengpeng_gachaPengpeng(url, signal, tz);
		EVENT_FETCHERS["pengpeng"] = {
			default: (url, signal, tz) => fetchPengpengEvents(url, signal, tz)
		};
