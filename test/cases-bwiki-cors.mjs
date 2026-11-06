// test/cases-bwiki-cors.mjs —— bwiki 请求统一带 `origin=*`（CORS 收口点）的回归
//
// 为什么单开一段（2026-11-07 用户实测）：
//   · 浏览器直连 bwiki 且**不带** `origin=*` ⇒ `TypeError: Failed to fetch`（CORS 拒绝），
//     上层只能把它归成「网络不通」这种看不出根因的泛化失败；
//   · 同一 URL 带 `&origin=*` ⇒ HTTP 200。
//   而仓里 22 处 `https://wiki.biligame.com/…` 地址常量**全部没有**这个参数 —— 平时靠宿主代理
//   （不受 CORS 限制）盖住，任何走直连的路径都会静默失败。
//
// 修法**不是**逐个改那 22 个常量，而是在 transport 的**两条出口**上收口（`src/client/15-env.js`）：
//   `transportFetchRaw`（直连）与 `proxyFetchText`（宿主代理）都先过 `withBwikiCors`。
// 本段从三个角度钉住它：
//   ① **纯函数**：`withBwikiCors` 的全部边界（无 query 用 `?` / 已有 query 用 `&` / 已有 origin 不动 /
//      大小写·端口·hash / `*.biligame.com` / 非法与相对地址 / 幂等）；
//   ② **接线**：两条出口确实调了它，且全仓**只有一处**实现（收口点不许长出第二份）；
//   ③ **行为**：真抓一个 bwiki 来源（战双 wikitext —— 改造前它的 ask 索引与公告正文两条请求
//      **都没有** origin=*），用 fetch 记账断言实际发出的目标 URL 带上了；同时断言非 bwiki 站点的
//      请求 URL **逐字不变**（这是"收口点不会误伤别的站点"的反向守卫）。

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { check, section, useFixtures, setFetchImpl } from "./harness.mjs";
import { T, REPO } from "./load.mjs";

const CLIENT_DIR = path.join(REPO, "src", "client");
const PROXY_PREFIX = "/api/gacha-calendar-proxy";

// 代理形态下取回真正的目标地址（与 harness.mjs / 92-dsh-env.js 同一套拆法：
// `/api/gacha-calendar-proxy?url=<enc>` 里的 `url` 参数 = 目标站地址）。
function targetOf(url) {
	const s = String(url);
	if (!s.startsWith(PROXY_PREFIX)) return s;
	try { return new URL("http://x" + s).searchParams.get("url") || s; } catch { return s; }
}
// query 里 `origin=` 出现的次数（用来断言"不重复补成两个"）
const originCount = (s) => (String(s).match(/[?&]origin=/g) || []).length;
// 主机是否属于 biligame（与 15-env.js 的 isBwikiHost 同一规则；这里独立写一份是为了**交叉验证**
// 生产实现，而不是把待测实现拿来当判定标准）
function isBiligameHost(host) {
	const h = String(host || "").toLowerCase().replace(/\.$/, "");
	return h === "biligame.com" || h.endsWith(".biligame.com");
}
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ""; } };

// 物华弥新卡池页 = 夹具 bwiki-whmx-gacha 的来源地址（抓取器**自己**也拼了 origin=* → 幂等守卫）
const WHMX_GACHA = "https://wiki.biligame.com/whmx/api.php?action=parse&page=限时招集档案&prop=text&format=json&formatversion=2";

