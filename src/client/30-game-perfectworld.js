// src/client/30-game-perfectworld.js —— 完美世界：女神异闻录：夜幕魅影（p5x）/ 异环（nte）/ 幻塔（tof）
//
// 职责（2026-11-16 按厂商重排）：完美世界三款的条目 + 解析器 + 抓取器 + 登记都在本文件；
//   每个 id 只在此注册一次（符号名沿用原 `ns_*`）。
// 组成：
//   · 本文件原有：p5x、nte（官网公告，卡池 + 活动同源）；
//   · 并入 30-game-tof.js：tof（官网 `gamenews` 列表 + 最新版本公告正文；只接卡池侧）。
// 复用关系：三款都走「官网公告列表 → 详情正文抽档期」，解析实现各自一份；共用公共层
//   （fmtWindow / sourceInstant / coversNow / 悬停与数组生成器）。
// 请求预算：p5x / nte 各 1~2 次/轮；tof 列表 1 + 详情 1（详情按 URL 缓存 24h ⇒ 首轮 2 次 / 稳态 1 次）。

		// ── 解析器 / 抓取器 ──

		// 异环（ldshop 繁体）：解析「項目/資訊」卡池表（含 期間/角色/棋盤 行），返回全部卡池
		// 表格行结构：<td><p>期間</p></td><td><p>8月19日－9月9日</p></td>
		// `tz`（可选）= 源站墙钟时区：期间是**源站墙钟**（只有月日），换算与渲染都按它。
		function parseLdshopPools(html, tz) {
			const out = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
			for (const tb of tables) {
				const body = tb[1];
				if (!/期間/.test(body.replace(/<[^>]+>/g, "|"))) continue;
				let info = {};
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
					const tds = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]).trim());
					if (tds.length >= 2 && tds[0] && tds[0] !== "項目") info[tds[0]] = tds[1];
				}
				if (!info["期間"]) continue;
				const range = parseLdshopRange(info["期間"], nowMs(), tz);
				if (!range) continue;
				const chars = [info["全新S級角色"], info["復刻S級角色"]].filter(Boolean).join("/");
				out.push({
					banner: info["角色棋盤"] || "异环卡池",
					roles: chars,
					...range,
					isMain: true
				});
			}
			return out;
		}


		// 异环（ldshop 经 host 代理）：抓页面 → 解析卡池表 → 选当期
		// ⚠️ P3e（2026-11-07）：**直出 `gacha` 数组**。P3c 删掉数据层合成器后，这条备选源只产字符串 ⇒
		//    手动把异环卡池源切到「LDSHOP」时那一侧显示「无数据」。
		//    本源**没有悬停**（改造前只有一口当期池、UI 走默认两行式）⇒ 并列条目为 0（`entries` 传空数组），
		//    与「GachaTracker（英文）」「鸣潮 Bwiki 角色轮换池」两处同一口径：只补"能显示"，不扩事实。
		async function fetchLdshopNte(pageUrl, _signal, tz) {
			const html = await proxyFetchText(pageUrl, "https://www.ldshop.gg/");
			const pools = parseLdshopPools(html, tz);
			if (pools.length === 0) return null;
			const now = nowMs();
			const cur = selectCurrent(pools, now);
			if (!cur) return null;
			cur.gacha = dataArrayProducedGachaOf(cur, [], { tz }, now);
			return cur;
		}


		// 异环（官网 yh.wanmei.com 公告，经 host 代理）：抓游戏公告列表 → 取最新维护/更新公告 → 解析当期限定棋盘卡池与限时活动
		// 官网公告列表条目：<a href="/news/gamebroad/YYYYMMDD/N.html">…<h2 class="title">标题</h2>
		const NTE_ITEM_RE = /<a href="(\/news\/gamebroad\/\d+\/\d+\.html)"[\s\S]*?<h2 class="title">([^<]+)<\/h2>/g;

		// 带新卡池的公告标题：停服维护/版本更新；"1.3版本「…」更新公告"这类版本名夹在中间，所以"更新公告"也要算
		const NTE_MAINT_RE = /停服维护|停服更新|维护公告|版本更新|更新公告/;

		// 逐页向下的上限（2026-10-21 修）：维护公告会随新公告发布被挤到后面的页，只看前几页会把
		// "进行中的卡池"误判成未公布。原值 3 实测**不够**：公告列表**每页只有 3 条**，而"不停服更新"
		// 公告在版本期一天可能发好几条（9/25–10/17 该列表已排到 18 页），真正的版本维护公告
		// （唯一带新卡池的那条，约 3 周一条）几天就被挤出前 3 页 → 池子开到一半又报"未公布"。
		const NTE_MAX_LIST_PAGES = 12;

		// 再深就没意义了：公告列表从新到旧，公测卡池最长 3 周（实测 10-15 → 11-05），
		// 某页**最新一条**都已老于这个天数，说明当期档期不可能还在后面 → 提前收手，省掉一串白请求。
		const NTE_MAX_LOOKBACK_DAYS = 40;

		// 每次最多试几篇公告正文（按从新到旧），避免某篇规则失效时白抓一堆
		const NTE_MAX_DETAILS = 3;

		// 公告链接里的日期 `/news/gamebroad/20261016/264655.html` → 该日 00:00 的 epoch。
		// 只用于"要翻多深"的判断（不参与档期计算），解不出就返回 0（当作"不知道"，不触发提前收手）。
		function ntePostDate(href) {
			const m = String(href || "").match(/\/(\d{4})(\d{2})(\d{2})\/\d+\.html$/);
			return m ? sourceInstant(+m[1], +m[2], +m[3], 0, 0, TZ_CN) : 0;
		}


		// 取分页控件里的后续页地址（相对当前页）：<ul class="pagination"> … <a href="index1.html">2</a>
		function nteNextPageUrls(listUrl, html, seen) {
			const pg = String(html || "").match(/<ul class="pagination">[\s\S]*?<\/ul>/);
			if (!pg) return [];
			const dir = listUrl.split("#")[0].split("?")[0].replace(/[^/]*$/, "");
			const out = [];
			for (const m of pg[0].matchAll(/href="(index\d+\.html)"/g)) {
				const u = dir + m[1];
				if (u !== listUrl && !seen.has(u) && !out.includes(u)) out.push(u);
			}
			return out;
		}


		// 逐页（index.html → index1.html → index2.html …）从新到旧找"带新卡池"的维护/版本更新公告，
		// 取第一篇能解析出当期卡池/活动的正文；"不停服更新"不含新卡池，跳过。
		// 三态：有当期内容 → 数据；列表页有公告但都不含当期内容（或"不停服更新"）→ null（未公布）；
		//      列表页**一条公告链接都没有** → 抛错（官网列表改版，让面板显示"卡池失败"而不是"未公布"）。
		async function fetchNteWanmei(listUrl, signal, tz, now = nowMs()) {
			const ref = "https://yh.wanmei.com/";
			const seen = new Set();
			const queue = [listUrl];
			let details = 0;
			let sawAnyLink = false;
			const cutoff = now - NTE_MAX_LOOKBACK_DAYS * 864e5;
			while (queue.length && seen.size < NTE_MAX_LIST_PAGES) {
				const url = queue.shift();
				if (seen.has(url)) continue;
				seen.add(url);
				const html = await proxyFetchText(url, ref);
				if (/\/news\/gamebroad\/\d+\/\d+\.html/.test(html)) sawAnyLink = true;
				let newestOnPage = 0;      // 本页最新一条公告的发布日期（决定还要不要往下翻）
				// 列表条目本身从新到旧：边收集边试，命中当期内容立刻返回
				for (const m of html.matchAll(NTE_ITEM_RE)) {
					const postTs = ntePostDate(m[1]);
					if (postTs > newestOnPage) newestOnPage = postTs;
					if (!NTE_MAINT_RE.test(m[2]) || /不停服/.test(m[2])) continue;
					if (details >= NTE_MAX_DETAILS) return null;   // 试读额度用完（此时必然已见到公告链接）
					details++;
					const data = parseNteWanmei(await proxyFetchText("https://yh.wanmei.com" + m[1], ref), tz, now);
					if (data) return data;
				}
				// 这一页最新一条都已老于回看窗口 → 后面的页只会更老，当期档期不可能在那里
				if (newestOnPage && newestOnPage < cutoff) break;
				for (const u of nteNextPageUrls(listUrl, html, seen)) if (!queue.includes(u)) queue.push(u);
			}
			if (!sawAnyLink) throw new Error("nte-list-shape-changed");
			return null;
		}


		// 异环公告里的「棋盘」条目解析（角色卡池）。
		//
		// 为什么从**「棋盘」**入手（用户建议，2026-09-30）：
		//   异环的角色卡池在公告里叫「X」**限定棋盘**，条目形如
		//     ● 全新限定S级角色「黑羽」
		//     开放时间：9月24日版本更新后-10月15日05:59
		//     棋盘说明：可通过「预言终幕时」限定棋盘获得S级角色「黑羽」。…
		//   `棋盘说明` 是**角色卡池独有的锚点** —— 弧盘走 `研募说明`、剧情段没有这个字段。
		//   用「有棋盘说明」筛，比用"全新限定S级角色"精确：后者漏掉**返场**（`限定S级角色「安魂曲」返场`，
		//   没有"全新"二字），而那也是一张在开的角色池。
		//
		// 旧实现只认 `全新限定S级角色「X」…开放时间：N月N日**维护**更新后-…` 一条正则，
		// 而现公告写的是 `**版本**更新后` → 一条都匹配不上 → 卡池为空 → `if (!data.banner) return null`
		// → `fetchNteWanmei` 继续往下试，最终拿 index1 页那篇**已过期**的旧公告冒充当期。
		//
		// ⚠️ 2026-10-21 第二个坑（本次真凶）：条目都解得出，但**段落锚点**失效。
		//   旧公告按 `一、 全新角色&弧盘` / `二、 …` 分节，现行公告改成了 `【更新内容】` / `【新增/修复内容】`。
		//   实测 2026-10-14「10月15日停服维护公告」全文**一行 `一、` 都没有** → 旧实现 `return []`
		//   → `data.banner` 为空 → 直接 `return null`（连同一篇里的限时活动也一起丢掉）
		//   → 卡池 + 活动两侧同时报"未公布"，而公告里明明写着「灿烂的星」限定棋盘 10/15–11/05。
		// 所以锚点两种写法都认：起点 = `一、` 或 `【…更新内容】`；终点 = `二、`，否则取起点之后的下一个 `【…】` 小标题。
		function nteContentBounds(lines) {
			let start = lines.findIndex((l) => /^一、/.test(l));
			if (start < 0) start = lines.findIndex((l) => /^【[^】]*更新内容】/.test(l));
			if (start < 0) return null;
			let end = lines.findIndex((l, i) => i > start && /^二、/.test(l));
			if (end < 0) end = lines.findIndex((l, i) => i > start && /^【[^】]+】/.test(l));
			return { start, end: end < 0 ? lines.length : end };
		}

		function parseNteBoards(text, nowYear, tz) {
			const lines = text.split("\n").map((l) => l.trim());
			// 「一、 全新角色&弧盘」/「【更新内容】」这一段的边界（只在这里找，避免匹配到别处的"开放时间"）
			const bounds = nteContentBounds(lines);
			if (!bounds) return [];
			const { start, end } = bounds;
			const pools = [];
			for (let i = start; i < end; i++) {
				const m = lines[i].match(/^●\s*(?:全新)?(限定S级角色|S级角色)「([^」]+)」(返场)?/);
				if (!m) continue;
				// 往后找该条目的「开放时间」与「棋盘说明」（各限 8 行内）
				let range = null, board = "";
				for (let j = i + 1; j < Math.min(end, i + 8); j++) {
					if (!range) {
						const t = lines[j].match(/^开放时间：(\d+)月(\d+)日(?:(?:维护|版本)更新后|(\d{1,2}):(\d{2}))\s*[-–—]\s*(\d+)月(\d+)日(\d{1,2}):(\d{2})/);
						if (t) {
							range = {
								sMo: +t[1], sD: +t[2], sH: t[3] ? +t[3] : 11, sMi: t[4] ? +t[4] : 0,
								eMo: +t[5], eD: +t[6], eH: +t[7], eMi: +t[8]
							};
						}
					}
					if (!board) {
						const b = lines[j].match(/棋盘说明：可通过「([^」]+)」限定棋盘获得/);
						if (b) board = b[1];
					}
				}
				// **有棋盘说明才是角色卡池**（弧盘那条走研募说明，会在这里被排除）
				if (!range || !board) continue;
				// 源站墙钟（月日 + 钟点）→ 绝对时刻：按源站 tz 换算（旧实现 `new Date(...)` = 本机时区，
				// UTC 机器上整窗偏 8 小时；文本在本机恰好 roundtrip 所以本地看不出来）。
				const mk = (yy, mo, d, h, mi) => (typeof sourceInstant === "function"
					? sourceInstant(yy, mo, d, h, mi, tz)
					: new Date(yy, mo - 1, d, h, mi).getTime());
				pools.push({
					name: board,
					// 类型：`全新限定S级角色` → 限定棋盘；`限定S级角色…返场` → 返场限定棋盘。
					// 注意 `限定` 属于**类型的一部分**，不是动词/修饰（与国服"更新限时限定招募"同理）。
					type: `${m[3] ? "返场" : ""}限定棋盘`,
					roles: baRoleName(m[2]),
					startTs: mk(nowYear, range.sMo, range.sD, range.sH, range.sMi),
					endTs: mk(nowYear, range.eMo, range.eD, range.eH, range.eMi)
				});
			}
			return pools;
		}


		// 公告 HTML → 纯文本（保序、按行）。抽出来是为了让回归用例能直接把同一份文本喂给
		// parseNteBoards / nteContentBounds —— 用例里再抄一份剥离规则就等于测试测自己。
		function ntePlainText(html) {
			return String(html || "")
				.replace(/<script[\s\S]*?<\/script>/gi, " ")
				.replace(/<style[\s\S]*?<\/style>/gi, " ")
				.replace(/<[^>]+>/g, "\n")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\n\s*\n+/g, "\n").trim();
		}

		// 活动标题行 / 窗口行（2026-11-26 审计 A：1.5 更新公告里有 **6 个**带档期的活动，旧实现只出 1 个）
		//
		// 旧实现：`text.match(/「([^」]+)」限时活动[\s\S]{0,200}?活动时间：…/)` —— **单次匹配**，天然只取第一个，
		//   `data.events` 也只由这一条生成。1.5 公告（2026-11-04 264869）里同一种写法有 6 条：
		//     ● 「环期赠礼」签到活动     活动时间：11月5日版本更新后-12月17日05:59
		//     ● 「运通全城」限时活动      同窗口
		//     ● 「争锋赏宴·攻坚」限时活动 同窗口
		//     ● 「征途坦荡」限时活动     11月13日10:00-12月17日05:59
		//     ● 「渔获大作战」限时活动   11月16日05:00-12月17日05:59
		//     ● 「集市分福」活动开启     同窗口
		//   五、 全新盲盒「所行皆坦途」上线  活动时间：11月5日版本更新后 - 12月17日05:59（盲盒也是同一写法）
		// ⇒ 改成**逐行扫全部标题行**，各自挂上紧随其后（≤3 行）的「活动时间」。
		//   「签到 / 盲盒」这类与限时活动同写法的窗口也要收（审计点名）；不是标题行的一律不碰（不硬造）。
		const NTE_EVENT_HEAD_RE = /^●\s*「([^」]+)」\s*(?:签到|限时|福利|挑战|纪念)?活动(?:开启|开始)?\s*$/;
		const NTE_BOX_HEAD_RE = /^[一二三四五六七八九十]+、\s*全新盲盒「([^」]+)」上线\s*$/;
		const NTE_EVENT_WIN_RE = /^活动时间：(\d+)月(\d+)日(?:(?:维护|版本)更新后|(\d{1,2}):(\d{2}))\s*[-–—]\s*(\d+)月(\d+)日(\d{1,2}):(\d{2})/;

		// 公告纯文本 → **全部**活动窗口（保持正文顺序）。每项：{ title, startTs, endTs, raw, display }
		// 与卡池同一套墙钟换算（`版本更新后` = 维护 11:00 结束，起点按 11:00 计）。
		function nteActivityWindowsOf(text, nowYear, tz) {
			const lines = String(text == null ? "" : text).split("\n").map((l) => l.trim());
			const mk = (yy, mo, d, h, mi) => (typeof sourceInstant === "function"
				? sourceInstant(yy, mo, d, h, mi, tz)
				: new Date(yy, mo - 1, d, h, mi).getTime());
			const out = [];
			for (let i = 0; i < lines.length; i++) {
				const hm = lines[i].match(NTE_EVENT_HEAD_RE) || lines[i].match(NTE_BOX_HEAD_RE);
				if (!hm) continue;
				for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
					const wm = lines[j].match(NTE_EVENT_WIN_RE);
					if (!wm) continue;
					const sMo = +wm[1], sD = +wm[2], sH = wm[3] ? +wm[3] : 11, sMi = wm[4] ? +wm[4] : 0;
					const eMo = +wm[5], eD = +wm[6], eH = +wm[7], eMi = +wm[8];
					// 跨年（12 月 → 次年 1 月）：终点月份小于起点 ⇒ 终点落在下一年
					const startTs = mk(nowYear, sMo, sD, sH, sMi);
					const endTs = mk(eMo < sMo ? nowYear + 1 : nowYear, eMo, eD, eH, eMi);
					if (!(endTs > startTs)) break;
					out.push({ title: hm[1], startTs, endTs, raw: "", display: fmtWindow(startTs, endTs, tz) });
					break;
				}
			}
			return out;
		}

		// 解析官网公告正文 → 当期卡池（有「棋盘说明」的角色卡池，按**统一规则**合并）+ 当期活动（全部带档期活动）
		// `now` 显式传入（默认取当前时刻）：回归用例要能在任意固定时刻复跑，不被跑测那天的时间卡住。
		function parseNteWanmei(html, tz, now = nowMs()) {
			const text = ntePlainText(html);
			const data = { banner: "", roles: "", bannerDates: "", bannerDatesRaw: "", event: "", eventDates: "", eventDatesRaw: "" };
			// 当期卡池：**按统一规则**——当前时刻落在开放期间内的「棋盘」全部合并外显。
			// 卡片/悬停都走 banner + roles（与其它游戏一致）：类型进 `banner`，
			// 悬停由面板兜底显示 `类型：角色` + 日期。**不构造 bannerHover**（同国服，见 §48.3d）。
			const nowYear = new Date(now).getFullYear();
			const active = parseNteBoards(text, nowYear, tz)
				.filter((p) => p.endTs >= now && p.startTs <= now)
				.sort((a, b) => a.endTs - b.endTs);
			if (active.length > 0) {
				data.banner = [...new Set(active.map((p) => p.type))].join(" & ");
				data.roles = [...new Set(active.map((p) => p.roles).filter(Boolean))].join("、");
				// 窗口取结束最早的那个（与 selectCurrent 的 `first` 同口径）。
				// ⚠️ 文本 = **源站墙钟**（按源站 tz 渲染）：旧实现取 `new Date(ts)` 的本机字段，
				//    而 ts 也是按本机解析的 ⇒ 本地 roundtrip 稳定、UTC 机器上整窗偏 8 小时。
				const first = active[0];
				data.bannerDates = fmtWindow(first.startTs, first.endTs, tz);
				data.bannerDatesRaw = data.bannerDates;
			}
			// 当期活动：**收集全部**带档期活动（签到 / 限时 / 盲盒…都按同一写法），
			// 外显仍按「在期 + 结束最早」挑一条（与 `pickCovering` / `selectCurrent` 的 first 同口径）。
			const evAll = nteActivityWindowsOf(text, nowYear, tz);
			const evLive = pickCovering(evAll, { now, sort: (a, b) => (a.endTs - b.endTs) || 0 });
			if (evLive.length > 0) {
				const first = evLive[0];
				data.event = first.title;
				data.eventDates = first.display;
				data.eventDatesRaw = first.display;
			}
			if (!data.banner) return null;
			// ── P3b：条目事实 → `gacha` / `events` 数组 ────────────────────────────
			// 卡池：该源一次只产出一条卡池行（多处棋盘合并进 banner/roles）；
			// 活动：在期窗口**逐条**进 `events[]` 与悬停（旧实现只由单条 event 生成 ⇒ 1.5 公告丢 5 条）。
			const gachaItems = active.map((p) => ({ title: p.type, startTs: p.startTs, endTs: p.endTs, raw: "" }));
			data.gacha = dataArrayProducedGachaOf(data, gachaItems, { tz }, now);
			data.gachaHoverItems = gachaItems;
			if (data.event) {
				// 悬停：`名称 + 3 空格 + 档期`（由同一份在期条目反生成；只有 1 条时生成器给 "" ⇒ 走默认两行式）
				const hover = hoverTextFromItems(evLive, "event", tz);
				if (hover) data.eventHover = hover;
				data.events = dataArrayProducedEventsOf(data, evLive, { tz }, now);
				data.eventHoverItems = evLive;
			}
			return data;
		}

		// ══ 以下为原 42-parsers-p5x.js 的内容（原样保留；压平后见 30-game-perfectworld.js）══
