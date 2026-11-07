		// ══ 实验特性：新「二游日历」面板视图（`settings.newPanel === true` 时才渲染）══
		// 设计稿（**唯一真源**）：dsh-gacha-ui-lab/a-v6.html（效果图 a-v6.png）
		//
		// 结构自上而下，与设计稿一一对应（类名统一 `gacha-cal-sched-*`，样式见 styles/schedule.css 与 styles/schedule-foot.css）：
		//   ① 日期胶囊（2026-10-17 起面板**内**不再写标题「二游日历」那四个字；**没有**总计数胶囊。
		//      侧栏那个入口按钮的「二游日历」是插件入口，照旧保留 —— 两处别混）
		//   ② 一行总览（K 版）：24 小时内 N 条 · 7 天内 M 条（为 0 的段不显示；都为 0 只留一句短兜底）
		//   ③ 「近期」：跨游戏、按紧迫度、**全列出**（不折叠、不点开），占左约 64%，右侧一个虚线空框
		//   ④ 游戏表（**没有区块标题**，列表头直接跟在后面）：游戏 190px / 卡池 / 活动，
		//      顺序 = 用户在设置里拖的排列（`applyOrder` 已经排好，这里**不按紧迫度重排**）
		//   ⑤ 图例（颜色=游戏 / 图案=状态） ⑥ 失败横条 + 重试 ⑦ 底部「上次更新 X 分钟前」+ 刷新
		//
		// 三条**互不抢**的视觉分工（改这个组件前先读这一条）：
		//   · **颜色 = 游戏**：每行内联一个 `--g`（`g.color`；自定义条目没有 color → 游戏名哈希取固定色盘）
		//     同一款游戏的**卡池 = 深色、活动 = 浅色**（浅色由 `color-mix` 与白混出，见 styles/schedule.css）
		//   · **图案 = 状态**：实心=在期 / 斜纹=已结束 / 点线=长期 / 空心描边=还没开始 / 灰底=该来源无数据
		//   · **文字 = 紧迫度**：今天到期 / 还剩 X 天 X 时 / MM-DD HH:MM 开始 —— 迷你条**不再**用颜色表紧迫度
		//
		// 本区**只读** CalendarPanel 已经算好的 games / s，不碰抓取、解析、刷新与缓存。
		const SCHEDULE_DAYS = 14;                 // 迷你条与表头刻度共用的天数（所有行同一根轴）
		const SCHEDULE_TODAY_INDEX = 2;           // 今天在这一轴上的格号（0 基）→ 今天恒为第 3 格
		const SCHEDULE_LONG_MS = 366 * 864e5;     // 窗口超过一年 = 长期档期（pjsk 那种 2099 哨兵）
		const SCHEDULE_DUE_MS = 864e5;            // 24 小时内到期 = "今天到期"
		const SCHEDULE_AMBER_MS = 7 * 864e5;      // 一周内 = 一段琥珀文字（本周留意）
		const SCHEDULE_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
		// 没有 color 的条目（自定义条目）→ 按**游戏名哈希**落到这组固定色盘：同一款永远同色。
		const SCHEDULE_PALETTE = ["#E0709F", "#3FA9A0", "#E0A93B", "#4A6CF7", "#7A5AF8", "#2FB3C9", "#E06C4A", "#5C9E3F"];

		// 这一款游戏的代表色：条目自带 color（由 SOURCES 下发）优先，否则按名字哈希（同名恒同色）。
		function scheduleGameColor(g, overrides) {
			// 用户覆盖优先（设置页每游戏取色器写入 gameColors[id]）
			const id = g && g.id ? String(g.id) : "";
			const ov = overrides && id && typeof overrides[id] === "string" ? String(overrides[id]).trim() : "";
			if (/^#[0-9a-f]{6}$/i.test(ov)) return ov;
			const own = g && typeof g.color === "string" ? g.color.trim() : "";
			if (own) return own;
			const name = String((g && g.name) || "");
			let h = 0;
			for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
			return SCHEDULE_PALETTE[h % SCHEDULE_PALETTE.length];
		}

		// ── 档期文本的两套口径（用户 2026-10-21 定）────────────────────────────────
		//   · **外显**（面板上看得见的时间文本）= 按**用户本机时区**换算后的时间 ——
		//     玩家要回答的是"我这边几点能抽"，所以换算成手机/电脑的钟点。
		//   · **悬停**（tooltip / 探头展开行）= **源站墙钟原文** —— 对着游戏内公告核对用，
		//     解析器输出的 bannerDates / eventDates 就是这串原文，渲染层的 title 一律不动。
		//
		// ⚠️ 为什么不直接吃 `startTs/endTs`：落盘数据里没有它们 —— `50-refresh.js` 的
		//    GACHA_FIELDS / EVENT_FIELDS 只留文本与悬停（事件侧本来也没有 eventStartTs/eventEndTs）。
		//    但每条来源都带源站 `tz`（`60-helpers.js` 的 getAllEntries 白名单里透传），
		//    而源站文本就是"源站墙钟" ⇒ 「文本 + tz」足以还原绝对时刻，再按本机时区渲染。

		// 绝对档期 → 本机时区文本（不传 tz = 运行环境本机时区）。拿不到绝对档期 → null。
		function localWin(startTs, endTs) {
			if (typeof startTs === "number" && typeof endTs === "number") return fmtWindow(startTs, endTs);
			return null;
		}

		// 源站墙钟文本 + 源站 tz → 本机时区文本。
		// 返回 null = 换算不了（调用方回落原文，**绝不**显示一个错的钟点）：
		//   · 文本不是「MM-DD HH:MM ~ MM-DD HH:MM」形态（跨年带年份 / "版本更新后 ~ …" / "长期"）
		//   · 条目没声明 tz（自定义条目；`sourceOffsetMinutes` 也不认识的时区名）
		function localWinText(text, tz, now) {
			if (!tz) return null;
			const r = parseDisplayRange(text, now);
			if (!r) return null;
			// 把"被当成本机墙钟"解释出来的 ts 还原成绝对时刻：真值 = ts + (本机偏移 − 源站偏移)。
			// 两端各算一次（跨 DST 的窗口不会因为只取起点偏移而差一小时）。
			const shiftOf = (ts) => {
				const offSrc = sourceOffsetMinutes(tz, ts);
				if (offSrc == null) return null;
				return (-new Date(ts).getTimezoneOffset() - offSrc) * 60000;
			};
			const sa = shiftOf(r.startTs), sb = shiftOf(r.endTs);
			if (sa == null || sb == null) return null;
			if (sa === 0 && sb === 0) return text;   // 源站时区 == 本机 → 原文即换算结果（保持原样，不重排）
			return fmtWindow(r.startTs + sa, r.endTs + sb);
		}

		// 某条目某一侧的外显档期文本：绝对档期 → 「源站文本 + tz」→ null（调用方回落原文）。
		// 卡池侧若数据里直出了 startTs/endTs（fetch 层契约里有）就优先用它们；
		// 活动侧没有对应字段（不拿卡池的 startTs 冒充），一律走文本 + tz。
		function localDatesOf(g, isG, now) {
			if (!g) return null;
			const hit = isG ? localWin(g.startTs, g.endTs) : null;
			if (hit) return hit;
			const text = (isG ? g.bannerDates : g.eventDates) || "";
			return localWinText(text, g.tz || null, now);
		}

		// ── 把落盘的文本档期还原成绝对窗口 ──────────────────────────────
		// 走面板外显同一条换算链（localDatesOf → parseDisplayRange），红点与面板的"还剩 X"才同源。
		// 读不出绝对档期（源站只写"长期"、自定义条目没填 tz）→ null，不硬凑一个猜测的时刻。
		function dueWindowOf(g, isG, now) {
			if (!g) return null;
			const text = localDatesOf(g, isG, now);
			if (!text) return null;
			const r = parseDisplayRange(text, now);
			return r || null;
		}

		// 该轮播的档期清单：输入是 CalendarPanel 算好的 `games`（只含用户看得见的行）。
		// 方向判定走 60-helpers.js 的 dueKindOf；本函数只把落盘档期换成绝对窗口（dueWindowOf），
		// 再组装候选交给 tickerPickOf 筛选排序。每条带自己的 gameIcon，整行连图标一起翻。
		// 轮播不分游戏（逐游戏「提醒」属于到期送达），只按 tickerOn + tickerHours 筛。
		function tickerItemsOf(games, now, tickerHours) {
			const hours = Number(tickerHours);
			if (!(hours > 0) || !Array.isArray(games) || !now) return [];
			const out = [];
			for (const g of games) {
				if (!g) continue;
				for (const side of ["gacha", "event"]) {
					const isG = side === "gacha";
					const title = (isG ? g.banner : g.event) || "";
					if (!title) continue;
					const w = dueWindowOf(g, isG, now);
					if (!w) continue;
					const roles = isG ? (g.roles || "") : "";
					out.push({
						key: g.id + ":" + side,
						id: g.id,
						// 筛选键独立于 `id` 字段名，免得 tickerPickOf 的调用方还要知道 id 是哪一层
						gameId: g.id,
						side,
						name: g.name || g.id,
						title: (isG && roles) ? (cleanRoleNames(roles, g.id) || title) : title,
						// 该游戏自己的图标（外链，可能为空 ⇒ 渲染层退化成"游戏名首字"小方块）
						gameIcon: g.icon || "",
						startTs: w.startTs,
						endTs: w.endTs
					});
				}
			}
			return tickerPickOf(out, now.getTime(), hours);
		}

		// 一条档期 = 某款游戏的卡池侧或活动侧。读不出绝对档期的（源站原文）按"长期"处理，
		// **不**硬凑一个天数——这也是设计稿里"点线 + 长期"两字的来由。
		function scheduleNormalize(g, side, now) {
			const isG = side === "gacha";
			const title = (isG ? g.banner : g.event) || "";
			// 源站墙钟原文（悬停用）与换算后的外显文本（本机时区）分开存：
			//   rawSrc = 源站原文；raw = 外显（换算不了就回落 rawSrc）
			const rawSrc = (isG ? g.bannerDates : g.eventDates) || "";
			const raw = localDatesOf(g, isG, now) || rawSrc;
			if (!title && !raw) return null;                       // 这一侧没有数据，不出条目
			const fail = (isG ? g.gachaFail : g.eventFail) || null;
			const r = parseDisplayRange(raw, now);
			let state = "long", startTs = 0, endTs = 0;
			if (r) {
				startTs = r.startTs;
				endTs = r.endTs;
				const span = Math.max(1, endTs - startTs);
				if (span > SCHEDULE_LONG_MS) state = "long";
				else if (now.getTime() < startTs) state = "wait";
				else if (now.getTime() > endTs) state = "ended";
				else state = "live";
			}
			const remain = state === "live" ? Math.max(0, endTs - now.getTime()) : 0;
			// 外显文本：卡池侧优先显示**去修饰的角色名**（旧面板一直这么显示），没有角色名就退回卡池标题。
			// 活动侧优先用**只给显示**的 `eventShow`（明日方舟兑换期 ⇒「<去重后的活动名> 兑换截止」），
			// 没有这个键就退回活动名 —— `title`/`event` 仍是源站原文（提醒标题、侧栏轮播、搜索读的是它）。
			const roles = isG ? (g.roles || "") : "";
			const show = (isG && roles) ? (cleanRoleNames(roles, g.id) || title) : (isG ? title : (g.eventShow || title));
			// 悬停文本：**原始文本** = 标题 + 源站原文（优先 Raw），与旧面板 gachaTitle/eventTitle 的写法一致
			const datesRaw = (isG ? g.bannerDatesRaw : g.eventDatesRaw) || rawSrc;
			const orig = title + (datesRaw ? "\n" + datesRaw : "");
			return { key: g.id + ":" + side, g, side, isG, title, show, orig, raw, rawSrc, fail, state, startTs, endTs, remain };
		}

		// ── 同格并列条目：从悬停文本解析出来 ─────────────────────────────────────────
		// `scheduleHoverItems`（悬停多行文本 → [{ title, win }]）+ 它用到的两条区间正则 /
		// `scheduleNoYear` 已搬到 **26-parser-hover.js**（2026-11-07，P1 数据层数组）：
		// 数据层（50-refresh.js）也要按同一份判据展开并列池，而 50-refresh.js 在 core 产物里，
		// 本文件（81）只属于渲染层。搬动是逐字搬迁，行为不变。
		// 下面 `scheduleHoverOnes` 仍是**显示层**的"补成与 scheduleNormalize 同形"那一步。
		// 把 { title, win } 补成与 scheduleNormalize **同形**的条目（渲染层只认这一种形状）
		function scheduleHoverOnes(items, it, now) {
			const out = [];
			for (const x of items) {
				if (x.title === it.title) continue;                  // 外显那条已经有了，不重复列
				// 活动侧兑换期：悬停里那一行的名字是「<活动名> 兑换截止」= 面板显示的事项名（`show`），
				// 它和 `title`（活动名）不同串，但**就是外显那一条**（2026-11-07 起兑换期主行改带
				// 「兑换截止」）⇒ 也要跳过，否则格子里会多出一条一模一样的并列条目。
				if (it.show && x.title === it.show) continue;
				// ⚠️ 外显那条（引擎 roles → 通常只有角色名，如「克莱门莎」）与这里的「池名：角色」
				//    （如「海渊巡游：克莱门莎」）常常是同一口池 ⇒ 按用户口径"只显示角色名那条"，
				//    外显已经占了角色名，这里就不再把同一口池列一遍（用户 2026-10-16）。
				//    ⚠️ 必须在**这一层**做：scheduleHoverItems 只看得到悬停解析出的条目，
				//    看不到 it（外显那条）⇒ 上一版规则所以在真机上完全不起作用。
				const normOne = (s) => String(s || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
				const shownText = normOne(it.show || it.title || "");
				const titleText = normOne(x.title);
				if (shownText && titleText && titleText !== shownText) {
					const tailAt = titleText.lastIndexOf("\uFF1A" + shownText);
					if (titleText.indexOf(shownText + "\uFF1A") === 0 || (tailAt >= 0 && tailAt === titleText.length - shownText.length - 1)) continue;
				}
				const r = parseDisplayRange(scheduleNoYear(x.win), now);
				if (!r) continue;                                    // 读不出绝对档期 → 不硬凑天数
				const span = Math.max(1, r.endTs - r.startTs);
				let state = "long", remain = 0;
				if (span > SCHEDULE_LONG_MS) state = "long";
				else if (now.getTime() < r.startTs) state = "wait";
				else if (now.getTime() > r.endTs) state = "ended";
				else { state = "live"; remain = Math.max(0, r.endTs - now.getTime()); }
				out.push({ key: it.key, g: it.g, side: it.side, isG: it.isG, title: x.title, raw: x.win, fail: null, state, startTs: r.startTs, endTs: r.endTs, remain });
			}
			return out;
		}

		// ── 派生层：从「事实数组」里挑出这一格今天要露的那一条（P2，2026-11-07）──────────
		// 数据层（50-refresh.js，P1）只放事实：`gacha` / `events` 按结束时间升序、**不挑选**。
		// 「谁排第一」是**纯展示决策**，所以放在这里；表格那一行与探头读的是**同一份数组**
		// （探头只是一个会动的 UI 组件，零数据语义）。
		//
		// 返回 `{ primary, rest }`：
		//   · `primary` = 这一格外显的那条（数组空 ⇒ null）
		//   · `rest`    = 数组里其余条目，**保持数组原顺序**（那是数据层的自然顺序；
		//                 探头内部怎么排是渲染层的事，见 82 的 schedulePickItem）
		//
		// 两侧的**通用**规则都是"今天外显规则的原样搬运"，不新发明口径：
		//   · event：25-parser-order.js 的 `pickEventPrimary`（各解析器挑外显时调的就是它）
		//     —— 奖励领取期（`phase.kind === "claim"`）优先 → 类别档位（`cat`/`tags` 能读到就用，
		//     读不到才按活动名匹配 EVENT_TIER1_RE）→ 结束时间升序 → 开始时间升序。
		//   · gacha：24-parser-window.js 的 `selectCurrent`（卡池外显的本体；各内置解析器内部的
		//     `selectGacha*` / `pickMergedGachaWindow` 都注明"与 selectCurrent 同口径"）：
		//       ① 只在**在期**的池里挑：`endTs >= now` 且（起点缺失 ⇒ 源站写「X.Y 版本更新后」，
		//          视为已开始；或 `startTs <= now`）。这条与 selectCurrent 的 `inWindow` 等价
		//          —— 它多认一个"起点被 fillMissingStarts 补过、补出来的值 > now"的分支，
		//          那种池的真实起点是"版本更新后"（已上线），数组里同样表现为 startTs <= now 或缺失。
		//       ② 在期的里取**结束最早**的那条（越快结束越该被盯住）。
		//       ③ 并列按起点升序（selectCurrent 用稳定排序 + endTs 单键；数组已按
		//          endTs → startTs 排好 ⇒ 等价于"数组里第一条在期的"）。
		//       ④ 一条都不在期（沿用旧值 / 已结束）⇒ 取数组首条 = 结束最早的那条。
		//          老实现的外显那条本来就是结束最早的那条，不凭 now 另造一条。
		//
		// ⚠️ 但**通用规则**只对大多数来源成立。下面几款的老实现各有一套排序键（赛马娘按
		//    "覆盖 now + startTs 最新"、FGO 按源站类型列、战双按自己的类别词表……），
		//    要"零可见变化"就必须逐字对齐它们 ⇒ 见 `schedulePickOf` 的分派表。
		function sideViewOf(items, now, side, gameId) {
			const list = Array.isArray(items) ? items : [];
			const at = now && typeof now.getTime === "function" ? now.getTime() : Number(now) || 0;
			const startOf = (x) => (x.startTs == null ? Infinity : x.startTs);
			if (!list.length) return { primary: null, rest: [] };
			let primary = null;
			const specialized = schedulePickOf(gameId, side);
			if (specialized) {
				primary = specialized(list, at);
			} else if (side === "event") {
				// `pickEventPrimary` 吃的条目来自解析器：`name` / `cat` / `tags` / `startTs` / `endTs` / `phase`。
				// 数据层数组把名称叫 `title`（见 50-refresh.js 的字段表）⇒ 这里做一层**只读适配**再调用它：
				// 规则本体一个字不改，只是把它认的字段喂进去（否则 eventTier 读不到名字，档位永远退化成第二档）。
				// ⚠️ `phase` 也要适配：解析器给的是字符串 `"claim"`（25-parser-order.js 的判据），
				//    数组里存的是对象 `{ kind: "claim", startTs, endTs, show }`（50-refresh.js 的 phase 形状）
				//    ⇒ 这里取 `kind`，两种形状在 pickEventPrimary 眼里才是同一件事。
				// 适配对象带 `item` 指回原条目，选中后再取回数组里那一条（不复制、不污染输入）。
				const adapted = list.map((x) => ({
					item: x,
					name: x.title || "",
					cat: x.cat,
					tags: x.tags,
					startTs: x.startTs,
					endTs: x.endTs,
					phase: x.phase && typeof x.phase === "object" ? x.phase.kind : x.phase
				}));
				const picked = pickEventPrimary(adapted);
				primary = picked ? picked.item : null;
			} else {
				const live = list.filter((x) => x && x.endTs != null && x.endTs >= at && (x.startTs == null || x.startTs <= at));
				primary = live.length
					? live.reduce((a, b) => (b.endTs < a.endTs || (b.endTs === a.endTs && startOf(b) < startOf(a)) ? b : a))
					: list[0];
			}
			if (!primary) return { primary: null, rest: list.slice() };
			return { primary, rest: list.filter((x) => x !== primary) };
		}

		// ── 按游戏分派的挑选规则表（P2 收尾，2026-11-07）─────────────────────────────
		// **规则仍属显示层**：数据层只放事实（`startTs`/`endTs`/`cat`/`source`/`preview`…），
		// "哪一条是外显"由这里决定。每条都注明它对齐的是哪个老实现（文件:行），以及为什么
		// 通用规则复现不了它 —— 反过来也说明：把某条特化规则换回通用规则，对应那一侧必然变红
		// （`test/cases-core.mjs` ⑤-5 的"反向证明"就钉这一点）。
		//
		// 时间比较一律走下面的小工具（null 排序规则与数据层 dataArraySortOf 同一口径）：
		//   无 endTs ⇒ 视为"最晚"（排最后）；无 startTs ⇒ 视为"最早"（负无穷）。
		const SCHEDULE_TS_MAX = (x, k) => (x && x[k] != null ? x[k] : Infinity);
		const SCHEDULE_TS_MIN = (x, k) => (x && x[k] != null ? x[k] : -Infinity);
		function scheduleEndAsc(a, b) {
			const ea = SCHEDULE_TS_MAX(a, "endTs"), eb = SCHEDULE_TS_MAX(b, "endTs");
			return ea === eb ? 0 : ea - eb;
		}
		function scheduleStartAsc(a, b) {
			const sa = SCHEDULE_TS_MAX(a, "startTs"), sb = SCHEDULE_TS_MAX(b, "startTs");
			return sa === sb ? 0 : sa - sb;
		}
		function scheduleStartDesc(a, b) {
			const sa = SCHEDULE_TS_MIN(a, "startTs"), sb = SCHEDULE_TS_MIN(b, "startTs");
			return sa === sb ? 0 : sb - sa;
		}
		// 覆盖 now 的那几条（与 24-parser-window.js 的 coversNow 同判据：终点必须有且未过，起点可缺）
		function scheduleCoveringOf(list, at) {
			const pool = list.filter((x) => coversNow(x, at));
			return pool.length ? pool : null;
		}
		// 引擎给的外显那条（数据层的 `source:"primary"`）。取不到（P1 之前的老缓存）⇒ null，
		// 调用方退回到时间规则 —— **不猜**谁是主行。
		function schedulePrimaryOf(list) {
			for (const x of list) if (x && x.source === "primary") return x;
			return null;
		}
		// 预告稿标记：优先读数据层的事实（`preview`），老缓存没有这个键时退回同一判据的文本匹配
		// （= `ns_umamusume_official_umaCurrentWindows` 的 previewRank，30-game-cygames.js:392）。
		const SCHEDULE_PREVIEW_RE = /予告|coming soon/i;
		function scheduleIsPreview(x) {
			if (x && typeof x.preview === "boolean") return x.preview;
			return SCHEDULE_PREVIEW_RE.test(String((x && x.title) || ""));
		}
		// 赛马娘（日服 / 国际服 / 无后缀 id）：对齐 `ns_umamusume_official_umaCurrentWindows`
		// （30-game-cygames.js:388-399，`pickUmaWindow` = 它取第 0 项，:405-407）：
		//   覆盖 now 优先 → ① `startTs` **最新** → ② 并列时**预告稿排后**（同一档期常有
		//   `【予告】…開催決定！` 与正式 `…開催！` 两篇，否则外显会显示预告稿）→ ③ endTs 更早
		//   → ④ 公告 id（数组里没有这个事实 ⇒ 稳定排序保留数组顺序）。
		// 通用规则（在期里结束最早）**复现不了**它：日服 10-02 那侧外显是 11-02 结束的预告稿，
		// 而"结束最早"会选 10-13 结束的那条（④ uma-jp/gacha 的已知差异就是这么来的）。
		function schedulePickUmaCurrent(list, at) {
			const pool = scheduleCoveringOf(list, at);
			if (!pool) return schedulePrimaryOf(list) || list[0] || null;
			return pool.slice().sort((a, b) =>
				scheduleStartDesc(a, b)
				|| ((scheduleIsPreview(a) ? 1 : 0) - (scheduleIsPreview(b) ? 1 : 0))
				|| scheduleEndAsc(a, b)
			)[0] || null;
		}
		// 闪耀优俊少女国服：是对齐 `ns_biligame_activity_eventsUmaCnOfficial` /
		// `ns_biligame_activity_gachaUmaCnOfficial`（30-game-biligame.js:976 / :956）的**外显那一行**：
		// 这两个抓取器的 `event` / `banner` = `cleanTitle(公告标题)`，而悬停里那几行是**公告正文里的
		// 「活动期间 / 第1轮 / 联赛报名期间」标签**（`pickUmaWindow` 只负责挑出给档期的那一段）。
		// ⇒ 两者不是同一维度的候选：能复现老外显的只有"引擎主行"这个事实（`source:"primary"`）。
		// 取不到主行（老缓存）⇒ 退回赛马娘的时间规则。
		function schedulePickUmaCn(list, at) {
			return schedulePrimaryOf(list) || schedulePickUmaCurrent(list, at);
		}
		// 物华弥新：对齐 `ns_biligame_activity_pickWhmxEvent`（30-game-biligame.js:836-846）。
		// 同一个理由：外显 = `cleanTitle(公告标题)`（主行），悬停里那几行是公告正文的小节
		// （「旅程将启-寂夜长生」「职员考评-演算」…）。`pickWhmxEvent` 的 rank（小节名 vs 标题引号名）
		// 在数组里没有对应字段 ⇒ 主行优先是唯一能逐字复现的判据；
		// 兜底（老缓存没有 `source` 时）按用户定的口径：endTs 升序 → **同 endTs 取 startTs 更晚**那条。
		function schedulePickWhmx(list, at) {
			const p = schedulePrimaryOf(list);
			if (p) return p;
			const pool = scheduleCoveringOf(list, at) || list;
			return pool.slice().sort((a, b) => scheduleEndAsc(a, b) || scheduleStartDesc(a, b))[0] || null;
		}
		// 战双帕弥什（event）：对齐 `ns_bwiki_wikitext_zspmsEventCmp`
		// （30-game-bwiki-zspms-wikitext.js:242-246）：类别档位 → endTs 升序 → startTs 升序 → 文档顺序。
		// 档位词表**是该来源自己的**（含「演算」），通用 `EVENT_TIER1_RE` 没有这个词 ⇒ 09-25 那侧
		// 通用规则会选「主线剧情-远信回响」，老实现选「回路演算」（两者都是第一档，再按 endTs 决出）。
		// 数组条目没有结构化类别，只能按活动名判档 —— 解析器自己也是按名字判档（同一份词表）。
		const SCHEDULE_ZSPMS_TIER1_RE = /剧情|主线|故事|叙事|挑战|BOSS|Boss|试玩|玩法|关卡|演算|行动|作战|防卫|巡防|赛季|联合/;
		function scheduleZspmsTier(x) {
			return SCHEDULE_ZSPMS_TIER1_RE.test(String((x && x.title) || "")) ? 1 : 2;
		}
		function schedulePickZspmsEvent(list, at) {
			const pool = scheduleCoveringOf(list, at) || list;
			return pool.slice().sort((a, b) =>
				(scheduleZspmsTier(a) - scheduleZspmsTier(b))
				|| scheduleEndAsc(a, b)
				|| scheduleStartAsc(a, b)
			)[0] || null;
		}
		// FGO（event）：对齐 `ns_fgo_pickRow`（30-game-aniplex.js:139-150）：
		//   覆盖 now 优先 → 类型档位（源站第 4 列 `Event` 压过 `Campaign`）→ endTs 升序 → startTs 升序。
		// 档位来自**源站类型列**，不是活动名：`Event` 这个词不在 EVENT_TIER1_RE 里，按名字判档会把
		// 09-05 的「失落的创世（Event）」判成第二档，从而选中「3200万下载突破纪念活动（Campaign）」。
		// 类型由解析器通过 `itemFacts` 带进数组条目的 `cat`（见 30-game-aniplex.js 的 itemFacts 注释）；
		// 老缓存没有 cat ⇒ 全落第二档（退化成"结束最早"，与通用规则一致，不凭空猜类别）。
		function scheduleFgoTier(x) {
			return /^Event/i.test(String((x && x.cat) || "")) ? 0 : 1;
		}
		function schedulePickFgoEvent(list, at) {
			const pool = scheduleCoveringOf(list, at) || list;
			return pool.slice().sort((a, b) =>
				(scheduleFgoTier(a) - scheduleFgoTier(b))
				|| scheduleEndAsc(a, b)
				|| scheduleStartAsc(a, b)
			)[0] || null;
		}
		// 分派表：游戏 id → 规则；`side` 限定只在某一侧生效（其余侧仍走通用规则）。
		const SCHEDULE_SIDE_RULES = {
			// 赛马娘三服共用 cygames 的 umaCurrentWindows（uma 是无后缀的历史 id，一并留着）
			uma: schedulePickUmaCurrent,
			"uma-jp": schedulePickUmaCurrent,
			"uma-global": schedulePickUmaCurrent,
			// 国服外显 = 公告标题（另一套抓取器），见 schedulePickUmaCn
			"uma-cn": schedulePickUmaCn,
			wuhuamixin: schedulePickWhmx,
			// 只有活动侧有档位规则（卡池侧的通用规则已与老实现一致）
			"zspms:event": schedulePickZspmsEvent,
			"fgo:event": schedulePickFgoEvent
		};
		function schedulePickOf(gameId, side) {
			const id = String(gameId || "");
			if (!id) return null;
			return SCHEDULE_SIDE_RULES[id] || SCHEDULE_SIDE_RULES[id + ":" + side] || null;
		}

		// 数组条目 → 与 `scheduleNormalize` **同形**的渲染条目（表格那一行 / 探头的一行）。
		// ⚠️ 记录自己那条外显（`item.title` == 记录的 banner/event）**直接走 scheduleNormalize**：
		//    卡池侧的档期文本优先用记录里的绝对 `startTs/endTs`、活动侧走「源站原文 + tz」换算，
		//    而数组里没有这两样（P1 只存 `raw` 与本机时刻）—— 从数组重算会在 TZ≠+08 的机器上
		//    差一个时区（README_Dev「P1 已知不等价①」）。P3 让解析器直出 display 文本后这段可删。
		// 并列条目：与今天 `scheduleHoverOnes` 产出的条目同形（`state/startTs/endTs` 都来自
		//    同一段悬停文本的解析），所以渲染结果逐字一致。
		function scheduleItemOf(g, side, item, now) {
			if (!g || !item) return null;
			const isG = side === "gacha";
			const title = item.title || "";
			const rawSrc = item.raw || "";
			const recTitle = (isG ? g.banner : g.event) || "";
			if (title && title === recTitle) return scheduleNormalize(g, side, now);
			// 读不出绝对档期（源站只写「长期」/「版本更新后 ~ …」且悬停里也是原文）⇒ 不硬凑。
			// 与今天 `scheduleHoverOnes` 的 `if (!r) continue` 同一行为：这类条目**没有可算的状态**，
			// 探头里不列（数据层仍留着这条事实）。
			if (item.startTs == null && item.endTs == null) return null;
			const startTs = item.startTs == null ? 0 : item.startTs;
			const endTs = item.endTs == null ? 0 : item.endTs;
			const span = Math.max(1, endTs - startTs);
			let state = "long", remain = 0;
			if (span > SCHEDULE_LONG_MS) state = "long";
			else if (now.getTime() < startTs) state = "wait";
			else if (now.getTime() > endTs) state = "ended";
			else { state = "live"; remain = Math.max(0, endTs - now.getTime()); }
			return {
				key: item.key || (g.id + ":" + side), g, side, isG,
				title, show: item.show || title, orig: title + (rawSrc ? "\n" + rawSrc : ""),
				raw: rawSrc, rawSrc, fail: null, state, startTs, endTs, remain
			};
		}

		// 一格（游戏 × 卡池/活动）在面板上的全部条目：`{ primary, rest, fromArray }`；null = 这一侧没有数据。
		//   · 有数据层数组（P2 主路径）⇒ `sideViewOf` 挑外显 + `scheduleItemOf` 转成渲染条目，`fromArray = true`；
		//   · 数组不可用 ⇒ **兼容分支（P3 可删）**：今天的老路（记录字符串 + 解析悬停文本），`fromArray = false`。
		//     什么时候会走到：① 老 lastData（P1 之前的缓存，归一后是空数组）；② 这一侧本来就没数据
		//     （`gacha` / `events` 是空数组，老路同样会返回 null ⇒ 格子里写「该来源无数据」）；
		//     ③ 极端情况：数组非空但派生不出主条（条目全都读不出窗口）—— 这时也按老路渲染，不让格子空白。
		function scheduleCellOf(g, side, now) {
			if (!g) return null;
			const isG = side === "gacha";
			const items = isG ? g.gacha : g.events;
			const sideItems = Array.isArray(items) && items.length ? items : null;
			if (sideItems) {
				const derived = sideViewOf(sideItems, now, side, g.id);
				const primary = scheduleItemOf(g, side, derived.primary, now);
				if (primary) {
					const rest = [];
					for (const x of derived.rest) {
						const v = scheduleItemOf(g, side, x, now);
						if (v) rest.push(v);      // 读不出绝对档期的并列条目：与今天 scheduleHoverOnes 一样不列
					}
					return { primary, rest, fromArray: true };
				}
			}
			// ── 兼容分支（**P3 可删**）───────────────────────────────────────────────
			// 与 P2 之前逐字相同：scheduleNormalize 出外显那条，悬停文本逆解析补并列条目。
			const it = scheduleNormalize(g, side, now);
			if (!it) return null;
			const extras = scheduleHoverOnes(
				scheduleHoverItems(isG ? g.bannerHover : g.eventHover, it.title, it.isG), it, now);
			return { primary: it, rest: extras, fromArray: false };
		}


		// 倒计时只给"数字 + 单位"，标签（还剩 / 之后开始）由渲染层写 —— 同一个位置不会一会儿"还剩"
		// 一会儿"距开始"。
		function scheduleCountdown(ms) {
			if (!(ms > 0)) return [["0", "分"]];
			const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), mi = Math.floor((ms % 36e5) / 6e4);
			if (d > 0) return [[String(d), "天"], [String(h), "时"]];
			if (h > 0) return [[String(h), "时"], [String(mi), "分"]];
			return [[String(mi), "分"]];
		}

		// 迷你条的 14 天轴：从"今天前 2 天"起 → 今天恒为第 3 格，与刻度、竖线天然对齐。
		function scheduleDays(now) {
			const out = [];
			for (let i = 0; i < SCHEDULE_DAYS; i++) {
				out.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - SCHEDULE_TODAY_INDEX + i));
			}
			return out;
		}

		const schedule2 = (n) => (n < 10 ? "0" + n : String(n));
		function scheduleMD(ts) { const d = new Date(ts); return schedule2(d.getMonth() + 1) + "-" + schedule2(d.getDate()); }
		function scheduleHHMM(ts) { const d = new Date(ts); return schedule2(d.getHours()) + ":" + schedule2(d.getMinutes()); }
		// 源站常常只给日期：没有具体时刻就不写时刻（写 00:00 是假精度）
		function scheduleMDHM(ts) { const d = new Date(ts); return scheduleMD(ts) + (d.getHours() || d.getMinutes() ? " " + scheduleHHMM(ts) : ""); }
		function scheduleSameDay(ts, now) {
			const d = new Date(ts);
			return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
		}

		// 「时间结论」只用**文字**表达紧迫度（颜色已让给"认游戏"）。parts 非空时渲染成"数字 + 小号单位"。
		function scheduleWhen(it, now) {
			if (it.state === "wait") return { text: scheduleMDHM(it.startTs) + " 开始", parts: null };
			if (it.state === "long") return { text: "长期", parts: null };
			if (it.state === "ended") return { text: "已结束", parts: null };
			if (it.remain <= SCHEDULE_DUE_MS && scheduleSameDay(it.endTs, now)) {
				return { text: "今天 " + scheduleHHMM(it.endTs) + " 到期", parts: null };
			}
			const parts = scheduleCountdown(it.remain);
			return { text: "还剩 " + parts.map((p) => p[0] + p[1]).join(""), parts };
		}

		// 表格单元格的副标题 = 「档期 · 状态」（设计稿的 `.cm`）
		function scheduleMeta(it, now) {
			const w = scheduleWhen(it, now);
			if (it.state === "long" && !it.endTs) return "无结束时间 · 长期";
			if (it.state === "wait") return w.text + " · 至 " + scheduleMDHM(it.endTs);
			return scheduleMDHM(it.startTs) + " → " + scheduleMDHM(it.endTs) + " · " + w.text;
		}

		// 日期格（表格里的「档期 · 状态」，.gacha-cal-sched-cm）的悬停。
		// 名称格的悬停早已带失败/沿用旧值结论（hoverTextOf）；日期格此前只有外显文本、没有悬停，
		// 用户看不出这个日期是**本轮正常拿到**的，还是抓取失败后**沿用上次成功**的数据。口径与名称格一致：
		//   · 本轮该侧失败/未命中 ⇒ 复用 sideFailText 的既有文案（「卡池失败：网络不通」）；
		//     该格显示的确实是沿回的旧值时，再补「，日期为沿用旧值」。
		//   · 只是沿用旧值（本轮没拿到新内容、但也没有报错）⇒「数据来自上次成功抓取 X 前」
		//     （X 取该行的 _okAt，与游戏名悬停的「刷新时间」同一时间来源）。
		//   · 该侧根本没有数据（没有条目）⇒「（无数据）」。
		//   · 正常 ⇒ **只有源站墙钟原文**（悬停 = 源站原文，与 scheduleHoverText 同口径），
		//     不拼任何「（）」说明 —— 正常态不撑长 hover。
		// `x` 是 scheduleNormalize / scheduleHoverOnes 产出的条目（null = 该侧没有数据）。
		function scheduleDateHover(x, now) {
			if (!x) return "（无数据）";
			// 悬停一律给源站墙钟原文（rawSrc）；并列条目只有解析出的 win（raw）
			const dates = String(x.rawSrc || x.raw || "").trim();
			const g = x.g || {};
			const isG = !!x.isG;
			const failText = sideFailText(isG ? "gacha" : "event", isG ? g.gachaFail : g.eventFail, { userSupplied: false });
			const stale = !!(isG ? g.gachaStale : g.eventStale);
			const notes = [];
			if (failText) notes.push(stale && dates ? failText + "，日期为沿用旧值" : failText);
			if (stale) {
				const okAt = Number(g._okAt || g.okAt) || 0;
				const at = now && typeof now.getTime === "function" ? now.getTime() : 0;
				const ago = okAt > 0 && at > okAt ? " " + tickerSpanText(at - okAt) + "前" : "";
				notes.push("数据来自上次成功抓取" + ago);
			}
			if (!dates && !notes.length) return "（无数据）";
			return dates ? dates + (notes.length ? "\n（" + notes.join("；") + "）" : "") : "（" + notes.join("；") + "）";
		}

		// 一格里"露哪一条"的次序：在期 > 即将开始 > 长期 > 已结束（横跨所有游戏排「近期」也用同一把尺）。
		function scheduleRank(x) {
			if (x.state === "live") return x.remain <= SCHEDULE_DUE_MS ? 0 : 1;
			if (x.state === "wait") return 2;
			if (x.state === "long") return 3;
			return 4;
		}
		function schedulePickItem(a, b) {
			const ra = scheduleRank(a), rb = scheduleRank(b);
			if (ra !== rb) return ra - rb;
			if (ra <= 1) return a.endTs - b.endTs;
			if (ra === 2) return a.startTs - b.startTs;
			if (ra === 4) return b.endTs - a.endTs;          // 已结束的：最近结束的在前
			return 0;
		}

		// 紧迫度 → 文字色档位（"1" = 今天到期 / "2" = 一周内 / 其余不标色）。**只用于文字**
		function scheduleUrgency(x) {
			if (x.state !== "live") return void 0;
			if (x.remain <= SCHEDULE_DUE_MS) return "1";
			if (x.remain <= SCHEDULE_AMBER_MS) return "2";
			return void 0;
		}

		// 类型图标：**内联 SVG**（卡池 = 菱形星芒 / 活动 = 旗帜）。两者**形状不同** → 不靠颜色也能分辨，
		// 也不用 emoji（用户明确说 emoji 丑）。旁边的文字标签样式见 styles/schedule.css 的 .gacha-cal-sched-kind。
		// 悬停明细：**原面板那套**（引擎的 bannerHover / eventHover —— 当期 ≥2 条时每条一行，
