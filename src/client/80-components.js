		//#region components
		// 本插件在 DSH 设置面板里的导航名；面板按钮与弹层标题也用它（唯一事实来源，90-plugin.js 注册分区时共用）。
		const SETTINGS_SECTION_LABEL = "\u4E8C\u6E38\u65E5\u5386";
		// 面板上那个「设置」按钮：**临时隐藏**（用户要求）。函数与样式都保留，
		// 改回 true 即可恢复，不用重写逻辑。
		const SETTINGS_BUTTON_VISIBLE = false;
		// DSH 设置面板是"点了才挂载"，打开后要等导航渲染出来才能切页；预算给足但不无限等。
		const SETTINGS_NAV_TIMEOUT_MS = 600;
		const SETTINGS_NAV_POLL_MS = 30;

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

		// ── 到期提醒：把落盘的文本档期还原成**绝对窗口**（2026-10-25）────────────────
		// 判定本体是 60-helpers.js 的 isExpiringSoon（纯函数）；这里只负责"某一侧什么时候结束"。
		// 走的**就是面板外显那条换算链**：localDatesOf（绝对档期优先 → 否则「源站墙钟文本 + tz」
		// 换成本机墙钟文本）→ parseDisplayRange（把本机墙钟文本解释回绝对时刻）。
		// ⇒ 红点与面板上那句"还剩 X"永远同源，不会出现"红点亮着、面板说还剩 3 天"。
		// 读不出绝对档期（源站原文是"版本更新后 ~ …"/"长期"、自定义条目没填 tz）→ null，
		// 该侧**不参与**提醒（不硬凑一个猜测的结束时刻）。
		function remindWindowOf(g, isG, now) {
			if (!g) return null;
			const text = localDatesOf(g, isG, now);
			if (!text) return null;
			const r = parseDisplayRange(text, now);
			return r || null;
		}

		// 该提醒的档期清单（侧栏按钮轮播用；带方向与名称，供文案/悬停说明）。
		// 输入 = CalendarPanel 已经算好的 `games`（可见条目 + 最近一轮抓取结果已覆盖），
		// 所以"提醒的是用户真正看得见的那些行"，隐藏条目不会偷偷提醒。
		//
		// 2026-10-25 晚升级（用户要求）：**双向** —— 即将结束（end）+ 即将开始（start）都算。
		// 判定本体在 60-helpers.js 的纯函数 remindKindOf（固定时刻可测）；本函数只做两件"离不开渲染层"的事：
		//   ① 把落盘的文本档期换算成绝对窗口（remindWindowOf，与面板外显同一条链）；
		//   ② 按「提醒」开关（remindGames）筛掉不参与的条目 —— 筛选/排序都在纯函数 remindPickOf 里，
		//      这样"列表里有谁就提醒谁（空 = 一个都不提醒）"的口径只有一处实现。
		// 返回按"距离那一刻还有多久"升序（最紧迫在前）；N <= 0（关闭）→ 空数组（**不做任何换算**）。
		// 2026-10-25 二次定稿（用户 C 方案）：每条多带一个 `gameIcon`（该条目自己的图标，取自
		// SOURCES/customEntries 的 `icon`）—— 轮播**整行连图标一起翻**，图标就是"这是哪款游戏"的
		// 唯一线索（文字改成显示事项名，不再写游戏名）。
		function remindDueOf(games, now, remindHours, remindGames) {
			const hours = Number(remindHours);
			if (!(hours > 0) || !Array.isArray(games) || !now) return [];
			const out = [];
			for (const g of games) {
				if (!g) continue;
				for (const side of ["gacha", "event"]) {
					const isG = side === "gacha";
					const title = (isG ? g.banner : g.event) || "";
					if (!title) continue;
					const w = remindWindowOf(g, isG, now);
					if (!w) continue;
					const roles = isG ? (g.roles || "") : "";
					out.push({
						key: g.id + ":" + side,
						id: g.id,
						// 筛选键独立于 `id` 字段名，免得 remindPickOf 的调用方还要知道 id 是哪一层
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
			return remindPickOf(out, now.getTime(), hours, remindGames);
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
		// 通用循环器：每 seconds 秒把 step 推一格（count 格一轮）；paused 时不排下一拍。
		// 近期分页与留白卡共用；模块级 hook ⇒ 组件身份稳定，状态不会被父级重渲染重置。
		function useCycle(count, seconds, paused) {
			const [step, setStep] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (paused || count <= 1) return;
				const t = window.setInterval(() => setStep((v) => (v + 1) % count), seconds * 1000);
				return () => window.clearInterval(t);
			}, [count, seconds, paused]);
			return count > 0 ? step % count : 0;
		}

		// 侧栏按钮轮播的节拍（秒）。用户要求"每 4~6 秒切一条"；5 秒 = 能读完一条、又不至于像卡住。
		const REMIND_SLIDE_SECS = 5;

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

			// ── 到期提醒：侧栏按钮的**单行轮播**（2026-10-25 晚，替代原来的小红点）────────────
			// 设置 = 设置页的「到期提醒」（提前 N 小时，0 = 关闭）+ 每行「提醒」开关（remindGames）。
			// **关闭时不滚动、也不做任何计算**：下面 memo 在 hours<=0 时直接返回同一个空数组
			// （remindDueOf 的第一行就短路），不会去解析任何档期文本。
			//
			// 轮播怎么感知"数据变了"（这是本功能唯一需要想清楚的地方）：
			//   不需要新机制 —— 侧栏按钮与面板是**同一个组件**（CalendarPanel），而这个组件早就
			//   订阅了宿主配置表单（上面的 `scope.subscribe(() => setSnapshot(scope.getSnapshot()))`）。
			//   刷新链路把结果写回设置（lastData / lastRefresh）后，宿主会经同一个 store 推送新快照
			//   → setSnapshot → 重渲染 → `games` 变 → 这个 memo 重算 → 轮播内容/条目数跟着变。
			//   时间和阈值那一条则靠组件已有的每分钟时钟 `now`（跨过 N 小时边界时自然翻面）。
			//   ⇒ 一行订阅都不用加、也不用把状态提升到 apply() 层（那会多一个与面板生命周期
			//   不同步的订阅，还得自己处理卸载）。这是本次能做到的最小改动。
			const remindHours = Number(s.remindHours ?? DEFAULT_SETTINGS.remindHours) || 0;
			// remindGames 与 hidden/shown 一样按**值**派生依赖键：宿主每次写入都会换掉数组引用，
			// 按引用当依赖等于这个 memo 永不命中（理由见上面 *Key 那一段）。
			const remindGamesKey = (Array.isArray(s.remindGames) ? s.remindGames : []).join("\u0000");
			const remindDue = (0, react.useMemo)(
				() => remindDueOf(games, now, remindHours, Array.isArray(s.remindGames) ? s.remindGames : []),
				[games, now, remindHours, remindGamesKey]);
			// 轮播的"一格"：0 = 原按钮外观（日历图标 + 「二游日历」），1..n = 第 n 条提醒。
			// 用户要求整行内容在「原按钮外观」和「一条近期内容」之间竖向翻页 ⇒ 原外观也是轮播的一格，
			// 而不是被替换掉后永远不回来。
			// 2026-10-25 二次定稿（用户选的 **C 方案**）：一格 = `[游戏图标] 事项名 · X`
			//   （三次定稿又去掉了状态前的「还剩」：`· 还剩 8 小时` → `· 8 小时`，≥1 天只说 `3 天`；
			//    悬停/读屏那一份仍带「还剩」，见下面 remindHintNames 用 ariaText）；
			//   · 文案交给纯函数 remindSlidesOf（事项名优先、状态单独一段），本层只管排版；
			//   · 图标**跟着整行翻**（状态 0 是日历图标、状态 i 是该游戏自己的图标），不再留固定的日历图标。
			const remindSlides = remindSlidesOf(remindDue, now.getTime());
			const reduceMotion = usePrefersReducedMotion();
			const [btnHover, setBtnHover] = (0, react.useState)(false);
			// 悬停暂停 = 把 useCycle 的 paused 打开（不排下一拍），而不是暂停 CSS 动画：
			// 翻页动画是一次性的 0.42s，暂停它只会把画面冻在半路；这里要停的是"切内容"的节拍。
			const slideStep = useCycle(remindSlides.length + 1, REMIND_SLIDE_SECS,
				remindSlides.length === 0 || reduceMotion || btnHover);
			// reduce 时**不滚动**、但也不回到"看起来没事"的原样：静态钉在第一条提醒上
			// （用户要求"仍要能看出有事"）。无提醒时自然是第 0 格 = 原按钮外观。
			const shownStep = reduceMotion && remindSlides.length > 0 ? 1 : slideStep;
			// 上一格的内容要**留在 DOM 里**才能做出"交叉滚动"（旧的往上走、新的从下面进来）。
			// 用 ref 记上一次渲染的格号：格号变了的那一次渲染里 prevStep = 旧格号，effect 之后再对齐。
			// （若改成"渲染时直接改 ref"，React 严格模式下可能被重复执行；effect 版本最稳。）
			const prevStepRef = (0, react.useRef)(shownStep);
			const prevStep = prevStepRef.current === shownStep ? shownStep : prevStepRef.current;
			(0, react.useEffect)(() => { prevStepRef.current = shownStep; }, [shownStep]);
			// 原按钮的日历图标（16px，与 .gacha-cal-btn svg 的规则一致）。C 方案里它只在
			// **状态 0 那一格**出现（跟着翻页走），所以抽成变量给 remindLine 用。
			const calIcon = (0, react_jsx_runtime.jsx)("svg", { "aria-hidden": "true", width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }),
					(0, react_jsx_runtime.jsx)("line", { x1: "16", y1: "2", x2: "16", y2: "6" }),
					(0, react_jsx_runtime.jsx)("line", { x1: "8", y1: "2", x2: "8", y2: "6" }),
					(0, react_jsx_runtime.jsx)("line", { x1: "3", y1: "10", x2: "21", y2: "10" })
				]
			}) });
			// 一格的内容：0 = 原按钮外观（日历图标 + 「二游日历」），其余 = 一条提醒（游戏图标 + 事项名 + 状态）。
			// **图标也在这一行里** —— 它跟整行一起翻（C 方案），所以不参与按钮的固定布局。
			// 名字与状态**分开两个盒子**：名字可省略号截断、状态 flex:none 永不截断 ——
			// 窄侧栏里必须留下「· 3 小时 / · 明天开池 / · 24 天」。
			// 分隔符带**前导空格**（" · "）：上一版只写了 "· "，渲染出来是「少女· 3 小时」，少一个空格
			// （用户 2026-10-25 指出）。.gacha-cal-btn-st 的 white-space:pre 保证这个空格不被折叠掉。
			// slot 只用于 React 的 key（同一个 flip 层里两行：cur / prev）。
			const remindLine = (idx, slot) => {
				const slide = idx > 0 ? remindSlides[idx - 1] : null;
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
			// 2026-10-25 晚起提醒是**双向**的，所以措辞从"N 小时内到期"改成"N 小时内提醒"；
			// 每条带上方向与剩余时间 —— 直接复用轮播那一份文案（remindSlidesOf 的 ariaText），
			// 保证两处不会说两套话。
			// ⚠️ 这里用 ariaText 而**不是** text：按钮上为了省宽度去掉了「还剩」（"· 8 小时"），
			//    但读屏/悬停是句子，必须有「还剩」才通顺（"…，还剩 8 小时"）—— 两处唯一的差别就是这个词。
			// 名称最多列 3 条 —— 侧栏这个悬停是个窄提示，不是面板。
			// C 方案起文字只写**事项名**（游戏名让位给图标），悬停这里补一句"哪款游戏"，
			// 否则读屏用户听到一串活动名却不知道属于谁。
			const remindHintNames = remindSlides.slice(0, 3).map((x) =>
				(x.gameName && x.gameName !== x.itemName ? x.gameName + "\uFF1A" : "") + x.ariaText);
			const remindHint = remindDue.length
				? remindHours + " \u5C0F\u65F6\u5185 " + remindDue.length + " \u9879\u63D0\u9192" +
					(remindHintNames.length ? "\uFF1A" + remindHintNames.join("\u3001") +
						(remindDue.length > remindHintNames.length ? " \u7B49" : "") : "")
				: "";

			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)("button", {
						ref: triggerRef,
						type: "button",
						className: "gacha-cal-btn",
						"aria-label": remindDue.length ? label + "\uFF08" + remindHint + "\uFF09" : label,
						// 悬停说明挂在**按钮**上：红点（窄侧栏降级）带 pointer-events:none 不参与命中测试，
						// 把 title 放在它身上等于永远不显示。没有提醒项时不加 title（保持按钮原样）。
						title: remindDue.length ? remindHint : void 0,
						// 悬停**暂停轮播**（用户要求）：只停"切内容"的节拍，不冻结正在播的翻页动画
						// （那是一次性 0.42s，冻在半路更难看）。见上面 useCycle 的 paused 参数。
						onMouseEnter: () => setBtnHover(true),
						onMouseLeave: () => setBtnHover(false),
						onClick: () => setOpen((v) => !v),
						children: [
							// 日历图标只在「没有轮播」时固定在按钮上（与历史外观一字不差）；
							// 有轮播时图标属于轮播那一行（C 方案：图标跟着整行翻），由 remindLine 渲染。
							(wide === false || remindSlides.length === 0) ? calIcon : null,
							// 窄侧栏（收起状态）：**没有可滚动的那一行** ⇒ 用户允许的降级 = 小红点。
							// 红点绝对定位、不参与 flex 布局 ⇒ 按钮尺寸/文字位置一个字都不动
							// （用户 2026-10-25 明确要求别再重演"按钮错位"）。关闭（N=0）时 remindDue 恒空。
							wide === false
								? (remindDue.length
									? (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-dot", "aria-hidden": "true" })
									: null)
								// 宽侧栏：有提醒 → 单行轮播（「原按钮外观」也是轮播的一格，会回来）；
								// 没提醒 → **一字未改的原样**（图标 + 一个 span），零风险。
								: (remindSlides.length
									? (0, react_jsx_runtime.jsx)("span", {
										className: "gacha-cal-btn-txt",
										children: (0, react_jsx_runtime.jsxs)("span", {
											// key = 格号：格号一变，React 重挂载这一层 ⇒ CSS 翻页动画从头播一次
											// （一次性 0.42s、fill-mode backwards；播完不留持久层）。
											key: shownStep,
											className: "gacha-cal-btn-flip",
											children: [remindLine(shownStep, "cur"), remindLine(prevStep, "prev")]
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
			// 「提醒」复选框的本地草稿与串行链（2026-10-25 晚）。理由与「展示」**完全相同**：
			// 受控 checked 读 `s`，而宿主写入往返 1.4~3.6s 期间 `s` 还是旧值 ⇒ 不垫草稿就会"点了弹回去"。
			const [remindDraft, setRemindDraft] = (0, react.useState)({});
			const remindWriteChain = (0, react.useRef)(Promise.resolve());
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
			// 「到期提醒」的提前量（小时；0 = 关闭）。同样对"不在选项里的历史值"补一个自定义项。
			const currentRemind = Number(s.remindHours ?? DEFAULT_SETTINGS.remindHours) || 0;
			const remindInOptions = REMIND_OPTIONS.some((o) => o.hours === currentRemind);

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
			// ── 「提醒」开关（2026-10-25 晚；同日**二次定稿**为普通列表语义）────────────────
			// 语义（用户定，必须简单可解释）：remindGames = **参与提醒的条目 id 列表**。
			//   · 列表里有这个 id ⇒ 参与；没有 ⇒ 不参与；**空数组 = 一个都不提醒**。
			//     没有"空 = 全部参与"的哨兵了 —— 那个哨兵让"一个都不提醒"表达不出来，
			//     于是"取消最后一个勾"只能被拒绝（旧实现如此，用户明确要求修掉）。
			//   · 开箱即用靠**出厂默认值**（10-config.js 的 DEFAULT_SETTINGS.remindGames = 出厂时展示中的
			//     条目，守卫见 test/cases-remind.mjs），不靠哨兵。
			// 写入链路照抄「展示」那套（A1 的教训）：目标状态驱动 + 串行链 + 执行时读最新快照。
			// 「展示」关掉的行**不参与**提醒（面板 games 里根本没有它 ⇒ remindDueOf 看不到），
			// 所以 UI 上那一行的复选框直接置灰，不让人在"看不见的条目"上白勾。
			const remindIds = Array.isArray(s.remindGames) ? s.remindGames : [];
			const remindedNow = (id) => (Object.prototype.hasOwnProperty.call(remindDraft, id)
				? !!remindDraft[id]
				: remindGameAllowed(id, remindIds));
			const setEntryRemind = (id, shouldRemind) => {
				const run = remindWriteChain.current.then(async () => {
					const snap = scope.getSnapshot();
					const live = snap && snap.status === "ready" ? snap.value : null;
					const cur = live && Array.isArray(live.remindGames) ? live.remindGames : remindIds;
					// 普通列表语义：加 = 并入，减 = 摘掉。**减到空就写空**（= 一个都不提醒），
					// 不再有"空数组等于全部"的坑，所以这里没有任何"拒绝最后一个勾"的分支。
					const next = shouldRemind
						? (cur.includes(id) ? cur.slice() : [...cur, id])
						: cur.filter((x) => x !== id);
					await commit("remindGames", next);
				});
				remindWriteChain.current = run.catch(() => {});
				return run;
			};
			// 「全部提醒」= 把**当前展示中**的条目 id 一次性写进列表（不是写回空数组 ——
			// 空数组现在是"一个都不提醒"）。没展示的条目本来就不参与提醒，所以不给它们勾。
			// 与逐行勾选走**同一条串行链**，避免两笔写入互相覆盖（宿主往返 1.4~3.6s）。
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
			// 「提醒」草稿的同一套 A5 清理：store 现值已经等于草稿值（或条目被删）⇒ 丢掉草稿。
			// 依赖按**值**（remindGamesKey）而不是数组引用 —— 宿主每次写入都会换掉数组对象。
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
						] }),
						// 到期提醒：总开关 + 时间窗（**保留**原语义，2026-10-25 晚只把外显从红点换成单行轮播）。
						// 有卡池/活动在 N 小时内**结束或开始**时，侧栏「二游日历」按钮变成单行轮播；
						// 「提醒」（下面游戏列表每行一个复选框）决定哪些条目参与。
						// 结构照「刷新频率」那一行；写入走同一条 commit → scope.set 链路（键 = remindHours）。
						// 关闭（0）时面板/轮播都不做任何计算（见 60-helpers.js 的 remindKindOf 第一行）。
						(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, title: "有卡池或活动在 N 小时内结束或开始时，侧栏按钮轮播提醒", children: [
							(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "到期提醒" }),
							(0, react_jsx_runtime.jsxs)("select", { className: "gacha-cal-select", value: String(currentRemind), onChange: (e) => commit("remindHours", Number(e.target.value)), children: [
								!remindInOptions ? (0, react_jsx_runtime.jsx)("option", { value: String(currentRemind), children: "自定义（" + currentRemind + " 小时）" }) : null,
								REMIND_OPTIONS.map((o) => (0, react_jsx_runtime.jsx)("option", { value: String(o.hours), children: o.label }, o.hours))
							] })
						] })
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
								// 「全部提醒」：把**当前展示中**的条目 id 一次性写进「提醒」列表
								// （remindGames = 这些 id ⇒ 它们都参与）。注意**不再写回空数组** ——
								// 空数组现在的意思是"一个都不提醒"（2026-10-25 二次定稿，废弃了"空 = 全部"）。
								// 没展示的条目不参与提醒，所以不给它们勾。
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { width: "auto", height: "auto", padding: "3px 10px", borderRadius: 6 }, title: "把所有展示中的游戏都加入「提醒」", onClick: resetRemindAll, children: "全部提醒" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { width: "auto", height: "auto", padding: "3px 10px", borderRadius: 6 }, onClick: resetOrder, children: "重置排序" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { width: "auto", height: "auto", padding: "3px 10px", borderRadius: 6 }, onClick: restoreAll, children: "恢复条目" })
							] })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "「展示」控制显示；「提醒」控制侧栏轮播；「↑↓」调整顺序；「颜色」取色器换主题色。" }),
						// 「提醒」的语义说明单独一行（上面那行已经到 48 字上限了，别把它撑爆）
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "「提醒」勾上谁就提醒谁；全部不勾 = 都不提醒。未展示的条目不参与。" }),
						// 表头行（与数据行同 grid 列；全部居中，与下方各列边界对齐）
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1.15fr) 28px 28px minmax(0,1fr) minmax(0,1fr) 34px 88px", gap: 12, alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-tertiary)", fontSize: 11 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6E38\u620F" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5C55\u793A" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5F3A\u63D0\u9192" }),
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
										style: { display: "grid", gridTemplateColumns: "minmax(0,1.15fr) 28px 28px minmax(0,1fr) minmax(0,1fr) 34px 88px", gap: 12, alignItems: "center", padding: "8px 0" },
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
											// 「提醒」：侧栏轮播要不要包含这一条（与「展示」**完全独立**）。
											// 显示值 = "在不在这个列表里"（普通列表语义，空 = 谁都不提醒；
											// 语义见 60-helpers.js 的 remindGameAllowed 与 10-config.js 的 remindGames 注释）。
											// ⚠️ 未勾「展示」的行 ⇒ 复选框**置灰（disabled）且不参与**：面板里根本没有这一条，
											//    提醒链路（remindDueOf 只吃展示中的 games）看不到它，勾了也不会生效 ——
											//    与其让人白勾一下，不如直接禁掉（用户 2026-10-25 要求）。
											// 取消最后一个勾是**合法**的（写盘就是空数组 = 一个都不提醒），不再弹错。
											(0, react_jsx_runtime.jsx)("label", {
												style: { ...labelStyle, cursor: shownNow(g) ? "pointer" : "default", justifySelf: "center", opacity: shownNow(g) ? 1 : 0.45 },
												children: (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													checked: remindedNow(g.id),
													disabled: !shownNow(g),
													onChange: () => {
														const next = !remindedNow(g.id);
														setRemindDraft((p) => ({ ...p, [g.id]: next }));
														setEntryRemind(g.id, next);
													}
												})
											}),
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
							(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "名称与图标手动填写；卡池与活动由来源链接解析产出。" }),
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
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "逐个来源检查，区分「无匹配/未公布」与「失败」。" }),
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
					(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "数据来自各游戏官方公告、官方 Wiki 与第三方站；无数据时对应列留空。" })
				]
			});
		}
		//#endregion