// 原 src/client/35-parsers-p5x.js（压平后见 30-game-perfectworld.js）
//
// 由 next-sources/parsers/p5x.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_p5x__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// 原 src/client/35-parsers-p5x.js（压平后见 30-game-perfectworld.js） —— P5X 国服（完美世界官方站）
//
// ⚠️ 调研结论（2026-10-02 / 2026-10-03 实测）
//   官方站的**卡池/活动专栏已停更两年**：
//     · /news/gamebroad/（游戏公告）最后一条 2024-10-10
//     · /news/gameevent/（游戏活动）最后一条 2024-09-27
//     · /news/gamenews/（游戏新闻 = 版本更新公告）**仍在更新**（实测最新 2026-09-24「5.4.1版本今日上线」）
//   所以只能从**版本更新公告正文**里抽卡池/活动。这没问题 —— 官方正文是**分区块**的，
//   每个区块自带标题与 `活动时间：`，形如：
//
//     <p>契约更新</p>
//     <p>缘结之契开启</p>
//     <p>活动时间：2026年9月24日—2026年10月22日</p>
//     <p>指定自选契约「缘结之契」再次开启！</p>
//
// ── 2026-10-03 修的真实 bug ──
//   旧实现把**公告标题**（`逐月者之梦《女神异闻录：夜幕魅影》5.4.1版本今日上线`）
//   当成"卡池名"，并在**全文**里抓第一个覆盖当前的 `A日—B日`。后果：
//   · 面板卡池列显示的是**版本更新公告标题**，像"5.4.1版本今日上线"这种，用户看不出卡池是什么；
//   · 抓到的档期是**版本周期**（如 09-24 ~ 10-22），而不是卡池周期。
//   实测反例（证明两者确实不同）：5.3.1 版本周期 8/13–9/3，而官方在同篇正文里给
//   「统统创飞」「怪盗幻像的试炼」写的是 **8/24–9/3**。
//   修法：**先切区块**，卡池只认「契约更新」块、活动只认「活动更新」块，各自用**自己那行的**档期。
//
// 契约：async (url, signal, tz) → { banner, roles?, bannerDates, bannerDatesRaw? } | { event, eventDates, ... }
//
// 时区：国服，源站**未见显式标注**（原文只有「2026年9月24日—10月22日」），按 UTC+8 推定。
// 数据形态：日期是**纯日期无时分** → 起 00:00 / 止 23:59（与 bwiki 通用层 `ns_bwiki_windowsFromCell`
//   同一约定；2026-11-10 起统一，旧实现是 04:00 / 03:59 的国服换日推算）。「持续进行中」这类
//   **没有档期行**的区块保持原状：`windowRaw` 为空 ⇒ 该块不产出（不硬凑）。


