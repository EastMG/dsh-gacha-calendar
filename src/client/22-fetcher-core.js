// src/client/22-fetcher-core.js —— 抓取公共设施：抓取桥接 + 通用载荷 + 备选源解析
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// 角色名清理：去首尾方括号/空白（zzz 的 [希格莉德（强攻·冰）]）
		function cleanRoles(roles) {
			const r = stripTags(roles).replace(/^[\[【\s]+|[\]】\s]+$/g, "");
			return r;
		}


		// 主池过滤：排除武器/光锥/音擎/回响/重映等副池
		function isMainBanner(banner) {
			if (!banner) return false;
			if (/武器|光锥|音擎|回响|重映|神铸赋形|流光定影|溯回忆象/.test(banner)) return false;
			return /角色活动祈愿|角色活动跃迁|独家频段|寻访|频段/.test(banner) || banner.includes("「");
		}


		// 通用抓取网页文本：MediaWiki api.php（action=parse）→ JSON 的 parse.text；其它 URL → 原始 HTML
		//
		// 同一轮里按 URL 缓存：两侧同址时（自定义条目最常见：用户把同一个页面同时填给
		// 卡池与活动），需要在**不重复发请求**的前提下拿到同一份文本 —— 见 50-refresh.js
		// 的「两侧同一条 URL、活动侧无注册抓取器」分支。缓存按轮清空（refreshAll 开始时重置），
		// 避免跨轮拿到过期数据。
		let htmlTextCache = null;

		function resetHtmlTextCache() { htmlTextCache = new Map(); }

		// **只读**查询：命中才返回，绝不发起请求。
		// 用途见 50-refresh.js：两侧同址且活动侧没有注册抓取器时，**只有在卡池那次
		// 已经通过本函数取过同一 URL 的情况下**才复用；否则宁可记"未公布"，
		// 也**绝不**去打那次注定被 CORS 拦的直连（这条语义有测试守护，别改成会发请求）。
		function peekHtmlText(url) {
			return (htmlTextCache && htmlTextCache.get(url)) || null;
		}

		async function fetchHtmlText(url, signal) {
			if (htmlTextCache && htmlTextCache.has(url)) return htmlTextCache.get(url);
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			let out;
			if (/action\s*=\s*parse/i.test(url)) {
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				out = text;
			} else {
				out = await res.text();
			}
			if (htmlTextCache) htmlTextCache.set(url, out);
			return out;
		}


		// ── P3e（2026-11-07）：通用卡池载荷的**收口**（条目事实 → 悬停 + `gacha` 数组）──
		// 为什么需要：三条通用分支（bwiki 式表 / 方舟轮换表 / 普通 HTML 表）此前都只产字符串；
		// P3c 把数据层的"字符串 → 数组"合成器删掉之后，**用户自定义地址**（`custom:<url>` /
		// 自定义条目）切过去那一侧就恒为空数组 ⇒ 面板写「该来源无数据」（功能回归）。
		//
		// 三段式与内置源完全一致（`bwikiGachaPayload` / `selectArknights` 同一套）：
		//   条目事实（覆盖当前的池）→ `hoverTextFromItems` 反生成悬停 → `dataArrayProducedGachaOf` 收口。
		// ⚠️ 主条仍来自 `selectCurrent` 的 4 个字符串字段（与改造前同一句、值一字不改）；
		//    并列条目 = 覆盖当前的**主池**（与内置 bwiki 同一条判据：`isMain` + `coversNow`）。
		// ⚠️ `selectCurrent` 会**就地**补全缺失起点（fillMissingStarts）⇒ 必须先拍快照再调它
		//    （与 `bwikiGachaPayload` 的手法一致），否则"X.Y版本更新后"那类行的 raw/起点会被改写。
		function genericGachaPayloadOf(items, tz, now) {
			const list = Array.isArray(items) ? items : [];
			if (list.length === 0) return null;
			const snapshot = list.map((it) => ({
				name: it.banner,
				roles: it.roles || "",
				startTs: it.startTs,
				endTs: it.endTs,
				raw: it.rawOriginal || it.raw,
				isMain: it.isMain
			}));
			const cur = selectCurrent(list, now);
			if (!cur) return null;
			const pools = snapshot
				.filter((it) => it.isMain && coversNow(it, now))
				.map((it) => ({
					name: it.name,
					label: `${it.name}${it.roles ? `\uFF1A${cleanRoles(it.roles)}` : ""}`,
					startTs: it.startTs,
					endTs: it.endTs,
					raw: it.raw
				}));
			// 顺序/去重走共用工具（`poolHoverKept` = `buildPoolHover` 里同一份）
			const hoverItems = poolHoverKept(pools).map((p) => ({
				title: p.label || p.name,
				label: p.label || p.name,
				startTs: p.startTs,
				endTs: p.endTs,
				raw: p.raw
			}));
			const out = { ...cur, bannerHover: hoverTextFromItems(hoverItems, "gacha", tz) };
			out.gacha = dataArrayProducedGachaOf(out, hoverItems, { tz }, now);
			out.gachaHoverItems = hoverItems;
			return out;
		}


		// 通用卡池解析（新增自定义条目的"卡池来源"地址用）：
		// 依次尝试 bwiki 式「时间+版本」表、方舟式「限时寻访」表、GachaTracker 式日期表、
		// Next.js SPA（canmoe 等，页面无表格、数据在组件 chunk 里），选当期；
		// 最后再退到**普通 HTML 表**（见下方 collectGenericGacha）；
		// 全部失败返回 null（调用方按解析失败处理，不做可达性健康检查）
		// ⚠️ P3e：前两条与末位兜底都改走 `genericGachaPayloadOf`（直出数组）；
		//    `parseGachaTracker` / `parseCanmoe` 在 P3d 就已经直出，这里原样返回。
		async function tryParseGenericGacha(url, signal, tz) {
			const html = await fetchHtmlText(url, signal);
			const now = nowMs();
			const bwiki = genericGachaPayloadOf(parseAllBwiki(html, tz), tz, now);
			if (bwiki && bwiki.banner && bwiki.bannerDates) return bwiki;
			const ak = genericGachaPayloadOf(parseArknights(html, tz), tz, now);
			if (ak && ak.banner && ak.bannerDates) return ak;
			const gt = parseGachaTracker(html, tz);
			if (gt && gt.banner && gt.bannerDates) return gt;
			// Next.js SPA：HTML 无表格数据，定位组件 chunk 后抓 chunk JS 解析。
			// chunk 与页面同源：页面能直连（CORS 允许）时 chunk 直连，否则经 host 代理。
			const chunks = nextJsChunkUrls(html, "BannerCalendar", url);
			for (const c of chunks) {
				try {
					const js = await fetchHtmlText(c, signal);
					// 每个 chunk 只解析一次：解析里最重的是 chunk 的括号平衡扫描，
					// 而"没命中当期"恰恰是最常见的情况 → 不要为了`a || b`那种写法白跑两遍
					const d = parseCanmoe(js, now, tz);
					if (d && d.banner && d.bannerDates) return d;
				} catch { /* 下一个 chunk */ }
			}
			// 末位兜底：**普通 HTML 表**（时间 + 名称两列，或含「类型」列）。
			// 为什么需要（2026-10-01 用户点名）：上面三条都是各自的**私有格式**
			// （bwiki 卡池列 / PRTS 卡池一览 / GachaTracker），而用户给自定义条目
			// 填一个普通 wiki 页面时，**活动列能出、卡池列恒空** —— 同一张表明显有内容。
			// 这一兜底复用与活动侧同一套"时间+名称"列识别，保证自定义条目两侧口径一致。
			const generic = genericGachaPayloadOf(collectGenericGacha(html, tz), tz, now);
			if (generic && generic.banner && generic.bannerDates) return generic;
			return null;
		}


		// 「类型」列的**多值拆分**（2026-11-08，批 2）：源站把多个类型写在**同一个单元格**里，
		// 分隔符是 `<br />`（实测普查 236 行 = 绝区零活动一览 233 + 星铁夹具 3：`<br>` / `/` / `、` /
		// `,` / `；` / `※` / 换行 全是 0 处，单元格内也没有 `<p>` / `<div>`）。⚠️ `stripTags` 会把
		// `<br />` 变成**空格** ⇒ 多值会粘成「版本活动 常驻活动」这种串，所以**必须先按 `<br />` 拆、
		// 再逐段 stripTags**。返回：去空、保序的类型数组（首项进 `category`，其余进 `tags`）。
		const CATEGORY_SEPARATOR_RE = /<br\s*\/?>/i;
		function categoryValuesOf(cellHtml) {
			return String(cellHtml == null ? "" : cellHtml)
				.split(CATEGORY_SEPARATOR_RE)
				.map((s) => stripTags(s).trim())
				.filter(Boolean);
		}


		// 通用活动解析：扫描含「时间」（或「活动时间」）表头的表格，行内找时间与名称列，选当期
		// 起始为"版本更新后"等无日期文本时保留 startTs=null，由 selectCurrent 的 fillMissingStarts 补全
		function collectGenericEvents(html, tz) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				// 「类型」列（如 版本活动/常规活动/剧情活动）→ 用于活动外显的类别优先级
				const heads = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]).trim());
				const categoryIdx = heads.findIndex((h) => /类型|類型/.test(h));
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/<td/i.test(row)) continue;
					// 单元格**原文**（只有类型列需要）：`<br />` 在 stripTags 里会变成空格，多值就拆不开了
					const cellsHtml = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
					const tds = cellsHtml.map((h) => stripTags(h).trim());
					if (tds.length < 2) continue;
					// 时间列（含日期/区间）与名称列分开
					let name = "", time = "";
					for (const td of tds) {
						if (!time && /20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|[~～]/.test(td)) time = td;
						else if (td && !name) name = td;
					}
					if (!time || !name) continue;
					// 名字里偶发混进图片文件名残渣（如「文件:巡星之礼第二十六期.png 」）→ 去掉该前缀
					name = name.replace(/^文件:[^\s]*?\.(?:png|jpe?g|gif|webp|svg)\s*/i, "").trim();
					if (!name) continue;
					const range = parseRange(time, tz);
					// 起始可为 null（"版本更新后"），结束时间必须有效——**除非这行是永久活动**。
					// 原来这里一律 `endTs == null → continue`，把「…~永久」的行在采集阶段就丢了，
					// 下游连"它存在过"都看不到（表现为源站表里有、面板悬停里没有）。
					// 永久活动（结束写作「永久」）保留下来，由 genericEventPayload 单独计数；
					// 其它无结束时间的行仍按旧规则丢弃（起止都拿不到，画不出来）。
					// 「永久」可能落在多值类型里的**任意一项**（如 `永久活动`），所以按整组判。
					const categories = categoryValuesOf(categoryIdx >= 0 ? cellsHtml[categoryIdx] : "");
					const isPermanent = range.endTs == null
						&& (categories.some((v) => /永久/.test(v)) || /永久\s*$/.test(String(range.raw || time)));
					if (range.endTs == null && !isPermanent) continue;
					// 类型是多值 ⇒ **首项进 `category`、其余进 `tags`**（与批 1 原神 SMW 的做法一致）；
					// 表里没有「类型」列 / 单元格为空 ⇒ 两个键都不写（不写 > 写个空值）。
					const item = { banner: name, category: categories[0] || "", ...range, isMain: true };
					if (categories.length > 1) item.tags = categories.slice(1);
					items.push(item);
				}
			}
			return items;
		}


		// 当期活动（外显取 selectCurrent 的那条，行为同旧版）
				// 通用**卡池**采集（末位兜底，2026-10-01 加）：
		// 与 collectGenericEvents 同一套「时间 + 名称」列识别，但用于**卡池列**。
		//
		// 为什么需要：tryParseGenericGacha 前三条路径（parseAllBwiki / parseArknights /
		// parseGachaTracker）认的都是各自源站的**私有结构**；用户给自定义条目填一个普通
		// wiki 页面时，活动列（走 collectGenericEvents）能出内容，**卡池列却恒空**。
		// 这一条让"同一张表、两侧都能读"，与活动侧口径一致。
		//
		// 与活动侧的唯一差别：**不丢"永久"行**（卡池没有"永久"语义，但也不该在采集阶段
		// 就无声消失），并保留 roles 空串（普通表里没有角色列的结构约定）。
		function collectGenericGacha(html, tz) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				const heads = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]).trim());
				const categoryIdx = heads.findIndex((h) => /类型|類型/.test(h));
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/<td/i.test(row)) continue;
					const cellsHtml = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
					const tds = cellsHtml.map((h) => stripTags(h).trim());
					if (tds.length < 2) continue;
					let name = "", time = "";
					for (const td of tds) {
						if (!time && /20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|[~～]/.test(td)) time = td;
						else if (td && !name) name = td;
					}
					if (!time || !name) continue;
					name = name.replace(/^文件:[^\s]*?\.(?:png|jpe?g|gif|webp|svg)\s*/i, "").trim();
					if (!name) continue;
					const range = parseRange(time, tz);
					// 起止都拿不到的行画不出来（活动侧对"永久"有特例，卡池没有该语义）
					if (range.startTs == null && range.endTs == null) continue;
					// 与活动侧同一套类型列口径（多值按 `<br />` 拆；首项 category、其余 tags）
					const categories = categoryValuesOf(categoryIdx >= 0 ? cellsHtml[categoryIdx] : "");
					const item = { banner: name, roles: "", category: categories[0] || "", ...range, isMain: true };
					if (categories.length > 1) item.tags = categories.slice(1);
					items.push(item);
				}
			}
			return items;
		}


		// 活动列载荷：外显=排序第一条（最快结束的当期活动，③）；eventHover=全部覆盖当前时刻的活动（同序）。
		// 注意 selectCurrent 会就地补全缺失起点（fillMissingStarts），故这里只取快照自行排序，
		// 避免"版本更新后 ~ 未来"这类起点未给的行被补成未来起点而漏掉。
		// 只有 1 条时生成器返回 ""，由 UI 退回单条展示（兜底）。
		//
		// ── P3b（2026-11-07）：**条目事实 → 悬停 + `events` 数组** ──────────────────
		// 这个生产者为星铁活动一览（默认源）与绝区零 Bwiki 活动一览（备选源）共用，也是
		// **唯一会用到 `permanentCount`（「以及常驻活动 N 项」）** 的地方 —— 所以 P3b 先给
		// 生成器补上 `opts.permanentCount`，再在这里切。顺序（`sortEventItems`）由本函数负责，
		// 生成器**不排序**（与 buildEventHover 一致）。
		function genericEventPayload(html, tz, opts) {
			const items = collectGenericEvents(html, tz);
			// 页面拿到了却连一行候选都没有 → 活动表结构变了（抛错 = "活动失败"）；
			// 有候选但当期没有覆盖现在的 → 下面返回 null（未公布）
			if (items.length === 0) throw new Error("bwiki-event-no-table");
			// 快照带上类别事实（多值时 `category` = 首项、`tags` = 其余项）：`isPermanentEvent` /
			// `pickEventPrimary`（→ `eventTier`）与下面的 `itemFacts` 都从这份快照读，漏一个字段
			// 就等于"源站给了、数据层之前就丢了"（实测：漏 `tags` 时多值的第二项直接消失）。
			const snapshot = items.map((it) => {
				const row = { name: it.banner, category: it.category || "", startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw };
				if (Array.isArray(it.tags) && it.tags.length) row.tags = it.tags;
				return row;
			});
			const now = nowMs();
			// 永久/常驻活动单独计一项：它们 endTs 为 null，本就不该混进"当期"排序，
			// 但也不能像以前那样无声丢掉（见 isPermanentEvent 注释）。
			const permanent = snapshot.filter((it) => isPermanentEvent(it));
			// 外显：只从**两端都明确且覆盖 now** 的行里挑（`coversNow`，2026-11-09 收紧：
			// 起点写成「X.Y版本更新后」而没有日期的行不参与"是否已开始"的判定）。
			const active = sortEventItems(snapshot.filter((it) => coversNow(it, now)));
			if (active.length === 0) return null;
			// 悬停 / 数组 = 在期 ∪ **起点未知但终点未过**（用户口径：未知起点不算已开始，
			// 但事实仍要在悬停里列出；否则 bwiki 那些「4.6版本更新后 ~ …」的行会无声消失）。
			const listed = sortEventItems(snapshot.filter((it) => coveredOrOpen(it, now)));
			// 外显：类别优先（剧情/叙事、限时高难），同级内结束时间升序；悬停仍按 endTs 升序全量
			const primary = pickEventPrimary(active) || active[0];
			const hoverItems = listed.map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
			const out = {
				event: primary.name,
				eventDates: primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || ""),
				eventDatesRaw: primary.raw || "",
				eventHover: hoverTextFromItems(hoverItems, "event", tz, { permanentCount: permanent.length })
			};
			if (opts && opts.emitArrays) {
				// ── category / tags 批 1（2026-11-08）：把「类型」列写进 `events[]` ────────────────────
				// 值 = `collectGenericEvents` 已经读出的 `it.category`（`categoryIdx` 定位列、`categories`
				// 收值），此前只参与 `pickEventPrimary` 挑外显、**没进数组**。取不到（表里没有「类型」列）⇒ 不写。
				// ⚠️ 本函数被**两个**来源共用：星铁活动一览（默认源，`id:"hsr"`）与绝区零 Bwiki 活动一览
				//    （备选源，`id:"zzz"`）。用 `opts.categoryFacts` 显式开关：
				//      · 批 1 只点名星铁 ⇒ 当时**只给星铁开**；
				//      · 批 2（2026-11-08）给绝区零也开（同一个来源、同一列；多值拆分见 `categoryValuesOf`）。
				//    绝区零的 TAG 列**本批不读**（留给后续决策）——这里只写 `category` + `tags`。
				if (opts.categoryFacts) {
					const facts = {};
					for (const x of listed) {
						if (!x.category) continue;
						// 多值类型：首项 = `category`，其余 = `tags`（`tags` 为空就不写这个键）
						const fact = { category: x.category };
						if (Array.isArray(x.tags) && x.tags.length) fact.tags = x.tags;
						facts[x.name] = fact;
					}
					if (Object.keys(facts).length) out.itemFacts = facts;
				}
				out.events = dataArrayProducedEventsOf(out, hoverItems, { id: opts.id || "generic", tz }, now);
				out.eventHoverItems = hoverItems;
			}
			return out;
		}


		// 通用活动源解析（自定义条目/自定义活动来源地址用）：抓取页面 → collectGenericEvents → {event, eventDates}
		// ⚠️ 2026-10-03：原来这里还有个 `parseGenericEvents(html, tz)`（collectGenericEvents + selectCurrent 的组合），
		//    经全仓引用分析确认**生产与测试都没用**（活路径走的是下面的 `genericEventPayloadFromHtml`，
		//    它多一层"表里一行都没有 → null"的错误语义处理），已删。
		async function tryParseGenericEvent(url, signal, tz) {
			const html = await fetchHtmlText(url, signal);
			return genericEventPayloadFromHtml(html, tz);
		}


		// 已拿到 HTML 时的活动载荷（**不抛错**版本）：
		// 供「两侧同一条 URL、且活动侧没有注册抓取器」（自定义条目）复用卡池那次已经取到的
		// HTML —— 省掉第二次请求，同时保证活动侧也能被通用解析命中。
		// 与 genericEventPayload 的差别：表里一行都没有时返回 null（交给调用方按 nomatch 处理），
		// 而不是抛 "bwiki-event-no-table"（那条错误语义是给"内置源站改版"用的）。
		// ⚠️ P3e（2026-11-07）：**直出 `events` 数组**（三段式与 `genericEventPayload` 同一套）——
		//    P3c 删掉数据层合成器后，这条路径只产三个字符串 ⇒ 自定义地址/自定义条目的**活动侧**
		//    切过去就显示「无数据」。并列条目 = 覆盖当前时刻的活动（与 `genericEventPayload` 同一份
		//    `sortEventItems` 排序），主条仍取自 `selectCurrent` 的字符串字段（值一字不改）。
		// ⚠️ 这里**不传** `permanentCount`：改造前这条路径就不产「以及常驻活动 N 项」那一行，
		//    本批只补数组、不扩事实（永久活动不参与 `coversNow`，本来也不在条目里）。
		function genericEventPayloadFromHtml(html, tz) {
			let items;
			try { items = collectGenericEvents(html, tz); } catch { return null; }
			if (items.length === 0) return null;
			const now = nowMs();
			// 快照要在 `selectCurrent` 之前拍：它会就地把"版本更新后"那类行的起点补全
			const snapshot = items.map((it) => ({
				name: it.banner,
				category: it.category || "",
				startTs: it.startTs,
				endTs: it.endTs,
				raw: it.rawOriginal || it.raw
			}));
			const cur = selectCurrent(items, now);
			if (!cur || !cur.banner) return null;
			const hoverItems = sortEventItems(snapshot.filter((it) => coveredOrOpen(it, now)))
				.map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
			const out = {
				event: cur.banner,
				eventDates: cur.bannerDates || "",
				eventDatesRaw: cur.bannerDatesRaw || cur.bannerDates || ""
			};
			const hover = hoverTextFromItems(hoverItems, "event", tz);
			if (hover) out.eventHover = hover;
			out.events = dataArrayProducedEventsOf(out, hoverItems, { tz }, now);
			out.eventHoverItems = hoverItems;
			return out;
		}


		// ---- 抓取器工厂 ----
		// mkMediaWiki：MediaWiki api.php JSON 源（追加 &origin=* 绕过 CORS）
		// mkRaw：直接抓取原始 HTML（非 MediaWiki 源，如 GachaTracker）
		// 经 host 同源代理的来源（蔚蓝系列 / 终末地 wiki.gg / 1999 等）不用工厂包装：
		// 其抓取器内部自行调用 proxyFetchText / proxyFetchJson（绕过 CORS 与 Referer 反爬）。
		// 抓取器签名：async (url, signal, tz) → 数据对象 | null
		//   第三个参数 `tz` = 源站墙钟时区（可选，见 15-env.js）。工厂把它透传给解析函数，
		//   解析函数再交给 parseTime/parseRange —— 这样"源站时区"只需在来源声明里写一次。
		function mkMediaWiki(parse) {
			return async (url, signal, tz) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
				if (!res.ok) throw new Error("http-" + res.status);
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				return parse(text, tz);
			};
		}

		function mkRaw(parse) {
			return async (url, signal, tz) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
				if (!res.ok) throw new Error("http-" + res.status);
				return parse(await res.text(), tz);
			};
		}


		async function fetchText(url, opts) {
			const o = opts || {};
			if (o.mode === "direct") {
				const res = await transportFetchRaw(url, { signal: o.signal, headers: Object.assign({}, rawHeaders(url), o.headers || {}) });
				if (!res.ok) throw new Error("http-" + res.status);
				return res.text();
			}
			return proxyFetchText(url, o.referer || "", o.headers, o.body);
		}

		async function fetchJson(url, opts) {
			const t = await fetchText(url, opts);
			try { return JSON.parse(t); } catch { throw new Error("bad-json"); }
		}

		async function fetchMediaWikiText(url, opts) {
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const json = await fetchJson(apiUrl, opts);
			const text = json && json.parse && json.parse.text;
			if (typeof text !== "string") throw new Error("bad-json");
			return text;
		}


		// —— 备选源（altSources / eventAltSources）的字段约定与 altSourceId / normalizeSourceId，
		//    以及下面的 gachaFetcherFor / eventFetcherFor 用到的标识归一，都在 60-helpers.js ——
		//    （设置页也要用这两个纯函数，所以放在 core 与外壳共用的 helpers 里，而不是 core 内部）
		// 取条目当前卡池源的抓取器：命中的备选源 > 默认抓取器（无 → null）
		function gachaFetcherFor(source, url) {
			const want = normalizeSourceId(url);
			const alt = (source.altSources || []).find((a) => altSourceId(a) === want && GACHA_FETCHERS[a.fetcher]);
			return alt ? GACHA_FETCHERS[alt.fetcher] : GACHA_FETCHERS[source.id] || null;
		}


		// ── 来源条目上的「起点未知 = 已开始」开关（2026-11-09 晚，用户选 B）───────────────
		// 语义：`altSources` / `eventAltSources` 的某一条写了 `unknownStartIsActive: true` ⇒
		// **仅当当前生效来源是这一条时**，`startTs == null` 的条目按"已开始"处理（恢复旧语义）。
		// 谁读它：那一条**自己的抓取器**（见 30-game-hoyoverse.js 的 `zzz-bwiki`），再经
		// `selectCurrent(items, now, { unknownStartIsActive })` 作用到选当期。
		//
		// 为什么"按抓取器键反查"就等价于"当前生效来源是这一条"：
		//   · 备选源的抓取器键在注册表里**唯一**（同一条目下不会两样，见 test/all.mjs 的登记守卫）；
		//   · `gachaFetcherFor` / `eventFetcherFor` 只有在设置里选中该备选源时（`customUrls` /
		//     `customEventUrls` = 该条的 `url`／`id`，即 `altSourceId` 命中）才会把它的抓取器交出去；
		//   · 所以"这个抓取器正在跑"本身就等于"当前生效来源 = 这一条"。默认源（官方公告）走的是
		//     `GACHA_FETCHERS[source.id]`，永远不经过这里。
		//
		// ⚠️ 刻意**不做成全局配置项**：它不进 DEFAULT_SETTINGS / CONFIG_KEYS，也不能由用户在设置页
		//    打开 —— 一旦全局放开，星铁 bwiki 那类"收录未来池"的来源就会重现"未来池假在期"。
		function unknownStartIsActiveOf(fetcherKey) {
			if (!fetcherKey) return false;
			for (const s of SOURCES) {
				const list = [].concat(s.altSources || [], s.eventAltSources || []);
				for (const a of list) {
					if (a && a.fetcher === fetcherKey && a.unknownStartIsActive === true) return true;
				}
			}
			return false;
		}


		// 取条目当前活动源的抓取器：命中的活动备选源 > 默认活动抓取器（无 → null）
		//
		// ⚠️ P3e（2026-11-07）：备选源有**两种登记形状** —— 一种直接是函数
		//    （`"arknights-event-list": (url, signal, tz) => …`），另一种是 `{ default: fn }`
		//    （历史批次，如 `"genshin-miyoushe": { default: fn }`）。而 `EVENT_FETCHERS[id].default`
		//    这一层的值恒为函数。这里必须**统一解包**：直接 `return table[a.fetcher]` 会把
		//    `{ default: fn }` 整个对象交给 `fetchEntry` → `await fetcher(...)` 抛
		//    「fetcher is not a function」→ 用户把活动来源切到那 8 个备选源时只看到「抓取失败」。
		//    （实测受影响：genshin/hsr/zzz/bh3 的米游社、bandori/ournotes-global 官网、
		//      uma-jp-bwiki、stellasora-bwiki。）
		function eventFetcherOf(v) {
			if (typeof v === "function") return v;
			if (v && typeof v === "object" && typeof v.default === "function") return v.default;
			return null;
		}
		function eventFetcherFor(source, url) {
			const table = EVENT_FETCHERS[source.id];
			if (!table) return null;
			const want = normalizeSourceId(url);
			const alt = (source.eventAltSources || []).find((a) => altSourceId(a) === want && eventFetcherOf(table[a.fetcher]));
			return alt ? eventFetcherOf(table[alt.fetcher]) : eventFetcherOf(table.default);
		}
