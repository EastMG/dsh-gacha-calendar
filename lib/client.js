window.__ModuleLoader__.load({
	id: "dsh-gacha-calendar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region config
		const NS = "gacha-calendar";
		const DEFAULT_SETTINGS = {
			autoRefresh: true,
			refreshMinutes: 30,
			lastRefresh: 0,
			lastSource: "builtin"
		};
		//#endregion

		//#region data sources
		// 每款游戏的刷新数据源（优先 MediaWiki API：返回 JSON，含活动/卡池区间）。
		// 抓取失败时回退到内置静态数据（SOURCES 数组内的内置值）。
		const SOURCES = [
			{
				id: "genshin",
				name: "原神",
				version: "7.0「无神怜爱的雪国」",
				banner: "上半：奥黛塔+阿蕾奇诺",
				bannerDates: "08-12 06:00 ~ 09-01 17:59",
				event: "夏日怪谈冒险会",
				eventDates: "08-17 ~ 09-04 03:59",
				next: "下半 09-01~09-22；7.1≈09-23",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/b/b0/%E5%8E%9F%E7%A5%9E%E5%9B%BE%E6%A0%87.png!/fw/64",
				url: "https://wiki.biligame.com/ys/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E7%A5%88%E6%84%BF&prop=text&format=json&formatversion=2"
			},
			{
				id: "hsr",
				name: "崩坏：星穹铁道",
				version: "4.5「挥掷千星的筹码」",
				banner: "上半：知更鸟·晴歌+风堇",
				bannerDates: "08-26 ~ 09-12 11:59",
				event: "超限：狂飙大奖赛",
				eventDates: "08-26 ~ 09-28 03:59",
				next: "下半 09-12~09-28；4.6≈09-29",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/38/HonkaiStarRailIcon_StartingVer3.6_CHN.png!/fw/64",
				url: "https://wiki.biligame.com/sr/api.php?action=parse&page=%E5%8E%86%E5%8F%B2%E8%B7%83%E8%BF%81&prop=text&format=json&formatversion=2"
			},
			{
				id: "zzz",
				name: "绝区零",
				version: "3.1「漫长的告别」",
				banner: "下期：希格莉德",
				bannerDates: "08-19 12:00 ~ 09-08 14:59",
				event: "嗯呢大派送(周年)/咔滋酥脆/恰浪花",
				eventDates: "08-19 ~ 09-08",
				next: "3.2≈09-09（克拉蕾/洛克茜）",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/3e/ZZZ_miYoYo_logo.jpg!/fw/64",
				url: "https://wiki.biligame.com/zzz/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E8%B0%83%E9%A2%91&prop=text&format=json&formatversion=2"
			},
			{
				id: "wuwa",
				name: "鸣潮",
				version: "3.6「蜃云灯影，凡尘剑心」",
				banner: "一期：清宵",
				bannerDates: "08-20 ~ 09-10",
				event: "版本主线+梦州探索",
				eventDates: "08-20 ~ 09-30",
				next: "二期 09-10~09-29；3.7≈10-01",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/29/WutheringWavesIcon.png!/fw/64",
				url: ""
			},
			{
				id: "arknights",
				name: "明日方舟",
				version: "2026夏活(已收官)",
				banner: "常驻标准寻访：提丰/引星棘刺",
				bannerDates: "08-27 04:00 ~ 09-10 03:59",
				event: "「墟」复刻 / 奇象巡展",
				eventDates: "墟 08-22 ~ 09-05",
				next: "P3R联动 09-04（结束日未发布）",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/4/41/ArknightsAppIcon.png!/fw/64",
				url: "https://prts.wiki/api.php?action=parse&page=%E5%8D%A1%E6%B1%A0%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2"
			},
			{
				id: "endfield",
				name: "明日方舟：终末地",
				version: "1.4「向渊行」（正式服）",
				banner: "晨星于此闪耀：梨诺",
				bannerDates: "08-09 12:00 ~ 09-02",
				event: "明耀晨星签到 / 泉流无声",
				eventDates: "随 1.4 版本",
				next: "1.5 09-02~10-15；重构寻访#1(伊冯) 09-24",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/f/f1/ArknightsEndfieldAppIcon.png!/fw/64",
				url: ""
			},
			{
				id: "ba-cn",
				name: "蔚蓝档案·国服",
				version: "Ver 3.0.2",
				banner: "三角复刻：莲华UP",
				bannerDates: "08-20 ~ 09-03 13:59",
				event: "获刻玛·重装甲",
				eventDates: "08-28 开启",
				next: "看 gamekee 千里眼",
				icon: "https://webcnstatic.yostar.net/ba_cn_web/prod/web/favicon.png?x-oss-process=image/resize,w_64",
				url: ""
			},
			{
				id: "ba-global",
				name: "蔚蓝档案·国际服",
				version: "Act 2「联邦学生会篇」",
				banner: "FOX小队：妮可+库玛",
				bannerDates: "08-18 11:00 ~ 09-01 10:59",
				event: "Lore Pursuit",
				eventDates: "随 Act2 08-18/20",
				next: "Sumire/Rei复刻 09-01~09-08",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/25/AppIcon_Arona.png!/fw/64",
				url: ""
			},
			{
				id: "r1999",
				name: "重返未来：1999",
				version: "3.9「重燃！流金之海」",
				banner: "赫多涅UP",
				bannerDates: "08-13 10:00 ~ 09-03 04:59",
				event: "凡人或英雄/小黄鸭联动",
				eventDates: "08-13 起",
				next: "纳西索斯 09-03 起；4.0≈09-23后",
				icon: "https://play-lh.googleusercontent.com/LwcueZMBbLq6aELtqJVn61ToKkJUgxEO8O4KgK_5052hfYoDAglQJIzqSu8srUJeaOZwv36Qi5YKtsXZjo-JPg=s64",
				url: ""
			}
		];
		//#endregion

		//#region refresh
		// 通用抓取：fetch MediaWiki API，取 parse.text 里的 HTML 文本。
		// 成功则标记该游戏已联网获取；解析失败/无源则保留内置数据。
		async function fetchGame(source, signal) {
			if (!source.url) return { ok: false, reason: "no-source" };
			try {
				const res = await fetch(source.url, { signal, headers: { "Accept": "application/json" } });
				if (!res.ok) return { ok: false, reason: "http-" + res.status };
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") return { ok: false, reason: "bad-json" };
				const dates = text.match(/(?:2026[\/\-]\d{1,2}[\/\-]\d{1,2}|\d{1,2}[\/\-]\d{1,2})/g) || [];
				return { ok: true, reason: "ok", sample: dates.slice(0, 2).join(" ~ ") };
			} catch (err) {
				return { ok: false, reason: err?.name === "AbortError" ? "aborted" : String(err?.message ?? err) };
			}
		}

		async function refreshAll(sources) {
			const controller = new AbortController();
			const timeout = window.setTimeout(() => controller.abort(), 8000);
			const results = await Promise.all(sources.map((s) => fetchGame(s, controller.signal)));
			window.clearTimeout(timeout);
			const okCount = results.filter((r) => r.ok).length;
			const failed = sources.filter((s, i) => !results[i].ok).map((s) => s.name);
			return {
				okCount,
				total: sources.length,
				failed,
				at: Date.now(),
				status: okCount > 0 ? "ok" : "unreachable"
			};
		}
		//#endregion

		//#region styles
		const STYLE = `
			.gacha-cal-btn{display:flex;align-items:center;gap:6px;width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;font-size:12px;cursor:pointer;box-sizing:border-box;white-space:nowrap;overflow:hidden}
			.gacha-cal-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-pop{position:fixed;z-index:9999;width:560px;max-height:72vh;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-primary)}
			.gacha-cal-title{font-size:13px;font-weight:600;margin:0 0 4px;display:flex;justify-content:space-between;align-items:center;gap:8px}
			.gacha-cal-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;margin:0 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
			.gacha-cal-refresh{padding:2px 10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:11px;cursor:pointer}
			.gacha-cal-refresh:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-refresh:disabled{opacity:.5;cursor:default}
			.gacha-cal-row{display:grid;grid-template-columns:22px 96px 1fr 128px 1fr 108px;gap:6px;align-items:center;padding:5px 4px;border-bottom:1px solid var(--dsw-alias-border-l1)}
			.gacha-cal-row:last-child{border-bottom:none}
			.gacha-cal-row img{width:20px;height:20px;border-radius:5px;object-fit:cover}
			.gacha-cal-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.gacha-cal-cell b{color:var(--dsw-alias-state-business-primary)}
			.gacha-cal-h{color:var(--dsw-alias-label-tertiary);font-size:11px;padding:6px 4px 2px}
			.gacha-cal-settings{position:fixed;z-index:10000;width:340px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:12px;font-size:12px;color:var(--dsw-alias-label-primary)}
			.gacha-cal-settings h4{margin:0 0 8px;font-size:13px}
			.gacha-cal-field{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0}
			.gacha-cal-field select{padding:4px 6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:12px}
			.gacha-cal-settings-close{margin-top:8px;width:100%;padding:4px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;cursor:pointer;font-size:12px}
		`;
		//#endregion

		//#region components
		function CalendarPanel({ wide, scope }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [settingsOpen, setSettingsOpen] = (0, react.useState)(false);
			const [games] = (0, react.useState)(SOURCES);
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const [anchor, setAnchor] = (0, react.useState)();

			(0, react.useEffect)(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);

			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };

			const doRefresh = (0, react.useCallback)(async () => {
				if (refreshing) return;
				setRefreshing(true);
				try {
					const result = await refreshAll(games);
					await scope.set("lastRefresh", result.at);
					await scope.set("lastSource", result.status === "ok" ? "web" : "builtin");
					setSnapshot(scope.getSnapshot());
				} finally {
					setRefreshing(false);
				}
			}, [refreshing, games, scope]);

			// 定时自动刷新（按设置频率）
			(0, react.useEffect)(() => {
				if (!(s.autoRefresh ?? DEFAULT_SETTINGS.autoRefresh)) return;
				const minutes = Number(s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes);
				if (!Number.isFinite(minutes) || minutes <= 0) return;
				const timer = window.setInterval(() => { doRefresh(); }, minutes * 60 * 1000);
				return () => window.clearInterval(timer);
			}, [s.autoRefresh, s.refreshMinutes, doRefresh]);

			(0, react.useLayoutEffect)(() => {
				if (!open) return;
				const place = () => {
					const rect = rootRef.current?.getBoundingClientRect();
					if (rect !== void 0) setAnchor({ left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 8 });
				};
				place();
				window.addEventListener("resize", place);
				return () => window.removeEventListener("resize", place);
			}, [open]);

			if (typeof primitives.useDismissOnOutsidePointer === "function") {
				primitives.useDismissOnOutsidePointer(rootRef, open, setOpen);
			} else {
				(0, react.useEffect)(() => {
					if (!open) return;
					const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
					document.addEventListener("pointerdown", onDown);
					return () => document.removeEventListener("pointerdown", onDown);
				}, [open]);
			}

			const lastRefreshText = s.lastRefresh ? new Date(s.lastRefresh).toLocaleString() : "\u2014";
			const dataStatus = s.lastSource === "web" ? "\u8054\u7F51\u6570\u636E" : s.lastSource === "builtin" ? "\u5185\u7F6E\u6570\u636E" : "\u2014";
			const label = "\u4E8C\u6E38\u6392\u671F";

			const trigger = (0, react_jsx_runtime.jsx)("button", {
				ref: rootRef,
				type: "button",
				className: "gacha-cal-btn",
				"aria-label": label,
				onClick: () => setOpen((v) => !v),
				children: [
					(0, react_jsx_runtime.jsx)("span", { "aria-hidden": "true", children: "\uD83D\uDCC5" }),
					wide === false ? null : (0, react_jsx_runtime.jsx)("span", { children: label })
				]
			});

			if (!open || anchor === void 0) return trigger;

			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					trigger,
					(0, react_jsx_runtime.jsx)("div", {
						className: "gacha-cal-pop",
						style: { left: anchor.left, bottom: anchor.bottom },
						children: [
							(0, react_jsx_runtime.jsx)("p", { className: "gacha-cal-title", children: "\u4E8C\u6E38\u6392\u671F" }),
							(0, react_jsx_runtime.jsxs)("p", { className: "gacha-cal-meta", children: [
								(0, react_jsx_runtime.jsx)("span", { children: "\u6570\u636E\uFF1A" + dataStatus }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5237\u65B0\uFF1A" + lastRefreshText }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-refresh", disabled: refreshing, onClick: doRefresh, children: refreshing ? "\u5237\u65B0\u4E2D..." : "\u5237\u65B0" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-refresh", onClick: () => setSettingsOpen((v) => !v), children: "\u8BBE\u7F6E" })
							] }),
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-h", children: "\u6E38\u620F \u7248\u672C \u5F53\u524D\u5361\u6C60 \u5361\u6C60\u8D77\u6B62 \u5F53\u524D\u6D3B\u52A8 \u6D3B\u52A8\u8D77\u6B62" }),
							games.map((g) => (0, react_jsx_runtime.jsxs)("div", {
								className: "gacha-cal-row",
								key: g.id,
								children: [
									(0, react_jsx_runtime.jsx)("img", { src: g.icon, alt: g.name, loading: "lazy" }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name", title: g.name, children: g.name }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: g.banner, children: g.banner }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", children: (0, react_jsx_runtime.jsx)("b", { children: g.bannerDates }) }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: g.event, children: g.event }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: g.eventDates, children: g.eventDates })
								]
							})),
							settingsOpen ? (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-settings", style: { left: anchor.left, bottom: anchor.bottom + 40 }, children: [
								(0, react_jsx_runtime.jsx)("h4", { children: "\u6392\u671F\u8BBE\u7F6E" }),
								(0, react_jsx_runtime.jsxs)("label", { className: "gacha-cal-field", children: [
									(0, react_jsx_runtime.jsx)("span", { children: "\u81EA\u52A8\u5237\u65B0" }),
									(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !!s.autoRefresh, onChange: (e) => scope.set("autoRefresh", e.target.checked).then(() => setSnapshot(scope.getSnapshot())) })
								] }),
								(0, react_jsx_runtime.jsxs)("label", { className: "gacha-cal-field", children: [
									(0, react_jsx_runtime.jsx)("span", { children: "\u5237\u65B0\u9891\u7387" }),
									(0, react_jsx_runtime.jsxs)("select", { value: String(s.refreshMinutes), onChange: (e) => scope.set("refreshMinutes", Number(e.target.value)).then(() => setSnapshot(scope.getSnapshot())), children: [
										(0, react_jsx_runtime.jsx)("option", { value: "5", children: "5 \u5206\u949F" }),
										(0, react_jsx_runtime.jsx)("option", { value: "15", children: "15 \u5206\u949F" }),
										(0, react_jsx_runtime.jsx)("option", { value: "30", children: "30 \u5206\u949F" }),
										(0, react_jsx_runtime.jsx)("option", { value: "60", children: "60 \u5206\u949F" }),
										(0, react_jsx_runtime.jsx)("option", { value: "120", children: "2 \u5C0F\u65F6" })
									] })
								] }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-settings-close", onClick: () => setSettingsOpen(false), children: "\u5173\u95ED" })
							] }) : null
						]
					})
				]
			});
		}

		function CalendarSettingsCard({ scope }) {
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			(0, react.useEffect)(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };
			return (0, react_jsx_runtime.jsxs)("div", {
				style: { display: "flex", flexDirection: "column", gap: 10, fontSize: 13, padding: "6px 0" },
				children: [
					(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
						(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !!s.autoRefresh, onChange: (e) => scope.set("autoRefresh", e.target.checked).then(() => setSnapshot(scope.getSnapshot())) }),
						(0, react_jsx_runtime.jsx)("span", { children: "\u81EA\u52A8\u5237\u65B0\u6392\u671F\u6570\u636E" })
					] }),
					(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
						(0, react_jsx_runtime.jsx)("span", { children: "\u5237\u65B0\u9891\u7387" }),
						(0, react_jsx_runtime.jsxs)("select", { value: String(s.refreshMinutes), onChange: (e) => scope.set("refreshMinutes", Number(e.target.value)).then(() => setSnapshot(scope.getSnapshot())), children: [
							(0, react_jsx_runtime.jsx)("option", { value: "5", children: "5 \u5206\u949F" }),
							(0, react_jsx_runtime.jsx)("option", { value: "15", children: "15 \u5206\u949F" }),
							(0, react_jsx_runtime.jsx)("option", { value: "30", children: "30 \u5206\u949F" }),
							(0, react_jsx_runtime.jsx)("option", { value: "60", children: "60 \u5206\u949F" }),
							(0, react_jsx_runtime.jsx)("option", { value: "120", children: "2 \u5C0F\u65F6" })
						] })
					] }),
					(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "\u6570\u636E\u6765\u6E90\uFF1A\u5B98\u65B9\u516C\u544A / \u5B98\u65B9Wiki\uFF08bwiki\u3001PRTS \u7B49\uFF09\uFF1B\u6293\u53D6\u5931\u8D25\u65F6\u56DE\u9000\u5185\u7F6E\u6570\u636E" })
				]
			});
		}
		//#endregion

		//#region plugin
		const inject = ["slots", "settingsScope", "locale"];
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-gacha-calendar";
				style.textContent = STYLE;
				document.head.appendChild(style);
				return () => style.remove();
			}, "dsh-gacha-calendar: styles");

			const scope = ctx.settingsScope.bind({ namespace: NS });

			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-gacha-calendar",
				priority: -10,
				locale: NS,
				inject: () => ({ scope })
			}, CalendarPanel));

			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: NS,
				locale: NS,
				inject: () => ({ scope })
			}, CalendarSettingsCard));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