const ns_p5x_BASE = "https://p5x.wanmei.com";

// 列表页 → 条目数组 [{ href, title, dateText }]
function ns_p5x_parseP5xList(html) {
	const items = [];
	// 站点形态：<a href="/news/gamenews/20260924/264338.html"> … <p class="item_title">标题</p> … <p class="date_time">2026.09.24</p>
	const re = /<a[^>]+href="(\/news\/[a-z]+\/(\d{8})\/(\d+)\.s?html)"[^>]*>([\s\S]{0,1200}?)<\/a>/g;
	for (const m of String(html).matchAll(re)) {
		const block = m[4];
		const tm = block.match(/class="item_title"[^>]*>([\s\S]*?)<\/\w+>/);
		const dm = block.match(/class="date_time"[^>]*>([\s\S]*?)<\/\w+>/);
		const title = tm ? stripTags(tm[1]) : "";
		if (!title) continue;
		items.push({ href: m[1], dateKey: m[2], id: m[3], title, dateText: dm ? stripTags(dm[1]) : "" });
	}
	// 兜底：站点偶有 class 顺序不同 → 退化为"按 href 切块"再就近找标题/日期
	if (items.length === 0) {
		const links = [...String(html).matchAll(/href="(\/news\/([a-z]+)\/(\d{8})\/(\d+)\.s?html)"/g)];
		for (const m of links) {
			const start = m.index;
			const block = String(html).slice(start, start + 1400);
			const tm = block.match(/class="item_title"[^>]*>([\s\S]*?)<\/\w+>/) || block.match(/<p[^>]*>([^<]{4,80})<\/p>/);
			const title = tm ? stripTags(tm[1]) : "";
			if (title) items.push({ href: m[1], dateKey: m[3], id: m[4], title, dateText: "" });
		}
	}
	// 去重（同一 href 可能在"最新/推荐"两处出现）
	const seen = new Set();
	return items.filter((x) => (seen.has(x.href) ? false : (seen.add(x.href), true)));
}

