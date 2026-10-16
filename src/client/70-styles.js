		//#region styles
		const STYLE = `
			.gacha-cal-btn{display:flex;align-items:center;gap:8px;width:calc(100% + 4px);min-height:42px;padding:0 10px 0 8px;margin:4px -2px;border:none;background:transparent;color:var(--dsw-alias-label-primary);border-radius:12px;font-size:14px;line-height:22px;font-weight:400;cursor:pointer;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-align:left}
			.gacha-cal-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-btn:active{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-btn svg{flex:none;width:16px;height:16px}
			/* 这里曾有一条指向宿主内部 CSS Modules 类名的覆盖：
			 *   .hHd-Xa_footerActions{flex-wrap:wrap;align-content:flex-start;align-items:stretch}
			 * 它来自 v0.9.1「源码恢复」（从手改过的 lib/client.js 回填 src/），**不属于我们的契约**。
			 * dsh-client-ui-sidebar 升级后该类名换成了别的哈希（0.2.0 实装为 l4U6KG_footerActions），
			 * 覆盖静默失效——哈希随构建变，写死它必然迟早断，且断了没有任何提示。
			 * 故删除：页脚动作区的排布交还给宿主，我们只保证自己那个按钮的样式。
			 * 若将来需要影响父容器，请用不依赖哈希的方式（例如容器上的稳定属性）。 */
			/* 只当**定位壳**：卡片外观全部移到 .gacha-cal-sched 上。
			   ⚠️ max-height 必须是 none：实测留成 72vh 时它会**压住** JS 写入的 height
			   （读数 inlineH=899px 而 shell 仍 734）—— 这就是"面板底部空白怎么改都不动"的最后一环。
			   壳高由 JS 按"内容跨度 / 可用空间"写入；卡片（视图）height:100% 铺满它并内部滚动。 */
						/* ⚠️ 这个壳是**新旧两个面板共用**的 —— 改它之前先想清楚另一条分支。
			   旧面板（默认路径）当年就靠这里的三样东西：
			     ① max-height:72vh + overflow:auto —— 限高并滚动（新版不需要 —— 它内部自己滚）；
			     ② background/border/border-radius/box-shadow —— **卡片外观本体**；
			     ③ padding:10px 12px。
			   新版把这些一条条搬到了 .gacha-cal-sched 上（提交 90d6dc8 "把卡片外观从 popover 移到视图"），
			   但那些改动是打在**共用壳**上的 ⇒ 旧面板静默地丢了限高（整表撑到全高 = "爆了"）
			   和背景（字压在后面的聊天内容上 = "看不清字"）。
			   现在按分支给：基础 = 旧面板（限高 + 滚动 + 卡片外观）；新版加 --sched 修饰类改成扁平透明壳
			   （卡片外观由 .gacha-cal-sched 自己给）。 */
			.gacha-cal-pop{position:fixed;z-index:9999;width:690px;height:auto;max-height:72vh;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-primary)}
			.gacha-cal-pop--sched{max-height:none;overflow:visible;background:transparent;border:none;border-radius:0;box-shadow:none;padding:0}
			.gacha-cal-title{font-size:13px;font-weight:600;margin:0 0 4px;display:flex;justify-content:space-between;align-items:center;gap:8px}
			.gacha-cal-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;margin:0 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
			/* flex-basis 用 0（不是 auto）：长文案不会整块掉到下一行，而是留在本行被省略号截断；
			   cursor:help + title 引导用户悬停看逐条原因 */
			.gacha-cal-scrape{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;min-width:0;flex:1 1 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help}
			.gacha-cal-refresh{padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1}
			.gacha-cal-refresh:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-refresh:disabled{opacity:.5;cursor:default}
			.gacha-cal-spin{animation:gacha-cal-rotate 0.8s linear infinite}
			@keyframes gacha-cal-rotate{to{transform:rotate(360deg)}}
			.gacha-cal-row{display:grid;grid-template-columns:22px 96px 1fr 150px 1.3fr 150px;gap:6px;align-items:center;padding:5px 4px;border-bottom:1px solid var(--dsw-alias-border-l1)}
			.gacha-cal-row:last-child{border-bottom:none}
			/* 所有列居中：图标列水平居中，文本列 text-align:center，时间列等宽数字 */
			.gacha-cal-row > *{text-align:center}
			.gacha-cal-row > :first-child{justify-self:center}
			.gacha-cal-row img{width:20px;height:20px;border-radius:5px;object-fit:cover}
			.gacha-cal-name{font-weight:600;white-space:nowrap;overflow:hidden}
			.gacha-cal-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.gacha-cal-cell b{color:var(--dsw-alias-state-business-primary)}
			/* 截断文字悬停自动滚动显示全文（marquee）：
			   统一由 JS 计算超宽与精确距离（gacha-cal-marq + --gacha-marq-d），仅超宽才滚动；
			   面板保持原速 3.5s，设置页单独慢速 6s */
			.gacha-cal-inner{display:inline-block;white-space:nowrap;will-change:transform}
			.gacha-cal-marq .gacha-cal-inner{animation:gacha-cal-marquee 3.5s ease-in-out infinite}
			@keyframes gacha-cal-marquee{0%,10%{transform:translateX(0)}45%,75%{transform:translateX(var(--gacha-marq-d,-80px))}100%{transform:translateX(0)}}
			.gacha-cal-settings-name.gacha-cal-marq .gacha-cal-inner{animation:gacha-cal-marquee-slow 6s ease-in-out infinite}
			@keyframes gacha-cal-marquee-slow{0%,14%{transform:translateX(0)}40%,72%{transform:translateX(var(--gacha-marq-d,-80px))}93%,100%{transform:translateX(0)}}
			/* 时间列（卡池起止/活动起止，第 4/6 列）：等宽数字，不同位数倒计时左右对齐 */
			.gacha-cal-row > :nth-child(4), .gacha-cal-row > :nth-child(6) { font-variant-numeric: tabular-nums }
			.gacha-cal-h{display:grid;grid-template-columns:22px 96px 1fr 150px 1.3fr 150px;gap:6px;align-items:center;padding:6px 4px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px}
			.gacha-cal-h > *{text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			/* 设置页按钮基类＝**长方形文字按钮**（宽度自适、左右留白、字不挤）；
			   只要图标的按钮再加 --icon 修饰类变成方形（见下方）。 */
			.gacha-cal-sort-btn{height:28px;padding:0 11px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary,#4a5261);border-radius:7px;font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;transition:background .12s,color .12s}
			.gacha-cal-sort-btn--icon{width:26px;height:26px;padding:0}
			/* 取色器按钮：原生色块默认撑满整个控件、还自带方形描边 ⇒ 用 swatch 伪元素把它收进来并圆角，
			   让它看起来是"按钮里嵌一枚圆角色标"，而不是一块贴边的色块。 */
			/* 取色器：外框 28×28 + 圆角 9 + 3px 内边距；色块（原生 swatch）**强制铺满内容盒**
			   （width/height:100% + display:block）⇒ 它就没有任何可偏移的空间，各版本 Chromium 都居中。
			   wrapper 的 padding 必须清零，否则会再往里收一圈造成偏心。 */
			.gacha-cal-color{width:28px;height:28px;padding:3px;display:inline-block;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-radius:9px;background:var(--dsw-alias-bg-base);cursor:pointer;overflow:hidden;transition:border-color .12s}
			.gacha-cal-color:hover{border-color:var(--dsw-alias-label-tertiary,#9aa1ab)}
			.gacha-cal-color::-webkit-color-swatch-wrapper{padding:0;margin:0}
			.gacha-cal-color::-webkit-color-swatch{display:block;width:100%;height:100%;border:none;border-radius:6px}
			.gacha-cal-color::-moz-color-swatch{display:block;width:100%;height:100%;border:none;border-radius:6px}
			/* 来源选择器：原生 <select> 的箭头画在右侧，配 textAlign:center 会让文字看着偏左；
			   改成 appearance:none + 自绘 chevron（右侧固定 8px 处），文字左对齐、高度与方形/长方形按钮一致（28）。 */
			.gacha-cal-select{appearance:none;-webkit-appearance:none;height:28px;box-sizing:border-box;padding:0 26px 0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-radius:7px;background-color:var(--dsw-alias-bg-base);background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa1ab' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>");background-repeat:no-repeat;background-position:right 8px center;background-size:12px;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:12px;line-height:26px;text-align:left;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;cursor:pointer;transition:border-color .12s}
			.gacha-cal-select:hover{border-color:var(--dsw-alias-label-tertiary,#9aa1ab)}
			.gacha-cal-sort-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary,#1f2329)}
			.gacha-cal-sort-btn:disabled{opacity:.35;cursor:default}
			.gacha-cal-del-btn{color:#e5484d}
			.gacha-cal-del-btn:hover{background:rgba(229,72,77,.12)}
			/* ══ 实验：新「二游日历」面板视图（settings.newPanel 打开时才渲染，见 80-components.js）══
			 * 设计稿（**唯一真源**）：dsh-gacha-ui-lab/a-v6.html（效果图 a-v6.png）
			 *
			 * 三条**互不抢**的分工 —— 改这里的任何一条颜色/图案前先读它：
			 *   · **颜色 = 游戏**：每行由 JS 内联一个 --g（该游戏代表色，来自 SOURCES 的 color）
			 *     → 同一款游戏的**卡池=深色、活动=浅色**（浅色由 color-mix 与白混出）
			 *   · **图案 = 状态**：实心=在期 / 斜纹=已结束 / 点线=长期 / 空心描边=还没开始 / 灰底=该来源无数据
			 *   · **文字 = 紧迫度**：今天到期 / 还剩 X 天 X 时 / MM-DD HH:MM 开始
			 *     —— 迷你条的**颜色不再表紧迫度**（颜色已让给"认游戏"）
			 *
			 * 颜色一律 --dsw-* 语义令牌 + fallback → 跟随 DSH 的浅/深色，**不写**深色专用色值；
			 * 唯一的字面色是"游戏代表色"（那是数据，不是主题色）。
			 * 尺寸与设计稿对齐：游戏列 158px / 表头刻度与迷你条共用 14 格 / 图标框 26 与 40（图 24 与 38 + 1px 描边）。
			 */
			.gacha-cal-sched{display:flex;flex-direction:column;font-size:12px;overflow-anchor:none;color:var(--dsw-alias-label-primary,#1f2329);--sched-hover-bg:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 90%,rgb(127,127,127) 10%);
				/* 卡片外观从这里给（原来是 .gacha-cal-pop）。
				   align-self:flex-start + flex:none：外层（DSH 侧栏）是 flex 容器、会把它 stretch 到面板高度；
				   height:100% + max-height:none 则让卡片**铺满面板壳**（壳高由 JS 按"内容跨度 / 可用空间"写入）。
				   两者配合：壳内不再留白，长内容在卡片内滚动。 */
				align-self:flex-start;flex:none;box-sizing:border-box;height:100%;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:10px 12px 0;max-height:none;overflow:hidden}
						/* 滚动层：面板本体不滚（overflow:hidden），滚动落在这里 —— 底栏因此在滚动区**之外**，
			   内容在它上沿干净收住；底栏用 flex 自然常驻底部（不再需要 sticky/z-index/不透明底）。 */
			.gacha-cal-sched-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:auto;scrollbar-width:none}
			.gacha-cal-sched-body::-webkit-scrollbar{width:0;height:0}
			.gacha-cal-sched-num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
			/* ① 标题「二游日历」+ 日期胶囊（**没有**总计数胶囊） */
			.gacha-cal-sched-head{display:flex;align-items:center;gap:10px;padding:2px 0 8px}
			.gacha-cal-sched-head h4{margin:0;font-size:15px;font-weight:600;letter-spacing:-.1px}
			.gacha-cal-sched-sp{margin-left:auto;display:flex;gap:6px}
			.gacha-cal-sched-pill{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:11px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));color:var(--dsw-alias-label-secondary,#4a5261)}
			.gacha-cal-sched-pill--live{background:color-mix(in oklab,var(--dsw-alias-state-business-primary,#3b5bfd) 12%,transparent);border-color:transparent;color:var(--dsw-alias-link,#3b5bfd)}
			/* ② 一行总览：今天 N 条到期 · N 条即将开始 · N 条在期 · N 个来源刷新失败 */
			.gacha-cal-sched-glance{display:flex;align-items:center;gap:10px;margin:0 0 6px;font-size:12px;color:var(--dsw-alias-label-secondary,#4a5261);flex-wrap:wrap}
			.gacha-cal-sched-glance b{color:var(--dsw-alias-label-primary,#1f2329);font-weight:500}
			.gacha-cal-sched-warn{color:var(--dsw-alias-state-warn-label,#9a4a06)}
			.gacha-cal-sched-sep{color:var(--dsw-alias-label-tertiary,#6b7280);margin:0 5px}
			/* ③ 「近期」：跨游戏、按紧迫度、**全列出**（不折叠不点开），占左约 64% */
			.gacha-cal-sched-recent{display:flex;gap:10px;margin:10px 0 10px;align-items:stretch}
			.gacha-cal-sched-urgent{flex:0 0 64%;min-width:0}
			/* 右侧虚线空框：用途未定，先留空（设计稿的 .slot） */
			.gacha-cal-sched-slot{flex:1 1 auto;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-radius:12px}
			.gacha-cal-sched-u{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:12px}
			.gacha-cal-sched-u:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
			.gacha-cal-sched-u + .gacha-cal-sched-u{margin-top:1px}
			.gacha-cal-sched-uic{display:inline-flex;flex:0 0 auto;width:26px;height:26px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:7px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}
			.gacha-cal-sched-who{flex:0 0 auto;width:78px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#4a5261);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			/* 图标形状已可辨（星芒 vs 旗帜），收窄后不再显示「卡池/活动」二字（设计稿的取舍） */
			.gacha-cal-sched-what{flex:1 1 auto;min-width:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			/* 「卡池/活动」胶囊：与表头同一套配色（卡池=链接蓝底 / 活动=琥珀底）。
			   ⚠️ 这三条曾被我误删：删图例时用的正则没加词边界，而 .gacha-cal-sched-kind 正好以
			   图例那个 swatch 类的前缀开头 ⇒ 被连带删掉，胶囊外形与配色全丢。
			   教训一：按类名批量删样式必须锚到花括号或方括号，不能用类名前缀。
			   教训二：CSS 模板里绝不能出现反引号（它是模板分隔符，写进注释会直接弄坏 bundle）。 */
			.gacha-cal-sched-kind{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:1px 5px;border-radius:999px;white-space:nowrap}
			.gacha-cal-sched-kind[data-t="gacha"]{color:var(--dsw-alias-link,#3b5bfd);background:color-mix(in oklab,var(--dsw-alias-state-business-primary,#3b5bfd) 10%,transparent)}
			.gacha-cal-sched-kind[data-t="event"]{color:var(--dsw-alias-state-warn-label,#9a4a06);background:color-mix(in oklab,var(--dsw-alias-state-warn-primary,#f5a524) 16%,transparent)}
			/* 时间结论 = 紧迫度。全屏只有这几处用颜色表紧迫度（文字=紧迫度，颜色=游戏，各管一件事） */
			.gacha-cal-sched-when{flex:0 0 auto;font-size:12px;font-weight:500;text-align:right}
			.gacha-cal-sched-when small{font-size:10px;font-weight:500;color:var(--dsw-alias-label-tertiary,#6b7280);margin-left:1px}
			.gacha-cal-sched-u[data-u="1"] .gacha-cal-sched-when{color:var(--dsw-alias-state-error-primary,#b3261e)}
			.gacha-cal-sched-u[data-u="2"] .gacha-cal-sched-when{color:var(--dsw-alias-state-warn-label,#9a4a06)}
			.gacha-cal-sched-u[data-u="wait"] .gacha-cal-sched-when{color:var(--dsw-alias-link,#3b5bfd);font-weight:500}
			/* ④ 游戏表：**没有区块标题**，列表头直接跟在后面；列 = 游戏(158px) / 卡池 / 活动 */
			.gacha-cal-sched-tcap{display:grid;grid-template-columns:158px 1fr 1fr;gap:0 12px;padding:2px 8px 0;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#6b7280)}
			.gacha-cal-sched-th{display:inline-flex;align-items:center;gap:5px;padding-left:9px}
			.gacha-cal-sched-th[data-t="gacha"]{color:var(--dsw-alias-link,#3b5bfd)}
			.gacha-cal-sched-th[data-t="event"]{color:var(--dsw-alias-state-warn-label,#9a4a06)}
			.gacha-cal-sched-tic{width:12px;height:12px;flex:0 0 auto;display:inline-block;vertical-align:-1.5px}
			.gacha-cal-sched-rulerrow{display:grid;grid-template-columns:158px 1fr 1fr;gap:0 12px;padding:0 8px}
			.gacha-cal-sched-ruler{display:grid;grid-template-columns:repeat(14,1fr);gap:1px;margin-top:4px;font-size:8px;color:var(--dsw-alias-label-tertiary,#6b7280);text-align:center}
			.gacha-cal-sched-ruler span[data-today]{color:var(--dsw-alias-label-primary,#1f2329);font-weight:600}
			.gacha-cal-sched-theadline{height:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.25));margin-top:3px}
			/* 一行 = 一款游戏；--g 由 JS 内联（游戏代表色），这里只是拿不到内联值时的兜底 */
			.gacha-cal-sched-trow{--g:var(--dsw-alias-state-business-primary,#3b5bfd);display:grid;grid-template-columns:158px 1fr 1fr;gap:0 12px;padding:9px 8px 10px;align-items:start;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25))}
			/* 行悬停：**不再整行铺浅灰底** —— 悬停该格时底板会向下变长（不透明、面板同色），
			   底板上再落一层灰就变成"外灰内白"的色块（用户 2026-10-15 反馈）。
			   悬停反馈改由两件事承担：① 该格底板展开；② 下面这条只染**游戏名列**的圆角浅灰。 */
			.gacha-cal-sched-trow:hover{background:var(--sched-hover-bg)}
			.gacha-cal-sched-gm{display:flex;align-items:center;gap:11px;min-width:0;align-self:center}
			.gacha-cal-sched-gic{display:inline-flex;flex:0 0 auto;width:40px;height:40px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:11px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}
			.gacha-cal-sched-gn{font-size:13px;font-weight:600;line-height:1.35;letter-spacing:0;white-space:normal;overflow-wrap:break-word;text-wrap:balance}
			/* 一格 = 该游戏的卡池侧或活动侧：**第一条完整三行**（名称 / 档期·状态 / 迷你条），
			   其余条目收在「探头」里（见下面 .gacha-cal-sched-rest）。
			   ⚠️ 层级**不靠 :hover**（那是随时间变化的：向上移鼠标时，上一行刚进入、下一行还没退出，
			   两格会抢层级，导致下一行未收回的字压住上一行正在展开的底板 —— 用户实测反馈）。
			   改为由**行序**决定：行上内联 --z（上面的行更大），格子用它 → 上面永远压得住下面。
			   ⚠️ 禁止：transform 作用于带文字的盒子（会重采样=重影）、max-height 等布局型动画（卡）、
			   阴影/边框/浅灰底（用户要求"一体化"，悬停与收起必须同色）。 */
			.gacha-cal-sched-cell{min-width:0;position:relative;z-index:var(--z,1);border-radius:8px;padding:0 0 4px;
				transition:background .26s cubic-bezier(.4,0,.2,1)}
			.gacha-cal-sched-cell:has(.gacha-cal-sched-rest){padding-bottom:16px}
			/* 悬停底色由所在**行**统一给（同一个 --sched-hover-bg），格子自身不再上色 → 底板与行必然同色 */
			.gacha-cal-sched-item{display:block}
			.gacha-cal-sched-item+.gacha-cal-sched-item{margin-top:7px}
			/* 探头：常驻绝对定位（永不参与文档流 → 格子高度恒定、下面的行一格不动）；
			   收起只露顶部 12px；悬停用 clip-path 揭开并**覆盖**下面各行（合成层动画、不触发布局、不重排文字）。
			   ⚠️ 收起态的盒子必须压成 12px：它是 absolute，盒子高达 1300px+ 时会把滚动容器的 scrollHeight 撑大
			   （真机实测 scrollHeight 3028 vs 内容 2698）→ 滚到底时内容被推上去、下面露出空白。 */
			.gacha-cal-sched-rest{display:block;position:absolute;left:0;right:0;top:calc(100% - 12px);
				box-sizing:border-box;margin:0;padding:2px 10px 12px;pointer-events:none;background:var(--dsw-alias-bg-base);
				clip-path:inset(0 0 calc(100% - 12px) 0);height:12px;overflow:hidden;
				transition:clip-path .42s cubic-bezier(.22,1.2,.28,1)}
			.gacha-cal-sched-rest .gacha-cal-sched-item:first-child{margin-top:3px}
			/* 列与列之间有 12px 网格间隙：底板只贴列的话，越过行之后那条间隙盖不到 → 露白缝。
			   两侧各伸进 6px，并用内边距补回来，内容仍与列对齐；最右侧那一列右边没有间隙，故只伸左边。 */
			.gacha-cal-sched-cell[data-t="gacha"] .gacha-cal-sched-rest{left:-6px;right:-6px;padding-left:6px;padding-right:6px}
			.gacha-cal-sched-cell[data-t="event"] .gacha-cal-sched-rest{left:-6px;right:-8px;padding-left:6px;padding-right:8px}
			/* 虚化只作用在**内容**上：浮层本体绝不能有 opacity（父级 opacity 会让那层底一起变半透明 → 下一行的字透出来） */
			.gacha-cal-sched-rest .gacha-cal-sched-item{opacity:.62;transition:opacity .2s cubic-bezier(.4,0,.2,1)}
			.gacha-cal-sched-cell:hover .gacha-cal-sched-rest{clip-path:inset(0 0 0 0);height:auto;overflow:hidden;pointer-events:auto;z-index:2;
				position:fixed !important;left:var(--rx,0) !important;right:auto !important;top:var(--ry,0) !important;width:var(--rw,auto) !important;margin:0 !important}
			.gacha-cal-sched-cell:hover .gacha-cal-sched-rest .gacha-cal-sched-item{opacity:1}
			/* 底色与遮罩渐变的终点色都挂**行悬停**（不是格子悬停）：整行还灰时底板就必须还是灰，
			   否则指针在同一行里左右移动（或刚离开该格、底板还在收回）时，底板会瞬间变成纯白 = 用户看到的"遮罩还是白的"。 */
			.gacha-cal-sched-trow:hover .gacha-cal-sched-rest{background:var(--sched-hover-bg)}
			.gacha-cal-sched-trow:hover .gacha-cal-sched-rest::after{background:linear-gradient(180deg,transparent,var(--sched-hover-bg))}
			/* 渐隐遮罩：**跟着揭开边缘往下走**；且淡入**不能有延迟**（否则下面一行会被硬边露出来，用户反馈过） */
			.gacha-cal-sched-rest::after{content:"";position:absolute;left:0;right:0;top:5px;height:9px;
				background:linear-gradient(180deg,transparent,var(--dsw-alias-bg-base));
				transition:top .42s cubic-bezier(.22,1.2,.28,1),opacity .18s cubic-bezier(.4,0,.2,1);pointer-events:none}
			.gacha-cal-sched-cell:hover .gacha-cal-sched-rest::after{top:calc(100% - 9px);opacity:0}
			/* 探头里的条目按**各自**的紧迫度着色（格子级 data-u 只管第一条） */
			.gacha-cal-sched-item[data-u="1"] .gacha-cal-sched-cn{color:var(--dsw-alias-state-error-primary,#b3261e);font-weight:600}
			.gacha-cal-sched-item[data-u="1"] .gacha-cal-sched-cm{color:var(--dsw-alias-state-error-primary,#b3261e)}
			.gacha-cal-sched-item[data-u="2"] .gacha-cal-sched-cm{color:var(--dsw-alias-state-warn-label,#9a4a06)}
			.gacha-cal-sched-cell[data-t="gacha"]{--gf:var(--g)}
			.gacha-cal-sched-cell[data-t="event"]{--gf:color-mix(in oklab,var(--g) 42%,#fff)}
			.gacha-cal-sched-cn{font-size:12px;font-weight:400;letter-spacing:.012em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sched-cm{margin-top:1px;font-size:11px;font-weight:400;letter-spacing:.02em;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sched-more{color:var(--dsw-alias-label-secondary,#4a5261)}
			.gacha-cal-sched-cell[data-u="1"] .gacha-cal-sched-cn{color:var(--dsw-alias-state-error-primary,#b3261e);font-weight:600}
			.gacha-cal-sched-cell[data-u="1"] .gacha-cal-sched-cm{color:var(--dsw-alias-state-error-primary,#b3261e)}
			.gacha-cal-sched-cell[data-u="2"] .gacha-cal-sched-cm{color:var(--dsw-alias-state-warn-label,#9a4a06)}
			.gacha-cal-sched-cell--none .gacha-cal-sched-cn{color:var(--dsw-alias-label-tertiary,#6b7280);font-weight:400}
			/* 14 天迷你条：所有行**共用同一根轴**（与表头刻度同列宽）；今天**只有一列** */
			.gacha-cal-sched-tl{display:grid;grid-template-columns:repeat(14,1fr);gap:1px;height:9px;margin-top:5px;position:relative}
			.gacha-cal-sched-tl i{background:color-mix(in oklab,var(--dsw-alias-label-primary,#1f2329) 7%,transparent);border-radius:1.5px}
			.gacha-cal-sched-tl i[data-f]{background:var(--gf,var(--dsw-alias-state-business-primary,#3b5bfd))}
			.gacha-cal-sched-tl i[data-f="done"]{background:repeating-linear-gradient(45deg,color-mix(in oklab,var(--gf,var(--dsw-alias-label-primary,#1f2329)) 45%,transparent) 0 2px,transparent 2px 4px)}
			.gacha-cal-sched-tl i[data-f="long"]{background:repeating-linear-gradient(90deg,color-mix(in oklab,var(--gf,var(--dsw-alias-label-primary,#1f2329)) 55%,transparent) 0 3px,transparent 3px 6px)}
			.gacha-cal-sched-tl[data-state="wait"] i[data-f]{background:transparent;box-shadow:inset 0 0 0 1.5px color-mix(in oklab,var(--dsw-alias-state-business-primary,#3b5bfd) 55%,transparent)}
			/* 今天那一格：**不用竖线**（用户 2026-10-15 要求），改为格子本身上下各加高 3px，与刻度上的今天对齐。
			   设计稿按**格**画（只贯穿迷你条上下各 3px），不跨过上面的事项名文字 —— 跨过去会压在字上。 */
			.gacha-cal-sched-tl i[data-today]{margin-block:-2px;border-radius:2.5px}
			/* ⑤ 图例：颜色认游戏、图案看状态 */
			/* ⑥ 刷新失败横条 + 重试（重试 = 整轮刷新：引擎没有单源刷新接口，见 50-refresh.js） */
			.gacha-cal-sched-failbar{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:11px;color:var(--dsw-alias-state-warn-label,#9a4a06)}
			.gacha-cal-sched-fic{width:12px;height:12px;flex:0 0 auto}
			.gacha-cal-sched-failtext{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sched-retry{flex:0 0 auto;margin-left:6px;padding:0;border:none;background:transparent;font:inherit;color:inherit;cursor:pointer;border-bottom:1px dashed currentColor}
			.gacha-cal-sched-retry:hover{color:var(--dsw-alias-label-primary,#1f2329)}
			.gacha-cal-sched-retry:disabled{opacity:.5;cursor:default}
			/* ⑦ 底部：上次更新 X 分钟前 + 刷新 */
			/* 刷新成功/失败横幅（旧面板 .gacha-cal-scrape 的同款）：文字一行 + 悬停给逐来源明细。
			   常驻在底栏里，所以超宽时省略号截断，明细靠 tooltip。 */
			.gacha-cal-sched-scrape{flex:1 1 auto;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help}
			.gacha-cal-sched-foot{position:relative;flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:3px 0 4px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));font-size:10.5px;color:var(--dsw-alias-label-tertiary,#6b7280)}
			/* 底栏**不要**给 z-index：展开的探头是 position:fixed + z-index:auto，与底栏同层，
			   DOM 靠后的底栏会盖住它 ⇒ 遮罩会糊在展开内容上（用户 2026-10-16 反馈）。
			   正解是给展开的探头 z-index:2（见上面 :hover 那条），**并由探头自己负责"边缘不硬"**（四角圆角 + 投影）：
			   ⚠️ 圆角必须写在**基础态**、且展开时保持 overflow:hidden —— 探头内部有一条 ::after 渐隐带（left/right:0），
			   若展开时改成 overflow:visible，它的方角会露在圆角之外（用户 2026-10-16："四角有方方正正的残影和闪烁"）。
			   四角 12px 圆角 + 柔和投影 ⇒ 它看起来是一块浮层，而不是切在内容上的直角白板。
			   两条已互相打架过一次（把底栏抬到探头之上 ⇒ 内容被糊），别再把两者绑在一起。 */
			/* ── 字体规范（2026-10 定）：中文不上 600+；标题 600、正文 400；中文补字距与行高。
			   字体栈前置 MiSans / HarmonyOS Sans / 思源 / Noto：本机装了就用，没装才落回雅黑。 */
			.gacha-cal-sched{font-family:-apple-system,"SF Pro Text","Segoe UI Variable Text","Segoe UI","MiSans","HarmonyOS Sans SC","Source Han Sans SC","Noto Sans SC","PingFang SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif;
				-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;font-synthesis:none;
				letter-spacing:.012em;line-height:1.45}
			.gacha-cal-sched b,.gacha-cal-sched strong{font-weight:500}
			.gacha-cal-sched-glance,.gacha-cal-sched-tcap,.gacha-cal-sched-foot{letter-spacing:.02em}
			.gacha-cal-sched-when,.gacha-cal-sched-uic,.gacha-cal-sched-when b{font-variant-numeric:tabular-nums}
			/* ── 留白区：「下一个截止」卡 ──
			   大图标当主体；环 = 该档期"已过多少"（环快满 = 快结束了，不用读字）；
			   下面两行是接下来两件，各两行（游戏名一行 / 卡池活动名一行）。 */
			.gacha-cal-sched-slot{box-sizing:border-box;position:relative;min-width:0;display:flex;flex-direction:column;align-self:stretch;padding:12px 13px 11px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:22px;
				background:radial-gradient(120% 90% at 78% 0%,color-mix(in oklab,var(--gc,#888) 24%,transparent) 0%,transparent 62%),
					linear-gradient(180deg,color-mix(in oklab,var(--gc,#888) 10%,var(--dsw-alias-bg-base,#fff)) 0%,var(--dsw-alias-bg-base,#fff) 78%);
				box-shadow:0 1px 2px rgba(0,0,0,.06),0 8px 24px -12px rgba(0,0,0,.22)}
			.gacha-cal-sched-slot--empty{border-style:dashed}
			.gacha-cal-slot-cine{display:grid;grid-template-columns:minmax(0,1fr)}
			.gacha-cal-slot-cine > *{grid-area:1/1}
			.gacha-cal-slot-ring{position:relative;width:132px;height:132px;margin:2px auto 0;flex:0 0 auto}
			.gacha-cal-slot-ring svg{display:block}
			.gacha-cal-slot-track{stroke:color-mix(in oklab,var(--dsw-alias-label-primary,#1f2329) 13%,transparent)}
			.gacha-cal-slot-ic{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
			.gacha-cal-slot-ic > *{width:86px !important;height:86px !important;border-radius:22px !important}
			.gacha-cal-slot-gn{margin-top:11px;text-align:center;font-size:13.5px;font-weight:600;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary,#1f2329)}
			.gacha-cal-slot-days{display:flex;align-items:baseline;justify-content:center;margin-top:1px}
			.gacha-cal-slot-n{font-size:34px;font-weight:600;letter-spacing:-.018em;line-height:1;font-variant-numeric:proportional-nums;color:var(--dsw-alias-label-primary,#1f2329)}
			.gacha-cal-slot-u{margin-left:5px;font-size:12px;font-weight:400;letter-spacing:.04em;color:var(--dsw-alias-label-secondary,#4a5261)}
			.gacha-cal-slot-ttl{box-sizing:border-box;max-width:100%;margin-top:6px;text-align:center;font-size:12.5px;font-weight:400;letter-spacing:.012em;color:var(--dsw-alias-label-secondary,#4a5261);
				white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-slot-sub{margin-top:3px;text-align:center;font-size:10.5px;font-weight:400;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary,#6b7280);
				font-variant-numeric:tabular-nums}
			.gacha-cal-slot-more{position:relative;z-index:2;margin-top:auto;padding-top:8px;border-top:1px solid color-mix(in oklab,var(--dsw-alias-label-primary,#1f2329) 8%,transparent);display:grid;gap:9px}
			.gacha-cal-slot-row{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:8px}
			.gacha-cal-slot-nm{min-width:0;font-size:12.5px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-primary,#1f2329)}
			.gacha-cal-slot-nm b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-slot-nm i{display:block;margin-top:1px;font-style:normal;font-size:11.5px;font-weight:400;letter-spacing:.012em;color:var(--dsw-alias-label-tertiary,#6b7280);
				white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-slot-dd{font-size:10.5px;font-weight:400;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary,#6b7280);font-variant-numeric:tabular-nums}
			.gacha-cal-slot-dd em{font-style:normal;font-weight:600;color:var(--dsw-alias-label-primary,#1f2329)}
			/* ── 留白卡：「按顺序循环」（6 格 / 每格 4 秒 / 24 秒一轮）──
			   背景层硬切（两层交叉淡入会透出杂色），主体层软淡入（文字不闪）。
			   纯 CSS：无定时器、无 state；hover 暂停；prefers-reduced-motion 只留第一条。 */
			.gacha-cal-slot-bg{position:absolute;inset:0;z-index:0;opacity:0;
				background:radial-gradient(120% 90% at 78% 0%,color-mix(in oklab,var(--gc,#888) 24%,transparent) 0%,transparent 62%),
					linear-gradient(180deg,color-mix(in oklab,var(--gc,#888) 10%,var(--dsw-alias-bg-base,#fff)) 0%,var(--dsw-alias-bg-base,#fff) 78%);
				}
			.gacha-cal-slot-bg[data-t="gacha"]{--gc:var(--g)}
			.gacha-cal-slot-bg[data-t="event"]{--gc:color-mix(in oklab,var(--g) 42%,#fff)}
			.gacha-cal-slot-slide{position:relative;z-index:1;opacity:0;transition:opacity .38s cubic-bezier(.4,0,.2,1)}
			.gacha-cal-slot-cine{position:relative;z-index:1}


			/* 悬停暂停由组件处理（useState + 清掉定时器）：停的就是当前那条，它本来就是全不透明，
			   所以不写 :hover 或关键帧 —— 不依赖任何"此刻动画值"，也就不会留下半透明鬼影。 */
			@media (prefers-reduced-motion:reduce){
				.gacha-cal-slot-slide{transition:none}
			}
			.gacha-cal-sched-foot > span{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sched-btn{flex:0 0 auto;margin-left:auto;padding:1px 9px;line-height:1.35;border-radius:999px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));color:var(--dsw-alias-label-secondary,#4a5261);font:inherit;font-size:10.5px;cursor:pointer}
			.gacha-cal-sched-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
			.gacha-cal-sched-btn:disabled{opacity:.5;cursor:default}
			.gacha-cal-sched-empty{padding:12px 8px;text-align:center;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#6b7280)}
			/* ── 「近期」每 4 秒循环换一批（每批 10 条）+「展开全部」──
			   状态与定时都在组件里（useCycle）；这里只负责外观。换页时整批淡入（key 变化触发重挂载）。
			   不做高度动画（避免重排）。 */
			.gacha-cal-sched-more{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:6px;padding:5px 8px;border:none;background:transparent;border-radius:10px;
				font-family:inherit;font-size:11px;font-weight:500;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer;user-select:none}
			.gacha-cal-sched-more:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-secondary,#4a5261)}
			.gacha-cal-sched-page{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#9aa1ab)}
			.gacha-cal-sched-more:focus-visible{outline:2px solid var(--dsw-alias-link,#3b5bfd);outline-offset:2px}
			.gacha-cal-sched-nearpg{animation:gacha-cal-near-in .38s cubic-bezier(.4,0,.2,1) both}
			@keyframes gacha-cal-near-in{from{opacity:0}to{opacity:1}}
			.gacha-cal-slot-row{animation:gacha-cal-near-in .38s cubic-bezier(.4,0,.2,1) both}
			@media (prefers-reduced-motion:reduce){.gacha-cal-sched-nearpg,.gacha-cal-slot-row{animation:none}}
		



			/* 正式修法：面板高度按**内容**取（不再被外部条件撑出空白）。定位调试块删除后，这一条保留。 */
			/* height 单独写过没生效 ⇒ 说明是**被所在容器 stretch 拉伸**（那种情况 height 压不住）。
			   用 !important + align-self:flex-start 双管：高度=内容、且不参与父容器的拉伸。 */


`;
		//#endregion
