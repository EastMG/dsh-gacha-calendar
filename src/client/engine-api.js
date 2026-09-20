			// —— 环境注入：把宿主给的三样东西接到 coreEnv（15-env.js）——
			// 必须放在 core 段之后：coreEnv 是 let 声明，提前调用会踩 TDZ。
			// 保存成本引擎自己的一份（含**完整的** timer 默认实现），并在每个公开方法入口重新注入：
			// coreEnv 是模块级单例，同一进程里建第二个引擎会把它覆盖；不重注入就会出现
			// "第一个引擎的时钟/传输/计时器被第二个引擎偷走"（安静串台，最难查）。
			const DEFAULT_TIMER = {
				setTimeout: (fn, ms) => setTimeout(fn, ms),
				clearTimeout: (id) => clearTimeout(id)
			};
			const ENGINE_ENV = {
				transport: engineEnv.transport,
				now: engineEnv.now || (() => Date.now()),
				// 补全默认实现：宿主只注入 setTimeout 时，clearTimeout 也必须是配套的那一个
				timer: { ...DEFAULT_TIMER, ...(engineEnv.timer || {}) }
			};
			function useEnv() {
				setCoreEnv(ENGINE_ENV);
			}
			useEnv();

			// 抓取一轮：读配置 → 逐条抓取（卡池/活动各自独立）→ 与上次缓存按列合并 →
			// 写回缓存 → 返回 Result JSON（这就是"产品接口"，各平台 UI 只读它）。
			// 在途保护：同一引擎并发调用时复用同一轮（否则两轮各自无条件写缓存，慢的那轮会用更旧的数据
			// 盖掉快的那轮，而 lastRefresh 却是更晚的时间戳 = "旧内容配新时间"）。
			let refreshInFlight = null;
			function refresh() {
				useEnv();
				if (refreshInFlight) return refreshInFlight;
				refreshInFlight = (async () => {
					const s = await readSettings();
				// 用"全部条目"（含隐藏）抓取：隐藏再显示时立刻有数据，与既有行为一致
				const entries = getAllEntries(s);
				const result = await refreshAll(entries, s);
				const prev = await getCached();
				const games = {};
				entries.forEach((e, i) => {
					const rec = mergeEntryRecord(result.results[i], prev.games[e.id], nowMs());
					if (result.results[i].reason === "skipped") rec.skipped = true;
					// 统一成固定形状（内容字段缺失填空串）——见 engine-head.js 的 normalizeRecord
					games[e.id] = normalizeRecord(rec, e.name);
				});
				await storage.set("lastData", JSON.stringify(games));
				await storage.set("lastRefresh", result.at);
				await storage.set("lastSource", result.status === "ok" ? "web" : "none");
				// 版本哨兵：只要这一轮**真的抓到了东西**（okCount > 0）就记当前插件版本。
				// 为什么不要求"整轮全绿"：长期挂掉的源（最常见的是用户自己填错的自定义条目）会永远失败，
				// 那样哨兵永远盖不上章 → 每次启动都强制刷一次（实测踩到：3 个自定义条目 404，11 个内置源全绿）。
				// 为什么不无条件写：整轮全失败（断网/全局故障）时不盖章 → 下次启动自动重试。
				if (result.okCount > 0) await storage.set("lastVersion", PLUGIN_VERSION);
				return {
					schemaVersion: ENGINE_SCHEMA_VERSION,
					refreshedAt: result.at,
					parserVersions: parserVersionsOf(entries),
					games
				};
				})();
				return refreshInFlight.finally(() => { refreshInFlight = null; });
			}

			// 解析器自检（交接文档 §13.4）：对每个条目的两侧来源各跑一次，报告「解析出什么 / 报错原因」。
			// 用途：源站改版时快速定位「哪个源解析出 0 条、哪个源 403/超时」——各平台都能调用
			// （将来扩展里做「自检」按钮、CLI、CI 都行）。**只读**：不写缓存、不动设置。
			async function selfCheck(options) {
				useEnv();
				const timeoutMs = (options && options.timeoutMs) || REFRESH_TIMEOUT_MS;
				const s = await readSettings();
				const entries = getAllEntries(s);
				const targets = entries.map((e) => ({
					...e,
					url: getEntryUrl(s, e.id, e.url),
					eventUrl: getEntryUrl(s, e.id, e.eventUrl, "eventUrl"),
					allowGenericGacha: !!e.custom || isCustomSource(s, e.id),
					allowGenericEvent: !!e.custom || isCustomSource(s, e.id, "eventUrl")
				}));
				// 与刷新同一套"到点收尾"兜底：transport 不理会 signal 时，自检也不会永远转圈
				const results = await runEntriesWithDeadline(targets, timeoutMs);
				// 一侧的结论：ok=有内容；nomatch=抓到页面但没当期内容；down=抓取/解析报错；
				// unconfigured=该侧压根没配来源（合法状态，**不算失败**——面板把它当"没这回事"，
				// 自检也必须同口径：单列一类，否则"没配"会混进"报错"数字里，用户去修也无从下手）
				const describe = (kind, fail, data, url) => {
					if (!url) return { state: "unconfigured", reason: "未配置来源", text: "未配置来源" };
					const f = normalizeFail(fail);
					if (!f) {
						const text = kind === "gacha"
							? [data.roles || data.banner, data.bannerDates].filter(Boolean).join(" / ")
							: [data.event, data.eventDates].filter(Boolean).join(" / ");
						return { state: "ok", reason: "", text: text || "解析结果为空" };
					}
					// 只写状态词本身：「未公布」已经表达了"源站没内容"，不必再缀一句解释（那句既长又口语）
					if (f.kind === "nomatch") return { state: "nomatch", reason: "", text: "未公布" };
					return { state: "down", reason: f.reason || "抓取异常", text: "抓取失败：" + (f.reason || "抓取异常") };
				};
				const games = {};
				const summary = { ok: 0, nomatch: 0, unconfigured: 0, down: 0 };
				entries.forEach((e, i) => {
					const r = results[i] || {};
					const d = r.data || {};
					const t = targets[i] || {};
					const gacha = describe("gacha", r.gachaFail, d, t.url);
					const event = describe("event", r.eventFail, d, t.eventUrl);
					games[e.id] = { name: e.name, parserVersion: e.parserVersion, custom: !!e.custom, gacha, event };
					for (const side of [gacha, event]) summary[side.state]++;
				});
				const problems = [];
				for (const [id, v] of Object.entries(games)) {
					const bad = [];
					if (v.gacha.state !== "ok") bad.push("卡池 " + v.gacha.text);
					if (v.event.state !== "ok") bad.push("活动 " + v.event.text);
					// 内部 id 只对自定义条目有意义（用户要靠它区分自己加的条目）；内置条目写游戏名即可
					if (bad.length) problems.push(`${v.name}${v.custom ? `(${id})` : ""}: ${bad.join("；")}`);
				}
				return { at: nowMs(), total: entries.length, summary, problems, games };
			}

			// 测试出口：给回归脚本用。**如实暴露**（不做隐藏门控/环境变量开关）：
			// 它只是内部函数的引用、不含任何数据，而"测试看得见、生产看不见"两套行为反而更容易埋坑；
			// 各平台的 UI 只应使用 createEngine 返回的公开方法。
			const __test = {
				fetchEntry,
				resolveSide,
				mergeEntryRecord,
				buildScrapeInfo,
				entryFailParts,
				sideFailText,
				normalizeFail,
				normErr,
				isDown,
				isNomatch,
				refreshAll,
				gachaFetcherFor,
				eventFetcherFor,
				normalizeSourceId,
				altSourceId,
				getEntryUrl,
				isCustomSource,
				readSettings,
				getCached,
				listGames,
				GACHA_FETCHERS,
				EVENT_FETCHERS,
				SOURCES,
				DEFAULT_SETTINGS,
				// 启动自动刷新判定（纯函数）与当前插件版本（注入自 package.json）：回归脚本据此验收
				autoRefreshPlan,
				PLUGIN_VERSION
			};

			return {
				schemaVersion: ENGINE_SCHEMA_VERSION,
				listGames,
				getCached,
				refresh,
				selfCheck,
				__test
			};
		}
		//#endregion
