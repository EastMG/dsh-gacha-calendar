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
		// 「到期提醒」的提前量选项（存**小时**；0 = 关闭）。
		// 口径：某侧的窗口**已开始**且 endTs 落在 (now, now + N 小时] 内 = 即将到期
		// （判定是纯函数 `isExpiringSoon`，见 60-helpers.js；红点在 80-components.js 的侧栏按钮上）。
		// 默认 24：够看完一个当期池/活动的收尾公告，又不至于一睁眼就常亮。
		const REMIND_OPTIONS = [
			{ label: "关闭", hours: 0 },
			{ label: "12 小时", hours: 12 },
			{ label: "24 小时", hours: 24 },
			{ label: "48 小时", hours: 48 }
		];
		const DEFAULT_SETTINGS = {
			autoRefresh: true,
			refreshMinutes: 1 * 24 * 60,
			// 到期提醒的提前量（小时）；0 = 关闭（关闭时**不做任何计算**，侧栏也不滚动）。
			// ⚠️ 这个键必须同时出现在 engine-head.js 的 CONFIG_KEYS 里（守卫见 test/cases-rule-lint.mjs）。
			remindHours: 24,
			// 「强提醒」：**参与**侧栏轮播提醒的条目 id 列表（设置页每行一个复选框，2026-10-25 晚）。
			// 语义（用户定，必须简单可解释）：**空数组 = 没特别设置 ⇒ 所有展示中的条目都参与**；
			// 非空 = 只提醒列表里的那些。默认空 = 开箱即用，新用户不用先勾一遍才有提醒。
			// 与「展示」（hidden/shown）**完全独立**：展示管面板里出不出现，这里管侧栏要不要提醒。
			// 判定唯一入口是 60-helpers.js 的纯函数 remindGameAllowed。
			remindGames: [],
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
