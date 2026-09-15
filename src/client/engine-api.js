			// —— 环境注入：把宿主给的三样东西接到 coreEnv（15-env.js）——
			// 必须放在 core 段之后：coreEnv 是 let 声明，提前调用会踩 TDZ。
			setCoreEnv({
				transport: engineEnv.transport,
				now: engineEnv.now || (() => Date.now()),
				timer: engineEnv.timer || {}
			});

			// 抓取一轮：读配置 → 逐条抓取（卡池/活动各自独立）→ 与上次缓存按列合并 →
			// 写回缓存 → 返回 Result JSON（这就是"产品接口"，各平台 UI 只读它）。
			async function refresh() {
				const s = await readSettings();
				// 用"全部条目"（含隐藏）抓取：隐藏再显示时立刻有数据，与既有行为一致
				const entries = getAllEntries(s);
				const result = await refreshAll(entries, s);
				const prev = await getCached();
				const games = {};
				entries.forEach((e, i) => {
					const rec = mergeEntryRecord(result.results[i], prev.games[e.id], nowMs());
					if (result.results[i].reason === "skipped") rec.skipped = true;
					games[e.id] = { name: e.name, ...rec };
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
			}

			// 解析器自检（交接文档 §13.4）：对每个条目的两侧来源各跑一次，报告「解析出什么 / 报错原因」。
			// 用途：源站改版时快速定位「哪个源解析出 0 条、哪个源 403/超时」——各平台都能调用
			// （将来扩展里做「自检」按钮、CLI、CI 都行）。**只读**：不写缓存、不动设置。
			async function selfCheck(options) {
				const timeoutMs = (options && options.timeoutMs) || 12000;
				const s = await readSettings();
				const entries = getAllEntries(s);
				const targets = entries.map((e) => ({
					...e,
					url: getEntryUrl(s, e.id, e.url),
					eventUrl: getEntryUrl(s, e.id, e.eventUrl, "eventUrl"),
					allowGenericGacha: !!e.custom || isCustomSource(s, e.id),
					allowGenericEvent: !!e.custom || isCustomSource(s, e.id, "eventUrl")
				}));
				const ac = typeof AbortController === "function" ? new AbortController() : null;
				const timer = coreEnv.timer.setTimeout(() => { if (ac) ac.abort(); }, timeoutMs);
				let results;
				try {
					results = await Promise.all(targets.map((t) => fetchEntry(t, ac ? ac.signal : void 0)));
				} finally {
					coreEnv.timer.clearTimeout(timer);
				}
				// 一侧的结论：ok=有内容；nomatch=抓到页面但没当期内容（这才是"解析出 0 条"）；down=抓取/解析报错
				const describe = (kind, fail, data) => {
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
					const gacha = describe("gacha", r.gachaFail, d);
					const event = describe("event", r.eventFail, d);
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
