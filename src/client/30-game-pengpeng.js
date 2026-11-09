// src/client/30-game-pengpeng.js —— 夜幕之下（国服；曾用名「代号砰砰」，2026-06-05 公测）
//
// **只有卡池源**（2026-11-09 实测 200，夹具 test/fixtures/pengpeng-bwiki）：
//   bwiki「契约一览」= MediaWiki `api.php?action=parse`（HTML 表，18 行 / 45KB）
//     列：契约 | 开放时间 | 概率提升的风格
//     行例：隐秘的归属 | 2026/09/10 05:00:00 ~ 2026/10/01 04:59:59 | 杯中藏锋 | 活动
//
// ── 活动侧为什么留空（`eventUrl` 不给）──────────────────────────────────────────
// 官方只有**逐条公告页**（无列表接口、无稳定分页），没有一页能一次取到"活动 + 起止"的表；
// bwiki 侧也没有活动一览页。⇒ 按用户要求「暂时没有数据源的就留空未配置」：
// 条目照常注册，`eventUrl` **不写**（不假冒"配了一个源"）。
//   · 刷新（50-refresh.js）：`source.url` 有 ⇒ 卡池侧照抓；`source.eventUrl` 空 ⇒ 活动侧**根本不抓**，
//     既不记成功也不记失败（`fetchEntry` 只对给了地址的那一侧判 fail）；
//   · 自检（engine-api.js 的 describe）：活动侧 `!url` ⇒ `state:"unconfigured"`，
//     设置页写「未配置来源」，**不算失败**（summary.unconfigured 单独计数）；
//   · 设置页「活动来源」下拉：`getDefaultSourceName(g,"eventUrl")` → 裸「未配置」。
//
// ── 时区 ──
// 源站无标注；时间写成 `05:00:00 ~ 04:59:59`（凌晨 5 点换池 + 结束前一秒），是国服 UTC+8 口径
// ⇒ tz = Asia/Shanghai（推定，只写在这里，不进悬停）。
//
// ── 卡池类型（category）──
// 「契约」列里有个 `遴选 / 活动` 标签（`<span class="ymzx-qiyue-tag">`），就是卡池类型；
// 长期池（`开放时间` 列写「长期」）没有这个标签 ⇒ 不写 category。
//
// ── 长期池（「长期的呼唤」「起始的契约」）──
// `开放时间` 列写 `长期` ⇒ 读不出窗口（`coversNow` 要求 endTs 非空），**如实跳过**：
// 没有结束时刻就算不出倒计时，画不出来。屏幕上的代价只是这两口常驻池不进日历。

		const PENGPENG_TZ = "Asia/Shanghai";
		const PENGPENG_BWIKI_URL = "https://wiki.biligame.com/pengpeng/api.php?action=parse&page=契约一览&prop=text&format=json&formatversion=2";

		// 「契约」列：名称住在最后一个加粗 span 里（长期池也有），类型标签是另一枚 span
		const PENGPENG_NAME_RE = /<span\b[^>]*style="[^"]*font-weight\s*:\s*bold[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
		const PENGPENG_TAG_RE = /<span\b[^>]*class="[^"]*ymzx-qiyue-tag[^"]*"[^>]*>([\s\S]*?)<\/span>/i;

		// 一行「契约」单元格 → { name, category }
		function pengpengNameOf(html) {
			const s = String(html == null ? "" : html);
			const tag = s.match(PENGPENG_TAG_RE);
			const category = tag ? stripTags(tag[1]).trim() : "";
			PENGPENG_NAME_RE.lastIndex = 0;
			let m, name = "";
			// 取**最后一个**加粗 span：角色的 `<span style="font-weight:bold">` 只出现在名称上，
			// 但取最后一个能顺带避开将来源站在前面再加别的加粗块。
			while ((m = PENGPENG_NAME_RE.exec(s))) name = stripTags(m[1]).trim();
			if (!name) {
				// 兜底：整格文本去掉类型标签（`遴选天才不必孑立` → `天才不必孑立`）
				name = stripTags(s).trim();
				if (category && name.indexOf(category) === 0) name = name.slice(category.length).trim();
			}
			return { name, category };
		}

		// HTML → 逐条 `{ banner, roles, category, startTs, endTs, raw, isMain }`（与 whmx 同形）
		function pengpengPoolsOf(html, tz) {
			const tables = ns_bwiki_findTablesByHeaders(ns_bwiki_eachTable(String(html == null ? "" : html)), ["契约", "开放时间"]);
			const out = [];
			let i = 0;
			for (const tbl of tables) {
				for (const r of ns_bwiki_tableRows(tbl)) {
					const cells = r.cells || [];
					if (cells.length < 3) continue;
					// 时间列交给 bwiki 系共用的日期解析（`2026/09/10 05:00:00 ~ 2026/09/24 04:59:59`）；
					// `长期` 只有一个点 ⇒ 返回 []，如实跳过（见文件头）。
					const win = ns_bwiki_windowsFromCell(cells[1].text, tz, "startFirst")[0];
					if (!win) continue;
					const { name, category } = pengpengNameOf(cells[0].html);
					if (!name) continue;
					out.push({
						banner: name,
						roles: ns_bwiki_linkTitles(cells[2].html).join("\u3001"),
						category,
						startTs: win.startTs,
						endTs: win.endTs,
						// 两份文本（约定见 `30-game-bwiki-common.js` 文件头）：
						//   raw = 源站原文那一句（`2026/09/10 05:00:00 ~ 2026/09/24 04:59:59`）
						//   display = 补全后的可读文本（`MM-DD HH:MM ~ MM-DD HH:MM`，源站 tz）
						// ⚠️ 原先这里把**格式化后**的字符串塞进 `raw` ⇒ 原文丢了、且与 display 同值。
						raw: win.raw,
						display: win.display,
						isMain: true,
						_i: i++
					});
				}
			}
			return out;
		}

		// 抓取器（契约：async (url, signal, tz) → 数据对象 | null；now 在最后、有默认值）
		// bwiki 是 biligame 系主机 ⇒ 必须走宿主代理（见 15-env.js 的 CORS 收口点）
		async function ns_pengpeng_gachaPengpeng(url, signal, tz = PENGPENG_TZ, now) {
			const html = await fetchMediaWikiText(url, { signal, mode: "proxy" });
			const items = pengpengPoolsOf(html, tz);
			if (items.length === 0) throw new Error("pengpeng-no-table");
			return ns_bwiki_batchGachaPayloadOf(items, tz, typeof now === "number" && Number.isFinite(now) ? now : nowMs(), { id: "pengpeng" });
		}

		// ── 条目 ──
		registerSource({
			id: "pengpeng",
			defaultHidden: true,
			tz: PENGPENG_TZ,
			name: "夜幕之下",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/3f/59/95/3f599572-4d8c-f4f3-0270-1ee72e007926/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
			url: PENGPENG_BWIKI_URL,
			source: "Bwiki",
			// eventUrl **故意不给**（活动侧没有可用来源）：见文件头「活动侧为什么留空」
		});

		GACHA_FETCHERS["pengpeng"] = (url, signal, tz) => ns_pengpeng_gachaPengpeng(url, signal, tz);