// 详情页正文 → 纯文本（**按块级标签切行**，区块解析依赖这个行结构）
// 导出供测试：夹具测试需要"HTML→行文本"这一步，跟抓取器用同一实现，避免测试自造。
function ns_p5x_p5xBodyText(html) {
	return decodeEntities(
		String(html)
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/p>/gi, "\n")
			.replace(/<[^>]+>/g, " ")
	).replace(/[ \t\u00a0]+/g, " ");
}

// 从**单行文本**抽「YYYY年M月D日 — YYYY年M月D日」档期
// 形态（实测）：`2026年9月24日—10月22日更新前`、`2026年10月5日—2026年10月22日更新前`、
//              `2026年10月22日-2026年11月19日`（2026-11-10 真机 5.4.2 公告，**只有日期、没有时分**）
//
// ── 只有日期、没有时刻 ⇒ 起 00:00 / 止 23:59（2026-11-10 统一口径）──────────────────
// 与 bwiki 通用层 `ns_bwiki_windowsFromCell` 的注释同一约定（源站只给日期时，"全天"就是那一刻）：
//   · 起点 00:00、终点 23:59，`raw` 仍逐字保留源站原文（不把补出来的钟点写进原文）
//   · 旧实现按"国服 04:00 换日"补 04:00 / 03:59（推算）；2026-11-10 用户要求改成仓库通用约定，
//     跨游戏同一形态的"纯日期"窗口现在读出来一致（`09-24 00:00 ~ 10-22 23:59`）。
function ns_p5x_parseP5xWindows(text, tz) {
	const out = [];
	const re = /(20\d{2})年(\d{1,2})月(\d{1,2})日\s*[—\-~～至–]\s*(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/g;
	for (const m of String(text).matchAll(re)) {
		const y1 = +m[1], mo1 = +m[2], d1 = +m[3];
		const y2 = m[4] ? +m[4] : (endsNextYear(mo1, null, +m[5], null) ? y1 + 1 : y1);   // 跨年：结束月小于开始月
		const mo2 = +m[5], d2 = +m[6];
		// 时刻：公告只给日期 → 起 00:00 / 止 23:59（与 bwiki 通用层同一约定，见上方注释）
		const startTs = sourceInstant(y1, mo1, d1, 0, 0, tz);
		const endTs = sourceInstant(y2, mo2, d2, 23, 59, tz);
		if (endTs <= startTs) continue;
		out.push({ startTs, endTs, raw: `${y1}年${mo1}月${d1}日 ~ ${y2}年${mo2}月${d2}日` });
	}
	return out;
}

// ── 区块解析 ──
// 类别行形态（实测）：`活动更新`、`契约更新`、`玩法更新`、`功能拓展`、`启示卡更新`、
//   `版本更新`、以及**类别与标题同行**的 `活动更新-2.5周年时光庆典`、`活动BOSS更新-追欲的魔术师`。
// 注意：不能只按"含更新"就认 —— 正文里还有 `版本更新后，将新增2种启示卡…` 这类叙述句。
// 这里要求整行**以「类别+更新/拓展」结尾**，或后面只跟一个短分隔符+标题（≤40 字），
// 从而把叙述句排除掉。
const ns_p5x_P5X_CAT_RE = /^([\u4e00-\u9fffA-Za-z]{2,10}(?:更新|拓展))(?:\s*[-－—－:：]\s*(.{1,40}))?$/;
// `活动时间：…` 及其近义写法
const ns_p5x_P5X_TIME_RE = /^(?:活动|开放|售卖|举办|开启|持续)时间\s*[:：]\s*(.+)$/;
// 裸档期行：整行只有日期区间、**没有** `活动时间：` 前缀（实测 5.4.2 公告「契约更新」块：
// `2026年9月24日-2026年11月19日`；正文里 `…更新后…` 这类叙述句不认，必须整行就是区间）。
const ns_p5x_P5X_BARE_TIME_RE = /^20\d{2}年\d{1,2}月\d{1,2}日\s*[—\-~～至–]\s*(?:20\d{2}年)?\d{1,2}月\d{1,2}日$/;

/**
 * 把公告正文切成区块。返回 [{ category, name, title, windowRaw, lines }]
 *   · category —— 类别行（如 `契约更新` / `活动更新`）
 *   · name     —— 与类别同行的标题（`活动更新-2.5周年时光庆典` 时为 `2.5周年时光庆典`）
 *   · title    —— 该区块的展示名：优先同行标题，否则取类别行后的第一条非时间行
 *   · windowRaw—— 该区块里**第一行** `活动时间：…` 的原文
 */
function ns_p5x_parseP5xBlocks(text) {
	const lines = String(text).split("\n").map((s) => s.trim()).filter(Boolean);
	const blocks = [];
	let cur = null;
	for (const line of lines) {
		const cm = line.match(ns_p5x_P5X_CAT_RE);
		if (cm) {
			if (cur) blocks.push(cur);
			cur = { category: cm[1], name: (cm[2] || "").trim(), title: (cm[2] || "").trim(), windowRaw: "", lines: [] };
			continue;
		}
		if (!cur) continue;                    // 类别行之前的内容（导语）忽略
		const tm = line.match(ns_p5x_P5X_TIME_RE);
		if (tm) {
			if (!cur.windowRaw) cur.windowRaw = tm[1].trim();
			continue;
		}
		// 裸档期行也当档期（5.4.2 公告「契约更新」块就是这么写的，见上面 BARE_TIME_RE 注释）
		if (!cur.windowRaw && ns_p5x_P5X_BARE_TIME_RE.test(line)) {
			cur.windowRaw = line;
			continue;
		}
		if (!cur.title) cur.title = line;       // 类别行后紧跟的第一条非时间行 = 标题
		cur.lines.push(line);
	}
	if (cur) blocks.push(cur);
	return blocks;
}

// 供测试：直接对一段正文本跑区块解析
// 归一化标题：去掉站点尾巴「-P5X-《女神异闻录：夜幕魅影》手游官网」
// 取列表里最新的 N 条公告并解析出区块。
// ⚠️ **逐条容错**：只有"最新一条都抓不到"才算真失败（抛出）；
//    次新那条只是"多看一条"的兜底（上一轮公告通常已过期），它抓不到（404/超时）不该拖垮整个条目
//    —— 实测踩过：夹具只映射了最新一条，多抓的第 2 条 404 直接把整条报成"抓取失败"。
async function ns_p5x_fetchP5xAnnouncements(url, signal, count = 2) {
	const listUrl = url || `${ns_p5x_BASE}/news/gamenews/index.html`;
	const list = ns_p5x_parseP5xList(await fetchText(listUrl, { referer: ns_p5x_BASE, signal }));
	if (list.length === 0) throw new Error("p5x-list-empty");
	const sorted = list.slice().sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1)).slice(0, Math.max(1, count));
	const out = [];
	for (let i = 0; i < sorted.length; i++) {
		const item = sorted[i];
		const detailUrl = item.href.startsWith("http") ? item.href : ns_p5x_BASE + item.href;
		try {
			const text = ns_p5x_p5xBodyText(await fetchText(detailUrl, { referer: ns_p5x_BASE, signal }));
			out.push({ item, text, blocks: ns_p5x_parseP5xBlocks(text) });
		} catch (err) {
			if (err && err.name === "AbortError") throw err;   // 中止信号必须透传
			if (i === 0) throw err;                            // 最新一条失败 = 真失败
			// 次新一条失败 → 忽略（已有一条可用）
		}
	}
	return out;
}

