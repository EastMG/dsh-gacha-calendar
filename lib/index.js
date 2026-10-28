// Host-side entry for dsh-gacha-calendar.
// 1) Declares the persisted Config schema the browser half's Settings >
//    二游日历 section reads and writes. DSH 0.1.7 derives the settings document
//    from this schema automatically, so there is nothing to register here.
// 2) Registers a same-origin HTTP proxy route on DSH's webServer so the browser
//    half can fetch external sources that block cross-origin browser requests
//    (CORS / Referer anti-scrape) — the host runs Node fetch with full control
//    over headers, bypassing browser-only restrictions.
// 3) Runs 「到期提醒（送达）」: a 30-minute timer that judges `lastData` with the
//    core's reminder functions (lib/remind-core.mjs) and delivers Windows toasts
//    via powershell.exe. See the remind region below for the design decisions.
import z from "@deepseek-ai/schemastery";
// 到期提醒（送达）：判定与文案来自 core 的**同一份源码**（lib/remind-core.mjs 由 build.mjs 从
// src/client/65-remind.js 原样拼出）。宿主半边因此不需要（也拿不到）浏览器 bundle 里的任何东西。
import {
	NOTIFY_IDENTITY_MAX_AGE_MS,
	notifyIdentityCacheOf,
	notifyIdentityFallbackOf,
	notifyNameOf,
	notifyShortcutPickOf,
	remindConfigOf,
	remindIdentityOf,
	remindItemsOf,
	remindOnOf,
	remindStateOf,
	remindTestToastOf,
	remindTickOf,
	remindToastOf
} from "./remind-core.mjs";
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// 设置文档的标识已不再是插件自报的 namespace，而是**本插件在 profile 里的条目 id**
// （`~/.dsh/profiles/<profile>/cordis.patch.yml` 的 `- id: gacha-calendar`）。
// 旧的 settingsNamespace("gacha-calendar") 随 API 一并删除，两边现在只靠这个 id 对齐；
// 浏览器半边的同一字面量在 src/client/10-config.js 的 `NS`。

/** Route prefix owned by this plugin on DSH's webServer. */
const PROXY_PREFIX = "/api/gacha-calendar-proxy";

/** Read-only snapshot route: a mirror of the last `lastData` the browser half saved,
 *  so local tools (scheduler scripts, other panels) can read the merged gacha/event
 *  data with plain HTTP instead of reverse-engineering DSH's settings store. */
const SNAPSHOT_PREFIX = "/api/gacha-calendar-snapshot.json";
/** Snapshot body limit (chars). 真实数据约 200KB，4MB 留足余量。 */
const SNAPSHOT_MAX_CHARS = 4 * 1024 * 1024;

/**
 * 通知身份（AppUserModelID）路由：设置页「通知身份」那一行读 / 写它。
 *  `GET  /api/gacha-calendar-notify-identity`
 *       → `{ enabled, name, aumid, shortcutPath, iconPath }`
 *  `POST /api/gacha-calendar-notify-identity` body `{ enabled: true|false, name?: string }`
 *       → 建 / 删「当前用户开始菜单」里的快捷方式，返回 `{ ok, enabled, name, shortcutPath }` 或
 *         `{ ok: false, error }`（结构化原因由设置页一行小字显示）。
 *  `name` = 设置项 `notifyName`（应用名，默认「二游日历」），决定快捷方式的**文件名**
 *  （`<name>.lnk`）、Description 与注册表的 DisplayName；改名时按新名字**先删旧的再重建**
 *  （只删 AUMID 等于我们的那条，见 notifyIdentityEnableScript）。
 * 为什么做成**可选**：这条快捷方式是**当前用户**开始菜单里的一个真实入口（不需要管理员），
 * 换来的只是通知横幅顶部的应用名 —— 该由用户自己点，不该在装插件时偷偷做。
 *
 * 性能（2026-10-28）：探测本身要起一次 PowerShell 批量读开始菜单所有 .lnk 的 AUMID（实测 0.87 秒），
 * 以前每次 GET / 每轮提醒都付这个钱 ⇒ 设置页一打开就卡「读取中…」。修法是**两层**：
 *   ① 探测结果缓存到 `%LOCALAPPDATA%\dsh-gacha-calendar\identity.json`，GET 与提醒轮次先读文件：
 *      有文件 ⇒ 立刻返回；超过 24h 或缓存说启用而 .lnk 已被手工删掉 ⇒ **后台**补探一次纠正，
 *      本次仍回文件内容（绝不阻塞在 PowerShell 上）；
 *   ② 没有文件（**从没启用过身份的用户根本没有**）⇒ GET **也立刻返回**一个保守值
 *      `{ enabled:false, name:<配置名>, aumid, shortcutPath:"" }`，同时 `void` 后台探测一次并写回。
 *      ⇒ **GET 永不阻塞在探测上**；下一次 GET（前端下次读 / 点「发送测试通知」）就是准确值。
 *   ③ `apply()` 里还有一次**启动预热**（warmIdentityState，不 await）：没有文件或已 stale 就先探一次，
 *      用户第一次打开设置页时缓存多半已就绪 ⇒ 直接走毫秒路径。
 * 写点：GET 的后台探测 / POST 成功之后 / 启动预热（三者共用 refreshIdentityState 与 probeIdentityState）。
 */
const NOTIFY_IDENTITY_PREFIX = "/api/gacha-calendar-notify-identity";

/**
 * 「发送测试通知」路由：`POST /api/gacha-calendar-notify-test`。
 * 设置页「通知身份」那一行旁边的按钮点它 → 立刻弹一条系统通知，用来确认通知链路通不通。
 * **与真实提醒完全隔离**：不读 `lastData`、不读写 `host-state.json` 的去重状态、不改任何设置。
 */
const NOTIFY_TEST_PREFIX = "/api/gacha-calendar-notify-test";

// ── 通知身份常量（改这里 = 改系统通知横幅顶部的应用名）──────────────────────────────
/**
 * 应用身份 AUMID。**宿主与通知脚本必须用同一个值**：宿主判断"身份是否已启用"就是拿 .lnk 里的
 * `System.AppUserModel.ID` 与这个常量比对；两边一旦不同就永远判成未启用 ⇒ 静默回退 PowerShell。
 * 本文件里只出现这一处字面量，toast 脚本的 `$Aumid` 是运行时由这里传进去的（不再写死第二份）。
 */
const NOTIFY_AUMID = "DshGachaCalendar.Reminder";
/** 快捷方式图标（**预留接口**）：现在用系统「日期和时间」的日历图标（timedate.cpl 的 0 号）。
 *  项目有正式 .ico 后改这里即可（形如 `C:\…\gacha-calendar.ico,0`）；GET 路由会把它交给设置页。 */
const NOTIFY_SHORTCUT_ICON = "%SystemRoot%\\System32\\timedate.cpl,0";
/** POST body 上限（布尔值 + 一个名字，4KB 足够；超限回 413）。 */
const NOTIFY_MAX_BODY_CHARS = 4 * 1024;

/** Last snapshot published by the browser half: `{ at, data }`（内存态）。
 *  故意不落盘：它的权威副本是 `lastData` 设置，这里只是给本机脚本一份方便读的镜像；
 *  宿主重启后自动清空，下次写入或面板刷新会重新填上。 */
let snapshot = null;

/**
 * Proxy allow-list: only these hostnames may be fetched through the proxy
 * (SSRF guard — the route otherwise becomes an arbitrary-server requestor).
 * Entry matches the hostname exactly or any subdomain of it.
 */
const PROXY_ALLOW_HOSTS = [
	"forum.nexon.com",
	"endfield.wiki.gg",
	"endfield.hypergryph.com",
	"end.canmoe.com",
	"www.ldshop.gg",
	"game8.co",
	"wiki.biligame.com",
	"prts.wiki",
	"gachatracker.app",
	"www.gamekee.com",
	"api-cdn.gamekee.com",
	"bluearchive-cn.com",
	"re.bluepoch.com",
	// 重返未来1999 官方游戏内公告服务（逐期「征集时间」所在；证书主体与 re.bluepoch.com 同为公司
	// 广州深蓝互动网络科技有限公司，同一 EdgeOne CDN）
	"notice.sl916.com",
	"game.xiaomi.com",
	"yh.wanmei.com",
	"fz.wiki",
	"web-news.hypergryph.com",
	"aki-gm-resources-back.aki-game.com",
	"aki-gm-resources-back-huoshan.aki-game.com",
	"aki-gm-resources.aki-game.com",
	"api-takumi-static.mihoyo.com",
	"api-web.bluearchive.jp",
	// ── 2026-10-03 补登：以下 4 个域名此前**漏登记** → 经代理一律 403 `cross-site-not-allowed` ──
	// 表现：面板上这几条**长期空白**，失败原因写 `HTTP 403`。源站本身没问题（服务端实测 200），
	// 纯粹是宿主代理不放行。离线夹具测试与"直连源站"的验证都绕过了代理，所以一直没暴露。
	// 教训：新增来源**必须同步登记域名**；测试要覆盖「经代理」这条路径
	//      （守卫见 `test/_host_allow_test.mjs`，会遍历全部来源 URL 与白名单比对）。
	//
	// 女神异闻录：夜幕魅影 官网公告。⚠️ 同属 wanmei.com，但 `yh.wanmei.com`（异环）与
	// `p5x.wanmei.com`（夜幕魅影）是**不同子域**，白名单按域名精确匹配 → 必须单独登记。
	"p5x.wanmei.com",
	// 少女前线2：追放 官网公告 API。
	"gf2-web-preregister-api.sunborngame.com",
	// Fate/Grand Order **中文 wiki**（fgo.wiki）。⚠️ 与 `fz.wiki`（终末地）是不同站点，别混。
	"fgo.wiki",
	// BanG Dream！少女乐团派对 **备选源**（Bestdori 社区数据库，实测无 ACAO）。
	// 主源走 `api.biligame.com`；这条只在用户于设置里手动切到 Bestdori 时才请求 ——
	// 但不登记的话一选它就 403，属于"选项看着能用、实际不能用"的坑。
	"bestdori.com",
	// 赛马娘 官方公告（日服 / 国际服）：响应**无 ACAO**（CloudFront `Vary: Origin` 但不回 ACAO），
	// 只能走代理；国际服列表/详情是 POST（GET / 缺 body → `{"response_code":102}`）。
	"umamusume.jp",
	"umamusume.com",
	// 米哈游系官方公告（米游社 BBS）：`painter/wapi/getNewsList` + `post/wapi/getPostFull`。
	// 免 token / 免签名；响应 ACAO 只放行 `https://www.miyoushe.com` → 必须走代理。
	// 同一接口换 `gids` 即覆盖 崩坏3(1) / 原神(2) / 星穹铁道(6) / 绝区零(8)。
	// （⚠️ 米哈游官网那套 `api-takumi.mihoyo.com/.../getAnnList` 恒返 -502，已证伪，别再走）
	"bbs-api.miyoushe.com",
	// B站代理游戏官方公告 API（biligame CMS）：响应**无 ACAO** → 必须走代理。
	// 认 `gameExtensionId`（不是 `game_base_id`）；已知 BanG Dream 国服=138、嘟嘟脸恶作剧=1282。
	"api.biligame.com",
	// BanG Dream OurNotes **国际服**（BHK = BILIBILI HK LIMITED 发行）官方公告 API。
	// 响应 ACAO 只白名单 `https://bdon.biligames.com` → 必须走代理。
	// ⚠️ 实测该接口当前返回 `{"code":0,"data":{"total_count":0,"list":[]}}`（国际服 2026-09-24 才上线，官网暂无公告）。
	"l11-web-api.biligames.com",
	// 星塔旅人 国服官方 CMS API：**官网同源反代**（`https://stellasora.yostar.cn/api/...`），
	// 免 token / 免签名；响应**无 ACAO** → 必须走代理。
	"stellasora.yostar.cn"
];

