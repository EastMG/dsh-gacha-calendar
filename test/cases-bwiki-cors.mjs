// test/cases-bwiki-cors.mjs —— bwiki 请求的统一口径：
//   ① 一律补 `origin=*`（CORS 收口点，2026-11-07 上一轮）
//   ② 一律**走宿主代理**，不再直连（2026-11-07 本轮，真因见下）
//
// 为什么单开一段：
//   · 浏览器直连 bwiki 且**不带** `origin=*` ⇒ `TypeError: Failed to fetch`（CORS 拒绝），
//     上层只能把它归成「网络不通」这种看不出根因的泛化失败；
//   · 同一 URL 带 `&origin=*` ⇒ HTTP 200。
//   而仓里 22 处 `https://wiki.biligame.com/…` 地址常量**全部没有**这个参数 —— 平时靠宿主代理
//   （不受 CORS 限制）盖住，任何走直连的路径都会静默失败。
//
// 但**只补 origin=* 还不够**（本轮由宿主日志确认）：
//   DSH 渲染进程的页面源是自定义 scheme `dsh-app://app`（不是 http/https），bwiki 对它**不回**
//   `Access-Control-Allow-Origin` ⇒ 直连必被 CORS 拦。日志原文：
//     [error] Access to fetch at 'https://wiki.biligame.com/sr/api.php?…&origin=*'
//             from origin 'dsh-app://app' has been blocked by CORS policy:
//             No 'Access-Control-Allow-Origin' header is present on the requested resource. [renderer]
//   注意那条被拦的请求**本来就带着 origin=*** —— 所以本轮把 bwiki 系主机在 `transportFetchRaw`
//   里**强制改走宿主代理**（请求由宿主 Node 侧发出，压根没有 CORS）。
//
// 本段从五个角度钉住它：
//   ① **纯函数**：`withBwikiCors` 的全部边界（无 query 用 `?` / 已有 query 用 `&` / 已有 origin 不动 /
//      大小写·端口·hash / `*.biligame.com` / 非法与相对地址 / 幂等）；
//   ② **接线**：两条出口确实调了它、bwiki 判定接到了代理、且全仓**只有一处**实现（收口点不许长出第二份）；
//   ③ **行为**：真抓一个 bwiki 来源（战双 wikitext —— 改造前它的 ask 索引与公告正文两条请求
//      **都没有** origin=*），用 fetch 记账断言实际发出的目标 URL 带上了；同时断言非 bwiki 站点的
//      请求 URL **逐字不变**（这是"收口点不会误伤别的站点"的反向守卫）。
//   ④ **反向守卫**：非 bwiki 站点的请求 URL 逐字不变；
//   ⑤ **bwiki 不再直连**：抓星铁卡池（就是日志里被拦的那条 `/sr/api.php`）时**直连计数 = 0**、
//      代理计数 = 1、目标地址含 `origin=*` 且 Referer 仍在；三个非 bwiki 来源照旧走直连。
//      反向证明：把"bwiki 走代理"还原成直连 ⇒ 本段 ⑤ 立刻红（本轮已实测，见提交说明）。

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { check, section, useFixtures, setFetchImpl, makeFetchTransport } from "./harness.mjs";
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

// 从源码里按函数名抠出函数体（大括号配平）。静态守卫用它断言"某个函数体里没有某种调用"。
function fnBody(src, name) {
	const at = src.indexOf("function " + name);
	if (at < 0) return "";
	const open = src.indexOf("{", at);
	if (open < 0) return "";
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		const c = src[i];
		if (c === "{") depth++;
		else if (c === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
	}
	return "";
}

