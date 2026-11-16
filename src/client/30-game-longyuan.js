// src/client/30-game-longyuan.js —— 龙渊网络：物华弥新（wuhuamixin）
//
// 职责（2026-11-16 按厂商重排）：wuhuamixin 的条目 + 解析器 + 抓取器 + 登记都在本文件。
// 组成：
//   · 30-game-bwiki-wuhuamixin.js：bwiki「限时招集档案」/「活动」两个表解析（卡池侧默认源）；
//   · 30-game-biligame.js 的「① 物华弥新 活动正文档期」段 + 外显挑选 / 抓取器：活动侧默认源 =
//     api.biligame.com 官方公告（gameExtensionId=613，typeId=4/1 两路都要拉）；
//   · 30-game-bwiki-register.js 里 wuhuamixin 的注册与 GACHA/EVENT_FETCHERS 接线。
// 复用关系：bwiki 公共层（载荷生成器）+ biligame 官方新闻 API 公共层（30-game-biligame-common.js：
//   列表合并 / 档期抽取 / 标题清洗）；符号名 `ns_bwiki_*` / `ns_biligame_activity_*` 原样保留。
// 请求预算：卡池 1 次（bwiki 页面）；活动 = 两路列表（2 次）+ 详情 ≤6 篇（每轮最多 8 次）。

// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-wuhuamixin.js：bwiki 卡池页 / 活动页解析（卡池侧默认源）
// ─────────────────────────────────────────────────────────────────────────────

//#region ① 物华弥新（whmx）
// 卡池页「限时招集档案」：`<table id="CardSelectTr" class="CardSelect wikitable sortable col-fold">`
//   表头 `活动名称 | UP器者 | 开放时间 | 备注`，113 行数据；**名称/UP 都只在 <img alt> / <a title> 属性里**
//   （正文 text 是空的），所以必须读属性。行属性 `data-param1` 是招集类型（新实装器者·限定 …）。
//   时间写法：`2026年09月30日 10:00 ~ 10月22日 09:59`（终点省年份）；远古行有 `2024年4月19日开服后~…`。
function ns_bwiki_parseWhmxGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];                       // 空页 → 无候选
	const cands = ns_bwiki_findTablesByHeaders(tables, ["开放时间", "活动名称"]);
	if (cands.length === 0) throw new Error("bwiki-whmx-gacha:no-table");   // 结构变了 → 抓取失败
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[2].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c2.text, tz, orient);
		if (wins.length === 0) return;
		const banner = ns_bwiki_cleanImgName(ns_bwiki_attrOf(c0.html, "alt")) || c0.text || ns_bwiki_attrOf(r.attrs, "data-param1") || "限时招集";
		const roles = ns_bwiki_linkTitles(c1.html).join("、") || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt"));
		items.push({
			_i: i, banner, roles, category: ns_bwiki_attrOf(r.attrs, "data-param1"), note: c3.text,
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw, display: wins[0].display
		});
	});
	return items;
}
// 活动页「活动」：同款 CardSelect 表，表头 `活动时间 | 图 | 名称 | 类型 | 备注`，63 行数据。
// ⚠️ 实测最新一条 = 2025/05/01（页面缓存时间 2026-10-01，即内容确实停在 2025-05）→ 当期无覆盖 → null。
function ns_bwiki_parseWhmxEvents(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const cands = ns_bwiki_findTablesByHeaders(tables, ["活动时间", "名称", "类型"]);
	if (cands.length === 0) throw new Error("bwiki-whmx-event:no-table");
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 5 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[0].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3, c4] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c0.text, tz, orient);
		if (wins.length === 0) return;
		items.push({
			_i: i,
			event: c2.text || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")) || "活动",
			category: c3.text, img: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")), note: c4.text,
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw, display: wins[0].display
		});
	});
	return items;
}
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-biligame.js 的「① 物华弥新」段：官方公告活动侧（两路 typeId 合并 / 外显挑选 / 抓取器）
// ─────────────────────────────────────────────────────────────────────────────

