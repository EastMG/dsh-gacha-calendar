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
			// 这一帧的翻页方向（**类名 = 视觉方向**，见 styles/ticker.css 的 keyframes 注释）。
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
				if (!Number.isFinite(minutes) || minutes < 0) return;
				// 「启动时」（minutes === 0）**不排下一拍**：这一档只在挂载时由下面的 autoRefreshPlan
				// 刷一次；若这里继续排，间隔就是 0 ⇒ 每 1 秒一轮，变成"疯狂刷新"（比 42 天溢出更糟）。
				if (minutes === 0) return;
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
				// 「启动时」（minutes === 0）在同一次挂载里**只刷一次**：
				// 这一档每次判定都 due（这正是它的语义），而刷新成功会写回 lastVersion / lastRefresh
				// → 依赖变化让 effect 重跑 → 若 key 里还带着 plan.reason，升级那一轮会先走
				// 「插件已更新」(force)、紧接着再命中「启动时刷新」→ **同一挂载连刷两轮**。
				// 所以 0 档把 key 收敛成"本次挂载一次"，与原因无关（其他档位仍按 (版本|原因) 记）。
				const zeroInterval = Number(s.refreshMinutes) === 0;
				const key = zeroInterval ? `${PLUGIN_VERSION}|启动时` : `${PLUGIN_VERSION}|${plan.reason}`;
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
			// 措辞从"N 小时内到期"改成"N 小时内 N 项"（2026-10-25 晚起轮播那会儿是双向的，
			// 2026-10-28 起只判结束 —— 这个措辞对单方向同样成立，不用再改）；
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
						// 新版要"撑满 + 不裁切"，旧版要"限高 + 滚动" —— 靠这个修饰类分开（见 styles/panel.css）
						className: s.newPanel === true ? "gacha-cal-pop gacha-cal-pop--sched" : "gacha-cal-pop",
						style: { left: anchor.left, bottom: anchor.bottom },
						// ⚙️ 实验特性分支 —— **唯一**的切换点。
						//    `s.newPanel === true` 才走新日程视图；否则 children 就是下面那个
						//    **一字未改的原数组**（旧的标题 + meta + 表头 + games 表格）。
						//    默认关 → 旧面板 DOM 与行为零变化，这是回退路径。
						children: s.newPanel === true
							? (0, react_jsx_runtime.jsx)(ScheduleView, {
								games, now, s, colorMap: colorOverrides, refreshing, onRefresh: doRefresh,
								lastRefreshText, scrapeInfo: bannerInfo, scrapeLines: bannerLines,
								// 底栏那枚齿轮（新面板）：与旧面板同一个动作 —— 先关本面板，
								// 再走三步跳到 DSH 设置页的本插件分区（失败只 console.warn）。
								onOpenSettings: () => {
									setOpen(false);
									openPluginSettingsSection();
								}
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
								// 2026-10-31 恢复显示（SETTINGS_BUTTON_VISIBLE = true）：跳转链已按
								// 新三步重写（见 80-shared-ui.js 的 openPluginSettingsSection）——
								// ① 账号菜单 ② 菜单里的「设置」项 ③ 设置 dialog 导航里的「二游日历」。
								// 为什么这么绕：DSH 没有"打开设置到指定节"的官方 API（面板是 modal，
								// open/activeId 都是组件私有 state，按 rows[0] 兜底停在导航第一项），
								// `Ctrl+Alt+,` 又是 Electron 应用级加速键、合成键盘事件无效。只能合成点击。
								// 先 setOpen(false)：本面板要先退场，别挡在设置 dialog 上面。
								// 失败由 openPluginSettingsSection 自己 console.warn（不弹窗、不炸树）。
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
