// Host-side entry for dsh-gacha-calendar.
// 1) Declares the persisted Config schema the browser half's Settings >
//    二游排期 section reads and writes. DSH 0.1.7 derives the settings document
//    from this schema automatically, so there is nothing to register here.
// 2) Registers a same-origin HTTP proxy route on DSH's webServer so the browser
//    half can fetch external sources that block cross-origin browser requests
//    (CORS / Referer anti-scrape) — the host runs Node fetch with full control
//    over headers, bypassing browser-only restrictions.
import z from "@deepseek-ai/schemastery";

// 设置文档的标识已不再是插件自报的 namespace，而是**本插件在 profile 里的条目 id**
// （`~/.dsh/profiles/<profile>/cordis.patch.yml` 的 `- id: gacha-calendar`）。
// 旧的 settingsNamespace("gacha-calendar") 随 API 一并删除，两边现在只靠这个 id 对齐；
// 浏览器半边的同一字面量在 src/client/10-config.js 的 `NS`。

/** Route prefix owned by this plugin on DSH's webServer. */
const PROXY_PREFIX = "/api/gacha-calendar-proxy";

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
	"api-web.bluearchive.jp"
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
	order: z.array(z.string()).default([]).volatile(),
	lastRefresh: z.number().default(0).volatile(),
	lastSource: z.string().default("builtin").volatile(),
	lastData: z.string().default("").volatile(),
	// 产出上面那份缓存的插件版本（空 = 首次安装 / 装了本功能之前的旧缓存）。
	// 更新插件后首次启动据此**强制**刷新一次（不看自动刷新开关），判定见 60-helpers.js 的 autoRefreshPlan
	lastVersion: z.string().default("").volatile(),
	hidden: z.array(z.string()).default([]).volatile(),
	removed: z.array(z.string()).default([]).volatile(),
	customUrls: z.string().default("{}").volatile(),
	customEventUrls: z.string().default("{}").volatile(),
	customEntries: z.string().default("[]").volatile()
});

/** Required services (host side). */
const inject = ["webServer"];

export function apply(ctx, config = {}) {
	// 抑制「按 schema 自动生成」的设置页：本插件自带 settings.section 页面
	// （80-components.js），自动页会把 lastData 等运行时状态渲染成可编辑输入框。
	// 这是 DSH 官方 README 给自带页面插件的做法；配置读写不受影响。
	// 走可选子级注入：未挂载 settings 服务的主机不会因此起不来。
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
	});
	ctx.inject(["webServer"], (injected) => {
		const webServer = injected.get("webServer");
		if (webServer === void 0) return;
		return webServer.register({
			kind: "prefixes",
			path: PROXY_PREFIX,
			handler: proxyHandler
		});
	});
}

export { inject };