// 在候选区块里挑"覆盖当前时刻"的那个；都没有就返回 null（= 未公布）
function ns_p5x_pickCurrentBlock(cands, tz, now) {
	const withWin = [];
	for (const b of cands) {
		const wins = ns_p5x_parseP5xWindows(b.windowRaw, tz);
		if (wins.length === 0) continue;
		withWin.push({ block: b, win: wins[0] });
	}
	return withWin.find((x) => coversNow(x.win, now)) || null;
}

// 正文导语里的「…「X」获取概率限时UP！」—— 本期限定 UP 池名（官方只给名字，常不给档期）
function ns_p5x_p5xUpNames(text) {
	const out = [];
	for (const m of String(text).matchAll(/[「【]([^」】]{2,30})[」】]\s*获取概率限时UP/g)) {
		const n = m[1].trim();
		if (n && !out.includes(n)) out.push(n);
	}
	return out;
}

// ── 卡池侧 ──
// 区块候选 = 「契约更新」块（官方明确写卡池档期的地方）+「扭蛋」块（2026-11-10 实测 5.4.2 公告的
// 「都市更新 / 限定扭蛋复刻」也写了在期档期；类别行是「都市更新」，只有**标题**里带"扭蛋"）。
// 抽不到覆盖当前的档期 → null（未公布）。**绝不**退化成"拿版本公告标题当卡池名"。
// ⚠️ 必须收 `now`（2026-10-17 修）：此前签名只有 (url, signal, tz)、体内写死 `nowMs()` ⇒
//   用例没法注入时刻，夹具窗口一过期（到 2026-10-22 更新前）"选当期"就选不中 → 断言**假红**。
//   第 4 参是**测试专用契约**（沿用 bandori 的约定）；默认值保证生产路径
//   （引擎只传 3 参，见 50-refresh.js:26）行为完全不变。
async function ns_p5x_gachaP5x(url, signal, tz = "Asia/Shanghai", now = nowMs()) {
	const anns = await ns_p5x_fetchP5xAnnouncements(url, signal, 2);
	for (const { text, blocks } of anns) {
		const poolBlocks = blocks.filter((b) => /契约|扭蛋/.test(b.category) || /契约|扭蛋/.test(b.title));
		const hit = ns_p5x_pickCurrentBlock(poolBlocks, tz, now);
		if (!hit) continue;
		const up = ns_p5x_p5xUpNames(text);
		// ⚠️ 2026-10-03 改（方案 A 收敛）：这里原本**手搓**三行悬停 `池名` ⏎ `档期` ⏎ `本期限定UP：角色`
		//    —— 档期夹在名称与角色中间，与本体「池名：角色 ⏎ 档期」的顺序不一致。
		//    现在按通用规则表达：把 UP 角色放进 **`roles`** 字段。
		//    效果（与本体同构）：外显 = 角色名（本体对"有角色名的卡池"就是这么外显的），
		//    UI 默认两行式 = `缘结之契开启：汐见琴音` ⏎ `09-24 04:00 ~ 10-22 03:59`。
		//    只有 1 个当期池 → 不设 bannerHover（hoverPool 的契约就是 <2 条交回 UI）。
		const out = {
			banner: hit.block.title,
			roles: up.join("、"),
			bannerDates: fmtWindow(hit.win.startTs, hit.win.endTs, tz),
			bannerDatesRaw: hit.block.windowRaw,
			startTs: hit.win.startTs,
			endTs: hit.win.endTs
		};
		// ── P3b：这条公告就只有这一口当期池（源站无多池并列）⇒ 数组只有主条 ──
		const items = [{ title: out.banner, startTs: hit.win.startTs, endTs: hit.win.endTs, raw: hit.block.windowRaw }];
		out.gacha = dataArrayProducedGachaOf(out, items, { tz }, now);
		out.gachaHoverItems = items;
		return out;
	}
	return null;
}

// ── 活动侧 ──
// 只认「活动」类区块（`活动更新` / `活动BOSS更新`）。
// 2026-11-18 修：外显不能再只看"结束最早"——源站把**栏目/店铺名**也写成 `活动更新` 类区块
//   （实测 5.4.2 公告：`活动更新-贝萨出品` 1000+ 字正文，档期 10-22~11-19）；
//   同一条公告里真正的活动是 `活动更新` + `「统统创飞」活动开启` / `怪盗幻像的试炼`（11-05~11-19）。
//   三块的类别行**都是** `活动更新`（实测数据，任务书原假设的"类别=活动"在这款源站不存在）⇒
//   类别本身分不出活动与栏目名，只能用「标题像不像活动」补一档。
// 挑选优先级（rank 小者先；同一 rank 内仍按 endTs 升序 + 原文顺序 —— 与旧排序只多了一个 rank 前缀）：
//   rank 0：类别含`活动`且**不含`更新`**，且标题含`活动`   ← 类别行确实是「活动」的源站形态
//   rank 1：类别含`活动`且不含`更新`                      ← 同上，标题不含「活动」也算活动条目
//   rank 2：其余（含「…更新」类别里的活动条目）
//   rank 3：**栏目/店铺名**（标题以`出品`结尾，如「贝萨出品」）—— 它不是活动，永远排最后
function ns_p5x_eventRankOf(block) {
	const category = String((block && block.category) || "");
	const title = String((block && block.title) || "");
	const catEvent = /活动/.test(category);
	const catUpdate = /更新/.test(category);
	if (catEvent && !catUpdate && /活动/.test(title)) return 0;
	if (catEvent && !catUpdate) return 1;
	if (/出品$/.test(title)) return 3;
	return 2;
}
// 当期活动：按 rank → endTs 升序 → 原文顺序（稳定排序）排好；外显取第一条，悬停行用同一顺序。
// ⚠️ `events[]` 的**顺序**不归本文件管：数据层统一口径是 `50-refresh.js` 的 `dataArraySortOf`
//    （结束升序 → 起点升序 → 原文顺序；`mergeEntryRecord` 落盘前还会再排一次）——它是 61 款共用
//    的数组不变式（同一份判据也保证"解析器直出数组 == 从悬停文本反解数组"）。所以这次只改
//    **外显 + 悬停**的顺序，`events[]` 保证**集合不变、一条不删**（「贝萨出品」仍在数组里，
//    只是不再是外显；它在"结束升序 → 起点升序"里因为起点最早（10-22）而排在数组第一位）。
function ns_p5x_orderEventsOf(active) {
	return (Array.isArray(active) ? active : [])
		.map((x, i) => ({ x, i, rank: ns_p5x_eventRankOf(x.block) }))
		.sort((a, b) => (a.rank - b.rank) || (a.x.win.endTs - b.x.win.endTs) || (a.i - b.i))
		.map((o) => o.x);
}
// 同上：收 `now` 注入时刻（2026-10-17 修，测试专用契约，默认 nowMs() 保生产行为）
async function ns_p5x_eventsP5x(url, signal, tz = "Asia/Shanghai", now = nowMs()) {
	const anns = await ns_p5x_fetchP5xAnnouncements(url, signal, 2);
	for (const { blocks } of anns) {
		const evBlocks = blocks.filter((b) => /活动/.test(b.category));
		const active = [];
		for (const b of evBlocks) {
			const wins = ns_p5x_parseP5xWindows(b.windowRaw, tz);
			if (wins.length === 0) continue;
			const w = wins[0];
			if (coversNow(w, now) && b.title) active.push({ block: b, win: w });
		}
		if (active.length === 0) continue;
		// 排序：rank（见 `ns_p5x_eventRankOf`）→ 结束时间升序（越紧迫越前）→ 原文顺序
		const ordered = ns_p5x_orderEventsOf(active);
		const primary = ordered[0];
		// ⚠️ 2026-10-03 改：原本手搓 `名称  + 档期`（**2 个空格**），本体一律 **3 个空格** → 改用生成器。
		// ── P3b：条目事实 → 悬停 + `events` 数组 ──────────────────────────────
		const eventItems = ordered.map((x) => ({ title: x.block.title, startTs: x.win.startTs, endTs: x.win.endTs, raw: "" }));
		const hover = hoverTextFromItems(eventItems, "event", tz);
		const out = {
			event: primary.block.title,
			eventDates: fmtWindow(primary.win.startTs, primary.win.endTs, tz),
			eventDatesRaw: primary.block.windowRaw,
			...(hover ? { eventHover: hover } : {})
		};
		// category / tags 批 1（2026-11-08）：`block.category`（类别行的原文，如 `活动更新` / `活动BOSS更新`）
		// 早就解析出来了（`ns_p5x_parseP5xBlocks`），此前只用来**分流**区块、没进数组 ⇒ 按标题贴进
		// `events[]` 的 `category`。值一个字不改；没有类别行的区块（解析不出）⇒ 不写这个键。
		const facts = {};
		for (const x of ordered) if (x.block.category) facts[x.block.title] = { category: x.block.category };
		if (Object.keys(facts).length) out.itemFacts = facts;
		out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
		out.eventHoverItems = eventItems;
		return out;
	}
	return null;
}

