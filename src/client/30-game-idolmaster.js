// src/client/30-game-idolmaster.js —— アイドルマスター（偶像大师）系列 5 款（2026-11-15 接入）
//
//   学園アイドルマスター（gakumas） / シャイニーカラーズ（shinycolors） /
//   ミリオンライブ！シアターデイズ（millisita） / シンデレラガールズ スターライトステージ（deresute）/
//   シャイニーカラーズ Song for Prism（shanison，2026-11-15 追加）
//   全部日服，tz = Asia/Tokyo（JST，无夏令时）；每款一个条目，卡池 + 活动**两侧**都接。
//
// ── 先说结论：为什么默认源不是官网公告 ────────────────────────────────────────
//   原本四款的「官网」都实测过（2026-11-15，均为 HTTP 200；第 5 款 シャニソン 的判据见下节）：
//     · gakuen.idolmaster-official.jp            —— WordPress。`wp-json/wp/v2/posts` 只有 11 条
//       媒体素材（fankit / comic 页面），没有游戏内公告；`/news/` 直接回落到首页。
//     · shinycolors.idolmaster-official.jp       —— 纯静态宣传站（story / idol / movie 链接），
//       没有 news 路径（旧域 shinycolors.idolmaster.jp/news/ 301 到首页；robots.txt 403）。
//     · millionlive-theaterdays.idolmaster-official.jp —— 同款静态宣传站，`/news/` 是 404。
//     · cinderellagirls.idolmaster-official.jp   —— WordPress。`news` 自定义 post type 是
//       **ポータル新闻的镜像**（列表项直接外链 `idolmaster-official.jp/news/01_xxxxx`），
//       `event` post type 是线下活动（xR LIVE / 联名咖啡），不是游戏内。
//   系列统一新闻/日程在 `idolmaster-official.jp` 的 CMS API（Next.js；`/sitern/api/cmsbase/Token/get`
//   → `/sitern/api/idolmaster/Article/list`）。逐 brand 实测：
//     · `category:["SCHEDULE"]` 的 `article_list[]` 有 `title` + `event_startdate`/`event_enddate`
//       （官方、含时刻），但内容是**线下**联动/物贩/生放送/radio；全年 `subcategory:["GAME"]`
//       每 brand 只有 2~10 条且全是生放送（GAKUEN 全年 2 条，都是 #APラウンジ 配信）。
//     · `category:["NEWS"]` 是物贩/直播/联动公告。**仅ミリシタ**例外：GAME 子类里有
//       「期間限定イベント…を開催中！」（活动名 + 结束时刻），但起点写「開催中」⇒ 起点未知，
//       按仓库口径（起点未知不进外显）构不成可用窗口。其余三款的卡池/活动只发在**游戏内**
//       （アプリ内お知らせ），网页没有。
//   ⇒ 官方站拿不到「游戏内卡池/活动 + 起止」。按「某款找不到源就不做该款」本来这几款都该放弃；
//     但实测社区汇总站 **melonpapapapa-n.com** 的「イベント・ガシャ開催スケジュール一覧」各款都有
//     逐条 `日程（起止到分） + 概要（名称）`，且卡池/活动分类明确（cat-gacha / cat-event），
//     是这套系列**唯一**覆盖全系列且起止到分的源（Game8 只有ガチャ履歴且只到日；GameWith
//     没有对应页；官方ポータル没有游戏内日程）。所以五款都接它，来源标签逐字 =
//     `melonpapapapa 総合カレンダー（日文）`（源站文案本身是日文原文 ⇒ 按 2026-11-15 用户口径
//     统一加「（日文）」后缀；设置页可见；报告里也逐字列出）。条目 `name` 保持日文原名，**不加**后缀。
//
// ── 第 5 款是怎么定的（2026-11-15 实测，不猜）──────────────────────────────────
//   源站品牌代号实测 5 个：`gm` / `sc` / `ml` / `cgss` / **`ss`**。`ss` 页真实存在：
//     GET https://melonpapapapa-n.com/imas_ss_202611/  → 200 / text/html; charset=UTF-8 / 708042 B
//   页面 `<title>` = 「【シャニソン】2026年11月 イベント・ガシャ開催スケジュール一覧【11/14更新】」
//   （`シャニソン` = シャイニーカラーズ Song for Prism 的官方简称），表 class =
//   `imas-calendar-table simple-mode brand-shanison` —— 与 gm/sc/ml/cgss **完全同构**：
//   表头 `日程 | 概要`；每行 `date-line start/end` 各含 `d-text`（M/D）+ `t-text`（H:MM）；
//   `event-badge cat-*` + `title-simple`；行内同样是游戏内卡池/活动 + 起止到分。
//   ⇒ `ss` = **シャイニーカラーズ Song for Prism**（サイスタ/シャニソン），**不是** スターリットシーズン
//     （后者不在 melonpapapapa 的品牌代号里，且本页标题直接写死「シャニソン」）。
//   本款配色也取源站自己的 brand 色（`.hub-month-card.brand-shanison { border-color:#28B4E5; }`）。
//
// ── 源（每款一个月份页；HTML）────────────────────────────────────────────────
//   GET https://melonpapapapa-n.com/imas_{gm|sc|ml|cgss|ss}_YYYYMM/
//       200 / text/html; charset=UTF-8 / 620~730 KB（实测 2026-11-15）；**无 ACAO** ⇒ 走宿主代理。
//       本款那份表：`<table class='imas-calendar-table simple-mode brand-<brand>'>`
//       （brand class 见 IMAS_BRANDS），表头「日程 | 概要」，每行 `<tr class='calendar-row …'>`：
//         · `<td class='cal-date'>` 里两个 `<div class='date-line start|end'>`，各含
//           `<span class='d-text'>M/D</span>` + `<span class='t-text'>H:MM</span>`（JST 墙钟）；
//         · `<td class='cal-content'>` 里 `<span class='event-badge cat-…'>` + 名称。
//       cat-gacha ⇒ 卡池侧；cat-event ⇒ 活动侧；其余（ショップ / ログボ / メンテ / キャンペーン /
//       ミッション / その他）**一律不进** —— 面板的「活动」列是游戏内活动，不是商店/登录奖励。
//
// ── 请求数（每款）────────────────────────────────────────────────────────────
//   月份页 **1 次**（当月）。两种情况下会多抓**上一月页**（合计 2 次）：
//     ① 当月页两侧都没有覆盖 now 的条目（月初 —— 跨月池/活动只在上一月页里带完整起点，
//        例如 10/28~11/6）；
//     ② 当月页还没发布 / 取不到（月初页面可能尚未建好）⇒ 直接用上一月页兜底；
//        两个都取不到才抛。
//   ⇒ 稳态 1 次，月初那几天 2 次。卡池与活动同一条地址、一次抓取同时产出两侧字段 ⇒ 轮内只抓一次
//   （round cache，同 wxnn）。没有详情请求、没有详情缓存。
//
// ── 失败语义 ────────────────────────────────────────────────────────────────
//   · 找不到本款表 ⇒ 抛 `imas-<brand>-no-table`（结构变了，不是「未公布」）；
//   · 表在、也有 cat-gacha/cat-event 行，但一条窗口都拼不出来 ⇒ 抛 `imas-<brand>-rows-changed`
//     （日期锚点结构变了 —— 绝不静默成「本期没有卡池」）；
//   · 当月页没覆盖 + 上月页取不到 ⇒ 只用当月页（跨月补抓只是优化，不是腿）→ 无覆盖 ⇒ null；
//   · 当月页取不到 + 上月页也取不到 ⇒ 抛（真失败；用当月页那个错当原因）；
//   · 有数据但没有覆盖 now 的 ⇒ null（未公布）。
//
// ── 口径 ────────────────────────────────────────────────────────────────────
//   · 条目事实 `{ name, startTs, endTs, raw }`；raw = 源站原样的 `M/D H:MM ~ M/D H:MM`。
//     startTs/endTs 由**该月份页的年份** + JST 墙钟换算（跨年走共用 `endsNextYear`）。
//   · 一行脏数据（结束早于开始；实测 ml-202611 有一条 `11/14 13:00 -> 10/30 23:59`）⇒ 整行丢弃。
//   · 卡池侧剔掉 cat-gacha 里被误分类的赠品（名称含「プレゼント」，实测 gm-202611 有一条
//     「名刺背景…プレゼント」）；活动侧剔掉同一活动的「…折り返し期間」（下半场子区间，与正篇同窗、
//     重复 —— 实测 ml-202610 的「プラチナスターチューン…折り返し期間」）。
//   · 当期 = `coversNow`（两端都要明确）里**结束最早**的那条；悬停/数组 = `coveredOrOpen`，
//     排序走共用 `poolHoverOrderOf` / `sortEventItems` —— 与仓库其它来源同一套判据，不另写。

		// ── 常量 ──
		const IMAS_TZ = "Asia/Tokyo";
		const IMAS_ORIGIN = "https://melonpapapapa-n.com";
		const IMAS_REFERER = "https://melonpapapapa-n.com/";
		const IMAS_SOURCE_LABEL = "melonpapapapa 総合カレンダー（日文）";
		// cat-gacha 里的赠品（不是池）。实测只有 1 条，但进悬停会让人以为它是池。
		const IMAS_GACHA_SKIP_RE = /プレゼント/;
		// cat-event 里的下半场子区间（同一活动重复一段，且与正篇同窗）。
		const IMAS_EVENT_SKIP_RE = /折り返し期間\s*$/;

		// 五款的 slug（月份页路径前缀）+ 表里的 brand class（`brand-<cls>`）+ 面板名（日文原名）
		const IMAS_BRANDS = {
			gakumas: { slug: "imas_gm", cls: "brand-gakumasu", name: "学园偶像大师" },
			shinycolors: { slug: "imas_sc", cls: "brand-shanimas", name: "偶像大师 闪耀色彩" },
			millisita: { slug: "imas_ml", cls: "brand-mirishita", name: "偶像大师 百万现场 剧场时光" },
			deresute: { slug: "imas_cgss", cls: "brand-deresute", name: "偶像大师 灰姑娘女孩 星光舞台" },
			// 2026-11-15 追加：源站代号 `ss`，页面标题写「シャニソン」、brand class = brand-shanison。
			// 与上面的 shinycolors（シャニマス，brand-sc）是**同一系列的两个不同游戏**，id 不复用。
			shanison: { slug: "imas_ss", cls: "brand-shanison", name: "偶像大师 闪耀色彩 Song for Prism" }
		};

		const IMAS_ROW_RE = /<tr class='calendar-row[\s\S]*?<\/tr>/g;
		const IMAS_START_BLOCK_RE = /<div class='date-line start'>([\s\S]*?)<\/div>/;
		const IMAS_END_BLOCK_RE = /<div class='date-line end'>([\s\S]*?)<\/div>/;
		const IMAS_DTEXT_RE = /<span class='d-text'>([^<]*)<\/span>/;
		const IMAS_TTEXT_RE = /<span class='t-text'>([^<]*)<\/span>/;
		const IMAS_BADGE_RE = /event-badge (cat-[\w-]+)[^>]*>([^<]*)</;
		const IMAS_TITLE_RE = /<span class='title-simple'>([\s\S]*?)<\/span>/;
		const IMAS_MD_RE = /^(\d{1,2})\/(\d{1,2})$/;
		const IMAS_HM_RE = /^(\d{1,2}):(\d{2})$/;

		// 轮内缓存：brand → { seq, promise }（卡池/活动两侧同一轮只抓一次）
		const IMAS_ROUND_CACHE = {};

		// ── 月份页地址 ──
		function imasMonthUrlOf(slug, year, mo) {
			return IMAS_ORIGIN + "/" + slug + "_" + year + String(mo).padStart(2, "0") + "/";
		}

		// 上一个自然月（1 月 → 上一年 12 月）
		function imasPrevMonthOf(year, mo) {
			return mo <= 1 ? { y: year - 1, mo: 12 } : { y: year, mo: mo - 1 };
		}

		// **注册用**地址：引擎创建那一刻的当月页（真实存在、可点开；抓取器自己按 now 现算月份，不读它）
		function imasMonthUrlNow(brandKey) {
			const w = sourceWallParts(nowMs(), IMAS_TZ);
			return imasMonthUrlOf(IMAS_BRANDS[brandKey].slug, w.y, w.mo);
		}

		// ── 页面 → 本款表 ──
		function imasTableOf(html, brandKey) {
			const brand = IMAS_BRANDS[brandKey];
			if (!brand) return "";
			const re = new RegExp("<table class='imas-calendar-table[^']*" + brand.cls + "[^']*'>[\\s\\S]*?</table>");
			const m = re.exec(String(html == null ? "" : html));
			return m ? m[0] : "";
		}

		// ── 行内小字段 ──
		function imasMonthDayOf(text) {
			const m = IMAS_MD_RE.exec(String(text == null ? "" : text).trim());
			return m ? { mo: Number(m[1]), d: Number(m[2]) } : null;
		}

		function imasClockOf(text) {
			const m = IMAS_HM_RE.exec(String(text == null ? "" : text).trim());
			return m ? { h: Number(m[1]), mi: Number(m[2]) } : null;
		}

		/** 一个 `date-line` 块 → `{ mo, d, h, mi }`；缺日期或时刻 ⇒ null（无锚点就不产出条目）。 */
		function imasDateOf(block) {
			if (!block) return null;
			const day = imasMonthDayOf((IMAS_DTEXT_RE.exec(block) || [])[1]);
			const clock = imasClockOf((IMAS_TTEXT_RE.exec(block) || [])[1]);
			if (!day || !clock) return null;
			return { mo: day.mo, d: day.d, h: clock.h, mi: clock.mi };
		}

		/** 两端墙钟 → `{ startTs, endTs, raw }`；任一端缺 / 脏数据（结束早于开始）⇒ null。 */
		function imasWindowOf(start, end, year, tz) {
			if (!start || !end) return null;
			const rollover = endsNextYear(start.mo, start.d, end.mo, end.d);
			// 真正的跨年只可能出现在「12 月页里的 12 月 → 次年 1 月」这一种（1 月页的跨月条目
			// 起点是空的、会被上面丢掉；完整区间在 12 月页里）。其它「结束早于开始」都是源站脏行
			//（实测 ml-202611 有一条 `11/14 13:00 -> 10/30 23:59`）—— 硬按 year+1 会变成 350 天窗口，
			// 所以这里整行丢弃，比编一个假窗口诚实。
			if (rollover && !(start.mo === 12 && end.mo === 1)) return null;
			const startTs = sourceInstant(year, start.mo, start.d, start.h, start.mi, tz);
			const endYear = rollover ? year + 1 : year;
			const endTs = sourceInstant(endYear, end.mo, end.d, end.h, end.mi, tz);
			if (!(endTs > startTs)) return null;
			const hm = (x) => String(x.h).padStart(2, "0") + ":" + String(x.mi).padStart(2, "0");
			return {
				startTs,
				endTs,
				raw: start.mo + "/" + start.d + " " + hm(start) + " ~ " + end.mo + "/" + end.d + " " + hm(end)
			};
		}

		/**
		 * 本款表 → `{ gacha: [{ name, startTs, endTs, raw }], events: [...] }`。
		 * year = 该月份页的年份（月份页 URL 里的 YYYY；不靠"本机今年"猜）。
		 * · 无表 ⇒ 抛 `imas-<brand>-no-table`（抓取器里判，这里只管表内容）；
		 * · 有 cat-gacha/cat-event 行却一条窗口都拼不出来 ⇒ 抛 `imas-<brand>-rows-changed`。
		 */
		function imasItemsFromTable(tableHtml, brandKey, year, tz) {
			const out = { gacha: [], events: [] };
			const rows = String(tableHtml == null ? "" : tableHtml).match(IMAS_ROW_RE) || [];
			let eligible = 0;
			for (const row of rows) {
				const badge = IMAS_BADGE_RE.exec(row);
				if (!badge) continue;
				const isGacha = badge[1] === "cat-gacha";
				const isEvent = badge[1] === "cat-event";
				if (!isGacha && !isEvent) continue;               // ショップ/ログボ/メンテ…一律不进
				const tm = IMAS_TITLE_RE.exec(row);
				if (!tm) continue;
				const name = htmlTextTight(tm[1]);
				if (!name) continue;
				eligible++;
				if (isGacha && IMAS_GACHA_SKIP_RE.test(name)) continue;
				if (isEvent && IMAS_EVENT_SKIP_RE.test(name)) continue;
				const start = imasDateOf((IMAS_START_BLOCK_RE.exec(row) || [])[1]);
				const end = imasDateOf((IMAS_END_BLOCK_RE.exec(row) || [])[1]);
				const win = imasWindowOf(start, end, year, tz);
				if (!win) continue;                               // 缺锚点 / 脏行 ⇒ 该条不产出
				(isGacha ? out.gacha : out.events).push({ name, startTs: win.startTs, endTs: win.endTs, raw: win.raw });
			}
			if (eligible > 0 && out.gacha.length + out.events.length === 0) {
				throw new Error("imas-" + brandKey + "-rows-changed");
			}
			return out;
		}

		// ── 抓取：当月页（必要时补上月页）──
		function imasDedupeItems(items) {
			const seen = new Set();
			const out = [];
			for (const x of Array.isArray(items) ? items : []) {
				const key = x.name + "|" + x.startTs + "|" + x.endTs;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push(x);
			}
			return out;
		}

		function imasMergeItems(a, b) {
			return {
				gacha: imasDedupeItems([].concat((a && a.gacha) || [], (b && b.gacha) || [])),
				events: imasDedupeItems([].concat((a && a.events) || [], (b && b.events) || []))
			};
		}

		async function imasMonthItemsOf(brandKey, year, mo, tz) {
			const url = imasMonthUrlOf(IMAS_BRANDS[brandKey].slug, year, mo);
			const html = await proxyFetchText(url, IMAS_REFERER);
			const table = imasTableOf(html, brandKey);
			if (!table) throw new Error("imas-" + brandKey + "-no-table");   // 结构变了（不是"未公布"）
			return imasItemsFromTable(table, brandKey, year, tz);
		}

		function imasCoversAny(items, now) {
			return (Array.isArray(items) ? items : []).some((x) => coversNow(x, now));
		}

		async function imasCollect(brandKey, tz) {
			const now = nowMs();
			const wall = sourceWallParts(now, tz);
			const prev = imasPrevMonthOf(wall.y, wall.mo);
			let items = null;
			let curErr = null;
			try {
				items = await imasMonthItemsOf(brandKey, wall.y, wall.mo, tz);
			} catch (err) {
				curErr = err;   // 当月页还没发布（月初）/ 结构变 —— 先记下，下面尝试上一月页
			}
			if (!items) {
				// 结构错（`imas-*`）⇒ **立刻抛**，绝不拿上一月页掩盖「页面改版」；
				// 只有"当月页还没发布 / 取不到"（传输层错）才用上一月页兜底。
				if (curErr && /^imas-/.test(String(curErr.message || ""))) throw curErr;
				// 当月页取不到 ⇒ 用上一月页兜底（跨月条目本来也只在上一月页里带完整起点）；
				// 两个都取不到才抛（真失败，用当月页那个错当原因）。
				try {
					items = await imasMonthItemsOf(brandKey, prev.y, prev.mo, tz);
				} catch (err2) {
					throw curErr || err2;
				}
			} else if (!imasCoversAny(items.gacha, now) && !imasCoversAny(items.events, now)) {
				// 当月页在、但两侧都没有覆盖 now 的条目 ⇒ 补抓上一月（跨月条目只在上一月页里
				// 带完整起点）。上一月页取不到**不当整侧失败**：那只是优化没命中，本月页照用 → 无覆盖即 null。
				try {
					items = imasMergeItems(items, await imasMonthItemsOf(brandKey, prev.y, prev.mo, tz));
				} catch { /* 跨月补抓失败 ⇒ 只用当月页 */ }
			}
			return items;
		}

		// 轮内复用：卡池侧那次抓完，活动侧直接拿同一个 promise（不重复发请求）。
		function imasCollectInRound(brandKey, tz) {
			const round = fetchRoundActive() ? fetchRoundSeqOf() : -1;
			const hit = IMAS_ROUND_CACHE[brandKey];
			if (round > 0 && hit && hit.seq === round) return hit.promise;
			const promise = imasCollect(brandKey, tz);
			if (round > 0) {
				IMAS_ROUND_CACHE[brandKey] = { seq: round, promise };
				promise.catch(() => {
					const cur = IMAS_ROUND_CACHE[brandKey];
					if (cur && cur.promise === promise) delete IMAS_ROUND_CACHE[brandKey];
				});
			}
			return promise;
		}

		// ── 条目事实 → 载荷（与 wxnn 同一套：当期 → 悬停 → 数组收口）──
		function imasSidePayloadOf(list, side, id, tz, now) {
			const isGacha = side === "gacha";
			const listed = (Array.isArray(list) ? list : []).filter((x) => coveredOrOpen(x, now));
			const primary = listed.filter((x) => coversNow(x, now))
				.sort((a, b) => (a.endTs - b.endTs) || (b.startTs - a.startTs))[0] || null;
			if (!primary) return null;
			const entries = isGacha ? listed.slice().sort(poolHoverOrderOf) : sortEventItems(listed);
			const hoverItems = entries.map((x) => (isGacha
				? { title: x.name, label: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }
				: { title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
			const out = {};
			if (isGacha) {
				out.banner = primary.name;
				out.roles = "";
				out.bannerDates = fmtWindow(primary.startTs, primary.endTs, tz);
				out.bannerDatesRaw = primary.raw;
				out.startTs = primary.startTs;
				out.endTs = primary.endTs;
			} else {
				out.event = primary.name;
				out.eventDates = fmtWindow(primary.startTs, primary.endTs, tz);
				out.eventDatesRaw = primary.raw;
			}
			const hover = hoverTextFromItems(hoverItems, side, tz);
			if (hover) {
				if (isGacha) out.bannerHover = hover;
				else out.eventHover = hover;
			}
			if (isGacha) {
				out.gacha = dataArrayProducedGachaOf(out, hoverItems, { id, tz }, now);
				out.gachaHoverItems = hoverItems;
			} else {
				out.events = dataArrayProducedEventsOf(out, hoverItems, { id, tz }, now);
				out.eventHoverItems = hoverItems;
			}
			return out;
		}

		async function imasFetchBrand(brandKey, tz) {
			const tzUse = tz || IMAS_TZ;
			const items = await imasCollectInRound(brandKey, tzUse);
			const now = nowMs();
			const g = imasSidePayloadOf(items.gacha, "gacha", brandKey, tzUse, now);
			const e = imasSidePayloadOf(items.events, "event", brandKey, tzUse, now);
			if (!g && !e) return null;
			return Object.assign({}, g || {}, e || {});
		}

		const imasFetchGakumas = (url, signal, tz) => imasFetchBrand("gakumas", tz);
		const imasFetchShinycolors = (url, signal, tz) => imasFetchBrand("shinycolors", tz);
		const imasFetchMillisita = (url, signal, tz) => imasFetchBrand("millisita", tz);
		const imasFetchDeresute = (url, signal, tz) => imasFetchBrand("deresute", tz);
		const imasFetchShanison = (url, signal, tz) => imasFetchBrand("shanison", tz);

		// ── 条目（每款一个；卡池/活动两侧同一条月份页 ⇒ 一次抓取出两侧）──
		registerSource({
			id: "gakumas",
			defaultHidden: false,
			tz: IMAS_TZ,
			name: IMAS_BRANDS.gakumas.name,
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/5b/59/eb/5b59ebf6-a9a2-2910-689d-8ff5aa701a7d/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
			url: imasMonthUrlNow("gakumas"),
			source: IMAS_SOURCE_LABEL,
			eventUrl: imasMonthUrlNow("gakumas"),
			eventSource: IMAS_SOURCE_LABEL
		});

		registerSource({
			id: "shinycolors",
			defaultHidden: false,
			tz: IMAS_TZ,
			name: IMAS_BRANDS.shinycolors.name,
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/11/19/b8/1119b834-8edd-e733-1217-12f5b734322c/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
			url: imasMonthUrlNow("shinycolors"),
			source: IMAS_SOURCE_LABEL,
			eventUrl: imasMonthUrlNow("shinycolors"),
			eventSource: IMAS_SOURCE_LABEL
		});

		registerSource({
			id: "millisita",
			defaultHidden: false,
			tz: IMAS_TZ,
			name: IMAS_BRANDS.millisita.name,
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/0d/79/21/0d79214a-6b7b-8531-a0a5-1c227e489261/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
			url: imasMonthUrlNow("millisita"),
			source: IMAS_SOURCE_LABEL,
			eventUrl: imasMonthUrlNow("millisita"),
			eventSource: IMAS_SOURCE_LABEL
		});

		registerSource({
			id: "deresute",
			defaultHidden: false,
			tz: IMAS_TZ,
			name: IMAS_BRANDS.deresute.name,
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/95/36/dc/9536dc9f-1d5a-7b64-f7a5-1a4fd470583f/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
			url: imasMonthUrlNow("deresute"),
			source: IMAS_SOURCE_LABEL,
			eventUrl: imasMonthUrlNow("deresute"),
			eventSource: IMAS_SOURCE_LABEL
		});

		// 第 5 款：シャイニーカラーズ Song for Prism（源站代号 `ss`）—— 与上面 4 条**同一套**注册形态。
		registerSource({
			id: "shanison",
			defaultHidden: false,
			tz: IMAS_TZ,
			name: IMAS_BRANDS.shanison.name,
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/20/82/40/20824063-1832-1507-cf62-49460a12cbb0/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
			url: imasMonthUrlNow("shanison"),
			source: IMAS_SOURCE_LABEL,
			eventUrl: imasMonthUrlNow("shanison"),
			eventSource: IMAS_SOURCE_LABEL
		});

		GACHA_FETCHERS["gakumas"] = imasFetchGakumas;
		GACHA_FETCHERS["shinycolors"] = imasFetchShinycolors;
		GACHA_FETCHERS["millisita"] = imasFetchMillisita;
		GACHA_FETCHERS["deresute"] = imasFetchDeresute;
		GACHA_FETCHERS["shanison"] = imasFetchShanison;
		EVENT_FETCHERS["gakumas"] = Object.assign(EVENT_FETCHERS["gakumas"] || {}, { default: imasFetchGakumas });
		EVENT_FETCHERS["shinycolors"] = Object.assign(EVENT_FETCHERS["shinycolors"] || {}, { default: imasFetchShinycolors });
		EVENT_FETCHERS["millisita"] = Object.assign(EVENT_FETCHERS["millisita"] || {}, { default: imasFetchMillisita });
		EVENT_FETCHERS["deresute"] = Object.assign(EVENT_FETCHERS["deresute"] || {}, { default: imasFetchDeresute });
		EVENT_FETCHERS["shanison"] = Object.assign(EVENT_FETCHERS["shanison"] || {}, { default: imasFetchShanison });
