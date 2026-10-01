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
				// 只抓"选中展示"的条目（getVisibleEntries = 全部 - hidden）：
				// 面板本就只渲染可见条目（80-components 用同一个函数），抓隐藏条目是**纯浪费**——
				// 每轮都为它们发请求、解析、写缓存（自定义条目 404 还会一直计入失败统计）。
				// 隐藏条目的**旧数据原样保留**，所以取消隐藏时仍能立刻看到上次内容（见下面 forEach 的 else 支）。
				//
				// ⚠️ 索引必须**按 id 映射**，不能用 `entries.indexOf(e)`：
				// `getVisibleEntries(s)` 内部自己又调了一次 `getAllEntries(s)`，返回的是**另一批对象**，
				// 与这里的 `allEntries` 元素不是同一个引用 → `indexOf` 恒为 -1 →
				// `result.results[-1]` 是 undefined → 刷新直接抛 TypeError。
				// （2026-10-01 实测踩到：**没有隐藏条目的用户一刷新就崩**，正是最普遍的那种配置。）
				const allEntries = getAllEntries(s);
				const entries = getVisibleEntries(s);
				const resultByIndex = new Map(entries.map((e, i) => [e.id, i]));
				const result = await refreshAll(entries, s);
				const prev = await getCached();
				const games = {};
				allEntries.forEach((e) => {
					const i = resultByIndex.get(e.id);
					if (i === void 0) {
						// 隐藏（未选中展示）→ 本轮**不抓、也不判定**，但要把两件事分开处理：
						//
						// · **内容字段与 okAt 原样保留** —— 取消隐藏时仍能立刻看到上次内容（既有体验）。
						// · **失败状态（gachaFail/eventFail）与 stale 标记一律清空** ——
						//   隐藏期间我们**没有发起请求**，所以"失败"这个判断**根本不成立**：
						//   保留一个未经验证的旧失败等于在说谎。更要命的是它会被**冻结**：
						//   这里只做 `normalizeRecord(prev.games[e.id])` 的搬运、从不重新判定，
						//   于是那条失败原因会一直是"隐藏前最后一次抓取"留下的值——
						//   实测：源站恢复后连刷 3 轮，隐藏记录里的 `抓取异常` 依然不动。
						//   后果：用户取消隐藏后，会先看到一条**可能早已过期**的失败原因。
						//   （2026-10-01 用户追问"失败原因是哪来的"后定为方案 B。）
						const kept = prev.games[e.id];
						const blank = { ...(kept || {}) };
						delete blank.gachaFail;
						delete blank.eventFail;
						delete blank.gachaStale;
						delete blank.eventStale;
						games[e.id] = normalizeRecord(blank, e.name);
						return;
					}
					const r = result.results[i] || { reason: "skipped" };
					const rec = mergeEntryRecord(r, prev.games[e.id], nowMs());
					if (r.reason === "skipped") rec.skipped = true;
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
			//
			// 口径与刷新一致：**只自检"选中展示"的条目**（同 getVisibleEntries）。
			// 理由：自检的用途是"定位当前实际在用的源"，而隐藏条目既不在面板显示、也不参与刷新；
			// 把它们一起报出来只会让结论里混进与当前无关的失败（如已隐藏的自定义条目 404）。
			async function selfCheck(options) {
				useEnv();
				const timeoutMs = (options && options.timeoutMs) || REFRESH_TIMEOUT_MS;
				const s = await readSettings();
				const entries = getVisibleEntries(s);
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
					// 状态词写成「无匹配/未公布」：既说清"解析没命中"，也保留面板那边的"未公布"口径
					if (f.kind === "nomatch") return { state: "nomatch", reason: "", text: "无匹配/未公布" };
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
				formRejectHint,
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