// 供测试：从本地 HTML 直接跑解析（不联网）

		// ── 条目 ──
		registerSource({
				id: "p5x",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "女神异闻录：夜幕魅影",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/03/1e/f4/031ef49f-b3d0-5bdd-077b-67d213f99c86/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://p5x.wanmei.com/news/gamenews/index.html",
				source: "官网公告",
				eventUrl: "https://p5x.wanmei.com/news/gamenews/index.html",
				eventSource: "官网公告",
		});

		registerSource({
				id: "nte",
				defaultHidden: false,
				tz: TZ_CN,
				// 4（2026-11-26）：活动侧由「单次 match 只取第一个」改为**逐条收集全部带档期活动**
				//   （1.5 更新公告 6 个活动此前只出 1 个，审计 A）；卡池规则未变。
				// 3（2026-10-21）：段落锚点从 `一、/二、` 扩到 `【…更新内容】` + 翻页上限 3 → 12（带日期收手）
				parserVersion: 4,
				name: "异环",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/8/8c/YH_APP.png!/fw/512",
				source: "官网公告",
				// 经 host 代理抓取（wanmei 跨域无 CORS）；官方公告（服务端渲染）含当期限定棋盘卡池 + 限时活动起止
				url: "https://yh.wanmei.com/news/gamebroad/",
				// 活动源同官网公告（同一公告同时含卡池与活动）
				eventUrl: "https://yh.wanmei.com/news/gamebroad/",
				eventSource: "官网公告",
				// 备选：LDSHOP（静态表格，经 host 代理）
				altSources: [
					{ label: "LDSHOP", url: "https://www.ldshop.gg/tw/blog/nte/neverness-to-everness-banner.html", fetcher: "nte-ldshop" }
				]
		});

		// ── 抓取器登记 ──
					// 异环：ldshop（繁体，静态表格经 host 代理）
GACHA_FETCHERS["nte"] = (url, signal, tz) => fetchNteWanmei(url, signal, tz);
		GACHA_FETCHERS["nte-ldshop"] = (url, signal, tz) => fetchLdshopNte(url, signal, tz);
					// 异环：活动源就是同一篇官网公告（与卡池侧**同一条 URL**，fetchNteWanmei 一个函数同时解析两者）。
			// 注册成独立活动源的意义：卡池侧本轮抓挂、或用户把**卡池**来源改成自定义/备选时，
			// 活动侧仍能自己抓、自己报错，而不是整列空掉（复用只是"同一 URL 省一次请求"的优化，不是它的腿）。
EVENT_FETCHERS["nte"] = {
				default: (url, signal, tz) => fetchNteWanmei(url, signal, tz)
			};

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		GACHA_FETCHERS["p5x"] = (url, signal, tz) => ns_p5x_gachaP5x(url, signal, tz);
		EVENT_FETCHERS["p5x"] = Object.assign(EVENT_FETCHERS["p5x"] || {}, { default: (url, signal, tz) => ns_p5x_eventsP5x(url, signal, tz) });


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-tof.js：幻塔（tof，国服）—— 官网 gamenews 列表 + 最新版本公告正文
// ─────────────────────────────────────────────────────────────────────────────

//
// ── 落点 ────────────────────────────────────────────────────────────────────────
// 厂商级文件（`30-game-*` 家族，不是 bwiki 系）：唯一来源 `id:"tof"`，**只接卡池侧**。
// 活动侧**没有可靠源**（bwiki /ht 的拟态池停在 2026-08-12；官网「版本更新公告」列表冻结在
// 2026-01-14；TapTap 是 CSR）⇒ 条目写 `eventUrl:""` = 设置页显示「未配置」，不登记活动抓取器
// （与深空之眼 `30-game-bwiki-dhmmr.js` 同一形态）。
//
// ── ① 站点形态（2026-11-15 实测；夹具 test/fixtures/tof-list / tof-detail-264766 / tof-detail-264156）──
//   列表 `GET https://ht.wanmei.com/news/gamenews/index.html`
//     200 / 7,636 B / `text/html`（无 charset 声明，实测 UTF-8）/ **纯服务端渲染**。
//     ⚠️ 响应**没有 `Access-Control-Allow-Origin`**（带 `Origin: dsh-app://dsh` 再测也是空）
//        ⇒ 浏览器直连必被 CORS 拦，**必须走宿主代理**（域名已登记 `src/index.js` 的 `PROXY_ALLOW_HOSTS`）。
//     一页 **6 条**，源站已按日期倒序；`index.html` 是第 1 页，翻页是 `index1.html … index46.html`
//     （共 47 页 / 278 条；当期版本公告一定在第 1 页 ⇒ 本条**只读第 1 页**）。
//     条目形如（一个 `<a>` 里两行）：
//       <a href="/news/gamenews/20261027/264766.html" target="_blank">
//         <div class="top"><span class="t">2026-10-28</span><span class="n">[新闻]</span>
//                          <span class="a">时间背面的谜底 《幻塔》6.5全新版本今日上线</span></div>
//         <div class="desc">…</div></a>
//     `gamenews`（新闻）**全是「《幻塔》X.Y全新版本今日上线」**这类版本公告；
//     `gamebroad`（公告）是维护/活动公告，本条不用。
//   详情 `GET https://ht.wanmei.com/news/gamenews/YYYYMMDD/{id}.html`（同样无 ACAO ⇒ 代理）
//     200 / 6,064~6,868 B / 整页真正要的只有 `<div class="text_cont">` 里那串 `<p>`：
//       `<p>限定拟态角色「黑利·佩茵特」、限定武器「圣谕权杖」以及限定「黑利·佩茵特意志」现已上线。</p>`
//       `<p>正式服活动时间：2026年10月28日12:00-2026年12月16日04:59。</p>`
//       `<p>活动期间，授权者在“黑利·佩茵特订购活动”中可使用「赤核」进行订购，…</p>`
//     ⇒ 版本公告里**头牌限定池**的四件事都写着：池名（`X订购活动`）+ 角色 + 武器 + 起止**到分**。
//     这三个位置（角色行 / 时间行 / 池名行）在 6.3 / 6.4 / 6.5 三版里逐字同形（接这一条时三版都抓过；
//     夹具留 6.5 + 6.4 两篇，6.4 用来证明正则不是只对"当前那一版"成立，见 `cases-new5.mjs` ⑩）。
//
// ── ② 只出「两端都明确」的池（复刻 / 自选UP / 时装一律降级）────────────────────────────
//   时间行必须写成 `正式服活动时间：YYYY年M月D日HH:MM-YYYY年M月D日HH:MM`（两端都带 4 位年 + 时分）
//   才认。版本公告里其余日期都是**单边**的：
//     `全新授权者万圣时装「夜愿魅影」也将于11月1日上架`（只有上架日，没有结束）
//   ⇒ 不产出（不补钟点、不拿版本周期凑终点）。复刻/自选UP 池只写「上架」也是同理。
//   「正式服活动时间」这个标签**必须逐字出现**：它是这条来源唯一的时间锚，抹掉它 ⇒ 这一篇 0 个窗口
//   ⇒ 卡池侧如实 null（nomatch，不是失败）—— 反证在 `cases-new5.mjs` ⑩。
//
// ── ③ 请求预算（用户口径：列表 1 + 每轮只对**最新版本那篇**取详情，详情按 URL 缓存）────────────
//   第 1 轮 = 列表 1 次 + 最新版本公告详情 1 次 = **2 次**；稳态 = **1 次**（详情按 URL 缓存 24h）。
//   ⚠️ 为什么只取最新那一篇：`gamenews` 第 1 页 6 条 = 最近 6 个版本，每个版本一篇公告；
//      当期池一定写在**最新那个版本**的公告里（换版本才有新池）。旧篇只用于"这一版的池已经结束"
//      这种判断 —— 而那种情况本来就该是 null（未公布），不需要多打请求。
//
// ── ④ 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · 列表结构变了（找不到 `<div class="list">` / 一条 `<a>`+`.top` 都解析不出）⇒ **抛**；
//   · 列表正常但**第 1 页没有版本公告**（改版把 gamenews 换了内容）⇒ `null`（当期没有，不是失败）；
//   · 详情结构变了（没有 `<div class="text_cont">` / 没有 `<h1>`；`{}` / 空串 / 改版页都落这里）⇒ **抛**；
//   · 正文正常但没有任何「两端都明确」的池 ⇒ `null`（未公布，不硬凑）；
//   · 解出来了但没有窗口覆盖 now ⇒ `null`（同上）。
//
// ── ⑤ 当期现状（2026-11-15 07:20 +08 实测）────────────────────────────────────────
//   最新版本 = 6.5「时间背面的谜底」（2026-10-28 开）⇒ 卡池外显
//   `黑利·佩茵特订购活动` / 角色 `黑利·佩茵特`（限定武器 `圣谕权杖`）/ `10-28 12:00 ~ 12-16 04:59`。
//   时区 = `Asia/Shanghai`（国服官网墙钟；“到分”的时刻本身就是 UTC+8 写法）。
//
// ── ⑥ 武器只在解析层（不进载荷）────────────────────────────────────────────────────
//   `限定武器「圣谕权杖」` 是这条来源能读到的**事实**（回归在 `cases-new5.mjs` ⑩ 的逐字断言里），
//   但载荷字段是 `banner` + `roles` + 档期：`roles` 是**角色**列，把武器塞进去会让面板把武器当角色。
//   所以 `weapon` 只活在 `ns_tof_detailOf` 的池事实里，`poolItemsOf` 明确丢掉它（不新造载荷字段）。

