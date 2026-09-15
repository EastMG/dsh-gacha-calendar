		//#region components
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

			const doRefresh = (0, react.useCallback)(async () => {
				if (refreshing) return;
				setRefreshing(true);
				try {
					// 抓取/解析/合并/写缓存全部交给 core 引擎（面板不再自己编排）
					const result = await engine.refresh();
					// 顶部提示：只读 Result JSON（按游戏顺序取 name，交给共用提示函数分类）
					const games = Object.entries(result.games).map(([id, g]) => ({ id, name: g.name || id }));
					const { info, lines } = buildScrapeInfo(games, result);
					setScrapeInfo(info);
					setScrapeLines(lines);
					// 引擎已把 lastData/lastRefresh/lastSource 写进 settings，刷新快照即可重渲染
					setSnapshot(scope.getSnapshot());
				} finally {
					setRefreshing(false);
				}
			}, [refreshing, scope, engine]);

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
				let last = Date.now();
				const tick = () => {
					if (disposed) return;
					const now = Date.now();
					if (now - last >= intervalMs) {
						last = now;
						doRefresh();
					}
					timer = window.setTimeout(tick, Math.min(Math.max(last + intervalMs - Date.now(), 1000), MAX_DELAY));
				};
				timer = window.setTimeout(tick, Math.min(intervalMs, MAX_DELAY));
				return () => {
					disposed = true;
					window.clearTimeout(timer);
				};
			}, [s.autoRefresh, s.refreshMinutes, doRefresh]);

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
			const label = "\u4E8C\u6E38\u6392\u671F";

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
						ref: popRef,
						className: "gacha-cal-pop",
						style: { left: anchor.left, bottom: anchor.bottom },
						children: [
							(0, react_jsx_runtime.jsx)("p", { className: "gacha-cal-title", children: "\u4E8C\u6E38\u6392\u671F" }),
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
								// 设置按钮：跳转到 DSH 设置页并关闭本面板。
								// DSH 设置面板是 modal、打开状态组件私有（无官方跳转 API），
								// 通过触发侧边栏设置触发器（aria-haspopup="dialog" 是设置对话框的标准契约属性）打开面板。
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gacha-cal-refresh",
									title: "\u8BBE\u7F6E",
									"aria-label": "\u8BBE\u7F6E",
									onClick: () => {
										setOpen(false);
										const t = document.querySelector('[aria-haspopup="dialog"]');
										if (t && typeof t.click === "function") t.click();
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
								const withFailNote = (base, side, fail, stale) => {
									const text = sideFailText(side, fail);
									const note = text ? "（" + text + "）" : "";
									if (!note) return base || "";
									return stale && base ? base + "\n" + note : note;
								};
								// 游戏名/图标悬停：这行数据的"上次成功"时间（+ 哪列沿用了旧数据）
								const rowTitle = buildRowTitle(g);
								return (0, react_jsx_runtime.jsxs)("div", {
									className: "gacha-cal-row",
									key: g.id,
									title: rowTitle,
									children: [
										(0, react_jsx_runtime.jsx)("img", { src: g.icon, alt: g.name, loading: "lazy" }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name", title: rowTitle, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.bannerHover || gachaTitle, "gacha", g.gachaFail, g.gachaStale), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: gachaVisible }) }),
										// 起止列：倒计时用补全后的时间；悬停显示源站原文（如"4.5版本更新后 ~ …"）
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.bannerDatesRaw || g.bannerDates, "gacha", g.gachaFail, g.gachaStale), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: (0, react_jsx_runtime.jsx)("b", { children: displayTimeCell(g.bannerDates || "", now) }) }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.eventHover || eventTitle, "event", g.eventFail, g.eventStale), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: eventName }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.eventDatesRaw || g.eventDates, "event", g.eventFail, g.eventStale), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: displayTimeCell(g.eventDates || "", now) }) })
									]
								});
							})
						]
					}) : null
				]
			});
		}

		function CalendarSettingsPage({ scope }) {
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			const [adding, setAdding] = (0, react.useState)(false);
			// 添加表单临时值（名称/图标手动填；卡池与活动内容由链接解析产出）
			const [form, setForm] = (0, react.useState)({ name: "", icon: "", url: "", eventUrl: "" });
			const [customInputs, setCustomInputs] = (0, react.useState)({});
			const [eventCustomInputs, setEventCustomInputs] = (0, react.useState)({});
			(0, react.useEffect)(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };

			const allEntries = getAllEntries(s);
			const hidden = Array.isArray(s.hidden) ? s.hidden : [];
			const removed = Array.isArray(s.removed) ? s.removed : [];
			const urls = parseJsonStr(s.customUrls, {});
			const customs = parseJsonStr(s.customEntries, []);

			const order = Array.isArray(s.order) && s.order.length > 0 ? s.order : allEntries.map((x) => x.id);
			const sorted = applyOrder(allEntries, order);
			const currentMinutes = Number(s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes);
			// 旧配置可能存了分钟值（不在按天选项里），额外补一个"自定义"选项避免 select 空白
			const inOptions = REFRESH_OPTIONS.some((o) => o.minutes === currentMinutes);

			const commit = async (key, value) => {
				await scope.set(key, value);
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
			const resetOrder = async () => { await commit("order", null); };

			// 展示开关
			const toggleHidden = async (id) => {
				const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
				await commit("hidden", next);
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
			// 恢复默认条目：清空删除记录与自定义条目
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
					(0, react_jsx_runtime.jsxs)("div", { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 16, fontWeight: 600 }, children: "\u4E8C\u6E38\u6392\u671F" }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, marginTop: 2 }, children: "\u5361\u6C60\u65E5\u5386\u63D2\u4EF6\u8BBE\u7F6E" })
					] }),
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
							(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !!s.autoRefresh, onChange: (e) => commit("autoRefresh", e.target.checked) }),
							(0, react_jsx_runtime.jsx)("span", { children: "\u81EA\u52A8\u5237\u65B0\u6392\u671F\u6570\u636E" })
						] }),
						(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "\u5237\u65B0\u9891\u7387" }),
							(0, react_jsx_runtime.jsxs)("select", { value: String(currentMinutes), onChange: (e) => commit("refreshMinutes", Number(e.target.value)), children: [
								!inOptions ? (0, react_jsx_runtime.jsx)("option", { value: String(currentMinutes), children: "\u81EA\u5B9A\u4E49 (" + currentMinutes + " \u5206\u949F)" }) : null,
								REFRESH_OPTIONS.map((o) => (0, react_jsx_runtime.jsx)("option", { value: String(o.minutes), children: o.label }, o.minutes))
							] })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "\u5728\u4FA7\u8FB9\u680F\u9762\u677F\u6253\u5F00\u671F\u95F4\uFF0C\u6309\u6B64\u9891\u7387\u81EA\u52A8\u5237\u65B0\u6E90\u6570\u636E\u3002" })
					] }),
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "\u6761\u76EE\u7BA1\u7406" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: resetOrder, children: "\u6062\u590D\u9ED8\u8BA4\u987A\u5E8F" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: restoreAll, children: "\u6062\u590D\u9ED8\u8BA4\u6761\u76EE" })
							] })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "「展示」控制面板是否显示；「↑↓」调整顺序；「自定义」可覆盖来源地址；卡池来源与活动来源各自独立选择；删除后可恢复默认。" }),
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
												(0, react_jsx_runtime.jsx)("img", { src: g.icon, alt: g.name, style: { width: 22, height: 22, borderRadius: 5, objectFit: "cover", flex: "none" } }),
												(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name gacha-cal-settings-name", style: { flex: "1 1 auto", minWidth: 0 }, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) })
											] }),
											(0, react_jsx_runtime.jsxs)("label", { style: { ...labelStyle, cursor: "pointer", justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !hidden.includes(g.id), onChange: () => toggleHidden(g.id) }),
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
												placeholder: "MediaWiki api.php URL",
												value: customInputs[g.id] ?? (urls && typeof urls === "object" ? String(urls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
												onChange: (e) => setCustomUrl(g.id, e.target.value),
												style: { ...inputStyle, flex: "1 1 160px" }
											})
										] }) : null,
										showEventInput ? (0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 280px", minWidth: 220 }, children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" }, children: "活动来源地址" }),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												placeholder: "MediaWiki api.php URL",
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
							(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "名称/图标手动填写；卡池与活动内容由链接解析产出（MediaWiki api.php 或含排期的网页），刷新时自动解析。" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u540D\u79F0 *", value: form.name, onChange: updateForm("name"), style: { ...inputStyle, flex: "1 1 140px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u56FE\u6807 URL", value: form.icon, onChange: updateForm("icon"), style: { ...inputStyle, flex: "1 1 240px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u5361\u6C60\u6765\u6E90\u94FE\u63A5 * (MediaWiki api.php)", value: form.url, onChange: updateForm("url"), style: { ...inputStyle, flex: "1 1 300px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u6D3B\u52A8\u6765\u6E90\u94FE\u63A5 (\u53EF\u9009)", value: form.eventUrl, onChange: updateForm("eventUrl"), style: { ...inputStyle, flex: "1 1 300px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", disabled: !form.name.trim() || !form.url.trim(), onClick: addEntry, children: "\u6DFB\u52A0" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: () => setAdding(false), children: "\u53D6\u6D88" })
							] })
						] }) : (0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { alignSelf: "flex-start", marginTop: 6 }, onClick: () => setAdding(true), children: "+ \u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" })
					] }),
					(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "数据来源：官方公告 / 官方Wiki（bwiki、PRTS 等）；无联网抓取数据时对应列显示为空。自定义条目的链接会尝试解析（MediaWiki/常见卡池与活动表格），解析失败时该列显示为空。" })
				]
			});
		}
		//#endregion