/** Default outgoing request headers (browser-like, to satisfy anti-scrape). */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** 代理上限：响应体字节数 / 请求体字符数 / 单次请求总超时（含读完响应体）/ 重定向跳数 */
const PROXY_MAX_BYTES = 8 * 1024 * 1024;
const PROXY_MAX_BODY_CHARS = 2 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 15000;
const PROXY_MAX_REDIRECTS = 3;

// 注意：**不**发 `access-control-allow-origin`。插件的浏览器半边与本站同源（`/api/...` 相对路径），
// 根本不需要 CORS 头；带上 `*` 会让任意网页都能借本机 DSH 当代理去读白名单站点、并探测本地端口。
function sendJson(res, status, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(body);
}

/** Check a target hostname against the allow-list (exact or subdomain). */
function hostAllowed(hostname) {
	return PROXY_ALLOW_HOSTS.some((allow) => hostname === allow || hostname.endsWith("." + allow));
}

/** 读取响应体并施加字节上限；超限立即 abort 并抛错（旧实现直接 `response.text()`，无上限） */
async function readCapped(response, limit, controller) {
	if (!response.body || typeof response.body.getReader !== "function") return await response.text();
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > limit) {
			try { controller.abort(); } catch { /* ignore */ }
			throw new Error("response-too-large");
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/** 读取 POST 请求体并施加上限；超限返回 null（调用方回 413），同时把剩余数据排空避免连接挂住 */
function readRequestBody(req, maxChars) {
	return new Promise((resolve) => {
		let data = "";
		let tooLarge = false;
		req.on("data", (chunk) => {
			if (tooLarge) return;
			data += chunk;
			if (data.length > maxChars) { tooLarge = true; data = ""; req.resume(); }
		});
		req.on("end", () => resolve(tooLarge ? null : data));
		req.on("error", () => resolve(tooLarge ? null : data));
	});
}

/** 只认回环地址：快照里含卡池/活动数据，不需要也不该暴露给局域网。 */
function isLoopback(req) {
	const addr = String(req.socket?.remoteAddress || "");
	return addr === "127.0.0.1" || addr === "::1" || addr.startsWith("::ffff:127.");
}

/**
 * 快照路由：`GET/POST /api/gacha-calendar-snapshot.json`
 *  - POST：浏览器半每次写完 `lastData` 就回传一份（见 src/client/92-dsh-env.js 的 dshStorage.set），
 *    body 形如 `{ at, data }`，`data` 必须是对象；
 *  - GET：给本机脚本读，200 返回 `{ at, data }`，还没发布过时 204。
 * 与代理路由一致：拒绝 cross-site，避免任意网页读走本机游戏数据。
 */
async function snapshotHandler(req, res) {
	if (!isLoopback(req)) { sendJson(res, 403, { error: "loopback-only" }); return; }
	if (String(req.headers?.["sec-fetch-site"] || "") === "cross-site") {
		sendJson(res, 403, { error: "cross-site-not-allowed" });
		return;
	}
	if (req.method === "POST") {
		const body = await readRequestBody(req, SNAPSHOT_MAX_CHARS);
		if (body === null) { sendJson(res, 413, { error: "payload-too-large" }); return; }
		let parsed;
		try { parsed = JSON.parse(body); } catch { sendJson(res, 400, { error: "invalid-json" }); return; }
		const data = parsed && parsed.data;
		if (!data || typeof data !== "object" || Array.isArray(data)) {
			sendJson(res, 400, { error: "data-must-be-object" });
			return;
		}
		snapshot = { at: Date.now(), data };
		sendJson(res, 200, { ok: true, at: snapshot.at });
		return;
	}
	if (req.method !== "GET" && req.method !== "HEAD") { sendJson(res, 405, { error: "method-not-allowed" }); return; }
	if (snapshot === null) { res.writeHead(204); res.end(); return; }
	sendJson(res, 200, snapshot);
}

/**
 * Same-origin proxy handler: `GET/POST /api/gacha-calendar-proxy?url=<enc>&referer=<enc>`
 * fetches `url` from the host (Node fetch, no CORS), sends back
 * `{ status, contentType, body }` JSON. `referer` overrides the outgoing
 * Referer header when the target checks it (nexon/wiki.gg style anti-scrape).
 * POST 请求体（JSON）原样透传给目标（如重返未来官网资讯 API 需要 POST body）。
 */
async function proxyHandler(req, res) {
	// 只服务同源调用：跨站请求一律拒绝（否则任意网页都能借本机 DSH 当代理，并探测本地端口）。
	// 只拦 `cross-site`：DSH 开发模式（web 与 API 不同端口但同站）会发 same-site，不能误伤。
	if (String(req.headers?.["sec-fetch-site"] || "") === "cross-site") {
		sendJson(res, 403, { error: "cross-site-not-allowed" });
		return;
	}
	let parsed;
	try {
		parsed = new URL(req.url ?? "/", "http://dsh.internal");
	} catch {
		sendJson(res, 400, { error: "bad-request" });
		return;
	}
	const targetRaw = parsed.searchParams.get("url");
	if (!targetRaw) {
		sendJson(res, 400, { error: "missing url" });
		return;
	}
	let target;
	try {
		target = new URL(targetRaw);
	} catch {
		sendJson(res, 400, { error: "invalid url" });
		return;
	}
	if (!hostAllowed(target.hostname)) {
		sendJson(res, 403, { error: `host not allowed: ${target.hostname}` });
		return;
	}
	const referer = parsed.searchParams.get("referer") || target.origin + "/";
	const headers = {
		"User-Agent": UA,
		Accept: "application/json, text/plain, */*",
		Referer: referer,
		Origin: target.origin
	};
	// 可选额外头（JSON）：如 GameKee 需 "game-alias":"ba"
	const extra = parsed.searchParams.get("headers");
	if (extra) {
		try {
			const obj = JSON.parse(extra);
			if (obj && typeof obj === "object") {
				for (const [k, v] of Object.entries(obj)) {
					if (typeof v === "string" || typeof v === "number") headers[k] = String(v);
				}
			}
		} catch { /* ignore malformed headers param */ }
	}
	// POST 时读取请求体（JSON 原样透传），目标以 POST + body 请求；超限回 413 并排空
	let body = "";
	if (req.method === "POST") {
		const read = await readRequestBody(req, PROXY_MAX_BODY_CHARS);
		if (read === null) {
			sendJson(res, 413, { error: "request-too-large" });
			return;
		}
		body = read;
	}
	const controller = new AbortController();
	// 超时覆盖到"读完响应体"为止（旧实现在 response.text() 之前就 clearTimeout → 慢速响应体可无限占用）
	const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
	try {
		let current = target;
		let response = null;
		let method = body !== "" ? "POST" : "GET";
		for (let hop = 0; ; hop++) {
			const fetchOpts = { headers, signal: controller.signal, redirect: "manual" };
			if (method === "POST") {
				headers["Content-Type"] = parsed.searchParams.get("contentType") || "application/json; charset=utf-8";
				fetchOpts.method = "POST";
				fetchOpts.body = body;
			}
			response = await fetch(current, fetchOpts);
			const location = response.headers.get("location");
			if (!(response.status >= 300 && response.status < 400 && location)) break;
			if (hop >= PROXY_MAX_REDIRECTS) {
				sendJson(res, 502, { error: "too-many-redirects" });
				return;
			}
			let next;
			try {
				next = new URL(location, current);
			} catch {
				sendJson(res, 502, { error: "bad-redirect" });
				return;
			}
			// 关键加固：**每一跳都重新过白名单**。旧实现 `redirect:"follow"` 只校验首跳，
			// 白名单站点只要 302 到 127.0.0.1 / 内网地址就会被跟随并把内容回传（SSRF 绕过）。
			if (!hostAllowed(next.hostname)) {
				sendJson(res, 403, { error: `redirect host not allowed: ${next.hostname}` });
				return;
			}
			// 301/302/303 的浏览器语义是把 POST 降级为 GET（307/308 才保留方法与 body）
			if (response.status === 301 || response.status === 302 || response.status === 303) {
				method = "GET";
				body = "";
			}
			current = next;
		}
		const responseBody = await readCapped(response, PROXY_MAX_BYTES, controller);
		sendJson(res, 200, {
			status: response.status,
			contentType: response.headers.get("content-type") ?? "",
			body: responseBody
		});
	} catch (err) {
		sendJson(res, 502, { error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) });
	} finally {
		clearTimeout(timeout);   // 所有分支都清理（旧实现只在成功路径 clear）
	}
}

//#region 到期提醒（送达）：定时器 / 去重状态 / 系统通知
// 已知边界（用户 2026-10-27 确认接受，README 里也写了）：**提醒只在 DSH 运行期间生效**。
// 插件宿主随 DSH 起停，定时器活在宿主进程里 —— DSH 关掉就没有人替你盯着了。
// 这也是"不往系统计划任务 / 开机自启里塞东西"的代价：装插件 = 零安装步骤，副作用是离不开宿主。
//
// 送达为什么用**系统通知**：用户的目标是「不看 DSH 也能知道」，红点/面板都做不到。
// 横幅顶部的应用名默认是「Windows PowerShell」（非打包应用没有正经身份）；
// 用户在设置页点「启用」后 ⇒ 宿主会在**当前用户**的开始菜单里放一条带 AppUserModelID 的快捷方式
// （`notifyIdentityEnableScript`，不需要管理员），通知随后用那个 AUMID，横幅顶部显示应用名
// = 设置项 `notifyName`（默认「二游日历」，可自定义；同一名字也用在 toast 正文的署名行）。
// 该功能默认关、随时可移除；判断失败 / 未启用一律回退 PowerShell 自带的 AUMID。
// **本文件不引用 tools/ 目录下的任何东西**（那是给将来独立跑的原型，不属于插件运行时）。
//
// 每一轮做的事（判定规则本身在 lib/remind-core.mjs，和面板/core 是同一份源码）：
//   ① 读配置：remindOn === false 或还没有 lastData ⇒ 直接跳过（不算、不读状态）
//   ② lastData 的档期文本 + 源站 tz → 绝对档期 → 条目
//   ③ 拿去重状态判「这一轮该发哪几条」（同一条目只发最紧急那档，T 已过就作废）
//   ④ 逐条弹通知；**失败的档位不记已发**，下一轮会重试（直到成功或 T 过作废）
//   ⑤ 状态原子写回 %LOCALAPPDATA%\dsh-gacha-calendar\host-state.json，日志追加到同目录 remind.log
const REMIND_INTERVAL_MS = 30 * 60 * 1000;   // 默认每 30 分钟一轮（判定只取决于 now，与频率无关）
const REMIND_STARTUP_DELAY_MS = 5000;        // 启动后先来一轮，但别跟 DSH 开机抢那几秒
const REMIND_LOG_MAX_BYTES = 256 * 1024;     // 日志只留最近一段，长期开着的宿主不该让它无限长