// 形如「池名：角色 ⏎ 档期」或「活动名 + 3 空格 + 档期」）。没有并列条目时给空串 →
// 退化成「外显 ⏎ 档期」，与原面板单条时的观感一致。
		// 提示框（原生 title）里插入「只给提示框」的提示行（如明日方舟的「<活动> 兑换截止   11-10 03:59」）。
		// 为什么单独一个函数：提示行**绝不能进 eventHover**（表格格子会把 eventHover 解析成并列条目，
		// 那一行就会变成格子里的一行可见文字 —— 2026-11-06 真机 bug）。这里只做"插到正确位置"这一件事，
		// 表格格子的 hoverTextOf（82）与「近期」行的 scheduleHoverText（下面）都调它 ⇒ 两处口径一致。
		//
		// 字段 = `eventHoverExtra`（**每两条一组**：① 该活动的**标签** ② 提示行本身，组间用 "\n" 隔开）。
		//   · 用标签当锚点：悬停原文里该活动那一行**以它开头**（`<名称>   <档期>`），找到就插在它**后面** ——
		//     用户要求"紧跟对应活动那一行"（不许统一堆到末尾，否则看不出是哪个活动的兑换截止）；
		//   · 锚点精确判据：整行等于标签，或整行以 `标签 + 3 空格` 开头 —— 避免「墟」吃掉「墟·复刻」那行的位置；
		//   · 找不到锚点（悬停为空 / 外显那条不在悬停里）⇒ 追加到末尾（宁可位置不完美，也不能丢掉这个 deadline）。
		// 只在**活动侧**生效（`eventHoverExtra` 是活动列字段），没有 / 空串 ⇒ 原样返回，不补任何东西。
		function scheduleHoverNote(text, g, isG) {
			if (isG || !g) return text;
			const extra = typeof g.eventHoverExtra === "string" ? g.eventHoverExtra : "";
			if (!extra) return text;
			const lines = extra.split("\n");
			const out = text ? String(text).split("\n") : [];
			for (let i = 0; i + 1 < lines.length; i += 2) {
				const anchor = lines[i], note = lines[i + 1];
				if (!note) continue;
				const at = anchor
					? out.findIndex((l) => l === anchor || l.indexOf(anchor + "   ") === 0)
					: -1;
				if (at >= 0) out.splice(at + 1, 0, note);
				else out.push(note);
			}
			return out.join("\n");
		}
			function scheduleHoverText(x) {
				const hv = (x.isG ? x.g.bannerHover : x.g.eventHover) || "";
				// 悬停一律给**源站墙钟原文**（rawSrc）；换算后的本机时区文本只用于外显
				const head = [x.title, x.rawSrc || x.raw].filter(Boolean).join("\n");
				// 与表格格子的 hoverTextOf 同一口径（两处必须一致）：
				//   · 卡池侧：照旧把 `池名 ⏎ 档期` 接在悬停原文后面（每口池两行式，逐字不变）；
				//   · 活动侧：**不接** `title + rawSrc` —— `eventHover` 已经是「每个活动一行」的完整信息，
				//     再接一遍就是同一段区间出现两次（2026-11-07 真机 bug：提示框末尾多出
				//     「视相博物馆：演化」⏎「11-07 03:59 ~ 11-10 03:59」这两行）。
				//     活动侧只有 `eventHover` 为空（极端情况：当期只有 1 条活动）时才用它兜底。
				const text = x.isG
					? [hv, head].filter(Boolean).join("\n")
					: (hv || head);
				return scheduleHoverNote(text, x.g, x.isG) || "—";
			}
			function scheduleKindIcon(kind, cls) {
			const box = { className: cls, viewBox: "0 0 12 12", "aria-hidden": "true", focusable: "false" };
			if (kind === "gacha") {
				return (0, react_jsx_runtime.jsx)("svg", Object.assign({}, box, {
					fill: "currentColor",
					children: (0, react_jsx_runtime.jsx)("path", { d: "M6 .9 8.1 3.9 11.1 6 8.1 8.1 6 11.1 3.9 8.1 .9 6 3.9 3.9z" })
				}));
			}
			return (0, react_jsx_runtime.jsxs)("svg", Object.assign({}, box, {
				fill: "none", stroke: "currentColor", strokeWidth: "1.3",
				children: [
					(0, react_jsx_runtime.jsx)("path", { d: "M2.4 1.4v9.2" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M2.4 2.1h7.2L7.8 4.2l1.8 2.1H2.4z", fill: "currentColor", stroke: "none" })
				]
			}));
		}
		// 刷新失败横条的警示图标。设计稿这里放的是一个警告表情 —— 用户明确说 emoji 丑，故同样换成内联 SVG。
		function scheduleWarnIcon(cls) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				className: cls, viewBox: "0 0 12 12", fill: "none", stroke: "currentColor",
				strokeWidth: "1.3", strokeLinecap: "round", "aria-hidden": "true", focusable: "false",
				children: [
					(0, react_jsx_runtime.jsx)("path", { d: "M6 1.5 11.1 10.5H.9z" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M6 4.6v2.5" }),
					(0, react_jsx_runtime.jsx)("circle", { cx: "6", cy: "8.9", r: ".6", fill: "currentColor", stroke: "none" })
				]
			});
		}
		// GameIcon 自带 5px 圆角；这里用外层方框定尺寸/圆角/描边（多出来的圆角由 overflow 裁掉）。
		// 尺寸与设计稿一致：近期行 26（图 24 + 1px 描边）、游戏表 40（图 38 + 1px 描边）。
		function scheduleIcon(cls, g, size) {
			return (0, react_jsx_runtime.jsx)("span", {
				className: cls,
				children: (0, react_jsx_runtime.jsx)(GameIcon, { icon: g.icon, name: g.name, size })
			});
		}
		// 14 天迷你条：**所有行共用同一根轴**（与表头刻度同列宽），所以今天只有一列 ——
		// 第 3 格画一道深色竖线，与刻度上的今天对齐。图案只表状态，颜色来自该行的 `--gf`（见 styles/schedule.css）。
		//
		// ⚠️ 两种状态**不在这根轴上**，整条做成"图案状态块"（设计稿对"长期"就是这么画的）：
		//   · 长期（无结束时间）→ 整条点线
		//   · 已结束，且窗口整段都在轴之前 → 整条斜纹
		//   为什么必须给"已结束"兜这一下：轴是"今天前 2 天起共 14 天"，而解析器只产出**覆盖当前时刻**
		//   的当期条目 —— 已结束的条目只会从"刷新失败沿用上次成功数据"这类旧值里读到，那时它整段都在
		//   轴之前；逐格按位置填就一格都不亮，"斜纹 = 已结束"在图例里便成了永远见不到的空话。
		//   代价：这种情况位置不再准确（它本来也不在窗口里），但起止日期就写在上面的「档期 · 状态」里。
		function scheduleBars(it, days) {
			const state = !it ? "none" : it.state === "ended" ? "done" : it.state;
			const marker = !it ? "" : it.state === "ended" ? "done" : it.state === "long" ? "long" : "1";
			let onAxis = false;
			for (let i = 0; i < days.length && !onAxis; i++) {
				const from = days[i].getTime();
				const to = i + 1 < days.length ? days[i + 1].getTime() : from + 864e5;
				onAxis = !!it && it.endTs > from && it.startTs < to;
			}
			const whole = !!it && (it.state === "long" || (it.state === "ended" && !onAxis));
			const cells = [];
			for (let i = 0; i < days.length; i++) {
				const from = days[i].getTime();
				const to = i + 1 < days.length ? days[i + 1].getTime() : from + 864e5;
				const attrs = { key: i };
				if (it && (whole || (it.endTs > from && it.startTs < to))) attrs["data-f"] = marker;
				if (i === SCHEDULE_TODAY_INDEX) attrs["data-today"] = "true";
				cells.push((0, react_jsx_runtime.jsx)("i", attrs));
			}
			return (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-tl", "data-state": state, children: cells });
		}
		// ── 「另有 N 条」的条数从哪来 ─────────────────────────────────────────────
		// 注：原先这里有一段「按悬停文本数并列条数」的 scheduleParallelCount（靠正则猜三种排版），
		// 用于旧格子里的「另有 N 条」。2026-10-15 大列表改为「探头 + 悬停覆盖展开」后不再需要，
		// 已整段删除（连同两条只服务于它的正则）—— 少一处脆弱的文本解析。

		// 底部「上次更新 X 分钟前」：只给玩家日常说法，不写绝对时间戳（绝对时间在悬停里）。
		function scheduleAgo(ts, now) {
			const t = Number(ts) || 0;
			if (t <= 0) return "尚未更新";
			const min = Math.floor(Math.max(0, now.getTime() - t) / 6e4);
			if (min < 1) return "刚刚";
			if (min < 60) return min + " 分钟前";
			const h = Math.floor(min / 60);
			if (h < 24) return h + " 小时前";
			return Math.floor(h / 24) + " 天前";
		}


		// 日程面板本体。props 全部来自 CalendarPanel（同一份渲染快照）；组件自身**没有** UI 状态 ——
		// 设计稿要求"不折叠、不点开"，所以旧版的"展开更多"连同它的 useState 一起删了。
		// 通用循环器：每 seconds 秒推一格（count 格一轮）；paused 时不排下一拍。
		// 近期分页与留白卡共用；模块级 hook ⇒ 组件身份稳定，状态不会被父级重渲染重置。
		//
		// 返回 `{ step, seq }`（2026-10-25 四次定稿）：
		//   · step = 当前格号（0..count-1，**取模**）—— 决定"这一帧显示什么"；
		//   · seq  = **单调递增的切换序**（不取模）—— 决定"这一帧往哪个方向翻"。
		// 为什么必须把两者分开：翻页方向规则（tickerDirAt）是按**切换次数**四步一循环
		// （第 1 次 up / 第 2 次 down / 第 3 次 down / 第 4 次 up …），与"回卷到第几格"无关。
		// 若拿取模后的 step 去取方向，序列一回卷到格 0 就会取到 tickerDirAt(0) 的"挂载兜底 down"
		// ⇒ 四步循环在每次回卷处丢一次相位：n=2（最常见）时第 4 次切换本该 up、实渲染 down，
		// 真机上看到的就是「连着三次都是往下」（用户 2026-10-25 报的 bug）。
		function useCycleSteps(count, seconds, paused) {
			const [seq, setSeq] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (paused || count <= 1) return;
				const t = window.setInterval(() => setSeq((v) => v + 1), seconds * 1000);
				return () => window.clearInterval(t);
			}, [count, seconds, paused]);
			return { step: count > 0 ? seq % count : 0, seq };
		}
		// 老调用方（日程卡的留白卡 / 近期分页）只要格号：行为与改动前完全一致。
		function useCycle(count, seconds, paused) {
			return useCycleSteps(count, seconds, paused).step;
		}
