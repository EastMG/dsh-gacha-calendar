// src/client/30-game-komoe.js —— 赛马娘 Pretty Derby **繁中服**（Komoe 官方公告；2026-11-11 接入）
//
// ── 源（1 次请求，卡池 + 活动同一份数据）───────────────────────────────────────
//   GET https://l11-web-api.komoejoy.com/game/website/content/107075/2/list?pageNum=1&pageSize=20&region=3
//     107075 = 赛马娘繁中服的游戏 id；`/2/list` 里的 2 = 公告频道；region=3 = 繁中区。
//     实测 2026-11-11：200 / application/json / 100 KB / 20 条（最新 2026-11-08）。
//     返回 `{ code:0, message:"success", data:[{ code, type, title, sub_title, tag, publish_time, rich_text }] }`
//       · `type`：2 = 公告（本文件只吃这个）；1 空 / 3 影像 / 4·5 不支持
//       · `publish_time` = **毫秒**（补年份的线索）；`rich_text` = 整篇公告的 HTML
//   ⚠️ 响应 `Access-Control-Allow-Origin` **只允许 `https://uma.komoejoy.com`** ⇒ DSH（`dsh-app://` 源）
//     里必须走宿主代理，且实测**必须带 Referer**（不带 ⇒ 源站侧拒绝）。宿主白名单见 `src/index.js`
//     的 `PROXY_ALLOW_HOSTS`（`l11-web-api.komoejoy.com`）。
//
// ── 时区 ──
//   源站墙钟即繁中服（UTC+8，无夏令时）⇒ `tz = Asia/Taipei`。只写在这里，**不进悬停**（方案 A）。
//
// ── 标题分流（标题是**唯一**的分类依据，不去正文猜）──────────────────────────────
//   ① 先剔三类"有标题、没档期"的稿：
//      · `機率公告`（「Pretty Derby轉蛋」與「支援卡片轉蛋」機率公告 —— 整篇是概率表，无期间）
//      · `每天1次 / 每日1次 / 免費轉蛋`（免费 10 连活动：正文里那段时间是**活动期**，不是卡池期）
//      · `結束`（「活動「訓練員技能測驗」結束！」：活动本体已结束，正文里只剩"报酬领取期"）
//   ② 卡池：标题含 `轉蛋` / `特選`（这两词是卡池稿的固定用词）。
//   ③ 活动：标题含 `活動` / `競賽` / `培育劇本` / `紀念`。
//      顺序很重要：`新培育劇本開幕轉蛋舉辦公告！` 同时含「轉蛋」与「培育劇本」——
//      它的正文/标题是**卡池**稿（培育剧本只是池名主题），所以 ② 必须排在 ③ 前面。
//   ④ `【預告】…`（实测 11-01 的卡池预告 + 10-28 的转蛋预告）与 `即將舉辦`（11-06 的传奇竞赛预告）：
//      正式稿一定在**同一页列表**里（实测 11-02 正式稿、11-07 正式稿）⇒ 预告稿整条丢掉，
//      否则同一口池会在悬停/数组里出现两行（标题不同、档期完全一样）。
//
// ── 正文区间（`rich_text`）────────────────────────────────────────────────────
//   档期写成「标签行 + 1~N 行区间」，实测两种：
//     举办期間
//     11/2 12:00 ～ 12/3 11:59                      ← 两端都明确
//     舉辦期間
//     10/29 維護結束後 ～ 11/23 11:59               ← **起点未知**（维护什么时候结束，源站写完就固定了）
//   解析口径：
//     · 只认**第一段**带区间的窗口块（`舉辦期間` / `特選期間` 两种标签）：一条公告 = 一条条目。
//       公告里后面那些 `販賣期間` / `領取報酬…期間` 是商店与报酬窗口，不是这条事项的档期。
//     · 同一个窗口块里的**多行区间全收**（实测「傳奇競賽舉辦中！」有两段：
//       11/7 12:00 ~ 11/10 4:59 与 11/10 5:00 ~ 11/13 4:59）—— 一条公告只取其中**一段**：
//       覆盖 now 的那段（startTs 最新）优先，都不覆盖时取结束最晚的那段。
//     · 起点写「維護結束後」⇒ **起点未知**（`startTs = null`）。按仓库口径
//       （24-parser-window.js 的 `coversNow` / `coveredOrOpen`）它**不算已开始**：
//       不进外显，只在悬停 / 数据数组里如实列出（`raw` 保留源站原文）。
//     · 区间里**没有年份**：用 `publish_time` 的年份补（共用 `inferYear`），
//       结束月日早于开始 ⇒ 记次年（共用 `endsNextYear`）。
//
// ── 输出（条目事实 → 悬停 + 数据数组）────────────────────────────────────────
//   条目事实形状：`{ key, title, show, startTs, endTs, tz, raw, display, source }`
//     · `key`     = 源站公告 `code`（诊断用；数据层会按 `<id>:gacha:i` 重发 key）
//     · `raw`     = 源站原文那一行（`11/2 12:00 ～ 12/3 11:59` / `10/29 維護結束後 ～ 11/23 11:59`）
//     · `display` = 补全后的可读文本（两端明确 ⇒ `MM-DD HH:MM ~ MM-DD HH:MM`，源站 tz；
//                   起点未知 ⇒ 与 `raw` 同值，**不编**一个时刻出来）
//   悬停由 **共用** `hoverTextFromItems` 生成、数组由 `dataArrayProducedGachaOf` /
//   `dataArrayProducedEventsOf` 生成 —— 排版与"谁算当期"都不在本文件各写一套（方案 A）。
//
// ── 卡池没有角色名 / 卡池名 ──
//   繁中服的公告标题就是"这一期卡池/活动"的唯一名字（例如「閃耀收藏 Pretty Derby轉蛋與保證SSR
//   意志力轉蛋舉辦公告！」），正文里那串 `★★★ [波浪間的綠寶石]無聲鈴鹿` 是**卡**而不是"卡池"。
//   与日服官方公告同口径：`banner` = 公告标题，`roles` 留空（不去正文猜角色，也不补前缀）。

		// ── 常量 ──
		const KOMOE_TW_TZ = "Asia/Taipei";
		const KOMOE_TW_URL = "https://l11-web-api.komoejoy.com/game/website/content/107075/2/list?pageNum=1&pageSize=20&region=3";
		// 实测：不带 Referer 时源站侧拒绝（ACAO 只放行 https://uma.komoejoy.com）
		const KOMOE_TW_REFERER = "https://uma.komoejoy.com/";
		const KOMOE_TW_SOURCE_LABEL = "Komoe 官方公告";
		// 只吃 `type: 2`（公告）；1 空 / 3 影像 / 4·5 不支持
		const KOMOE_TW_TYPE_NOTICE = 2;

		// 标题分流：先剔"有标题、没档期"的稿（判据见文件头 ①）
		const KOMOE_TW_DROP_TITLE_RE = /機率|概率|每天1次|每日1次|免費轉蛋|結束|預告|即將舉辦|即將登場|coming soon/i;
		// 卡池用词（必须先于活动判定，理由见文件头 ③）
		const KOMOE_TW_GACHA_TITLE_RE = /轉蛋|特選/;
		const KOMOE_TW_EVENT_TITLE_RE = /活動|競賽|培育劇本|紀念/;
		const KOMOE_TW_CARD_TITLE_RE = /卡片/;

		// 正文：窗口标签行 + 区间行（两种形态：两端明确 / 起点"維護結束後"）
		const KOMOE_TW_WINDOW_LABEL_RE = /舉辦期間|特選期間/;
		// `11/2 12:00 ～ 12/3 11:59`（全形「～」与半形「~」源站都在用）
		const KOMOE_TW_RANGE_RE = /^(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})\s*[～~]\s*(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})$/;
		// `10/29 維護結束後 ～ 11/23 11:59`（前缀日期是**维护那天**，起点仍然未知）
		const KOMOE_TW_OPEN_RANGE_RE = /^(\d{1,2})\/(\d{1,2})\s*(?:維護結束後|維護後|更新維護後|版本更新後|更新後|開服後)\s*[～~]\s*(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})$/;

		/** `rich_text` HTML → 逐行纯文本。`<br>` 与**块级**闭合标签算换行（`<td>` 靠空格），
		 *  再用共用 `htmlText` 解实体（`&nbsp;` / `&amp;` / 数字实体）。 */
		function komoeTwTextLinesOf(html) {
			const s = String(html == null ? "" : html)
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<\/(?:p|div|tr|li|ul|ol|h[1-6]|table|thead|tbody)>/gi, "\n");
			return htmlText(s)
				.split("\n")
				.map((x) => x.replace(/\s+/g, " ").trim())
				.filter(Boolean);
		}

		/** 列表 JSON → `[{ code, title, publishTs, html }]`（只留 `type: 2` 的公告，保持源站顺序）。
		 *  结构不对 **throw**（该侧如实报失败）；列表为空 = 未公布（返回 `[]`，不抛）。 */
		function komoeTwAnnouncementsOf(json) {
			if (!json || typeof json !== "object") throw new Error("komoe-tw-bad-json");
			if (numOrNull(json.code) !== 0) throw new Error("komoe-tw-bad-code:" + json.code);
			if (!Array.isArray(json.data)) throw new Error("komoe-tw-bad-list");
			const out = [];
			for (const it of json.data) {
				if (!it || typeof it !== "object") continue;
				if (numOrNull(it.type) !== KOMOE_TW_TYPE_NOTICE) continue;
				const title = String(it.title == null ? "" : it.title).replace(/\s+/g, " ").trim();
				const publishTs = numOrNull(it.publish_time);
				if (!title || publishTs == null) continue;
				out.push({ code: String(it.code == null ? "" : it.code), title, publishTs, html: String(it.rich_text == null ? "" : it.rich_text) });
			}
			return out;
		}

		/** 标题 → 该公告属于哪一侧（`"gacha"` / `"event"`）；不属于任何一侧 ⇒ `null`（判据见文件头）。 */
		function komoeTwSideOf(title) {
			const t = String(title == null ? "" : title);
			if (KOMOE_TW_DROP_TITLE_RE.test(t)) return null;
			if (KOMOE_TW_GACHA_TITLE_RE.test(t)) return "gacha";
			if (KOMOE_TW_EVENT_TITLE_RE.test(t)) return "event";
			if (KOMOE_TW_CARD_TITLE_RE.test(t)) return "gacha";
			return null;
		}

		/**
		 * 一行区间 → `{ startTs, endTs, raw, display }`；不是区间 / 年份线索缺失 ⇒ `null`。
		 * `hint` = 公告发布时刻的源站墙钟（`sourceWallParts(publishTs, tz)`），用于补年份。
		 */
		function komoeTwWindowOfLine(line, hint, tz) {
			const s = String(line == null ? "" : line).trim();
			let mo1, d1, h1, mi1, mo2, d2, h2, mi2, openStart = false;
			const m = KOMOE_TW_OPEN_RANGE_RE.exec(s);
			if (m) {
				// 起点「維護結束後」⇒ 起点未知：只解终点，`startTs` 留 null（仓库口径：起点未知 ≠ 已开始）
				mo1 = +m[1]; d1 = +m[2];
				mo2 = +m[3]; d2 = +m[4]; h2 = +m[5]; mi2 = +m[6];
				openStart = true;
			} else {
				const r = KOMOE_TW_RANGE_RE.exec(s);
				if (!r) return null;
				mo1 = +r[1]; d1 = +r[2]; h1 = +r[3]; mi1 = +r[4];
				mo2 = +r[5]; d2 = +r[6]; h2 = +r[7]; mi2 = +r[8];
			}
			const y1 = inferYear(null, mo1, hint);
			if (y1 == null) return null;                       // 拿不到年份线索 ⇒ 不猜（宁可这条不产出）
			const y2 = endsNextYear(mo1, d1, mo2, d2) ? y1 + 1 : y1;
			const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
			const startTs = openStart ? null : sourceInstant(y1, mo1, d1, h1, mi1, tz);
			if (startTs != null && !(endTs > startTs)) return null;
			return {
				startTs,
				endTs,
				raw: s,                                        // 源站原文那一行
				display: startTs == null ? s : fmtWindow(startTs, endTs, tz)   // 起点未知 ⇒ 不编时刻
			};
		}

		/**
		 * 一篇公告的正文 → 窗口数组（**只取第一段**带区间的窗口块，见文件头）。
		 * 标签行之后允许跨过少量非区间行（实测「指定競賽．舉辦期間．報酬」下面先是一行 `【天皇賞（秋）】`）。
		 */
		function komoeTwWindowsOf(html, publishTs, tz) {
			const hint = sourceWallParts(publishTs, tz);
			const lines = komoeTwTextLinesOf(html);
			const out = [];
			for (let i = 0; i < lines.length; i++) {
				if (!KOMOE_TW_WINDOW_LABEL_RE.test(lines[i])) continue;
				let miss = 0;
				for (let j = i + 1; j < lines.length && miss < 3; j++) {
					const w = komoeTwWindowOfLine(lines[j], hint, tz);
					if (w) { out.push(w); miss = 0; continue; }
					if (out.length) break;                 // 本块已收到区间 ⇒ 到下一行非区间就收工
					miss++;
				}
				if (out.length) break;                     // 只认第一段窗口块（见文件头）
			}
			return out;
		}

		/**
		 * 列表 JSON → 某一侧的**条目事实** `[{ key, title, show, startTs, endTs, tz, raw, display, source }]`。
		 * 一条公告 = 一条条目：多段窗口取"覆盖 now 的那段"，都不覆盖时取结束最晚的那段
		 * （后者仍会进悬停/数组 —— 起点未知的条目就靠这条路留下事实）。
		 */
		function komoeTwItemsOf(json, side, tz, now) {
			const out = [];
			for (const a of komoeTwAnnouncementsOf(json)) {
				if (komoeTwSideOf(a.title) !== side) continue;
				const wins = komoeTwWindowsOf(a.html, a.publishTs, tz);
				if (wins.length === 0) continue;            // 正文没有可解析区间 ⇒ 这条稿没有档期（不猜）
				const cover = wins.filter((w) => coversNow(w, now)).sort((x, y) => y.startTs - x.startTs)[0];
				const w = cover || wins.slice().sort((x, y) => y.endTs - x.endTs)[0];
				out.push({
					key: a.code,
					title: a.title,
					show: a.title,
					startTs: w.startTs,
					endTs: w.endTs,
					tz,
					raw: w.raw,
					display: w.display,
					source: "hover"
				});
			}
			return out;
		}

		/**
		 * 一侧的载荷（卡池 `banner` + `gacha`，或活动 `event` + `events`）：外显只取**两端都明确且覆盖 now** 的条目
		 * （起点未知的不进外显）；悬停/数组取 `coveredOrOpen`（在期 + 起点未知但终点未过）。
		 * 一条都没有 ⇒ `null`（未公布，绝不把过期/未来档期硬凑成"当期"）。
		 */
		function komoeTwPayloadOf(json, side, tz, now) {
			const isGacha = side === "gacha";
			const listed = komoeTwItemsOf(json, side, tz, now).filter((x) => coveredOrOpen(x, now));
			const primary = listed
				.filter((x) => coversNow(x, now))
				.sort((a, b) => (b.startTs - a.startTs) || (a.endTs - b.endTs))[0] || null;
			if (!primary) return null;
			// 悬停/数组的顺序：卡池按结束时间升序（与 `hoverPool` 同一份）；活动按仓库统一的 `sortEventItems`
			const entries = isGacha
				? listed.slice().sort(poolHoverOrderOf)
				: sortEventItems(listed.map((x) => Object.assign({}, x, { name: x.title })));
			const out = {};
			if (isGacha) {
				out.banner = primary.title;
				out.bannerDates = primary.display;          // 两端明确 ⇒ `MM-DD HH:MM ~ MM-DD HH:MM`
				out.bannerDatesRaw = primary.raw;
				out.startTs = primary.startTs;
				out.endTs = primary.endTs;
			} else {
				out.event = primary.title;
				out.eventDates = primary.display;
				out.eventDatesRaw = primary.raw;
			}
			const hover = hoverTextFromItems(entries, side, tz);
			if (hover) {
				if (isGacha) out.bannerHover = hover;
				else out.eventHover = hover;
			}
			if (isGacha) {
				out.gacha = dataArrayProducedGachaOf(out, entries, { tz }, now);
				out.gachaHoverItems = entries;
			} else {
				out.events = dataArrayProducedEventsOf(out, entries, { tz }, now);
				out.eventHoverItems = entries;
			}
			return out;
		}

		/** 抓取器：一次请求，两侧一起解（卡池载荷带 `event` ⇒ `fetchEntry` 复用同一份响应，不重复请求）。 */
		async function ns_komoe_fetchUmaTw(url, signal, tz = KOMOE_TW_TZ) {
			const json = await proxyFetchJson(url || KOMOE_TW_URL, KOMOE_TW_REFERER);
			const now = nowMs();
			const gacha = komoeTwPayloadOf(json, "gacha", tz, now);
			const events = komoeTwPayloadOf(json, "event", tz, now);
			if (!gacha && !events) return null;
			return Object.assign({}, gacha || {}, events || {});
		}

		// ── 条目 ──
		registerSource({
			id: "uma-tw",
			defaultHidden: false,
			tz: KOMOE_TW_TZ,
			name: "赛马娘·繁中服",
			// 与 uma-jp / uma-global 同款图标（同一款游戏的 App 图标；不另找 komoe 站外图片）
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/73/7c/0b/737c0b9b-6e90-8838-f0d3-fc7c576fbbad/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
			// 卡池与活动**同一条接口**（标题分流）：两侧 URL 相同 ⇒ 一次请求供两侧用
			url: KOMOE_TW_URL,
			source: KOMOE_TW_SOURCE_LABEL,
			eventUrl: KOMOE_TW_URL,
			eventSource: KOMOE_TW_SOURCE_LABEL
		});

		GACHA_FETCHERS["uma-tw"] = (url, signal, tz) => ns_komoe_fetchUmaTw(url, signal, tz);
		EVENT_FETCHERS["uma-tw"] = Object.assign(EVENT_FETCHERS["uma-tw"] || {}, { default: (url, signal, tz) => ns_komoe_fetchUmaTw(url, signal, tz) });