/** Windows PowerShell 5.1 自带的 AUMID —— 免安装也能弹。 */
const POWERSHELL_AUMID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

/** 状态 / 日志目录：`%LOCALAPPDATA%\dsh-gacha-calendar`（不放进 profile，卸载插件即可随手删）。 */
function remindDir() {
	const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
	return path.join(base, "dsh-gacha-calendar");
}
function remindStatePath() {
	return path.join(remindDir(), "host-state.json");
}
function remindLogPath() {
	return path.join(remindDir(), "remind.log");
}

/** 通知身份状态缓存：`%LOCALAPPDATA%\dsh-gacha-calendar\identity.json`（与去重状态 / 日志同目录）。
 *  它只是**探测结果的缓存**，不是设置：删掉 = 下一次 GET 走一次探测慢路径（~1 秒），之后恢复毫秒级。 */
function notifyIdentityPath() {
	return path.join(remindDir(), "identity.json");
}

/** 记一行日志：宿主 console 之外再落一份文件 —— 定时任务出问题是"事后才想知道"，没人盯着 console。 */
function logRemind(text) {
	const line = new Date().toISOString() + " " + String(text);
	try {
		console.log("[gacha-calendar] " + line);
	} catch { /* ignore */ }
	try {
		const file = remindLogPath();
		mkdirSync(path.dirname(file), { recursive: true });
		appendFileSync(file, line + "\n", "utf8");
		try {
			if (statSync(file).size > REMIND_LOG_MAX_BYTES) {
				// 超限就只留后半段（从第一个换行之后开始，避免半行）
				const kept = readFileSync(file, "utf8").slice(-Math.floor(REMIND_LOG_MAX_BYTES / 2));
				writeFileSync(file, kept.slice(kept.indexOf("\n") + 1), "utf8");
			}
		} catch { /* 截断失败不影响送达 */ }
	} catch { /* 日志写不进去也不能让提醒崩 */ }
}

/** 读去重状态：文件不存在 = 首次运行（空）；读坏了 = 当空状态继续（最坏只是同一档再提醒一次，不会漏）。 */
function readRemindState(file) {
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch (err) {
		if (err && err.code === "ENOENT") return {};
		logRemind("读取去重状态失败（按空状态继续）：" + String((err && err.message) || err));
		return {};
	}
	try {
		return remindStateOf(JSON.parse(text));
	} catch (err) {
		logRemind("去重状态不是合法 JSON（按空状态继续）：" + String((err && err.message) || err));
		return {};
	}
}

/** 原子写状态：同目录 .tmp → rename（宿主被强杀时不会留下半截 JSON）。 */
function writeRemindState(file, state) {
	const sorted = {};
	for (const key of Object.keys(state).sort()) sorted[key] = state[key];
	mkdirSync(path.dirname(file), { recursive: true });
	const tmp = file + ".tmp";
	writeFileSync(tmp, JSON.stringify(sorted, null, 2) + "\n", "utf8");
	renameSync(tmp, file);   // 同目录 rename：原子替换
}

