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
					games
				};
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
				__test
			};
		}
		//#endregion