// ══ ① 物华弥新 国服（gameExtensionId=613）══════════════════════════════════
//   ⚠️⚠️ **两路 typeId 都要拉，缺一会丢档期**（实测）：
//     typeId=4（`typeName=活动`）totalNum=36，最新 2026-09-30 id=18419「经以山海」限时活动开启
//     typeId=1（`typeName=公告`）totalNum=17，**最新 2026-09-10 id=18334「无稽妄语」限时活动开启**
//       —— 18334 这条**不在 typeId=4 里**（两路 id 集合实测**零重叠**：36 ∩ 17 = ∅）
//   合并规则：按 id 去重 + 按 `displayTime||ctime` 严格倒序（实测合并后前 6 条 =
//   18419 / 18334 / 18265 / 18194 / 18109 / 18047，夹具都抓了前 5 条详情）。
//
//   ══ 正文档期形态（**注意：与任务书里的猜测不同，这里是实测原文**）══
//     `活动时间：9月23日 10:00 ~ 10月22日 09:59`      ← **不带年份、用「月日」**
//     `活动时间：9月30日 10:00 ~ 常驻`                 ← 终点是「常驻」= 无终点 → **不产出**
//     标题与档期**不在同一段**：`<p>一、旅程将启-经以山海</p>` + `<p>活动时间：…</p>`
//     ⇒ 按 `</p>` 切段后，用小节标题（`一、…`）+ 紧随其后的 `活动时间：` 行配对。
//     年份推断：源站只写「月日」→ 取**该公告 displayTime 的年份**；起月比发布月大 6 个月以上
//     视为上一年（跨年公告），终点若比起点早就 +1 年。（夹具里所有窗口都同年，无需跨年。）
//     kind：小节标题含 `招集|招募|引介|卡池|扭蛋` → 卡池侧，其余 → 活动侧（本文件活动侧只用后者）。
//
//   ══ 外显取哪一条？══
//     同一份公告里有十几条「活动时间」（登录活动、主线活动、试炼场、衣装…全都叫「活动时间」）。
//     规则：① 覆盖 now 优先；② 小节名与**标题里引号中的活动名**完全一致者优先
//     （18419 标题「经以山海」限时活动开启 → 小节`四、经以山海`；18334 → 小节`二、无稽妄语`），
//     ③ 其次结束最早；④ 并列按文档顺序。⇒ 取到的是本期**主线活动**，而不是最早结束的登录活动。
//

//#region ① 物华弥新 活动正文档期
// 小节标题 `一、旅程将启-经以山海` / `十三、试炼场`
const ns_biligame_activity_WHMX_SECTION_RE = /^[一二三四五六七八九十百]+\s*[、.．]\s*(.+)$/;
// 小节名含这些词 → 卡池侧（本文件活动侧不用；保留 kind 便于测试断言）
const ns_biligame_activity_GACHA_SEC_RE = /招集|招募|引介|卡池|扭蛋/;
const ns_biligame_activity_WHMX_LABEL_RE = /^([^\s：:]{2,12})\s*[：:]/;
// 正文 HTML → { items:[{ name, section, label, startTs, endTs, raw, glued, kind }], skipped, paragraphs }
function ns_biligame_activity_parseWhmxActivity(html, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, yearHint = null) {
	const paragraphs = ns_biligame_activity_biligameParagraphs(html);
	const items = [], skipped = [];
	let section = "";
	for (const para of paragraphs) {
		const sec = ns_biligame_activity_WHMX_SECTION_RE.exec(para);
		if (sec) { section = sec[1].trim(); continue; }     // 标题独占一段（实测）
		const { norm, windows, skipped: sk } = ns_biligame_activity_extractWindowsDetailed(para, yearHint, tz);
		if (!windows.length) {
			for (const s of sk) skipped.push({ ...s, section });
			continue;
		}
		const labelM = ns_biligame_activity_WHMX_LABEL_RE.exec(para);
		const label = labelM ? labelM[1] : "";
		for (const w of windows) {
			items.push({
				name: section || label,
				section,
				label,
				startTs: w.startTs,
				endTs: w.endTs,
				raw: w.raw,
				rawNorm: w.rawNorm,
				glued: w.glued,
				kind: ns_biligame_activity_GACHA_SEC_RE.test(section) ? "gacha" : "event"
			});
		}
		for (const s of sk) skipped.push({ ...s, section });
	}
	return { items, skipped, paragraphs };
}
//#endregion

// 标题里引号中的活动名：`「经以山海」限时活动开启` → 经以山海
// （物华弥新用它把外显锁定到本期主线活动小节，而不是最早结束的登录活动）
function ns_biligame_activity_quotedName(title) {
	const m = /[「“"【]([^」”"】]{2,14})[」”"】]/.exec(String(title == null ? "" : title));
	return m ? m[1].trim() : "";
}

