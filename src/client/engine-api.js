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
				// 一侧的结论：ok=有内容；nomatch=抓到页面但没当期内容（这才是"解析出 0 条"）；down=抓取/解析报错
				const describe = (kind, fail, data, url) => {
					// 该侧压根没配来源（如自定义条目只填了卡池地址）：自检的意义就是指出"哪个源没内容/报错"，
					// 这里必须报出来，不能因为"从没抓过"而显示成正常（fail 恒为 null 的假 ok）
					if (!url) return { state: "down", reason: "未配置来源", text: "未配置来源" };
					const f = normalizeFail(fail);
					if (!f) {
						const text = kind === "gacha"
							? [data.roles || data.banner, data.bannerDates].filter(Boolean).join(" / ")
							: [data.event, data.eventDates].filter(Boolean).join(" / ");
						return { state: "ok", reason: "", text: text || "（抓到了，但内容为空）" };
					}
					if (f.kind === "nomatch") return { state: "nomatch", reason: "", text: "解析出 0 条（源站无当期内容）" };
					return { state: "down", reason: f.reason || "抓取异常", text: "抓取失败：" + (f.reason || "抓取异常") };
				};
				const games = {};
				const summary = { ok: 0, nomatch: 0, down: 0 };
				entries.forEach((e, i) => {
					const r = results[i] || {};
					const d = r.data || {};
					const t = targets[i] || {};
					const gacha = describe("gacha", r.gachaFail, d, t.url);
					const event = describe("event", r.eventFail, d, t.eventUrl);
					games[e.id] = { name: e.name, parserVersion: e.parserVersion, gacha, event };
					for (const side of [gacha, event]) summary[side.state]++;
				});
				const problems = [];
				for (const [id, v] of Object.entries(games)) {
					const bad = [];
					if (v.gacha.state !== "ok") bad.push("卡池 " + v.gacha.text);
					if (v.event.state !== "ok") bad.push("活动 " + v.event.text);
					if (bad.length) problems.push(`${v.name}(${id}): ${bad.join("；")}`);
				}
				return { at: nowMs(), total: entries.length, summary, problems, games };
			}

			// 测试出口：给回归脚本用（DSH 产物里只在 globalThis.__DSH_GACHA_TEST__ 为真时对外暴露）
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
				DEFAULT_SETTINGS
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