//#region ① 常量
const ns_tof_TZ = "Asia/Shanghai";
const ns_tof_HOME = "https://ht.wanmei.com/";
const ns_tof_LIST_URL = "https://ht.wanmei.com/news/gamenews/index.html";
const ns_tof_SOURCE_LABEL = "官网公告";
// 详情解析结果按 **URL** 缓存 24h（换版本才有新 URL，不会串）
const ns_tof_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 轮内列表复用兜底上限（同 hl / cytq / pcr-tw 的 30s）
const ns_tof_ROUND_TTL_MS = 30000;
// 列表段（导航里也有链接，收窄到 `.list` 容器更稳，也让静态守卫能定位）
const ns_tof_LIST_OPEN = '<div class="list">';
// 详情正文段：到「返回顶部」锚点为止（正文里可能有嵌套 div，所以**不按第一个 </div> 切**）
const ns_tof_BODY_OPEN = '<div class="text_cont">';
const ns_tof_BODY_END = '<a class="btn_gtt">';
// 条目：`<a href="/news/gamenews/YYYYMMDD/{id}.html">` + `.top` 里的日期 / 栏目 / 标题（四组）
const ns_tof_ITEM_RE = /<a\b[^>]*href="(\/news\/gamenews\/(\d{8})\/(\d+)\.html)"[^>]*>[\s\S]*?<div class="top"><span class="t">([\s\S]*?)<\/span><span class="n">([\s\S]*?)<\/span><span class="a">([\s\S]*?)<\/span><\/div>/g;
// 版本公告标题：`时间背面的谜底 《幻塔》6.5全新版本今日上线` ⇒ 6.5
const ns_tof_VERSION_RE = /《幻塔》\s*(\d+(?:\.\d+)?)\s*全新版本/;
// 角色 + 武器（同一行，源站逐字用「」括起来）
const ns_tof_ROLE_RE = /限定拟态角色「([^」]{1,40})」\s*[、,，]\s*限定武器「([^」]{1,40})」/;
// 时间锚：「正式服活动时间：…」——**唯一**的窗口标签
const ns_tof_TIME_LABEL_RE = /正式服活动时间\s*[：:]\s*([^\n]{8,160})/;
// 两端都必须带 4 位年 + 时分（只有日期 / 只有一端的不认，见文件头 ②）
const ns_tof_WINDOW_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~～—–]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})/;
// 池名：`“黑利·佩茵特订购活动”`（写在时间行**后面**那句「活动期间…」里）
const ns_tof_POOL_NAME_RE = /“([^“”]{1,40}?)订购活动”/;
// 角色行到时间行之间最多隔几行（实测 1 行：中间只隔一张图；放宽到 6 行更抗版式微调）
const ns_tof_ROLE_SPAN_LINES = 6;
// 时间行到池名行最多看几行（实测 1 行）
const ns_tof_NAME_SPAN_LINES = 4;
//#endregion

//#region ② 纯解析：列表
// 列表页 → `[{ id, href, url, date, label, title, version, dateTs }]`，按日期倒序（源站本来倒序，这里再稳一次）。
// **结构变了要抛**：找不到 `.list` 容器、或一条都解析不出（`{}` / 改版页 / 空串都落这里）。
function ns_tof_listOf(html) {
	const src = String(html == null ? "" : html);
	if (src.indexOf(ns_tof_LIST_OPEN) < 0) throw new Error("tof-list-changed:no-list");
	const out = [];
	ns_tof_ITEM_RE.lastIndex = 0;
	let m;
	while ((m = ns_tof_ITEM_RE.exec(src)) !== null) {
		const title = decodeExtra(stripTags(m[6])).replace(/\s+/g, " ").trim();
		const date = String(m[4] || "").replace(/\s+/g, " ").trim();
		out.push({
			id: String(m[3]),
			href: String(m[1]),
			url: ns_tof_HOME.replace(/\/$/, "") + String(m[1]),
			date,
			label: decodeExtra(stripTags(m[5])).replace(/\s+/g, " ").trim(),
			title,
			version: (ns_tof_VERSION_RE.exec(title) || [])[1] || "",
			dateTs: ns_tof_dateTsOf(date)
		});
	}
	if (out.length === 0) throw new Error("tof-list-changed:no-item");
	// 源站已倒序；这里再稳一次（同日按 id 倒序，与 pcr-tw 同一口径）
	return out.sort((x, y) => ((y.dateTs || 0) - (x.dateTs || 0)) || (Number(y.id) - Number(x.id)));
}
// `2026-10-28`（列表上的日期）→ 该日 00:00 的绝对毫秒（只用于排序，不做窗口语义）
function ns_tof_dateTsOf(s) {
	const m = /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/.exec(String(s == null ? "" : s));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], 0, 0, ns_tof_TZ);
}
// 最新版本公告那一行（列表里没有版本公告 ⇒ null = 当期没有，不是失败）
function ns_tof_versionRowOf(rows) {
	const list = Array.isArray(rows) ? rows : [];
	const hits = list.filter((r) => r && r.version);
	return hits.length ? hits[0] : null;
}
//#endregion

