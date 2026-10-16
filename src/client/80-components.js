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
				return (0, react_jsx_runtime.jsx)("span", {
					className: "gacha-cal-icon-fb",
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
				src: icon, alt: name, loading: "lazy", style: Object.assign({}, box, { objectFit: "cover" }),
				onError: () => setFailed(true)
			});
		}

		// ══ 实验特性：新「二游日历」面板视图（`settings.newPanel === true` 时才渲染）══
		// 设计稿（**唯一真源**）：dsh-gacha-ui-lab/a-v6.html（效果图 a-v6.png）
		//
		// 结构自上而下，与设计稿一一对应（类名统一 `gacha-cal-sched-*`，样式见 70-styles.js）：
		//   ① 标题「二游日历」+ 日期胶囊（**没有**总计数胶囊）
		//   ② 一行总览：今天 N 条到期 · N 条即将开始 · N 条在期 · N 个来源刷新失败
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
		function scheduleGameColor(g) {
			const own = g && typeof g.color === "string" ? g.color.trim() : "";
			if (own) return own;
			const name = String((g && g.name) || "");
			let h = 0;
			for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
			return SCHEDULE_PALETTE[h % SCHEDULE_PALETTE.length];
		}

		// 一条档期 = 某款游戏的卡池侧或活动侧。读不出绝对档期的（源站原文）按"长期"处理，
		// **不**硬凑一个天数——这也是设计稿里"点线 + 长期"两字的来由。
		function scheduleNormalize(g, side, now) {
			const isG = side === "gacha";
			const title = (isG ? g.banner : g.event) || "";
			const raw = (isG ? g.bannerDates : g.eventDates) || "";
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
			const datesRaw = (isG ? g.bannerDatesRaw : g.eventDatesRaw) || raw;
			const orig = title + (datesRaw ? "\n" + datesRaw : "");
			return { key: g.id + ":" + side, g, side, isG, title, show, orig, raw, fail, state, startTs, endTs, remain };
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
			if (out.length < 2) return [];
			return out;
		}
		// 把 { title, win } 补成与 scheduleNormalize **同形**的条目（渲染层只认这一种形状）
		function scheduleHoverOnes(items, it, now) {
			const out = [];
			for (const x of items) {
				if (x.title === it.title) continue;                  // 外显那条已经有了，不重复列
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
				const head = [x.title, x.raw].filter(Boolean).join("\n");
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
						(0, react_jsx_runtime.jsx)("b", { children: it.g.name }),
						(0, react_jsx_runtime.jsx)("i", { children: it.title })
					] }),
					(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-slot-dd", children: [
						(0, react_jsx_runtime.jsx)("em", { children: String(slotLeftDays(it, now)) }), " 天后结束"
					] })
				] });
			}
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
					onPointerLeave: () => setHeld(false),
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
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-gn", children: it.g.name }),
									(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-slot-days", children: [
										(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-slot-n", children: String(slotLeftDays(it, now)) }),
										(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-slot-u", children: "天后结束" })
									] }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-ttl", children: it.title }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-sub", children: slotSub(it, frac) })
								]
							});
						}) }),
						rows.length ? (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-more", children: rows.map((x) => slotLine(x, now)) }) : null
					]
				});
			}
		function ScheduleView({ games, now, s, refreshing, onRefresh, lastRefreshText, scrapeInfo, scrapeLines }) {
			// 每一格（游戏 × 卡池/活动）的候选档期。已结束的**留在格子里**（这一侧没有在期内容时它就是
			// 这格的代表，图案走斜纹），但不进「近期」—— 近期回答的是"现在该看哪几条"。
			const cells = new Map();
			const all = [];
			for (const g of games) {
				for (const side of ["gacha", "event"]) {
					const it = scheduleNormalize(g, side, now);
					if (!it) continue;                       // 这一侧没有任何数据 → 格子里写"该来源无数据"
					// 同格并列多条：**外显那条排最前**，其余由悬停文本解析补上（解析不出、或只有一条 → 就只有外显）。
					// ⚠️ 「近期」只收外显那条（all 的语义不变）—— 大列表改版不动「近期」。
					const extras = scheduleHoverOnes(
						scheduleHoverItems(side === "gacha" ? g.bannerHover : g.eventHover, it.title, it.isG), it, now);
					// ⚠️ 有并列池时，外显**不能**再显示引擎给的"合并角色表"：
					//    探头会把每个池连角色再列一遍（原神 = 丝柯克/爱可菲 两个池、鸣潮 = 3 个池各列一遍），
					//    同一批角色"先合并说一遍、再分池说一遍"正是用户看到的重复 + 粒度混乱。
					//    所以：有并列池 ⇒ 外显回到池名（角色名在探头的每一池里）；只有一池 ⇒ 外显就是角色名。
					if (extras.length) {
						// 探头第一条若"以池名开头"，说明它与外显是同一条：把角色名提到外显、并不再重复列它。
						// （外显用前缀判断而不是"整行相等"：终末地的外显是「祀」，悬停行是「「万物更新」特许寻访」，
						//  两者不构成前缀 ⇒ 不会被误删，之前那次误删就是吃了"整行相等"的亏。）
						const firstTitle = extras[0] && extras[0].title ? String(extras[0].title) : "";
						if (it.title && firstTitle.indexOf(it.title) === 0) {
							const rolePart = firstTitle.slice(it.title.length).replace(/^[：:]\s*/, "");
							it.show = rolePart ? (cleanRoleNames(rolePart, g.id) || rolePart) : it.title;
							extras.shift();
						} else {
							it.show = it.title;
						}
					}
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
			// 总览里的"来源"按**来源名**去重：同一款的两侧都挂了也只算一个来源。
			const failedSources = [];
			for (const x of failed) {
				const n = sourceNameOf(x) || x.g.name;
				if (!failedSources.includes(n)) failedSources.push(n);
			}
			const dueCount = all.filter((x) => x.state === "live" && x.remain <= SCHEDULE_DUE_MS).length;
			const waitCount = all.filter((x) => x.state === "wait").length;
			const liveCount = all.filter((x) => x.state === "live" || x.state === "long").length;
			// 「近期」= **7 天内有事发生**（到期或开始）；更远的只出现在下方游戏表里
			// （用户 2026-10-15：不能把 20 多天后的也算近期）。长期/已结束不进近期。
			const SCHEDULE_NEAR_MS = SCHEDULE_AMBER_MS;
			// 「近期」默认只列前 10 条（已按紧迫度排序），其余折进「还有 N 条」；展开走纯 CSS 的 checkbox，不依赖 state/hook。
			const SCHEDULE_NEAR_LIMIT = 10;
			const scheduleNear = (x) => (x.state === "wait"
				? x.startTs != null && x.startTs - now.getTime() <= SCHEDULE_NEAR_MS
				: x.state === "live" && x.remain <= SCHEDULE_NEAR_MS);
			const recent = all.filter(scheduleNear).sort((a, b) => schedulePickItem(a, b) || (a.g.name < b.g.name ? -1 : a.g.name > b.g.name ? 1 : 0));
			// 「近期」循环：每 4 秒整体换一批（每批 SCHEDULE_NEAR_LIMIT 条，末页用取模环绕 ⇒ 永远满 10 条、且能转遍全部）。
			// 悬停、或点了「展开全部」时都停住 —— 想看全就展开，想停在某批就把鼠标放上去。
			const [nearHeld, setNearHeld] = (0, react.useState)(false);
			const [nearAll, setNearAll] = (0, react.useState)(false);
			const nearPages = Math.max(1, Math.ceil(recent.length / SCHEDULE_NEAR_LIMIT));
			const nearPage = useCycle(nearPages, SCHEDULE_SLOT_SECS, nearHeld || nearAll);
			const nearRows = (nearAll || recent.length <= SCHEDULE_NEAR_LIMIT)
				? recent
				: Array.from({ length: SCHEDULE_NEAR_LIMIT }, (_, i) => recent[(nearPage * SCHEDULE_NEAR_LIMIT + i) % recent.length]);
			const days = scheduleDays(now);
			// 日期胶囊：设计稿写「10 月 5 日 · 周日」
			const datePill = now.getMonth() + 1 + " 月 " + now.getDate() + " 日 · " + SCHEDULE_WEEKDAYS[now.getDay()];
			const sep = () => (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-sep", children: "·" });
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
						(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-who", children: x.g.name }),
						(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-sched-kind", "data-t": x.isG ? "gacha" : "event", children: [
							scheduleKindIcon(x.isG ? "gacha" : "event", "gacha-cal-sched-tic"),
							(0, react_jsx_runtime.jsx)("span", { children: x.isG ? "卡池" : "活动" })
						] }),
						(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-what", title: scheduleHoverText(x), children: x.title || x.raw || "—" }),
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
				const sorted = list.slice().sort(schedulePickItem);
				const it = sorted[0];
				// 同格多条（2026-10-15 定稿）：**第一条完整三行**（名称 / 档期·状态 / 迷你条），
				// 其余收进「探头」：收起只露顶部 12px 且虚化，悬停时该格底板向下变长**覆盖**下面的行
				// （下面的行位置一格不动、格子高度恒定、文字不位移）。不再写「另有 N 条」文字。
				const itemOf = (x, key) => (0, react_jsx_runtime.jsxs)("div", {
					key, className: "gacha-cal-sched-item", "data-u": scheduleUrgency(x),
					children: [
						(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cn", title: x.orig || x.title || x.raw || "—", children: x.show || x.title || x.raw || "—" }),
						(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cm gacha-cal-sched-num", children: scheduleMeta(x, now) }),
						scheduleBars(x, days)
					]
				});
				const rest = sorted.slice(1);
				return (0, react_jsx_runtime.jsxs)("div", {
					className: "gacha-cal-sched-cell", "data-t": side, "data-u": scheduleUrgency(it),

					children: [
						itemOf(it, "first"),
						rest.length ? (0, react_jsx_runtime.jsx)("div", {
							className: "gacha-cal-sched-rest",
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
				style: { "--g": scheduleGameColor(g), "--z": String(900 - i) },
				children: [
					(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-gm", title: buildRowTitle(g), children: [
						scheduleIcon("gacha-cal-sched-gic", g, 38),
						(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-gn", children: g.name })
					] }),
					cellView(g, "gacha"),
					cellView(g, "event")
				]
			});


			return (0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched", children: [
				// ① 标题「二游日历」+ 日期胶囊
				(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-head", children: [
					(0, react_jsx_runtime.jsx)("h4", { children: "二游日历" }),
					(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-sp", children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-pill gacha-cal-sched-pill--live", children: datePill }) })
				] }),
				// ② 一行总览
				(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-glance", children: [
					"今天 ", (0, react_jsx_runtime.jsx)("b", { children: String(dueCount) }), " 条到期",
					sep(), (0, react_jsx_runtime.jsx)("b", { children: String(waitCount) }), " 条即将开始",
					sep(), (0, react_jsx_runtime.jsx)("b", { children: String(liveCount) }), " 条在期",
					failedSources.length ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [sep(), (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-warn", children: String(failedSources.length) + " 个来源刷新失败" })] }) : null
				] }),
				// ③ 「近期」：跨游戏、按紧迫度、全列出；右侧是「下一个截止」卡（见上）
				(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-recent", children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: "gacha-cal-sched-urgent",
						onPointerEnter: () => setNearHeld(true),
						onPointerLeave: () => setNearHeld(false),
						children: recent.length
						? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-nearpg", key: nearAll ? "all" : "p" + nearPage, children: nearRows.map(recentRow) }),
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
				games.length
					? games.map(rowOf)
					: (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-empty", children: "还没有勾选任何游戏 · 去设置里挑几款" }),

				// ⑤ 刷新失败横条 + 重试（重试 = 整轮刷新：引擎没有单源刷新接口，见 50-refresh.js）
				failed.length ? (0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-failbar", title: failRows.join("\n"), children: [
					scheduleWarnIcon("gacha-cal-sched-fic"),
					(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-failtext", children: failRows[0] }),
					(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sched-retry", disabled: refreshing, onClick: onRefresh, children: "重试" })
				] }) : null,
				// ⑦ 底部：上次更新 X 分钟前 + 刷新（悬停给绝对时间与逐条抓取明细，信息不与旧面板脱节）
				(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-foot", children: [
					(0, react_jsx_runtime.jsx)("span", { title: [lastRefreshText, scrapeInfo].concat(scrapeLines || []).filter(Boolean).join("\n"), children: "上次更新 " + scheduleAgo(s.lastRefresh, now) }),
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

			(0, react.useEffect)(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);

			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };
			// 面板高度**实测回写**（内联 + !important）：实测 DSH 侧栏环境下这个盒子会被外部撑高，
			// 顶部到底部那一段空白就是它，而 top/height/min-height/flex 四种 CSS 复位都压不住。
			// 这里直接量内容高度写回；内联 !important 优先级最高，任何来源都盖不过。
			// 内容变高（数据刷新等）由 ResizeObserver 跟随；超高时按 72vh 封顶，交给视图内部滚动。
			(0, react.useEffect)(() => {
				const el = popRef.current;
				if (!open || !el) return;
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
			// 最近一次抓取结果按游戏 id 索引；解析失败/未联网时为 {}
			let scrapedById = {};
			try { scrapedById = JSON.parse(s.lastData || "{}") || {}; } catch { scrapedById = {}; }
			// 清理历史抓取数据中残留的版本号字段（新版解析器已不产出）
			for (const k of Object.keys(scrapedById)) {
				const v = scrapedById[k];
				if (v && typeof v === "object" && "version" in v) delete v.version;
			}
			// 可见条目（隐藏/已删除的不显示）；抓取成功的数据覆盖卡池/活动列
			const visible = getVisibleEntries(s);
			const games = applyOrder(visible, s.order).map((g) => {
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
			});

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

			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)("button", {
						ref: triggerRef,
						type: "button",
						className: "gacha-cal-btn",
						"aria-label": label,
						onClick: () => setOpen((v) => !v),
						children: [
							(0, react_jsx_runtime.jsx)("svg", { "aria-hidden": "true", width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
								children: [
									(0, react_jsx_runtime.jsx)("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }),
									(0, react_jsx_runtime.jsx)("line", { x1: "16", y1: "2", x2: "16", y2: "6" }),
									(0, react_jsx_runtime.jsx)("line", { x1: "8", y1: "2", x2: "8", y2: "6" }),
									(0, react_jsx_runtime.jsx)("line", { x1: "3", y1: "10", x2: "21", y2: "10" })
								]
							}) }),
							wide === false ? null : (0, react_jsx_runtime.jsx)("span", { children: label })
						]
					}),
					open && anchor !== void 0 ? (0, react_jsx_runtime.jsx)("div", {
						ref: (el) => {
							popRef.current = el;
							if (!el) return;
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
						className: "gacha-cal-pop",
						style: { left: anchor.left, bottom: anchor.bottom },
						// ⚙️ 实验特性分支 —— **唯一**的切换点。
						//    `s.newPanel === true` 才走新日程视图；否则 children 就是下面那个
						//    **一字未改的原数组**（旧的标题 + meta + 表头 + games 表格）。
						//    默认关 → 旧面板 DOM 与行为零变化，这是回退路径。
						children: s.newPanel === true
							? (0, react_jsx_runtime.jsx)(ScheduleView, {
								games, now, s, refreshing, onRefresh: doRefresh,
								lastRefreshText, scrapeInfo, scrapeLines
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
										// 起止列：倒计时用补全后的时间；悬停显示源站原文（如"4.5版本更新后 ~ …"）
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.bannerDatesRaw || g.bannerDates, "gacha", g.gachaFail, g.gachaStale, gachaUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: (0, react_jsx_runtime.jsx)("b", { children: displayTimeCell(g.bannerDates || "", now) }) }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.eventHover || eventTitle, "event", g.eventFail, g.eventStale, eventUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: eventName }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.eventDatesRaw || g.eventDates, "event", g.eventFail, g.eventStale, eventUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: displayTimeCell(g.eventDates || "", now) }) })
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
			const [form, setForm] = (0, react.useState)({ name: "", icon: "", url: "", eventUrl: "" });
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
			(0, react.useEffect)(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
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

			// 保存失败必须可见：旧实现只 await 不 catch，写被宿主拒绝时控件弹回原值、
			// 用户只会觉得"点了没反应"（「重置排序」写 null 被拒就是这种病的极端例子）
			//
			// DSH 0.1.7 起这里多了一个坑：`configForms` 的 set() **返回布尔值而不是抛错**
			// （旧 settingsScope 的 set() 失败会抛）。所以只写 try/catch 的话，
			// "宿主拒绝写入"会被当成成功，控件照样弹回、依旧没有任何提示。
			// 必须显式判返回值：false = 宿主没接受（多半是该字段没进表单 / 修订号冲突 / 页面只读）。
			const [saveError, setSaveError] = (0, react.useState)("");
			const commit = async (key, value) => {
				try {
					const accepted = await scope.set(key, value);
					if (accepted === false) throw new Error(formRejectHint(scope, key));
					setSaveError("");
				} catch (err) {
					setSaveError("\u4FDD\u5B58\u5931\u8D25\uFF1A" + String((err && err.message) || err || "未知错误"));
				}
				setSnapshot(scope.getSnapshot());
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
			const toggleHidden = async (id) => {
				const isHiddenNow = isEntryHidden(allEntries.find((x) => x.id === id) || {}, s);
				if (isHiddenNow) {
					// 打开：从 hidden 摘掉，并记进 shown（这样 defaultHidden 的条目也能被打开）
					await commit("hidden", hidden.filter((x) => x !== id));
					if (!shown.includes(id)) await commit("shown", [...shown, id]);
				} else {
					// 关掉：记进 hidden，并从 shown 摘掉（否则 defaultHidden 条目会出现"勾了却仍然显示"的矛盾）
					if (!hidden.includes(id)) await commit("hidden", [...hidden, id]);
					if (shown.includes(id)) await commit("shown", shown.filter((x) => x !== id));
				}
			};
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
				const urls = parseJsonStr(s.customUrls, {});
				if (!urls || typeof urls !== "object" || !Object.prototype.hasOwnProperty.call(urls, id)) return "default";
				const v = urls[id];
				if (typeof v === "string" && v.startsWith("custom:")) return "custom";
				return normalizeSourceId(v); // 备选源标识（老配置的 proxy:/gk-*: 在这里翻译成新标识）
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
				const eu = parseJsonStr(s.customEventUrls, {});
				if (!eu || typeof eu !== "object" || !Object.prototype.hasOwnProperty.call(eu, id)) return "default";
				const v = eu[id];
				return String(v ?? "").startsWith("custom:") ? "custom" : normalizeSourceId(v);
			};
			const setEventUrlMode = async (id, mode) => {
				const next = { ...(eventUrls || {}) };
				if (mode === "custom") next[id] = "custom:" + (eventCustomInputs[id] ?? "");
				else delete next[id];
				await commit("customEventUrls", JSON.stringify(next));
			};
			const setCustomEventUrl = async (id, value) => {
				setEventCustomInputs((p) => ({ ...p, [id]: value }));
				const next = { ...(eventUrls || {}) };
				next[id] = "custom:" + value;
				await commit("customEventUrls", JSON.stringify(next));
			};
			// 添加自定义条目：名称/图标手动填，卡池与活动内容由链接解析产出
			const addEntry = async () => {
				if (!form.name.trim() || !form.url.trim()) return;
				const id = "custom-" + Date.now().toString(36);
				const entry = {
					id,
					name: form.name.trim(),
					icon: form.icon.trim(),
					url: form.url.trim(),
					eventUrl: form.eventUrl.trim()
				};
				await commit("customEntries", JSON.stringify([...customs, entry]));
				setForm({ name: "", icon: "", url: "", eventUrl: "" });
				setAdding(false);
			};
			const updateForm = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

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
							(0, react_jsx_runtime.jsxs)("select", { value: String(currentMinutes), onChange: (e) => commit("refreshMinutes", Number(e.target.value)), children: [
								!inOptions ? (0, react_jsx_runtime.jsx)("option", { value: String(currentMinutes), children: "自定义（" + currentMinutes + " 分钟）" }) : null,
								REFRESH_OPTIONS.map((o) => (0, react_jsx_runtime.jsx)("option", { value: String(o.minutes), children: o.label }, o.minutes))
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
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: resetOrder, children: "重置排序" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: restoreAll, children: "恢复条目" })
							] })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "「展示」控制显示；「↑↓」调整顺序；来源可切换或自定义。" }),
						// 表头行（与数据行同 grid 列；全部居中，与下方各列边界对齐）
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "minmax(90px,1fr) auto minmax(130px,1.2fr) minmax(130px,1.2fr) auto", gap: 10, alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-tertiary)", fontSize: 11 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6E38\u620F" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5C55\u793A" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5361\u6C60\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6D3B\u52A8\u6765\u6E90" }),
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
										style: { display: "grid", gridTemplateColumns: "minmax(90px,1fr) auto minmax(130px,1.2fr) minmax(130px,1.2fr) auto", gap: 10, alignItems: "center", padding: "4px 0" },
										children: [
											(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 }, children: [
												(0, react_jsx_runtime.jsx)(GameIcon, { icon: g.icon, name: g.name, size: 22 }),
												(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name gacha-cal-settings-name", style: { flex: "1 1 auto", minWidth: 0 }, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) })
											] }),
											(0, react_jsx_runtime.jsxs)("label", { style: { ...labelStyle, cursor: "pointer", justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !isEntryHidden(g, s), onChange: () => toggleHidden(g.id) }),
												(0, react_jsx_runtime.jsx)("span", { children: "\u5C55\u793A" })
											] }),
											// 卡池来源选择器
											(0, react_jsx_runtime.jsxs)("select", {
												value: mode,
												style: { ...inputStyle, textAlign: "center" },
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
												style: { ...inputStyle, textAlign: "center" },
												onChange: (e) => setEventUrlMode(g.id, e.target.value),
												children: [
													(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g, "eventUrl") }),
													(g.eventAltSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: altSourceId(a), children: a.label }, a.fetcher)),
													(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "自定义" })
												]
											}),
											(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 4, justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", title: "\u4E0A\u79FB", disabled: i === 0, onClick: () => move(g.id, -1), children: "\u2191" }),
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", title: "\u4E0B\u79FB", disabled: i === sorted.length - 1, onClick: () => move(g.id, 1), children: "\u2193" }),
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn gacha-cal-del-btn", title: "\u5220\u9664", onClick: () => removeEntry(g), children: (0, react_jsx_runtime.jsx)("svg", {
													width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
													children: [
														(0, react_jsx_runtime.jsx)("path", { d: "M3 6h18" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }),
														(0, react_jsx_runtime.jsx)("line", { x1: "10", y1: "11", x2: "10", y2: "17" }),
														(0, react_jsx_runtime.jsx)("line", { x1: "14", y1: "11", x2: "14", y2: "17" })
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
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "图标 URL（可选）", value: form.icon, onChange: updateForm("icon"), style: { ...inputStyle, flex: "1 1 240px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "卡池来源链接（必填）", value: form.url, onChange: updateForm("url"), style: { ...inputStyle, flex: "1 1 300px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "活动来源链接（可选）", value: form.eventUrl, onChange: updateForm("eventUrl"), style: { ...inputStyle, flex: "1 1 300px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", disabled: !form.name.trim() || !form.url.trim(), onClick: addEntry, children: "\u6DFB\u52A0" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: () => setAdding(false), children: "\u53D6\u6D88" })
							] })
						] }) : (0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { alignSelf: "flex-start", marginTop: 6 }, onClick: () => setAdding(true), children: "+ \u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" })
					] }),
					// 解析器自检：逐源检查「没内容 / 报错」，源站改版后用来定位问题。只读（core 的 selfCheck() 保证）
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "解析器自检" }),
							(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-refresh", disabled: selfChecking, onClick: runSelfCheck, children: selfChecking ? "自检中…" : (selfReport ? "重新自检" : "开始自检") })
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
