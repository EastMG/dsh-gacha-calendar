		//#region components
		// 本插件在 DSH 设置面板里的导航名；面板按钮与弹层标题也用它（唯一事实来源，90-plugin.js 注册分区时共用）。
		const SETTINGS_SECTION_LABEL = "\u4E8C\u6E38\u65E5\u5386";
		// 面板上那个「设置」按钮：**临时隐藏**（用户要求）。函数与样式都保留，
		// 改回 true 即可恢复，不用重写逻辑。
		const SETTINGS_BUTTON_VISIBLE = false;
		// DSH 设置面板是"点了才挂载"，打开后要等导航渲染出来才能切页；预算给足但不无限等。
		const SETTINGS_NAV_TIMEOUT_MS = 600;
		const SETTINGS_NAV_POLL_MS = 30;
		// 设置页游戏列表的「提醒」列：**暂时隐藏**（用户要求，不是删除）。
		// 暂时隐藏：送达功能未实现 —— 这一列是「到期提醒（送达）」的逐游戏白名单（配置键 `remindGames`），
		// 送达还没做，勾了没有任何效果，摆在那儿只会让人以为勾了就真会提醒。
		// 恢复：改回 `true` 即可 —— 表头列标题 / 每行复选框 / 「全部提醒」按钮 / 表头上方概括 /
		// 网格列宽五处全部由它 gate；`remindGames` 配置键、schema、CONFIG_KEYS、纯函数
		// `remindGameAllowed` 与写入链路（setEntryRemind / resetRemindAll）都原样保留，不用重写逻辑。
		const SHOW_REMIND_COLUMN = false;
		// 游戏列表网格列宽 = 游戏 / 展示 / [提醒] / 卡池来源 / 活动来源 / 颜色 / 操作。
		// 隐藏「提醒」时把对应那一格（28px）从模板里**去掉**：留空列会把后面各列整体错位。
		const SETTINGS_GAME_GRID = SHOW_REMIND_COLUMN
			? "minmax(0,1.15fr) 28px 28px minmax(0,1fr) minmax(0,1fr) 34px 88px"
			: "minmax(0,1.15fr) 28px minmax(0,1fr) minmax(0,1fr) 34px 88px";

		// 打开 DSH 设置面板并切到本插件的分区（面板上的「设置」按钮用，注释见按钮处）。
		// DSH 没有给插件"跳转设置页"的官方 API：面板是 modal，open 与 activeId 都是组件私有 state，
		// 且 activeId 每次打开都重置为 undefined，面板按 rows[0] 兜底（= 导航第一项）。所以只能：
		// ① 点侧边栏那个设置触发器；② 等面板挂载出来，按导航名点本插件那一项。
		function openPluginSettingsSection() {
			const all = [...document.querySelectorAll('[aria-haspopup="dialog"]')];
			const visible = all.filter((el) => typeof el.getClientRects === "function" && el.getClientRects().length > 0);
			const named = visible.find((el) => {
				const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim();
				return /\u8BBE\u7F6E|\u8A2D\u5B9A|Settings/i.test(label);
			});
			const trigger = named || visible[0] || all[0];
			if (!trigger || typeof trigger.click !== "function") return;
			trigger.click();
			const deadline = Date.now() + SETTINGS_NAV_TIMEOUT_MS;
			// 在给定根节点里找「二游排期」那一项：先按 aria-label，再按自身文本。
			// 不写死 `nav button` 结构 —— 设置外壳换布局时（0.1.7 把插件配置挪到了
			// 「插件」页）这种硬结构选择器会静默失效，表现为"点设置跳错页"。
			//
			// 必须排除本插件自己的面板：面板的开关按钮 aria-label 就是同一个标签，
			// 文档级兜底会先命中它 → 点下去变成"自己开自己"（典型症状：点设置没反应/跳错）。
			const inOwnPanel = (el) => {
				for (let n = el; n; n = n.parent) if (n.classList && n.classList.contains("gacha-cal-pop")) return true;
				return false;
			};
			const findItem = (root) => {
				if (!root || typeof root.querySelectorAll !== "function") return null;
				const items = [...root.querySelectorAll("button, a")]
					.filter((el) => el !== trigger && !inOwnPanel(el));
				const byAttr = items.find((el) => {
					const l = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
					return l === SETTINGS_SECTION_LABEL;
				});
				if (byAttr) return byAttr;
				return items.find((el) => (el.textContent || "").trim() === SETTINGS_SECTION_LABEL) || null;
			};
			const tick = () => {
				// 只在设置面板（dialog）里找，**不做整篇文档的兜底搜索**：
				// 本插件面板的开关按钮 aria-label 就是同一个标签，文档级搜索会先命中它，
				// 一点就变成"自己把自己打开"（实测就是这样：点设置只弹本插件面板、不跳页）。
				const dialogs = [...document.querySelectorAll('[role="dialog"]')];
				for (const d of dialogs) {
					const hit = findItem(d);
					if (hit) { hit.click(); return; }
				}
				if (Date.now() < deadline) window.setTimeout(tick, SETTINGS_NAV_POLL_MS);
			};
			window.setTimeout(tick, 0);
		}

		// ── 游戏图标（含**降级兜底**）──
		// 为什么需要：图标全是**外链**（README 承诺"不存储任何游戏资源"，故不打包进仓库）。
		// 外链随时可能挂掉、改路径、或对第三方来源防盗链 —— 没有这一层，面板上就是一排裂图。
		// 所以：没配图标 / 图片加载失败 → 退化成「游戏名首字」小方块，信息不丢、观感不崩。
		// 换 URL 后要能重试（自定义条目改图标时），故用 useEffect 按 icon 复位 failed。
		function gameIconGlyph(name) {
			const s = String(name == null ? "" : name).replace(/[\s\u3000]+/g, "");
			if (!s) return "?";
			// 优先取第一个汉字/假名/字母/数字（跳过「·」「：」「！」这类分隔符与符号）
			const m = s.match(/[\u4e00-\u9fff\u3040-\u30ffA-Za-z0-9]/);
			return m ? m[0].toUpperCase() : s.charAt(0);
		}
		function GameIcon({ icon, name, size }) {
			const px = size || 20;
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => { setFailed(false); }, [icon]);
			const box = { width: px, height: px, borderRadius: 5, flex: "none" };
			if (!icon || failed) {
				// B3：这里原先多挂了一个 className:"gacha-cal-icon-fb" —— 70-styles.js 里**没有**这条规则
				// （该元素的造型全在下面的 inline style 上），删掉它视觉零变化（真机 computed 样式逐项相同）。
				return (0, react_jsx_runtime.jsx)("span", {
					"aria-label": name,
					title: name,
					style: Object.assign({}, box, {
						display: "inline-flex", alignItems: "center", justifyContent: "center",
						background: "var(--dsw-alias-bg-l2, rgba(127,127,127,.2))",
						color: "var(--dsw-alias-text-l2, inherit)",
						fontSize: Math.round(px * 0.55), fontWeight: 600, lineHeight: 1,
						userSelect: "none", overflow: "hidden"
					}),
					children: gameIconGlyph(name)
				});
			}
			return (0, react_jsx_runtime.jsx)("img", {
				src: icon, alt: name, loading: "lazy", decoding: "async", style: Object.assign({}, box, { objectFit: "cover" }),
				onError: () => setFailed(true)
			});
		}

		// ── 图标**空闲预热**（治「第一次打开面板时图标一格格往里填」）──
		// 面板一开就会同时挂 20+ 张外链图标：浏览器对单域名的并发连接有限，首屏还得等握手 + TLS + 下载。
		// 这里在插件初始化后的**空闲时段**按固定并发把 URL 先取一遍，让它们进 HTTP 缓存；
		// 等 <img> 真正渲染时直接命中缓存（这些 CDN 都带 cache-control，重复请求走缓存）。
		// 三条约束（改之前先读）：
		//   ① **只预热 SOURCES 里已登记的 icon** —— 不新增白名单之外的外部请求；
		//   ② 不阻塞渲染：requestIdleCallback（无则 setTimeout 兜底），并发 ≤ 6、总时长 ≤ 10s；
		//   ③ 返回清理函数，交给 apply() 的 ctx.effect —— 面板卸载/插件重载后不再继续发请求。
		const ICON_PREWARM_CONCURRENCY = 6;
		const ICON_PREWARM_BUDGET_MS = 10000;
		function prewarmGameIcons() {
			// 非浏览器环境（离线用例 / SSR）没有 Image，直接跳过 —— 不要在这里抛错
			if (typeof Image !== "function") return () => {};
			const urls = [];
			const seen = Object.create(null);
			for (const s of SOURCES) {
				const u = s && s.icon;
				if (typeof u !== "string" || !/^https?:\/\//i.test(u) || seen[u]) continue;
				seen[u] = 1;
				urls.push(u);
			}
			let stopped = false;
			let cursor = 0;
			const active = [];
			const deadline = Date.now() + ICON_PREWARM_BUDGET_MS;
			const pump = () => {
				if (stopped) return;
				while (cursor < urls.length && active.length < ICON_PREWARM_CONCURRENCY && Date.now() < deadline) {
					const img = new Image();
					let done = false;
					const finish = () => {
						if (done) return;
						done = true;
						img.onload = img.onerror = null;
						const i = active.indexOf(img);
						if (i >= 0) active.splice(i, 1);
						pump(); // 腾出一个并发位就补下一张
					};
					img.onload = finish;
					// 单张失败**不重试、不降级**：面板那边 GameIcon 的 onError 兜底照旧负责显示字母
					img.onerror = finish;
					active.push(img);
					img.decoding = "async";
					img.src = urls[cursor++];
				}
			};
			pump();
			return () => {
				stopped = true;
				for (const img of active) { img.onload = img.onerror = null; img.src = ""; }
				active.length = 0;
			};
		}
		/** 把预热排进空闲时段；返回取消函数（给 ctx.effect 当清理器用）。 */
		function scheduleIconPrewarm() {
			let cancelled = false;
			let stopPrewarm = null;
			const run = () => {
				if (cancelled) return;
				stopPrewarm = prewarmGameIcons();
			};
			const useIdle = typeof requestIdleCallback === "function";
			// 有 requestIdleCallback 就等真空闲（timeout 3000 兜底：最多 3s 后一定执行）；
			// 没有就 1.2s 后跑 —— 两者都晚于面板首屏渲染，不会抢带宽/主线程。
			const handle = useIdle ? requestIdleCallback(run, { timeout: 3000 }) : setTimeout(run, 1200);
			return () => {
				cancelled = true;
				if (useIdle && typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
				else clearTimeout(handle);
				if (stopPrewarm) stopPrewarm();
			};
		}

		// ══ 实验特性：新「二游日历」面板视图（`settings.newPanel === true` 时才渲染）══
		// 设计稿（**唯一真源**）：dsh-gacha-ui-lab/a-v6.html（效果图 a-v6.png）
		//
		// 结构自上而下，与设计稿一一对应（类名统一 `gacha-cal-sched-*`，样式见 70-styles.js）：
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
		//     同一款游戏的**卡池 = 深色、活动 = 浅色**（浅色由 `color-mix` 与白混出，见 70-styles.js）
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
		// 契约（25-parser-shared.js 的 hoverPool / hoverEvent / buildPoolHover / buildEventHover）：
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
		// 也不用 emoji（用户明确说 emoji 丑）。旁边的文字标签由 CSS 隐藏，见 70-styles.js。
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
		// 第 3 格画一道深色竖线，与刻度上的今天对齐。图案只表状态，颜色来自该行的 `--gf`（见 70-styles.js）。
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

		// 侧栏按钮轮播的节拍（秒）。用户要求"每 4~6 秒切一条"；5 秒 = 能读完一条、又不至于像卡住。
		const TICKER_SLIDE_SECS = 5;

		// 「系统要求减少动效」开关（用户要求：prefers-reduced-motion: reduce 时**完全不滚动**，
		// 只静态显示内容，仍要能看出"有事"）。
		//   · 走 matchMedia 订阅而不是渲染时读一次：用户在系统设置里改，页面里立刻跟上；
		//   · 老浏览器的 addListener/removeListener 兜底（Safari < 14）；
		//   · 拿不到 matchMedia（测试桩/极老环境）时按 false 处理 —— 与默认观感一致。
		// ⚠️ 这只是**JS 侧**那一半（停掉轮播、固定显示第一条）。CSS 侧还有一条
		//    `@media (prefers-reduced-motion:reduce){.gacha-cal-btn-flip{animation:none}}`（70-styles.js），
		//    两处都要有：只停 JS 会在"系统还没来得及通知"的那一帧里仍然播一次翻页。
		function usePrefersReducedMotion() {
			const [reduce, setReduce] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const mq = typeof window !== "undefined" && typeof window.matchMedia === "function"
					? window.matchMedia("(prefers-reduced-motion: reduce)")
					: null;
				if (!mq) return;
				const sync = () => setReduce(!!mq.matches);
				sync();
				if (typeof mq.addEventListener === "function") {
					mq.addEventListener("change", sync);
					return () => mq.removeEventListener("change", sync);
				}
				if (typeof mq.addListener === "function") {
					mq.addListener(sync);
					return () => mq.removeListener(sync);
				}
			}, []);
			return reduce;
		}

		// 探头定位：按格子实测写 --rx/--ry/--rw（左右各补 6px 盖住网格间隙）。
		// 之所以用 fixed：absolute 的探头会把滚动容器"撑长"（实测悬停时 +133px），
		// 靠下的格子一展开面板内容就变长 ⇒ 滑块缩短 / 滚动锚定位移 = 用户看到的"抽搐"。
		// 代价是 fixed 用的是**视口坐标**，会随滚轮失效 ⇒ 由 slotScroll 在滚动时对这些变量重算。
		function slotPlace(el) {
			if (!el) return;
			const b = el.getBoundingClientRect();
			el.style.setProperty("--rx", (b.left - 6) + "px");
			el.style.setProperty("--ry", (b.bottom - 12) + "px");
			el.style.setProperty("--rw", (b.width + (el.getAttribute("data-t") === "gacha" ? 12 : 14)) + "px");
		}
		// 当前被悬停的格子只记一个：滚动时只重定位它 —— 不再用 :hover 查询（那会强制样式计算与命中测试），
		// 且合并到每帧一次（rAF），否则滚轮每 16ms 就强制一次同步布局，滚动会一顿一顿的。
		let slotHeld = null;
		let slotRaf = 0;
		function slotEnter(el) { slotHeld = el; slotPlace(el); }
		function slotLeave(el) { if (slotHeld === el) slotHeld = null; }
		function slotScroll() {
			if (!slotHeld || slotRaf) return;
			slotRaf = window.requestAnimationFrame(() => {
				slotRaf = 0;
				if (slotHeld) slotPlace(slotHeld);
			});
		}

		// 展开的探头是 position:fixed ⇒ 指针在它上面时滚动链挂在视口上、不经过面板视图，滚轮会像被吃掉。
		// 但又不能靠 pointer-events:none 放行：那样指针会穿透到下面那一行、把别人的探头激活（用户明确不要）。
		// 所以：探头照旧接管指针（挡住下面那行），滚轮在这里手动转交给面板视图。
		// 这里**不做 rAF 合并**：每个滚轮事件立即写一次 scrollTop —— 这正是浏览器原生滚动的节奏，
		// 同一帧内的多次写会被浏览器合并成一次绘制；合并到 rAF 反而多等一帧、手感发涩。
		//
		// 🔴 后续待办（用户 2026-10-16 明确列入）：**优化滚动手感**。
		//    现状的硬约束：fixed 元素的滚动链挂在视口上 ⇒ 指针在探头上时，浏览器不会把滚轮交给面板；
		//    而"滚轮原生"要求探头待在滚动容器**内部** ⇒ 容器必然裁它（末行探头会被面板下沿切掉）。
		//    两条无法同时成立，目前选的是"探头稳定、伸得出面板、挡住下面那行"，滚轮用脚本转交。
		//    可尝试的方向（都还没做）：
		//      a) 探头 pointer-events:none（滚轮落回容器 ⇒ 原生），另在容器内放一层透明"挡板"负责命中，
		//         挡板撑出的那点高度用容器底部预留吸收；
		//      b) 把探头 DOM 挪成**滚动容器的兄弟节点**（既不裁、也不撑大），坐标由 JS 给；
		//      c) 等探头高度能被压到很小（一两条）时，重新评估是否值得为此引入 JS。
		function slotWheel(e) {
			const el = e && e.currentTarget;
			if (!el || !el.closest) return;
			// 真正的滚动容器是 .gacha-cal-sched-body（overflow:auto）。
			// ⚠️ 以前这里取的是 .gacha-cal-sched —— 那是**卡片本身**（overflow:hidden、高度自适应 ⇒ 永不溢出）
			//    ⇒ `scrollTop += deltaY` 等于空操作：指针停在探头上滚轮时，面板纹丝不动
			//    （审计 2026-10-16 真机实测：card.scrollTop 恒为 0，body.scrollTop 才能真的滚）。
			const v = el.closest(".gacha-cal-sched-body") ||
				((el.closest(".gacha-cal-sched") || document).querySelector(".gacha-cal-sched-body"));
			if (v && v.scrollHeight > v.clientHeight) v.scrollTop += e.deltaY;
		}
		// ── 留白卡（模块作用域）──────────────────────────────────────────────
		// ⚠️ 必须定义在这里，不能定义在 ScheduleView 内部：
		// 父组件每秒都会重渲染（时钟 setNow），定义在里面的组件每次都是**新的函数身份**，
		// React 会当作另一种组件 → 卸载重建 → useState 被重置 → 悬停暂停当场失效。
		// 这里同时把隐式依赖的 now 改成显式参数。
			// ④ 留白区：「按顺序循环」的卡（背景与主体都取该条目自己的强调色）
			//    大图标当主体；环 = 该档期"已过多少"；下面两行是再往后两件（各两行）。
			//    数据全部取自条目已有的 startTs/endTs/raw，不需要任何新抓取。
			//
			//    ⚠️ 这里曾经写成"纯 CSS 关键帧动画 + DOM 事件钉帧 + 离开时旋转轮次续播 + 0.384s 魔数"，
			//    起因是我误判"本插件环境 hook 不可靠"（依据只有一次 inline style 为空的观察）。
			//    实际上插件里 hook 用得很密（GameIcon 75 行就在用 useState/useEffect），
			//    所以按常规写法重做：**组件内 useState 推进 + 一层 CSS transition**，
			//    短、可读、无魔数，而且天然满足"悬停停在干净的一帧"（停的就是当前这条，它本来就是 1）。
			function slotFrac(it, now) {
				if (!it || typeof it.endTs !== "number") return 0;
				if (typeof it.startTs === "number" && it.endTs > it.startTs) {
					return Math.min(1, Math.max(0, (now - it.startTs) / (it.endTs - it.startTs)));
				}
				return 0; // 无开始时间（长期/仅知结束）：只画轨道，不假装有进度
			}
			function slotLeftDays(it, now) {
				return Math.max(0, Math.ceil((it.endTs - now) / 86400000));
			}
			// 环：底轨道 + 进度弧（rotate -90 让起点在正上方，与 Apple 一致）
			function slotRing(frac, color, size, stroke) {
				const r = (size - stroke) / 2;
				const c = 2 * Math.PI * r;
				const off = c * (1 - Math.min(1, Math.max(0, frac)));
				return (0, react_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 " + size + " " + size, children: [
					(0, react_jsx_runtime.jsx)("circle", { className: "gacha-cal-slot-track", cx: size / 2, cy: size / 2, r: r, fill: "none", strokeWidth: stroke }),
					(0, react_jsx_runtime.jsx)("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", stroke: color, strokeWidth: stroke, strokeLinecap: "round",
						strokeDasharray: c.toFixed(1), strokeDashoffset: off.toFixed(1), transform: "rotate(-90 " + size / 2 + " " + size / 2 + ")" })
				] });
			}
			// 「再往后两件」一行：小环 + 游戏名一行 / 事项名一行 + 剩余天数
			function slotLine(it, now) {
				return (0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-slot-row", key: it.key, children: [
					slotRing(slotFrac(it, now), slotAccent(it), 22, 3.4),
					(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-slot-nm", children: [
						(0, react_jsx_runtime.jsx)("b", { children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: it.g.name }) }),
						(0, react_jsx_runtime.jsx)("i", { children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: it.title }) })
					] }),
					(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-slot-dd", children: [
						(0, react_jsx_runtime.jsx)("em", { children: String(slotLeftDays(it, now)) }), " 天后结束"
					] })
				] });
			}
			// ⚠️ 这里**不能**用设置页的覆盖表：slotAccent 定义在 ScheduleView/SlotCard 之外的作用域，
			//    拿不到 gameColorMap（上一版就是在这里踩了 ReferenceError，面板整块渲染失败）。
			//    但留白卡的 --g **就是**用户覆盖色：CalendarPanel 已把覆盖色并进条目的 color
			//    （colorOverrides[g.id] 命中时写 g = { ...g, color: ov }），本函数读 g.color
			//    ⇒ 覆盖色照样生效。旧注释写"留白卡暂时用出厂色/名字哈希、覆盖色只作用于表格行与设置页"
			//    与事实相反（真实行为比那更好）。
			const slotAccent = (it) => scheduleGameColor(it.g);
			// 档期行：有 raw 才补分隔符；没有开始时间就不显示"已过 0%"（那是假信息）
			function slotSub(it, frac) {
				if (typeof it.startTs !== "number") return it.raw || "";
				return (it.raw ? it.raw + " · " : "") + "已过 " + Math.round(frac * 100) + "%";
			}
			const SCHEDULE_SLOT_SECS = 4;
			// 留白卡本体：普通组件（useState 推进 + useEffect 定时），悬停即不再排下一拍
			function SlotCard({ list, now }) {
				const ending = list.filter((x) => x && typeof x.endTs === "number" && x.state !== "long" && x.endTs > now)
					.sort((a, b) => a.endTs - b.endTs);
				const slides = ending;                       // 全部按顺序循环（不再限 6 条）
				const n = slides.length;
				const [held, setHeld] = (0, react.useState)(false);
				const cur = useCycle(n, SCHEDULE_SLOT_SECS, held);
				// 下面三行跟着当前这条走：显示它之后的三个（也就在循环里一起换）；三行正好把卡片垫到与左侧齐平
				const rows = n > 3 ? [ending[(cur + 1) % n], ending[(cur + 2) % n], ending[(cur + 3) % n]] : [];
				if (!n) return (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-slot gacha-cal-sched-slot--empty" });
				return (0, react_jsx_runtime.jsxs)("div", {
					className: "gacha-cal-sched-slot",
					style: { "--gc": slotAccent(slides[0]) },
					onPointerEnter: () => setHeld(true),
					onPointerMove: marqMove,
					onPointerLeave: () => { setHeld(false); marqClear(); },
					children: [
						// 背景层：撑满整张卡；颜色 = 该条目的强调色（与表格 --gf 同一套规则）
						slides.map((it, i) => (0, react_jsx_runtime.jsx)("span", {
							className: "gacha-cal-slot-bg",
							key: "bg" + i,
							"data-t": it.isG ? "gacha" : "event",
							style: { "--g": slotAccent(it), opacity: i === cur ? 1 : 0 }
						})),
						(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-cine", children: slides.map((it, i) => {
							const color = slotAccent(it);
							const frac = slotFrac(it, now);
							return (0, react_jsx_runtime.jsxs)("div", {
								className: "gacha-cal-slot-slide",
								key: "sd" + i,
								style: { opacity: i === cur ? 1 : 0 },
								children: [
									(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-slot-ring", children: [
										slotRing(frac, color, 132, 9),
										(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-slot-ic", children: (0, react_jsx_runtime.jsx)(GameIcon, { icon: it.g.icon, name: it.g.name, size: 86 }) })
									] }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-gn", children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: it.g.name }) }),
									(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-slot-days", children: [
										(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-slot-n", children: String(slotLeftDays(it, now)) }),
										(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-slot-u", children: "天后结束" })
									] }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-ttl", children: it.title }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-sub", children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: slotSub(it, frac) }) })
								]
							});
						}) }),
						rows.length ? (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-more", children: rows.map((x) => slotLine(x, now)) }) : null
					]
				});
			}
		// ── 悬停自动滚动（截断文字不显示省略号，改为来回滚全文）——**由面板自己驱动** ──
		// 新面板走这里的 React 指针事件（与探头浮层同一套机制）；老面板仍走 90-plugin.js 的
		// document 级 mouseover/mousemove/mouseout。两条路径在真鼠标（CDP 可信事件）下**都能工作**：
		// 老面板的 .gacha-cal-cell 悬停会加上 .gacha-cal-marq + --gacha-marq-d（transform 真的在动）；
		// 新面板「近期」列表的 .gacha-cal-sched-who/.gacha-cal-sched-what 同样生效。
		// ⚠️ 此前记的"那条 document 路径在本机对真鼠标不响应（手动 dispatchEvent 能加类、真鼠标不能）"
		//    是当时环境下的**误判**（只用合成事件采样，没走真实鼠标）⇒ 该结论已作废。
		// 类名/变量沿用老面板那套（CSS 不用动）：
		//   .gacha-cal-marq .gacha-cal-inner{animation:gacha-cal-marquee 3.5s …}  +  --gacha-marq-d
		const MARQ_SEL = ".gacha-cal-sched-who, .gacha-cal-sched-what, .gacha-cal-slot-gn, .gacha-cal-slot-sub, .gacha-cal-slot-nm b, .gacha-cal-slot-nm i";
		let marqEl = null;
		function marqClear() {
			if (marqEl) { marqEl.classList.remove("gacha-cal-marq"); marqEl = null; }
		}
		function marqMove(e) {
			const t = e && e.target;
			const el = t && t.closest ? t.closest(MARQ_SEL) : null;
			if (!el) { marqClear(); return; }
			if (el === marqEl && el.classList.contains("gacha-cal-marq")) return;   // 已经滚着，别每帧重算
			marqClear();
			const inner = el.querySelector(".gacha-cal-inner");
			if (!inner) return;
			const dist = inner.scrollWidth - el.clientWidth;
			if (dist > 0) {
				el.style.setProperty("--gacha-marq-d", "-" + (dist + 8) + "px");
				el.classList.add("gacha-cal-marq");
				marqEl = el;
			}
		}
		// ── 总览那两段计数（K 版 2026-10-17 / 同日二次微调：改成「永远两段」）─────────────
		// 头部那行=「24 小时内 N 条」·「7 天内 M 条」，用共用的 gacha-cal-sched-sep（·）连接。
		// 规则（用户明确要求）：**永远显示两段** —— N=0 / M=0 都照常把数字写出来（如「24 小时内 0 条」）；
		// **没有**任何"都为 0 就换一句话"的兜底路径（原来的「最近 7 天无事」兜底已删）。
		// ⇒ 返回数组长度**恒为 2**，且每项都带 n，渲染侧不需要任何条件分支。
		// 纯函数（不碰 React / DOM）⇒ 四种零/非零组合可离线单测；渲染侧只负责把
		// label + 粗体数字 + 尾字摆出来（样式沿用 .gacha-cal-sched-glance b 那份）。
		function scheduleGlanceSegs(within24, within7) {
			return [
				{ label: "24 小时内 ", n: within24, tail: " 条" },
				{ label: "7 天内 ", n: within7, tail: " 条" }
			];
		}
		function ScheduleView({ games, now, s, colorMap, refreshing, onRefresh, lastRefreshText, scrapeInfo, scrapeLines }) {
			// 每游戏主题色覆盖表（面板侧；设置组件里另有一份同名的）。
			// ⚠️ 必须在这里也定义一次：下面的行 --g 与留白卡 slotAccent 都在本组件里用它，
			//    漏了就是 ReferenceError ⇒ 整个面板（连带插件 UI）挂不上。
			// T3：改由 CalendarPanel 把**已经解析好的表**传进来（colorMap），消除"同一份 JSON 在
			//     两个组件各 parse 一次"；colorMap 缺席时才退回自己解析（保持组件可独立使用）。
			const gameColorMap = colorMap || parseJsonStr(s.gameColors, {});
			// 每一格（游戏 × 卡池/活动）的候选档期。已结束的**留在格子里**（这一侧没有在期内容时它就是
			// 这格的代表，图案走斜纹），但不进「近期」—— 近期回答的是"现在该看哪几条"。
			// ↓↓↓ 纯派生数据（与 CalendarPanel 同理）：4s 一次的「近期」翻页、每分钟时钟、以及任何
			// 无关设置写入都会让本组件重渲染；这一段原本每次都要逐游戏跑 scheduleNormalize（28×2）
			// ＋悬停文本解析＋失败归类。用 useMemo 按真正输入（games / now）缓存。
			//   ⚠️ 依赖只写 games / now：本段不再读别的可变输入（主题色不参与，见 gameColorMap 只在下游用）。
			const { cells, all, failed, failRows, soonCount } = (0, react.useMemo)(() => {
			const cells = new Map();
			const all = [];
			for (const g of games) {
				for (const side of ["gacha", "event"]) {
					const it = scheduleNormalize(g, side, now);
					if (!it) continue;                       // 这一侧没有任何数据 → 格子里写"该来源无数据"
					// 同格并列多条：**外显那条排最前**，其余由悬停文本解析补上（解析不出、或只有一条 → 就只有外显）。
					// ⚠️ 「近期」只收外显那条（all 的语义不变）—— 大列表改版不动「近期」。
					const extras = scheduleHoverOnes(
						scheduleHoverItems(side === "gacha" ? g.bannerHover : g.eventHover, it.title, it.isG), it, now);					// ⚠️ 外显与探头是**同一份列表**（用户 2026-10-16）。引擎给的 roles 是**跨池合并**的角色表
					// ⚠️ 有并列池时，外显**不能**再显示引擎给的"合并角色表"：
					//    探头会把每个池连角色再列一遍（原神 = 丝柯克/爱可菲 两个池、鸣潮 = 3 个池各列一遍），
					//    同一批角色"先合并说一遍、再分池说一遍"正是用户看到的重复 + 粒度混乱。
					//    所以：有并列池 ⇒ 外显回到池名（角色名在探头的每一池里）；只有一池 ⇒ 外显就是角色名。
					// 外显文本规则**与旧面板完全一致**：卡池侧永远显示"去修饰的角色名"（roles 过 cleanRoleNames），
					// 没有角色名才退回池名/活动名。旧面板就是这么写的（见本文件旧面板分支的 gachaVisible）。
					// ⚠️ 这里曾有一版特例「有并列池就改显池名」（想避免角色名"先说一遍、探头再分池说一遍"），
					//    但那是与旧面板不一致的**显示规则**，用户 2026-10-16 要求对齐 ⇒ 已删除。
					//    并列池的角色名在探头里逐池列，重复问题留着不动（显示规则优先与旧面板一致）。
					cells.set(g.id + ":" + side, [it].concat(extras));
					if (it.state !== "ended") all.push(it);
				}
			}
			const sourceNameOf = (x) => (x.isG ? x.g.source : x.g.eventSource) || "";
			// 刷新失败是**来源级**问题（某个网站抓不到），不属于任何一格 → 底部横条 + 重试
			const failed = [];
			for (const list of cells.values()) for (const x of list) if (isDown(x.fail)) failed.push(x);
			const failRows = failed.map((x) => {
				const reason = (normalizeFail(x.fail) || {}).reason || "";
				return x.g.name + " · " + sourceNameOf(x) + (reason ? " " + reason : "") + " —— 该条沿用上次成功数据";
			});
			// 「24 小时内」= 未来 24 小时内有**开始或结束**的外显条目：startTs 或 endTs 落在 (now, now+24h]。
			// 与旧的「今天到期」不同：这里**开始也算**（原来"即将开始"是另一段，现已并进这一格）。
			// ⚠️ 只数 all（= 每格外显那一条，与「近期」同一份候选）；探头里的并列 extras 不计。
			// ⚠️ 0 值/哨兵不动手：长期档期（endTs=0 或 2099 那种）自然落在窗口外，不需要额外特判。
			const nowMs = now.getTime();
			const soonCount = all.filter((x) => (
				(x.startTs > nowMs && x.startTs <= nowMs + SCHEDULE_DUE_MS) ||
				(x.endTs > nowMs && x.endTs <= nowMs + SCHEDULE_DUE_MS)
			)).length;
			return { cells, all, failed, failRows, soonCount };
			}, [games, now]);
			// ↑↑↑ useMemo 结束（cells / all / 失败归类 / 24 小时计数）
			// 「近期」= **7 天内有事发生**（到期或开始）；更远的只出现在下方游戏表里
			// （用户 2026-10-15：不能把 20 多天后的也算近期）。长期/已结束不进近期。
			const SCHEDULE_NEAR_MS = SCHEDULE_AMBER_MS;
			// 「近期」默认只列前 10 条（已按紧迫度排序），其余靠每 4 秒换一批（取模环绕）循环看到；
			// 底部按钮「展开全部 N 条」= React state（nearAll），展开时列全部并停住循环，再点击是「收起」。
			// ——面板里**没有**「还有 N 条」这个文案，也不再走纯 CSS 的 checkbox。
			const SCHEDULE_NEAR_LIMIT = 10;
			const scheduleNear = (x) => (x.state === "wait"
				? x.startTs != null && x.startTs - now.getTime() <= SCHEDULE_NEAR_MS
				: x.state === "live" && x.remain <= SCHEDULE_NEAR_MS);
			// 「近期」列表：只由 all（上面已 memo）+ now 决定（scheduleNear 是纯函数）⇒ 同样缓存。
			const recent = (0, react.useMemo)(
				() => all.filter(scheduleNear).sort((a, b) => schedulePickItem(a, b) || (a.g.name < b.g.name ? -1 : a.g.name > b.g.name ? 1 : 0)),
				[all, now]);
			// 「近期」循环：每 4 秒整体换一批（每批 SCHEDULE_NEAR_LIMIT 条，末页用取模环绕 ⇒ 永远满 10 条、且能转遍全部）。
			// 悬停、或点了「展开全部」时都停住 —— 想看全就展开，想停在某批就把鼠标放上去。
			const [nearHeld, setNearHeld] = (0, react.useState)(false);
			const [nearAll, setNearAll] = (0, react.useState)(false);
			const nearPages = Math.max(1, Math.ceil(recent.length / SCHEDULE_NEAR_LIMIT));
			const nearPage = useCycle(nearPages, SCHEDULE_SLOT_SECS, nearHeld || nearAll);
			const nearRows = (nearAll || recent.length <= SCHEDULE_NEAR_LIMIT)
				? recent
				: Array.from({ length: SCHEDULE_NEAR_LIMIT }, (_, i) => recent[(nearPage * SCHEDULE_NEAR_LIMIT + i) % recent.length]);
			// 14 天轴（days）：原本每次渲染都是新数组 ⇒ 会把下面游戏表的 useMemo 依赖打穿（每帧失效）。
			const days = (0, react.useMemo)(() => scheduleDays(now), [now]);
			// 日期胶囊：设计稿写「10 月 5 日 · 周日」
			const datePill = now.getMonth() + 1 + " 月 " + now.getDate() + " 日 · " + SCHEDULE_WEEKDAYS[now.getDay()];
			// 分隔符：左右各一个**真空格**（不只是 CSS margin）⇒ 文本节点本身就是「… 条 · 7 天内 …」，
			// 复制/朗读/innerText 都拿得到正确间隔（总览现在是**单行内联**布局，空格不会被 flex 吃掉）。
			const sep = () => (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-sep", children: " · " });
			// 表头刻度：两栏各一份（左右共用同一根轴，所以列宽必须与迷你条完全一致）
			const ruler = () => (0, react_jsx_runtime.jsx)("div", {
				className: "gacha-cal-sched-ruler",
				children: days.map((d, i) => (0, react_jsx_runtime.jsx)("span", {
					"data-today": i === SCHEDULE_TODAY_INDEX ? "true" : void 0,
					children: String(d.getDate())
				}, i))
			});
			// 「近期」一行：图标 / 游戏名 / 类型 / 事项名 / 时间结论
			const recentRow = (x) => {
				const w = scheduleWhen(x, now);
				return (0, react_jsx_runtime.jsxs)("div", {
					className: "gacha-cal-sched-u",
					key: x.key,
					"data-u": x.state === "wait" ? "wait" : scheduleUrgency(x),
					children: [
						scheduleIcon("gacha-cal-sched-uic", x.g, 24),
						(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-who", children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: x.g.name }) }),
						(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-sched-kind", "data-t": x.isG ? "gacha" : "event", children: [
							scheduleKindIcon(x.isG ? "gacha" : "event", "gacha-cal-sched-tic"),
							(0, react_jsx_runtime.jsx)("span", { children: x.isG ? "卡池" : "活动" })
						] }),
						(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-what", title: scheduleHoverText(x), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: x.title || x.raw || "—" }) }),
						(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-when gacha-cal-sched-num", children: w.parts
							? ["还剩 ", ...w.parts.map((p) => (0, react_jsx_runtime.jsxs)("span", { children: [p[0], (0, react_jsx_runtime.jsx)("small", { children: p[1] })] }, p[1]))]
							: w.text })
					]
				});
			};
			// 表格里的一格：名称 + 「档期 · 状态」+ 14 天迷你条。**不折叠不点开**：同格多条时露一条 + 「另有 N 条」
			const cellView = (g, side) => {
				const isG = side === "gacha";
				const list = cells.get(g.id + ":" + side) || [];
				if (!list.length) {
					return (0, react_jsx_runtime.jsxs)("div", {
						className: "gacha-cal-sched-cell gacha-cal-sched-cell--none", "data-t": side,
						children: [
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cn", children: "—" }),
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cm gacha-cal-sched-num", children: isG ? "该来源无卡池数据" : "该来源无活动数据" }),
							scheduleBars(null, days)
						]
					});
				}
				// ⚠️ 外显与探头在数据层面就是**同一份列表**：第 0 条 = 引擎那条 =
				//    老面板的外显判定结果（g.roles ? cleanRoleNames(roles) : banner）。
				//    ⇒ 外显**固定为第一条**，其余才按紧迫度排序。
				//    不能让排序把某口并列池顶到外显：那会让外显的文本格式时而是"角色名"、
				//    时而是"池名：角色"（用户 2026-10-16 反馈的"怪怪的"就是这个）。
				//    同池重复已在上游处理（悬停解析那层 + scheduleHoverOnes），这里保证"一口池一条"。
				const sorted = [list[0]].concat(list.slice(1).sort(schedulePickItem));
				const it = sorted[0];
				// 同格多条（2026-10-15 定稿）：**第一条完整三行**（名称 / 档期·状态 / 迷你条），
				// 其余收进「探头」：收起只露顶部 12px 且虚化，悬停时该格底板向下变长**覆盖**下面的行
				// （下面的行位置一格不动、格子高度恒定、文字不位移）。不再写「另有 N 条」文字。
			// 悬停弹出的文本：**照老面板的构造**（旧面板分支 = withFailNote(g.bannerHover || gachaTitle, …)）：
			//   · 引擎给了悬停原文（bannerHover / eventHover：全部当期池/活动的多行原文）就用它 ——
			//     这才是老面板悬停里那段"每口池一行"的文本；没有才退回「名称 ⏎ 档期」。
			//   · 抓取失败/沿用旧数据时补一行「（…）」（老面板同样只在有 note 时补）。
			const hoverTextOf = (x, withFail) => {
				const g = x && x.g;
				if (!g) return (x && (x.orig || x.title || x.raw)) || "—";
				const base = (x.isG ? g.bannerHover : g.eventHover) || "";
				// 悬停（探头展开行同样）用**源站墙钟原文** rawSrc；raw 是本机时区换算后的外显文本
				const own = [x.title, x.rawSrc || x.raw].filter(Boolean).join("\n");
				let text = base ? (base + (x.title && base.indexOf(x.title) < 0 ? "\n" + own : "")) : own;
				if (withFail) {
					const fail = x.isG ? g.gachaFail : g.eventFail;
					const stale = x.isG ? g.gachaStale : g.eventStale;
					const note = sideFailText(x.side, fail, { userSupplied: false });
					if (note) text = stale && text ? text + "\n（" + note + "）" : "（" + note + "）";
				}
				return text || "—";
			};
				const itemOf = (x, key) => (0, react_jsx_runtime.jsxs)("div", {
					key, className: "gacha-cal-sched-item", "data-u": scheduleUrgency(x),
					children: [
						(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cn", title: hoverTextOf(x, key === "first"), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: x.show || x.title || x.raw || "—" }) }),
						(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cm gacha-cal-sched-num", children: scheduleMeta(x, now) }),
						scheduleBars(x, days)
					]
				});
				const rest = sorted.slice(1);
				return (0, react_jsx_runtime.jsxs)("div", {
					className: "gacha-cal-sched-cell", "data-t": side, "data-u": scheduleUrgency(it),
					// 展开的探头改成 position:fixed：绝对定位元素会把滚动容器"撑长"（实测悬停时 +133px），
					// 靠下的格子一展开面板内容就变长 ⇒ 滚动条滑块缩短 / 滚动锚定位移 = 用户看到的"抽搐"。
					// fixed 的包含块是视口 ⇒ 既不撑大滚动区、也不会被面板裁掉 —— 真正"伸出面板之外"。
					// 坐标按格子实测写入（--rx/--ry/--rw），滚动时由视图的 onScroll 重算。
					onPointerEnter: (e) => slotEnter(e.currentTarget),
					onPointerLeave: (e) => slotLeave(e.currentTarget),

					children: [
						itemOf(it, "first"),
						rest.length ? (0, react_jsx_runtime.jsx)("div", {
							className: "gacha-cal-sched-rest",
							onWheel: slotWheel,
							children: rest.map((x, i) => itemOf(x, "r" + i))
						}) : null
					]
				});
			};
			// 一行 = 一款游戏（顺序就是传进来的顺序，即设置里拖出来的排列）
			// --z 按**行序递减**：上面的行永远画在下面的行之上（越大越靠上）。
			// 这样"鼠标向上移动"时，上一行正在展开的底板一定压得住下一行尚未收回的内容 ——
			// 不依赖"谁在悬停"（那是会随时间变化的，会出现两格抢层级、下面的字压住上面的底板）。
			const rowOf = (g, i) => (0, react_jsx_runtime.jsxs)("div", {
				className: "gacha-cal-sched-trow",
				key: g.id,
				style: { "--g": scheduleGameColor(g, gameColorMap), "--z": String(900 - i) },
				children: [
					(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-gm", title: buildRowTitle(g), children: [
						scheduleIcon("gacha-cal-sched-gic", g, 38),
						(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-gn", children: g.name })
					] }),
					cellView(g, "gacha"),
					cellView(g, "event")
				]
			});

			// 游戏表（28 行 × 每行两格 × 14 格迷你条 ≈ 2000~2600 个 <i>）：内容只由
			// games / days / cells / 主题色 / now 决定，与「近期」的 4s 翻页、与无关的设置写入**无关**。
			// 这里缓存**元素本身**：React 对同一 element 引用会直接跳过这棵子树的 render + reconcile
			// （`oldProps === newProps` 的 bailout，与 React.memo 是同一机制）⇒ 4s 翻页不再重算这 2000+
			// 个格子。**DOM、类名、内联变量（--g/--z）、动画标记与关键帧全部不变**（纯实现层缓存）。
			// 依赖必须覆盖 rowOf/cellView 读到的全部输入：games（行序/数据）、days（14 天刻度）、
			// cells（每格候选档期，含 now 结果）、gameColorMap（--g）、now（档期文本/紧迫度）。
			const tableJsx = (0, react.useMemo)(() => (games.length
				? games.map(rowOf)
				: (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-empty", children: "还没有勾选任何游戏 · 去设置里挑几款" })),
				[games, days, cells, gameColorMap, now]);

			// 「总览」两段的数字（纯函数 scheduleGlanceSegs 决定；**恒为两段**，N/M 是 0 也照写）。
			// ⚠️ 「7 天内」那段的数字 = recent.length = **就是**「近期」底部按钮「展开全部 N 条」的 N
			//    （同一份 recent / 同一套 scheduleNear 判定，见上）—— 绝不另写第二套 7 天条件。
			const glanceSegs = scheduleGlanceSegs(soonCount, recent.length);

			return (0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched", children: [
				// 滚动层：**底栏在它之外**。这样底栏常驻面板下端，而内容在它上沿干净收住，
				// 不会被底栏"浮在上面切成两半"（sticky 的固有毛病，用户反馈"字都看不清"）。
				(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-body", onScroll: slotScroll, children: [
				// ① 头部**一行**（K 版 2026-10-17 二次微调）：左=总览 .gacha-cal-sched-glance，右=日期胶囊。
				//    （面板**内**的「二游日历」标题已删，侧栏入口按钮不动。）
				//    ⚠️ 原来的独立 glance 行已并入这里：glance 就是 head 的第一个子元素，两个 flex 子元素
				//      靠 .gacha-cal-sched-sp 的 margin-left:auto 分居两端；head 是 nowrap ⇒ 绝不折成两行。
				//    ⚠️ 动画**分层照旧**：head 命中 .04s 那一拍，glance 自己命中 .09s 那一拍（两条规则都还在）。
				(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-head", children: [
					// 总览：**恒为两段**（N/M 为 0 也照显示，没有兜底分支），子元素静态位置 ⇒ 不需要 key。
					(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-glance", children: [
						(0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [glanceSegs[0].label, (0, react_jsx_runtime.jsx)("b", { children: String(glanceSegs[0].n) }), glanceSegs[0].tail] }),
						sep(),
						(0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [glanceSegs[1].label, (0, react_jsx_runtime.jsx)("b", { children: String(glanceSegs[1].n) }), glanceSegs[1].tail] })
					] }),
					(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-sp", children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-pill gacha-cal-sched-pill--live", children: datePill }) })
				] }),
				// ③ 「近期」：跨游戏、按紧迫度、全列出；右侧是「下一个截止」卡（见上）
				(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-recent", children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: "gacha-cal-sched-urgent",
						onPointerEnter: () => setNearHeld(true),
						onPointerLeave: () => setNearHeld(false),
						children: recent.length
						? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-nearpg", key: nearAll ? "all" : "p" + nearPage, onPointerMove: marqMove, onPointerLeave: marqClear, children: nearRows.map(recentRow) }),
							recent.length > SCHEDULE_NEAR_LIMIT
								? (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "gacha-cal-sched-more",
									onClick: () => setNearAll((v) => !v),
									children: [
										(0, react_jsx_runtime.jsx)("span", { children: nearAll ? "收起" : "展开全部 " + String(recent.length) + " 条" }),
										nearAll ? null : (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-page", children: (nearPage + 1) + " / " + String(nearPages) })
									]
								})
								: null
						] })
						: (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-empty", children: "这段时间没有要盯的档期" })
					}),
					(0, react_jsx_runtime.jsx)(SlotCard, { list: all, now: now })
				] }),
				// ④ 游戏表：**没有区块标题**，列表头直接跟在后面
				(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-tcap", children: [
					(0, react_jsx_runtime.jsx)("span", { children: "游戏" }),
					(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-sched-th", "data-t": "gacha", children: [scheduleKindIcon("gacha", "gacha-cal-sched-tic"), "卡池"] }),
					(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-sched-th", "data-t": "event", children: [scheduleKindIcon("event", "gacha-cal-sched-tic"), "活动"] })
				] }),
				// 两栏共用同一根 14 天轴：刻度只画一次（左右各一份，列宽与迷你条完全一致）
				(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-rulerrow", children: [
					(0, react_jsx_runtime.jsx)("span", {}), ruler(), ruler()
				] }),
				(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-theadline" }),
				tableJsx,

				// ⑤ 刷新失败横条 + 重试（重试 = 整轮刷新：引擎没有单源刷新接口，见 50-refresh.js）
				failed.length ? (0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-failbar", title: failRows.join("\n"), children: [
					scheduleWarnIcon("gacha-cal-sched-fic"),
					(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-failtext", children: failRows[0] }),
					(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sched-retry", disabled: refreshing, onClick: onRefresh, children: "重试" })
				] }) : null,
				] }),
				// ⑦ 底部（**常驻面板下端**）：它在滚动层**之外**，所以内容不会从它下面穿过、也不会被切成两半。
				//    左：刷新成功/失败横幅（旧面板 .gacha-cal-scrape 那条，悬停给逐来源明细）；右：上次更新 + 刷新。
				//    左：刷新成功/失败横幅（就是旧面板 .gacha-cal-scrape 那条，悬停给逐来源明细）；
				//    右：上次更新 X 分钟前 + 刷新。
				(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-foot", children: [
					scrapeInfo ? (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-scrape", title: (scrapeLines || []).join("\n"), children: scrapeInfo }) : null,
					(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-when", title: [lastRefreshText, scrapeInfo].concat(scrapeLines || []).filter(Boolean).join("\n"), children: "上次更新 " + scheduleAgo(s.lastRefresh, now) }),
					(0, react_jsx_runtime.jsx)("button", {
						type: "button", className: "gacha-cal-sched-btn", disabled: refreshing,
						title: refreshing ? "刷新中..." : "刷新", "aria-label": refreshing ? "刷新中..." : "刷新",
						onClick: onRefresh, children: "刷新"
					})
				] })
			] });
		}

		// 侧栏按钮的翻页层（2026-10-25 六次定稿）：两行交叉滚动，**动画播完落定成静态单行**。
		//
		// 为什么需要落定：向上翻用 fill-mode forwards 把终点 translateY(-50%) **保持住**
		// （不保持的话动画一结束就弹回 0、露出 prev 行），于是那 5 秒里这一层带着一个持久的
		// transform；向下翻结束时 transform 回到 none。两个方向的终点状态因此不对称 ——
		// 用户 2026-10-25 要求抹平：终点都必须是 transform:none。
		//
		// 做法：onAnimationEnd（只认两条翻页 keyframes）⇒ flipSettled=true ⇒
		//   ① 只渲染 cur 一行（prev 行连 DOM 都不留，纯函数 tickerFlipRenderLinesOf）；
		//   ② 元素加类 .is-settled（CSS: animation:none + transform:none，见 70-styles.js）。
		// 落定画面与动画终点**逐像素相同**（cur 都占满 22px 窗口），所以不存在跳动/闪烁/文字位移：
		//   · up   终点 = 层 -22px、第 2 行 cur 落在窗口 [0,22]；落定 = 层 0、唯一一行 cur 在 [0,22]；
		//   · down 终点 = 层 0、第 1 行 cur 在窗口 [0,22]；落定 = 层 0、唯一一行 cur 在 [0,22]。
		// 两种写法几何完全一样（且 -22px 是整数像素，不会出现半像素抗锯齿差）。
		//
		// ⚠️ state 放在**本组件**里，父层用 `key={shownStep}` 挂它：换格 ⇒ 整体重挂载 ⇒
		//    flipSettled 天然回到 false。这比 `useEffect(..., [shownStep])` 重置更稳：effect 在
		//    渲染**之后**才跑，换格那一帧会先带着上一拍的 settled=true 渲染（单行 + animation:none），
		//    然后才被 effect 改回两行并重新起动画 —— 真机上就是"新的一拍先冻一下再翻"，甚至
		//    可能把动画的起点帧吞掉。用 key 重挂载则在**同一帧**就拿到干净的两行 + 从头开始的动画。
		//    （副作用：少一次只为重置而发的重渲染。）
		// ⚠️ reduce（CSS animation:none）时 animationend **不会**触发 ⇒ flipSettled 恒为 false；
		//    那时渲染两行 + 父层强制的 down 顺序，第 1 行恒为 cur —— 静态路径自己就是对的，
		//    **不依赖**落定生效。
		function TickerFlipLines({ flipDir, shownStep, prevStep, reduceMotion, renderLine }) {
			const [flipSettled, setFlipSettled] = (0, react.useState)(false);
			// 只处理翻页动画本身：按 animationName 过滤两条 keyframes。
			// 将来这一层若再加别的 animation，它的 animationend 不许把翻页层误落定。
			const onAnimationEnd = (e) => {
				const name = e && e.animationName;
				if (name !== "gacha-cal-btn-flip" && name !== "gacha-cal-btn-flip-down") return;
				setFlipSettled(true);
			};
			// reduce 时强制 down 顺序（为什么不许 up：那边 animation:none，没有动画把第 1 行推走，
			// 而 up 顺序的第 1 行是 prev ⇒ 旧内容会常驻窗口）。down 顺序的第 1 行恒为 cur。
			// 落定与否只影响"几行进 DOM"，不影响方向（settled 时方向类留在元素上无害）。
			const flipLines = tickerFlipRenderLinesOf(reduceMotion ? "down" : flipDir, shownStep, prevStep, flipSettled);
			return (0, react_jsx_runtime.jsx)("span", {
				// 类名 = 基础类 + 方向类（视觉方向）+ 落定类；三条规则都在 70-styles.js。
				// 落定类必须排在方向规则之后（同特异性，靠顺序胜出）。
				className: "gacha-cal-btn-flip " + (flipDir === "up" ? "is-up" : "is-down") + (flipSettled ? " is-settled" : ""),
				onAnimationEnd,
				// 每一行 = 该格的内容，slot 只当 React 的 key（cur / prev 两个槽）。
				// 落定时数组只剩 cur ⇒ React 按 key 保留 cur 那个节点、删掉 prev（不会重挂载 cur）。
				children: flipLines.map((l) => renderLine(l.step, l.slot))
			});
		}

		// engine：core 引擎（抓取/解析/缓存合并都在里面）。面板只读它返回的 Result JSON。
		function CalendarPanel({ wide, scope, engine }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [scrapeInfo, setScrapeInfo] = (0, react.useState)("");
			// 顶部提示的悬停明细：逐条分行（分类只在行内，原因放这里）
			const [scrapeLines, setScrapeLines] = (0, react.useState)([]);
			// 当前时间：每分钟刷新一次，驱动"还剩 X 天 X 小时 X 分钟"倒计时
			const [now, setNow] = (0, react.useState)(() => new Date());
			const triggerRef = (0, react.useRef)(null);
			const popRef = (0, react.useRef)(null);
			const [anchor, setAnchor] = (0, react.useState)();

			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => setNow(new Date()), 60000);
				return () => window.clearInterval(timer);
			}, []);

			// 数据源 = 宿主 configForms 表单的**订阅**（scope.getSnapshot/subscribe，源码证据见报告 T1）。
			// 订阅时补读一次：覆盖"首次渲染 → effect 订阅"之间可能落下的一次变更
			// （快照引用未变时 React 直接跳过，不会多一次渲染）。
			(0, react.useEffect)(() => {
				setSnapshot(scope.getSnapshot());
				return scope.subscribe(() => setSnapshot(scope.getSnapshot()));
			}, [scope]);

			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };
			// ── 按**值**派生的依赖键（A3 / B2）────────────────────────────────────────────
			// 宿主每次接受一次写入都会换掉**整个 value 对象图**：真机实测（fiber hook 依赖元组）
			// `snapshot.value` 本身、以及它的 `hidden` / `shown` / `removed` / `order` 数组引用
			// **每次写入都变**（内容可以完全没变），而 `s` 又每次都可能是新对象（上一行）。
			// ⇒ 拿 `s` 或这些数组的**引用**当 useMemo 依赖，等于每个无关写入都把
			//   `visible → games → tableJsx`（2000+ 个格子）整条链打穿，同时 `cachedBanner`
			//   每次都重新 JSON.parse 一遍 ~18.8KB 的 lastData。
			// 用 join 出的字符串当键：变化**当且仅当内容变化**（memo 体内仍读原数组，不会 stale）。
			const removedKey = (Array.isArray(s.removed) ? s.removed : []).join("\u0000");
			const hiddenKey = (Array.isArray(s.hidden) ? s.hidden : []).join("\u0000");
			const shownKey = (Array.isArray(s.shown) ? s.shown : []).join("\u0000");
			const orderKey = (Array.isArray(s.order) ? s.order : []).join("\u0000");
			// customEntries 本身就是 JSON 字符串 ⇒ 直接当键（缺失时退化成 ""）。
			const customEntriesKey = typeof s.customEntries === "string" ? s.customEntries : "";
			// 底栏那条"刷新成功/失败"横幅：**缓存里的最近一次结果也要能显示**。
			// scrapeInfo 只在本轮刷新跑完时才写入 ⇒ 打开面板（数据取自缓存）时左半边是空的 ⇒ 用户看到"提示呢？"。
			// 这里用 lastData（引擎写进设置的最近一次 Result JSON，60-helpers 的失败分类已经在用它）算出同样的横幅。
			// B2：依赖 = **体内真正读到的** s 字段 —— `lastData` 本身，加上 getVisibleEntries(s) 读的
			// removed / customEntries / hidden / shown（60-helpers.js:276 → getAllEntries:168 / isEntryHidden:269）。
			// 原来写 `[s.lastData, s]`：`s` 每次渲染都是新对象 ⇒ 这个 memo 永不命中（每次渲染白 parse 18.8KB）。
			const cachedBanner = (0, react.useMemo)(() => {
				if (!s.lastData) return null;
				try {
					const rec = JSON.parse(s.lastData) || {};
					const games = getVisibleEntries(s).map((g) => ({ id: g.id, name: g.name || g.id }));
					if (!games.length) return null;
					return buildScrapeInfo(games, { games: rec });
				} catch (e) { return null; }
			}, [s.lastData, removedKey, customEntriesKey, hiddenKey, shownKey]);
			const bannerInfo = scrapeInfo || (cachedBanner && cachedBanner.info) || "";
			const bannerLines = scrapeInfo ? scrapeLines : ((cachedBanner && cachedBanner.lines) || []);
			// 面板高度**实测回写**（内联 + !important）：实测 DSH 侧栏环境下这个盒子会被外部撑高，
			// 顶部到底部那一段空白就是它，而 top/height/min-height/flex 四种 CSS 复位都压不住。
			// 这里直接量内容高度写回；内联 !important 优先级最高，任何来源都盖不过。
			// 内容变高（数据刷新等）由 ResizeObserver 跟随；超高时按 72vh 封顶，交给视图内部滚动。
			(0, react.useEffect)(() => {
				const el = popRef.current;
				if (!open || !el) return;
				// F4：这段"量内容高 → 写 inline height(!important)"只属于**新面板**。
				// 新面板的壳是 .gacha-cal-pop--sched（max-height:none / overflow:visible / padding:0），
				// 需要靠 inline height 撑满并跟随内容；旧面板的壳是 .gacha-cal-pop（max-height:72vh + overflow:auto），
				// 它本来靠 CSS 自己限高滚动 —— 给它钉一个 inline height 只会留下一个被 72vh 夹住的死高度。
				// 判定沿用组件里那一处（与 className / children 同一个 `s.newPanel === true`），不另立第二套。
				if (s.newPanel !== true) { el.style.removeProperty("height"); return; }
				const fit = () => {
					// 量**内容的实际跨度**（首个子元素顶边 → 末个子元素底边 + 视图内边距），而不是视图自身高度：
					// 视图可能被上限/拉伸影响，"自身高度"不足以代表内容。
					const inner = el.firstElementChild;
					let content;
					if (inner && inner.children.length) {
						const kids = Array.prototype.slice.call(inner.children);
						const first = kids[0].getBoundingClientRect();
						const last = kids[kids.length - 1].getBoundingClientRect();
						const cs = window.getComputedStyle(inner);
						content = (last.bottom - first.top) + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + 2;
					} else {
						content = el.scrollHeight;
					}
					// 上限 = **可用空间**（视口高 − 锚点 − 8），不再用 72vh：
					// 实测 gapView=0 ⇒ 面板盒内本无空白，但只到 72vh 时锚点之下会留出一段；
					// 那段虽不在我们盒内，却与卡片同为白底、观感上就是"面板下面多一块"。
					// 铺满可用空间后：卡片被内容（scrollHeight≈3027）填满并滚动 ⇒ 视觉空白消失，一屏还能多看好几行。
					const avail = Math.round(window.innerHeight - (anchor && typeof anchor.bottom === "number" ? anchor.bottom : 0) - 8);
					const cap = avail > 160 ? avail : Math.round(window.innerHeight * 0.72);
					el.style.setProperty("height", Math.round(content > cap ? cap : content) + "px", "important");
				};
				fit();
				// 只写一次：不挂 ResizeObserver、也不做延迟复写 —— 观察被拉伸的元素、或绘制后再写一次，
				// 都会再触发重排（用户观察到"刚点开翻不动、隔一会才正常"）。数据刷新后重新开合面板即可覆盖。
			}, [open, s.newPanel]);
			// ↓↓↓ 以下四段是**纯派生数据**（无副作用、不读 ref/时间）：真机实测面板每次重渲染
			// （设置写入的订阅回调、每分钟时钟、……）原本都要重新 JSON.parse lastData（实测 ~19KB
			// = 按次渲染 JSON.parse 的大头）+ 重建条目表 + 重排 + 逐条覆盖抓取结果。
			// 用 useMemo 按**真正的输入**缓存：字符串类字段（lastData / gameColors / customEntries）
			// 直接当依赖（按值稳定）；数组类字段用上面的 *Key（宿主每次写入都会换掉数组对象，
			// 按引用当依赖等于不缓存 —— A3 真机实测）。
			const scrapedById = (0, react.useMemo)(() => {
				// 最近一次抓取结果按游戏 id 索引；解析失败/未联网时为 {}
				let rec = {};
				try { rec = JSON.parse(s.lastData || "{}") || {}; } catch (e) { rec = {}; }
				// 清理历史抓取数据中残留的版本号字段（新版解析器已不产出）
				for (const k of Object.keys(rec)) {
					const v = rec[k];
					if (v && typeof v === "object" && "version" in v) delete v.version;
				}
				return rec;
			}, [s.lastData]);
			// 主题色覆盖表（设置页取色器写入）。**并进条目自身的 color**，
			// 让面板里所有消费者（表格行 --g、留白卡 slotAccent、……）自动拿到同一个颜色 ——
			// 不再把这张表透传到各组件（上一版透传时漏了作用域，直接把面板渲染崩了）。
			const colorOverrides = (0, react.useMemo)(() => parseJsonStr(s.gameColors, {}), [s.gameColors]);
			// 可见条目（隐藏/已删除的不显示）；抓取成功的数据覆盖卡池/活动列
			// 依赖 = getVisibleEntries 真正读的那几个字段（60-helpers.js:276 → getAllEntries:168 / isEntryHidden:269），
			// 但**按值**（*Key 字符串）而不是按数组引用 —— 理由见上面 `removedKey` 那段注释（A3）。
			const visible = (0, react.useMemo)(
				() => getVisibleEntries(s),
				[removedKey, customEntriesKey, hiddenKey, shownKey]);
			const games = (0, react.useMemo)(() => applyOrder(visible, s.order).map((g) => {
				const ov = colorOverrides[g.id];
				if (/^#[0-9a-f]{6}$/i.test(String(ov || ""))) g = { ...g, color: String(ov) };
				const sc = scrapedById[g.id];
				if (!sc) return g;
				return {
					...g,
					// 悬停游戏名/图标：显示这行数据的更新时间（见 buildRowTitle）
					_okAt: sc.okAt || 0,
					// 本次抓取状态：失败（down）或未命中（nomatch）时，在该列悬停里补一行说明；
					// gachaStale/eventStale 表示该列显示的是沿回的旧值（决定说明是否另起一行）
					gachaFail: sc.gachaFail || null,
					eventFail: sc.eventFail || null,
					gachaStale: !!(sc.gachaStale || sc.stale),
					eventStale: !!(sc.eventStale || sc.stale),
					// 卡池名与角色名分开保留：卡池列外显角色名、悬停显示卡池全名
					banner: sc.banner || g.banner,
					roles: sc.roles || g.roles || "",
					bannerDates: sc.bannerDates || g.bannerDates,
					// 源站原文（补全前）：悬停起止列时显示原文而非补全后的时间
					bannerDatesRaw: sc.bannerDatesRaw || "",
					// 逐池悬停文本（如鸣潮并行多池：每池一行）
					bannerHover: sc.bannerHover || "",
					event: sc.event || g.event,
					eventDates: sc.eventDates || g.eventDates,
					eventDatesRaw: sc.eventDatesRaw || "",
					// 活动列逐条悬停文本（并行活动：每条一行；仅 1 条时为空 → UI 退回单条展示）
					eventHover: sc.eventHover || ""
				};
			}), [visible, orderKey, colorOverrides, scrapedById]);

			// ── 侧栏轮播：按钮的**单行翻页**（2026-10-25 晚，替代原来的小红点）────────────
			// 设置 = 设置页的**两个控件**：开关 `tickerOn`（默认开）+ 范围 `tickerHours`
			// （12/24/48/72 小时，默认 72）。
			// 轮播不分游戏：内容 = 所有**展示中**游戏的条目；逐游戏的「提醒」列表这一层不读。
			// **关掉开关时不滚动、也不做任何计算**：下面 memo 直接给空数组，不会去解析任何档期文本；
			// 窄侧栏的红点同样跟着消失（它也看 tickerItems）。
			//
			// 轮播怎么感知"数据变了"（这是本功能唯一需要想清楚的地方）：
			//   不需要新机制 —— 侧栏按钮与面板是**同一个组件**（CalendarPanel），而这个组件早就
			//   订阅了宿主配置表单（上面的 `scope.subscribe(() => setSnapshot(scope.getSnapshot()))`）。
			//   刷新链路把结果写回设置（lastData / lastRefresh）后，宿主会经同一个 store 推送新快照
			//   → setSnapshot → 重渲染 → `games` 变 → 这个 memo 重算 → 轮播内容/条目数跟着变。
			//   时间和阈值那一条则靠组件已有的每分钟时钟 `now`（跨过 N 小时边界时自然翻面）。
			//   ⇒ 一行订阅都不用加、也不用把状态提升到 apply() 层（那会多一个与面板生命周期
			//   不同步的订阅，还得自己处理卸载）。这是本次能做到的最小改动。
			// 总开关（2026-10-25 三次定稿，默认开）：false ⇒ 待轮播清单一律算成空 ——
			// 按钮只有原样（不轮播）、窄侧栏也不显示红点。读取口径只有一处（helpers 的 tickerOnOf）：
			// 只有**明确的 false** 才算关，老配置里没有这个键（undefined）时是"开"。
			const tickerOn = tickerOnOf(s.tickerOn);
			// 范围（小时）同样只有一处口径：老配置残留的 0 一律回落到默认 72（见 helpers 的
			// tickerRangeOf）—— 否则设置页显示 72、按钮却因为 0 而完全不轮播。
			const tickerHours = tickerRangeOf(s.tickerHours);
			// 依赖里**没有**任何逐游戏列表：轮播只随 games / now / 开关 / 范围变化。
			const tickerItems = (0, react.useMemo)(
				() => (tickerOn
					? tickerItemsOf(games, now, tickerHours)
					: []),
				[games, now, tickerOn, tickerHours]);
			// 轮播的"一格"：**交叉序列**里的 idle = 原按钮外观（日历图标 + 「二游日历」），
			// 其余 = 一条轮播条目。用户要求整行内容在原按钮与"一条近期内容"之间竖向翻页 ——
			// 2026-10-25 三次定稿后，**每两条轮播条目之间都会插回一次原按钮**（见 tickerStepsOf）；
			// 2026-10-25 二次定稿（用户选的 **C 方案**）：一格 = `[游戏图标] 事项名 · X`
			//   （三次定稿又去掉了状态前的「还剩」：`· 还剩 8 小时` → `· 8 小时`，≥1 天只说 `3 天`；
			//    悬停/读屏那一份仍带「还剩」，见下面 tickerHintNames 用 ariaText）；
			//   · 文案交给纯函数 tickerSlidesOf（事项名优先、状态单独一段），本层只管排版；
			//   · 图标**跟着整行翻**（状态 0 是日历图标、状态 i 是该游戏自己的图标），不再留固定的日历图标。
			const tickerSlides = tickerSlidesOf(tickerItems, now.getTime());
			// **交叉**序列（2026-10-25 三次定稿）：[idle, 条目1, idle, 条目2, …]（长度 2n；
			// n = 0 时只有 1 格 idle）。每格自带翻页方向（条目 up / 原按钮 down），
			// 全部由纯函数 tickerStepsOf 算（见 60-helpers.js），渲染层不自己推导。
			const tickerSteps = tickerStepsOf(tickerSlides);
			const reduceMotion = usePrefersReducedMotion();
			const [btnHover, setBtnHover] = (0, react.useState)(false);
			// 悬停暂停 = 把 useCycle 的 paused 打开（不排下一拍），而不是暂停 CSS 动画：
			// 翻页动画是一次性的 0.42s，暂停它只会把画面冻在半路；这里要停的是"切内容"的节拍。
			// ⚠️ 翻页方向用的是 useCycleSteps 的 **seq（单调切换序）**，不是 shownStep：
			//    方向规则按"第几次切换"四步一循环（up,down,down,up），与"回卷到第几格"无关。
			//    这里若改用 `stepAt(shownStep).dir`，序列每回卷到格 0 就会取到 tickerDirAt(0) 的
			//    挂载兜底 down ⇒ 四步循环每轮回卷都丢一次相位（用户报的「一直是 is-down」就是这个：
			//    n=2 时 4 格一轮，第 4 次切换本该 up、实际渲染 down，看起来像"连着三次都是往下"）。
			const tickerCycle = useCycleSteps(tickerSteps.length, TICKER_SLIDE_SECS,
				tickerSlides.length === 0 || reduceMotion || btnHover);
			const slideStep = tickerCycle.step;
			// reduce 时**不滚动**、但也不回到"看起来没事"的原样：静态钉在第一条轮播条目（展开后的第 1 格）
			// （用户要求"仍要能看出有事"）。没有轮播条目时自然是第 0 格 = 原按钮外观。
			const shownStep = reduceMotion && tickerSlides.length > 0 ? 1 : slideStep;
			// 这一帧的翻页方向（**类名 = 视觉方向**，见 70-styles.js 的 keyframes 注释）。
			// reduce 时钉在第 1 格，方向取 tickerDirAt(1)（反正 CSS 那边 animation:none，不会播）。
			const flipDir = tickerDirAt(reduceMotion && tickerSlides.length > 0 ? 1 : tickerCycle.seq);
			// 上一格的内容要**留在 DOM 里**才能做出"交叉滚动"（旧的往上走、新的从下面进来）。
			// 用 ref 记上一次渲染的格号：格号变了的那一次渲染里 prevStep = 旧格号，effect 之后再对齐。
			// （若改成"渲染时直接改 ref"，React 严格模式下可能被重复执行；effect 版本最稳。）
			const prevStepRef = (0, react.useRef)(shownStep);
			const prevStep = prevStepRef.current === shownStep ? shownStep : prevStepRef.current;
			(0, react.useEffect)(() => { prevStepRef.current = shownStep; }, [shownStep]);
			// 原按钮的日历图标（16px，与 .gacha-cal-btn svg 的规则一致）。C 方案里它只在
			// **状态 0 那一格**出现（跟着翻页走），所以抽成变量给 tickerLine 用。
			const calIcon = (0, react_jsx_runtime.jsx)("svg", { "aria-hidden": "true", width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }),
					(0, react_jsx_runtime.jsx)("line", { x1: "16", y1: "2", x2: "16", y2: "6" }),
					(0, react_jsx_runtime.jsx)("line", { x1: "8", y1: "2", x2: "8", y2: "6" }),
					(0, react_jsx_runtime.jsx)("line", { x1: "3", y1: "10", x2: "21", y2: "10" })
				]
			}) });
			// 展开序列里第 step 格的内容（越界 / 条目数变了以后残留的旧格号一律按"原按钮"处理：
			// prevStep 是**上一次渲染**的格号，节拍刚跳完那一拍它可能已经不在这份序列里，不能抛）。
			const stepAt = (step) => tickerSteps[step] || { idx: 0, idle: true, slideIndex: -1, dir: "down" };
			// 一格的内容：idle = 原按钮外观（日历图标 + 「二游日历」），其余 = 一条轮播条目（游戏图标 + 事项名 + 状态）。
			// **图标也在这一行里** —— 它跟整行一起翻（C 方案），所以不参与按钮的固定布局。
			// 名字与状态**分开两个盒子**：名字可省略号截断、状态 flex:none 永不截断 ——
			// 窄侧栏里必须留下「· 3 小时 / · 明天开池 / · 24 天」。
			// 分隔符带**前导空格**（" · "）：上一版只写了 "· "，渲染出来是「少女· 3 小时」，少一个空格
			// （用户 2026-10-25 指出）。.gacha-cal-btn-st 的 white-space:pre 保证这个空格不被折叠掉。
			// slot 只用于 React 的 key（同一个 flip 层里两行：cur / prev）。
			const tickerLine = (idx, slot) => {
				const at = stepAt(idx);
				const slide = at.slideIndex >= 0 ? tickerSlides[at.slideIndex] : null;
				const icon = slide
					? (0, react_jsx_runtime.jsx)(GameIcon, { icon: slide.gameIcon, name: slide.gameName || slide.itemName, size: 16 })
					: calIcon;
				return (0, react_jsx_runtime.jsxs)("span", {
					key: slot,
					className: "gacha-cal-btn-line",
					children: [
						(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-btn-ic", children: icon }),
						slide
							? (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-btn-nm", children: slide.itemName })
							: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-btn-lbl", children: label }),
						slide
							? (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-btn-st", children: " \u00B7 " + slide.statusText })
							: null
					]
				});
			};
			// 翻页层的**两行顺序 / 落定**都交给 TickerFlipLines 组件（上面的注释块）：
			//   行顺序随方向换（up ⇒ [prev, cur]、down ⇒ [cur, prev]），动画播完落定成只含 cur 的一行。
			// 父层只负责把这一拍的方向 / 格号 / reduce 传下去 —— 纯函数在 60-helpers.js，
			// 组件在 CalendarPanel 之前，落定 state 由 `key={shownStep}` 在换格时重置。

			// 在途锁用 ref 而不是 state：state 更新是异步的，"自动刷新与手动点击落在同一 tick"时
			// 两次调用可能都看到 refreshing=false 而并发跑两轮（请求翻倍，且慢的那轮会用更旧的数据盖掉新的）
			const refreshLock = (0, react.useRef)(false);
			// 启动自动刷新的"一次提示"（如"插件已更新"）与"同挂载只试一次"闸（防断网时无限重刷）
			const autoNoteRef = (0, react.useRef)("");
			const startupGuardRef = (0, react.useRef)("");
			// ⚠️ 最新设置的 ref —— `doRefresh` **必须**通过它读设置，不能直接闭包读 `s`。
			//
			// 为什么：`s`（见上面 `const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) }`）
			// **每次渲染都是新对象**，而 `doRefresh` 被 `useCallback` 记忆化在 `[scope, engine]` 上
			// —— 于是它闭包里那个 `s` 会**永远停在首次渲染那一刻**。
			// 症状（2026-10-03 用户报「面板显示 23 条条目，计数只有 22」）：
			//   · 渲染那一条路用的是**当次** `s`（`getVisibleEntries(s)` → 23 行）✓
			//   · `doRefresh` 里算顶部计数用的是**冻结**的 `s`（→ 只数到 22）✗
			//   挂载后才勾选的条目会被**整个漏出报告**：既不计入分母，失败时也不会出现在明细里。
			//
			// 为什么不能简单地把 `s` 加进 `useCallback` 依赖：那样 `doRefresh` 每次渲染都换身份，
			// 而下面两个 effect（依赖里带 `doRefresh`）会**每次渲染都重跑** —— 定时刷新那个
			// effect 每次都会 clear 再 setTimeout，递归计时器被反复重置（渲染频繁时可能永不触发）。
			// 用 ref 读最新值，`doRefresh` 的身份保持不变，两边都满足。
			const sRef = (0, react.useRef)(s);
			sRef.current = s;
			const doRefresh = (0, react.useCallback)(async () => {
				if (refreshLock.current) return;
				refreshLock.current = true;
				setRefreshing(true);
				try {
					// 抓取/解析/合并/写缓存全部交给 core 引擎（面板不再自己编排）
					const result = await engine.refresh();
					// 顶部提示：只读 Result JSON（按游戏顺序取 name，交给共用提示函数分类）。
					// ⚠️ **必须只统计"选中展示"的条目**：`result.games` 里含隐藏条目 ——
					// 引擎为了"取消隐藏立刻有数据"会保留隐藏条目的旧缓存记录（含旧失败原因，如 HTTP 404）。
					// 若把全部条目交给 buildScrapeInfo，就会出现：
					//   · `成功 N/M` 的 M 偏大（把隐藏条目算进分母，而它们本轮根本没抓）
					//   · 失败分类与悬停明细里列出**隐藏条目**的旧失败 —— 用户看到的"没生效"就是这个。
					// ⚠️ 用 `sRef.current`（最新设置），**不能**用闭包里的 `s`：后者被 useCallback
					// 冻结在首次渲染那一刻 → 挂载后才勾选的条目不计入分母、失败也不进明细。
					// 详见 sRef 声明处的注释。
					const visibleIds = new Set(getVisibleEntries(sRef.current).map((g) => g.id));
					const games = Object.entries(result.games)
						.filter(([id]) => visibleIds.has(id))
						.map(([id, g]) => ({ id, name: g.name || id }));
					const { info, lines } = buildScrapeInfo(games, result);
					// 自动刷新时说明原因（只消费一次）："成功 N/M …（插件已更新，已自动刷新）"
					const note = autoNoteRef.current;
					autoNoteRef.current = "";
					setScrapeInfo(note ? `${info}\uFF08${note}\uFF0C\u5DF2\u81EA\u52A8\u5237\u65B0\uFF09` : info);
					setScrapeLines(lines);
					// 引擎已把 lastData/lastRefresh/lastSource 写进 settings，刷新快照即可重渲染
					setSnapshot(scope.getSnapshot());
				} catch (err) {
					// 刷新失败必须说出来：否则顶部还挂着上一次的"成功 N/M"，看起来像是刷新成功了
					const msg = String((err && err.message) || err || "未知错误");
					setScrapeInfo("\u5237\u65B0\u5931\u8D25\uFF1A" + msg);
					setScrapeLines([msg]);
				} finally {
					refreshLock.current = false;
					setRefreshing(false);
				}
			}, [scope, engine]);

			// 定时自动刷新（按设置频率）。
			// 注意：setTimeout/setInterval 的 delay 上限为 2^31-1 ms（约 24.86 天），
			// 42 天选项会溢出并变成 1ms 疯狂触发，故用"目标时间 + 递归 setTimeout"实现精确周期。
			(0, react.useEffect)(() => {
				if (!(s.autoRefresh ?? DEFAULT_SETTINGS.autoRefresh)) return;
				const minutes = Number(s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes);
				if (!Number.isFinite(minutes) || minutes <= 0) return;
				const MAX_DELAY = 2147483647;
				const intervalMs = minutes * 60 * 1000;
				let disposed = false;
				let timer = 0;
				// 锚点＝**上次成功刷新的时刻**，而不是"本次挂载时刻"：否则重启就把计时清零，
				// 设置成 7 天等于"连续开机 7 天"才刷一次（谁也不会一直不关电脑）。
				// 0 / 非法 / 未来时间戳（时钟回拨）都退回挂载时刻，避免刚启动就疯狂刷。
				const anchorAt = Number(s.lastRefresh) || 0;
				let last = anchorAt > 0 && anchorAt <= Date.now() ? anchorAt : Date.now();
				const tick = () => {
					if (disposed) return;
					const now = Date.now();
					if (now - last >= intervalMs) {
						last = now;
						doRefresh();
					}
					timer = window.setTimeout(tick, Math.min(Math.max(last + intervalMs - Date.now(), 1000), MAX_DELAY));
				};
				timer = window.setTimeout(tick, 1000);
				return () => {
					disposed = true;
					window.clearTimeout(timer);
				};
			}, [s.autoRefresh, s.refreshMinutes, s.lastRefresh, doRefresh]);

			// 启动时判定一次"要不要自动刷新"（定时器管不到的场景：插件更新、首次安装、重启后已过间隔）。
			// 版本变化与首次安装是**强制**的（不看自动刷新开关）——见 autoRefreshPlan 的注释。
			// 三个防坑点：
			//  ① 等设置真的送到（快照非空）再判，否则"还没加载"会被当成"首次安装"而多刷一轮；
			//  ② 同一次挂载对同一 (版本|原因) 只尝试一次——refresh 失败也会写 lastRefresh，
			//     依赖里带着它会让 effect 重跑 → 变成断网时无限重刷；
			//  ③ 提示只消费一次（autoNoteRef），不常驻。
			(0, react.useEffect)(() => {
				if (!snapshot.value || Object.keys(snapshot.value).length === 0) return;
				const plan = autoRefreshPlan({
					autoRefresh: s.autoRefresh ?? DEFAULT_SETTINGS.autoRefresh,
					refreshMinutes: s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes,
					lastRefresh: s.lastRefresh,
					lastVersion: s.lastVersion,
					pluginVersion: PLUGIN_VERSION,
					now: Date.now()
				});
				if (!plan.due) return;
				const key = `${PLUGIN_VERSION}|${plan.reason}`;
				if (startupGuardRef.current === key) return;
				startupGuardRef.current = key;
				autoNoteRef.current = plan.reason;
				doRefresh();
			}, [snapshot, s.autoRefresh, s.refreshMinutes, s.lastRefresh, s.lastVersion, doRefresh]);

			// 锚定面板到 trigger 上方
			(0, react.useLayoutEffect)(() => {
				if (!open) return;
				const place = () => {
					const rect = triggerRef.current?.getBoundingClientRect();
					if (rect !== void 0) setAnchor({ left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 8 });
				};
				place();
				window.addEventListener("resize", place);
				return () => window.removeEventListener("resize", place);
			}, [open]);

			// 点击 dismiss：仅当点击既不在 trigger 也不在 pop 内部时关闭（修复弹层内按钮点不到的问题）
			(0, react.useEffect)(() => {
				if (!open) return;
				const onDown = (e) => {
					const t = e.target;
					if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
					setOpen(false);
				};
				document.addEventListener("pointerdown", onDown);
				return () => document.removeEventListener("pointerdown", onDown);
			}, [open]);

			const lastRefreshText = s.lastRefresh ? new Date(s.lastRefresh).toLocaleString() : "\u2014";
			const dataStatus = s.lastSource === "web" ? "\u8054\u7F51\u6570\u636E" : "\u2014";
			const label = SETTINGS_SECTION_LABEL;
			// 按钮的悬停/读屏文案：既要能读出"有几项"，也不能只说一个数字（读屏用户看不见动画）。
			// 2026-10-25 晚起轮播是**双向**的，所以措辞从"N 小时内到期"改成"N 小时内 N 项"；
			// 每条带上方向与剩余时间 —— 直接复用轮播那一份文案（tickerSlidesOf 的 ariaText），
			// 保证两处不会说两套话。
			// ⚠️ 这里用 ariaText 而**不是** text：按钮上为了省宽度去掉了「还剩」（"· 8 小时"），
			//    但读屏/悬停是句子，必须有「还剩」才通顺（"…，还剩 8 小时"）—— 两处唯一的差别就是这个词。
			// 名称最多列 3 条 —— 侧栏这个悬停是个窄提示，不是面板。
			// C 方案起文字只写**事项名**（游戏名让位给图标），悬停这里补一句"哪款游戏"，
			// 否则读屏用户听到一串活动名却不知道属于谁。
			const tickerHintNames = tickerSlides.slice(0, 3).map((x) =>
				(x.gameName && x.gameName !== x.itemName ? x.gameName + "\uFF1A" : "") + x.ariaText);
			const tickerHint = tickerItems.length
				? tickerHours + " \u5C0F\u65F6\u5185 " + tickerItems.length + " \u9879\u65E5\u7A0B" +
					(tickerHintNames.length ? "\uFF1A" + tickerHintNames.join("\u3001") +
						(tickerItems.length > tickerHintNames.length ? " \u7B49" : "") : "")
				: "";

			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)("button", {
						ref: triggerRef,
						type: "button",
						className: "gacha-cal-btn",
						"aria-label": tickerItems.length ? label + "\uFF08" + tickerHint + "\uFF09" : label,
						// 悬停说明挂在**按钮**上：红点（窄侧栏降级）带 pointer-events:none 不参与命中测试，
						// 把 title 放在它身上等于永远不显示。没有轮播项时不加 title（保持按钮原样）。
						title: tickerItems.length ? tickerHint : void 0,
						// 悬停**暂停轮播**（用户要求）：只停"切内容"的节拍，不冻结正在播的翻页动画
						// （那是一次性 0.42s，冻在半路更难看）。见上面 useCycle 的 paused 参数。
						onMouseEnter: () => setBtnHover(true),
						onMouseLeave: () => setBtnHover(false),
						onClick: () => setOpen((v) => !v),
						children: [
							// 日历图标只在「没有轮播」时固定在按钮上（与历史外观一字不差）；
							// 有轮播时图标属于轮播那一行（C 方案：图标跟着整行翻），由 tickerLine 渲染。
							(wide === false || tickerSlides.length === 0) ? calIcon : null,
							// 窄侧栏（收起状态）：**没有可滚动的那一行** ⇒ 用户允许的降级 = 小红点。
							// 红点绝对定位、不参与 flex 布局 ⇒ 按钮尺寸/文字位置一个字都不动
							// （用户 2026-10-25 明确要求别再重演"按钮错位"）。总开关关掉（tickerOn=false）
							// 时 tickerItems 恒空 ⇒ 这里也不出红点。
							wide === false
								? (tickerItems.length
									? (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-dot", "aria-hidden": "true" })
									: null)
								// 宽侧栏：有轮播条目 → 单行翻页（展开序列 = [原按钮, 条目1, 原按钮, 条目2, …]，
								// 「原按钮外观」每两条之间都会回来一次）；没有 → **一字未改的原样**
								// （图标 + 一个 span），零风险。
								: (tickerSlides.length
									? (0, react_jsx_runtime.jsx)("span", {
										className: "gacha-cal-btn-txt",
										children: (0, react_jsx_runtime.jsx)(TickerFlipLines, {
											// key = 格号：每换一格，翻页层**整体重挂载** ⇒
											// `flipSettled` 回到 false（下一拍仍有完整两行 + 从头播的动画）。
											// 这就是"每次换格重置"的实现 —— 不用 useEffect（理由见组件处注释）。
											key: shownStep,
											// 翻页方向（2026-10-25 四次定稿）：**类名 = 视觉方向** ——
											// .is-up = 新内容从下方进（旧的往上走）；
											// .is-down = 新内容从上方进（旧的往下走）。
											// 方向来自纯函数 tickerDirAt(单调切换序)，按"第几次切换"四步一循环
											// （up,down,down,up），渲染层只做"类名映射"，不自己数奇偶；
											// **不要**从 shownStep 反推（回卷到格 0 会丢相位，见 flipDir 处注释）。
											flipDir,
											shownStep,
											prevStep,
											reduceMotion,
											// 每行的内容由父层的 tickerLine 渲染（它闭包着本帧的 tickerSlides / calIcon）。
											renderLine: tickerLine
										})
									})
									: (0, react_jsx_runtime.jsx)("span", { children: label }))
						]
					}),
					open && anchor !== void 0 ? (0, react_jsx_runtime.jsx)("div", {
						ref: (el) => {
							popRef.current = el;
							if (!el) return;
							// F4：与上面 effect 同一个判定 —— 量高写 inline height 只服务新面板；
							// 旧面板（.gacha-cal-pop，max-height:72vh）必须回到"没有任何 inline height"的原状。
							if (s.newPanel !== true) { el.style.removeProperty("height"); return; }
							// 为什么不用 useEffect：本插件环境里 effect 未执行（实测 inline style 始终只有 left/bottom，
							// 高度写不进去、面板就按内容撑到 2699）。ref 回调由 React 保证在挂载时调用，最稳。
							const fit = () => {
								const inner = el.firstElementChild;
								let content;
								if (inner && inner.children.length) {
									const kids = Array.prototype.slice.call(inner.children);
									const first = kids[0].getBoundingClientRect();
									const last = kids[kids.length - 1].getBoundingClientRect();
									const cs = window.getComputedStyle(inner);
									content = (last.bottom - first.top) + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + 2;
								} else {
									content = el.scrollHeight;
								}
								const avail = Math.round(window.innerHeight - (anchor && typeof anchor.bottom === "number" ? anchor.bottom : 0) - 8);
								const cap = avail > 160 ? avail : Math.round(window.innerHeight * 0.72);
								el.style.setProperty("height", Math.round(content > cap ? cap : content) + "px", "important");
							};
							fit();
							window.requestAnimationFrame(fit);
							window.setTimeout(fit, 300);
						},
						// 新版要"撑满 + 不裁切"，旧版要"限高 + 滚动" —— 靠这个修饰类分开（见 70-styles.js）
						className: s.newPanel === true ? "gacha-cal-pop gacha-cal-pop--sched" : "gacha-cal-pop",
						style: { left: anchor.left, bottom: anchor.bottom },
						// ⚙️ 实验特性分支 —— **唯一**的切换点。
						//    `s.newPanel === true` 才走新日程视图；否则 children 就是下面那个
						//    **一字未改的原数组**（旧的标题 + meta + 表头 + games 表格）。
						//    默认关 → 旧面板 DOM 与行为零变化，这是回退路径。
						children: s.newPanel === true
							? (0, react_jsx_runtime.jsx)(ScheduleView, {
								games, now, s, colorMap: colorOverrides, refreshing, onRefresh: doRefresh,
								lastRefreshText, scrapeInfo: bannerInfo, scrapeLines: bannerLines
							})
							: [
							(0, react_jsx_runtime.jsx)("p", { className: "gacha-cal-title", children: SETTINGS_SECTION_LABEL }),
							(0, react_jsx_runtime.jsxs)("p", { className: "gacha-cal-meta", children: [
								(0, react_jsx_runtime.jsx)("span", { children: "\u6570\u636E\uFF1A" + dataStatus }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5237\u65B0\uFF1A" + lastRefreshText }),
								// 刷新按钮（SVG 图标：循环箭头）
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gacha-cal-refresh",
									disabled: refreshing,
									title: refreshing ? "\u5237\u65B0\u4E2D..." : "\u5237\u65B0",
									"aria-label": refreshing ? "\u5237\u65B0\u4E2D..." : "\u5237\u65B0",
									onClick: doRefresh,
									children: (0, react_jsx_runtime.jsx)("svg", {
										className: refreshing ? "gacha-cal-spin" : "",
										width: "13",
										height: "13",
										viewBox: "0 0 24 24",
										fill: "none",
										stroke: "currentColor",
										strokeWidth: "2.2",
										strokeLinecap: "round",
										strokeLinejoin: "round",
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [
												(0, react_jsx_runtime.jsx)("path", { d: "M21 12a9 9 0 1 1-2.64-6.36L21 8" }),
												(0, react_jsx_runtime.jsx)("polyline", { points: "21 3 21 8 16 8" })
											]
										})
									})
								}),
								// 设置按钮：打开 DSH 设置面板并切到本插件的设置页，同时关闭本面板。
								// **当前按用户要求临时隐藏**（SETTINGS_BUTTON_VISIBLE = false）；
								// 下面这段逻辑与说明全部保留，改回 true 即可恢复。
								// 为什么这么绕：DSH 没给插件"跳转设置页"的官方 API——面板是 modal，open/activeId 都是组件
								// 私有 state（dsh-client-ui-settings-general 的 SettingsRoot），打开后按 rows[0] 兜底，也就是停在
								// 导航第一项「通用」；插件拿不到 openSection。只能点侧边栏那个设置触发器（aria-haspopup="dialog"
								// 是它的契约属性：全客户端带这个属性的有 6 个 dialog 类 + 12 个 menu/listbox/tree，所以按
								// "可见 + 无障碍名匹配 设置/Settings" 挑，挑不到才退回第一个），再交给 openPluginSettingsSection
								// 等面板挂载后按导航名切到本插件那一节。
								SETTINGS_BUTTON_VISIBLE && (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gacha-cal-refresh",
									title: "\u8BBE\u7F6E",
									"aria-label": "\u8BBE\u7F6E",
									onClick: () => {
										setOpen(false);
										openPluginSettingsSection();
									},
									children: (0, react_jsx_runtime.jsx)("svg", {
										width: "13",
										height: "13",
										viewBox: "0 0 24 24",
										fill: "none",
										stroke: "currentColor",
										strokeWidth: "2",
										strokeLinecap: "round",
										strokeLinejoin: "round",
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [
												(0, react_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "3" }),
												(0, react_jsx_runtime.jsx)("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" })
											]
										})
									})
								}),
								// 抓取提示：放在设置按钮右边（行内只给分类，悬停分行看原因）
								scrapeInfo ? (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-scrape", title: scrapeLines.join("\n"), children: scrapeInfo }) : null
							] }),
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-h", children: [
								(0, react_jsx_runtime.jsx)("span", {}),
								(0, react_jsx_runtime.jsx)("span", { children: "\u6E38\u620F" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5F53\u524D\u5361\u6C60" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5361\u6C60\u8D77\u6B62" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5F53\u524D\u6D3B\u52A8" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u6D3B\u52A8\u8D77\u6B62" })
							] }),
							games.map((g) => {
								// 卡池列：外显纯角色名（cleanRoleNames 去称号·前缀/属性后缀；蔚蓝档案三服保留括号换装后缀；
								// 无角色名时显示卡池名），悬停弹出卡池全名+角色；无数据时显示占位符 "—"
								const gachaVisible = g.roles ? cleanRoleNames(g.roles, g.id) : (g.banner || "—");
								const gachaTitle = (g.roles ? `${g.banner}\uFF1A${g.roles}` : (g.banner || "")) + (g.bannerDates ? `\n${g.bannerDatesRaw || g.bannerDates}` : "");
								// 活动列：外显活动名称，悬停弹出活动全名+起止（起止显示源站原文）；无数据时显示 "—"
								const eventName = g.event || "—";
								const eventTitle = g.event
									? (g.eventDates ? `${g.event}\n${g.eventDatesRaw || g.eventDates}` : g.event)
									: (g.eventDatesRaw || g.eventDates || "");
								// 该列本次没拿到新内容（失败/未命中）时，把它补进悬停：
								// 括号包住；若该列显示的是沿回的旧值，则另起一行补在旧内容下面
								const withFailNote = (base, side, fail, stale, userSupplied) => {
									const text = sideFailText(side, fail, { userSupplied });
									const note = text ? "（" + text + "）" : "";
									if (!note) return base || "";
									return stale && base ? base + "\n" + note : note;
								};
								// 该侧地址是否由用户自己填（自定义条目 / 自定义网址）：是的话"未命中"多半意味着
								// "你填的这个地址读不出内容"，文案换一句更贴切的（状态仍是"未公布"，不改三态语义）
								const gachaUser = !!g.custom || isCustomSource(s, g.id);
								const eventUser = !!g.custom || isCustomSource(s, g.id, "eventUrl");
								// 游戏名/图标悬停：这行数据的"上次成功"时间（+ 哪列沿用了旧数据）
								const rowTitle = buildRowTitle(g);
								return (0, react_jsx_runtime.jsxs)("div", {
									className: "gacha-cal-row",
									key: g.id,
									title: rowTitle,
									children: [
										(0, react_jsx_runtime.jsx)(GameIcon, { icon: g.icon, name: g.name }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name", title: rowTitle, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.bannerHover || gachaTitle, "gacha", g.gachaFail, g.gachaStale, gachaUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: gachaVisible }) }),
										// 起止列：**外显按本机时区换算**（localDatesOf）；悬停显示源站原文（如"4.5版本更新后 ~ …"）
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.bannerDatesRaw || g.bannerDates, "gacha", g.gachaFail, g.gachaStale, gachaUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: (0, react_jsx_runtime.jsx)("b", { children: displayTimeCell(localDatesOf(g, true, now) || g.bannerDates || "", now) }) }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.eventHover || eventTitle, "event", g.eventFail, g.eventStale, eventUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: eventName }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.eventDatesRaw || g.eventDates, "event", g.eventFail, g.eventStale, eventUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: displayTimeCell(localDatesOf(g, false, now) || g.eventDates || "", now) }) })
									]
								});
							})
						]
					}) : null
				]
			});
		}

		// ── 通知身份（可选）：宿主路由 /api/gacha-calendar-notify-identity ──────────────────────
		// GET = 读状态（是否已启用 + 快捷方式路径 + 预留的图标路径）；POST { enabled } = 建 / 删开始菜单
		// 快捷方式。⚠️ 每次调用宿主都要起一次 PowerShell 去读写 .lnk（0.3~1s），所以只在设置页挂载时读
		// 一次、点完再读一次，不做轮询。失败原因原样显示在按钮下面那行小字里（不弹窗）。
		const NOTIFY_IDENTITY_API = "/api/gacha-calendar-notify-identity";
		// 宿主错误码 → 人话；认不出来就原样显示（不吞掉 —— 用户要能看出到底为什么失败）
		const notifyIdentityErrorText = (code) => {
			const text = String(code || "").trim();
			if (text === "windows-only") return "仅 Windows 可用";
			if (text === "loopback-only") return "只能在本机 DSH 里操作";
			if (text === "cross-site-not-allowed") return "跨站请求被拒绝";
			if (text === "payload-too-large") return "请求内容过大";
			if (text === "invalid-json" || text === "enabled-must-be-boolean") return "请求格式不对";
			// 改名时目标位置已经有一条**不属于本插件**的同名快捷方式：宿主拒绝覆盖（见启用脚本 ①）
			if (text === "shortcut-name-taken") return "这个名字已被开始菜单里另一条快捷方式占用，换个名字";
			return text || "未知错误";
		};
		async function readNotifyIdentity() {
			const res = await fetch(NOTIFY_IDENTITY_API, { headers: { Accept: "application/json" } });
			if (!res.ok) throw new Error("HTTP " + res.status);
			const body = await res.json();
			if (!body || typeof body.enabled !== "boolean") throw new Error("返回格式不对");
			return body;
		}
		// 宿主回的 { enabled, name } → 设置页本地状态。name 一律再过一遍 notifyNameOf（默认「二游日历」）：
		// 宿主已经清洗过，这里只是防御 —— 名字会显示给用户，不能出现空串 / undefined。
		const notifyIdentityOfBody = (body) => ({
			enabled: !!(body && body.enabled === true),
			name: notifyNameOf(body && body.name)
		});
		async function writeNotifyIdentity(enabled, name) {
			const res = await fetch(NOTIFY_IDENTITY_API, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				// name 每次都带：启用时宿主要拿它给快捷方式起名 / 写 DisplayName；
				// 已启用状态下改名（enabled=true + 新 name）时宿主会**先删旧 .lnk 再按新名字重建**。
				body: JSON.stringify({ enabled: enabled === true, name: notifyNameOf(name) })
			});
			let body = null;
			try { body = await res.json(); } catch { body = null; }
			if (!body || body.ok !== true) {
				throw new Error(notifyIdentityErrorText(body && body.error) || ("HTTP " + res.status));
			}
			return body;
		}

		// ── 「发送测试通知」：宿主路由 /api/gacha-calendar-notify-test ─────────────────────────
		// 点一下立刻弹一条系统通知（发送者 = 上面那一行当前身份），用来确认通知链路通不通。
		// 只发一次、不轮询；失败原因复用上面那份错误码 → 人话的映射（同一套宿主错误码）。
		const NOTIFY_TEST_API = "/api/gacha-calendar-notify-test";
		async function sendNotifyTest() {
			const res = await fetch(NOTIFY_TEST_API, { method: "POST" });
			let body = null;
			try { body = await res.json(); } catch { body = null; }
			if (!body || body.ok !== true) throw new Error(String((body && body.error) || ("HTTP " + res.status)));
			return body;
		}

		// engine：core 引擎（设置页的「解析器自检」用它跑 selfCheck()）
		function CalendarSettingsPage({ scope, engine }) {
			// 设置表单服务本体（用于在写不进去时列出宿主真正 serve 的 namespace，见 formStateText）
			const ctxConfigForms = scope && scope.configForms ? scope.configForms : null;
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			const [adding, setAdding] = (0, react.useState)(false);
			// 添加表单临时值（名称/图标手动填；卡池与活动内容由链接解析产出）
			const [form, setForm] = (0, react.useState)({ name: "", icon: "", url: "", eventUrl: "", color: "" });
			// 取色器的**本地草稿**（{ id: "#rrggbb" }）：写入是异步的，而 `s`（设置快照）在本次会话里
			// 不会即时推新 ⇒ 受控 input 会立刻用旧值重渲染 ⇒ 用户看到"调完自己变回去"（2026-10-16 反馈）。
			// 用草稿值显示即可消除该现象；落盘仍走 setGameColor → commit（实测 store 里是对的）。
			const [colorDraft, setColorDraft] = (0, react.useState)({});
			// 「展示」复选框的本地草稿（{ id: boolean }）：同样的原因 —— 受控 checked 读 `s`，
			// 而 `s` 在本次会话里不即时推新 ⇒ 点一下立刻被旧值覆盖回去（用户看到的"完全点不了"）。
			const [showDraft, setShowDraft] = (0, react.useState)({});
			// 「展示」写入的**串行链**（见下面 setEntryShown）：连点时后一笔等前一笔落盘后再算，
			// 保证终态 = 最后一次点击的目标状态，而不是两笔写入互相覆盖（宿主往返 1.4~3.6s）。
			const showWriteChain = (0, react.useRef)(Promise.resolve());
			// 「提醒」复选框的本地草稿与串行链（与「展示」同一套理由：写入往返期间受控值会读旧 `s`）。
			const [remindDraft, setRemindDraft] = (0, react.useState)({});
			const remindWriteChain = (0, react.useRef)(Promise.resolve());
			// 「到期提醒」两行**胶囊**的本地草稿（{ end, start }，null = 跟随已保存的设置值）。
			// 受控值读草稿而不读 `s`：宿主一次写入往返 1.4~3.6s，`s` 不会即时推新 ——
			// 直接读 `s` 会把用户刚点的那一下吞掉（与上面「展示」草稿同一个病）。
			const [remindNodesDraft, setRemindNodesDraft] = (0, react.useState)({ end: null, start: null });
			const [customInputs, setCustomInputs] = (0, react.useState)({});
			const [eventCustomInputs, setEventCustomInputs] = (0, react.useState)({});
			// 解析器自检（只读）：运行中标记 + 上一次的报告
			const [selfChecking, setSelfChecking] = (0, react.useState)(false);
			const [selfReport, setSelfReport] = (0, react.useState)(null);
			// 逐个来源跑一遍，报告「解析出 0 条 / 抓取报错」；不改动设置与缓存
			const runSelfCheck = async () => {
				if (selfChecking) return;
				setSelfChecking(true);
				try {
					const started = Date.now();
					const report = await engine.selfCheck();
					setSelfReport({ ...report, elapsedMs: Date.now() - started });
				} catch (err) {
					setSelfReport({ error: String((err && err.message) || err) });
				} finally {
					setSelfChecking(false);
				}
			};
			// 数据源 = 宿主 configForms 表单的**订阅**（T1）。scope 就是 dsh-client-ui-settings 的
			// ConfigFormController：getSnapshot / subscribe / set / unset / mutate 都在它上面，
			// 而 subscribe 挂在它的 snapshot store 上，写入成功会经
			// mutate → mirror.acceptView → derive → store.set 同步通知到我们（源码证据见报告 T1）。
			// ⇒ 不再需要"每次 commit 里手写重读快照"：那是同一个 store 的另一种读法，
			//    却要在每次写入后多渲染一次整页（拖色时每帧一次），而且只能覆盖本组件发起的写入。
			// 订阅时补读一次，覆盖"首次渲染 → effect 订阅"之间可能落下的一次变更
			//（快照引用未变时 React 直接跳过，不会多一次渲染）。
			(0, react.useEffect)(() => {
				setSnapshot(scope.getSnapshot());
				return scope.subscribe(() => setSnapshot(scope.getSnapshot()));
			}, [scope]);
			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };
			// 表单可用性（写不进去时在页面上如实说明，见下面渲染处）。
			// 文案与 formRejectHint 同源：只解释"为什么写不了"，不猜。
			const formReady = snapshot.status === "ready" && snapshot.mode !== "memory";
			const formStateText = snapshot.mode === "memory"
				? "本次连接不是本机，宿主不接受写入"
				: snapshot.status === "loading"
					? "配置表单还没送到，请稍后重试"
					: snapshot.status === "unavailable"
						? "宿主未 serve 条目「" + (scope.entryId || "?") + "」" + servedNamespacesText(ctxConfigForms)
						: "宿主拒绝了写入（表单状态 " + String(snapshot.status) + "）";

			const allEntries = getAllEntries(s);
			const hidden = Array.isArray(s.hidden) ? s.hidden : [];
			const shown = Array.isArray(s.shown) ? s.shown : [];
			const removed = Array.isArray(s.removed) ? s.removed : [];
			const urls = parseJsonStr(s.customUrls, {});
			const customs = parseJsonStr(s.customEntries, []);

			const order = Array.isArray(s.order) && s.order.length > 0 ? s.order : allEntries.map((x) => x.id);
			const sorted = applyOrder(allEntries, order);
			const currentMinutes = Number(s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes);
			// 旧配置可能存了分钟值（不在按天选项里），额外补一个"自定义"选项避免 select 空白
			const inOptions = REFRESH_OPTIONS.some((o) => o.minutes === currentMinutes);
			// 按钮轮播的两个控件：开关 tickerOn（默认开）+ 范围 tickerHours（提前多久算"要来了"）。
			// 老配置残留的 0 由 tickerRangeOf 归一到 72，下拉里不会冒出「自定义（0 小时）」。
			const currentTicker = tickerRangeOf(s.tickerHours);
			const tickerInOptions = TICKER_OPTIONS.some((o) => o.hours === currentTicker);
			// 总开关的当前值：缺省 = 开（与 DEFAULT_SETTINGS / schema 的 default(true) 同口径，
			// 判定走 helpers 的 tickerOnOf，与侧栏按钮那一侧共用同一处口径）
			const tickerOn = tickerOnOf(s.tickerOn);
			// 「到期提醒（送达）」总开关：同样"只有明确 false 才算关"（65-remind.js 的 remindOnOf）。
			const remindOn = remindOnOf(s.remindOn);
			// 通知身份（可选）的本地状态：null = 还在读；{ enabled, name } = 宿主给的真相。
			// 只影响通知横幅顶部的应用名，与「提醒」开关无关（关掉身份也照样弹，名字退回 PowerShell）。
			const [notifyIdentity, setNotifyIdentity] = (0, react.useState)(null);
			const [notifyIdentityBusy, setNotifyIdentityBusy] = (0, react.useState)(false);
			const [notifyIdentityError, setNotifyIdentityError] = (0, react.useState)("");
			// 应用名（`notifyName`）输入框的**本地草稿**：null = 跟随已保存的设置值。
			// 受控值读草稿而不是读 `s`：宿主一次写入往返 1.4~3.6s，`s` 不会即时推新 —— 直接读 `s`
			// 会在用户打字期间把内容顶回去（与上面「展示」「提醒」的草稿同一个病）。
			const [notifyNameDraft, setNotifyNameDraft] = (0, react.useState)(null);
			const notifyNameSaved = notifyNameOf(s.notifyName);
			const notifyNameShown = notifyNameDraft === null ? notifyNameSaved : notifyNameDraft;
			// 挂载时读一次（不轮询）。宿主的 GET 先读 identity.json（毫秒级），只有首次 / 没有缓存时
			// 才走一次 PowerShell 探测（~1 秒，这时才会短暂显示「读取中…」）。读失败按"未启用"显示 +
			// 小字说明原因，不挡住页面其它部分 —— 身份只是一个 App 名，坏了不该让设置页变红。
			(0, react.useEffect)(() => {
				let alive = true;
				readNotifyIdentity()
					.then((body) => { if (alive) setNotifyIdentity(notifyIdentityOfBody(body)); })
					.catch((err) => {
						if (!alive) return;
						setNotifyIdentity({ enabled: false, name: notifyNameSaved });
						setNotifyIdentityError("读取失败：" + notifyIdentityErrorText((err && err.message) || err));
					});
				return () => { alive = false; };
			}, []);
			// 点按钮：取反 → POST（带上当前名字）→ 用宿主回读的 enabled 刷新显示（不是乐观假设"点成功了"）。
			// 失败时把原因写进行尾那行小字，并再读一次真实状态（例如"启用成功但回读不一致"这类半成功）。
			const toggleNotifyIdentity = async () => {
				if (notifyIdentityBusy) return;
				const target = !(notifyIdentity && notifyIdentity.enabled);
				setNotifyIdentityBusy(true);
				setNotifyIdentityError("");
				try {
					const body = await writeNotifyIdentity(target, notifyNameShown);
					setNotifyIdentity(notifyIdentityOfBody(body));
				} catch (err) {
					setNotifyIdentityError((target ? "启用失败：" : "移除失败：") + notifyIdentityErrorText((err && err.message) || err));
					try {
						const body = await readNotifyIdentity();
						setNotifyIdentity(notifyIdentityOfBody(body));
					} catch { /* 读不到就维持原显示 */ }
				} finally {
					setNotifyIdentityBusy(false);
				}
			};
			// 「发送测试通知」：点了立刻 POST 一次；成功 = 显示发送者（与正文同一套身份名），
			// 失败 = 原因。不弹窗、不轮询、不落任何状态（测试通知与真实提醒完全隔离）。
			const [notifyTest, setNotifyTest] = (0, react.useState)(null);
			const [notifyTestBusy, setNotifyTestBusy] = (0, react.useState)(false);
			const sendTestNotify = async () => {
				if (notifyTestBusy) return;
				setNotifyTestBusy(true);
				setNotifyTest(null);
				try {
					const body = await sendNotifyTest();
					setNotifyTest({ ok: true, text: "" });
				} catch (err) {
					setNotifyTest({ ok: false, text: "发送失败：" + notifyIdentityErrorText((err && err.message) || err) });
				} finally {
					setNotifyTestBusy(false);
				}
			};

			// 保存失败必须可见：旧实现只 await 不 catch，写被宿主拒绝时控件弹回原值、
			// 用户只会觉得"点了没反应"（「重置排序」写 null 被拒就是这种病的极端例子）
			//
			// DSH 0.1.7 起这里多了一个坑：`configForms` 的 set() **返回布尔值而不是抛错**
			// （旧 settingsScope 的 set() 失败会抛）。所以只写 try/catch 的话，
			// "宿主拒绝写入"会被当成成功，控件照样弹回、依旧没有任何提示。
			// 必须显式判返回值：false = 宿主没接受（多半是该字段没进表单 / 修订号冲突 / 页面只读）。
			//
			// 根修（2026-10-16，第二次）：写入后**不再**手写 `setSnapshot(scope.getSnapshot())` ——
			// 受控值的数据源改成上面的 scope.subscribe（订阅推送，写法见该 effect 的注释）。
			// 返回值改成"是否被宿主接受"，供取色器节流（任务 2）判断要不要把值放回待写队列。
			const [saveError, setSaveError] = (0, react.useState)("");
			const commit = async (key, value) => {
				try {
					const accepted = await scope.set(key, value);
					if (accepted === false) throw new Error(formRejectHint(scope, key));
					setSaveError("");
					return true;
				} catch (err) {
					setSaveError("\u4FDD\u5B58\u5931\u8D25\uFF1A" + String((err && err.message) || err || "未知错误"));
					return false;
				}
			};

			// 应用名提交（失焦 / 回车）：空 ⇒ 默认「二游日历」；非法文件名字符与超长由 notifyNameOf 收干净
			// （与宿主同一个函数，所以"设置页看到的"和"落到系统里的"不会分叉）。
			//
			// 顺序是**先重建、后写配置**：已启用身份时宿主的 POST 会先删掉旧名字的 .lnk 再按新名字建，
			// 建成功才写 `notifyName`。反过来（先写配置）在"名字被别人的快捷方式占用"时会留下
			// 「配置叫新名字、系统里却没有对应快捷方式」的坏状态，用户只看到名字改了、通知还是 PowerShell。
			const commitNotifyName = async () => {
				if (notifyIdentityBusy) return;
				const next = notifyNameOf(notifyNameDraft === null ? notifyNameSaved : notifyNameDraft);
				setNotifyNameDraft(null);
				if (next === notifyNameSaved) return;                 // 没变：不写设置、不重建快捷方式
				if (notifyIdentity && notifyIdentity.enabled) {
					setNotifyIdentityBusy(true);
					setNotifyIdentityError("");
					try {
						const body = await writeNotifyIdentity(true, next);
						setNotifyIdentity(notifyIdentityOfBody(body));
					} catch (err) {
						setNotifyIdentityError("改名失败：" + notifyIdentityErrorText((err && err.message) || err));
						setNotifyNameDraft(next);                     // 保留用户输入：可以重试 / 换个名字
						return;
					} finally {
						setNotifyIdentityBusy(false);
					}
				}
				await commit("notifyName", next);
			};

			// 「提醒」节点档位**胶囊**（2026-10-28：文本框 / "解析为" 预览 / 红框提示全部删掉）。
			// 点一下 = 立刻把**归一化后的整串**写回（降序、逗号分隔、无空格）。
			// 切换与归一化全走 65-remind.js 的 remindNodesToggleOf（内部就是判定侧的 remindNodesOf，
			// 同一口径，不在这边另写一份解析）。
			// 全部点掉 ⇒ 写**空串**（= 该方向不提醒）；判定侧把显式空串读成空档、**不**回落默认。
			//
			// 为什么要草稿 + 串行链（与上面「展示」的 setEntryShown 同一套理由）：
			//   · 宿主一次写入往返 1.4~3.6s，`s` 不会即时推新 ⇒ 受控值读草稿，点击立刻反映在胶囊上；
			//   · 连点两下时两笔写入排成一条链，保证"最后一次点击"最后落盘，
			//     不会因为两次 set 快慢颠倒而回退。
			//   ⚠️ 目标文本在**点击时**就算好再入链（不是入链后读快照重算）：胶囊是"切换"语义，
			//      若等落盘后拿旧快照重算，往返窗口内的第二下会以旧值为基准 ⇒ 第一下被吞掉。
			const remindNodesWriteChain = (0, react.useRef)(Promise.resolve());
			const toggleRemindNode = (which, keyName, savedText, fallbackNodes, node) => {
				const base = remindNodesDraft[which] === null ? String(savedText || "") : remindNodesDraft[which];
				const text = remindNodesToggleOf(base, node, fallbackNodes);
				setRemindNodesDraft((p) => ({ ...p, [which]: text }));   // 立刻显示新的选中态
				const run = remindNodesWriteChain.current.then(async () => {
					const ok = await commit(keyName, text);
					// 宿主没接受 ⇒ 撤掉草稿，胶囊回到真实值（saveError 横幅已经在说明原因）。
					// 只撤"还是这一笔文本"的草稿：后面还排着更新的点击时，别把那个意图也抹掉。
					if (!ok) setRemindNodesDraft((p) => (p[which] === text ? { ...p, [which]: null } : p));
				});
				remindNodesWriteChain.current = run.catch(() => {});
				return run;
			};
			// 草稿只在"宿主还没追上"的窗口里存在：一旦已保存值与草稿是**同一组档位**，就撤掉草稿
			// （理由同上面「展示」草稿的 A5 修复：外部改了配置，本页不能永久停在旧值）。
			// 比较的是**解析后的档位**而不是原文：空串 / "6，2" 这类写法差异不该把草稿留住。
			const remindEndSavedText = String(s.remindEndNodes || "");
			const remindStartSavedText = String(s.remindStartNodes || "");
			const remindNodesKeyOf = (text, fallbackNodes) => remindNodesOf(text, fallbackNodes).join(",");
			(0, react.useEffect)(() => {
				setRemindNodesDraft((prev) => {
					let next = prev;
					const drop = (which, savedText, fallbackNodes) => {
						if (next[which] === null) return;
						if (remindNodesKeyOf(next[which], fallbackNodes) !== remindNodesKeyOf(savedText, fallbackNodes)) return;
						if (next === prev) next = { ...prev };
						next[which] = null;
					};
					drop("end", remindEndSavedText, REMIND_DEFAULT_END_NODES);
					drop("start", remindStartSavedText, REMIND_DEFAULT_START_NODES);
					return next;
				});
			}, [remindEndSavedText, remindStartSavedText]);

			const setOrder = async (nextIds) => { await commit("order", nextIds); };
			const move = async (id, delta) => {
				// order 可能缺少新条目的 id（如新增的 ba-jp），按默认顺序补齐后再移动
				let base = order;
				const allIds = allEntries.map((x) => x.id);
				if (allIds.some((x) => !base.includes(x))) {
					base = base.slice();
					for (const x of allIds) if (!base.includes(x)) base.push(x);
				}
				const idx = base.indexOf(id);
				const target = idx + delta;
				if (idx < 0 || target < 0 || target >= base.length) return;
				const next = base.slice();
				next.splice(idx, 1);
				next.splice(target, 0, id);
				await setOrder(next);
			};
			// 重置排序：写空数组而不是 null —— 宿主 settings schema 是 z.array(z.string())，
			// 写 null 会被校验拒绝（旧实现因此永久点不动，还抛未捕获 rejection）；applyOrder 对空数组等价"未设置"
			const resetOrder = async () => { await commit("order", []); };

			// 展示开关（勾选/取消勾选）
			// 三态语义见 60-helpers.js 的 isEntryHidden：hidden = 明确关掉，shown = 明确打开
			// （shown 用来把「出厂默认隐藏 defaultHidden」的条目重新打开）。
			// 每次切换都把 id 从**另一个**列表里摘掉，避免两边同时存在造成判定歧义。
			//
			// A1 修复（2026-10-17）：**决策与显示必须同源**。
			//   复选框的显示值 = `shownNow(g)`（草稿优先）；而旧实现是"显示一处、决策另一处"：
			//   显示用草稿，决策却交给 toggleHidden(g.id) —— 后者用**渲染快照 `s`** 反判
			//   isHiddenNow。宿主一次写入往返实测 1.4~3.6s，第二次点击落在往返窗口内时 `s`
			//   还是旧的 ⇒ 又走「隐藏」分支 ⇒ 复选框显示"已显示"、store 里其实仍是隐藏
			//   （刷新才现原形；审计已真机复现）。
			//   现在 onChange 用**同一个** `shownNow(g)` 取反得到目标状态，交给下面按目标状态
			//   落盘的函数；该函数不再反判快照里的成员"当前值"，而是由目标状态**强制**决定
			//   id 在两个列表里的归属（病根就是"store 里到底是什么"不可信，所以不能"看着
			//   不用写就不写"），并且：
			//     · 串行化：连点两次时第二笔在第一笔落盘后再算 ⇒ 终态 = 最后一次点击；
			//     · 列表内容取**执行时的最新快照**（scope.getSnapshot() 是纯读、不触发渲染，
			//       与 2026-10-16「写后不再手写 setSnapshot」的根修不冲突）⇒ 不会拿旧列表
			//       覆盖掉别的行刚写进去的改动。
			const shownNow = (g) => (Object.prototype.hasOwnProperty.call(showDraft, g.id) ? !!showDraft[g.id] : !isEntryHidden(g, s));
			const setEntryShown = (id, shouldShow) => {
				const run = showWriteChain.current.then(async () => {
					const snap = scope.getSnapshot();
					const live = snap && snap.status === "ready" ? snap.value : null;
					const lh = live && Array.isArray(live.hidden) ? live.hidden : hidden;
					const lw = live && Array.isArray(live.shown) ? live.shown : shown;
					// 目标状态 ⇒ 终态内容：开 = hidden 里没有它且 shown 里有它（defaultHidden 的条目靠 shown 才能显示）；
					//                    关 = hidden 里有它且 shown 里没有它。
					const nextHidden = shouldShow ? lh.filter((x) => x !== id) : (lh.includes(id) ? lh : [...lh, id]);
					const nextShown = shouldShow ? (lw.includes(id) ? lw : [...lw, id]) : lw.filter((x) => x !== id);
					await commit("hidden", nextHidden);
					await commit("shown", nextShown);
				});
				showWriteChain.current = run.catch(() => {});
				return run;
			};
			// ── 「提醒」白名单（给将来的「到期提醒（送达）」，不属于轮播）────────────────
			// ⚠️ 设置页这一列当前**暂时隐藏**（SHOW_REMIND_COLUMN = false，送达未实现）；
			// 下面这套状态与写入链路原样保留，改回 true 即恢复，不用重写。
			// remindGames = 要提醒的条目 id 列表；空数组 = 一个都不提醒（没有"空 = 全部"的哨兵）。
			// 写入链路与「展示」相同：目标状态驱动 + 串行链 + 执行时读最新快照（避免连点互相覆盖）。
			const remindIds = Array.isArray(s.remindGames) ? s.remindGames : [];
			const remindAllowedNow = (id) => (Object.prototype.hasOwnProperty.call(remindDraft, id)
				? !!remindDraft[id]
				: remindGameAllowed(id, remindIds));
			const setEntryRemind = (id, shouldRemind) => {
				const run = remindWriteChain.current.then(async () => {
					const snap = scope.getSnapshot();
					const live = snap && snap.status === "ready" ? snap.value : null;
					const cur = live && Array.isArray(live.remindGames) ? live.remindGames : remindIds;
					// 普通列表：加 = 并入，减 = 摘掉；减到空就写空（= 一个都不提醒）。
					const next = shouldRemind
						? (cur.includes(id) ? cur.slice() : [...cur, id])
						: cur.filter((x) => x !== id);
					await commit("remindGames", next);
				});
				remindWriteChain.current = run.catch(() => {});
				return run;
			};
			// 「全部提醒」写的是当前展示中的 id；与逐行勾选共用串行链，避免两笔写入互相覆盖。
			const resetRemindAll = () => {
				const run = remindWriteChain.current.then(async () => {
					const next = allEntries.filter((g) => shownNow(g)).map((g) => g.id);
					setRemindDraft({});
					await commit("remindGames", next);
				});
				remindWriteChain.current = run.catch(() => {});
				return run;
			};

			// ── A5（低）：两个草稿一旦写入就**永不清除** ⇒ 会话内长期遮蔽 store 值 ──────────────
			// 症状：别的页面实例 / 外部 RPC（settings/mutate）改了同一个 id 之后，本页控件还停在
			// 旧草稿上，只有刷新（重新挂载、草稿清空）才对齐。
			// 修法：**仅当 store 现值已经等于草稿值**时，把该条目从草稿里删掉 —— 显示值不变
			// （回落去读 store），但草稿不再挡着后续的外部写入。
			//   ⚠️ 不能无条件清：写入还没落盘时 store 还是旧值，那会把用户刚点的意图抹掉（控件弹回）。
			// 依赖键按**值**派生（宿主每次写入都换掉数组对象，按引用当依赖会白跑；理由同面板 A3）。
			const hiddenKey = (Array.isArray(s.hidden) ? s.hidden : []).join("\u0000");
			const shownKey = (Array.isArray(s.shown) ? s.shown : []).join("\u0000");
			const remindGamesKey = (Array.isArray(s.remindGames) ? s.remindGames : []).join("\u0000");
			const entriesById = {};
			for (const x of allEntries) entriesById[x.id] = x;
			(0, react.useEffect)(() => {
				const store = parseJsonStr(s.gameColors, {});
				let changed = false;
				const next = {};
				for (const id of Object.keys(colorDraft)) {
					const cur = typeof store[id] === "string" ? store[id] : "";
					// 值已相等（十六进制大小写不敏感）⇒ 草稿使命完成，删掉它
					if (cur && cur.toLowerCase() === String(colorDraft[id] || "").toLowerCase()) { changed = true; continue; }
					next[id] = colorDraft[id];
				}
				if (changed) setColorDraft(next);
			}, [s.gameColors, colorDraft]);
			(0, react.useEffect)(() => {
				let changed = false;
				const next = {};
				for (const id of Object.keys(showDraft)) {
					const g = entriesById[id];
					// 条目已被删除 ⇒ 草稿没有意义，丢掉；否则 store 的可见性已与草稿相等 ⇒ 丢掉
					if (!g || (!isEntryHidden(g, s) === !!showDraft[id])) { changed = true; continue; }
					next[id] = showDraft[id];
				}
				if (changed) setShowDraft(next);
			}, [hiddenKey, shownKey, s.customEntries, showDraft]);
			// 白名单草稿的同一套清理：store 值已相等（或条目被删）⇒ 丢掉草稿；依赖按值而不是数组引用。
			(0, react.useEffect)(() => {
				let changed = false;
				const next = {};
				for (const id of Object.keys(remindDraft)) {
					const g = entriesById[id];
					if (!g || (remindGameAllowed(id, remindIds) === !!remindDraft[id])) { changed = true; continue; }
					next[id] = remindDraft[id];
				}
				if (changed) setRemindDraft(next);
			}, [remindGamesKey, s.customEntries, remindDraft]);
			// 删除条目：内置条目记入 removed；自定义条目从 customEntries 移除
			const removeEntry = async (g) => {
				if (g.custom) {
					const next = customs.filter((c) => c.id !== g.id);
					await commit("customEntries", JSON.stringify(next));
				} else {
					await commit("removed", [...removed, g.id]);
				}
			};
			// 恢复条目：清空删除记录与自定义条目
			const restoreAll = async () => {
				await commit("removed", []);
				await commit("customEntries", "[]");
			};
			// 爬取地址：默认/备选源/自定义。customUrls[id] 存选中值：
			// - 无 key → 默认源；- 值 === "custom:<用户输入>" → 自定义输入；- 其它（如 "proxy:https://..."）→ 备选源值
			const entryUrlMode = (id, g) => {
				// T3：不再每行重新 parseJsonStr —— 本组件渲染开头已经解析出 `urls`（见上面
				// `const urls = parseJsonStr(s.customUrls, {})`），而这里每渲染一次就有 28 行 × 2 个选择器
				// 各 parse 一遍（真机实测：12 次取色拖动共 2316 次 JSON.parse 的主因之一）。
				// 直接用同一份已解析结果，语义完全一致（同一字符串 + 同一个 parseJsonStr 回退语义）。
				if (!urls || typeof urls !== "object" || !Object.prototype.hasOwnProperty.call(urls, id)) return "default";
				const v = urls[id];
				if (typeof v === "string" && v.startsWith("custom:")) return "custom";
				// 备选源标识（老配置的 proxy:/gk-*: 在这里翻译成新标识）。
				// "" = 该标识已并入"默认源"（如 ba-global 的旧 GameKee 备选 → 默认就是 GameKee）→ 回显"默认"，
				// 否则 <select> 的值匹配不到任何 option，控件会显示空白（用户以为来源丢了）。
				return normalizeSourceId(v) || "default";
			};
			const setUrlMode = async (id, mode, g) => {
				const next = { ...(urls || {}) };
				if (mode === "default") delete next[id];
				else if (mode === "custom") next[id] = "custom:" + (customInputs[id] ?? "");
				else next[id] = mode; // 备选源标识（url 或 id）
				await commit("customUrls", JSON.stringify(next));
			};
			const setCustomUrl = async (id, value) => {
				setCustomInputs((p) => ({ ...p, [id]: value }));
				const next = { ...(urls || {}) };
				next[id] = "custom:" + value;
				await commit("customUrls", JSON.stringify(next));
			};
			// 活动来源地址：默认/自定义（存 customEventUrls），判定同上（custom: 前缀）
			const eventUrls = parseJsonStr(s.customEventUrls, {});
			const eventUrlMode = (id) => {
				// T3：同 entryUrlMode —— 复用本渲染开头解析好的 eventUrls，不再逐行 parse。
				const eu = eventUrls;
				if (!eu || typeof eu !== "object" || !Object.prototype.hasOwnProperty.call(eu, id)) return "default";
				const v = eu[id];
				// 同 entryUrlMode：已并入默认源的旧标识（normalizeSourceId 归一为空串）→ 回显"默认"
				return String(v ?? "").startsWith("custom:") ? "custom" : (normalizeSourceId(v) || "default");
			};
			const setEventUrlMode = async (id, mode) => {
				const next = { ...(eventUrls || {}) };
				if (mode === "custom") next[id] = "custom:" + (eventCustomInputs[id] ?? "");
				// 修（2026-10-16 真机取证）：原来这里是无条件 `else delete next[id]` ⇒ 选**备选活动源**
				// （如"米游社公告"）时把 key 删掉、写回 "{}"，控件立刻弹回"默认"，用户永远选不上。
				// 真机请求体证据：{"op":"set","path":["customEventUrls"],"value":"{}"}（响应 ok:true）。
				// 与上面的卡池来源同构：default 才删，其余（备选源的 url/id）原样存入。
				else if (mode === "default") delete next[id];
				else next[id] = mode;
				await commit("customEventUrls", JSON.stringify(next));
			};
			const setCustomEventUrl = async (id, value) => {
				setEventCustomInputs((p) => ({ ...p, [id]: value }));
				const next = { ...(eventUrls || {}) };
				next[id] = "custom:" + value;
				await commit("customEventUrls", JSON.stringify(next));
			};
			// 每游戏主题色：写入 gameColors（{ id: "#rrggbb" }）。非法/空值 = 删除该项 ⇒ 回落到出厂色/名字哈希。
			//
			// 写入节流（任务 2）：<input type="color"> 在原生取色器里**拖动**时会高频发 input 事件，
			// 原实现每个事件都 commit 一次（= 一次 settings/mutate + 一次整页重渲染；真机实测 12 次连续
			// 事件 = 12 次 mutate + 2738ms 长任务）。现在：
			//   · onChange 只更新本地草稿（颜色立刻跟着手指变，视觉不变）+ 把值记进 pending；
			//   · 落盘推迟到 **120ms 静默期**结束（尾沿去抖）⇒ 连续拖动只有最后一次值真正发出去；
			//   · blur / pointerup / keyup 立即 flush ⇒ "停手就生效"；
			//   · pending 只在**写入被宿主接受后**才清 ⇒ 两次写入交叠时不会丢掉另一次的值，
			//     写失败也会留在队列里等下一次 flush 重试。
			const liveSettings = (0, react.useRef)(s);
			liveSettings.current = s;
			const colorWrite = (0, react.useRef)({ timer: null, pending: null });
			const flushGameColors = async () => {
				const cw = colorWrite.current;
				if (cw.timer !== null) { window.clearTimeout(cw.timer); cw.timer = null; }
				const batch = cw.pending;
				if (!batch || !Object.keys(batch).length) return;
				// 基线用**最新快照**（ref 读，避免计时器闭包停在旧渲染），再叠加尚未落盘的 pending
				const next = { ...parseJsonStr(liveSettings.current.gameColors, {}) };
				for (const id of Object.keys(batch)) {
					const v = batch[id];
					if (v && /^#[0-9a-f]{6}$/i.test(v)) next[id] = v; else delete next[id];
				}
				const accepted = await commit("gameColors", JSON.stringify(next));
				if (accepted) {
					const cur = colorWrite.current.pending;
					if (cur) for (const id of Object.keys(batch)) if (cur[id] === batch[id]) delete cur[id];
				}
			};
			const setGameColor = (id, value) => {
				colorWrite.current.pending = { ...(colorWrite.current.pending || {}), [id]: value };
				if (colorWrite.current.timer !== null) window.clearTimeout(colorWrite.current.timer);
				colorWrite.current.timer = window.setTimeout(() => { colorWrite.current.timer = null; flushGameColors(); }, 120);
			};
			// A2（低）：取色器的落盘计时器原先**没有卸载清理**（本组件另外两处计时器都有：
			// useCycle 与面板的每分钟时钟）。宿主一次写入往返 1.4~3.6s，用户"改完色立刻切走设置页"
			// 时那个 120ms 尾沿计时器仍会在**已卸载**的组件上触发 flushGameColors ⇒ 白发一次
			// settings/mutate（真机实测：切走后仍多一笔 gameColors 写入）。
			// 卸载时**只清计时器、不 flush**（flush 就是发请求）；pending 一并丢弃，
			// 于是卸载后既不会有请求、也不可能再碰本组件的 state（commit 里的 setSaveError）。
			(0, react.useEffect)(() => () => {
				const cw = colorWrite.current;
				if (!cw) return;
				if (cw.timer !== null) { window.clearTimeout(cw.timer); cw.timer = null; }
				cw.pending = null;
			}, []);
			// 添加自定义条目：名称/图标手动填，卡池与活动内容由链接解析产出
			const addEntry = async () => {
				if (!form.name.trim() || !form.url.trim()) return;
				const id = "custom-" + Date.now().toString(36);
				const entry = {
					id,
					name: form.name.trim(),
					icon: form.icon.trim(),
					url: form.url.trim(),
					eventUrl: form.eventUrl.trim(),
					// 主题色（可选）：留着作为该条目的出厂色，设置里的取色器仍可覆盖它
					color: form.color.trim()
				};
				await commit("customEntries", JSON.stringify([...customs, entry]));
				setForm({ name: "", icon: "", url: "", eventUrl: "", color: "" });
				setAdding(false);
			};
			const updateForm = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

			// 每游戏主题色覆盖表（设置里存 JSON 字符串；解析失败回空表 = 全部用出厂色/名字哈希）
			const gameColorMap = parseJsonStr(s.gameColors, {});
			// 选择器/输入框统一样式；textOverflow/overflow 让长选项文本省略截断，避免与下拉箭头重叠
			const inputStyle = { padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", borderRadius: 6, fontSize: 12, maxWidth: "100%", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" };
			const labelStyle = { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "none" };

			// 「提醒」档位胶囊（结束 / 开始各一行）：受控值 = 草稿优先、否则已保存值；
			// 选中态 = **判定侧真会用的档位**（remindNodesOf：显式空串 ⇒ 一颗都不选中）。
			// 可选集合 = 该方向的**出厂档位**（REMIND_DEFAULT_*_NODES，直接拿常量当 choices，
			// 不另抄一份）—— 不做自定义输入。
			const remindNodesValue = (which, saved) => (remindNodesDraft[which] === null ? String(saved || "") : remindNodesDraft[which]);
			// 一行 = 「标签 + 一排胶囊」：标签与胶囊之间 8px、胶囊之间 6px（视觉不挤）。
			// 胶囊是真的 <button>（可 Tab / 可回车 / aria-pressed 报告选中态），
			// 选中态走 .gacha-cal-chip--on（主题浅色底 + 深色字；未选中 = 灰描边 + 次级字色；
			// 两者的 hover 都在 70-styles.js 里，各有轻微变化）。
			const remindChipRow = (which, labelText, savedText, fallbackNodes, keyName, titleText, noteText) => {
				const nodes = remindNodesOf(remindNodesValue(which, savedText), fallbackNodes);
				return (0, react_jsx_runtime.jsxs)("div", {
					key: which,
					style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
					children: [
						(0, react_jsx_runtime.jsx)("span", { style: { flex: "none", fontSize: 12, color: "var(--dsw-alias-label-secondary)" }, title: titleText, children: labelText }),
						(0, react_jsx_runtime.jsxs)("div", {
							style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
							children: fallbackNodes.map((n) => {
								const on = nodes.includes(n);
								return (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"aria-pressed": on ? "true" : "false",
									className: "gacha-cal-chip" + (on ? " gacha-cal-chip--on" : ""),
									title: (on ? "取消这档提醒：" : "选上这档提醒：") + remindNodeText(n),
									onClick: () => toggleRemindNode(which, keyName, savedText, fallbackNodes, n),
									children: remindNodeText(n)
								}, n);
							})
						}),
						noteText ? (0, react_jsx_runtime.jsx)("span", { style: { flex: "none", fontSize: 11, color: "var(--dsw-alias-label-tertiary)" }, children: noteText }) : null
					]
				});
			};

			return (0, react_jsx_runtime.jsxs)("div", {
				style: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 720, fontSize: 13, padding: "2px 0 8px" },
				children: [
					(0, react_jsx_runtime.jsx)("div", { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 16, fontWeight: 600 }, children: SETTINGS_SECTION_LABEL })
					] }),
					saveError ? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #d4380d)", fontSize: 12 }, children: saveError }) : null,
					// 配置表单本身的状态：只在"写不进去"时才出现，平时不占位。
					// 这一行是给"控件点了弹回原值、却没有任何提示"这类问题留的现场：
					// memory = 非本机连接（只读）；loading/unavailable = 宿主没把表单送到；
					// ready 但写仍被拒 = 该字段没进表单或修订号冲突。
					(formReady ? null : (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #d4380d)", fontSize: 12 }, children: "\u914D\u7F6E\u53EA\u8BFB\uFF1A" + formStateText })),
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: [
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !!s.autoRefresh, onChange: (e) => commit("autoRefresh", e.target.checked) }),
								(0, react_jsx_runtime.jsx)("span", { children: "自动刷新" })
							] }),
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "刷新频率" }),
								(0, react_jsx_runtime.jsxs)("select", { className: "gacha-cal-select", value: String(currentMinutes), onChange: (e) => commit("refreshMinutes", Number(e.target.value)), children: [
									!inOptions ? (0, react_jsx_runtime.jsx)("option", { value: String(currentMinutes), children: "自定义（" + currentMinutes + " 分钟）" }) : null,
									REFRESH_OPTIONS.map((o) => (0, react_jsx_runtime.jsx)("option", { value: String(o.minutes), children: o.label }, o.minutes))
								] })
							] })
						] }),
						// 按钮轮播 = 开关 + 范围，不分游戏；下面列表里的「提醒」不控制轮播。
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, title: "有卡池或活动在 N 小时内结束或开始时，侧栏按钮轮播显示", children: [
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: tickerOn, onChange: (e) => commit("tickerOn", e.target.checked) }),
								(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "按钮轮播" })
							] }),
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "轮播范围" }),
								(0, react_jsx_runtime.jsxs)("select", { className: "gacha-cal-select", value: String(currentTicker), onChange: (e) => commit("tickerHours", Number(e.target.value)), children: [
									!tickerInOptions ? (0, react_jsx_runtime.jsx)("option", { value: String(currentTicker), children: "自定义（" + currentTicker + " 小时）" }) : null,
									TICKER_OPTIONS.map((o) => (0, react_jsx_runtime.jsx)("option", { value: String(o.hours), children: o.label }, o.hours))
								] })
							] })
						] }),
						// 「到期提醒（送达）」总开关（默认开）：到点时由**宿主半边**弹系统通知。
						// 下面两行是节点档位胶囊（字符串配置，"72,24,6,2" / "24,2"）：解析、归一化、
						// 全部取消（空串 = 该方向不提醒）全走 65-remind.js，与判定侧同一份口径。
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, title: "到点时用系统通知提醒：结束/开始前若干小时，同一件事只发最紧急的一档", children: [
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: remindOn, onChange: (e) => commit("remindOn", e.target.checked) }),
								(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "提醒" })
							] }),
							(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11 }, children: "到期前弹系统通知（仅 DSH 运行期间）" })
						] }),
						remindChipRow("end", "结束提醒", remindEndSavedText, REMIND_DEFAULT_END_NODES, "remindEndNodes", "结束前多久提醒（可多选；全不选 = 结束不提醒）"),
						// 2026-10-28：开始提醒已暂时置空（多数来源不提前提供档期），这一行先注释掉，恢复时取消注释即可。
		 	// remindChipRow(\"start\, \"开始提醒\, remindStartSavedText, REMIND_DEFAULT_START_NODES, \"remindStartNodes\, \"开始前多久提醒（可多选；全不选 = 开始不提醒）\, \"多数来源不提前提供档期，已搁置\)
						// ── 通知身份（可选）：**一行**。「启用」= 当前用户开始菜单里建一条带 AUMID 的快捷方式，
						// 通知横幅顶部才会显示下面那个名字；「移除」= 删掉它并退回 PowerShell。
						// 2026-10-28：三行压成一行 —— 原来那两行说明文字挪进按钮的 title（信息不丢、不再占行）；
						// 名称是 110px 的窄输入框，空 ⇒ 写回默认「二游日历」；窄窗口允许换行（flexWrap）。
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { flex: "none", fontSize: 12, color: "var(--dsw-alias-label-secondary)" }, children: "通知身份" }),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "gacha-cal-sort-btn",
								disabled: notifyIdentityBusy || notifyIdentity === null,
								title: "更改系统通知的发送者：会在开始菜单建一条无害的快捷方式（可随时移除）",
								onClick: toggleNotifyIdentity,
								children: notifyIdentityBusy ? "处理中…" : (notifyIdentity && notifyIdentity.enabled ? "移除" : "启用")
							}),
							// 「发送测试通知」：立刻弹一条，验证通知链路（不影响到期提醒的去重状态）
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "gacha-cal-sort-btn",
								disabled: notifyTestBusy,
								title: "立刻弹一条系统通知，确认通知链路通不通",
								onClick: sendTestNotify,
								children: notifyTestBusy ? "发送中…" : "发送测试通知"
							}),
							// 应用名：**窄输入框**（110px）。失焦或回车提交；空 ⇒ 写回默认「二游日历」；
							// 非法文件名字符 / 超长由 notifyNameOf 清洗（与宿主同一处口径）。
							// 已启用身份时改名会顺便重建快捷方式（见 commitNotifyName）。
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, flex: "none" }, title: "通知横幅顶部的应用名（最多 40 字；文件名非法字符会被去掉）", children: [
								(0, react_jsx_runtime.jsx)("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" }, children: "名称" }),
								(0, react_jsx_runtime.jsx)("input", {
									type: "text",
									value: notifyNameShown,
									placeholder: DEFAULT_SETTINGS.notifyName,
									"aria-label": "通知身份名称",
									style: { width: 110, padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", borderRadius: 6, fontSize: 12 },
									onChange: (e) => setNotifyNameDraft(e.target.value),
									onBlur: () => { void commitNotifyName(); },
									onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }
								})
							] }),
							// 状态：`当前：…`。名字最长 40 字，直接铺开会把整行挤到第二行 ⇒ 截断到 240px
							// 配 title 显示全文（720px 卡片里整行仍然放得下，窄窗口才换行）。
							(0, react_jsx_runtime.jsx)("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: "系统通知横幅顶部当前显示的应用名", children: "当前：" + (notifyIdentity === null ? "读取中…" : notifyIdentity.enabled ? notifyIdentity.name : "PowerShell（默认）") }),
							notifyTest && !notifyTest.ok ? (0, react_jsx_runtime.jsx)("span", { style: { fontSize: 11, color: "var(--dsw-alias-state-error-primary, #d4380d)" }, children: notifyTest.text }) : null,
							notifyIdentityError ? (0, react_jsx_runtime.jsx)("span", { style: { fontSize: 11, color: "var(--dsw-alias-state-error-primary, #d4380d)" }, children: notifyIdentityError }) : null
						] }),
					] }),
					// ── 实验特性开关：新「二游日历」面板视图（默认关）──
					// 文案从简：只说"实验性新版UI，开发中"。默认值仍是 false（关着 = 原来的表格视图）。
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, border: "1px dashed var(--dsw-alias-border-l2)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
							(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: s.newPanel === true, onChange: (e) => commit("newPanel", e.target.checked) }),
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "实验：新「二游日历」面板视图" }),
						] }),
						// 每行都 ≤48 字（_copy_verify.mjs 有「设置页每条文案 ≤ 48 字」的硬门禁）
						(0, react_jsx_runtime.jsxs)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, lineHeight: 1.6 }, children: [
							(0, react_jsx_runtime.jsx)("div", { children: "实验性新版UI，开发中" })
						] })
					] }),
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "游戏列表" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
								// 「全部提醒」= 把当前展示中的 id 写进白名单；空数组的意思是"一个都不提醒"。
								// 暂时隐藏（SHOW_REMIND_COLUMN=false）：按钮与处理函数都保留，改回 true 即恢复。
								SHOW_REMIND_COLUMN ? (0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { width: "auto", height: "auto", padding: "3px 10px", borderRadius: 6 }, title: "把所有展示中的游戏都加入「提醒」白名单", onClick: resetRemindAll, children: "全部提醒" }) : null,
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { width: "auto", height: "auto", padding: "3px 10px", borderRadius: 6 }, onClick: resetOrder, children: "重置排序" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { width: "auto", height: "auto", padding: "3px 10px", borderRadius: 6 }, onClick: restoreAll, children: "恢复条目" })
							] })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: SHOW_REMIND_COLUMN
							? "「展示」控制显示；「提醒」到点通知；「↑↓」调整顺序；「颜色」取色器换主题色"
							: "「展示」控制显示；「↑↓」调整顺序；「颜色」取色器换主题色" }),
						// 表头行（与数据行同 grid 列；全部居中，与下方各列边界对齐）
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: SETTINGS_GAME_GRID, gap: 12, alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-tertiary)", fontSize: 11 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6E38\u620F" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5C55\u793A" }),
							// 「提醒」列暂时隐藏：false 时这一格不渲染（列宽模板也已少一格，不会留空列）
							SHOW_REMIND_COLUMN ? (0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u63D0\u9192" }) : null,
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5361\u6C60\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6D3B\u52A8\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u989C\u8272" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u64CD\u4F5C" })
						] }),
						sorted.map((g, i) => {
							const mode = entryUrlMode(g.id, g);
							const evMode = eventUrlMode(g.id);
							const showGachaInput = mode === "custom";
							const showEventInput = evMode === "custom";
							return (0, react_jsx_runtime.jsxs)("div", {
								key: g.id,
								style: { borderBottom: "1px solid var(--dsw-alias-border-l1)" },
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										style: { display: "grid", gridTemplateColumns: SETTINGS_GAME_GRID, gap: 12, alignItems: "center", padding: "8px 0" },
										children: [
											(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 }, children: [
												(0, react_jsx_runtime.jsx)(GameIcon, { icon: g.icon, name: g.name, size: 22 }),
												(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name gacha-cal-settings-name", style: { flex: "1 1 auto", minWidth: 0 }, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) })
											] }),
											(0, react_jsx_runtime.jsx)("label", { title: "展示/隐藏这一条", style: { ...labelStyle, cursor: "pointer", justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													checked: shownNow(g),
													onChange: () => {
														const next = !shownNow(g);
														// A1：上面这行就是「决策与显示同源」——目标状态取自当前显示值（shownNow），不再用渲染快照 s 反判当前状态
														setShowDraft((p) => ({ ...p, [g.id]: next }));
														setEntryShown(g.id, next);
													}
												})
											] }),
											// 「提醒」与「展示」独立：它只决定将来的到期送达要不要包含这一条。
											// 未展示的行面板里本来就没有，提醒也无从送达 ⇒ 复选框置灰。
											// 暂时隐藏（SHOW_REMIND_COLUMN=false）：这一格不渲染，但 onChange 链路原样保留。
											SHOW_REMIND_COLUMN ? (0, react_jsx_runtime.jsx)("label", {
												style: { ...labelStyle, cursor: shownNow(g) ? "pointer" : "default", justifySelf: "center", opacity: shownNow(g) ? 1 : 0.45 },
												children: (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													checked: remindAllowedNow(g.id),
													disabled: !shownNow(g),
													onChange: () => {
														const next = !remindAllowedNow(g.id);
														setRemindDraft((p) => ({ ...p, [g.id]: next }));
														setEntryRemind(g.id, next);
													}
												})
											}) : null,
											// 卡池来源选择器
											(0, react_jsx_runtime.jsxs)("select", {
												value: mode,
												className: "gacha-cal-select",
												onChange: (e) => setUrlMode(g.id, e.target.value, g),
												children: [
													(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g) }),
													(g.altSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: altSourceId(a), children: a.label }, a.label)),
													(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "\u81EA\u5B9A\u4E49" })
												]
											}),
											// 活动来源选择器（未配置活动源默认项为"未配置"，选择"自定义"后展开输入行）
											(0, react_jsx_runtime.jsxs)("select", {
												value: evMode,
												className: "gacha-cal-select",
												onChange: (e) => setEventUrlMode(g.id, e.target.value),
												children: [
													(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g, "eventUrl") }),
													(g.eventAltSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: altSourceId(a), children: a.label }, a.fetcher)),
													(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "自定义" })
												]
											}),
											// 主题色：点开系统取色器即时写回 gameColors（点右下「重置」样的小方块可取消覆盖）
											(0, react_jsx_runtime.jsx)("label", { title: "主题色（点开系统取色器）", style: { justifySelf: "center", display: "inline-flex", alignItems: "center", cursor: "pointer" }, children: (0, react_jsx_runtime.jsx)("input", {
												type: "color",
												value: colorDraft[g.id] || (/^#[0-9a-f]{6}$/i.test(String(gameColorMap[g.id] || "")) ? gameColorMap[g.id] : (() => { const c = scheduleGameColor(g, gameColorMap); return /^#[0-9a-f]{6}$/i.test(c) ? c : "#3b5bfd"; })()),
												onChange: (e) => { const v = e.target.value; setColorDraft((p) => ({ ...p, [g.id]: v })); setGameColor(g.id, v); },
												// 松手/失焦/按键抬起后立即落盘（不等 120ms 去抖窗口）。
												// ⚠️ 原生取色器是**独立的系统窗口**，不保证把 pointerup 交回页面 ⇒
												//     真正兜底的是 setGameColor 里那个 120ms 尾沿计时器（"停手就生效"）。
												onBlur: () => { flushGameColors(); },
												onPointerUp: () => { flushGameColors(); },
												onKeyUp: () => { flushGameColors(); },
												className: "gacha-cal-color"
											}) }),
											(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 4, justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn gacha-cal-sort-btn--icon", title: "\u4E0A\u79FB", disabled: i === 0, onClick: () => move(g.id, -1), children: (0, react_jsx_runtime.jsx)("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: (0, react_jsx_runtime.jsx)("path", { d: "M6 14.5l6-6 6 6" }) }) }),
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn gacha-cal-sort-btn--icon", title: "\u4E0B\u79FB", disabled: i === sorted.length - 1, onClick: () => move(g.id, 1), children: (0, react_jsx_runtime.jsx)("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: (0, react_jsx_runtime.jsx)("path", { d: "M6 9.5l6 6 6-6" }) }) }),
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn gacha-cal-sort-btn--icon gacha-cal-del-btn", title: "\u5220\u9664", onClick: () => removeEntry(g), children: (0, react_jsx_runtime.jsx)("svg", {
													width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
													children: [
														(0, react_jsx_runtime.jsx)("path", { d: "M4 7h16" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M6.5 7l.9 12.1A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.9L17.5 7" })
													]
												}) })
											] })
										]
									}),
									// 自定义输入行：选择"自定义"后整行展开（全宽，不挤压列）
									showGachaInput || showEventInput ? (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "0 4px 6px" }, children: [
										showGachaInput ? (0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 280px", minWidth: 220 }, children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" }, children: "卡池来源地址" }),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												placeholder: "https://…/api.php 或含排期的网页",
												value: customInputs[g.id] ?? (urls && typeof urls === "object" ? String(urls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
												onChange: (e) => setCustomUrl(g.id, e.target.value),
												style: { ...inputStyle, flex: "1 1 160px" }
											})
										] }) : null,
										showEventInput ? (0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 280px", minWidth: 220 }, children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" }, children: "活动来源地址" }),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												placeholder: "https://…/api.php 或含排期的网页",
												value: eventCustomInputs[g.id] ?? (eventUrls && typeof eventUrls === "object" ? String(eventUrls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
												onChange: (e) => setCustomEventUrl(g.id, e.target.value),
												style: { ...inputStyle, flex: "1 1 160px" }
											})
										] }) : null
									] }) : null
								]
							});
						}),
						adding ? (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, border: "1px dashed var(--dsw-alias-border-l2)", borderRadius: 8, padding: 10, marginTop: 6 }, children: [
							(0, react_jsx_runtime.jsx)("div", { style: { fontWeight: 600 }, children: "\u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" }),
							(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "名称与图标手动填写；卡池与活动由来源链接解析产出" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "名称（必填）", value: form.name, onChange: updateForm("name"), style: { ...inputStyle, flex: "1 1 140px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "图标 URL（可选）", value: form.icon, onChange: updateForm("icon"), style: { ...inputStyle, flex: "1 1 240px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "color", title: "主题色（可选；留空则按名称自动分配）", value: /^#[0-9a-f]{6}$/i.test(form.color) ? form.color : (() => { const c = scheduleGameColor({ id: "custom-preview", name: form.name }); return /^#[0-9a-f]{6}$/i.test(c) ? c : "#3b5bfd"; })(), onChange: updateForm("color"), className: "gacha-cal-color", style: { flex: "0 0 28px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "卡池来源链接（必填）", value: form.url, onChange: updateForm("url"), style: { ...inputStyle, flex: "1 1 300px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "活动来源链接（可选）", value: form.eventUrl, onChange: updateForm("eventUrl"), style: { ...inputStyle, flex: "1 1 300px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { width: "auto", height: "auto", padding: "3px 12px", borderRadius: 6 }, disabled: !form.name.trim() || !form.url.trim(), onClick: addEntry, children: "\u6DFB\u52A0" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: () => setAdding(false), children: "\u53D6\u6D88" })
							] })
						] }) : (0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { alignSelf: "flex-start", marginTop: 6 }, onClick: () => setAdding(true), children: "+ \u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" })
					] }),
					// 解析器自检：逐源检查「没内容 / 报错」，源站改版后用来定位问题。只读（core 的 selfCheck() 保证）
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "解析器自检" }),
							(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-refresh gacha-cal-sort-btn", disabled: selfChecking, onClick: runSelfCheck, children: selfChecking ? "自检中…" : (selfReport ? "重新自检" : "开始自检") })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "逐个来源检查，区分「无匹配/未公布」与「失败」" }),
						selfReport ? (selfReport.error
							? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #d4380d)", fontSize: 12 }, children: "自检失败：" + selfReport.error })
							: (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }, children: [
								(0, react_jsx_runtime.jsx)("div", { children: selfReport.total + " 款游戏 · " + (selfReport.summary.ok + selfReport.summary.nomatch + selfReport.summary.unconfigured + selfReport.summary.down) + " 个来源：成功 " + selfReport.summary.ok + " / 无匹配/未公布 " + selfReport.summary.nomatch + " / 未配置 " + selfReport.summary.unconfigured + " / 失败 " + selfReport.summary.down + " · 用时 " + (selfReport.elapsedMs / 1000).toFixed(1) + "s" }),
								selfReport.problems.length === 0
									? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-business-primary)" }, children: "✓ 所有来源都正常" })
									: (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [
										(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)" }, children: "需要关注：" }),
										selfReport.problems.map((p, i) => (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-primary)" }, children: "· " + p }, i))
									] })
							] })) : null
					] }),
					(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "数据来自各游戏官方公告、官方 Wiki 与第三方站；无数据时对应列留空" })
				]
			});
		}
		//#endregion
