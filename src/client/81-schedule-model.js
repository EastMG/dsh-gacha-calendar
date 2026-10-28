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
			// 外显文本：卡池侧优先显示**去修饰的角色名**（旧面板一直这么显示），没有角色名就退回卡池标题；活动侧仍是活动名
			const roles = isG ? (g.roles || "") : "";
			const show = (isG && roles) ? (cleanRoleNames(roles, g.id) || title) : title;
			// 悬停文本：**原始文本** = 标题 + 源站原文（优先 Raw），与旧面板 gachaTitle/eventTitle 的写法一致
			const datesRaw = (isG ? g.bannerDatesRaw : g.eventDatesRaw) || rawSrc;
			const orig = title + (datesRaw ? "\n" + datesRaw : "");
			return { key: g.id + ":" + side, g, side, isG, title, show, orig, raw, rawSrc, fail, state, startTs, endTs, remain };
		}

		// ── 同格并列条目：从悬停文本解析出来 ─────────────────────────────────────────
		// 引擎只给**一条外显条目** + 一段供悬停用的多行文本（bannerHover / eventHover），**没有**并列数组。
		// 契约（26-parser-hover.js 的 buildPoolHover / buildEventHover；28-parser-hover-tools.js 的 hoverPool / hoverEvent）：
		// 当期 ≥2 条时每条一行、不足 2 条时给空串，且三种排版：
		//   · 活动式 —— 每条自带档期：`名称   MM-DD HH:MM ~ MM-DD HH:MM`
		//   · 卡池式 —— 档期另起一行：`池名：角色` ⏎ `MM-DD HH:MM ~ MM-DD HH:MM`
		//   · 两者在"窗口完全相同"时都只在**末尾**写一遍档期
		// ⚠️ 鸣潮的卡池悬停（30-game-kuro.js）首行还多带一个"卡池类型"，它就等于外显标题 → 丢掉那一行。
		// 解析不出（或结果少于 2 条）一律返回空，调用方回退到外显那一条 —— 宁可少列，绝不列错。
		const SCHEDULE_WINDOW_LINE = /^(?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2} ~ (?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2}$/;
		const SCHEDULE_INLINE_WINDOW = / (?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2} ~ (?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2}$/;
		const scheduleNoYear = (x) => String(x).replace(/(\d{4})-(\d{1,2}-\d{1,2})/g, "$2");
		function scheduleHoverItems(hover, shownTitle, isG) {
			const lines = String(hover || "").split("\n").map((x) => x.trim()).filter(Boolean);
			if (lines.length < 2) return [];                        // 契约：只有 1 条时给的是空串
			// ⚠️ 这里**不要**再去丢"首行等于外显标题"的那一行（我曾这么写，结果把终末地的真池子丢了：
			// 「终末地」常驻寻访 正好既是外显标题、又是悬停里的第 1 个池子）。
			// 重复项（含鸣潮那个"卡池类型"首行，它等于外显标题）由 scheduleHoverOnes 按标题去重处理。
			const rest = lines.filter((x) => !/^以及常驻活动/.test(x));
			const out = [];
			let pending = [];                                       // 卡池式：先攒名称，等下一行（或后面某行）的档期
			for (const line of rest) {
				const inline = line.match(SCHEDULE_INLINE_WINDOW);
				if (inline && inline.index > 0) {                   // 活动式：名称 + 自己的档期
					const win = inline[0].trim();
					for (const t of pending.concat([line.slice(0, inline.index).trim()])) out.push({ title: t, win });
					pending = [];
					continue;
				}
				if (SCHEDULE_WINDOW_LINE.test(line)) {              // 纯档期行
					if (pending.length) for (const t of pending) out.push({ title: t, win: line });
					else if (out.length) out[out.length - 1].win = line;   // 窗口完全相同：给上一条补上档期
					pending = [];
					continue;
				}
				pending.push(line);
			}
			// ⚠️ 同一口池在数据里有两种写法，一起摆进探头就是"看起来重复"（用户 2026-10-16）：
			//    · 引擎的 roles 只给角色名 ——「克莱门莎」
			//    · 悬停原文给「池名：角色」——「海渊巡游：克莱门莎」「「微醺茶香，藤花幽梦」：仙踪良梦」
			//    用户定的口径：**只显示角色名那条** ⇒ 谁被另一条整个包住，就留谁、把带池名的那条丢掉。
			//    另外：完全同名（战双帕弥什「新增涂装」×6、原神「绮星盛会」×2）只留第一条。
			//    ⚠️ 只认「：」两侧的整段（不做任意子串）——否则「夏日活动」会被当成「夏日活动·特别篇」的重复。
			const normTitle = (s) => String(s || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
			// A 是不是「池名：B」或「B：其余」这种把 B 整个包住的写法（B 通常就是那条只有角色名的）
			const wraps = (A, B) => {
				const la = normTitle(A), lb = normTitle(B);
				if (lb === "" || la === lb) return false;
				if (la.indexOf(lb + "\uFF1A") === 0) return true;
				const tail = la.lastIndexOf("\uFF1A" + lb);
				return tail >= 0 && tail === la.length - lb.length - 1;
			};
			const kept = [];
			const seenTitle = new Set();
			for (const a of out) {
				const la = normTitle(a.title);
				if (la && seenTitle.has(la)) continue;              // 完全同名 ⇒ 只留第一条
				if (out.some((b) => b !== a && wraps(a.title, b.title))) continue;   // a 包着别人 ⇒ 丢 a，留被包住的那条
				if (la) seenTitle.add(la);
				kept.push(a);
			}
			// ⚠️ 这里**只**在一条都不剩时收手。老写法是"少于 2 条就当没有"，那是为
			//    "外显与探头会重复"的旧模型准备的；现在外显固定为列表第 0 条、且同池已去重，
			//    只剩 1 条并列池时必须照常列出来（否则那口池在面板上彻底看不见，用户 2026-10-16）。
			if (kept.length < 1) return [];
			return kept;
		}
		// 把 { title, win } 补成与 scheduleNormalize **同形**的条目（渲染层只认这一种形状）
		function scheduleHoverOnes(items, it, now) {
			const out = [];
			for (const x of items) {
				if (x.title === it.title) continue;                  // 外显那条已经有了，不重复列
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
			function scheduleHoverText(x) {
				const hv = (x.isG ? x.g.bannerHover : x.g.eventHover) || "";
				// 悬停一律给**源站墙钟原文**（rawSrc）；换算后的本机时区文本只用于外显
				const head = [x.title, x.rawSrc || x.raw].filter(Boolean).join("\n");
				return [hv, head].filter(Boolean).join("\n") || "—";
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
