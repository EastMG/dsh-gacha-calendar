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
		const DEFAULT_SETTINGS = {
			autoRefresh: true,
			refreshMinutes: 1 * 24 * 60,
			order: null,
			lastRefresh: 0,
			lastSource: "none",
			// 最近一次联网抓取的解析结果（JSON：{ [gameId]: {banner,bannerDates,roles,event,eventDates} }）
			lastData: "",
			// 不展示的条目 id 列表（设置页开关）
			hidden: [],
			// 已删除的条目 id 列表（内置条目删除后记录，避免下次加载复活）
			removed: [],
			// 自定义爬取地址（JSON：{ [gameId]: "url" }，覆盖内置 url；空串 = 用默认）
			customUrls: "{}",
			// 自定义活动来源地址（JSON：{ [gameId]: "url" }，覆盖内置 eventUrl）
			customEventUrls: "{}",
			// 自定义条目（JSON 数组，字段与 SOURCES 一致）
			customEntries: "[]"
		};
		//#endregion
