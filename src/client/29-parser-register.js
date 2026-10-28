		//#region proxy fetchers（经 host 代理）与统一来源注册表
		// 中文时间解析（繁体/简体共用）：
		// "8月18日(二)維護後" / "9月1日(二)上午9點59分" / "晚間10點59分" / "08月20日 14:00"
		function parseZhTime(raw, nowYear) {
			const s = String(raw).trim();
			const md = s.match(/(\d{1,2})月(\d{1,2})日/);
			if (!md) return null;
			const mo = Number(md[1]), d = Number(md[2]);
			let h = 0, mi = 0;
			const tm = s.match(/(上午|下午|中午|凌晨|晚上|晚間)?\s*(\d{1,2})[點点](\d{1,2})?[分]?/);
			if (tm) {
				let hh = Number(tm[2]);
				const mm = tm[3] ? Number(tm[3]) : 0;
				const period = tm[1] || "";
				if ((period === "下午" || period === "晚上" || period === "晚間") && hh < 12) hh += 12;
				if (period === "中午" && hh < 12) hh += 12;
				if (period === "凌晨" && hh === 12) hh = 0;
				h = hh; mi = mm;
			}
			const ts = new Date(nowYear, mo - 1, d, h, mi).getTime();
			return { ts, text: `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
		}


		// 经 host 代理抓取文本 / JSON 两个函数的**实现**已移到外壳（92-dsh-env.js 的 transport.fetchViaProxy），
		// core 侧只在 15-env.js 保留 `proxyFetchText` / `proxyFetchJson` 两个薄封装（转调 coreEnv.transport）——这是 core 零宿主依赖的接缝之一。

		// 解析繁体时间段："8月18日(二)維護後 ~ 9月1日(二)上午9點59分"
		// 跨年（如 12月30日 ~ 1月5日）：结束月份小于开始月份 → 结束端按"下一年"解析；
		// 否则 end 会早于 start，当期会被误判成"未公布"（每年 12 月底~1 月初复发）。
		function parseBaZhRange(raw, nowYear) {
			const s = stripTags(raw);
			const parts = s.split(/[~～]/).map((x) => x.trim());
			if (parts.length < 2) return null;
			const moOf = (x) => { const m = String(x).match(/(\d{1,2})月/); return m ? Number(m[1]) : null; };
			const am = moOf(parts[0]), bm = moOf(parts[1]);
			const a = parseZhTime(parts[0], nowYear);
			const b = parseZhTime(parts[1], am != null && bm != null && endsNextYear(am, null, bm, null) ? nowYear + 1 : nowYear);
			if (!a || !b) return null;
			return { startTs: a.ts, endTs: b.ts, startText: a.text, endText: b.text, raw: `${a.text} ~ ${b.text}` };
		}


		// ---- GameKee（蔚蓝档案）----
		// 解析标题里的排期：【8/18~9/01】 / 【8月26日 ~ 9月9日】 → {startText, endText, startTs, endTs}
		function parseGkRange(title, nowYear) {
			const m = String(title).match(/【([^】]+)】/);
			if (!m) return null;
			const inner = m[1].replace(/\s+/g, "");
			const parts = inner.split(/[~～\-—]/);
			if (parts.length < 2) return null;
			const moOf = (p) => { const md = p.match(/(\d{1,2})[\/月](\d{1,2})日?/); return md ? Number(md[1]) : null; };
			const parseGkTime = (p, year) => {
				// 8/18 或 8月18日（日服可能带 日）
				const md = p.match(/(\d{1,2})[\/月](\d{1,2})日?/);
				if (!md) return null;
				const mo = Number(md[1]), d = Number(md[2]);
				const ts = new Date(year, mo - 1, d, 0, 0).getTime();
				return { ts, text: `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} 00:00` };
			};
			// 跨年（如 【12/28~1/5】）：结束月份小于开始月份 → 结束端按"下一年"解析
			const am = moOf(parts[0]), bm = moOf(parts[1]);
			const a = parseGkTime(parts[0], nowYear);
			const b = parseGkTime(parts[1], am != null && bm != null && endsNextYear(am, null, bm, null) ? nowYear + 1 : nowYear);
			if (!a || !b) return null;
			return { startTs: a.ts, endTs: b.ts, startText: a.text, endText: b.text, raw: `${a.text} ~ ${b.text}` };
		}

		const TZ_CN = "Asia/Shanghai";      // UTC+8：国服一览


		const AK_OFFICIAL_BULLETIN = "https://web-news.hypergryph.com/api/bulletin";


		// ⚠️ 2026-10-03 合并：以下内容原为独立文件 `src/client/43-sources-register.js`，
		//    现按用户要求（方案 C2）并入本文件。
		//
		//    为什么必须放在本文件**末尾**：它要在 `GACHA_FETCHERS` / `EVENT_FETCHERS`
		//    两张表**声明之后**才能登记（这两张表在本文件上方，是 `const`）→ 提前会 TDZ 报错。
		//
		//    为什么并入后仍然安全（C2 的前置条件，已逐条核实）：
		//      · 它引用 29 个解析器符号，**全是 `function` 声明**（会提升）→ 即使本文件排在
		//        那些 `42-parsers-*.js`（压平后见 30-game-*.js）之前也不会 TDZ；
		//      · 它对 `SOURCES`（模块级）的写操作**全部幂等**：`NS_SOURCES` 按 id 找到就覆盖、
		//        备选源挂接按 fetcher 去重、bh3 那处 push 已补上 `some()` 守卫 —— 因为 core 产物里
		//        本文件位于 `createEngine` 内部，**每次新建引擎都会重跑一遍**；
		//      · 两张表本身是 `createEngine` 内的 `const` → 每个引擎各一份，不会互相污染。
		//
		//    符号名与实现**一律未改**，原文件头保留在下面。
		// ═══════════════════════════════════════════════════════════════════════════

// 原 src/client/43-sources-register.js —— 新增来源的「条目声明 + 抓取器登记」（原文件头，压平后见 29-parser-register.js）
//
// 三件事：
//   ① 把 **17 条**新增来源追加进 `SOURCES`（16 条在 `NS_SOURCES` + 1 条 `bh3` 单独 push）
//   ② 登记主抓取器到 `GACHA_FETCHERS` / `EVENT_FETCHERS`
//   ③ 登记备选源抓取器，并把「米游社公告」挂成既有条目（原神/星铁/绝区零）的备选源 + 新建 `bh3`
//
// ⚠️ 数字口径（2026-10-03 核实，原文写的是「20 条」—— 不对）：
//   `20-source-core.js` 内置 **11** 条 + 本文件 **17** 条 = 最终 `SOURCES` **28** 条。
//   合并规则见下方 `for (const s of NS_SOURCES)`：**按 id 找，命中就 `Object.assign` 覆盖、否则 push**。
//   那条"覆盖"分支当前**不会触发**（现存 17 条与内置 11 条无一重名），它是留给
//   "新增来源要接管某条内置条目"的升级路径 —— 历史上 `wuhuamixin` / `uma-cn` 的默认源
//   就从 bwiki 换成了 biligame 官方公告，靠的正是它。**别因为"跑不到"就删掉。**
//
// 位置说明：本文件排在 `22-fetcher-core.js` **之后**（ORDER），因为它要往那两张表里登记、往 SOURCES 里追加。
//
// 历史沿革：内容原为生成物 `src/client/45-next-sources.js` 的尾部（由 `next-sources/registry*.js` 生成）。
// 2026-10-03 用户要求「把 next-sources 合并进原 source，不留 next-source」后压平为普通源码，
// `next-sources/` 与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
// （备选源的「键名 → 函数」对照表仍在 `test/registry-shim.mjs`，供测试侧的注册表结构守卫使用。）
//
// 历史沿革：内容原为生成物 `src/client/45-next-sources.js` 的尾部（由 `next-sources/registry*.js` 生成）。
// 2026-10-03 用户要求「把 next-sources 合并进原 source，不留 next-source」后压平为普通源码，
// `next-sources/` 与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
// （备选源的「键名 → 函数」对照表仍在 `test/registry-shim.mjs`，供测试侧的注册表结构守卫使用。）





		// ===== 登记抓取器（键 = 条目 id）=====





		//#region 米游社公告（挂成**备选源**，不改默认主源）
		// 用户 2026-10-02 明确要求：「米游社来源全部改名米游社公告，且降级备选，恢复原默认来源」。
		// 所以这里**只加备选**：原神/星铁保持 Bwiki，绝区零保持官方公告（api-takumi-static）。
		// 命中规则 `altSourceId = (alt) => alt.url` 与当前 url 字符串相等；下面是各游戏**专属 gids URL**，不会串。




		// 崩坏3：插件本体此前无来源 → 新建条目且**默认未配置**（用户要求）。

		// 未配置的语义（50-refresh.js）：`if (!source.url && !source.eventUrl) return { ok:true, reason:"skipped" }`

		// → 不抓取、不计成功也不计失败；UI 显示「未配置（不抓取卡池/活动）」。设置页选「米游社公告」即可启用。

		{


			GACHA_FETCHERS["bh3-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

			EVENT_FETCHERS["bh3"] = { default: null, "bh3-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } };

			// ⚠️ 幂等（2026-10-03 为「43 并入 40 进 core」而补）：
			//    这一段在 core 产物里位于 `createEngine` **内部**，每次新建引擎都会重跑；
			//    而 `SOURCES` 是**模块级**共享的 → 直接 push 会让 bh3 越堆越多
			//    （`test/cases-core.mjs` 就建了两个引擎，会立刻暴露）。
			//    本文件其余写操作本来就是幂等的：上面 `NS_SOURCES` 是"按 id 找到就覆盖"、
			//    备选源挂接是"按 fetcher 去重"，只有这处 push 不是。

		}

		//#endregion

		//#endregion
