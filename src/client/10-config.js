		//#region config
		const NS = "gacha-calendar";
		// 本插件在 profile 里的条目 id 候选（用于解析设置表单，见 92-dsh-env.js 的 resolveSettingsEntryId）。
		// DSH 0.1.7 起设置文档按**条目 id**寻址，而"插件名/条目 id/包名"三者未必同名：
		//   · cordis.patch.yml 里是 id: gacha-calendar（我们自己的 insert 声明）
		//   · 包名是 dsh-gacha-calendar
		// 所以不写死单一字符串，按顺序试，谁能拿到表单就用谁。
		const SETTINGS_ENTRY_IDS = [NS, "dsh-gacha-calendar"];
		// 刷新频率选项：按天（存分钟），与 host 端 Config.refreshMinutes 对应。
		// 档位对齐常见版本周期：14/21/28/35/42 天 —— 15≈蔚蓝档案的 14 天轮换、21=1999 半版本/3.6 整版本
		// 与异环当期、30≈方舟月度、42=米系与 1999 的整版本
		const REFRESH_OPTIONS = [
			{ label: "1 天", minutes: 1 * 24 * 60 },
			{ label: "5 天", minutes: 5 * 24 * 60 },
			{ label: "7 天", minutes: 7 * 24 * 60 },
			{ label: "15 天", minutes: 15 * 24 * 60 },
			{ label: "21 天", minutes: 21 * 24 * 60 },
			{ label: "30 天", minutes: 30 * 24 * 60 },
			{ label: "42 天", minutes: 42 * 24 * 60 }
		];
		// 侧栏轮播的**范围**选项（存**小时**）。2026-10-25 三次定稿：档位从
		// 「关闭 / 12 / 24 / 48」改成「12 / 24 / 48 / 72」—— 「关闭」**不再是一个档位**，
		// 它由总开关 `tickerOn` 负责（两个控件各管一件事：开不开 / 提前多久）。
		// 口径：某侧的窗口落在 (now, now + N 小时] 内（要结束 / 要开始）= 进入轮播
		// （判定是纯函数 `tickerKindOf`，见 60-helpers.js；轮播/红点在 80-components.js 的侧栏按钮上）。
		// 默认 72：覆盖"周末没盯、周一回来才发现池子昨晚已经关了"这种最常见的漏看场景。
		const TICKER_OPTIONS = [
			{ label: "12 小时", hours: 12 },
			{ label: "24 小时", hours: 24 },
			{ label: "48 小时", hours: 48 },
			{ label: "72 小时", hours: 72 }
		];
		const DEFAULT_SETTINGS = {
			autoRefresh: true,
			refreshMinutes: 1 * 24 * 60,
			// 侧栏轮播的**总开关**（2026-10-25 三次定稿）：false = 完全不做轮播 ——
			// 按钮只有原样、不轮播，窄侧栏也不显示红点（渲染层把待轮播清单一律算成空）。
			// 默认 true：开箱即用就能看出"有事要来了"。
			// ⚠️ 这个键必须同时出现在 engine-head.js 的 CONFIG_KEYS 里（守卫见 test/cases-rule-lint.mjs）。
			tickerOn: true,
			// 轮播的**范围**（小时）：只保留 12 / 24 / 48 / 72 四档，默认 72。
			// 判定层仍把 N <= 0 当成"不轮播"（纯函数短路，老配置里残留的 0 不会出事），
			// 但设置页**不再提供这个档位** —— 要关请用上面的 `tickerOn`。
			// ⚠️ 这个键必须同时出现在 engine-head.js 的 CONFIG_KEYS 里（守卫见 test/cases-rule-lint.mjs）。
			tickerHours: 72,
			// 参与侧栏轮播的条目 id 列表（设置页每行一个复选框）。
			// 语义（2026-10-25 **二次定稿**，用户要求"改成正常的逻辑"）：**普通列表** —— 列表里有谁
			// 就轮播谁，**空数组 = 一个都不轮播**。**不再有"空 = 全部参与"的哨兵**。
			// 为什么废弃哨兵：它让"一个都不轮播"根本表达不出来，于是"取消最后一个勾"只能被拒绝
			// （旧实现正是这么挡的）、还得额外解释"要全关请去改提前量"—— 副作用远大于收益。
			// 开箱即用改由**出厂默认值**保证：下面这份 = 出厂时**展示中**的条目
			// （即所有 `defaultHidden !== true` 的来源 id；默认隐藏的那几个**不在**里面）。
			// ⚠️ 这份列表由 test/cases-ticker.mjs 的守卫钉住：新增来源、或改某条目的 defaultHidden
			//    都会让它变红，提示同步这里 **以及** src/index.js 的 schema `default(...)`。
			// 与「展示」（hidden/shown）**完全独立**：展示管面板里出不出现，这里管侧栏要不要轮播；
			// 未展示的条目面板里根本没有它，自然也不会参与轮播（设置页那一行的复选框因此置灰）。
			// 判定唯一入口是 60-helpers.js 的纯函数 tickerGameAllowed。
			tickerGames: [
				"genshin", "hsr", "zzz", "wuwa", "arknights", "endfield",
				"ba-cn", "ba-global", "ba-jp", "bandori", "wuhuamixin", "zspms", "kedr",
				"uma-cn", "uma-jp", "uma-global",
				"p5x", "nte", "gf2", "fgo", "pjsk", "stellasora", "r1999"
			],
			order: null,
			lastRefresh: 0,
			lastSource: "none",
			// 最近一次联网抓取的解析结果（JSON：{ [gameId]: {banner,bannerDates,roles,event,eventDates} }）
			lastData: "",
			// 每游戏主题色覆盖：{ id: "#rrggbb" }（空 = 用出厂色 / 名字哈希），由设置页的取色器写入
			gameColors: "{}",
			// 不展示的条目 id 列表（设置页开关）；出厂默认隐藏见条目的 `defaultHidden` 字段
			hidden: [],
			// 用户**明确打开**的条目 id 列表 —— 用来覆盖条目的出厂 `defaultHidden`。
			// 为什么不把默认隐藏项直接塞进 `hidden`：那样老用户（配置已存了 hidden=[]）不会生效，
			// 而且用户勾上以后无法区分"是默认值还是我开的"。三态判定见 60-helpers.js 的 isEntryHidden。
			shown: [],
			// 已删除的条目 id 列表（内置条目删除后记录，避免下次加载复活）
			removed: [],
			// 自定义爬取地址（JSON：{ [gameId]: "url" }，覆盖内置 url；空串 = 用默认）
			customUrls: "{}",
			// 自定义活动来源地址（JSON：{ [gameId]: "url" }，覆盖内置 eventUrl）
			customEventUrls: "{}",
			// 自定义条目（JSON 数组，字段与 SOURCES 一致）
			customEntries: "[]",
			// 【实验特性】新「二游日历」面板视图，**默认关闭**。
			//   false / 未设置 → 面板完全走原来的六列表格渲染（与历史行为一字不差）；
			//   true           → 换成按紧迫度排序的日程列表（四格摘要 + 筛选 + 分区）。
			// 开关在设置页「自动刷新」那块下面；想回退关掉即可，原渲染路径一行未动。
			// ⚠️ 这个键必须同时出现在 engine-head.js 的 CONFIG_KEYS 里，否则设置页勾了
			//    面板读不到（历史上 `shown` 漏过它，见 test/cases-rule-lint.mjs 的守卫）。
			newPanel: false
		};
		//#endregion
