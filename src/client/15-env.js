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

		// 经代理抓取文本（需要绕过 CORS / Referer 反爬的源）。语义与原 host 代理调用完全一致：
		// referer / headers（可选对象）/ body（可选，提供时以 POST + JSON 发出）→ 原始 body 字符串
		async function proxyFetchText(proxyUrl, referer, extraHeaders, body) {
			return requireTransport().fetchViaProxy(proxyUrl, { referer, headers: extraHeaders, body });
		}

		// 经代理抓取 JSON
		async function proxyFetchJson(proxyUrl, referer, extraHeaders, body) {
			return JSON.parse(await proxyFetchText(proxyUrl, referer, extraHeaders, body));
		}
		//#endregion