//#region 物华弥新 外显挑选 / 抓取器
function ns_biligame_activity_pickWhmxEvent(items, now, preferName = "") {
	const act = (items || []).filter((x) => x.kind === "event" && coversNow(x, now));
	if (!act.length) return null;
	const rank = (x) => {
		if (!preferName) return 1;
		if (x.section === preferName) return 0;
		if (x.section.includes(preferName)) return 1;
		return 2;
	};
	return act.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
// 选当期事件：**直接用共用 pickCovering**（覆盖 now + kind 过滤 + 按开始时间升序）
function ns_biligame_activity_coveringWhmxEvents(items, now) {
	return pickCovering(items, { now, kind: "event", sort: (a, b) => (a.startTs - b.startTs) || 0 });
}
// ⚠️ 曾经这里有 `WHMX_TZ_NOTE`（时区推定说明）与 `skipNote()`（「常驻不产出」说明），两者都只用于
//    拼旧悬停 → 用户要求「元信息彻底删掉」后**已整体删除**（时区推定的依据仍在文件头 ① 的交叉印证里，
//    「常驻」为何不进 items 仍在 `ns_biligame_activity_extractWindowsDetailed` 的注释与 `skipped[].reason` 里）。

// 活动侧抓取器（契约：async (url, signal, tz, now = nowMs()) → 对象 | null）
//   两路 typeId（4 与 1）**都拉** → 合并去重倒序 → 逐条抓详情（≤6 篇）→ 正文抽档期 → 挑覆盖 now 的
//   · 抓到公告但没有任何覆盖 now 的活动档期 → null（未公布）
//   · 所有详情请求都失败 → 抛错（不能把「源站挂了」静默降级成「未公布」）
//   · 一路 feed 失败且最终没找到覆盖 now 的档期 → 抛错（此时不能声称「未公布」）
async function ns_biligame_activity_eventsWhmxOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = nowMs()) {
	const listUrl = url || ns_biligame_activity_WHMX_LIST_URL;
	const merged = [];
	const feedErrors = [];
	let okFeeds = 0;
	for (const u of ns_biligame_activity_whmxListUrls(listUrl)) {
		try {
			const items = ns_biligame_activity_parseBiligameList(await fetchJson(u, { referer: ns_biligame_activity_WHMX_HOME, signal, mode: "proxy" }));
			merged.push(items);
			okFeeds++;
		} catch (e) {
			feedErrors.push(e);
		}
	}
	if (okFeeds === 0) throw feedErrors[0];
	const list = ns_biligame_activity_mergeBiligameLists(merged);
	if (!list.length) return null;                     // 两路都是空列表 → 源站无公告 = 未公布
	let firstErr = null, loaded = 0;
	for (const it of list.slice(0, ns_biligame_activity_DETAIL_LIMIT_WHMX)) {
		let d = null;
		try {
			const detail = await fetchJson(ns_biligame_activity_biligameDetailUrl(listUrl, it.id), { referer: ns_biligame_activity_WHMX_HOME, signal, mode: "proxy" });
			d = detail && detail.data;
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		if (!d || typeof d.content !== "string") continue;
		loaded++;
		const title = decodeExtra(d.title || it.title || "").replace(/\s+/g, " ").trim();
		const parsed = ns_biligame_activity_parseWhmxActivity(d.content, tz, ns_biligame_activity_yearHintOf(it, tz));
		const best = ns_biligame_activity_pickWhmxEvent(parsed.items, now, ns_biligame_activity_quotedName(title));
		if (!best) continue;
		// 悬停 = 覆盖 now 的全部活动档期，逐行「小节名 + 3 空格 + 档期」（**条目反生成**，按结束时间升序）。
		// 只有 1 条 → 生成器返回 "" → **不设** eventHover，交回 UI 默认两行式（`event` ⏎ `eventDates`）。
		// ⚠️ 旧版的「来源：B站官方公告 api.biligame.com/news（gameExtensionId=613，typeId=4/1…
		// 共 N 篇）」「物华弥新 国服 · 标题 + tz 推定」「▶ 标出外显那条」「另有 N 条常驻不产出」
		// 全部是元信息/实现说明 → 已彻底删除（见文件头「悬停规则」）。
		// ── P3b：条目事实 → 悬停 + `events` 数组 ──────────────────────────────
		const eventItems = ns_biligame_activity_hoverRows(ns_biligame_activity_coveringWhmxEvents(parsed.items, now), (x) => x.section || x.label);
		const eventHover = hoverTextFromItems(eventItems, "event", tz);
		const eventDates = fmtWindow(best.startTs, best.endTs, tz);
		const out = {
			event: ns_biligame_activity_cleanTitle(title) || best.section || best.label,
			eventDates,
			eventDatesRaw: best.raw,
			...(eventHover ? { eventHover } : {})
		};
		out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
		out.eventHoverItems = eventItems;
		return out;
	}
	if (loaded === 0 && firstErr) throw firstErr;
	if (feedErrors.length) throw feedErrors[0];        // 一路 feed 失败 → 不能声称「未公布」
	return null;
}


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-register.js：wuhuamixin 的条目登记 + 抓取器接线（唯一一处注册）
// ─────────────────────────────────────────────────────────────────────────────

		registerSource({
				id: "wuhuamixin",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "物华弥新",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/13/7f/87/137f873a-f458-678d-347e-068830a74a69/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://wiki.biligame.com/whmx/api.php?action=parse&page=限时招集档案&prop=text&format=json&formatversion=2",
				source: "Bwiki",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=613&positionId=2&typeId=4&pageNum=1&pageSize=50",
				eventSource: "官方公告",
		});

		GACHA_FETCHERS["wuhuamixin"] = (url, signal, tz) => ns_bwiki_gachaWhmx(url, signal, tz);

		EVENT_FETCHERS["wuhuamixin"] = Object.assign(EVENT_FETCHERS["wuhuamixin"] || {}, { default: (url, signal, tz) => ns_biligame_activity_eventsWhmxOfficial(url, signal, tz) });