/** Windows PowerShell 5.1 的绝对路径（不是 pwsh：只有 5.1 默认带 WinRT 投影）。 */
function powershellPath() {
	if (process.platform !== "win32") return null;
	const sysRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
	return path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** PowerShell 单引号字面量：只需把 `'` 写成 `''`，`$` / `"` / 反引号都是字面量。 */
function psQuote(value) {
	return "'" + String(value === void 0 || value === null ? "" : value).replace(/\r?\n/g, " ").replace(/'/g, "''") + "'";
}
function psArray(lines) {
	return "@(" + (Array.isArray(lines) ? lines : []).map(psQuote).join(", ") + ")";
}

// ── 通知身份（AUMID）：开始菜单快捷方式的建 / 删 / 读 ─────────────────────────────────
// 为什么必须落一条 .lnk：Windows 只认「开始菜单快捷方式里写的 AppUserModelID」= 非打包应用的身份；
// 只在 `HKCU\Software\Classes\AppUserModelId\<AUMID>` 写 DisplayName **不够**（实测 toast 弹不出来）。
// 三条脚本都是自包含的（宿主的 -EncodedCommand 方式，与 toast 同一套），不往用户机器上落 .ps1。
// 任何失败都写进输出的 JSON 里 ⇒ 结构化错误能一路回到设置页，而不是只留一行 exit code。

/**
 * .lnk 的 System.AppUserModel.ID 读写：这个 shell 属性没有命令行 / PowerShell 原生写法，
 * 必须走 IPropertyStore（内联 C#，与 tools/remind/install.ps1 里已跑通的那一版同一套 P/Invoke）。
 * ⚠️ PROPVARIANT 必须显式 `Size = 24`：GetValue 会写满 24 字节，布局给少了会踩坏托管内存。
 */
const NOTIFY_INTEROP_SOURCE = `using System;
using System.Runtime.InteropServices;

public static class GachaNotifyShortcut {
    [StructLayout(LayoutKind.Sequential, Pack = 4)] struct PropertyKey { public Guid fmtid; public uint pid; }
    [StructLayout(LayoutKind.Explicit, Size = 24)] struct PropVariant {   // 24 = PROPVARIANT 的实际大小
        [FieldOffset(0)] public ushort vt;                               // （x64；显式给足，否则 GetValue
        [FieldOffset(8)] public IntPtr pointer;                          //   写 24 字节会踩坏托管内存）
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        int GetCount(out uint count); int GetAt(uint i, out PropertyKey key);
        int GetValue(ref PropertyKey key, out PropVariant value);
        int SetValue(ref PropertyKey key, ref PropVariant value); int Commit();
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr ctx, uint flags, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);

    static PropertyKey Key() {   // {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, pid 5 = PKEY_AppUserModel_ID
        return new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    }
    static IPropertyStore Open(string lnk, uint flags) {
        Guid iid = typeof(IPropertyStore).GUID; IPropertyStore store;
        int hr = SHGetPropertyStoreFromParsingName(lnk, IntPtr.Zero, flags, ref iid, out store);
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        return store;
    }
    public static void Set(string lnk, string aumid) {
        IPropertyStore store = Open(lnk, 2);                          // 2 = GPS_READWRITE
        try {
            PropertyKey key = Key(); PropVariant v = new PropVariant();
            v.vt = 31; v.pointer = Marshal.StringToCoTaskMemUni(aumid);   // 31 = VT_LPWSTR
            try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref v)); Marshal.ThrowExceptionForHR(store.Commit()); }
            finally { Marshal.FreeCoTaskMem(v.pointer); }
        } finally { Marshal.ReleaseComObject(store); }
    }
    public static string Get(string lnk) {
        IPropertyStore store = Open(lnk, 0);                          // 0 = GPS_DEFAULT（只读）
        try {
            PropertyKey key = Key(); PropVariant v;
            Marshal.ThrowExceptionForHR(store.GetValue(ref key, out v));
            try { return v.vt == 31 && v.pointer != IntPtr.Zero ? Marshal.PtrToStringUni(v.pointer) : null; }
            finally { PropVariantClear(ref v); }
        } finally { Marshal.ReleaseComObject(store); }
    }
}
`;

/** 开始菜单目录（**当前用户**，不需要管理员）。 */
function notifyShortcutDir() {
	const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
	return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs");
}

/** 快捷方式绝对路径（`…\Start Menu\Programs\<name>.lnk`）。
 *  `name` 先过 core 的 notifyNameOf（非法文件名字符 / 空 / 超长 / 保留设备名都会在这一层被收干净），
 *  所以调用方可以把配置原文直接递进来。
 *  ⚠️ 这个路径**只用于建**（启用时按当前名字落文件）；**探测身份一律按 AUMID 扫目录**，
 *  不能再拿它去判断"有没有启用"—— 改名重建失败时文件名还是旧的（见 notifyIdentityProbe）。 */
function notifyShortcutPath(name) {
	return path.join(notifyShortcutDir(), notifyNameOf(name) + ".lnk");
}

/** 开始菜单**顶层**的 `.lnk` 绝对路径（按文件名排序，探测结果稳定）。**永不抛**：
 *  目录不存在 / 没权限 ⇒ 空数组（调用方据此短路，连 PowerShell 都不起）。 */
function notifyShortcutFiles() {
	const dir = notifyShortcutDir();
	let names;
	try { names = readdirSync(dir); } catch { return []; }
	return names
		.filter((name) => typeof name === "string" && /\.lnk$/i.test(name))
		.sort()
		.map((name) => path.join(dir, name));
}

/** 图标路径：把常量里的 `%SystemRoot%` 展开成绝对路径（只用于展示，不做其它解析）。 */
function notifyIconPath() {
	const sysRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
	return NOTIFY_SHORTCUT_ICON.replace(/%SystemRoot%/gi, sysRoot);
}

/** PowerShell 脚本的公共开头（错误即停 + 关进度流 + 管道按 UTF-8 输出，与 toast 同一套理由）。 */
function notifyScriptHead() {
	return [
		"$ErrorActionPreference = 'Stop'",
		"$ProgressPreference = 'SilentlyContinue'",
		"try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }"
	];
}

/** 只读探测脚本：把候选 `.lnk` 的 AUMID **一次批量读完**（一个 PowerShell 进程，不是每个文件一个），
 *  输出 `{ shortcuts: [{ path, aumid }], error }`，**不做任何写操作**。
 *  读不出 AUMID 的条目（没有该属性 / 不是快捷方式 / 被占用）逐条吞掉 —— 单条坏掉不该毁掉整次探测。 */
function notifyIdentityProbeScript(lnkPaths) {
	return notifyScriptHead().concat([
		"$Paths = " + psArray(lnkPaths),
		"$Interop = @'",
		NOTIFY_INTEROP_SOURCE,
		"'@",
		"$Out = [ordered]@{ shortcuts = @(); error = $null }",
		"try {",
		"\tif ($Paths.Count -gt 0) {",
		"\t\tif (-not ('GachaNotifyShortcut' -as [type])) { Add-Type -TypeDefinition $Interop -ErrorAction Stop }",
		"\t\t$List = @()",
		"\t\tforeach ($P in $Paths) {",
		"\t\t\t$Id = $null",
		"\t\t\ttry { $Id = [GachaNotifyShortcut]::Get($P) } catch { $Id = $null }",
		"\t\t\tif ($Id) { $List += [ordered]@{ path = $P; aumid = $Id } }",
		"\t\t}",
		"\t\t$Out.shortcuts = $List",
		"\t}",
		"} catch { $Out.error = $_.Exception.Message }",
		"$Out | ConvertTo-Json -Compress",
		"exit 0",
		""
	]).join("\n");
}

/**
 * 「只认 AUMID 删掉自己的 .lnk」的 PowerShell 片段：启用（改名重建 ②）与停用共用**同一段判据**，
 * 免得两处各写一遍、日后悄悄漂移。依赖调用方脚本里已有的 `$Dir` / `$Aumid` / `$Out.removed`。
 * 为什么不按文件名删：改名重建失败时（配置叫新名字、文件还是旧名字），按名字删只是
 * "删了个不存在的文件"却照样回 ok —— 用户点「移除」删不掉、横幅还是旧身份。
 */
function notifyAumidCleanupLines() {
	return [
		"\tif (Test-Path -LiteralPath $Dir) {",
		"\t\tforeach ($Old in @(Get-ChildItem -LiteralPath $Dir -Filter '*.lnk' -File -ErrorAction SilentlyContinue)) {",
		"\t\t\t$OldId = $null",
		"\t\t\ttry { $OldId = [GachaNotifyShortcut]::Get($Old.FullName) } catch { $OldId = $null }",
		"\t\t\tif ($OldId -eq $Aumid) { Remove-Item -LiteralPath $Old.FullName -Force; $Out.removed += $Old.FullName }",
		"\t\t}",
		"\t}",
	];
}

/**
 * 启用脚本（`name` = 清洗后的应用名，决定 .lnk 的**文件名**）：
 *   ① 先看目标名字有没有被**别人的**快捷方式占用 —— 占了就直接回 `shortcut-name-taken`，
 *      **一个文件都不动**（不能"旧名字已删、新名字又建不出来"）。判据是 AUMID 不是文件名；
 *   ② 清掉同目录下 `AUMID == 我们` 的 .lnk（改名重建时旧名字那条就在这儿被删）——
 *      同样**只认 AUMID**，所以用户自己开始菜单里的其它快捷方式绝不会被碰；
 *   ③ 按新名字建快捷方式 → 写 AUMID → 回读确认 → 写注册表的 DisplayName（系统取通知里的应用名）。
 * 回读是**必须**的："Save() 成功"不代表 AUMID 写进去了，不确认就等于没验证。
 */
function notifyIdentityEnableScript(name) {
	const safeName = notifyNameOf(name);
	return notifyScriptHead().concat([
		"$Lnk = " + psQuote(notifyShortcutPath(safeName)),
		"$Aumid = " + psQuote(NOTIFY_AUMID),
		"$Name = " + psQuote(safeName),
		"$Icon = " + psQuote(notifyIconPath()),
		"$Interop = @'",
		NOTIFY_INTEROP_SOURCE,
		"'@",
		"$Out = [ordered]@{ ok = $false; error = $null; aumid = $null; name = $Name; removed = @() }",
		"try {",
		"\t$Dir = Split-Path -Parent $Lnk",
		"\tNew-Item -ItemType Directory -Force -Path $Dir | Out-Null",
		"\tif (-not ('GachaNotifyShortcut' -as [type])) { Add-Type -TypeDefinition $Interop -ErrorAction Stop }",
		// ① 目标名字被**别人的**快捷方式占了 ⇒ 立刻失败，而且**一个文件都不动**
		//    （否则会出现"旧快捷方式已删、新名字又建不出来" ⇒ 用户既没名字也丢了身份）。
		"\tif (Test-Path -LiteralPath $Lnk) {",
		"\t\t$Taken = $null",
		"\t\ttry { $Taken = [GachaNotifyShortcut]::Get($Lnk) } catch { $Taken = $null }",
		"\t\tif ($Taken -ne $Aumid) { throw 'shortcut-name-taken' }",
		"\t}",
		// ② 清掉「我们自己的」旧快捷方式（改名重建 / 同名残留）：
		//    **只认 AUMID**，不认文件名 ⇒ 别人的 .lnk 一律不碰（这是"别误删别的"的实现）。
		...notifyAumidCleanupLines(),
		// ③ 按新名字重建（此时同目录已没有我们的 .lnk）。
		// 身份载体：wscript.exe 本体 + **不带参数**（只是让 .lnk 有个合法目标，不会被真正启动）。
		"\t$Target = Join-Path $env:SystemRoot 'System32\\wscript.exe'",
		"\tif (-not (Test-Path -LiteralPath $Target)) { $Target = 'wscript.exe' }",
		"\t$Shell = New-Object -ComObject WScript.Shell",
		"\ttry {",
		"\t\t$Sc = $Shell.CreateShortcut($Lnk)",
		"\t\t$Sc.TargetPath = $Target",
		"\t\t$Sc.Description = $Name + " + psQuote(" · 通知身份（只用来定应用名，不会被真正启动）"),
		"\t\t$Sc.IconLocation = $Icon",
		"\t\t$Sc.Save()",
		"\t} finally {",
		"\t\t[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($Shell)",
		"\t}",
		"\t[GachaNotifyShortcut]::Set($Lnk, $Aumid)",
		"\t$ReadBack = [GachaNotifyShortcut]::Get($Lnk)",
		"\tif ($ReadBack -ne $Aumid) { throw ('快捷方式已建好，但 AUMID 回读不一致（读到「' + $ReadBack + '」）') }",
		// 起名用：系统从这条注册表项取通知里的应用显示名（没有 .lnk 时它不会生效）。
		"\t$Key = 'HKCU:\\Software\\Classes\\AppUserModelId\\' + $Aumid",
		"\tNew-Item -Path $Key -Force | Out-Null",
		"\tNew-ItemProperty -Path $Key -Name 'DisplayName' -Value $Name -PropertyType String -Force | Out-Null",
		"\t$Out.ok = $true",
		"\t$Out.aumid = $ReadBack",
		"} catch { $Out.error = $_.Exception.Message }",
		"$Out | ConvertTo-Json -Compress",
		"exit 0",
		""
	]).join("\n");
}

/**
 * 停用脚本：删掉**所有 AUMID 等于我们**的开始菜单 .lnk（不看文件名）。
 * 为什么按 AUMID：改名重建失败时（配置叫新名字、文件还是旧名字）按名字删删不到东西，
 * 却照样回 ok —— 用户点「移除」没反应、横幅还是旧身份。与启用脚本 ② 共用同一段判据。
 * **注册表键 `HKCU\Software\Classes\AppUserModelId\<AUMID>` 保留**：没有快捷方式时系统根本不会用它
 * （不启用就没有任何副作用），而留着它下次启用时不用再写一遍、也不用在这里多写一段删键逻辑。
 */
function notifyIdentityDisableScript() {
	return notifyScriptHead().concat([
		"$Dir = " + psQuote(notifyShortcutDir()),
		"$Aumid = " + psQuote(NOTIFY_AUMID),
		"$Interop = @'",
		NOTIFY_INTEROP_SOURCE,
		"'@",
		"$Out = [ordered]@{ ok = $false; error = $null; existed = $false; removed = @() }",
		"try {",
		"\tif (-not ('GachaNotifyShortcut' -as [type])) { Add-Type -TypeDefinition $Interop -ErrorAction Stop }",
		...notifyAumidCleanupLines(),
		"\t$Out.existed = @($Out.removed).Count -gt 0",
		"\t$Out.ok = $true",
		"} catch { $Out.error = $_.Exception.Message }",
		"$Out | ConvertTo-Json -Compress",
		"exit 0",
		""
	]).join("\n");
}

/**
 * 跑一段 PowerShell 并读它最后打印的 JSON。**永不 reject**（失败一律折成 `{ ok:false, error }`）。
 * 脚本自己把原因塞进 JSON，所以这里不靠 exit code 猜（没权限 / C# 编译失败 / 路径被占都能回传）。
 */
function runNotifyPowerShell(script) {
	const exe = powershellPath();
	if (!exe) return Promise.resolve({ ok: false, error: "windows-only" });
	return new Promise((resolve) => {
		const encoded = Buffer.from(script, "utf16le").toString("base64");
		execFile(
			exe,
			["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
			{ windowsHide: true, timeout: 30000 },
			(err, stdout, stderr) => {
				const text = String(stdout === void 0 || stdout === null ? "" : stdout)
					.replace(/#<\s*CLIXML[\s\S]*$/i, "")
					.trim();
				let parsed = null;
				try { parsed = JSON.parse(text); } catch { parsed = null; }
				if (parsed && typeof parsed === "object") {
					if (parsed.error) resolve({ ok: false, error: String(parsed.error) });
					else resolve(parsed);
					return;
				}
				const detail = tidyPowerShellText(stderr) || tidyPowerShellText(stdout);
				resolve({ ok: false, error: detail || (err ? String(err.message || "powershell-failed") : "powershell-no-output") });
			}
		);
	});
}

/**
 * 一次探测：扫描开始菜单**顶层** `.lnk`，按 **AUMID** 找出我们那条。**永不抛** ——
 * 身份判断失败必须能回退 PowerShell。
 * 返回 `{ exists: true, aumid, shortcutPath, name }` 或 `{ exists: false, aumid: null, error: null }`。
 *
 * 为什么不再按 `<当前名字>.lnk` 拼路径（2026-10-28 真机踩到）：
 *   用户在设置页把名字改成「二游日历6666」，但改名重建那一步没成功（宿主没重启、配置写入被拒）
 *   ⇒ 开始菜单里仍是 `二游日历.lnk`（AUMID 正确），配置里却是新名字。按名字拼路径 ⇒ 找不到
 *   ⇒ 静默回退 PowerShell ⇒ 横幅仍显示「Windows PowerShell」。文件名只是"建的时候叫什么"，
 *   身份的唯一判据是 `System.AppUserModel.ID`。
 */
async function notifyIdentityProbe() {
	if (process.platform !== "win32") return { exists: false, aumid: null, error: null };
	// ① 先在 Node 侧列一次目录（readdirSync，微秒级）：一个 .lnk 都没有 ⇒ 直接短路，
	//    连 PowerShell 都不起。这是默认路径（没启用身份 / 设置页每次打开 / 每轮提醒）的常态，
	//    不短路的话每次都要白等一个进程（几百毫秒）。
	const lnks = notifyShortcutFiles();
	if (lnks.length === 0) return { exists: false, aumid: null, error: null };
	try {
		// ② 一次 PowerShell 批量读完所有候选的 AUMID（不是每个文件起一个进程 —— 目录里几十个 .lnk
		//    时那是几十次进程启动 + 几十次 C# 编译，会从毫秒级变成几十秒级）。
		const res = await runNotifyPowerShell(notifyIdentityProbeScript(lnks));
		if (res && res.ok === false) return { exists: false, aumid: null, error: String(res.error || "probe-failed") };
		const entries = res && Array.isArray(res.shortcuts) ? res.shortcuts : [];
		const hit = notifyShortcutPickOf(entries, NOTIFY_AUMID);
		const hitPath = hit && typeof hit.path === "string" ? hit.path : "";
		if (!hit || hitPath === "") return { exists: false, aumid: null, error: null };
		return {
			exists: true,
			aumid: typeof hit.aumid === "string" ? hit.aumid : NOTIFY_AUMID,
			shortcutPath: hitPath,
			// 文件名去掉 .lnk = 这条身份**实际生效**的应用名（可能与配置里的名字不同，见上面那段）
			name: path.basename(hitPath).replace(/\.lnk$/i, ""),
			error: null
		};
	} catch (err) {
		return { exists: false, aumid: null, error: String((err && err.message) || err) };
	}
}

/**
 * 一次探测结果 → 落盘记录（`identity.json` 的形状，也是 GET / 提醒轮次唯一信任的"上一次真相"）。
 *   enabled       只由「快捷方式存在 **且** AUMID 正确」决定（remindIdentityOf，判据只有这一处）；
 *   aumid         恒为 NOTIFY_AUMID（缓存只描述"我们这个身份"；常量变了旧文件会被判作废）；
 *   shortcutPath  启用时 = 探测到的真实 .lnk（可能不是按当前配置名拼出来的那条）；未启用时空串；
 *   name          启用时优先取探测到的**文件名**（改名重建失败时那才是实际生效的名字），否则配置名；
 *   checkedAt     这次探测的时刻 —— GET 的 TTL 与后台刷新都按它算。
 */
function identityStateOf(probe, cfgName) {
	const enabled = remindIdentityOf(probe, NOTIFY_AUMID).enabled === true;
	const detected = enabled && probe && typeof probe.name === "string" ? probe.name.trim() : "";
	return {
		enabled,
		aumid: NOTIFY_AUMID,
		shortcutPath: enabled && probe && typeof probe.shortcutPath === "string" ? probe.shortcutPath : "",
		name: detected === "" ? notifyNameOf(cfgName) : notifyNameOf(detected),
		checkedAt: Date.now()
	};
}

/** 记录 → remindIdentityOf 吃的"探测结果"形状。
 *  身份判定**仍然只有 remindIdentityOf 一处**（缓存只是把探测结果保存下来，不另写一套"enabled 就算启用"）。 */
function identityProbeOfState(state) {
	return state && state.enabled === true
		? { exists: true, aumid: state.aumid, shortcutPath: state.shortcutPath, name: state.name }
		: { exists: false, aumid: null, error: null };
}

/**
 * 记录 → GET 响应体（字段名与设置页 / 预留图标接口对齐，见 NOTIFY_IDENTITY_PREFIX 的注释）。
 * 名字与路径都**以记录里的真实快捷方式为准**：改名重建失败时（配置是 6666、文件还是旧名字），
 * 界面必须显示"实际生效的那个"，否则用户看到的和横幅上的又对不上。
 */
function identityBodyOf(state, cfgName) {
	const enabled = state && state.enabled === true;
	const detected = enabled && typeof state.name === "string" ? state.name.trim() : "";
	const shownName = detected === "" ? cfgName : notifyNameOf(detected);
	// 路径同理：启用时回真实文件（可能不是按当前配置名拼出来的那个）；未启用时回"将要建的那个"。
	const shortcutPath = enabled && typeof state.shortcutPath === "string" && state.shortcutPath !== ""
		? state.shortcutPath
		: notifyShortcutPath(cfgName);
	return { enabled, name: shownName, aumid: NOTIFY_AUMID, shortcutPath, iconPath: notifyIconPath() };
}

/**
 * 没有 identity.json 时 GET **立刻**回的保守值（`{ enabled:false, name, aumid, shortcutPath:"" }` + iconPath）。
 * 形状与 identityBodyOf 完全一致 —— 设置页不需要知道"这是保守值还是探测结果"。
 * 保守值的判定在 core 的纯函数 notifyIdentityFallbackOf（可离线断言），这里只补宿主才知道的 iconPath。
 * 为什么 shortcutPath 是空串（不是"将要建的那个"）：此刻我们**没探测过**，不能声称知道系统里有什么；
 * 空串 = "未启用且不知道路径"，与 identity.json 里未启用记录的写法一致。
 */
function identityFallbackBodyOf(cfgName) {
	return {
		...notifyIdentityFallbackOf(cfgName, NOTIFY_AUMID),
		iconPath: notifyIconPath()
	};
}

/**
 * 读身份状态缓存（`identity.json`）。**毫秒级、不探测、永不抛**。
 * 返回 `{ state, stale }` 或 null（= 没有文件 / 读坏 / 字段不全 ⇒ 调用方走探测慢路径）。
 * stale=true 表示"还能用，但该在后台补探一次"：超过 24h（NOTIFY_IDENTITY_MAX_AGE_MS），或者
 * 缓存说启用了、而那条 .lnk 已经被用户手工删掉（一次 existsSync，微秒级，不是探测）。
 * ⚠️ GET 的毫秒路径就是它：这里**绝不起 PowerShell**，否则设置页又会卡 1 秒。
 */
function readIdentityState() {
	let text;
	try {
		text = readFileSync(notifyIdentityPath(), "utf8");
	} catch (err) {
		if (err && err.code !== "ENOENT") logRemind("读取身份缓存失败（按没有缓存处理）：" + String((err && err.message) || err));
		return null;
	}
	const decision = notifyIdentityCacheOf(text, Date.now(), NOTIFY_IDENTITY_MAX_AGE_MS, NOTIFY_AUMID);
	if (!decision.useCached || !decision.state) return null;
	const state = decision.state;
	const vanished = state.enabled === true && state.shortcutPath !== "" && !existsSync(state.shortcutPath);
	return { state, stale: decision.shouldRefresh === true || vanished };
}

/** 原子写身份状态缓存：同目录 .tmp → rename（与去重状态同一套，宿主被强杀时不会留下半截 JSON）。 */
function writeIdentityState(state) {
	const file = notifyIdentityPath();
	mkdirSync(path.dirname(file), { recursive: true });
	const tmp = file + ".tmp";
	writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
	renameSync(tmp, file);   // 同目录 rename：原子替换
}

/**
 * 慢路径：真探测一次并**写回**缓存（identity.json 的写点之一）。
 * 只有"没有文件 / 字段不全 / 读坏"与"POST 成功之后"才走到这里 —— 正常 GET 与每轮提醒都不碰 PowerShell。
 * 写不进去（文件被占 / 没权限）只记日志：本次仍按探测结果返回，下一次再探测一次就是了。
 */
async function probeIdentityState(cfgName) {
	const state = identityStateOf(await notifyIdentityProbe(), cfgName);
	try {
		writeIdentityState(state);
	} catch (err) {
		logRemind("写身份缓存失败（本次仍按探测结果）：" + String((err && err.message) || err));
	}
	return state;
}

/** 同一时刻只允许一次后台刷新：多个 GET / 提醒轮次撞在一起时不该起多个 PowerShell。 */
let identityRefreshRunning = false;

/**
 * 后台探测 / 刷新身份缓存：调用方**不等待它**（GET 立刻返回，按文件内容或保守值）。
 * 单飞（同一时刻只有一次在跑）+ 永不抛；探测完就写回（checkedAt 随之前进，否则下一个请求又会排一次）。
 * 三个入口共用它：GET 没有缓存（首次探测）/ GET 命中但 stale（刷新）/ 启动预热。
 * "用户手工删了开始菜单快捷方式"就是靠这里纠正的：本次请求仍回旧内容，下一次起生效。
 */
function refreshIdentityState(cfgName) {
	if (identityRefreshRunning) return;
	identityRefreshRunning = true;
	// ⚠️ 必须**下一拍**再真跑，不能在这个调用栈里直接跑：
	//    `notifyIdentityProbe` 的同步前缀是一次 readdirSync 扫开始菜单顶层（实测 80~120ms；杀软在场时更久），
	//    而它发生在第一个 await **之前** ⇒ 直接在 GET / apply 的栈里调它，等于把"后台探测"又变成同步开销
	//    （探针实测：GET 从 0.5ms 变成 81ms、apply 从 0.2ms 变成 115ms）。setTimeout(0) 之后两处都回到毫秒级。
	//    单飞标记在**排程时**就置上：这样连打多个 GET 也只会排一个定时器、起一次 PowerShell。
	setTimeout(() => {
		void (async () => {
			try {
				const next = identityStateOf(await notifyIdentityProbe(), cfgName);
				const prev = readIdentityState();
				writeIdentityState(next);
				if (prev && prev.state.enabled !== next.enabled) {
					logRemind("通知身份：后台探测纠正了缓存（" + (prev.state.enabled ? "已启用 → 未启用" : "未启用 → 已启用") + "）");
				}
			} catch (err) {
				logRemind("后台刷新身份缓存失败（保留旧文件）：" + String((err && err.message) || err));
			} finally {
				identityRefreshRunning = false;
			}
		})();
	}, 0);
}

/**
 * **启动预热**（`apply()` 里 `void` 调用，不 await）：`identity.json` 不存在或已 stale ⇒
 * 立刻排一次后台探测并写回，这样用户**第一次**打开设置页时缓存大概率已就绪 ⇒ 直接走毫秒路径，
 * 不会先看到一次保守值（"PowerShell（默认）"）再跳成「二游日历」。
 *
 * 为什么不 await / 为什么整段 try/catch：预热只是锦上添花，**绝不能拖慢或拖垮插件加载**。
 * 宿主刚启动时 PowerShell 可能还没就绪 ⇒ 探测失败只记日志（refreshIdentityState 内部已吞异常），
 * 之后 GET 的兜底后台探测（没有缓存 ⇒ 立刻回保守值 + void 探测）会再试一次。
 *
 * @returns {boolean} 是否真的排了一次预热（false = 缓存新鲜 / 排的时候出错了）—— 只为可观测性。
 */
function warmIdentityState(cfgName) {
	try {
		const cached = readIdentityState();
		if (cached && !cached.stale) return false;   // 新鲜缓存：什么都不用做
		refreshIdentityState(cfgName);
		return true;
	} catch (err) {
		logRemind("启动预热身份缓存失败（不影响插件加载，之后 GET 会兜底再探）：" + String((err && err.message) || err));
		return false;
	}
}

/**
 * 通知身份路由：`GET/POST /api/gacha-calendar-notify-identity`（鉴权口径与快照路由一致：
 * 只服务本机、拒绝 cross-site）。
 *  - `name` = 设置项 `notifyName` 清洗后的应用名（POST 带 `name` 时以 body 为准，
 *    这样设置页改完名字可以立刻按新名字重建，不必等宿主重载把配置投影过来）；
 *  - GET：`{ enabled, name, aumid, shortcutPath, iconPath }` —— **先读 identity.json（毫秒级）**；
 *    ① 命中 ⇒ 立刻返回（文件超过 24h 或缓存说启用而快捷方式已被手工删掉时，**本次仍回文件内容**、
 *       只在后台补探一次纠正）；
 *    ② 没有文件 / 字段不全 / 读坏 ⇒ **也立刻返回**保守值 `identityFallbackBodyOf(cfgName)`
 *       （`{ enabled:false, name:<配置名>, aumid, shortcutPath:"" }`），同时 `void` 后台探测一次并写回
 *       ⇒ **GET 永远不会等 PowerShell**，下一次 GET 就能拿到准确值。
 *    enabled 由记录里「快捷方式存在且 AUMID 正确」判定（remindIdentityOf）；**name 优先取记录里的
 *    快捷方式名**（改名重建失败时配置名与真实文件不一致，界面必须显示真实生效的那个），没有才用配置名；
 *  - POST `{ enabled: true|false, name? }`：true 建开始菜单快捷方式（改名 = 先按 AUMID 删旧的、
 *    再按新名字建）、false 按 AUMID 删掉它；返回 `{ ok: true, enabled, name, shortcutPath, aumid }`
 *    或 `{ ok: false, error }`。
 * 失败**不做异常抛出**：原因（无权限 / C# 编译失败 / 非 Windows / 名字被占 …）原样放进 JSON，
 * 由设置页一行小字显示。
 * `ctx` / `fallbackConfig` 由注册处（apply 的闭包）传进来 —— 这条路由要读配置，而 webServer
 * 只给 handler(req, res) 两个参数。
 */
async function notifyIdentityHandler(req, res, ctx, fallbackConfig) {
	if (!isLoopback(req)) { sendJson(res, 403, { error: "loopback-only" }); return; }
	if (String(req.headers?.["sec-fetch-site"] || "") === "cross-site") {
		sendJson(res, 403, { error: "cross-site-not-allowed" });
		return;
	}
	const cfgName = notifyNameOf(configValueOf(liveConfigOf(ctx, fallbackConfig), "notifyName"));
	if (req.method === "GET" || req.method === "HEAD") {
		// ① 先读 identity.json（毫秒级，绝不起 PowerShell）。命中就立刻回 —— 这是设置页 /
		//    每轮提醒的正常路径：打开设置页不该为了一次探测卡 ~1 秒。
		const cached = readIdentityState();
		if (cached) {
			// ② 过期 / 缓存说启用但快捷方式已被手工删掉 ⇒ 只**排一次后台刷新**（单飞、不阻塞调用方），
			//    本次仍回文件内容 —— "先到先得，纠正交给后台那一次探测"。
			if (cached.stale) void refreshIdentityState(cfgName);
			sendJson(res, 200, identityBodyOf(cached.state, cfgName));
			return;
		}
		// ③ 没有缓存（从没启用过身份的用户根本没有 identity.json）：**也立刻返回**，绝不在这里等探测。
		//    先回保守值（未启用 + 配置名 + 空路径），同时 `void` 后台探测一次并写回文件
		//    （单飞、永不抛）⇒ 下一次 GET（前端下次读 / 点「发送测试通知」）就是准确值、毫秒级。
		//    ⚠️ 这条分支里**不允许出现任何 `await probe…`**（一旦 await，GET 又回到 0.87 秒；见测试 ⑯）。
		void refreshIdentityState(cfgName);
		sendJson(res, 200, identityFallbackBodyOf(cfgName));
		return;
	}
	if (req.method !== "POST") { sendJson(res, 405, { error: "method-not-allowed" }); return; }
	const body = await readRequestBody(req, NOTIFY_MAX_BODY_CHARS);
	if (body === null) { sendJson(res, 413, { error: "payload-too-large" }); return; }
	let parsed;
	try { parsed = JSON.parse(body); } catch { sendJson(res, 400, { error: "invalid-json" }); return; }
	// 只认布尔：`"true"` / 1 / 缺失都拒绝（脏值不能被当成"启用"而悄悄改用户开始菜单）。
	if (!parsed || typeof parsed.enabled !== "boolean") {
		sendJson(res, 400, { error: "enabled-must-be-boolean" });
		return;
	}
	// 名字：body 里有就用 body 的（设置页改完名字立刻重建），否则用配置里的。
	const name = notifyNameOf(typeof parsed.name === "string" ? parsed.name : cfgName);
	if (process.platform !== "win32") {
		sendJson(res, 200, { ok: false, error: "windows-only" });
		return;
	}
	const r = parsed.enabled
		? await runNotifyPowerShell(notifyIdentityEnableScript(name))
		: await runNotifyPowerShell(notifyIdentityDisableScript());
	if (r.ok !== true) {
		sendJson(res, 200, { ok: false, error: String(r.error || "shortcut-failed") });
		return;
	}
	// 以"再探一次"为唯一真相：建了但 AUMID 没写进去 ⇒ enabled 仍为 false（设置页会如实显示）。
	// 这次探测的结果**落盘**（identity.json 的另一个写点：POST 成功之后）⇒ 之后 GET / 每轮提醒
	// 都走毫秒路径，不必再为同一个状态付一次 ~1 秒的 PowerShell。
	const state = await probeIdentityState(name);
	sendJson(res, 200, { ok: true, enabled: state.enabled, name, shortcutPath: notifyShortcutPath(name), aumid: NOTIFY_AUMID });
}

/**
 * 生成这一条通知的 PowerShell 脚本（自包含：标题/正文都是脚本里的字面量）。
 *
 * 为什么生成脚本 + `-EncodedCommand`，而不是「随插件带一个 .ps1 文件、用 -File 调」：
 *   ① 不用管发布包该带哪些文件（package.json 的 files 少一项就整个功能静默失效）；
 *   ② 中文标题里出现 `'` / `"` / `&` / `$` 时**不经过命令行参数**，也就不存在 argv 引号转义那类
 *      "本机跑得好、别人机器上不弹"的坑（execFile 传引号给 PowerShell 的规则是出了名的脆）；
 *   ③ 不在用户机器上落一个会被执行的 .ps1（"写脚本再执行"是杀软最敏感的模式之一）。
 *   `-EncodedCommand` 只是把脚本文本安全地送进去（UTF-16LE → base64），不是混淆：脚本就在这个函数里。
 *
 * `appName` = 设置项 `notifyName`（应用名）：正文最后那行 attribution（署名）用的就是它，
 * 与横幅顶部的应用名（由 AUMID 决定）对齐；清洗与默认值统一走 core 的 notifyNameOf。
 */
function toastScriptOf(title, lines, aumid, appName) {
	const bodyLines = (Array.isArray(lines) ? lines : []).filter((line) => typeof line === "string" && line !== "");
	const app = notifyNameOf(appName);
	return [
		"$ErrorActionPreference = 'Stop'",
		// 进度流必须关掉：stderr 被重定向时 Windows PowerShell 会把进度记录序列化成 CLIXML 写进 stderr
		// （实测第一句就是「正在准备首次使用模块」），日志里会多出几百字节 XML，看着像出错。
		"$ProgressPreference = 'SilentlyContinue'",
		// 让 Node 侧拿到的 stdout/stderr 是 UTF-8（否则 Windows PowerShell 按 OEM 代码页写管道，中文乱码）
		"try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }",
		"$Title = " + psQuote(title),
		"$BodyLines = " + psArray(bodyLines),
		"$AppName = " + psQuote(app),
		// 应用身份由调用方决定：已启用「二游日历」⇒ 宿主传 NOTIFY_AUMID；否则回退 PowerShell 自带的那个。
		"$Aumid = " + psQuote(aumid || POWERSHELL_AUMID),
		"function Stop-Toast([string]$Message, [int]$Code) { try { [Console]::Error.WriteLine('toast: ' + $Message) } catch { }; exit $Code }",
		// ── 1) 载入 WinRT 投影（Win10/11 自带；无桌面会话 / 通知服务不可用会在这就抛）──
		"try {",
		"\t[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]",
		"\t[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]",
		"\t[void][Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]",
		"} catch { Stop-Toast ('winrt-unavailable: ' + $_.Exception.Message) 1 }",
		// ── 2) 组装 toast XML（一律先转义：卡池/活动名里出现 & < > " 一点都不罕见）──
		"$Esc = { param($s) [System.Security.SecurityElement]::Escape([string]$s) }",
		"$Texts = '<text>' + (& $Esc $Title) + '</text>'",
		"foreach ($line in $BodyLines) { $Texts += '<text>' + (& $Esc $line) + '</text>' }",
		"$Texts += '<text placement=\"attribution\">' + (& $Esc $AppName) + '</text>'",
		"$Xml = '<toast activationType=\"foreground\"><visual><binding template=\"ToastGeneric\">' + $Texts + '</binding></visual></toast>'",
		"$Doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
		"try { $Doc.LoadXml($Xml) } catch { Stop-Toast ('bad-xml: ' + $_.Exception.Message) 1 }",
		"try { $Toast = New-Object Windows.UI.Notifications.ToastNotification $Doc } catch { Stop-Toast ('new-toast: ' + $_.Exception.Message) 1 }",
		// ── 3) 送达：用调用方选的 AUMID（已启用「二游日历」/ 回退 PowerShell）；个别有包标识的宿主
		//      反而不认外部 AUMID → 空参兜底（空参 = 当前进程身份，仍然能弹）──
		"try { [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid).Show($Toast) }",
		"catch {",
		"\ttry { [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier().Show($Toast) }",
		"\tcatch { Stop-Toast ('show: ' + $_.Exception.Message) 2 }",
		"}",
		// Show() 不抛 ≠ 用户一定看见：专注助手 / 勿扰 / 通知总开关关掉时系统照收不误但静默吞掉。
		"Write-Output ('ok: ' + $AppName + ' / ' + $Title)",
		"exit 0",
		""
	].join("\n");
}

/**
 * PowerShell 的输出会带两种垃圾：进度记录被序列化成 CLIXML（stderr）、以及末尾多余空行。
 * 日志只留**一句人话**：剥掉 CLIXML 块、压掉换行、截断到 400 字。
 */
function tidyPowerShellText(value) {
	let text = String(value === void 0 || value === null ? "" : value);
	text = text.replace(/#<\s*CLIXML[\s\S]*$/i, "").replace(/\s+/g, " ").trim();
	return text.length > 400 ? text.slice(0, 400) + "…" : text;
}

/**
 * 弹一条系统通知。**永不 reject**：失败信息原样交回，由调用方记日志 / 重试。
 * @returns {Promise<{ ok: boolean, code: number, detail: string }>}
 */
function sendToastScript(script) {
	const exe = powershellPath();
	if (!exe) return Promise.resolve({ ok: false, code: 0, detail: "当前平台不是 Windows（WinRT toast 只有 Windows 有）" });
	return new Promise((resolve) => {
		const encoded = Buffer.from(script, "utf16le").toString("base64");
		execFile(
			exe,
			["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
			{ windowsHide: true, timeout: 30000 },
			(err, stdout, stderr) => {
				const out = tidyPowerShellText(stdout);
				const errText = tidyPowerShellText(stderr);
				resolve({
					ok: !err,
					code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
					detail: errText || out || (err ? String(err.message || "") : "")
				});
			}
		);
	});
}

/**
 * 当前通知该用哪个 AUMID + 哪个应用名 —— **身份选择的唯一出口**。
 * 真实提醒（runRemindRound）与设置页的「发送测试通知」都调它：判定仍然只有一处
 * （`remindIdentityOf` 吃 `identityProbeOfState` 的"探测结果"形状），不另写第二套。
 * 2026-10-28 起身份状态**先读 identity.json**（毫秒级）：缓存命中就直接用，没有 / 读坏才探测一次并写回，
 * 过期 / 快捷方式被删则只在后台补探 ⇒ 提醒轮次从"每轮 ~1 秒"降到毫秒级。
 * 已启用「二游日历」⇒ 用 NOTIFY_AUMID；未启用 / 非 Windows / 探测失败 ⇒ 回退 PowerShell 自带的
 * （身份问题绝不能让通知发不出去）。`name` 已过 notifyNameOf（默认「二游日历」），
 * 调用方拿它去拼 toast 的署名行与测试通知的发送者行。
 * @returns {Promise<{ enabled: boolean, aumid: string, identity: "app"|"powershell", name: string }>}
 */
async function notifyToastTargetOf(name) {
	const appName = notifyNameOf(name);
	const cached = readIdentityState();
	let state;
	if (cached) {
		// 缓存命中：这一轮就用文件里的（至少是上一次探测的真相），过期只排后台刷新、不阻塞送达。
		if (cached.stale) refreshIdentityState(appName);
		state = cached.state;
	} else {
		// 慢路径（首次 / 文件被删 / 读坏）：探测一次并写回，之后每轮都是毫秒级。
		state = await probeIdentityState(appName);
	}
	const identity = remindIdentityOf(identityProbeOfState(state), NOTIFY_AUMID);
	const enabled = identity.enabled === true;
	return {
		enabled,
		aumid: enabled ? NOTIFY_AUMID : POWERSHELL_AUMID,
		identity: enabled ? "app" : "powershell",
		// 未启用时署名固定默认名：自定义名字只在身份启用后生效（否则改个名字就会影响还没启用的通知）
		name: enabled ? appName : notifyNameOf("")
	};
}

/**
 * 测试通知路由：`POST /api/gacha-calendar-notify-test`（鉴权口径与通知身份路由一致：
 * 只服务本机、拒绝 cross-site）。
 * 只做一件事：按当前身份发一条测试通知（正文由 core 的 remindTestToastOf 生成）。
 * **不写状态文件、不动提醒去重状态** ⇒ 点多少次都不影响下一轮真实提醒该不该发。
 * 返回 `{ ok: true, aumid, identity, name, detail }` 或 `{ ok: false, error }`；
 * 失败原因（非 Windows / PowerShell 的输出）原样交给设置页那一行小字。
 * 应用名同样取自设置项 `notifyName`（`ctx` / `fallbackConfig` 由注册处传进来，理由见
 * notifyIdentityHandler）。
 */
async function notifyTestHandler(req, res, ctx, fallbackConfig) {
	if (!isLoopback(req)) { sendJson(res, 403, { error: "loopback-only" }); return; }
	if (String(req.headers?.["sec-fetch-site"] || "") === "cross-site") {
		sendJson(res, 403, { error: "cross-site-not-allowed" });
		return;
	}
	if (req.method !== "POST") { sendJson(res, 405, { error: "method-not-allowed" }); return; }
	if (process.platform !== "win32") {
		sendJson(res, 200, { ok: false, error: "windows-only" });
		return;
	}
	const appName = configValueOf(liveConfigOf(ctx, fallbackConfig), "notifyName");
	const target = await notifyToastTargetOf(appName);
	const { title, lines } = remindTestToastOf(Date.now(), target.identity, target.name);
	const sent = await sendToastScript(toastScriptOf(title, lines, target.aumid, target.name));
	if (!sent.ok) {
		sendJson(res, 200, { ok: false, error: String(sent.detail || "send-failed") });
		return;
	}
	sendJson(res, 200, { ok: true, aumid: target.aumid, identity: target.identity, name: target.name, detail: String(sent.detail || "") });
}

/** 自定义条目（设置里的 JSON 数组）自己填的 tz → { id: tz }；解析失败就当没有。 */
function customTzByIdOf(customEntries) {
	const out = {};
	if (typeof customEntries !== "string" || customEntries.trim() === "") return out;
	let list;
	try {
		list = JSON.parse(customEntries);
	} catch {
		return out;
	}
	if (!Array.isArray(list)) return out;
	for (const entry of list) {
		if (entry && typeof entry.id === "string" && typeof entry.tz === "string" && entry.tz.trim() !== "") {
			out[entry.id] = entry.tz.trim();
		}
	}
	return out;
}

/**
 * 取当前配置：设置页写入会经 loader 让本插件整体重载（apply 重新跑），所以闭包里的 config 是
 * "这一次加载"的快照；重载进行中 `ctx.fiber.config` 可能已换成新的，两个都试一下。
 */
function liveConfigOf(ctx, fallback) {
	try {
		const live = ctx && ctx.fiber ? ctx.fiber.config : null;
		if (live && typeof live === "object") return live;
	} catch { /* ignore */ }
	return fallback && typeof fallback === "object" ? fallback : {};
}

/**
 * volatile 字段的协议符号（@deepseek-ai/cosmokit 的 `Symbol.for("cosmokit.volatile.write")`；
 * 用 Symbol.for 取 ⇒ 插件与宿主各自加载的那份实现也能互认）。
 */
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");

/**
 * 读一个配置字段的**裸值**。
 * ⚠️ 这是宿主读配置最容易踩的坑：本插件的设置字段全都标了 `.volatile()`，而 DSH 交给 apply 的
 * `config.xxx` 不是裸值，而是 `{ get(), [Symbol.for("cosmokit.volatile.write")] }` 这样的**引用对象**
 * （见 @deepseek-ai/dsh-settings 的 plainConfig / volatileForm）。直接 `cfg.remindOn === false` 永远是
 * false、`typeof cfg.lastData === "string"` 永远是 false —— 而且**不报错**，表现就是"提醒永远不发"。
 * 所以这里统一解包；不是引用对象（老版本 / 探针 / 纯对象）就原样返回。
 */
function configValueOf(cfg, key) {
	const raw = cfg && typeof cfg === "object" ? cfg[key] : void 0;
	if (raw && typeof raw === "object" && typeof raw.get === "function" && VOLATILE_WRITE in raw) {
		try {
			return raw.get();
		} catch {
			return void 0;
		}
	}
	return raw;
}

/** 上一轮还在弹通知（每次 powershell 启动要几百毫秒）→ 这一轮直接跳过，别叠着跑。 */
let remindRoundRunning = false;

/** 跑一轮（读配置 → 判定 → 送达 → 落状态）。所有异常都在这里吞掉并记日志：提醒坏了不能拖垮宿主。 */
async function runRemindRound(ctx, fallbackConfig, reason) {
	if (remindRoundRunning) return;
	remindRoundRunning = true;
	try {
		const cfg = liveConfigOf(ctx, fallbackConfig);
		// 逐字段解包 volatile 引用（见 configValueOf：不解包的话下面每个判断都会静默失效）
		const plain = {
			remindOn: configValueOf(cfg, "remindOn"),
			remindEndNodes: configValueOf(cfg, "remindEndNodes"),
			remindStartNodes: configValueOf(cfg, "remindStartNodes"),
			// 应用名（默认「二游日历」）：通知署名行 / 快捷方式名字都用它，清洗在 notifyNameOf。
			notifyName: configValueOf(cfg, "notifyName"),
			lastData: configValueOf(cfg, "lastData"),
			customEntries: configValueOf(cfg, "customEntries")
		};
		if (!remindOnOf(plain.remindOn)) return;   // 关掉：不读数据、不算、不打扰
		const raw = typeof plain.lastData === "string" ? plain.lastData.trim() : "";
		if (!raw) return;                        // 还没抓到过数据（首次安装 / 缓存被清）
		let games;
		try {
			games = JSON.parse(raw);
		} catch {
			logRemind("跳过：lastData 不是合法 JSON");
			return;
		}
		if (!games || typeof games !== "object" || Array.isArray(games)) return;
		const now = Date.now();
		const items = remindItemsOf(games, now, customTzByIdOf(plain.customEntries));
		const stateFile = remindStatePath();
		const firstRun = !existsSync(stateFile);
		const statePrev = readRemindState(stateFile);
		const { toNotify, stateNext } = remindTickOf(now, items, remindConfigOf(plain), statePrev);
		// 首次运行（还没有状态文件）：只把当前已到档的位置记下来当基线，**不发任何通知**。
		// 否则刚装好就会把积压的所有档位一次性弹出来（用户 2026-10-27 定：不补发首次积压）。
		if (firstRun) {
			writeRemindState(stateFile, stateNext);
			logRemind("round(" + reason + ")：首次运行，建立基线（跳过 " + toNotify.length + " 条已到档条目）");
			return;
		}
		if (!toNotify.length) {
			// 过期键被清掉时才落盘（没变化就别每 30 分钟重写一次文件）
			if (JSON.stringify(statePrev) !== JSON.stringify(stateNext)) writeRemindState(stateFile, stateNext);
			logRemind("round(" + reason + ")：条目 " + items.length + "，本轮无需提醒（状态保留 " + Object.keys(stateNext).length + " 条）");
			return;
		}
		logRemind(
			"round(" + reason + ")：条目 " + items.length + "，本轮提醒 " + toNotify.length + " 条 → "
			+ toNotify.map((notify) => notify.key).join(", ")
		);
		// 通知身份：**每轮只判定一次**（身份状态读 identity.json，毫秒级；只有没缓存时才探测一次）。
		// 身份选择收敛在 notifyToastTargetOf 一处（与设置页「发送测试通知」共用同一个出口），
		// 探测本身永不抛，回退是兜底路径 ⇒ 身份问题绝不能让提醒发不出去。
		const target = await notifyToastTargetOf(plain.notifyName);
		logRemind("通知身份：" + (target.enabled ? target.name + "（AUMID " + NOTIFY_AUMID + "）" : "PowerShell（默认）"));
		const failed = [];
		for (const notify of toNotify) {
			const { title, lines } = remindToastOf(notify, now, target.name);
			const res = await sendToastScript(toastScriptOf(title, lines, target.aumid, target.name));
			logRemind((res.ok ? "送达成功：" : "送达失败（下一轮重试）：") + title + " ｜ " + (res.detail || "(无输出)"));
			if (!res.ok) failed.push(notify.key);
		}
		// 失败的档位**不记已发**：下一轮会重新算出同一个最紧急档，直到成功或 T 过作废。
		for (const key of failed) {
			if (statePrev[key]) stateNext[key] = { fired: [...statePrev[key].fired] };
			else delete stateNext[key];
		}
		writeRemindState(stateFile, stateNext);
	} catch (err) {
		logRemind("本轮异常（不影响下一轮）：" + String((err && err.stack) || err));
	} finally {
		remindRoundRunning = false;
	}
}

/**
 * 注册定时器。
 * 为什么用 `ctx.effect` + 原生 setInterval，而不是 `ctx.setInterval`（cordis-plugin-timer）：
 *   后者要先有 `timer` 服务才存在，而本插件的 inject 只有 webServer —— 为了一条 30 分钟的定时器
 *   多要一个注入依赖，会让"没装 timer 插件的宿主上提醒直接不工作"，不划算。
 *   `ctx.effect` 是 cordis 核心能力：插件卸载 / 改设置触发的重载都会跑到 disposer ⇒ 定时器一定被清掉
 *   （漏清 = 每次改设置就多一个看不见的定时器叠着跑，越用越多次弹窗）。
 */
function registerRemindTimer(ctx, config) {
	ctx.effect(() => {
		const first = setTimeout(() => {
			void runRemindRound(ctx, config, "启动");
		}, REMIND_STARTUP_DELAY_MS);
		const timer = setInterval(() => {
			void runRemindRound(ctx, config, "定时");
		}, REMIND_INTERVAL_MS);
		return () => {
			clearTimeout(first);
			clearInterval(timer);
		};
	}, "gacha-calendar: remind timer");
}
//#endregion

/**
 * Cordis configuration schema for this plugin's persisted settings.
 *
 * 每个字段都标 `.volatile()`：DSH 0.1.7 起设置文档**只投影 volatile 字段**
 * （见 @deepseek-ai/dsh-settings 的 volatileForm/projectForm），未标记的字段
 * 既不进表单、也不接受表单写入。本插件的持久化状态（含 lastData 缓存、
 * lastRefresh、排序、自定义条目）全都要经表单读写，所以必须整份标记。
 * 约束：volatile 字段必须是固定对象路径、外层不能再套 volatile —— 这里全平铺，满足。
 * 用户可见的设置页由 80-components.js 以 settings.section 自带，配合
 * settings.configure({ auto: false }) 抑制自动生成页，故不会把 lastData 这类
 * 运行时状态暴露成输入框。
 */
const Config = z.object({
	autoRefresh: z.boolean().default(true).volatile(),
	refreshMinutes: z.number().min(1).max(60480).default(1440).volatile(),
	// 按钮轮播的总开关（默认开）。与下面的 tickerHours 是两个控件：一个管开不开、一个管范围。
	tickerOn: z.boolean().default(true).volatile(),
	// 按钮轮播的范围（小时）：有卡池/活动在 N 小时内结束或开始，侧栏按钮就轮播。
	// 判定是纯函数 dueKindOf（60-helpers.js），按钮轮播在 80-components.js 的 CalendarPanel 里。
	tickerHours: z.number().default(72).volatile(),
	// 「到期提醒（送达）」的总开关 + 两套节点（**字符串**存，避开 array 值在设置表单里的兼容问题）。
	// 节点解析在 core 的 remindNodesOf（src/client/65-remind.js）：
	//   显式空串 ⇒ 空档（该方向不提醒，设置页把胶囊全点掉就是它）；键缺失 / 内容非法 ⇒ 回落默认。
	// 判定与文案在 core，实际送达在本文件的 registerRemindTimer（30 分钟一轮 + 系统通知）。
	// 设置页 = 总开关 + 两行档位胶囊（结束 / 开始，见 80-components.js 的 remindChipRow）。
	remindOn: z.boolean().default(true).volatile(),
	remindEndNodes: z.string().default("72,24,6,2").volatile(),
	remindStartNodes: z.string().default("24,2").volatile(),
	// 通知身份名（应用名）：默认「二游日历」。决定开始菜单快捷方式的文件名 / Description /
	// 注册表 DisplayName，以及 toast 正文的署名行。空 / 非法 ⇒ 回落默认（清洗在 core 的 notifyNameOf，
	// 默认值必须与 src/client/10-config.js 的 DEFAULT_SETTINGS.notifyName 一致，守卫见 cases-remind.mjs ⑭）。
	notifyName: z.string().default("二游日历").volatile(),
	// 「到期提醒（送达）」的逐游戏白名单（不属于轮播）。普通列表：列表里有谁就提醒谁，
	// 空数组 = 一个都不提醒。出厂默认 = 出厂时展示中的条目（所有 defaultHidden !== true 的 id）。
	// 必须与 src/client/10-config.js 的 DEFAULT_SETTINGS.remindGames 逐项一致（守卫见 test/cases-ticker.mjs）。
	remindGames: z.array(z.string()).default([
		"genshin", "hsr", "zzz", "wuwa", "arknights", "endfield",
		"ba-cn", "ba-global", "ba-jp", "bandori", "wuhuamixin", "zspms", "kedr",
		"uma-cn", "uma-jp", "uma-global",
		"p5x", "nte", "gf2", "fgo", "pjsk", "stellasora", "r1999"
	]).volatile(),
	// 实验特性：新「二游日历」面板视图。**默认开**（2026-10-28 用户定）。
	// 老用户存过 false 的由 migrateNewPanelOnce 一次性迁成 true（迁移标记见下）。
	newPanel: z.boolean().default(true).volatile(),
	// 新面板默认值迁移的**一次性标记**（默认 false ⇒ 未迁移）。宿主 apply 里若它不是 true，
	// 就把 newPanel 与它一起写成 true；之后用户自己在设置页关掉 newPanel 不会再被覆写。
	// 必须 .volatile()（设置文档只投影 volatile 字段），否则写入会被拒。
	newPanelMigrated: z.boolean().default(false).volatile(),
	// 设置页标题行 Star 指引的「已关闭」标记（默认 false = 显示）。用户点标题行右侧的 ✕ 后写 true，
	// 整块 Star 指引永久消失（持久化，重启也在）。必须 .volatile()，否则设置页写了不生效。
	// 读取口径见 core 的 starHintShownOf（src/client/60-helpers.js）：解包 volatile 引用后只有明确 true 才隐藏。
	starHintDismissed: z.boolean().default(false).volatile(),
	order: z.array(z.string()).default([]).volatile(),
	lastRefresh: z.number().default(0).volatile(),
	lastSource: z.string().default("builtin").volatile(),
	lastData: z.string().default("").volatile(),
	// 产出上面那份缓存的插件版本（空 = 首次安装 / 装了本功能之前的旧缓存）。
	// 更新插件后首次启动据此**强制**刷新一次（不看自动刷新开关），判定见 60-helpers.js 的 autoRefreshPlan
	lastVersion: z.string().default("").volatile(),
	hidden: z.array(z.string()).default([]).volatile(),
	// 用户**明确打开**过的条目 id —— 用来覆盖条目的出厂 `defaultHidden`（见 60-helpers.js isEntryHidden）
	shown: z.array(z.string()).default([]).volatile(),
	removed: z.array(z.string()).default([]).volatile(),
	customUrls: z.string().default("{}").volatile(),
	// 每游戏主题色覆盖：{ id: "#rrggbb" }（空 = 用出厂色 / 名字哈希）。设置页每游戏一个取色器写入。
	gameColors: z.string().default("{}").volatile(),
	customEventUrls: z.string().default("{}").volatile(),
	customEntries: z.string().default("[]").volatile()
});

/**
 * 新版「二游日历」面板开关的**一次性迁移**（2026-10-28）。
 *
 * 背景：`newPanel` 的默认值从 false 改成 true，但**已经存过 `newPanel: false` 的老用户**
 * 配置里是显式的 false —— 光改默认值对他们无效。所以启动时做一次迁移：
 *   ① `newPanelMigrated !== true`（= 还没迁过）⇒ 把 `newPanel` 与 `newPanelMigrated`
 *      **在同一笔写入里**都写成 true（同一笔 = 不会出现"标记写了、值没写"的半状态）；
 *   ② 之后用户自己在设置页关掉 `newPanel`，`newPanelMigrated` 仍是 true ⇒ **不会再被覆写**。
 *
 * 写入走宿主侧的 settings 服务（`settings.update(条目 id, patch)`，与设置页表单同一套
 * configEditor 持久化；volatile 字段才允许写）。条目 id 不用写死：`loader.locate(ctx.fiber)`
 * 沿 fiber 链找到本插件在 profile 里的条目 id（写死的 id 一旦被用户改名就永远迁不动）。
 *
 * 失败处理：整段 try/catch —— 迁移失败只是"默认值没变"，**绝不能让插件加载失败**；
 * 失败时记一行日志，下次启动会重试（因为标记还没写进去）。
 */
async function migrateNewPanelOnce(ctx, config, settings) {
	try {
		const cfg = liveConfigOf(ctx, config);
		if (configValueOf(cfg, "newPanelMigrated") === true) return;   // 已迁过：永不再碰
		const loader = ctx.root ? ctx.root.loader : void 0;
		// 等 loader 把所有条目装完再写：settings.update 会走 configEditor 的 profile 补丁写入，
		// 加载中途写容易撞上 "Configuration entry is no longer available"（settings 自己的
		// importLegacyDocument 也是先 await loader 再写）。
		if (loader && typeof loader.await === "function") {
			try { await loader.await(); } catch { /* 等不到就按当前状态继续（写入自己还会校验） */ }
		}
		const ns = loader && typeof loader.locate === "function" ? loader.locate(ctx.fiber) : void 0;
		if (!ns || !settings || typeof settings.update !== "function") {
			logRemind("新面板迁移：定位不到配置条目（id=" + String(ns) + "），跳过（newPanel 保持原值）");
			return;
		}
		await settings.update(ns, { newPanel: true, newPanelMigrated: true });
		logRemind("新面板迁移：条目 " + ns + " 的 newPanel 已一次性写成 true（标记 newPanelMigrated=true）");
	} catch (err) {
		logRemind("新面板迁移失败（不影响插件加载，下次启动重试）：" + String((err && err.stack) || err));
	}
}

/** Required services (host side). */
const inject = ["webServer"];

export function apply(ctx, config = {}) {
	// 「到期提醒（送达）」的定时器：**不依赖任何注入服务**（拿不到 webServer / settings 也要能提醒），
	// 清理交给 ctx.effect 的 disposer（插件卸载、改设置触发的重载都会走到）。
	registerRemindTimer(ctx, config);
	// 启动预热通知身份缓存（见 warmIdentityState）：`identity.json` 不存在或已 stale ⇒ 后台探测一次并写回，
	// 用户第一次打开设置页时它大概率已就绪 ⇒ 直接走毫秒路径。**不 await**（预热不能拖慢插件加载）；
	// 内部整段 try/catch，宿主刚启动 PowerShell 没就绪时只记日志，之后 GET 的兜底探测会再试。
	void warmIdentityState(configValueOf(liveConfigOf(ctx, config), "notifyName"));
	// 抑制「按 schema 自动生成」的设置页：本插件自带 settings.section 页面
	// （80-components.js），自动页会把 lastData 等运行时状态渲染成可编辑输入框。
	// 这是 DSH 官方 README 给自带页面插件的做法；配置读写不受影响。
	// 走可选子级注入：未挂载 settings 服务的主机不会因此起不来。
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
		// 新版面板开关的一次性迁移（见 migrateNewPanelOnce）。**不 await**：apply 不能被
		// 一次配置写入拖慢；内部已 try/catch，失败只记日志。
		void migrateNewPanelOnce(ctx, config, settingsCtx.settings);
	});
	ctx.inject(["webServer"], (injected) => {
		const webServer = injected.get("webServer");
		if (webServer === void 0) return;
		const disposers = [
			webServer.register({ kind: "prefixes", path: PROXY_PREFIX, handler: proxyHandler }),
			// 只读快照：读 `lastData` 的镜像（本机脚本用），不提供任何写设置的能力。
			webServer.register({ kind: "prefixes", path: SNAPSHOT_PREFIX, handler: snapshotHandler }),
			// 通知身份（可选）：GET 读状态 / POST 建删开始菜单快捷方式。见 notifyIdentityHandler。
			// ⚠️ 包一层箭头：这两个 handler 要读设置（应用名 `notifyName`），而 webServer 只给
			//    handler(req, res) —— ctx / config 由 apply 的闭包在这一层递进去。
			webServer.register({
				kind: "prefixes",
				path: NOTIFY_IDENTITY_PREFIX,
				handler: (req, res) => notifyIdentityHandler(req, res, ctx, config)
			}),
			// 发送测试通知：设置页那个按钮点一下弹一条，验证通知链路（不碰提醒状态）。
			webServer.register({
				kind: "prefixes",
				path: NOTIFY_TEST_PREFIX,
				handler: (req, res) => notifyTestHandler(req, res, ctx, config)
			})
		];
		return () => {
			for (const off of disposers) {
				try { if (typeof off === "function") off(); } catch { /* ignore */ }
			}
			// 卸载时清空内存镜像：否则插件重载后会先读到上一轮的旧快照，还白占一份内存。
			snapshot = null;
		};
	});
}

// Config 必须**导出**：cordis loader 把插件的具名导出 `Config` 变成
// `fiber.runtime.Config`，而 DSH 0.1.7 的 settings.describe() 正是靠它
// （entry.fiber.runtime.Config 能不能 toJSON / 能不能投影出 volatile 表单）
// 决定这个条目进不进设置文档。不导出 = 该条目永远不在 describe 列表里，
// 表现是客户端 status 恒为 unavailable、**所有写入被拒**、面板只显示 schema 默认值。
// 这正是 v0.9.41~0.9.43 上机后"设置改不动 + 刷新失败"的根因。
export { Config, inject };
