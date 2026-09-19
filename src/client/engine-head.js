		//#region engine（core 对外唯一入口：createEngine）
		// core = 环境无关的"抓取 + 解析 + 缓存合并"逻辑。宿主（DSH 插件 / 浏览器扩展 / Windows /
		// Android / iOS / 鸿蒙）只需注入三样东西，然后读它返回的 Result JSON 画界面：
		//   transport: { fetchRaw(url, opts), fetchViaProxy(url, { referer, headers, body }) }
		//   storage:   { get(key), set(key, value) }      —— 配置与缓存都走它（键名见 CONFIG_KEYS）
		//   now:       () => 毫秒时间戳（可注入 → 单测能固定时间）
		//   timer:     { setTimeout, clearTimeout }（可选；不传就用宿主全局的）
		// 硬约束（交接文档 §13.3）：core 内部不得出现 window / document / Node API / 直接 fetch /
		// 直接 Date.now —— 全部经 15-env.js 的 coreEnv。违反此约束会让 Android/iOS/鸿蒙 无法嵌入。
		const ENGINE_SCHEMA_VERSION = 1;

		function createEngine(env) {
			const engineEnv = env || {};
			// 各平台自己实现这两个方法；缺省实现只保证"不崩"，不联网、不落盘
			const storage = engineEnv.storage || {
				async get() { return undefined; },
				async set() { /* 无存储：算完就返回，不持久化 */ }
			};
			// engine 会读取的存储键（宿主按自己的方式实现即可；读不到就用 DEFAULT_SETTINGS 的默认值）
			//   order / hidden / removed / customEntries / customUrls / customEventUrls  —— 配置
			//   lastData / lastRefresh / lastSource                                    —— 缓存
			const CONFIG_KEYS = [
				"order", "hidden", "removed", "customEntries", "customUrls", "customEventUrls",
				"autoRefresh", "refreshMinutes", "lastData", "lastRefresh", "lastSource"
			];

			// 读取配置（缺失项回落到 10-config.js 的 DEFAULT_SETTINGS）
			async function readSettings() {
				const out = { ...DEFAULT_SETTINGS };
				for (const k of CONFIG_KEYS) {
					const v = await storage.get(k);
					if (v !== undefined && v !== null) out[k] = v;
				}
				return out;
			}

			// 解析器版本号（代码元信息，不随缓存走）：无服务端分发时用来定位
			// 「坏了的是哪个版本的用户、哪个源」（交接文档 §13.4）。自定义条目没有维护中的解析器，故不出现在这里。
			function parserVersionsOf(entries) {
				const out = {};
				for (const e of entries) if (typeof e.parserVersion === "number") out[e.id] = e.parserVersion;
				return out;
			}

			// 记录归一：**Result JSON 的形状必须固定**（这才是"冻结契约"）——
			// 内容字段无论抓没抓到都存在（缺就是空串），消费方不必到处 `?? ""`；
			// 状态字段永远在（gachaFail / eventFail / okAt，可选 gachaStale / eventStale / skipped）。
			// 判断"是没抓到还是源站没内容"要把内容字段与 gachaFail/gachaStale 一起看。
			const CONTENT_FIELDS = [
				"banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover",
				"event", "eventDates", "eventDatesRaw", "eventHover"
			];
			function normalizeRecord(rec, name) {
				const src = rec || {};
				const out = { name: name || src.name || "" };
				for (const f of CONTENT_FIELDS) out[f] = typeof src[f] === "string" ? src[f] : "";
				// 老缓存的 fail 是**字符串**（"event-down" / "no-match" / 错误原文）：必须在这里就归一成
				// { kind, reason }，否则按契约实现的其它消费者（扩展/CLI）用 isDown() 会把字符串判成成功
				// （"失败被错显成未公布"）。键名与值域不变，不需要升 schemaVersion。
				out.gachaFail = normalizeFail(src.gachaFail);
				out.eventFail = normalizeFail(src.eventFail);
				out.gachaStale = !!src.gachaStale;
				out.eventStale = !!src.eventStale;
				if (src.skipped) out.skipped = true;
				out.okAt = typeof src.okAt === "number" ? src.okAt : 0;
				return out;
			}

			// 上次结果（Result JSON 形态；没有缓存时 games 为空对象，UI 直接显示静态默认值即可）
			async function getCached() {
				const raw = await storage.get("lastData");
				const parsed = raw ? parseJsonStr(raw, {}) : {};
				const byId = parsed && typeof parsed === "object" ? parsed : {};
				const games = {};
				// 老缓存也补齐成同一形状（缺字段填空串）——消费方只需认一种形状
				for (const [id, rec] of Object.entries(byId)) games[id] = normalizeRecord(rec, rec && rec.name);
				const at = await storage.get("lastRefresh");
				const entries = getAllEntries(await readSettings());
				return {
					schemaVersion: ENGINE_SCHEMA_VERSION,
					refreshedAt: Number(at) || 0,
					parserVersions: parserVersionsOf(entries),
					games
				};
			}

			// 条目元信息（名字 / 图标 / 来源标签 / 可选来源清单 / 静态默认值 / 是否隐藏）。
			// 各平台 UI 用它画列表；**不含抓取结果**（结果在 getCached() / refresh() 里）。
			async function listGames() {
				const s = await readSettings();
				const hidden = Array.isArray(s.hidden) ? s.hidden : [];
				return getAllEntries(s).map((g) => ({
					id: g.id,
					name: g.name,
					icon: g.icon,
					source: g.source,
					eventSource: g.eventSource,
					altSources: (g.altSources || []).map((a) => ({ label: a.label, value: altSourceId(a) })),
					eventAltSources: (g.eventAltSources || []).map((a) => ({ label: a.label, value: altSourceId(a) })),
					custom: !!g.custom,
					hidden: hidden.includes(g.id),
					defaults: {
						banner: g.banner || "",
						roles: g.roles || "",
						bannerDates: g.bannerDates || "",
						event: g.event || "",
						eventDates: g.eventDates || ""
					}
				}));
			}