export default async function run() {
	const W = T.withBwikiCors;

	//#region ① 纯函数边界
	section("bwiki CORS 收口点 withBwikiCors：纯函数边界");
	{
		check("收口函数已导出（走 test-exports 的 __regression）", typeof W === "function", typeof W);

		// 无 query ⇒ `?`（`https://wiki.biligame.com/czn/` 这种地址实测直连必被 CORS 拦）
		check("bwiki 无 query ⇒ 用 `?` 补（不是 `&`）",
			W("https://wiki.biligame.com/czn/") === "https://wiki.biligame.com/czn/?origin=*",
			W("https://wiki.biligame.com/czn/"));

		// 已有 query、没有 origin ⇒ `&`，且**追加在原始串末尾**（不重序列化）
		check("bwiki 已有 query 且无 origin ⇒ 末尾补 `&origin=*`",
			W(WHMX_GACHA) === WHMX_GACHA + "&origin=*", W(WHMX_GACHA));
		check("不重序列化：中文参数原样保留（`page=限时招集档案`，不会被 percent-encode 成 %E9%99%90…）",
			W(WHMX_GACHA).includes("page=限时招集档案") && W(WHMX_GACHA).startsWith(WHMX_GACHA.slice(0, 60)),
			W(WHMX_GACHA).slice(0, 90));

		// 已有 origin 参数 ⇒ 一个字节都不动（避免把源站/用户给的 origin 覆盖成 `*`）
		const WITH_STAR = "https://wiki.biligame.com/sr/api.php?action=parse&page=warp&origin=*";
		check("已有 origin=* ⇒ 原样返回（幂等，不补第二个）",
			W(WITH_STAR) === WITH_STAR && originCount(W(WITH_STAR)) === 1, W(WITH_STAR));
		const WITH_OTHER = "https://wiki.biligame.com/sr/api.php?action=ask&origin=https%3A%2F%2Fexample.com";
		check("已有 origin=其它值 ⇒ 原样返回（不覆盖成 *）", W(WITH_OTHER) === WITH_OTHER, W(WITH_OTHER));
		check("幂等：连续补两次与补一次相同", W(W(WHMX_GACHA)) === W(WHMX_GACHA), W(W(WHMX_GACHA)));

		// 主机大小写：URL 解析会把主机名小写，但**返回的原串大小写保持**
		check("主机大小写混写也认（`WIKI.BILIGAME.COM`）",
			W("https://WIKI.BILIGAME.COM/czn/") === "https://WIKI.BILIGAME.COM/czn/?origin=*",
			W("https://WIKI.BILIGAME.COM/czn/"));
		// 端口不影响判断（hostname 不含端口）
		check("带端口也认（`:8443`）",
			W("https://wiki.biligame.com:8443/czn/api.php?action=parse") === "https://wiki.biligame.com:8443/czn/api.php?action=parse&origin=*",
			W("https://wiki.biligame.com:8443/czn/api.php?action=parse"));
		// hash：`origin=*` 必须落在 `#` **之前**（追加到 hash 后面就根本没进 query）
		check("带 hash（无 query）⇒ 补在 `#` 之前",
			W("https://wiki.biligame.com/czn/#tab") === "https://wiki.biligame.com/czn/?origin=*#tab",
			W("https://wiki.biligame.com/czn/#tab"));
		check("带 hash（有 query）⇒ `&origin=*` 在 `#` 之前",
			W("https://wiki.biligame.com/czn/a?x=1#tab") === "https://wiki.biligame.com/czn/a?x=1&origin=*#tab",
			W("https://wiki.biligame.com/czn/a?x=1#tab"));
		// 分隔符边界：`...?` 结尾时不要再补一个 `?`
		check("地址以 `?` 结尾 ⇒ 不拼出 `?&origin=*`",
			W("https://wiki.biligame.com/czn/?") === "https://wiki.biligame.com/czn/?origin=*",
			W("https://wiki.biligame.com/czn/?"));

		// 子域：`*.biligame.com` 一视同仁
		check("`*.biligame.com` 子域也补（`bwiki.biligame.com`）",
			W("https://bwiki.biligame.com/czn/") === "https://bwiki.biligame.com/czn/?origin=*",
			W("https://bwiki.biligame.com/czn/"));
		check("`api.biligame.com` 同属 *.biligame.com ⇒ 也补（实测该 CMS 接口忽略此参数：带与不带同为 200 且响应体一致）",
			W("https://api.biligame.com/news/list?gameExtensionId=1282") === "https://api.biligame.com/news/list?gameExtensionId=1282&origin=*",
			W("https://api.biligame.com/news/list?gameExtensionId=1282"));
		// 反向：长得像但不是子域 ⇒ 不动（裸 endsWith("biligame.com") 会误伤）
		check("同后缀但不同域（`evilbiligame.com`）不补",
			W("https://evilbiligame.com/czn/") === "https://evilbiligame.com/czn/", W("https://evilbiligame.com/czn/"));
		check("`biligames.com`（带 s，B站另一个域名）不补",
			W("https://l11-web-api.biligames.com/game/news/page?game_base_id=118241") === "https://l11-web-api.biligames.com/game/news/page?game_base_id=118241",
			W("https://l11-web-api.biligames.com/game/news/page?game_base_id=118241"));

		// 非绝对地址：原样交回（不在这里造第二个错误）
		check("相对地址 / 代理前缀 ⇒ 原样返回",
			W("/api/gacha-calendar-proxy?url=https%3A%2F%2Fwiki.biligame.com%2Fczn%2F") === "/api/gacha-calendar-proxy?url=https%3A%2F%2Fwiki.biligame.com%2Fczn%2F",
			W("/api/gacha-calendar-proxy?url=x"));
		check("空串 ⇒ 原样返回（不抛错）", W("") === "", JSON.stringify(W("")));
	}
	//#endregion

	//#region ② 接线守卫（两条出口 + 只有一处实现）
	section("bwiki CORS 收口点：transport 的两条出口都过它（静态接线守卫）");
	{
		const envSrc = readFileSync(path.join(CLIENT_DIR, "15-env.js"), "utf8");
		check("直连出口 transportFetchRaw 过收口（fetchRaw(withBwikiCors(url))）",
			/fetchRaw\(withBwikiCors\(url\)/.test(envSrc));
		check("代理出口 proxyFetchText 过收口（fetchViaProxy(withBwikiCors(proxyUrl))）",
			/fetchViaProxy\(withBwikiCors\(proxyUrl\)/.test(envSrc));

		// 收口点必须是**唯一**一份：再多一份「自己拼 origin」的实现就又会分叉
		const declFiles = readdirSync(CLIENT_DIR)
			.filter((f) => f.endsWith(".js"))
			.filter((f) => /function\s+withBwikiCors\s*\(/.test(readFileSync(path.join(CLIENT_DIR, f), "utf8")));
		check("全仓只有一个 withBwikiCors 定义（收口点不许多长出第二份）",
			declFiles.length === 1 && declFiles[0] === "15-env.js", declFiles.join(",") || "(没有)");
	}
	//#endregion

	//#region ③ 行为：bwiki 来源实际发出的请求带 origin=*
	section("bwiki 来源：实际发出的请求 URL 含 origin=*（fetch 记账）");
	{
		// 战双（bwiki wikitext）：ask 索引 + 公告正文。改造前这两条都**没有** origin=*
		// （`fetchJson(url, { mode: "proxy" })` 没有拼参数 —— 只有 fetchMediaWikiText 那条路会拼）。
		const zs = T.SOURCES.find((s) => s.id === "zspms");
		check("前置：战双来源地址是 bwiki", !!zs && isBiligameHost(hostOf(zs.url)), zs && zs.url);

		const fx = useFixtures();
		const seen = [];
		setFetchImpl(async (u, o) => { seen.push(String(u)); return fx(u, o); });
		let err = null;
		try { await T.GACHA_FETCHERS["zspms"](zs.url, undefined, zs.tz); } catch (e) { err = e; }
		check("战双抓取器不应抛错（夹具齐备 / 解析未坏）", err === null, err && err.message);

		const targets = seen.map(targetOf);
		check("战双确实发出了 2 条请求（ask 索引 + 公告正文）", targets.length === 2, String(targets.length) + " 条");
		const ask = targets.find((t) => /[?&]action=ask\b/.test(t));
		const wt = targets.find((t) => /[?&]action=parse\b/.test(t));
		check("ask 索引请求带 origin=*（改造前没有）",
			!!ask && /[?&]origin=\*/.test(ask), ask ? ask.slice(-70) : "(没发出)");
		check("公告 wikitext 请求带 origin=*（改造前没有）",
			!!wt && /[?&]origin=\*/.test(wt), wt ? wt.slice(-70) : "(没发出)");
		check("两条请求都只补了一个 origin（没有补成两个）",
			targets.every((t) => originCount(t) === 1), targets.map(originCount).join(","));
		check("两条请求仍走宿主代理（收口没有改变通道路径）",
			seen.every((u) => u.startsWith(PROXY_PREFIX)), seen.map((u) => u.slice(0, 24)).join(" | "));

		// 物华弥新（bwiki）：抓取器**自己已经**拼过 origin=*（fetchMediaWikiText）→ 收口必须是幂等的
		const fx2 = useFixtures();
		const seen2 = [];
		setFetchImpl(async (u, o) => { seen2.push(String(u)); return fx2(u, o); });
		try { await T.GACHA_FETCHERS["wuhuamixin"](WHMX_GACHA, undefined, "Asia/Shanghai"); } catch { /* 数据是否成功与本段无关 */ }
		check("物华弥新发出了 1 条请求", seen2.length === 1, String(seen2.length) + " 条");
		check("抓取器已自带 origin=* 的来源不会被补成两个（幂等）",
			seen2.length === 1 && originCount(targetOf(seen2[0])) === 1,
			seen2.length ? targetOf(seen2[0]).slice(-70) : "(没发出)");
	}
	//#endregion

	//#region ④ 反向守卫：非 bwiki 站点的请求 URL 逐字不变
	section("非 bwiki 站点：请求 URL 逐字不变（收口不漏到别的站点）");
	{
		// 4-1 全量静态：插件里每一条来源地址，属于 biligame 的才补，其它一律逐字相同
		const all = T.SOURCES.filter((s) => s.url);
		const bili = all.filter((s) => isBiligameHost(hostOf(s.url)));
		const others = all.filter((s) => !isBiligameHost(hostOf(s.url)));
		check(`biligame 系来源地址（${bili.length} 条）全部补上 origin=*（且只补一个）`,
			bili.length > 0 && bili.every((s) => originCount(W(s.url)) === 1 && W(s.url).startsWith(s.url)),
			bili.filter((s) => originCount(W(s.url)) !== 1).map((s) => s.url).join(" | ").slice(0, 200));
		check(`非 biligame 来源地址（${others.length} 条）逐字不变`,
			others.length >= 10 && others.every((s) => W(s.url) === s.url),
			others.filter((s) => W(s.url) !== s.url).map((s) => s.url).join(" | ").slice(0, 200));

		// 4-2 点名 3 个真实的其它游戏地址（与上面同一份数据，读起来更直观）
		for (const id of ["uma-jp", "ba-cn", "pjsk"]) {
			const s = T.SOURCES.find((x) => x.id === id);
			check(`${id} 的请求地址逐字不变`, !!s && W(s.url) === s.url, s ? s.url : "(无此来源)");
		}

		// 4-3 行为：非 bwiki 来源真跑一遍，代理通道上的目标地址逐字等于声明地址（且没有 origin）
		const baCn = T.SOURCES.find((s) => s.id === "ba-cn");
		const fx = useFixtures();
		const seen = [];
		setFetchImpl(async (u, o) => { seen.push(String(u)); return fx(u, o); });
		let err = null;
		try { await T.GACHA_FETCHERS["ba-cn"](baCn.url, undefined, baCn.tz); } catch (e) { err = e; }
		check("ba-cn（蔚蓝档案国服）抓取器不应抛错", err === null, err && err.message);
		check("ba-cn 的第一条请求地址与声明地址逐字相同（bluearchive-cn.com，代理通道）",
			seen.length > 0 && targetOf(seen[0]) === baCn.url, seen.length ? targetOf(seen[0]) : "(没发出)");
		check("ba-cn 的所有请求都不带 origin 参数",
			seen.length > 0 && seen.every((u) => originCount(targetOf(u)) === 0),
			seen.map((u) => targetOf(u)).join(" | ").slice(0, 200));

		// 还原成夹具模式，别把记账壳留给后续批次（各批次都会自己 useFixtures，这道只是礼貌）
		useFixtures();
	}
	//#endregion
}
