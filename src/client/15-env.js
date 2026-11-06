		//#region core env（环境注入缝 —— core 零宿主依赖的唯一入口）
		// core（配置 / 来源 / 解析器 / 抓取器 / 刷新 / helpers）里**不允许**直接碰宿主：
		// 不写 window / document / Node API，也不直接 fetch、不直接读时钟。
		// 所有"联网、取当前时间、计时器"一律经过本文件里的 coreEnv，由外壳注入实现：
		//   DSH 插件  → 92-dsh-env.js（transport 走宿主代理 /api/gacha-calendar-proxy）
		//   浏览器扩展 → background 消息转发
		//   Windows / Android / iOS / 鸿蒙 → 各平台原生 HTTP
		// 2b 之后 coreEnv 由 createEngine({ transport, storage, now }) 注入；当前由外壳在加载时 setCoreEnv()。
		let coreEnv = {
			transport: null,
			now: () => Date.now(),
			timer: {
				setTimeout: (fn, ms) => setTimeout(fn, ms),
				clearTimeout: (id) => clearTimeout(id)
			}
		};

		// 外壳注入（可只注入一部分，其余保持默认）
		function setCoreEnv(next) {
			if (!next) return;
			coreEnv = {
				...coreEnv,
				...next,
				timer: { ...coreEnv.timer, ...(next.timer || {}) }
			};
		}

		// 取当前时间（毫秒）。core 里判断"哪一期覆盖当前"必须用这个，不许直接 Date.now()，
		// 这样各平台能注入自己的时钟、也能在测试里固定时间。
		function nowMs() {
			return coreEnv.now();
		}

		function requireTransport() {
			if (!coreEnv.transport) throw new Error("core transport 未注入");
			return coreEnv.transport;
		}

		//#region bwiki 的 CORS 收口点（**全仓唯一**一处给 bwiki 补 origin=*）
		//
		// 为什么需要：bwiki（wiki.biligame.com）的 MediaWiki 接口只有带 `origin=*` 才回
		// `Access-Control-Allow-Origin`。不带它时浏览器**直连**必定被 CORS 拦
		// （`TypeError: Failed to fetch`，上层只能归成「网络不通」这种看不出根因的泛化失败）；
		// 同一 URL 带上 `origin=*` 实测 HTTP 200。此前只有一部分调用点（22-fetcher-core.js 的
		// fetchHtmlText / mkMediaWiki / mkRaw / fetchMediaWikiText）各自临时拼了这一参数，
		// 而仓里 22 处 bwiki 地址常量**本身都没有** —— 于是任何新写的 bwiki 直连都会静默踩坑，
		// 平时只是靠宿主代理（不受 CORS 限制）把问题盖住了。
		//
		// 收口**位置**：本文件下面两个出口 —— `transportFetchRaw`（bwiki 系主机已改走代理，其余直连）
		// 与 `proxyFetchText`（宿主代理）。
		// 全仓的联网只有这两条路（92-dsh-env.js 只是它们的实现，没人绕过这里），所以只在这一处补一次，
		// 22 处常量与将来新增的 bwiki 来源都不必再关心这个参数。
		// 代理路径也一视同仁：代理本身不受 CORS 限制，但 `origin=*` 对 MediaWiki 只是「匿名 CORS 请求」
		// 标记（无害），两条路径发出同一个 URL 才不会出现「直连能跑、代理却是另一串地址」的分叉。

		// 主机名是否属于 biligame（`wiki.biligame.com` 或 `*.biligame.com`）。
		// URL 解析已把主机名小写、端口也已剥掉，这里只需再去掉末尾点（FQDN 写法 `wiki.biligame.com.`）。
		// 用「等于 | 以 `.` 开头的前缀结尾」而不是裸 `endsWith("biligame.com")`：
		// 后者会把 `evilbiligame.com` 也当成自家域名。
		function isBwikiHost(host) {
			const h = String(host == null ? "" : host).trim().toLowerCase().replace(/\.$/, "");
			return h === "biligame.com" || h.endsWith(".biligame.com");
		}

		// bwiki 请求统一补 `origin=*`（幂等）：
		//   · 主机不属于 biligame ⇒ 原样返回（其它站点的 URL 一个字节都不改）
		//   · query 里已有 `origin` 参数（不管值是什么，如 `origin=*` / `origin=https://…`）⇒ 原样返回
		//   · 没有 query（如 `https://wiki.biligame.com/czn/`）⇒ 用 `?`；已有 query ⇒ 用 `&`
		//   · 有 `#hash` ⇒ 补在 hash **之前**（追加到 hash 后面就是纯字符串、根本不进 query）
		//
		// ⚠️ 刻意**不**做 `new URL(...).toString()` 重序列化：那会把中文路径/参数 percent-encode
		//    （`page=限时招集档案` → `page=%E9%99%90…`），而 test/map.json 的夹具键、控制台日志、
		//    来源健康里存的地址都是**原始串**。只解析取主机名，拼接仍在原串上做。
		function withBwikiCors(url) {
			const s = String(url == null ? "" : url);
			let parsed;
			try { parsed = new URL(s); } catch { return url; }   // 相对地址（代理前缀等）/ 非法串 ⇒ 不动
			if (!isBwikiHost(parsed.hostname)) return url;
			if (parsed.searchParams.has("origin")) return url;
			const at = s.indexOf("#");
			const head = at < 0 ? s : s.slice(0, at);
			const tail = at < 0 ? "" : s.slice(at);
			// `...?` / `...&` 结尾时不重复分隔符，避免拼出 `?&origin=*`
			const sep = /[?&]$/.test(head) ? "" : (head.indexOf("?") >= 0 ? "&" : "?");
			return head + sep + "origin=*" + tail;
		}
		//#endregion

		//#region bwiki **必须走宿主代理**（2026-11-07 宿主日志确认的真因）
		//
		// 日志证据（DSH 渲染进程，大量重复）：
		//   [error] Access to fetch at 'https://wiki.biligame.com/sr/api.php?…&origin=*'
		//           from origin 'dsh-app://app' has been blocked by CORS policy:
		//           No 'Access-Control-Allow-Origin' header is present on the requested resource. [renderer]
		//
		// 根因：DSH 页面的源是**自定义 scheme `dsh-app://app`**（不是 http/https）。bwiki（腾讯 EdgeOne 后面）
		// 只对 http(s) 来源回 `Access-Control-Allow-Origin`，对 `dsh-app://app` 这个 Origin **一律不回**
		// → 渲染进程直连必被浏览器 CORS 拦掉；上层只能把它归成「网络不通」，于是表现为"时好时坏"
		// （直连/重试/缓存的抖动，看起来像网络问题，其实一次都没成功过）。
		//
		// ⇒ 上一轮补的 `origin=*`（withBwikiCors）是**必要但不充分**：日志里那条请求本来就带着它，照样被拦。
		//   同一台机器实测对照（2026-11-07）：
		//     · `http://127.0.0.1:49995`（http 源）直连 bwiki + origin=* ⇒ 200 ✓
		//     · 宿主代理 `/api/gacha-calendar-proxy?url=…` ⇒ 200 ✓（星铁卡池 913KB/1.7s、活动 345KB/0.7s）
		//     · `dsh-app://app`（DSH 真实页面源）直连 ⇒ CORS 拦截 ✗
		//
		// 所以：**凡是 biligame 系主机的请求，本出口不再直连，一律改走宿主代理**
		// （`transport.fetchViaProxy` → 请求由宿主 Node 侧发出，压根没有 CORS 这回事；目标站白名单
		//  与 15s 超时由宿主 `src/index.js` 的 proxyHandler 负责）。
		// 刻意**没有**"代理失败就回退直连"的降落伞 —— 那等于把上面这条 CORS 拦路重新接回来。
		// 幂等：`proxyFetchText`（本就走代理）不经过这里，不会被套成"代理套代理"。

		// URL 是否属于 bwiki 系主机（相对地址 / 解析失败 ⇒ 否，交给后续按原样处理）
		function isBwikiUrl(url) {
			try { return isBwikiHost(new URL(String(url)).hostname); } catch { return false; }
		}

		// 把"经代理取回的正文"包成与直连一致的 WHATWG Response 形态（ok / status / headers / text() / json()），
		// 这样 mkMediaWiki / mkRaw / fetchHtmlText / fetchText 这些调用点**一行都不用改**。
		// 只包成功响应：代理层对"目标站非 200"会抛 `proxy-bad:<状态码>`（92-dsh-env.js），
		// normErr 把它归成与直连 `http-<状态码>` **完全相同**的文案（`HTTP 567`），用户看不出通道差异。
		// 同理 json() 保持原生 JSON.parse（解析失败仍是 SyntaxError）—— 与直连路径逐字一致。
		function proxyTextAsResponse(text, url) {
			return {
				ok: true,
				status: 200,
				url,
				headers: { get: () => null },
				text: async () => text,
				json: async () => JSON.parse(text)
			};
		}

		// bwiki 走代理：保留直连时那份 headers（尤其 Referer —— bwiki 对**无 Referer 的裸请求**回 567，
		// 见下面 rawHeaders 的注释）。`Referer` 拆出来单独作为代理的 `referer` 参数（宿主据此设出站
		// Referer，语义与直连一致），其余头（如 `game-alias`）原样透传。
		// `signal` **不转发**：宿主代理本来就不理会 signal（见 50-refresh.js 的 runEntriesWithDeadline，
		// 它自己有"到点即收尾"的兜底），假装支持只会让调用方误判取消语义。
		async function bwikiViaProxy(transport, target, opts) {
			const o = opts || {};
			const src = o.headers || null;
			let referer = "";
			const extra = {};
			let hasExtra = false;
			if (src) {
				for (const k of Object.keys(src)) {
					const v = src[k];
					if (/^referer$/i.test(k)) { if (!referer && typeof v === "string") referer = v; continue; }
					extra[k] = v;
					hasExtra = true;
				}
			}
			const text = await transport.fetchViaProxy(target, { referer, headers: hasExtra ? extra : void 0, body: o.body });
			return proxyTextAsResponse(text, target);
		}
		//#endregion

		// 直连抓取（**非 bwiki** 的源：PRTS / sekai / gametora 等 CORS 放行或宿主不代理的站）。
		// bwiki 的 `origin=*` 由 withBwikiCors 统一补（见上）；**bwiki 系主机改走代理**（见上）。
		// 返回 WHATWG Response 形态的对象（有 ok / status / headers / text() / json()），
		// 各平台据此包装自己的 HTTP 实现即可，调用点无需改动。
		function transportFetchRaw(url, opts) {
			const target = withBwikiCors(url);
			const transport = requireTransport();
			if (isBwikiUrl(target) && typeof transport.fetchViaProxy === "function") {
				// 特性探测而不是 try/catch：非 DSH 环境（core 单测 / 尚未注入代理的原生平台）没有
				// fetchViaProxy 时**保持旧行为（直连）且不抛错**；但代理真的报错时**绝不**回退直连
				// （否则 CORS 拦路又会静默回来，等于这次修复白做）。
				return bwikiViaProxy(transport, target, opts);
			}
			return transport.fetchRaw(target, opts);
		}

		// 直连抓取的统一请求头：Accept + Referer=<目标站>/。
		// 为什么必须带 Referer：bwiki（wiki.biligame.com）已对"无 Referer 的裸请求"返回 **567**（实测：
		// 带 Referer 200；只带 UA 或 Accept 均 567；单给 Origin 无效）。浏览器会自动带上本站 Referer
		// （Referer 是禁止脚本设置的头，浏览器会忽略这里设置的值），所以 DSH 生产路径正常；但
		// Node / 原生运行时不会自动带 → core 包在其它平台会整片 567（原神/星铁/鸣潮活动等 bwiki 源）。
		function rawHeaders(url) {
			const h = { Accept: "application/json" };
			try { h.Referer = new URL(url).origin + "/"; } catch { /* 非法 URL 交由 fetch 报错 */ }
			return h;
		}

		//#region 源站时区（显式建模）
		//
		// **为什么需要**：此前一律用 `new Date(y, mo-1, d, h, mi)` 把源站墙钟时间按**本机时区**
		// 解释。对国内用户（UTC+8）恰好正确，但：
		//   · 海外用户用国服插件 → 绝对时刻偏移（倒计时、"是否在开" 判定会错）
		//   · 日服/国际服与国服混用 → 同一份数据在不同机器上得到不同时刻
		// 现在每个来源显式声明 `tz`（源站墙上时钟所用时区），由这里换算成正确的绝对时刻。
		//
		// **注意**：只改"绝对时刻"，**显示文本仍是源站墙钟原文** —— 玩家看游戏内公告
		// 走的就是那串墙钟时间，改成用户本地时间反而对不上。
		//
		// 表示法与取值（均按 2026-10-01 实测的源站标注确定，见交接文档 §59）：
		//   · IANA 名（`UTC` / `Asia/Shanghai` / `Asia/Tokyo` / `Europe/Berlin` …）—— 支持 DST
		//   · 或固定偏移分钟数（`480` = UTC+8 / `540` = UTC+9 / `0` = UTC）
		//   未声明（`null` / `undefined`）→ **沿用本机时区**（与改造前完全一致，向后兼容）
		const TZ_FMT_CACHE = new Map();
		function tzFormatter(tzName) {
			let f = TZ_FMT_CACHE.get(tzName);
			if (f === void 0) {
				try {
					f = new Intl.DateTimeFormat("en-US", {
						timeZone: tzName, hour12: false,
						year: "numeric", month: "2-digit", day: "2-digit",
						hour: "2-digit", minute: "2-digit", second: "2-digit"
					});
				} catch { f = null; }   // 环境不支持该时区名（ICU 缺失）→ 退化为本机时区
				TZ_FMT_CACHE.set(tzName, f);
			}
			return f;
		}

		// 某时刻在某时区的偏移（分钟，东为正）。IANA 名不可用时返回 null。
		// 做法：先把 ts 当作 UTC 取各字段，再用目标时区渲染同一 ts，两套墙上时钟之差即偏移。
		function tzOffsetMinutesAt(tzName, ts) {
			const f = tzFormatter(tzName);
			if (!f) return null;
			const d = new Date(ts);
			if (isNaN(d.getTime())) return null;
			const parts = f.formatToParts(d);
			const g = (k) => { const p = parts.find((x) => x.type === k); return p ? Number(p.value) : NaN; };
			const h = g("hour") % 24;   // hour12:false 在个别环境对午夜给 24 → 归零
			const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), h, g("minute"), g("second"));
			return (asUTC - (Math.floor(ts / 1000) * 1000)) / 60000;
		}

		// 源站时区表示 → 该时刻的偏移（分钟）。固定数字直接用；IANA 名按 ts 求（含 DST）；无法判定 → null（本机时区）
		function sourceOffsetMinutes(tz, ts) {
			if (tz == null || tz === "") return null;
			if (typeof tz === "number") return Number.isFinite(tz) ? tz : null;
			if (typeof tz === "string") {
				if (/^[+-]?\d+$/.test(tz.trim())) return Number(tz.trim());
				return tzOffsetMinutesAt(tz.trim(), ts);
			}
			return null;
		}

		// 绝对毫秒 → 在**源站时区**下的墙上时钟字段（供"把 ts 渲染回源站墙钟"用）。
		// tz 为 null（或时区名不可用）→ 退化为本机时区字段。
		function sourceWallParts(ts, tz) {
			const d = new Date(ts);
			if (tz == null || tz === "") {
				return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
			}
			if (typeof tz === "string" && !/^[+-]?\d+$/.test(tz.trim())) {
				const f = tzFormatter(tz.trim());
				if (f) {
					const parts = f.formatToParts(d);
					const g = (k) => { const p = parts.find((x) => x.type === k); return p ? Number(p.value) : NaN; };
					return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute") };
				}
				return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
			}
			// 固定偏移（数字或 "+8" 形式）→ 平移后再取 UTC 字段
			const off = sourceOffsetMinutes(tz, ts);
			if (off == null) {
				return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
			}
			const s = new Date(ts + off * 60000);
			return { y: s.getUTCFullYear(), mo: s.getUTCMonth() + 1, d: s.getUTCDate(), h: s.getUTCHours(), mi: s.getUTCMinutes() };
		}

		// 源站墙钟（y-mo-d h:mi）→ 绝对毫秒。tz 为 null 时用本机时区（= 改造前行为）。
		// IANA 名走两遍：先用"把墙钟当 UTC"估一个时刻求偏移，再用该偏移定出真实时刻；
		// 偏移在真实时刻与估计时刻不同（正好跨 DST 边界）时再迭代一次 —— 与 Temporal 的
		// "compatible" 消歧一致，且对游戏源站（多为固定 +8/+9/UTC）根本用不到第二遍。
		function sourceInstant(y, mo, d, h, mi, tz) {
			if (tz == null || tz === "") return new Date(y, mo - 1, d, h, mi).getTime();
			const guess = Date.UTC(y, mo - 1, d, h, mi);
			let off = sourceOffsetMinutes(tz, guess);
			if (off == null) return new Date(y, mo - 1, d, h, mi).getTime();   // 时区名不可用 → 保持原行为
			let ts = guess - off * 60000;
			const off2 = sourceOffsetMinutes(tz, ts);
			if (off2 != null && off2 !== off) ts = guess - off2 * 60000;
			return ts;
		}
		//#endregion


		// 经代理抓取文本（需要绕过 CORS / Referer 反爬的源）。语义与原 host 代理调用完全一致：
		// referer / headers（可选对象）/ body（可选，提供时以 POST + JSON 发出）→ 原始 body 字符串
		// ⚠️ 参数名沿用 `proxyUrl` 是历史命名：它其实是**目标站地址**（宿主代理前缀由 transport 自己拼）。
		//    与 transportFetchRaw 同一个收口点：bwiki 的目标地址在这里补 `origin=*`（见上方 withBwikiCors）。
		async function proxyFetchText(proxyUrl, referer, extraHeaders, body) {
			return requireTransport().fetchViaProxy(withBwikiCors(proxyUrl), { referer, headers: extraHeaders, body });
		}

		// 经代理抓取 JSON。解析失败统一抛 "bad-json"（normErr 会显示成"响应格式异常"），
		// 而不是把原生 SyntaxError 漏出去（那会被归成泛化的"抓取异常"）
		async function proxyFetchJson(proxyUrl, referer, extraHeaders, body) {
			const text = await proxyFetchText(proxyUrl, referer, extraHeaders, body);
			try {
				return JSON.parse(text);
			} catch {
				throw new Error("bad-json");
			}
		}
		//#endregion
