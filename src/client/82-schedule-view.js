		// 侧栏按钮轮播的节拍（秒）。用户要求"每 4~6 秒切一条"；5 秒 = 能读完一条、又不至于像卡住。
		const TICKER_SLIDE_SECS = 5;

		// 「系统要求减少动效」开关（用户要求：prefers-reduced-motion: reduce 时**完全不滚动**，
		// 只静态显示内容，仍要能看出"有事"）。
		//   · 走 matchMedia 订阅而不是渲染时读一次：用户在系统设置里改，页面里立刻跟上；
		//   · 老浏览器的 addListener/removeListener 兜底（Safari < 14）；
		//   · 拿不到 matchMedia（测试桩/极老环境）时按 false 处理 —— 与默认观感一致。
		// ⚠️ 这只是**JS 侧**那一半（停掉轮播、固定显示第一条）。CSS 侧还有一条
		//    `@media (prefers-reduced-motion:reduce){.gacha-cal-btn-flip{animation:none}}`（styles/ticker.css），
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
		function ScheduleView({ games, now, s, colorMap, refreshing, onRefresh, lastRefreshText, scrapeInfo, scrapeLines, onOpenSettings }) {
			// 每游戏主题色覆盖表（面板侧；设置组件里另有一份同名的）。
			// ⚠️ 必须在这里也定义一次：下面的行 --g 与留白卡 slotAccent 都在本组件里用它，
			//    漏了就是 ReferenceError ⇒ 整个面板（连带插件 UI）挂不上。
			// T3：改由 CalendarPanel 把**已经解析好的表**传进来（colorMap），消除"同一份 JSON 在
			//     两个组件各 parse 一次"；colorMap 缺席时才退回自己解析（保持组件可独立使用）。
			const gameColorMap = colorMap || parseJsonStr(s.gameColors, {});
			// ── 面板搜索（待办第 4 项）：按游戏名 / 卡池名 / 角色名 / 活动名过滤**显示** ──
			// 纯临时 UI 状态（组件内 useState），**不写设置、不碰 lastData**；空串 = 不过滤。
			// ⚠️ 只作用于下面这几块显示（表格 / 近期 / 留白卡）：
			//    侧栏轮播在 CalendarPanel 里用**未过滤**的 games 算（tickerItems memo），
			//    提醒更是另一条链路 —— 搜索词一个字节都到不了它们。
			const [findQuery, setFindQuery] = (0, react.useState)("");
			// 过滤后的游戏表：空查询时 panelGamesFilter **原样返回同一个数组** ⇒ 下面几个 memo 照旧命中。
			const shownGames = (0, react.useMemo)(() => panelGamesFilter(games, findQuery), [games, findQuery]);
			// 每一格（游戏 × 卡池/活动）的候选档期。已结束的**留在格子里**（这一侧没有在期内容时它就是
			// 这格的代表，图案走斜纹），但不进「近期」—— 近期回答的是"现在该看哪几条"。
			// ↓↓↓ 纯派生数据（与 CalendarPanel 同理）：4s 一次的「近期」翻页、每分钟时钟、以及任何
			// 无关设置写入都会让本组件重渲染；这一段原本每次都要逐游戏跑 scheduleNormalize（28×2）
			// ＋悬停文本解析＋失败归类。用 useMemo 按真正输入（games / now）缓存。
			//   ⚠️ 依赖只写 shownGames / now：本段不再读别的可变输入（主题色不参与，见 gameColorMap 只在下游用）。
			const { cells, all, failed, failRows, soonCount } = (0, react.useMemo)(() => {
			const cells = new Map();
			const all = [];
			// ⚠️ 遍历的是**搜索过滤后**的 shownGames（空查询时它就是 games 本身）：
			//    表格 / 近期 / 留白卡因此共用同一份过滤结果；轮播不读这里（见 CalendarPanel）。
			for (const g of shownGames) {
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
			}, [shownGames, now]);
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
							// 该侧没有数据：日期格悬停给「（无数据）」；外显文案不变
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cm gacha-cal-sched-num", title: scheduleDateHover(null, now), children: isG ? "该来源无卡池数据" : "该来源无活动数据" }),
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
						// 日期格悬停：失败 / 沿用旧值 / 无数据结论（正常态只有源站原文）
						(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cm gacha-cal-sched-num", title: scheduleDateHover(x, now), children: scheduleMeta(x, now) }),
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
			// shownGames / days / cells / 主题色 / now 决定，与「近期」的 4s 翻页、与无关的设置写入**无关**。
			// 这里缓存**元素本身**：React 对同一 element 引用会直接跳过这棵子树的 render + reconcile
			// （`oldProps === newProps` 的 bailout，与 React.memo 是同一机制）⇒ 4s 翻页不再重算这 2000+
			// 个格子。**DOM、类名、内联变量（--g/--z）、动画标记与关键帧全部不变**（纯实现层缓存）。
			// 依赖必须覆盖 rowOf/cellView 读到的全部输入：shownGames（搜索过滤后的行序/数据，空查询时就是
			// games）、days（14 天刻度）、cells（每格候选档期，含 now 结果）、gameColorMap（--g）、
			// now（档期文本/紧迫度）、findQuery（无命中时要换空结果文案）。
			const tableJsx = (0, react.useMemo)(() => (shownGames.length
				? shownGames.map(rowOf)
				// 搜索无命中：说清楚"是筛掉了"（否则会被当成"游戏都没了"）
				: (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-empty", children: findQuery.trim()
					? "没有匹配的游戏 · 清空搜索可恢复全部"
					: "还没有勾选任何游戏 · 去设置里挑几款" })),
				[shownGames, days, cells, gameColorMap, now, findQuery]);

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
					// 搜索框（待办第 4 项）：**放进已有的底栏工具行**（不新起一行 ⇒ 面板不变高）。
					// 匹配游戏名 / 卡池名 / 角色名 / 活动名（panelGamesFilter：大小写 / 全半角不敏感，
					// 空格分隔 = 多个词都要命中）；空串即恢复全部。×（或 Esc）一键清空。
					// ⚠️ 它**只影响显示**：不改 lastData、不参与轮播（tickerItems 用未过滤的 games）、
					//    也不碰提醒。窄侧栏下照样显示 —— 面板宽度恒为 690px（见 styles/panel.css 的
					//    `.gacha-cal-pop{width:690px}`），`wide === false` 只影响侧栏按钮本身，
					//    藏起来只会白白少一个功能；展开/清空都是**瞬时**的，不引入任何动画
					//    ⇒ prefers-reduced-motion 下无需额外分支。
					(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-find", children: [
						(0, react_jsx_runtime.jsx)("input", {
							type: "text",
							value: findQuery,
							placeholder: "搜卡池/角色/活动",
							"aria-label": "搜索游戏名、卡池名、角色名或活动名",
							title: "匹配游戏名 / 卡池名 / 角色名 / 活动名（只影响显示，不影响轮播与提醒）",
							onChange: (e) => setFindQuery(e.target.value),
							onKeyDown: (e) => { if (e.key === "Escape") setFindQuery(""); }
						}),
						findQuery ? (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "gacha-cal-sched-find-x",
							title: "清空搜索",
							"aria-label": "清空搜索",
							onClick: () => setFindQuery(""),
							children: "×"
						}) : null
					] }),
					scrapeInfo ? (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-scrape", title: (scrapeLines || []).join("\n"), children: scrapeInfo }) : null,
					(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-when", title: [lastRefreshText, scrapeInfo].concat(scrapeLines || []).filter(Boolean).join("\n"), children: "上次更新 " + scheduleAgo(s.lastRefresh, now) }),
					(0, react_jsx_runtime.jsx)("button", {
						type: "button", className: "gacha-cal-sched-btn", disabled: refreshing,
						title: refreshing ? "刷新中..." : "刷新", "aria-label": refreshing ? "刷新中..." : "刷新",
						onClick: onRefresh, children: "刷新"
					}),
					// 设置齿轮：放在「刷新」**右侧**（最外侧，沿底栏现有 flex 排布，不新起一行）。
					// **没传 onOpenSettings 就不渲染** —— 组件可脱离 CalendarPanel 复用（离线/预览），
					// 那里没有"设置页"这个概念，凭空给个点了没反应的按钮更糟。
					// 图标用 DSH 原生那套 16 viewBox / strokeWidth 1.5 的齿轮（与设置导航同一枚），
					// 点下去 = 80-shared-ui.js 的三步跳转；关闭本面板由父层传进来的动作负责。
					onOpenSettings ? (0, react_jsx_runtime.jsx)("button", {
						type: "button", className: "gacha-cal-sched-gear",
						title: "设置", "aria-label": "设置",
						onClick: onOpenSettings,
						children: (0, react_jsx_runtime.jsxs)("svg", {
							width: "16", height: "16", viewBox: "0 0 16 16", fill: "none",
							stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round",
							children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
								children: [
									(0, react_jsx_runtime.jsx)("path", { d: "M8 9.75012C8.9665 9.75012 9.75 8.96662 9.75 8.00012C9.75 7.03362 8.9665 6.25012 8 6.25012C7.0335 6.25012 6.25 7.03362 6.25 8.00012C6.25 8.96662 7.0335 9.75012 8 9.75012Z" }),
									(0, react_jsx_runtime.jsx)("path", { d: "M13.0107 7.79377C12.9505 7.89401 12.9205 7.94413 12.9205 7.99951C12.9205 8.0549 12.9505 8.10502 13.0106 8.20528L13.9849 9.83006C14.045 9.93029 14.0751 9.9804 14.0751 10.0358C14.0751 10.0911 14.045 10.1413 13.9849 10.2415L13.0037 11.8777C12.9468 11.9726 12.9184 12.0201 12.8725 12.0461C12.8267 12.072 12.7713 12.072 12.6607 12.072H10.6704C10.5598 12.072 10.5045 12.072 10.4586 12.098C10.4128 12.1239 10.3843 12.1714 10.3274 12.2662L9.33825 13.9142C9.28133 14.009 9.25287 14.0564 9.20703 14.0823C9.16118 14.1083 9.10588 14.1083 8.99529 14.1083H7.00486C6.89426 14.1083 6.83896 14.1083 6.79312 14.0823C6.74727 14.0564 6.71881 14.009 6.6619 13.9142L5.67273 12.2662C5.61581 12.1714 5.58735 12.1239 5.54151 12.098C5.49566 12.072 5.44036 12.072 5.32977 12.072H3.33945C3.2288 12.072 3.17347 12.072 3.12761 12.0461C3.08176 12.0201 3.0533 11.9726 2.9964 11.8777L2.0152 10.2415C1.9551 10.1413 1.92505 10.0911 1.92505 10.0358C1.92505 9.9804 1.9551 9.93029 2.0152 9.83006L2.98951 8.20528C3.04963 8.10502 3.07969 8.0549 3.07969 7.99951C3.07968 7.94413 3.04961 7.89401 2.98946 7.79377L2.01529 6.17011C1.95514 6.06987 1.92507 6.01975 1.92507 5.96437C1.92506 5.90899 1.95512 5.85886 2.01524 5.7586L2.9964 4.1224C3.0533 4.0275 3.08176 3.98005 3.12761 3.95408C3.17347 3.92811 3.2288 3.92811 3.33945 3.92811H5.32977C5.44036 3.92811 5.49566 3.92811 5.54151 3.90216C5.58735 3.87621 5.61581 3.82879 5.67273 3.73397L6.6619 2.08599C6.71881 1.99116 6.74727 1.94375 6.79312 1.9178C6.83896 1.89185 6.89426 1.89185 7.00486 1.89185H8.99529C9.10588 1.89185 9.16118 1.89185 9.20703 1.9178C9.25287 1.94375 9.28133 1.99116 9.33825 2.08599L10.3274 3.73397C10.3843 3.82879 10.4128 3.87621 10.4586 3.90216C10.5045 3.92811 10.5598 3.92811 10.6704 3.92811H12.6607C12.7713 3.92811 12.8267 3.92811 12.8725 3.95408C12.9184 3.98005 12.9468 4.0275 13.0037 4.1224L13.9849 5.7586C14.045 5.85886 14.0751 5.90899 14.0751 5.96437C14.0751 6.01975 14.045 6.06987 13.9849 6.17011L13.0107 7.79377Z" })
								]
							})
						})
					}) : null
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
		//   ② 元素加类 .is-settled（CSS: animation:none + transform:none，见 styles/ticker.css）。
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
				// 类名 = 基础类 + 方向类（视觉方向）+ 落定类；三条规则都在 styles/ticker.css。
				// 落定类必须排在方向规则之后（同特异性，靠顺序胜出）。
				className: "gacha-cal-btn-flip " + (flipDir === "up" ? "is-up" : "is-down") + (flipSettled ? " is-settled" : ""),
				onAnimationEnd,
				// 每一行 = 该格的内容，slot 只当 React 的 key（cur / prev 两个槽）。
				// 落定时数组只剩 cur ⇒ React 按 key 保留 cur 那个节点、删掉 prev（不会重挂载 cur）。
				children: flipLines.map((l) => renderLine(l.step, l.slot))
			});
		}