//#region ③ 纯解析：详情
// 详情页 → 正文行数组（`<br>` / `</p>` 当行边界，其余标签不插分隔符）。
// 没有 `<div class="text_cont">` ⇒ null（结构变了，调用方抛）。
// ⚠️ **不按第一个 `</div>` 收尾**：正文容器里可能出现嵌套块（图注 / 视频），
//    按容器切会在那里截断 ⇒ 用「返回顶部」锚点 `<a class="btn_gtt">` 当正文结束标记。
function ns_tof_linesOf(html) {
	const src = String(html == null ? "" : html);
	const a = src.indexOf(ns_tof_BODY_OPEN);
	if (a < 0) return null;
	const rest = src.slice(a + ns_tof_BODY_OPEN.length);
	const e = rest.indexOf(ns_tof_BODY_END);
	const body = e >= 0 ? rest.slice(0, e) : rest;
	return body
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|h[1-6]|li|tr|table|section)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((x) => decodeExtra(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
// 详情页 → `{ title, date, pools:[{ banner, role, weapon, startTs, endTs, raw, display }] }`。
// **没有正文容器 / 没有 `<h1>` ⇒ 抛**（`{}` / 空串 / 改版页）；有正文但没有「两端都明确」的池 ⇒ `pools: []`。
function ns_tof_detailOf(html, tz = ns_tof_TZ) {
	const src = String(html == null ? "" : html);
	const lines = ns_tof_linesOf(src);
	if (lines == null) throw new Error("tof-detail-changed:no-body");
	// 标题只在正文**之前**找（详情页导航里没有 h1，但别指望这一点）
	const before = src.slice(0, src.indexOf(ns_tof_BODY_OPEN));
	const h = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(before);
	if (!h) throw new Error("tof-detail-changed:no-title");
	const title = decodeExtra(stripTags(h[1])).replace(/\s+/g, " ").trim();
	// 页头 `<h3><span>2026-10-28</span><span>《幻塔》手游官网</span></h3>`
	const d = /<h3[^>]*>[\s\S]*?<span[^>]*>\s*(\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2})\s*<\/span>/i.exec(before);
	const date = d ? d[1].replace(/\s+/g, "") : "";
	const pools = [];
	const seen = new Set();
	// 状态机：角色行记下 `{ role, weapon, at }`；随后的时间行消费它（用过即清，免得一条角色行配多条时间行）
	let pending = null;
	for (let i = 0; i < lines.length; i++) {
		const rm = ns_tof_ROLE_RE.exec(lines[i]);
		if (rm) {
			pending = { role: rm[1].trim(), weapon: rm[2].trim(), at: i };
			continue;
		}
		const lm = ns_tof_TIME_LABEL_RE.exec(lines[i]);
		if (!lm) continue;
		const wm = ns_tof_WINDOW_RE.exec(lm[1]);
		if (!wm) continue;                                   // 单边/无年份 ⇒ 不认（见文件头 ②）
		const role = pending && i - pending.at <= ns_tof_ROLE_SPAN_LINES ? pending : null;
		pending = null;
		if (!role) continue;                                 // 没有角色行 ⇒ 不是限定池
		const startTs = sourceInstant(+wm[1], +wm[2], +wm[3], +wm[4], +wm[5], tz);
		const endTs = sourceInstant(+wm[6], +wm[7], +wm[8], +wm[9], +wm[10], tz);
		if (startTs == null || endTs == null || !(endTs > startTs)) continue;   // 源站错行 ⇒ 丢掉
		const pool = ns_tof_poolNameOf(lines, i);
		// 池名优先取正文里那对引号（源站自己的写法）；取不到按源站命名规律由角色名派生（`X订购活动`）
		const banner = pool || `${role.role}订购活动`;
		const key = `${banner}|${startTs}|${endTs}`;
		if (seen.has(key)) continue;
		seen.add(key);
		pools.push({
			banner,
			role: role.role,
			weapon: role.weapon,
			startTs,
			endTs,
			raw: wm[0],
			display: fmtWindow(startTs, endTs, tz)
		});
	}
	return { title, date, pools };
}
// 时间行之后的池名（`“X订购活动”`）；找不到 ⇒ 空串（交给调用方按角色名派生）
function ns_tof_poolNameOf(lines, at) {
	for (let j = at + 1; j <= at + ns_tof_NAME_SPAN_LINES && j < lines.length; j++) {
		const m = ns_tof_POOL_NAME_RE.exec(lines[j]);
		if (m) return `${m[1].trim()}订购活动`;
	}
	return "";
}
// 详情 → 卡池条目事实（每口池一条；`weapon` 留在解析层，见文件头 ⑥）
function ns_tof_poolItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const items = [];
	for (const p of Array.isArray(d.pools) ? d.pools : []) {
		items.push({
			_i: items.length,
			banner: p.banner,
			roles: p.role,
			startTs: p.startTs,
			endTs: p.endTs,
			raw: p.raw,
			display: p.display,
			isMain: true
		});
	}
	return items;
}
//#endregion

//#region ④ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
let ns_tof_listCache = null;                 // { url, round, at, promise }
let ns_tof_detailCache = new Map();          // 详情 URL → { at, value:{ title, date, pools } }
function ns_tof_resetCache() { ns_tof_listCache = null; ns_tof_detailCache = new Map(); }
// 列表：一轮刷新里现取一次（轮外 / 设置页「测试来源」也现取），轮内 30s 复用同一个 promise
async function ns_tof_rowsOf(url, signal) {
	const key = String(url == null ? "" : url).trim() || ns_tof_LIST_URL;
	const at = nowMs();
	const round = fetchRoundSeqOf();
	const hit = ns_tof_listCache;
	let promise;
	if (fetchRoundActive() && hit && hit.url === key && hit.round === round && at - hit.at < ns_tof_ROUND_TTL_MS) {
		promise = hit.promise;
	} else {
		promise = fetchText(key, { mode: "proxy", referer: ns_tof_HOME, signal })
			.then((html) => ns_tof_listOf(html));
		ns_tof_listCache = { url: key, round, at, promise };
		promise.catch(() => { if (ns_tof_listCache && ns_tof_listCache.promise === promise) ns_tof_listCache = null; });
	}
	return promise;
}
// 版本公告详情：按 URL 缓存 24h（换版本换 URL ⇒ 自然失效）
async function ns_tof_detailOfRow(row, signal, tz, now) {
	const hit = row && ns_tof_detailCache.get(row.url);
	if (hit && now - hit.at < ns_tof_CACHE_TTL_MS) return hit.value;
	const html = await fetchText(row.url, { mode: "proxy", referer: ns_tof_HOME, signal });
	const value = ns_tof_detailOf(html, tz);
	ns_tof_detailCache.set(row.url, { at: now, value });
	return value;
}
// 卡池侧：列表 1 次 → 最新版本公告 1 次（缓存内 0 次）→ 覆盖 now 的池（没有就 null）
async function ns_tof_gacha(url, signal, tz = ns_tof_TZ, now = nowMs()) {
	const at = ns_bwiki_nowOf(now);
	const rows = await ns_tof_rowsOf(url, signal);
	const row = ns_tof_versionRowOf(rows);
	if (!row) return null;                                   // 第 1 页没有版本公告 ⇒ 当期没有
	const detail = await ns_tof_detailOfRow(row, signal, tz, at);
	const items = ns_tof_poolItemsOf(detail);
	if (items.length === 0) return null;                     // 有公告但没有两端明确的池 ⇒ 未公布
	return ns_bwiki_batchGachaPayloadOf(items, tz, at, { id: "tof" });
}
//#endregion

//#region ⑤ 条目登记
// 卡池来源标签按任务书提议「官网公告」；活动侧**留空** = 显示「未配置」（见文件头 ①）。
registerSource({
	id: "tof",
	// 活动侧未配置（`eventUrl` 为空）⇒ 出厂隐藏（用户 2026-11-19 口径）。
	defaultHidden: true,
	tz: ns_tof_TZ,
	name: "幻塔",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/6d/f5/a0/6df5a0a7-6ae6-9b9c-310a-1c4515c42cf3/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
	url: ns_tof_LIST_URL,
	source: ns_tof_SOURCE_LABEL,
	eventUrl: ""
});
GACHA_FETCHERS["tof"] = (url, signal, tz, now) => ns_tof_gacha(url, signal, tz, now);
//#endregion
