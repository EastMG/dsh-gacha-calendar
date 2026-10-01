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

		// 直连抓取（不需要代理的源：bwiki / PRTS 等 CORS 放行的站，调用方自行加 origin=* 等参数）。
		// 返回 WHATWG Response 形态的对象（有 ok / status / headers / text() / json()），
		// 各平台据此包装自己的 HTTP 实现即可，调用点无需改动。
		function transportFetchRaw(url, opts) {
			return requireTransport().fetchRaw(url, opts);
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
		async function proxyFetchText(proxyUrl, referer, extraHeaders, body) {
			return requireTransport().fetchViaProxy(proxyUrl, { referer, headers: extraHeaders, body });
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
