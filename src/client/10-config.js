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
		// 按钮轮播的范围选项（小时）：12 / 24 / 48 / 72；“关闭”由 tickerOn 开关负责，不是一个档位。
		// 默认 72 —— 周末没盯、周一回来才发现池子昨晚已经关了，是最常见的漏看场景。
		const TICKER_OPTIONS = [
			{ label: "12 小时", hours: 12 },
			{ label: "24 小时", hours: 24 },
			{ label: "48 小时", hours: 48 },
			{ label: "72 小时", hours: 72 }
		];
		const DEFAULT_SETTINGS = {
			autoRefresh: true,
			refreshMinutes: 1 * 24 * 60,
			// 按钮轮播总开关：false = 不轮播、窄侧栏也不出红点。默认开，开箱就能看出"有事要来了"。
			// 这个键必须同时出现在 engine-head.js 的 CONFIG_KEYS 里（守卫见 test/cases-rule-lint.mjs）。
			tickerOn: true,
			// 按钮轮播的范围（小时）：12 / 24 / 48 / 72，默认 72。老配置残留的 0 由 tickerRangeOf 归一。
			// 这个键必须同时出现在 engine-head.js 的 CONFIG_KEYS 里（守卫见 test/cases-rule-lint.mjs）。
			tickerHours: 72,
			// 「到期提醒（送达）」总开关：**默认开**（用户 2026-10-27 认可"开箱即用"）。
			// 真正的送达在宿主半边（src/index.js 的定时器 + 系统通知），面板只读写这个开关。
			// 节点用**字符串**存（"72,24,6,2"），避开 array 值在设置表单里的兼容问题；
			// 解析失败一律回落默认（见 65-remind.js 的 remindNodesOf），不会让提醒停摆。
			// 三个键必须同时出现在 engine-head.js 的 CONFIG_KEYS 与 src/index.js 的 schema 里
			// （守卫见 test/cases-rule-lint.mjs 与 test/cases-remind.mjs）。
			remindOn: true,
			// 结束节点（小时）：结束后 3 天 / 1 天 / 6 小时 / 2 小时 —— 同一件事只发最紧急的那一档。
			remindEndNodes: "72,24,6,2",
			// 开始节点（小时）：开始前 1 天 / 2 小时。
			remindStartNodes: "24,2",
			// 「到期提醒（送达）」的逐游戏白名单（不属于轮播）。语义 = 普通列表：列表里有谁就提醒谁，
			// 空数组 = 一个都不提醒；默认值 = 出厂时展示中的条目（所有 defaultHidden !== true 的 id）。
			// 守卫见 test/cases-ticker.mjs：新增来源或改 defaultHidden 时要同步这里与 src/index.js 的 schema。
			remindGames: [
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
