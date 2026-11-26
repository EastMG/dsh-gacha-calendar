// src/client/30-game-kuro.js —— 库洛：鸣潮（wuwa）/ 战双帕弥什（zspms）
//
// 职责（2026-11-16 按厂商重排）：库洛两条来源的条目 + 解析器 + 抓取器 + 登记都在本文件；
//   每个 id 只在此注册一次（符号名沿用原 `ns_*`）。
// 组成：
//   · 本文件原有：wuwa（鸣潮，官方公告；bwiki 角色轮换池 / 活动日历为备选）；
//   · 并入 30-game-bwiki-zspms-html.js / -zspms-wikitext.js：zspms 的两个 bwiki 解析器
//     （研发记录 prop=text / `Test4/活动旗帜` 与活动日历 / 版本更新公告的 wikitext）；
//   · 并入 30-game-zspms-official.js：战双官方 CDN「版本更新公告」（活动侧默认源）；
//   · 并入 30-game-bwiki-register.js 里 zspms 的注册与 GACHA/EVENT_FETCHERS 接线。
// 复用关系：复用 bwiki 公共层（30-game-bwiki-common.js 表/日期/载荷 helper、30-game-bwiki-wikitext-common.js
//   的 wikitext helper）与 30-game-bwiki-html-fetchers.js 的 bwiki 抓取器；wuwa / zspms 解析器互不共享。
// 请求预算：wuwa 1~2 次/轮（卡池与活动同一条官方公告）；zspms 卡池 1 次（bwiki 活动旗帜）、
//   活动 1 次（官方 CDN 菜单 → 最近 3 篇详情，解析结果按 URL 缓存）。

		// ── 解析器 / 抓取器 ──

		// 鸣潮：角色轮换池页（Bwiki 汇总页，逐期列出）→ 取"覆盖当前时刻"的那一组：
		// 每一组 = 该组 data-start/data-end 之后、到下一组之前的那段里的「共鸣者/xxx」。
		// 旧实现取页面第一组时间 + 整页前 6 个角色名 → 备选/兜底源会显示"过期档期 + 跨池混入的角色"，
		// 且不报任何失败（实测该页当前只有一组已过期计时器）。没有覆盖当前的组 → 返回 null（未公布）。
		function parseWuwaPool(html, now = nowMs(), tz) {
			const text = String(html || "");
			const marks = [...text.matchAll(/data-start="([^"]+)"\s+data-end="([^"]+)"/g)];
			// 页面拿到了却一个计时器都没有 → 汇总页改版（抛错让面板显示"卡池失败"），
			// 而不是伪装成"新卡池未公布"（这是本条目的备选/兜底源）
			if (marks.length === 0) throw new Error("wuwa-pool-no-timer");
			for (let i = 0; i < marks.length; i++) {
				const m = marks[i];
				const start = parseTime(m[1], tz);
				const end = parseTime(m[2], tz);
				if (start.ts == null || end.ts == null) continue;
				if (!(start.ts <= now && now <= end.ts)) continue;
				const seg = text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : text.length);
				const chars = [...new Set([...seg.matchAll(/共鸣者\/([^"]+)"/g)].map((x) => x[1]))].slice(0, 6);
				if (chars.length === 0) continue;
				// ── P3d（2026-11-07）：手动切到「Bwiki 角色轮换池」时该侧也要有数组 ──────────
				// 本源**没有悬停**（改造前就没写 `bannerHover`：单口池，UI 走默认两行式）⇒ 并列条目为 0。
				// 所以 `entries` 传空数组 —— 把池列表塞进去会让数组比改造前**多出条目**，
				// 那不是等价切换、是行为变更（P3 的硬口径是"数组与改造前合成结果逐条相等"）。
				const out = {
					banner: "\u89D2\u8272\u6362\u53EC\u6C60",
					roles: chars.join("、"),
					startTs: start.ts, endTs: end.ts,
					bannerDates: `${start.text} ~ ${end.text}`
				};
				out.gacha = dataArrayProducedGachaOf(out, [], { tz }, now);
				return out;
			}
			return null;
		}


		// 鸣潮官方公告解析：从全量公告（game/activity/recommend）中取"覆盖当前时刻"的「角色活动唤取」。
		//
		// ⚠️ 时间**必须用 JSON 里的绝对时间戳** `startTimeMs` / `endTimeMs`，不要再去解析正文。
		// 正文写的是 `✦活动时间✦ 3.7版本更新后 ~ 2026年10月22日09:59（服务器时间）` ——
		// 起始端是**版本标签**而非绝对日期，旧实现用 `(\d{4})年(\d{1,2})月…` 匹配整段 → 恒失败 →
		// 卡池侧返回 null（2026-10-01 实测：官方 JSON 已带 3 个在开角色池，却显示"未公布"）。
		// 现在源站直接给了时间戳，比解析正文更准，也不受措辞漂移影响。
		function parseWuwaNotice(list, now = nowMs(), tz) {
			const groups = [list?.game, list?.activity, list?.recommend].filter(Array.isArray);
			const stripH = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&hellip;/g, "…")
				.replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
				.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
			const pools = [];
			for (const arr of groups) {
				for (const it of arr) {
					// 标题可能是 "[但愿长圆如此夜]\n角色活动唤取" / "「玉阙玄华」武器活动唤取"
					// ── 2026-11-26 口径修正（活网审计）：新的池类型「角色忆旅唤取 / 武器忆旅唤取」────────
					// 源站 2026-11-26 实测 `tag=7` 共 8 条：[忆旅回响Ⅱ]/角色忆旅唤取 + [回响铸忆Ⅱ]/武器忆旅唤取
					// 与旧的三池同窗口在开（都是 11-12 04:00 起，忆旅到 12-22）。旧判据只认「XX活动唤取」
					// ⇒ **在期的第 4 个角色池整条丢失**（审计 wuwa 问题②）。这里把「忆旅」并进白名单：
					//   · 角色池白名单 = 角色活动唤取 ∪ 角色忆旅唤取（外显/悬停/roles 口径不变）；
					//   · 武器侧同样并进 武器忆旅唤取，但**全站口径"只显角色池"不变** ⇒ 仍然不显。
					// 池类型名逐字保留源站那一段（`角色忆旅唤取`），免得外显把它谎报成「角色活动唤取」。
					const title = stripH(it.tabTitle || it.title || "").replace(/\s+/g, " ").trim();
					const POOL_TYPE_RE = /(?:角色|武器)(?:活动|忆旅)唤取/;
					const typeM = POOL_TYPE_RE.exec(title);
					if (!typeM) continue;
					const type = typeM[0];
					const isChar = /^角色/.test(type);
					const sTs = Number(it.startTimeMs), eTs = Number(it.endTimeMs);
					if (!Number.isFinite(sTs) || !Number.isFinite(eTs)) continue;
					if (sTs > now || eTs < now) continue; // 只要当期覆盖
					const name = title
						.replace(new RegExp("[\\s]*" + POOL_TYPE_RE.source + "\\s*$"), "")
						.replace(/^[\[【「]\s*/, "")
						.replace(/\s*[\]】」]$/, "")
						.trim();
					if (!name) continue;
					// 角色名：正文开头那句「活动期间，5星角色「心」，4星角色「卜灵」、「桃祈」、「釉瑚」唤取概率限时提升！」
					// 用 [^。！？\n]+ 限在一句内，避免把后面「唤取说明」里的角色也带进来
					const text = stripH(it.content || "");
					const upM = text.match(/活动期间，([^。！？\n]+?)唤取概率限时提升/);
					const roles = upM
						? [...new Set([...upM[1].matchAll(/[「【]([^」】]+)[」】]/g)].map((x) => x[1].trim()).filter(Boolean))].join("、")
						: "";
					pools.push({ name, type, isChar, roles, startTs: sTs, endTs: eTs });
				}
			}
			const cur = pools.filter((p) => p.isChar && p.name);
			if (cur.length === 0) return null;
			// 外显与窗口取**结束最早**的那个池（与 selectCurrent 的 first 同口径）。
			const first = cur.slice().sort((a, b) => a.endTs - b.endTs)[0];
			// 角色：**先拆成单个名字再去重**，然后合并。
			// ⚠️ 别写成 `new Set(cur.map(p => p.roles))` —— 那样比较的是"整串"（各池的 4★ 名单相同
			// 但 5★ 不同 → 整串不同 → 重复留下）。拆开才能把三池共有的 4★ 去成一份。
			// 顺序 = 各池依次展开（5★ 在前、4★ 共有名在后），去重后即 `心、千咲、尤诺、卜灵、桃祈、釉瑚`。
			const roles = [...new Set(cur.flatMap((p) => p.roles.split("、").map((s) => s.trim()).filter(Boolean)))].join("、");
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			const raw = fmtWindow(first.startTs, first.endTs, tz);
			// 悬停：首行=卡池类型（与卡片外显同源），随后每池"池名：角色"一行；窗口相同则时间只在末尾写一遍；
			// 按结束时间升序。**类型行只在本源补**（它不是任何一口池，`hoverTextFromItems` 不排序 ⇒
			// 放在最前就永远在最前；放进条目列表反而会让"窗口全同只在末尾写一遍"的折叠规则走样）。
			// ── P3（2026-11-07）：条目事实 → 悬停 + `gacha` 数组 ────────────────────
			// 去重/排序走共用工具（`poolHoverKept`：与 buildPoolHover 同一份，结束时间升序），
			// 悬停与数组的并列条目都从这一份出发。
			const hoverItems = poolHoverKept(cur.map((p) => Object.assign({
				name: p.name,
				label: `${p.name}\uFF1A${p.roles || "-"}`,
				startTs: p.startTs,
				endTs: p.endTs
			}, p.roles ? { show: cleanRoleNames(p.roles, "wuwa") } : {}))).map((x) => Object.assign({
				title: x.label || x.name,
				label: x.label || x.name,
				startTs: x.startTs,
				endTs: x.endTs,
				raw: x.raw
			}, x.show ? { show: x.show } : {}));
			const poolHover = hoverTextFromItems(hoverItems, "gacha", tz);
			const bannerHover = poolHover ? `${first.type}\n${poolHover}` : "";
			// **外显用卡池类型**（`角色活动唤取`），不用某一个池名：
			// 角色是多池合并的，若外显挂"但愿长圆如此夜"，卡片就成了"标题只说一个池、角色却是三个池的合成"。
			// 与用户 2026-09-30 定的统一口径一致（国服显示 `限时限定招募`、异环显示 `限定棋盘`）。
			// 具体池名在悬停里逐条列出，不丢信息。
			const w = dataArrayWindowOf(raw, now, tz);
			const main = {
				title: first.type,
				show: cleanRoleNames(roles, "wuwa") || first.type,
				roles: dataArrayRolesOf(roles),
				startTs: w.startTs,
				endTs: w.endTs,
				tz,
				raw,
				source: "primary"
			};
			// `extrasShowFromEntry`（2026-11-26）：探头/并列条那一行显示**该池自己的角色列**
			// （`忆旅回响Ⅱ：椿、洛可可、菲比、布兰特、散华、丹瑾、炽霞` 27 字 ⇒ `椿、洛可可、…、炽霞` 22 字），
			// `title` 仍是源站原文；清洗与主条同一处（`cleanRoleNames`）。
			const extras = dataArrayExtrasFromEntriesOf(hoverItems, main, now, { kind: "gacha", tz, id: "wuwa", extrasShowFromEntry: true });
			return {
				banner: first.type,
				roles,
				bannerDates: raw,
				bannerDatesRaw: raw,
				startTs: first.startTs,
				endTs: first.endTs,
				bannerHover,
				// ⚠️ `gachaHoverItems` 只含**池行**（首行的"卡池类型"由 `banner` 补，见 `bannerHover` 的构造）
				gacha: dataArrayProducedListOf([main].concat(extras).map((x) => dataArrayProducedItemOf(x, "gacha")), "wuwa:gacha"),
				gachaHoverItems: hoverItems
			};
		}


		// 鸣潮官方活动解析：`recommend` / `game` / `activity` 三组公告里，**按时限与内容特征**挑活动。
		//
		// 活动条目形如 tabTitle="[团团勇者大乱斗]休闲活动"，同样带绝对时间戳（`startTimeMs`/`endTimeMs`）。
		// 这是 2026-10-01 起鸣潮活动的**默认源**——Bwiki 活动日历页已停更（最新一条结束于 2026/9/29），
		// 而官方源有当期活动，且**与卡池是同一条 URL**、同一次请求即可拿到两侧数据。
		//
		// ── 2026-11-26 口径修正（活网审计 wuwa 问题①）──────────────────────────────
		// 旧实现钉死 `Number(it.tag) === 5`（注释当时写「7=卡池；5=限时活动」）。2026-11-26 活网实测
		// `tag` 分布已漂移：**当期 5 条活动里 4 条是 tag=3**（[拉海洛方块・逆转]休闲活动 / [昔梦赠礼]
		// 七日签到活动 / [第二索拉：未名之梦]休闲活动 / 【先行体验】功能说明），tag=5 只剩 1 条
		// （[回音盈域]/养成材料限时双倍活动）⇒ 活动侧 nomatch（0 条）。
		// 现在按**内容特征**判（tag 只当参考、不再当白名单），三组一起扫：
		//   ① 三组都看：`recommend`（运营 tab）+ `game`（游戏内公告，当期活动主要在这里）+ `activity`；
		//   ② 排除卡池：`category === 3`（实测 tag=7 全部 category=3）或标题带「唤取」；
		//   ③ 排除公告/资讯/周边：`category === 1`（版本说明/反馈途径/运营声明…）/ `category === 4`（社区资讯/手办预售）；
		//   ④ 排除常驻：`permanent === 1` 或 `tag === 6`（「心影映花」全新常驻玩法）；
		//   ⑤ 排除商城/付费上架：标题含 商城|礼包|服饰|折扣|特惠（[全新服饰]限时特惠 / [商城礼包]限时折扣上架）；
		//   ⑥ 必须**限时**：正文有「活动时间」锚点（【先行体验】只有「功能开放时间」、库街区「签到工具」
		//      没有窗口 ⇒ 都不算限时活动）。时间仍用 JSON 的绝对时间戳，不解析正文日期。
		function parseWuwaRecommendEvents(list, now = nowMs(), tz) {
			const groups = [list?.recommend, list?.game, list?.activity].filter(Array.isArray);
			const stripH = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
			// 商城 / 付费条目（不是"限时活动"，活动日历不该列）
			const WUWA_SHOP_RE = /商城|礼包|服饰|折扣|特惠/;
			const events = [];
			const seen = new Set();
			for (const arr of groups) {
				for (const it of arr) {
					const cat = Number(it.category);
					if (cat === 1 || cat === 3 || cat === 4) continue;
					if (it.permanent === 1 || Number(it.tag) === 6) continue;
					const name = stripH(it.tabTitle || it.title || "").replace(/\s+/g, " ").trim();
					if (!name || /唤取/.test(name) || WUWA_SHOP_RE.test(name)) continue;
					const content = stripH(it.content || "");
					if (!/活动时间/.test(content)) continue;   // 没有限时窗口 ⇒ 不是活动
					const sTs = Number(it.startTimeMs), eTs = Number(it.endTimeMs);
					if (!Number.isFinite(sTs) || !Number.isFinite(eTs)) continue;
					if (sTs > now || eTs < now) continue;
					const key = `${name}|${sTs}|${eTs}`;
					if (seen.has(key)) continue;               // 同一条在两组装了 ⇒ 只留一条
					seen.add(key);
					events.push({ name, category: "", startTs: sTs, endTs: eTs });
				}
			}
			if (events.length === 0) return null;
			const sorted = sortEventItems(events);
			if (sorted.length === 0) return null;
			const primary = pickEventPrimary(sorted) || sorted[0];
			const dates = fmtWindow(primary.startTs, primary.endTs, tz);
			// ── P3（2026-11-07）：条目事实 → 悬停 + `events` 数组（顺序 = sortEventItems）──
			const hoverItems = sorted.map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: "" }));
			const w = dataArrayWindowOf(dates, now, tz);
			const main = {
				title: primary.name,
				show: primary.name,
				startTs: w.startTs,
				endTs: w.endTs,
				tz,
				raw: dates,
				source: "primary"
			};
			const extras = dataArrayExtrasFromEntriesOf(hoverItems, main, now, { kind: "event", tz });
			return {
				banner: primary.name,
				bannerDates: dates,
				bannerDatesRaw: dates,
				eventHover: hoverTextFromItems(hoverItems, "event", tz),
				events: dataArrayProducedListOf([main].concat(extras).map((x) => dataArrayProducedItemOf(x, "event")), "wuwa:event"),
				eventHoverItems: hoverItems
			};
		}


		// 鸣潮卡池默认抓取器：**只**读官方公告（aki-gm-resources-back：entrypoint → 目录 → zh-Hans.json）。
		//
		// ⚠️ 2026-11-07（用户要求，与全站 28 款游戏同一口径）：**摘掉自动兜底** ——
		//    官方接口失败 / 结构异常 ⇒ 抛错；结构正常但没有覆盖当前的「角色/武器活动唤取」⇒ 返回 null。
		//    **绝不再**转身去抓 Bwiki 角色轮换池：要看 Bwiki 口径请在设置里把卡池来源切到
		//    「Bwiki 角色轮换池」备选源（走 GACHA_FETCHERS["wuwa-bwiki"]）。
		//    保留的**同源**容错只有两处（不是换站点）：zh-Hans.json 读不到 → 同目录 notice.json；
		//    contentUrl 缺省 → 由 entryUrl 推导目录。
		async function fetchWuwaGacha(entryUrl, signal, tz, now = nowMs()) {
			const ref = "https://aki-gm-resources.aki-game.com/";
			const ej = await proxyFetchJson(entryUrl, ref);
			const contentUrl = Array.isArray(ej?.contentUrl) ? ej.contentUrl[0] : "";
			const dir = contentUrl ? contentUrl.replace(/[^/]*$/, "") : String(entryUrl).replace(/[^/]*$/, "");
			let list = null;
			try { list = await proxyFetchJson(dir + "zh-Hans.json", ref); } catch { list = null; }
			if (!list || typeof list !== "object") list = await proxyFetchJson(dir + "notice.json", ref);
			if (!list || typeof list !== "object") throw new Error("wuwa-notice-bad-json");
			// **同一份 JSON 里卡池（tag=7）与活动（tag 3/5 等，见 parseWuwaRecommendEvents）都在** → 顺带把活动字段也返回。
			// 这是"统一来源注册表"里写明的复用契约：**两侧是同一条 URL** 且卡池载荷带 event 字段时，
			// refresh 不再为活动侧另抓一次（否则每轮会向同一条 URL 重复发一次请求）。
			// ⚠️ 我重写解析时一度只返回卡池字段，导致鸣潮每轮请求从 1 次变成 2 次 —— 已补回。
			// 活动侧仍保留自己的抓取器（fetchWuwaEventsOfficial）：卡池侧失败、或用户在设置里
			// 单独选活动来源时，活动侧要能自己抓、自己报错（解耦不变）。
			const ev = parseWuwaRecommendEvents(list, now, tz);
			// P3：活动侧的 `events` 数组与条目事实**原样带出**（同一份公告同时喂两侧，别在这里重算）
			const evFields = ev
				? {
					event: ev.banner, eventDates: ev.bannerDates || "", eventDatesRaw: ev.bannerDatesRaw || ev.bannerDates || "",
					eventHover: ev.eventHover || "",
					...(ev.events ? { events: ev.events, eventHoverItems: ev.eventHoverItems } : {})
				}
				: {};
			const d = parseWuwaNotice(list, now, tz);
			if (!d) return null;
			return { ...d, ...evFields };
		}


		// 鸣潮活动默认抓取器：抓同一份官方公告，按内容特征取当期限时活动（parseWuwaRecommendEvents，2026-11-26 起不再钉 tag=5）。
		// 与卡池侧是**同一条 URL**（entrypoint.json），所以 refresh 的复用会让两侧共用一次请求。
		async function fetchWuwaEventsOfficial(entryUrl, _signal, tz) {
			const ref = "https://aki-gm-resources.aki-game.com/";
			const ej = await proxyFetchJson(entryUrl, ref);
			const contentUrl = Array.isArray(ej?.contentUrl) ? ej.contentUrl[0] : "";
			const dir = contentUrl ? contentUrl.replace(/[^/]*$/, "") : String(entryUrl).replace(/[^/]*$/, "");
			const list = await proxyFetchJson(dir + "zh-Hans.json", ref);
			if (!list || typeof list !== "object") throw new Error("wuwa-event-bad-json");
			const d = parseWuwaRecommendEvents(list, nowMs(), tz);
			if (!d) return null;
			return {
				event: d.banner,
				eventDates: d.bannerDates || "",
				eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "",
				eventHover: d.eventHover || "",
				...(d.events ? { events: d.events, eventHoverItems: d.eventHoverItems } : {})
			};
		}


		// 鸣潮：活动日历页 → font-size:17px 标题 + font-size:11px 时间，选当期
		// 注意：复用 selectCurrent 需要 isMain 字段（该函数按 isMain 过滤主池）
		function parseWuwaCalendar(html, tz) {
			const items = [];
			const re = /font-size:17px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>([\s\S]*?)(?=font-size:17px|$)/g;
			let m;
			while ((m = re.exec(html)) !== null) {
				const name = stripTags(m[1]);
				if (!name) continue;
				const timeM = m[2].match(/font-size:11px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>/);
				const timeText = timeM ? stripTags(timeM[1]) : "";
				if (!/20\d{2}\//.test(timeText)) continue;
				const range = parseRange(timeText, tz);
				items.push({ banner: name, name, ...range, isMain: true });
			}
			const now = nowMs();
			const active = sortEventItems(items
				.filter((it) => coversNow(it, now))
				.map((it) => ({ name: it.name || it.banner, startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw })));
			if (active.length === 0) return null;
			// 外显：类别优先（战斗/高难类优先），同级内结束时间升序（③）；悬停仍按 endTs 升序全量
			const primary = pickEventPrimary(active) || active[0];
			const dates = primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || "");
			// ── P3d（2026-11-07）：条目事实 → 悬停 + `events` 数组 ────────────────────
			// 这是**活动备选源**「Bwiki 活动日历」（`EVENT_FETCHERS["wuwa"]["wuwa-event-bwiki"]`）的解析器。
			// 改造前悬停直接 `buildEventHover(active, 0, tz)` 拼串、条目只活在那一句里 ⇒ P3c 删掉
			// 合成器后，用户手动切到本源时活动列显示「无数据」。现在条目是事实：悬停由
			// `hoverTextFromItems` 反生成（与 buildEventHover 逐字一致），数组由
			// `dataArrayProducedEventsOf` 收口。顺带把载荷收成**最终形状**（`event` / `eventDates`…），
			// 注册处不再做 `banner → event` 的映射 —— 那层映射正是"两套字符串"的接缝。
			const hoverItems = active.map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
			const out = {
				event: primary.name,
				eventDates: dates,
				eventDatesRaw: primary.raw || dates,
				eventHover: hoverTextFromItems(hoverItems, "event", tz)
			};
			out.events = dataArrayProducedEventsOf(out, hoverItems, { tz }, now);
			out.eventHoverItems = hoverItems;
			return out;
		}


		// 从 canmoe chunk JS 提取当期卡池：
		// ① 当期角色窗口形如 d={梨诺:{windows:[{start,end,version,period,isRerun}]}},u=[...]
		//   （注意：d 在 canmoe 侧可能长期不更新，只能当"覆盖当前时刻才采信"的快速路径）
		// ② 期次列表形如 <变量>=[{id,title,subtitle,version,periodStart,periodEnd,featured:[...]}]，
		//   变量名随构建变化（曾见 p= / 现为 f=），由 extractCanmoePeriods 按内容定位。
		// 只采用"时间窗口覆盖当前时刻"的条目。
		// 返回值三态：数据对象 / null（**结构在**但没有覆盖当前时刻的期次 → 未公布）/ undefined
		// （这份 JS 里**根本没有**卡池数据结构 → 交给调用方决定：多 chunk 时继续找下一个，
		//  全部 chunk 都没有则说明页面改版 → 报错，而不是伪装成"未公布"）。
		function currentFromCanmoe(js, now, tz) {
			now = now || nowMs();
			let sawStructure = false;
			const fmt = (iso) => {
				// 按**源站时区**（`tz`）渲染，而不是本机时区：否则海外用户会看到
				// 与 `startTs/endTs`（已按源站时区换算）不一致的钟点。
				const w = sourceWallParts(new Date(iso).getTime(), tz);
				return `${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")} ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
			};
			// **统一规则（§49）**：当前时刻落在持续期间内的卡池**全部合并**外显。
			// 旧实现是"两个分支各自命中第一个就 return" → 只显示一个池，同期的另一个池看不到
			// （用户实测：终末地外显没合并）。现在先把两类候选都收集起来再合并。
			//
			// ⚠️ 这条路径**不走 `selectCurrent`**（canmoe 的 chunk 是压缩 JS，得单独解析），
			// 所以 §49 改 `selectCurrent` 时漏了这里 —— 教训：改"通用规则"要**枚举所有外显路径**，
			// 不能只改名字最像的那个函数。
			const active = [];
			// 1) 当期 d：windows 覆盖当前 → 收进来
			const curM = js.match(/\bd=\{(.+?)\},\s*u=\[/);
			if (curM) {
				sawStructure = true;
				const inner = curM[1];
				const featuredM = inner.match(/([^:{}]+):\{windows:/);
				const roles = featuredM ? featuredM[1].trim() : "";
				for (const w of inner.matchAll(/windows\s*:\s*\[\s*\{\s*start\s*:\s*"([^"]+)"\s*,\s*end\s*:\s*"([^"]+)"\s*,\s*version\s*:\s*"([^"]+)"\s*,\s*period\s*:\s*(\d+)\s*,\s*isRerun\s*:\s*(!0|!1|true|false)\s*\}\s*\]/g)) {
					const a = new Date(w[1]).getTime(), b = new Date(w[2]).getTime();
					if (a <= now && now <= b) {
						active.push({ banner: `\u3010${w[3]}\u3011${roles}`, roles, startTs: a, endTs: b, dates: `${fmt(w[1])} ~ ${fmt(w[2])}`, raw: `${fmt(w[1])} ~ ${fmt(w[2])}` });
					}
				}
			}
			// 2) p 数组中的"当前进行中"条目（过期当期后以此为兜底）—— 同样**全部收**，不是取第一个
			const arr = extractCanmoePeriods(js);
			if (arr) {
				sawStructure = true;
				for (const e of arr) {
					const ps = (e.match(/periodStart\s*:\s*"([^"]*)"/) || [])[1];
					const pe = (e.match(/periodEnd\s*:\s*"([^"]*)"/) || [])[1];
					if (!ps || !pe) continue;
					const a = new Date(ps).getTime(), b = new Date(pe).getTime();
					if (!(a <= now && now <= b)) continue;
					const title = (e.match(/title\s*:\s*"([^"]*)"/) || [])[1] || "";
					const subtitle = (e.match(/subtitle\s*:\s*"([^"]*)"/) || [])[1] || "";
					const version = (e.match(/version\s*:\s*"([^"]*)"/) || [])[1] || "";
					active.push({
						banner: title || `\u3010${version}\u3011${subtitle}`,
						roles: subtitle || title,
						startTs: a, endTs: b,
						dates: `${fmt(ps)} ~ ${fmt(pe)}`, raw: `${fmt(ps)} ~ ${fmt(pe)}`
					});
				}
			}
			if (active.length > 0) {
				// 外显名与窗口取**结束最早**的那个池（越快结束越该被盯住；与 selectCurrent 的 first 同口径）
				const first = active.slice().sort((x, y) => x.endTs - y.endTs)[0];
				return {
					banner: first.banner,
					roles: [...new Set(active.map((p) => p.roles).filter(Boolean))].join("、"),
					bannerDates: first.dates,
					bannerDatesRaw: first.raw
				};
			}
			// 结构在但没覆盖当前时刻 → null（未公布）；连结构都没有 → undefined（页面改版，交上层决定）
			return sawStructure ? null : void 0;
		}


		// 提取 canmoe chunk 里的"卡池期次数组"（元素含 periodStart/periodEnd 的那个），返回元素子串数组。
		// 数组的变量名是压缩产物的一部分：canmoe 每次重新构建都可能改名（曾见 p=[…]，现为 f=[…]），
		// 所以按"任意 `名字=[` 且数组体里有 periodStart"来定位，不写死变量名
		// （曾因写死 p= 而在 canmoe 改版后静默抓不到当期卡池）。
		function extractCanmoePeriods(js) {
			const re = /[A-Za-z_$][\w$]*\s*=\s*\[/g;
			for (let m = re.exec(js); m; m = re.exec(js)) {
				const start = js.indexOf("[", m.index);
				// 便宜预筛：数组开头不远处就有 periodStart 字段，省掉对每个数组都做括号平衡扫描
				if (!/periodStart\s*:/.test(js.slice(start, start + 4000))) continue;
				let depth = 0, inStr = false, q = "", end = -1;
				for (let i = start; i < js.length; i++) {
					const ch = js[i];
					if (inStr) { if (ch === "\\") i++; else if (ch === q) inStr = false; continue; }
					if (ch === '"' || ch === "'") { inStr = true; q = ch; continue; }
					if (ch === "[") depth++;
					else if (ch === "]") { depth--; if (depth === 0) { end = i; break; } }
				}
				if (end < 0) continue;
				const body = js.slice(start + 1, end);
				if (!/periodStart\s*:/.test(body)) continue;
				const out = [];
				let d2 = 0, s2 = false, q2 = "", st = 0;
				for (let k = 0; k < body.length; k++) {
					const ch = body[k];
					if (s2) { if (ch === "\\") k++; else if (ch === q2) s2 = false; continue; }
					if (ch === '"' || ch === "'") { s2 = true; q2 = ch; continue; }
					if (ch === "{" || ch === "[") d2++;
					else if (ch === "}" || ch === "]") d2--;
					else if (ch === "," && d2 === 0) { out.push(body.slice(st, k)); st = k + 1; }
				}
				out.push(body.slice(st));
				return out;
			}
			return null;
		}


		// 终末地卡池列：canmoe 卡池日历 chunk 内同期全部卡池条目（特许寻访 / 重构寻访 等）的**条目事实**。
		// ── P3c（2026-11-07）：本函数从"直接拼悬停文本"改成"只给条目"─────────────────────
		// 改造前它是 `canmoePoolHover(js, now, tz)` = `buildPoolHover(pools, tz)`（一步拼成字符串）。
		// P3c 让**条目**成为事实：这里只返回 `{ name, label, startTs, endTs, raw }`，悬停文本由调用方
		// （`fetchCanmoeEndfield`）用 `hoverTextFromItems` 反生成、数组由 `dataArrayProducedGachaOf` 收口。
		// ⚠️ 调用方必须先过 `poolHoverKept(...)`：`buildPoolHover` 内部的去重/排序（结束时间升序）就在那份，
		//    少这一步行序会变。`raw` 恒空串（两端口都在 ⇒ 档期由 fmtWindow 渲染，与改造前同一条路径）。
		function canmoePoolItems(js, now) {
			const arr = extractCanmoePeriods(js);
			if (!arr) return [];
			const pools = [];
			for (const e of arr) {
				const ps = (e.match(/periodStart\s*:\s*"([^"]*)"/) || [])[1];
				const pe = (e.match(/periodEnd\s*:\s*"([^"]*)"/) || [])[1];
				if (!ps || !pe) continue;
				const a = new Date(ps).getTime(), b = new Date(pe).getTime();
				if (!(a <= now && now <= b)) continue;
				const title = (e.match(/title\s*:\s*"([^"]*)"/) || [])[1] || "";
				const subtitle = (e.match(/subtitle\s*:\s*"([^"]*)"/) || [])[1] || "";
				if (!title && !subtitle) continue;
				pools.push({
					name: title || subtitle,
					label: title && subtitle ? `${title}\uFF1A${subtitle}` : (title || subtitle),
					startTs: a,
					endTs: b,
					raw: ""
				});
			}
			return pools;
		}

		const WUWA_NOTICE_ENTRY = "https://aki-gm-resources-back.aki-game.com/gamenotice/G152/76402e5b20be2c39f095a152090afddc/entrypoint.json";


		const WUWA_BWIKI_URL = "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E8%A7%92%E8%89%B2%E8%BD%AE%E6%8D%A2%E6%B1%A0&prop=text&format=json&formatversion=2";


		const WUWA_EVENT_BWIKI_URL = "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E6%B4%BB%E5%8A%A8%E6%97%A5%E5%8E%86&prop=text&format=json&formatversion=2";


		// ── 条目 ──
		registerSource({
				id: "wuwa",
				defaultHidden: false,
				tz: TZ_CN,
				parserVersion: 2,
				name: "鸣潮",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/29/WutheringWavesIcon.png!/fw/512",
				source: "官方公告",
				// 默认卡池源=官方公告（aki-gm-resources-back，经 host 代理）：
				// entrypoint.json → <dir>/zh-Hans.json，其 `recommend` 组里 tag=7 为逐期「角色/武器活动唤取」，
				// 条目自带 `startTimeMs`/`endTimeMs` 绝对时间戳（不再解析正文，见 parseWuwaNotice）。
				// 无当期公告 ⇒ 如实「未公布」，**不自动回退 Bwiki**（2026-11-07 摘除）；
				// 也可在设置中手动切 Bwiki（备选）
				url: WUWA_NOTICE_ENTRY,
				altSources: [
					{ label: "Bwiki 角色轮换池", url: WUWA_BWIKI_URL, fetcher: "wuwa-bwiki" }
				],
				// 活动源：**默认=同一份官方公告**（按内容特征挑限时活动：tag 3/5 都算，见 parseWuwaRecommendEvents），
				// 与卡池是**同一条 URL** → 一次请求复用两侧数据。
				// ⚠️ 2026-10-01 改：Bwiki 活动日历页**已停更**（最新一条结束于 2026/9/29，无 3.7 内容），
				// 所以把它从默认**降级为备选**（eventAltSources），仍可在设置里手动切回。
				eventUrl: WUWA_NOTICE_ENTRY,
				eventSource: "官方公告",
				eventAltSources: [
					{ label: "Bwiki 活动日历", url: WUWA_EVENT_BWIKI_URL, fetcher: "wuwa-event-bwiki" }
				]
		});

		// ── 抓取器登记 ──
		GACHA_FETCHERS["wuwa"] = (url, signal, tz) => fetchWuwaGacha(url, signal, tz);
		GACHA_FETCHERS["wuwa-bwiki"] = (url, signal, tz) => mkMediaWiki((text) => parseWuwaPool(text, nowMs(), tz))(url, signal, tz);
					// 鸣潮：**默认=同一份官方公告**（按内容特征挑限时活动，见 parseWuwaRecommendEvents），与卡池是**同一条 URL**
			// → 一次请求复用两侧数据（refresh 的复用优化）。
			// ⚠️ 2026-10-01 改：Bwiki 活动日历**已停更**（最新一条结束于 2026/9/29），
			// 所以把官方提为默认、Bwiki 降级为备选（`wuwa-event-bwiki`），仍可在设置里手动切回。
EVENT_FETCHERS["wuwa"] = {
				default: (url, signal, tz) => fetchWuwaEventsOfficial(url, signal, tz),
				// ⚠️ 回调**必须**声明第二个参数 `tz`：mkMediaWiki 的契约是 `parse(text, tz)`
				//   （见 30-parsers.js 的 mkMediaWiki，压平后见 22-fetcher-core.js）。原来只写了 `(html)` 却在体内用 `tz`
				//   → 运行时 `tz is undefined`：用户在设置页把鸣潮活动源切到「Bwiki 活动日历」就必然抓取失败。
				//   2026-10-03 修正（同批还加了静态守卫；那个探针脚本没入库）。
				// ⚠️ P3d（2026-11-07）：`parseWuwaCalendar` 现在直接返回**最终载荷**（`event` / `eventDates` /
				//   `events` 数组 + 条目事实），所以这里不再做 `banner → event` 的映射。
				"wuwa-event-bwiki": mkMediaWiki((html, tz) => parseWuwaCalendar(html, tz))
			};


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-zspms-html.js：战双 bwiki「研发记录」解析（卡池备选）
// ─────────────────────────────────────────────────────────────────────────────

//#region ④ 战双帕弥什 国服（zspms / page=研发记录）
// 107 张独立小表，每张 = 一期「降临狙击」研发池：行1 = `<td colspan="2">` 立绘/名（名在 <a title>），
//   行2 = `日期 | 2024/03/21 10:00 AM 至 2024/04/04 09:59 AM`（**12 小时制**），
//   行3 = `效果 | 「<a title=角色>」…`。表格前最近的 h2 就是干净的池名（如 `【露西亚·深红囚影】…限时概率UP`）。
//   ⚠️ 实测最新一期 = 2024/03/21（页面缓存时间 2026-10-01）→ 该页 **停在 2024Q1**，当期无覆盖 → null。
//      （页首自述「目前该记录仅包括"降临狙击角色"池和"命运降临角色狙击"池」。）
function ns_bwiki_parseZspmsGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const items = [];
	let seenLabel = 0;
	tables.forEach((tbl, ti) => {
		const rows = ns_bwiki_tableRows(tbl);
		let dateText = "", roleText = "", imgTitle = "";
		for (const r of rows) {
			if (r.cells.length === 1) {                        // 立绘行（colspan=2）
				const t = ns_bwiki_attrOf(r.cells[0].html, "title") || r.cells[0].text;
				if (t) imgTitle = t;
			}
			for (let i = 0; i < r.cells.length; i++) {
				const label = r.cells[i].text;
				const next = r.cells[i + 1];
				if (!next) continue;
				if (/^(日期|时间)/.test(label)) { dateText = next.text; seenLabel++; }
				else if (/^效果/.test(label)) roleText = next.html;
			}
		}
		const w = ns_bwiki_windowsFromCell(dateText, tz, "startFirst")[0];
		if (!w) return;
		const head = ns_bwiki_headingBefore(html, html.indexOf(tbl));
		const roles = ns_bwiki_linkTitles(roleText).join("、");
		items.push({
			_i: ti,
			banner: head || ns_bwiki_cleanImgName(imgTitle) || "研发池",
			roles, category: "研发", note: "降临狙击角色池",
			startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display
		});
	});
	if (seenLabel === 0 && tables.length > 0) throw new Error("bwiki-zspms-gacha:no-table");   // 结构变了
	return items;
}
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-zspms-wikitext.js：战双 bwiki 活动旗帜 / 活动日历 / 版本更新公告
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// ① 战双帕弥什 国服（zspms）
//    · 活动侧默认（2026-11-11 起）：`Test4/活动日历` 的结构化 `{{活动日历|名|起|止}}` 行
//    · 卡池侧默认（2026-11-10 起）：`Test4/活动旗帜` 的 `{{活动旗帜}}` 模板参数
//    · 旧源（SMW ask 索引 → 最新「版本更新公告」→ prop=wikitext 正文抽档期）
//      两侧都降为**手动备选**（altSources / eventAltSources），解析器与回归全部保留
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_ZSPMS_TZ = "Asia/Shanghai";        // 推测：源站未标注（旁证见文件头）
const ns_bwiki_wikitext_ZSPMS_ASK_QUERY = "[[分类:游戏更新公告]][[类别::版本]]|?标题|?时间|sort=时间|order=desc|limit=40";
const ns_bwiki_wikitext_ZSPMS_ASK_URL = "https://wiki.biligame.com/zspms/api.php?action=ask&query="
	+ encodeURIComponent(ns_bwiki_wikitext_ZSPMS_ASK_QUERY) + "&format=json";
// ⚠️ `prop=wikitext`（**不是** prop=text）；页名必须 encodeURIComponent 后再拼（否则夹具整串键命中不到）
function ns_bwiki_wikitext_zspmsParseUrl(page) {
	return `https://wiki.biligame.com/zspms/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
const ns_bwiki_wikitext_ZSPMS_REFERER = "https://wiki.biligame.com/zspms/";

//#region 战双：SMW ask 索引
// 实测返回（fixtures/p8-zspms-ask）：
//   {"query-continue-offset":40,
//    "query":{"printrequests":[{"label":"标题",…},{"label":"时间",…}],
//             "results":{"《远信回响》版本更新公告":{"printouts":{"标题":["《远信回响》版本更新公告"],
//                                                              "时间":["20260922"]},
//                                                 "fulltext":"《远信回响》版本更新公告","fullurl":…,"namespace":0,"exists":"1"}},
//             "serializer":"SMW\\Serializers\\QueryResultSerializer","version":2,
//             "meta":{"hash":…,"count":40,"offset":0,…}}}
// ⚠️ `时间` 是**字符串** `"20260922"`（YYYYMMDD），**不是** SMW 的 timestamp 对象。
//    但仍做兼容：字符串 / 数组 / {timestamp} / {fulltext} 都吃。
function ns_bwiki_wikitext_smwText(v) {
	if (v == null) return "";
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) return ns_bwiki_wikitext_smwText(v[0]);
	if (typeof v === "object") {
		if (typeof v.timestamp === "number") return String(v.timestamp);
		if (typeof v.fulltext === "string") return v.fulltext.trim();
		if (typeof v["*"] === "string") return v["*"].trim();
	}
	return "";
}
// ask JSON → 按 `时间` 严格倒序的行 [{ page, title, time, fullurl }]
//   结构性损坏（无 query.results）→ 抛错；**0 条也抛错**：该查询依赖 `类别::版本`，
//   返回 0 条说明索引/属性坏了，绝不能静默降级成"未公布"（任务书明确要求）。
function ns_bwiki_wikitext_parseZspmsAsk(json) {
	const results = json && json.query && json.query.results;
	if (!results || typeof results !== "object" || Array.isArray(results)) throw new Error("zspms-ask:bad-json");
	const rows = Object.entries(results).map(([page, v]) => {
		const p = (v && v.printouts) || {};
		return {
			page,
			title: ns_bwiki_wikitext_smwText(p["标题"]) || page,
			time: ns_bwiki_wikitext_smwText(p["时间"]),
			fullurl: (v && v.fullurl) || ""
		};
	});
	if (rows.length === 0) throw new Error("zspms-ask:no-result");
	rows.sort((a, b) => (b.time > a.time ? 1 : b.time < a.time ? -1 : 0));
	return rows;
}
//#endregion

//#region 战双：正文 → 档期
// `{{颜色引用|红|2026年9月24日版本更新后 - 2026年11月5日05:00}}` —— 档期**写在模板参数里**，
// 所以必须先剥模板（保留内文），否则整段档期都看不见。处理顺序：
//   ① `{{颜色引用|<色>|<正文>}}` → 只留 <正文>（档期就在这里）  ② `{{公告|…}}` 信息模板 → 整块丢弃（时间另取）
//   ③ 其它无参/单参模板 → 无参丢、有参留最后一个参数   ④ `'''` 粗体标记 → 去掉
//   ⑤ `[[file:…]]` → 去掉   ⑥ `<br>`/块级标签 → 换行（正文是 `<br>` 分行写的）
//   ⑦ 标题 `==X==` → 独立行，并打上 `\u0001H<level>\u0001` 前缀（后面要靠标题栈取活动名）
function ns_bwiki_wikitext_zspmsNormalize(wikitext) {
	let s = String(wikitext == null ? "" : wikitext);
	s = s.replace(/\{\{颜色引用\s*\|[^|{}]*\|([\s\S]*?)\}\}/g, "$1");
	s = s.replace(/\{\{公告[\s\S]*?\}\}/g, "");
	s = s.replace(/\{\{[^{}]*\}\}/g, (m) => { const i = m.lastIndexOf("|"); return i < 0 ? "" : m.slice(i + 1, -2); });
	s = s.replace(/'''/g, "");
	s = s.replace(/\[\[(?:file|File|文件)\s*:[^\]]*\]\]/g, "");
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<\/?(?:hr|center|div|p|li|ul|ol|table|tr|td|th)\b[^>]*>/gi, "\n");
	s = s.replace(/<\/?(?:b|i|u|span|small|big|font|sup|sub)\b[^>]*>/gi, "");
	s = s.replace(/&nbsp;/gi, " ");
	// ⚠️ 标题必须**整行**匹配（加 m + ^$）：否则表格行 `{| class="wikitable" style="…"` 里的两个 `=`
	//    会被当成一级标题，往标题栈里塞一个假标题。
	s = s.replace(/^(={1,6})\s*([^=\n]+?)\s*\1\s*$/gm, (m, eq, title) => `\u0001H${eq.length}\u0001${title}`);
	return s;
}

// 停服维护窗口（源站原文，例：`我们将于2026年9月24日05:00 - 11:00进行"远信回响"版本更新的停服维护`）
// 只在含「停服维护/停机维护」的那一行里找 `YY…MM…DD HH:MM - HH:MM`（终点可省日期）。
function ns_bwiki_wikitext_zspmsMaintenanceWindow(text, tz = ns_bwiki_wikitext_ZSPMS_TZ) {
	const line = String(text == null ? "" : text).split("\n").find((l) => /停服维护|停机维护|维护更新/.test(l) && /\d{4}\s*年/.test(l));
	if (!line) return null;
	const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[-–—－~～至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})/.exec(line);
	if (!m) return null;
	const y = +m[1], mo = +m[2], d = +m[3];
	const startTs = sourceInstant(y, mo, d, +m[4], +m[5], tz);
	let endTs = sourceInstant(y, mo, d, +m[6], +m[7], tz);
	if (endTs <= startTs) endTs = sourceInstant(y, mo, d + 1, +m[6], +m[7], tz);   // 跨零点的维护（如 22:00-02:00）
	if (!(endTs > startTs)) return null;
	const raw = `${y}-${pad2(mo)}-${pad2(d)} ${pad2(+m[4])}:${m[5]} - ${pad2(+m[6])}:${m[7]}`;
	return { startTs, endTs, raw };
}

// 中文年月日「起点 - 终点」窗口（源站墙钟原文形态）：
//   `2026年9月24日版本更新后 - 2026年11月5日05:00`（相对起点）
//   `2026年9月29日10:00 - 2026年11月3日23:59`（双端显式时刻）
//   `2026年9月24日 - 2026年10月1日`（双端只有日期 → 起点 00:00 / 终点 23:59）
// ⚠️ 内部空白只用 `[ \t]`（**不许跨行**）：否则维护段 `9月24日05:00 - 11:00` 会跟下一行的日期拼成假窗口。
const ns_bwiki_wikitext__SP = "[ \\t]*";
const ns_bwiki_wikitext__CN_DATE = "(\\d{4})" + ns_bwiki_wikitext__SP + "年" + ns_bwiki_wikitext__SP + "(\\d{1,2})" + ns_bwiki_wikitext__SP + "月" + ns_bwiki_wikitext__SP + "(\\d{1,2})" + ns_bwiki_wikitext__SP + "日";
const ns_bwiki_wikitext__CN_TIME = "(\\d{1,2})" + ns_bwiki_wikitext__SP + "[:：]" + ns_bwiki_wikitext__SP + "(\\d{2})";
const ns_bwiki_wikitext__CN_REL = "(版本更新后|维护结束后|维护后|更新结束后|更新后)";
const ns_bwiki_wikitext__CN_WIN_SRC = ns_bwiki_wikitext__CN_DATE + ns_bwiki_wikitext__SP + "(?:" + ns_bwiki_wikitext__CN_TIME + "|" + ns_bwiki_wikitext__CN_REL + ")?" + ns_bwiki_wikitext__SP + "[-–—－~～至到]" + ns_bwiki_wikitext__SP
	+ ns_bwiki_wikitext__CN_DATE + ns_bwiki_wikitext__SP + "(?:" + ns_bwiki_wikitext__CN_TIME + ")?";

// 标题栈 → 该行的活动名。先取最内层标题；若它是通用容器标题（如 `4）活动时间`）→ 往上爬一级。
const ns_bwiki_wikitext__GENERIC_HEAD = /^(活动时间|活动说明|活动奖励|活动对象|活动规则|活动玩法|活动内容|活动时间如下)$/;
function ns_bwiki_wikitext_cleanHead(title) {
	return String(title == null ? "" : title)
		.replace(/\s*\[\s*编辑\s*\]\s*/g, "")
		.replace(/^\d+\s*）\s*/, "")
		.replace(/^[一二三四五六七八九十]+\s*、\s*/, "")
		.replace(/[\s:：]+$/, "")
		.replace(/\s+/g, " ")
		.trim();
}
function ns_bwiki_wikitext_zspmsHeadings(lines) {
	const out = [];
	lines.forEach((l, i) => {
		const m = /^\u0001H(\d)\u0001(.*)$/.exec(l);
		if (m) out.push({ lineIdx: i, level: +m[1], title: ns_bwiki_wikitext_cleanHead(m[2]) });
	});
	return out;
}
function ns_bwiki_wikitext_zspmsNameAt(heads, lineIdx) {
	const stack = [];
	for (const h of heads) {
		if (h.lineIdx > lineIdx) break;
		while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
		stack.push(h);
	}
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title && !ns_bwiki_wikitext__GENERIC_HEAD.test(stack[i].title)) return stack[i].title;
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title) return stack[i].title;
	return "";
}

// 活动时间标签（`活动时间：` / `•【勤务·限时任务】开放时间：` / `开启时间：` / `售卖时间：` …）
const ns_bwiki_wikitext__ZSPMS_LABEL_RE = /^[\s*•·\-]*?(?:【[^】]{1,20}】)?[ \t]*([^\s:：]{0,10}?(?:活动时间|开放时间|开启时间|售卖时间|持续时间|领取时间|兑换时间))[ \t]*[:：]/;

// 「研发池名」：`通过“淬炼活动角色” “命运淬炼活动角色”研发池产出/获得` → 池名数组
function ns_bwiki_wikitext_zspmsPools(line) {
	const m = /通过([^，。；\n]{1,90}?)研发池/.exec(line);
	if (!m) return [];
	return m[1].split(/[“”"'‘’「」\s&、]+/).map((x) => x.trim()).filter(Boolean);
}
// 池名前面最近的 `「…」`（就是产出物/角色，如 `「阿德莱德·破渊」`、`「时崎狂三」`）
function ns_bwiki_wikitext_zspmsRoleBefore(line, idx) {
	const head = line.slice(0, idx);
	const all = [...head.matchAll(/「([^」]{1,30})」/g)];
	return all.length ? all[all.length - 1][1].trim() : "";
}

// 正文 wikitext → { anchor, items:[{kind:"gacha"|"event", …}], skipped, headings }
// 条目标签：gacha = 窗口所在行提到「研发池」；event = 带时间标签 / 行首就是窗口 / 行内有「时间段内」。
// **一条都没解出来 → 抛错**（结构性损坏：版本更新公告不可能没有档期；不能静默当"未公布"）。
function ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz = ns_bwiki_wikitext_ZSPMS_TZ, askRow = null) {
	const raw = String(wikitext == null ? "" : wikitext);
	const timeField = ((raw.match(/\|\s*时间\s*=\s*(\d{8})/) || [])[1]) || (askRow && askRow.time) || "";
	const annDate = /^\d{8}$/.test(timeField)
		? { y: +timeField.slice(0, 4), mo: +timeField.slice(4, 6), d: +timeField.slice(6, 8) }
		: null;
	const text = ns_bwiki_wikitext_zspmsNormalize(raw);
	const maint = ns_bwiki_wikitext_zspmsMaintenanceWindow(text, tz);
	const lines = text.split("\n");
	const heads = ns_bwiki_wikitext_zspmsHeadings(lines);
	const items = [];
	let skipped = 0;
	const re = new RegExp(ns_bwiki_wikitext__CN_WIN_SRC, "g");
	let m;
	while ((m = re.exec(text))) {
		// —— 起点：显式时刻 > 相对锚点（① 源站维护结束时刻 → ② 公告时间字段[stellasora 先例] → ③ 自带日期）
		//    三条相对锚点路径都标 startInferred=true，并把依据写进 startFrom（hover 会如实显示）
		let startTs, startInferred = false, startFrom = "", startRel = "";
		if (m[4] != null) {
			startTs = sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
		} else if (m[6] != null) {
			startRel = m[6];
			startInferred = true;
			if (maint && maint.endTs != null) { startTs = maint.endTs; startFrom = `源站维护窗口 ${maint.raw} 的结束时刻`; }
			else if (annDate) { startTs = sourceInstant(annDate.y, annDate.mo, annDate.d, 0, 0, tz); startFrom = `公告时间 ${timeField}`; }
			else { startTs = sourceInstant(+m[1], +m[2], +m[3], 0, 0, tz); startFrom = `自带日期 ${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`; }
		} else {
			startTs = sourceInstant(+m[1], +m[2], +m[3], 0, 0, tz);
			startInferred = true;
			startFrom = "源站只给日期，起点按 00:00";
		}
		// —— 终点（缺时刻按 23:59）
		const endTs = m[10] != null
			? sourceInstant(+m[7], +m[8], +m[9], +m[10], +m[11], tz)
			: sourceInstant(+m[7], +m[8], +m[9], 23, 59, tz);
		if (!(endTs > startTs)) { skipped++; continue; }             // 源站错行 → 丢弃，不硬造

		// —— 行上下文（分类 + 池名 + 活动名都只看本行）
		const lineStart = text.lastIndexOf("\n", m.index) + 1;
		let lineEnd = text.indexOf("\n", m.index);
		if (lineEnd < 0) lineEnd = text.length;
		const line = text.slice(lineStart, lineEnd);
		const lineIdx = text.slice(0, lineStart).split("\n").length - 1;
		const isPool = /研发池/.test(line);
		const base = {
			_i: items.length,
			startTs, endTs,
			raw: m[0],
			startInferred, startFrom, startRel,
			line: line.trim()
		};
		if (isPool) {
			const pools = ns_bwiki_wikitext_zspmsPools(line);
			const role = ns_bwiki_wikitext_zspmsRoleBefore(line, m.index - lineStart);
			items.push({
				...base,
				kind: "gacha",
				banner: pools.length ? pools.join(" / ") : (role || "研发池"),
				roles: role,
				pools
			});
			continue;
		}
		const labelM = ns_bwiki_wikitext__ZSPMS_LABEL_RE.exec(line);
		const stripped = line.replace(/^[\s*•·\-]+/, "");
		if (labelM || stripped.startsWith(m[0]) || /时间段内/.test(line)) {
			items.push({
				...base,
				kind: "event",
				label: labelM ? labelM[1] : "",
				name: ns_bwiki_wikitext_zspmsNameAt(heads, lineIdx) || (labelM ? labelM[1] : "活动")
			});
			continue;
		}
		skipped++;
	}
	if (items.length === 0) throw new Error("zspms-notice:no-window");     // 结构变了，当抓取失败
	return { anchor: maint ? { ts: maint.endTs, raw: maint.raw, how: "维护结束" } : null, announceTime: timeField, items, skipped, headings: heads };
}

// 活动外显优先序：① 剧情/挑战/演算这类"内容档"优先 ② 结束最早 ③ 开始最早 ④ 文档顺序
const ns_bwiki_wikitext__ZSPMS_TIER1 = /剧情|主线|故事|叙事|挑战|BOSS|Boss|试玩|玩法|关卡|演算|行动|作战|防卫|巡防|赛季|联合/;
function ns_bwiki_wikitext_zspmsEventTier(x) { return ns_bwiki_wikitext__ZSPMS_TIER1.test(x.name || "") ? 1 : 2; }
function ns_bwiki_wikitext_zspmsEventCmp(a, b) {
	return (ns_bwiki_wikitext_zspmsEventTier(a) - ns_bwiki_wikitext_zspmsEventTier(b)) || (a.endTs - b.endTs) || (a.startTs - b.startTs) || (a._i - b._i);
}
// ⚠️ 原先这里有个 zspmsHeader()：往悬停首行拼「战双帕弥什 bwiki 版本更新公告「…」（SMW 时间=…；…；tz=UTC+8
//    为推测；起点锚点=源站维护结束 …）」。按方案 A **整段删除**（元信息不进悬停，也不搬到别的字段）。
//    公告标题/SMW 时间/维护窗口仍是**数据字段**（announceTime / anchor / startFrom），解析逻辑不变。

// 两步抓取：ask 索引 → 最新公告正文。结构性损坏（无结果 / 坏 JSON / 正文无档期）都会抛错。
async function ns_bwiki_wikitext_zspmsLatestNotice(url, signal) {
	const rows = ns_bwiki_wikitext_parseZspmsAsk(await fetchJson(url || ns_bwiki_wikitext_ZSPMS_ASK_URL, { referer: ns_bwiki_wikitext_ZSPMS_REFERER, signal, mode: "proxy" }));
	const row = rows[0];
	if (!row || !row.page) throw new Error("zspms-ask:no-page");
	const wikitext = await ns_bwiki_wikitext_fetchWikitext(ns_bwiki_wikitext_zspmsParseUrl(row.page), signal, ns_bwiki_wikitext_ZSPMS_REFERER);
	return { row, rows, wikitext };
}
async function ns_bwiki_wikitext_gachaZspms(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = nowMs()) {
	// `row`（ask 索引行）仍要传给解析器：`{{公告|时间=…}}` 缺失时用它兜底相对起点的锚点。
	const { row, wikitext } = await ns_bwiki_wikitext_zspmsLatestNotice(url, signal);
	const parsed = ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz, row);
	return ns_bwiki_wikitext_gachaPayload(parsed.items.filter((x) => x.kind === "gacha"), tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: (a, b) => (a.endTs - b.endTs) || (a._i - b._i)
	});
}
async function ns_bwiki_wikitext_eventsZspms(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = nowMs()) {
	const { row, wikitext } = await ns_bwiki_wikitext_zspmsLatestNotice(url, signal);
	const parsed = ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz, row);
	return ns_bwiki_wikitext_eventPayload(parsed.items.filter((x) => x.kind === "event"), tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: ns_bwiki_wikitext_zspmsEventCmp,
		nameOf: (x) => x.name
	});
}
//#endregion

//#region 战双：活动日历（结构化活动档期，2026-11-11 起为活动侧默认源）
// 为什么接：活动侧原先靠「版本更新公告」正文（要剥 `{{颜色引用}}`、靠标题栈取活动名），最新一版
// 《远信回响》的档期止于 2026-11-05 ⇒ 11-06 起活动列空窗。`Test4/活动日历` 与卡池侧的
// `Test4/活动旗帜` **同站、同写法**（都是一页数据模板），源站更新一行就多一条 ⇒ 比公告正文规整，
// 也不依赖标题层级。接它不等于"立刻有数据"（实测末条同样止于 2026/11/05），而是**源站一补档就自动恢复**。
//
// 页面实测（2026-11-11T00:58+08，夹具 `test/fixtures/p8-zspms-calendar`，HTTP 200 / 729B）：
//   <div class="newsOut" …><!--只允许显示8个活动-->
//      {{活动日历|「远信回响」主线|2026/09/24 11:00|2026/11/05 5:00}}
//      {{活动日历|「拟战场域」材料|2026/09/24 11:00|2026/11/05 5:00}}
//      … 共 10 行 …
//      {{活动日历|「新增涂装试玩」|2026/09/24 11:00|2026/11/05 5:00}}
//   </div>
// 模板定义（`Template:活动日历`）：位置参数 1=名称、2=开始时间、3=结束时间，另有同义具名参数
// （`名称` / `开始时间` / `结束时间`）⇒ 两种写法都吃。
// 口径：
//   · 活动名 = 参数 1 **原样**（`「远信回响」主线` 就是源站写法，不拆「」、不剥类别后缀）
//   · 起止 `YYYY/MM/DD H:MM`（**时位不补零**，如 `11/05 5:00`），tz = Asia/Shanghai（同文件头推测）
//   · raw = 两端原文（`~` 连接，与活动旗帜同约定）、display = fmtWindow（「两份文本」约定）
//   · 起止读不出 / 终点不晚于起点 ⇒ **跳过该行**（不硬造）；一条都解不出 ⇒ 抛错（模板改版 = 结构性损坏）
//   · 外显/悬停交给共用的 `eventPayload`：**两端都明确且覆盖 now** 才进外显（`coversNow` 唯一真源）
//     ⇒ 当前时刻（2026-11-11）全部已过期 ⇒ 如实返回 null（未公布），绝不把 11-05 收尾的档期当在期。
const ns_bwiki_wikitext_ZSPMS_CALENDAR_PAGE = "Test4/活动日历";
// ⚠️ 页名必须 encodeURIComponent 后再拼（`/` → `%2F`、中文 → %E…）
const ns_bwiki_wikitext_ZSPMS_CALENDAR_URL = "https://wiki.biligame.com/zspms/api.php?action=parse&page="
	+ encodeURIComponent(ns_bwiki_wikitext_ZSPMS_CALENDAR_PAGE) + "&prop=wikitext&format=json&formatversion=2";

// 一页 wikitext → { items:[{ name, startTs, endTs, raw, display, _i }], skipped }
// 只认 `{{活动日历|…}}` 顶层调用（参数里没有花括号；与源站写法一致）。
function ns_bwiki_wikitext_parseZspmsCalendar(wikitext, tz = ns_bwiki_wikitext_ZSPMS_TZ) {
	const text = String(wikitext == null ? "" : wikitext);
	const items = [];
	let skipped = 0;
	const re = /\{\{活动日历\s*\|([^{}]*?)\}\}/g;
	let m;
	while ((m = re.exec(text))) {
		const pos = [], named = {};
		for (const piece of m[1].split("|")) {
			const seg = piece.trim();
			const kv = /^([^=]{1,8})\s*=\s*([\s\S]*)$/.exec(seg);
			if (kv && /^(名称|开始时间|结束时间)$/.test(kv[1].trim())) named[kv[1].trim()] = kv[2].trim();
			else pos.push(seg);
		}
		const name = named["名称"] || pos[0] || "";
		const startRaw = named["开始时间"] || pos[1] || "";
		const endRaw = named["结束时间"] || pos[2] || "";
		if (!name || !startRaw || !endRaw) { skipped++; continue; }
		const sp = ns_bwiki_parsePoints(startRaw)[0];
		const ep = ns_bwiki_parsePoints(endRaw)[0];
		if (!sp || !ep) { skipped++; continue; }
		const startTs = sourceInstant(sp.y, sp.mo, sp.d, sp.h, sp.mi, tz);
		const endTs = sourceInstant(ep.y, ep.mo, ep.d, ep.h, ep.mi, tz);
		if (!(endTs > startTs)) { skipped++; continue; }                    // 源站错行 → 丢弃，不硬造
		items.push({
			name,
			startTs, endTs,
			raw: `${startRaw} ~ ${endRaw}`,
			display: fmtWindow(startTs, endTs, tz),
			_i: items.length
		});
	}
	if (items.length === 0) throw new Error("zspms-calendar:no-window");     // 模板改版/页面清空 = 结构性损坏
	return { items, skipped };
}

async function ns_bwiki_wikitext_eventsZspmsCalendar(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = nowMs()) {
	const wikitext = await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_ZSPMS_CALENDAR_URL, signal, ns_bwiki_wikitext_ZSPMS_REFERER);
	const parsed = ns_bwiki_wikitext_parseZspmsCalendar(wikitext, tz);
	return ns_bwiki_wikitext_eventPayload(parsed.items, tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: ns_bwiki_wikitext_zspmsEventCmp,
		nameOf: (x) => x.name
	});
}
//#endregion

//#region 战双：活动旗帜（结构化当期卡池，2026-11-10 起为卡池侧默认源）
// 为什么换：版本更新公告最新只到 2026-11-05（11-06 起卡池空窗），而 `Test4/活动旗帜` 是
// 结构化数据页、当期 70%UP 池到 11-12 ⇒ 更新更快、结构更稳。公告源保留为手动备选
// （卡池侧 altSources，见 `30-game-bwiki-register.js`）。
//   {{活动旗帜
//   |70%UP1=比安卡·晖暮   |70%UP2=七实·芒星之迹   |70%UP3=海伦汀·安魂
//   |70%UP开始时间=2026/10/29 07:00   |70%UP结束时间=2026/11/12 06:59
//   |100%UP1=阿德莱德·破渊   |100%UP2=时崎狂三·时崎狂三
//   |100%UP开始时间=2026/09/24 11:00   |100%UP结束时间=2026/11/05 05:00
//   <!-- 下面是移动端100%UP池参数--> …}}
// 口径（逐字照源站）：
//   · 池名 = 参数前缀原文 `70%UP` / `100%UP`（源站自己就这么分；不改写成「概率提升池」）
//   · 角色 = 前缀 + 序号 的参数（`70%UP1..3`），按序号排序、`、` 连接；**不删改**源站写法
//     （`时崎狂三·时崎狂三` 是 wiki 页面名本身就这么写，照抄不猜）
//   · 起止 `YYYY/MM/DD HH:MM`，tz = Asia/Shanghai（本源同一推测，见文件头）
//   · raw = 两端原文、display = fmtWindow（「两份文本」约定）
//   · `<!-- … -->` 之后是移动端参数（机体名/立绘…）⇒ 解析到注释就停
const ns_bwiki_wikitext_ZSPMS_FLAGS_PAGE = "Test4/活动旗帜";
// ⚠️ 页名必须 encodeURIComponent 后再拼（`/` → `%2F`、中文 → %E…）
const ns_bwiki_wikitext_ZSPMS_FLAGS_URL = "https://wiki.biligame.com/zspms/api.php?action=parse&page="
	+ encodeURIComponent(ns_bwiki_wikitext_ZSPMS_FLAGS_PAGE) + "&prop=wikitext&format=json&formatversion=2";

// `{{活动旗帜 …}}` 的顶层参数 → { 键: 值 }（跳过空值；注释之后的移动端参数不进来）
function ns_bwiki_wikitext_zspmsFlagParams(wikitext) {
	const out = {};
	for (const line of String(wikitext == null ? "" : wikitext).split(/\r?\n/)) {
		if (/^\s*<!--/.test(line)) break;
		const m = /^\s*\|\s*([^=|\n{}]+?)\s*=\s*(.*?)\s*$/.exec(line);
		if (!m) continue;
		const k = m[1].trim(), v = m[2].trim();
		if (k && v) out[k] = v;
	}
	return out;
}

// `2026/10/29 07:00` → { y, mo, d, h, mi }；缺时刻 → null（旗帜页两端都到分）
function ns_bwiki_wikitext_zspmsFlagPoint(text) {
	const p = ns_bwiki_parsePoints(text)[0];
	if (!p || p.noTime) return null;
	return p;
}

// 活动旗帜 wikitext → [{ pool, roles, startTs, endTs, raw, display }]（源站顺序：70%UP 在前）
function ns_bwiki_wikitext_parseZspmsFlags(wikitext, tz = ns_bwiki_wikitext_ZSPMS_TZ) {
	const params = ns_bwiki_wikitext_zspmsFlagParams(wikitext);
	const prefixes = [];
	for (const k of Object.keys(params)) {
		if (!/开始时间$/.test(k)) continue;
		const prefix = k.slice(0, -"开始时间".length);
		if (prefix && !prefixes.includes(prefix)) prefixes.push(prefix);
	}
	const out = [];
	for (const prefix of prefixes) {
		const roles = [];
		for (const k of Object.keys(params)) {
			if (k.length <= prefix.length || !k.startsWith(prefix)) continue;
			const idx = k.slice(prefix.length);
			if (!/^\d+$/.test(idx)) continue;
			roles.push({ idx: +idx, name: params[k] });
		}
		roles.sort((a, b) => a.idx - b.idx);
		const startRaw = params[prefix + "开始时间"], endRaw = params[prefix + "结束时间"];
		const sp = ns_bwiki_wikitext_zspmsFlagPoint(startRaw);
		const ep = ns_bwiki_wikitext_zspmsFlagPoint(endRaw);
		if (!sp || !ep || roles.length === 0) continue;
		const startTs = sourceInstant(sp.y, sp.mo, sp.d, sp.h, sp.mi, tz);
		const endTs = sourceInstant(ep.y, ep.mo, ep.d, ep.h, ep.mi, tz)
		if (!(endTs > startTs)) continue;                                   // 源站错行 → 丢掉（不硬造）
		out.push({
			pool: prefix,
			roles: roles.map((r) => r.name).join("\u3001"),
			startTs, endTs,
			raw: `${startRaw} ~ ${endRaw}`,
			display: fmtWindow(startTs, endTs, tz)
		});
	}
	if (out.length === 0) throw new Error("zspms-flags:no-pool");          // 模板被改版 = 结构性损坏
	return out;
}

async function ns_bwiki_wikitext_gachaZspmsFlags(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = nowMs()) {
	const wikitext = await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_ZSPMS_FLAGS_URL, signal, ns_bwiki_wikitext_ZSPMS_REFERER);
	const items = ns_bwiki_wikitext_parseZspmsFlags(wikitext, tz).map((p, i) => ({
		banner: p.pool,
		roles: p.roles,
		startTs: p.startTs,
		endTs: p.endTs,
		raw: p.raw,
		display: p.display,
		isMain: true,
		_i: i
	}));
	// 同批合并角色的载荷：70%UP / 100%UP 各自一批（结束时刻不同 ⇒ 只合并同批）
	return ns_bwiki_batchGachaPayloadOf(items, tz, ns_bwiki_wikitext_nowOf(now), { id: "zspms" });
}
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-zspms-official.js：战双官方 CDN「版本更新公告」（活动侧默认源）
// ─────────────────────────────────────────────────────────────────────────────

//
// ══ 为什么接（2026-11-11）══════════════════════════════════════════════════════
// 活动侧此前默认 = bwiki `Test4/活动日历`（结构化档期页），但它**只抄到 2026/11/05**：
//   面板活动列从 11-06 起空窗，而游戏 11-05 已经进了「流光抛诸寰宇」版本。
// 官方 CDN 实测（2026-11-11，直连 200 / `Access-Control-Allow-Origin: *`）：
//   菜单  …/json/G144/ArticleMenu.json            217 条（含 id / 标题 / 类型 / 发布时间）
//   详情  …/json/G144/article/5682.json           《流光抛诸寰宇》版本更新公告（2026-11-03）
//        正文 12 处「2026年11月5日版本更新后 - 2026年12月17日05:00」⇒ **官方比 bwiki 新**
// ⇒ 活动侧默认源改成它（`eventUrl` = ArticleMenu，来源标签「官方公告」），
//   bwiki 两个页面（活动日历 / 旧公告）都降为 `eventAltSources` 手动备选（可切，不自动兜底）。
//
// ══ 抓取链路（4 个请求，全走宿主代理）═════════════════════════════════════════
//   ① ArticleMenu.json → 只留标题匹配「版本更新公告」的条目（**不硬编码 id**），按发布时间倒序取前 3 篇
//   ② 逐篇 article/<id>.json → `articleContent` 是 HTML 富文本 ⇒ 走本文件的解析器
//   ③ 三篇的条目合并（按 名+起+止 去重：相邻两版公告会重复同一批还不算过期的活动）
// ⚠️ 该域名**不在**宿主 `PROXY_ALLOW_HOSTS` 里 → 已在 `src/index.js` 登记
//    （虽然响应带 `ACAO:*`，但全仓口径是"官方公告一律走代理"，与 act-api-takumi 同一条）。
//
// ══ 正文形态（真夹具 `p8-zspms-cdn-menu` / `-art5682` / `-art5467`）═════════════
//   <div><span style="font-size: 18pt;"><strong>四、像素嚼嚼乐</strong></span><br>
//        <strong><span style="font-size: 14pt;">4）活动时间</span></strong><br>
//        <span style="font-size: 14pt;">2026年11月19日10:00 - 2026年12月16日05:00</span></div>
//   ⇒ **活动名在 `<strong>` 里**（不是标题层级：有时是 `一、…` 大标题，有时是 `1）…` 小标题，
//      有时是 `「揽光一瞬」` 这种只有名字的一行），档期是普通 `<span>`；所以：
//     · 整行加粗 = 标题行（大标题以「一、二、…」开头；小标题以「1）2）…」开头；其余按"名字行"处理）
//     · 档期只在**带时间标签**（`活动时间：/开放时间：/…`）或**整行就是档期**的行上认领
//       （正文里 `…将于2026年9月29日10:00 - 2026年11月3日23:59时间段内，通过…研发池获得`
//        这类句子里的档期属于**卡池**，卡池侧另有来源 ⇒ 不认；"整行档期"的判定顺带把它们排除）
//
// ══ 口径（逐条可查）════════════════════════════════════════════════════════════
//   · 起点写「版本更新后 / 维护后 / 更新后」⇒ **startTs = null**（仓库口径 2026-11-09：
//     起点未知 ≠ 已开始，**不猜**；`fillMissingStarts` 那种"显示用的猜测"也不做）
//     ⇒ 这类条目**不进外显**（`coversNow` 要求两端明确），但会进悬停/数组（`coveredOrOpen`：
//       终点未过就如实列出，档期用**源站原文**那一句）
//   · 终点必须绝对；终点写成相对表述（`… - 版本结束`）⇒ 整条丢掉（没有绝对时刻）
//   · 缺年份 ⇒ 借公告发布时间补（共用 `inferYear`）；结束月日早于开始 ⇒ 次年（共用 `endsNextYear`）
//   · 只有日期没有时分 ⇒ 起 00:00 / 止 23:59（仓库通用约定）
//   · tz = Asia/Shanghai（源站无标注；旁证：停服维护 05:00-11:00、卡池日切 05:00，与 bwiki 侧同一推测）
//   · 源站时间文本里的装饰符（`【】「」◆▌` 等）在**活动名**里清掉；名字内的 `·`（`莱亚·祈星`）保留
//
// ══ 不做什么 ══════════════════════════════════════════════════════════════════
//   · **不**用 `ArticleMenu` 里内联的 `articleContent`（菜单确实也带全文，但口径是"逐篇抓详情"：
//     列表只用来挑选，正文以详情为准，源站哪天把菜单瘦身了也不会静默失效）
//   · **不**接卡池侧：官方公告里的卡池档期与 bwiki `Test4/活动旗帜` 同源同期，
//     且公告正文把「研发池」写成句子（不是结构化字段）⇒ 卡池侧维持 bwiki（本任务只改活动侧）

const ns_zspms_cdn_TZ = "Asia/Shanghai";
// ⚠️ G144 = 国服（全球版是另一个 path）；`website2.0` 段不可省
const ns_zspms_cdn_MENU_URL = "https://media-cdn-zspms.kurogame.com/pnswebsite/website2.0/json/G144/ArticleMenu.json";
const ns_zspms_cdn_ARTICLE_BASE = "https://media-cdn-zspms.kurogame.com/pnswebsite/website2.0/json/G144/article/";
// 取最近几篇：3 篇足够（一版公告的档期最长约 6 周，两版必然覆盖当期），
// 且单篇解析失败/结构改版时还有后两篇兜底
const ns_zspms_cdn_MAX_NOTICES = 3;
// 标题判据：**清洗后匹配**「版本更新公告」（不写死 id —— 源站每版换 id）
const ns_zspms_cdn_NOTICE_TITLE_RE = /版本更新公告/;

function ns_zspms_cdn_articleUrl(id) {
	return ns_zspms_cdn_ARTICLE_BASE + encodeURIComponent(String(id)) + ".json";
}

// ── 活动名清洗 ────────────────────────────────────────────────────────────────
// 源站在 `<strong>` 里塞的东西形如：`一、流光抛诸寰宇——新版内容&活动玩法` / `1）尽心者尽美-角色试玩关`
// / `「揽光一瞬」` / `【勤务·限时任务】开放时间：`。清洗规则（顺序固定）：
//   ① 解 HTML 实体（`&middot;` → `·`，`&bull;` → `•`；与全仓同一张表 `decodeExtra`）
//   ② 去行首列表符/装饰符（`- • · ● ◆ ◇ ▌ ▍ ■ □ | ｜ ※`）
//   ③ 去序号（`1）` / `1.` / `一、` / `（3）`）
//   ④ 去**装饰括号**（`【】「」『』`）与装饰块字符（`◆◇▌▍■□●○★☆※`）—— 名字里的 `·` 与 `-` 保留
//   ⑤ 去尾部空白与冒号（`9）新增涂装：` → `新增涂装`）
function ns_zspms_cdn_cleanName(text) {
	let s = decodeExtra(String(text == null ? "" : text)).replace(/\u00a0/g, " ");
	s = s.replace(/^[\s\-–—－•·●◆◇▌▍■□|｜※]+/, "");
	s = s.replace(/^(?:\d{1,2}\s*[）).．、]|[一二三四五六七八九十]{1,3}\s*[、.．]|[（(]\s*\d{1,2}\s*[）)])\s*/, "");
	s = s.replace(/[【】「」『』◆◇▌▍■□●○★☆※]/g, "");
	return s.replace(/[\s:：]+$/, "").replace(/[ \t\u00a0]+/g, " ").trim();
}
// 通用容器名（不是活动名）：`4）活动时间` / `1）活动说明` / `-【勤务】任务开放时间`
// ⚠️ 只认**整串**等于这些词，或**以**时间类标签收尾 —— 不能写成后缀通配：
//    `7日登录签到奖励`、`涂装复刻`、`战略评定手册-栖光档案` 都是**真活动名**。
const ns_zspms_cdn_GENERIC_NAME_RE = /^(活动说明|活动奖励|活动对象|活动规则|活动内容|活动玩法|活动时间|活动周期|参与条件|开启条件|奖励概览|特殊说明|版本新增礼包内容和上架时间请指挥官留意相关公告)$/;
const ns_zspms_cdn_TIME_TAIL_RE = /(活动时间|开放时间|开启时间|持续时间|售卖时间|兑换时间|领取时间)$/;
function ns_zspms_cdn_isGenericName(name) {
	const n = String(name || "");
	return n === "" || ns_zspms_cdn_GENERIC_NAME_RE.test(n) || ns_zspms_cdn_TIME_TAIL_RE.test(n);
}
// 标题行 → 活动名：`6）「伴航补给」研发` 这类"引号里是名字、外面只剩类别后缀"的，取引号内那段；
// 其余（`1）主线剧情-流光抛诸寰宇` / `「揽光一瞬」`）就是清洗后的整行。
function ns_zspms_cdn_titleName(text) {
	const raw = String(text == null ? "" : text);
	const all = ns_zspms_cdn_cleanName(raw);
	const quoted = /[「『【]([^」』】]{1,30})[」』】]/.exec(raw);
	if (quoted) {
		const inner = ns_zspms_cdn_cleanName(quoted[1]);
		const rest = all.split(inner).join("").trim();
		if (inner && rest.length > 0 && rest.length <= 4) return inner;   // 「X」研发 / 【X】开放时间
	}
	const whole = /^[「『【]([^」』】]{1,30})[」』】]$/.exec(raw.replace(/^[\s\-•·]+/, ""));
	if (whole) return ns_zspms_cdn_cleanName(whole[1]);                  // 整行就是「X」
	return all;
}

// ── HTML → 逐行（带"整行加粗"标记）────────────────────────────────────────────
// 只做本任务需要的最小结构提取：`<br>` / 块级结束标签 → 换行；`<strong>`/`<b>` → 私有标记，
// 用来判"这一行是不是标题"。行内其余标签一律丢掉（正文里全是 `<span style>` 包裹）。
function ns_zspms_cdn_linesOf(html) {
	let s = String(html == null ? "" : html);
	s = s.replace(/<(strong|b)\b[^>]*>/gi, "\u0001").replace(/<\/(strong|b)\s*>/gi, "\u0002");
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<\/(?:div|p|h[1-6]|li|ul|ol|tr|td|th|table|tbody|section|blockquote)\s*>/gi, "\n");
	s = s.replace(/<[^>]*>/g, "");
	s = decodeExtra(s);
	const out = [];
	for (const rawLine of s.split(/\r?\n/)) {
		const boldParts = rawLine.match(/\u0001[^\u0001\u0002]*\u0002/g) || [];
		const text = rawLine.replace(/[\u0001\u0002]/g, "").replace(/\u00a0/g, " ");
		const boldText = boldParts.join("").replace(/[\u0001\u0002]/g, "").replace(/\u00a0/g, " ");
		const sq = (x) => x.replace(/[ \t\u00a0]+/g, " ").trim();
		out.push({ text: sq(text), boldText: sq(boldText) });
	}
	return out;
}

// ── 一行里的档期 ──────────────────────────────────────────────────────────────
// 端点：`[YYYY年]M月D日[ HH:MM | 版本更新后…]`（年份可缺 → 借公告年，共用 `inferYear`）
// 连接符：`- — – ~ ～ 〜 至 到`（两侧允许空白；**不跨行** —— 本函数只在单行上跑）
const ns_zspms_cdn_POINT_RE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(\d{1,2})\s*[:：]\s*(\d{2})|(版本更新后|维护结束后|维护完成后|维护后|更新结束后|更新完成后|更新后))?/g;
const ns_zspms_cdn_CONNECTOR_RE = /^\s*[-–—－~～〜至到]\s*$/;
const ns_zspms_cdn_TIME_LABEL_RE = /(活动时间|开放时间|开启时间|持续时间|售卖时间|兑换时间|领取时间)\s*[:：]/;
// 维护窗口（停服/停机维护）**不是活动**：整行有这些词 ⇒ 一律不认（哪怕行里带「活动时间：」标签）。
// 语料实测：三篇真公告里「停服维护/维护更新」只出现在开头那段维护说明里，与「活动时间：」从不同行，
// 所以这条是无损的；写成条件式反而会漏掉「停服维护活动时间：…」这种拙劣写法。
const ns_zspms_cdn_MAINTENANCE_RE = /停服维护|停机维护|维护更新|版本更新维护/;

function ns_zspms_cdn_windowsOfLine(line, tz = ns_zspms_cdn_TZ, hint = null) {
	const s = String(line == null ? "" : line);
	const toks = [];
	ns_zspms_cdn_POINT_RE.lastIndex = 0;
	let m;
	while ((m = ns_zspms_cdn_POINT_RE.exec(s))) {
		if (m[0] === "") { ns_zspms_cdn_POINT_RE.lastIndex++; continue; }
		toks.push({
			start: m.index, end: m.index + m[0].length,
			y: m[1] != null ? +m[1] : null, mo: +m[2], d: +m[3],
			h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null,
			rel: m[6] || ""
		});
	}
	const out = [];
	for (let i = 0; i + 1 < toks.length; i++) {
		const a = toks[i], b = toks[i + 1];
		if (!ns_zspms_cdn_CONNECTOR_RE.test(s.slice(a.end, b.start))) continue;
		if (b.rel) continue;                                            // 终点是相对表述 ⇒ 没有绝对时刻
		const ay = inferYear(a.y, a.mo, hint);
		let by = inferYear(b.y, b.mo, hint);
		if (ay == null || by == null) continue;                         // 无年份线索 ⇒ 不产出（不猜当前年）
		if (a.y == null && b.y == null && endsNextYear(a.mo, a.d, b.mo, b.d)) by = ay + 1;   // 跨年
		const startTs = a.rel ? null : sourceInstant(ay, a.mo, a.d, a.h == null ? 0 : a.h, a.mi == null ? 0 : a.mi, tz);
		const endTs = sourceInstant(by, b.mo, b.d, b.h == null ? 23 : b.h, b.mi == null ? 59 : b.mi, tz);
		if (startTs != null && !(endTs > startTs)) continue;           // 源站错行 ⇒ 丢掉，不硬造
		const endWall = sourceWallParts(endTs, tz);
		const sameYear = ay === endWall.y;
		const aRaw = s.slice(a.start, a.end).replace(/[ \t\u00a0]+/g, " ").trim();
		const bRaw = s.slice(b.start, b.end).replace(/[ \t\u00a0]+/g, " ").trim();
		const startText = startTs == null
			? (sameYear ? `${pad2(a.mo)}-${pad2(a.d)} ${a.rel}` : `${ay}-${pad2(a.mo)}-${pad2(a.d)} ${a.rel}`)
			: (sameYear ? fmtMdHm(startTs, tz) : fmtYmdHm(startTs, tz));
		const endText = sameYear ? fmtMdHm(endTs, tz) : fmtYmdHm(endTs, tz);
		out.push({
			startTs, endTs,
			raw: `${aRaw} ~ ${bRaw}`,
			display: `${startText} ~ ${endText}`,
			startRel: a.rel,
			startInferred: startTs == null,
			_from: a.start,
			_to: b.end
		});
	}
	return out;
}
// 整行是否"只有档期"（把档期原文剪掉后只剩列表符/空白/连接符）：
// `2026年11月19日10:00 - 2026年12月16日05:00` / `•2026年9月24日版本更新后 - 2026年11月4日05:00`
// 按**下标从右往左**剪，避免剪完一次让后面的下标错位（不能拿 raw 再 split —— 原文里可能本来就有 `~`）。
function ns_zspms_cdn_isBareWindowLine(line, wins) {
	let s = String(line == null ? "" : line);
	for (const w of wins.slice().sort((a, b) => b._from - a._from)) {
		s = s.slice(0, w._from) + s.slice(w._to);
	}
	s = s.replace(/^[\s\-–—－•·●◆◇▌▍|｜※]+/, "").replace(/[\s\-–—－~～〜至到:：]+/g, "");
	return s === "";
}

// ── 一篇公告正文 → 活动条目 ───────────────────────────────────────────────────
// `publishedAt` = 该篇发布时间（{ y, mo } 平移到 tz 的墙钟），只用于**补缺年份**。
// 返回 { items, skipped }；一条都没有**不抛错**（单篇无档期 ≠ 整份源坏了，见下面抓取器）。
function ns_zspms_cdn_activitiesOfArticle(html, tz = ns_zspms_cdn_TZ, publishedAt = null) {
	const lines = ns_zspms_cdn_linesOf(html);
	const hint = publishedAt && publishedAt.y != null ? { y: publishedAt.y, mo: publishedAt.mo } : null;
	const items = [];
	let skipped = 0;
	let section = "", sectionIsName = false, cur = "";
	for (const ln of lines) {
		const text = ln.text;
		if (!text) continue;
		const wins = ns_zspms_cdn_windowsOfLine(text, tz, hint);
		if (wins.length > 0) {
			const labelM = ns_zspms_cdn_TIME_LABEL_RE.exec(text);
			const bare = ns_zspms_cdn_isBareWindowLine(text, wins);
			const maint = ns_zspms_cdn_MAINTENANCE_RE.test(text);                // 维护窗口 ≠ 活动
			// 源站行首的 `【名】`（如 `•【勤务·限时任务】开放时间：…`）：比标题栈更贴近这一条
			const bracket = /^\s*[-–—－•·●◆◇▌▍|｜※]*\s*【([^】]{1,30})】/.exec(text);
			const bracketName = bracket ? ns_zspms_cdn_cleanName(bracket[1]) : "";
			for (const w of wins) {
				if (maint) { skipped++; continue; }
				if (!labelM && !bare) { skipped++; continue; }                    // 句子里的档期（多为卡池）
				const name = bracketName || cur || (sectionIsName ? section : "");
				if (!name) { skipped++; continue; }
				items.push({
					name,
					startTs: w.startTs,
					endTs: w.endTs,
					raw: w.raw,
					display: w.display,
					startRel: w.startRel,
					startInferred: w.startInferred,
					_i: items.length
				});
			}
		}
		// ── 标题行状态机（只在**整行加粗**的行上走）──
		// 大标题（`一、…` / `二、…`）：带 `——` 的是**容器**（`二、流光抛诸寰宇——新版内容&活动玩法`），
		//   里面的小标题才是活动名；不带 `——` 的本身就是活动名（`四、像素嚼嚼乐`）。
		// 小标题/名字行（`1）…` / `「揽光一瞬」`）：非通用名 ⇒ 成为后续档期的名字。
		if (ln.boldText && ln.boldText === text) {
			const isSection = /^[一二三四五六七八九十]{1,3}\s*[、.．]/.test(text);
			const name = ns_zspms_cdn_titleName(text);
			if (isSection) {
				section = name;
				sectionIsName = !!name && !/—/.test(name) && !ns_zspms_cdn_isGenericName(name);
				cur = "";
			} else if (name && !ns_zspms_cdn_isGenericName(name)) {
				cur = name;
			} else if (name && ns_zspms_cdn_isGenericName(name)) {
				// 通用小标题（`4）活动时间` / `1）活动说明`）⇒ 名字沿用上一层，不清空
			}
		}
	}
	return { items, skipped };
}

// ── 菜单 → 待抓的「版本更新公告」列表 ─────────────────────────────────────────
// 实测菜单字段：{ articleId, articleTitle, articleType, createTime, startTime, articleContent, … }
//   · 顺序**不是**时间序（置顶/推荐混在一起）⇒ 必须自己按发布时间倒序排
//   · `startTime` = 发布时间（`2026-11-03 17:26:05`），`createTime` 早于它 ⇒ 排序用前者、缺了退后者
function ns_zspms_cdn_menuRows(menu) {
	const list = Array.isArray(menu) ? menu
		: (menu && Array.isArray(menu.data) ? menu.data
			: (menu && Array.isArray(menu.list) ? menu.list : null));
	if (!Array.isArray(list)) throw new Error("zspms-cdn:bad-menu");
	const rows = [];
	for (const it of list) {
		if (!it || typeof it !== "object") continue;
		const id = Number(it.articleId);
		const title = String(it.articleTitle == null ? "" : it.articleTitle).trim();
		if (!Number.isFinite(id) || !title) continue;
		rows.push({
			id,
			title,
			type: Number(it.articleType) || 0,
			published: String(it.startTime || it.createTime || "").trim()
		});
	}
	if (rows.length === 0) throw new Error("zspms-cdn:empty-menu");
	return rows;
}
function ns_zspms_cdn_noticesOf(menu) {
	const rows = ns_zspms_cdn_menuRows(menu)
		.filter((r) => ns_zspms_cdn_NOTICE_TITLE_RE.test(ns_zspms_cdn_cleanName(r.title)));
	if (rows.length === 0) throw new Error("zspms-cdn:no-notice");        // 标题样式改版 = 结构性损坏
	// `YYYY-MM-DD HH:MM:SS` 定长 ⇒ 字符串倒序即时间倒序（不依赖时区换算）
	rows.sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : b.id - a.id));
	return rows;
}

// 详情 JSON → { title, published, html }
function ns_zspms_cdn_articleOf(json) {
	const o = Array.isArray(json) ? json[0] : json;
	if (!o || typeof o !== "object") throw new Error("zspms-cdn:bad-article");
	const html = typeof o.articleContent === "string" ? o.articleContent : "";
	if (!html) throw new Error("zspms-cdn:no-content");                   // 正文缺失 = 结构性损坏
	return { title: String(o.articleTitle || "").trim(), published: String(o.startTime || "").trim(), html };
}
// `2026-11-03 17:26:05` → { y, mo }（墙钟字段，只用来补缺年份）
function ns_zspms_cdn_hintOf(text, tz = ns_zspms_cdn_TZ) {
	const p = ns_bwiki_parsePoints(String(text == null ? "" : text))[0];
	if (!p) return null;
	const w = sourceWallParts(sourceInstant(p.y, p.mo, p.d, p.h, p.mi, tz), tz);
	return { y: w.y, mo: w.mo };
}

// ── 抓取器：菜单 → 最近 3 篇详情 → 合并 → 载荷 ─────────────────────────────────
// 契约与全仓一致：async (url, signal, tz, now = nowMs()) → 数据对象 | null
//   · 单篇详情抓失败 ⇒ 跳过这一篇（其余篇照用）；**全部**失败 ⇒ 抛错（抓取失败 ≠ 未公布）
//   · 三篇都解开但**一条档期都没有** ⇒ 抛 `zspms-cdn:no-window`（正文改版 = 结构性损坏）
//   · 有档期但都不覆盖 now ⇒ 返回 null（未公布；「起点未知」那批按仓库口径**不算**在期）
async function ns_zspms_cdn_events(url, signal, tz = ns_zspms_cdn_TZ, now = nowMs()) {
	const at = ns_bwiki_wikitext_nowOf(now);
	const menuUrl = String(url == null ? "" : url) || ns_zspms_cdn_MENU_URL;
	const notices = ns_zspms_cdn_noticesOf(await fetchJson(menuUrl, { signal, mode: "proxy" }));
	const items = [];
	const seen = new Set();
	let okCount = 0, firstErr = null;
	for (const row of notices.slice(0, ns_zspms_cdn_MAX_NOTICES)) {
		let article;
		try {
			article = ns_zspms_cdn_articleOf(await fetchJson(ns_zspms_cdn_articleUrl(row.id), { signal, mode: "proxy" }));
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		okCount++;
		const hint = ns_zspms_cdn_hintOf(article.published || row.published, tz);
		const parsed = ns_zspms_cdn_activitiesOfArticle(article.html, tz, hint);
		for (const x of parsed.items) {
			const key = `${x.name}|${x.startTs == null ? "open" : x.startTs}|${x.endTs}`;
			if (seen.has(key)) continue;                                 // 相邻两版公告重复列同一活动
			seen.add(key);
			items.push({ ...x, _i: items.length });
		}
	}
	if (okCount === 0) { if (firstErr) throw firstErr; throw new Error("zspms-cdn:no-article"); }
	if (items.length === 0) throw new Error("zspms-cdn:no-window");       // 正文改版 = 结构性损坏
	// 外显：**两端都明确且覆盖 now**（`coversNow` 唯一真源；「版本更新后」那批不冒充在期）
	const live = items.filter((x) => coversNow(x, at));
	if (live.length === 0) return null;
	const cmp = ns_bwiki_wikitext_zspmsEventCmp;                          // 与 bwiki 活动侧同一优先序
	const first = live.slice().sort(cmp)[0];
	// 悬停/数组：在期 + 「起点未知但终点未过」（`coveredOrOpen`，事实层）—— 按结束时间升序
	const hoverItems = items.filter((x) => coveredOrOpen(x, at))
		.sort(cmp)
		.map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
	const hover = hoverTextFromItems(hoverItems, "event", tz);
	const out = {
		event: first.name,
		eventDates: first.display,
		eventDatesRaw: first.raw,
		...(hover ? { eventHover: hover } : {})
	};
	out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "zspms", tz }, at);
	out.eventHoverItems = hoverItems;
	return out;
}


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-register.js：zspms 的条目登记 + 抓取器接线（唯一一处注册）
// ─────────────────────────────────────────────────────────────────────────────

		registerSource({
				id: "zspms",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "战双帕弥什",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b2/99/ed/b299ed39-90ea-03df-c7ee-bd09548991e5/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
				// 2026-11-10：卡池侧改以 `Test4/活动旗帜` 为准（结构化当期池、更新更快）。
				// 2026-11-11：活动侧改以**官方 CDN「版本更新公告」**为准（`ArticleMenu` → 最近 3 篇详情；
				// 官方比 bwiki 新一版：11-05 版本更新那批档期到 12-17，而 bwiki 两个页面都止于 11-05）。
				// 两个 bwiki 页面（`Test4/活动日历` / 旧「版本更新公告」）都降为**手动备选**，解析器与回归全部保留。
				url: ns_bwiki_wikitext_ZSPMS_FLAGS_URL,
				source: "Bwiki 活动旗帜",
				eventUrl: ns_zspms_cdn_MENU_URL,
				eventSource: "官方公告",
				altSources: [{
					label: "Bwiki 更新公告",
					url: ns_bwiki_wikitext_ZSPMS_ASK_URL,
					fetcher: "zspms-bwiki-notice"
				}],
				eventAltSources: [{
					label: "Bwiki 活动日历",
					url: ns_bwiki_wikitext_ZSPMS_CALENDAR_URL,
					fetcher: "zspms-bwiki-calendar"
				}, {
					label: "Bwiki 更新公告",
					url: ns_bwiki_wikitext_ZSPMS_ASK_URL,
					fetcher: "zspms-bwiki-notice"
				}]
		});

		// 卡池侧默认 = 活动旗帜；旧公告路径保留为 altSources 的抓取器键
		// （第 4 参 `now` 是测试专用契约，生产路径引擎只传 3 参 ⇒ 默认 nowMs()）
		GACHA_FETCHERS["zspms"] = (url, signal, tz, now) => ns_bwiki_wikitext_gachaZspmsFlags(url, signal, tz, now);
		GACHA_FETCHERS["zspms-bwiki-notice"] = (url, signal, tz, now) => ns_bwiki_wikitext_gachaZspms(url, signal, tz, now);

		// 活动侧默认 = **官方 CDN**（`ArticleMenu` → 最近 3 篇「版本更新公告」详情，见 30-game-zspms-official.js）；
		// 两个 bwiki 页面保留为 eventAltSources 的抓取器键（设置页可手动切）
		EVENT_FETCHERS["zspms"] = Object.assign(EVENT_FETCHERS["zspms"] || {}, {
			default: (url, signal, tz, now) => ns_zspms_cdn_events(url, signal, tz, now),
			"zspms-bwiki-calendar": (url, signal, tz, now) => ns_bwiki_wikitext_eventsZspmsCalendar(url, signal, tz, now),
			"zspms-bwiki-notice": (url, signal, tz, now) => ns_bwiki_wikitext_eventsZspms(url, signal, tz, now)
		});