// 装一个"两条出口分别记账"的 transport（夹具仍由 makeFetchTransport 提供），返回记账本。
// 为什么需要：要证明"bwiki 不再直连"，光看最终数据是看不出来的 —— 数据经代理也能拿到。
// 必须在 **transport 出口**上数次数：直连 0 次 / 代理 1 次。
function installCountingTransport(overrides) {
	const impl = useFixtures(overrides || {});
	const base = makeFetchTransport(impl);
	const rec = { raw: 0, proxy: 0, rawTargets: [], proxyTargets: [], proxyOpts: [] };
	T.setCoreEnv({
		transport: {
			async fetchRaw(u, o) { rec.raw++; rec.rawTargets.push(String(u)); return base.fetchRaw(u, o); },
			async fetchViaProxy(u, o) { rec.proxy++; rec.proxyTargets.push(String(u)); rec.proxyOpts.push(o || {}); return base.fetchViaProxy(u, o); }
		}
	});
	return rec;
}

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
		check("直连出口 transportFetchRaw 仍过收口（const target = withBwikiCors(url)）",
			/const\s+target\s*=\s*withBwikiCors\(url\)/.test(envSrc));
		check("直连出口：**非 bwiki** 才真的直连（transport.fetchRaw(target, opts)）",
			/return\s+transport\.fetchRaw\(target,\s*opts\)/.test(envSrc));
		check("代理出口 proxyFetchText 过收口（fetchViaProxy(withBwikiCors(proxyUrl))）",
			/fetchViaProxy\(withBwikiCors\(proxyUrl\)/.test(envSrc));

		// ★ 本轮核心接线：bwiki 判定 → 改走宿主代理
		const rawBody = fnBody(envSrc, "transportFetchRaw");
		check("bwiki 判定已接到代理：transportFetchRaw 里 isBwikiUrl(target) ⇒ bwikiViaProxy(transport, target, opts)",
			/isBwikiUrl\(target\)/.test(rawBody) && /bwikiViaProxy\(transport,\s*target,\s*opts\)/.test(rawBody),
			rawBody.replace(/\s+/g, " ").slice(0, 200));
		check("特性探测守卫生效：只有 transport.fetchViaProxy 是函数时才改道（非 DSH 环境保持直连、不抛错）",
			/typeof\s+transport\.fetchViaProxy\s*===\s*"function"/.test(rawBody));
		// 代理**没有**"失败回退直连"的降落伞：bwikiViaProxy 里不许出现 fetchRaw
		const proxyBody = fnBody(envSrc, "bwikiViaProxy");
		check("bwikiViaProxy 只走 fetchViaProxy，**没有**回退直连的降落伞（不许出现 fetchRaw）",
			proxyBody.length > 0 && !/fetchRaw/.test(proxyBody) && /transport\.fetchViaProxy\(/.test(proxyBody),
			proxyBody.replace(/\s+/g, " ").slice(0, 200));
		// 幂等：已经走代理的出口（proxyFetchText）不经过 transportFetchRaw，不会被套成"代理套代理"
		check("proxyFetchText 不经过 transportFetchRaw / bwikiViaProxy（幂等，不会套两层）",
			!rawBody.includes("proxyFetchText") && !/transportFetchRaw/.test(fnBody(envSrc, "proxyFetchText")),
			fnBody(envSrc, "proxyFetchText").replace(/\s+/g, " ").slice(0, 160));

		// 收口点必须是**唯一**一份：再多一份「自己拼 origin」的实现就又会分叉
		const declFiles = readdirSync(CLIENT_DIR)
			.filter((f) => f.endsWith(".js"))
			.filter((f) => /function\s+withBwikiCors\s*\(/.test(readFileSync(path.join(CLIENT_DIR, f), "utf8")));
		check("全仓只有一个 withBwikiCors 定义（收口点不许多长出第二份）",
			declFiles.length === 1 && declFiles[0] === "15-env.js", declFiles.join(",") || "(没有)");
		// 同理：bwiki 改道也必须只有一处（分散在多处就又会出现"某条路忘了改"）
		const routeFiles = readdirSync(CLIENT_DIR)
			.filter((f) => f.endsWith(".js"))
			.filter((f) => /bwikiViaProxy\s*\(/.test(readFileSync(path.join(CLIENT_DIR, f), "utf8")));
		check("全仓只有一处把 bwiki 改道到代理（15-env.js 的 bwikiViaProxy）",
			routeFiles.length === 1 && routeFiles[0] === "15-env.js", routeFiles.join(",") || "(没有)");
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

	//#region ⑤ bwiki **不再直连**（本轮修复的判定点：直连 0 次 / 代理 1 次）
	section("bwiki 一律走宿主代理：直连计数 = 0、代理计数 = 1、Referer 仍在（fetch 记账）");
	{
		// 星铁卡池默认源 —— 就是宿主日志里被 CORS 拦的那条 `https://wiki.biligame.com/sr/api.php?…&origin=*`。
		// 它走 mkMediaWiki → transportFetchRaw（**改造前 = 直连**），所以拿它当"红/绿"的判定点最贴证据。
		const hsr = T.SOURCES.find((s) => s.id === "hsr");
		const HSR_URL = hsr && hsr.url;
		check("前置：星铁卡池来源地址是 bwiki（/sr/api.php）",
			!!HSR_URL && isBiligameHost(hostOf(HSR_URL)) && HSR_URL.includes("/sr/api.php"), HSR_URL);

		// 夹具覆盖：map.json 里没有星铁的默认地址（那是 P4 批次的夹具），这里按 URL 精确注入一条。
		const rec = installCountingTransport({ [HSR_URL]: "p4-hsr-bwiki-warp-1107/response.txt" });
		let err = null, data = null;
		try { data = await T.GACHA_FETCHERS["hsr"](HSR_URL, undefined, hsr.tz); } catch (e) { err = e; }
		check("前置：星铁卡池抓取器能跑通（夹具齐备 / 解析未坏）", err === null, err && err.message);
		check("前置：确实拿到了数据（不是空壳）", !!data && typeof data === "object" && typeof data.banner === "string",
			JSON.stringify(data).slice(0, 80));

		// ★★ 核心断言：**一次直连都没发生** ★★
		check("★ bwiki 来源**没有**发生直连 fetch（直连计数 = 0）",
			rec.raw === 0, (rec.raw + " 次：" + rec.rawTargets.join(" | ")).slice(0, 200));
		check("★ bwiki 来源的代理调用次数 = 1", rec.proxy === 1, String(rec.proxy));
		check("代理收到的目标地址含 origin=*（沿用上一轮的收口，且只补一个）",
			rec.proxy === 1 && /[?&]origin=\*/.test(rec.proxyTargets[0]) && originCount(rec.proxyTargets[0]) === 1,
			rec.proxyTargets[0] && rec.proxyTargets[0].slice(-90));
		check("代理收到的目标地址 = withBwikiCors(声明地址)（主机/路径/参数逐字不变，只多 origin=*）",
			rec.proxy === 1 && rec.proxyTargets[0] === W(HSR_URL), rec.proxyTargets[0]);
		// Referer 必须还在：bwiki 对**无 Referer 的裸请求**回 567（见 15-env.js 的 rawHeaders 注释）
		check("改走代理后仍带 Referer（= 目标站 origin + `/`，bwiki 无 Referer 会回 567）",
			rec.proxy === 1 && rec.proxyOpts[0].referer === "https://wiki.biligame.com/",
			rec.proxy === 1 ? JSON.stringify(rec.proxyOpts[0]) : "(没发出)");

		// 幂等：已经走代理的出口（proxyFetchText）不许被这一层再包一次
		// 物华弥新卡池走的就是 fetchMediaWikiText → fetchJson(mode:proxy) → proxyFetchText。
		const rec2 = installCountingTransport();
		let err2 = null;
		try { await T.GACHA_FETCHERS["wuhuamixin"](WHMX_GACHA, undefined, "Asia/Shanghai"); } catch (e) { err2 = e; }
		check("前置：物华弥新（本来就走代理的来源）能跑通", err2 === null, err2 && err2.message);
		check("幂等：本来就走代理的来源仍然只发 1 次代理、0 次直连（没有被套成两层）",
			rec2.proxy === 1 && rec2.raw === 0, `proxy=${rec2.proxy} raw=${rec2.raw}`);
		check("幂等：代理目标地址里没有出现「代理套代理」（不含 /api/gacha-calendar-proxy）",
			rec2.proxy === 1 && !rec2.proxyTargets[0].includes(PROXY_PREFIX), rec2.proxyTargets[0]);
	}
	//#endregion

	//#region ⑥ 反向守卫：非 bwiki 来源**照旧走直连**（改道没有扩大化）
	section("非 bwiki 来源：依旧走直连、目标地址逐字不变（改道没有扩大化）");
	{
		// 三个"实测 ACAO 放行 / 宿主不代理"的直连来源，各自走 transportFetchRaw：
		//   pjsk 卡池/活动 → fetchJson(url, {mode:"direct"}) → sekai 静态资源（GitHub Pages，带 ACAO）
		//   uma-global 卡池 → fetchJson(url, {mode:"direct"}) → GameTora 数据文件（多请求）
		// pjsk 用 sekai-world 那条地址（= test/all.mjs 的 DIRECT_OK 白名单地址、且夹具 b1-sekai-* 覆盖它）；
		// 条目默认地址走的是 gh-proxy 镜像（同一份内容的另一个 CDN 前缀），两者都是直连。
		const cases = [
			["pjsk", "gacha", "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json"],
			["pjsk", "event", "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json"],
			["uma-global", "gacha", null]   // null ⇒ 用条目声明地址（gametora）
		];
		for (const [id, side, fixedUrl] of cases) {
			const s = T.SOURCES.find((x) => x.id === id);
			// 运行时 SOURCES 是**扁平**形态：卡池地址 = s.url，活动地址 = s.eventUrl
			const declUrl = fixedUrl || (s ? (side === "gacha" ? s.url : s.eventUrl) : "");
			check(`前置：${id}.${side} 有声明地址且不是 bwiki`,
				!!declUrl && !isBiligameHost(hostOf(declUrl)), declUrl);
			if (!declUrl) continue;

			const rec = installCountingTransport();
			let err = null;
			try {
				const fetcher = side === "gacha" ? T.GACHA_FETCHERS[id] : T.EVENT_FETCHERS[id].default;
				await fetcher(declUrl, undefined, s.tz);
			} catch (e) { err = e; }
			check(`前置：${id}.${side} 抓取器能跑通（夹具齐备）`, err === null, err && err.message);

			check(`${id}.${side} 仍然走**直连**（直连 ≥ 1 次、代理 0 次）`,
				rec.raw >= 1 && rec.proxy === 0, `raw=${rec.raw} proxy=${rec.proxy}`);
			check(`${id}.${side} 的**第一条**直连地址与声明地址逐字相同（没被补 origin、没被改道、没被重序列化）`,
				rec.rawTargets.length > 0 && rec.rawTargets[0] === declUrl, rec.rawTargets[0]);
			check(`${id}.${side} 的直连地址都不含 origin 参数（bwiki 的补参没有漏过来）`,
				rec.rawTargets.every((t) => originCount(t) === 0),
				rec.rawTargets.map((t) => t.slice(0, 80)).join(" | ").slice(0, 240));
		}

		// 还原成夹具模式，别把记账壳留给后续批次
		useFixtures();
	}
	//#endregion
}
