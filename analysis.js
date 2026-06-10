/* ============================================================
 * analysis.js — 运营分析引擎
 * 职责：
 *   1. CSV 解析与字段映射（中英文表头兼容）
 *   2. 数据聚合（按日 / 按城市）与周期环比统计
 *   3. GMV 指标拆解：GMV = 活跃用户 × 转化率 × 客单价（LMDI 乘法分解）
 *   4. 异常检测：核心指标环比下降超过阈值（默认 10%）即标记
 *   5. AI 运营复盘报告文本生成（基于真实计算结果的模板化生成）
 * ============================================================ */

(function (global) {
  "use strict";

  var ANOMALY_THRESHOLD = -10; // 环比下降超过 10% 视为异常（单位：%）

  /* ---------------- 1. CSV 解析 ---------------- */

  // 表头映射：兼容中文 / 英文 / 常见缩写
  var HEADER_MAP = {
    "日期": "date", "date": "date",
    "城市": "city", "city": "city",
    "gmv": "gmv", "交易额": "gmv",
    "订单量": "orders", "orders": "orders", "订单数": "orders",
    "活跃用户": "activeUsers", "active users": "activeUsers", "activeusers": "activeUsers", "dau": "activeUsers",
    "新增用户": "newUsers", "new users": "newUsers", "newusers": "newUsers",
    "用户转化率": "convRate", "转化率": "convRate", "conversion rate": "convRate", "conversionrate": "convRate",
    "平均客单价": "aov", "客单价": "aov", "average order value": "aov", "averageordervalue": "aov", "aov": "aov",
    "营销补贴成本": "subsidyCost", "补贴成本": "subsidyCost", "subsidy cost": "subsidyCost", "subsidycost": "subsidyCost",
    "利润": "profit", "profit": "profit"
  };

  // 最小化 CSV 行解析（支持引号包裹的字段）
  function splitCSVLine(line) {
    var out = [], cur = "", inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  function normDate(s) {
    s = s.trim().replace(/[./]/g, "-");
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  }

  function parseCSV(text) {
    text = text.replace(/^﻿/, ""); // 去 BOM
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
    if (lines.length < 2) throw new Error("文件内容为空或缺少数据行");

    var headers = splitCSVLine(lines[0]).map(function (h) {
      return HEADER_MAP[h.trim().toLowerCase()] || HEADER_MAP[h.trim()] || null;
    });

    var required = ["date", "city", "gmv", "orders", "activeUsers"];
    var missing = required.filter(function (f) { return headers.indexOf(f) === -1; });
    if (missing.length) {
      throw new Error("缺少必要字段：" + missing.join("、") + "（表头需包含 日期/城市/GMV/订单量/活跃用户 等列）");
    }

    var rows = [], skipped = 0;
    for (var i = 1; i < lines.length; i++) {
      var cells = splitCSVLine(lines[i]);
      var r = {};
      headers.forEach(function (key, idx) {
        if (key) r[key] = (cells[idx] || "").trim();
      });
      var date = normDate(r.date || "");
      if (!date || !r.city) { skipped++; continue; }

      var num = function (v) { return parseFloat(String(v).replace(/[,¥%\s]/g, "")) || 0; };
      var conv = num(r.convRate);
      if (conv > 0 && conv <= 1) conv *= 100; // 兼容 0.034 这种小数形式

      var row = {
        date: date,
        city: r.city,
        gmv: num(r.gmv),
        orders: num(r.orders),
        activeUsers: num(r.activeUsers),
        newUsers: num(r.newUsers),
        convRate: conv || (num(r.activeUsers) ? +(num(r.orders) / num(r.activeUsers) * 100).toFixed(2) : 0),
        aov: num(r.aov) || (num(r.orders) ? +(num(r.gmv) / num(r.orders)).toFixed(2) : 0),
        subsidyCost: num(r.subsidyCost),
        profit: num(r.profit)
      };
      rows.push(row);
    }
    if (!rows.length) throw new Error("未解析到有效数据行，请检查日期与城市列格式");

    rows.sort(function (a, b) {
      return a.date === b.date ? a.city.localeCompare(b.city, "zh") : (a.date < b.date ? -1 : 1);
    });
    return { rows: rows, skipped: skipped };
  }

  /* ---------------- 2. 聚合与环比 ---------------- */

  function uniqueDates(rows) {
    var set = {};
    rows.forEach(function (r) { set[r.date] = 1; });
    return Object.keys(set).sort();
  }

  function uniqueCities(rows) {
    var set = {};
    rows.forEach(function (r) { set[r.city] = 1; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, "zh"); });
  }

  // 按日聚合（可选城市过滤）。转化率 = Σ订单/Σ活跃，客单价 = ΣGMV/Σ订单（加权口径）
  function dailySeries(rows, city) {
    var map = {};
    rows.forEach(function (r) {
      if (city && city !== "all" && r.city !== city) return;
      var d = map[r.date] || (map[r.date] = { date: r.date, gmv: 0, orders: 0, activeUsers: 0, newUsers: 0, subsidyCost: 0, profit: 0 });
      d.gmv += r.gmv; d.orders += r.orders; d.activeUsers += r.activeUsers;
      d.newUsers += r.newUsers; d.subsidyCost += r.subsidyCost; d.profit += r.profit;
    });
    return Object.keys(map).sort().map(function (k) {
      var d = map[k];
      d.convRate = d.activeUsers ? +(d.orders / d.activeUsers * 100).toFixed(2) : 0;
      d.aov = d.orders ? +(d.gmv / d.orders).toFixed(2) : 0;
      return d;
    });
  }

  // 对一段日级数据求周期汇总指标
  function sumPeriod(days) {
    var s = { gmv: 0, orders: 0, activeUsers: 0, newUsers: 0, subsidyCost: 0, profit: 0, days: days.length };
    days.forEach(function (d) {
      s.gmv += d.gmv; s.orders += d.orders; s.activeUsers += d.activeUsers;
      s.newUsers += d.newUsers; s.subsidyCost += d.subsidyCost; s.profit += d.profit;
    });
    s.avgActiveUsers = days.length ? s.activeUsers / days.length : 0; // 日均活跃
    s.convRate = s.activeUsers ? s.orders / s.activeUsers * 100 : 0;
    s.aov = s.orders ? s.gmv / s.orders : 0;
    return s;
  }

  function pct(curr, prev) {
    if (!prev) return null;
    return (curr - prev) / Math.abs(prev) * 100;
  }

  // 周期环比：默认最近 7 天 vs 之前 7 天；数据不足 14 天时对半切分
  function periodCompare(rows, city) {
    var days = dailySeries(rows, city);
    if (days.length < 2) return null;

    var n = days.length;
    var span = n >= 14 ? 7 : Math.floor(n / 2);
    var currDays = days.slice(n - span);
    var prevDays = days.slice(n - span * 2, n - span);

    var curr = sumPeriod(currDays);
    var prev = sumPeriod(prevDays);

    var metrics = ["gmv", "orders", "activeUsers", "newUsers", "convRate", "aov", "subsidyCost", "profit"];
    var wow = {};
    metrics.forEach(function (m) { wow[m] = pct(curr[m], prev[m]); });

    return {
      days: days,
      span: span,
      currRange: [currDays[0].date, currDays[currDays.length - 1].date],
      prevRange: prevDays.length ? [prevDays[0].date, prevDays[prevDays.length - 1].date] : null,
      curr: curr, prev: prev, wow: wow
    };
  }

  /* ---------------- 3. GMV 指标拆解 ---------------- */
  // GMV = 活跃用户 × 转化率 × 客单价
  // 采用 LMDI（对数平均迪氏分解），三因子贡献严格加总等于 GMV 变化量

  function logMean(a, b) {
    if (a === b) return a;
    if (a <= 0 || b <= 0) return (a + b) / 2; // 兜底
    return (a - b) / Math.log(a / b);
  }

  function decomposeGMV(curr, prev) {
    if (!prev || !prev.gmv || !curr.gmv) return null;

    var L = logMean(curr.gmv, prev.gmv);
    var factors = [
      { key: "activeUsers", name: "用户规模（活跃用户）", c: curr.activeUsers, p: prev.activeUsers },
      { key: "convRate", name: "转化效率（转化率）", c: curr.convRate, p: prev.convRate },
      { key: "aov", name: "客单价", c: curr.aov, p: prev.aov }
    ];

    var gmvDelta = curr.gmv - prev.gmv;
    var gmvPct = pct(curr.gmv, prev.gmv);

    var items = factors.map(function (f) {
      var change = pct(f.c, f.p);                          // 因子自身变化 %
      var contribAbs = (f.c > 0 && f.p > 0) ? L * Math.log(f.c / f.p) : 0; // 对 GMV 的绝对贡献
      return {
        key: f.key, name: f.name,
        change: change,
        contribAbs: contribAbs,
        contribPct: prev.gmv ? contribAbs / prev.gmv * 100 : 0 // 占上期 GMV 的百分点
      };
    });

    // 主导因子：绝对贡献最大者
    var main = items.reduce(function (a, b) {
      return Math.abs(b.contribAbs) > Math.abs(a.contribAbs) ? b : a;
    });

    return { gmvDelta: gmvDelta, gmvPct: gmvPct, items: items, main: main };
  }

  /* ---------------- 4. 异常检测 ---------------- */

  var METRIC_DEFS = [
    { key: "gmv", name: "GMV" },
    { key: "orders", name: "订单量" },
    { key: "activeUsers", name: "活跃用户" },
    { key: "convRate", name: "转化率" },
    { key: "profit", name: "利润" }
  ];

  // 针对单个城市某指标的异常，生成原因假设与优化建议（结合同城市其他指标联动判断）
  function diagnose(metricKey, city, cmp) {
    var w = cmp.wow;
    var reasons = [], actions = [];
    var add = function (arr, txt) { if (arr.indexOf(txt) === -1) arr.push(txt); };

    var auDown = w.activeUsers !== null && w.activeUsers < -3;
    var convDown = w.convRate !== null && w.convRate < -3;
    var aovDown = w.aov !== null && w.aov < -3;
    var subDown = w.subsidyCost !== null && w.subsidyCost < -8;
    var subUp = w.subsidyCost !== null && w.subsidyCost > 15;
    var newDown = w.newUsers !== null && w.newUsers < -8;

    if (metricKey === "gmv" || metricKey === "orders") {
      if (auDown) add(reasons, "用户活跃规模下降（环比 " + fmtPct(w.activeUsers) + "），大盘流量收缩");
      if (convDown) add(reasons, "转化率走低（环比 " + fmtPct(w.convRate) + "），转化链路可能存在体验或供给问题");
      if (subDown) add(reasons, "营销补贴投入收缩（环比 " + fmtPct(w.subsidyCost) + "），价格激励减弱");
      if (aovDown) add(reasons, "客单价下滑（环比 " + fmtPct(w.aov) + "），订单结构向低价品类迁移");
      add(reasons, "外部因素：竞对加大补贴 / 天气与节假日等市场环境变化");

      if (auDown) add(actions, "针对沉默 / 流失用户设计召回策略（Push、券包、场景化触达）");
      if (convDown) add(actions, "拆分新老客与各漏斗环节转化，定位流失最严重的链路节点并优化");
      if (subDown) add(actions, "评估补贴 ROI，向高敏感、高潜力用户群定向恢复激励投放");
      add(actions, "对标竞对动作与本地市场变化，输出针对性的城市运营打法");
    }

    if (metricKey === "activeUsers") {
      if (newDown) add(reasons, "新增用户下滑（环比 " + fmtPct(w.newUsers) + "），拉新渠道投放或转化效率减弱");
      add(reasons, "存量用户留存恶化，活跃频次降低");
      if (subDown) add(reasons, "补贴退坡后价格敏感型用户活跃度下降");
      add(actions, "复盘各拉新渠道 CAC 与质量，向高 ROI 渠道倾斜预算");
      add(actions, "搭建用户分层运营体系，对临近流失用户提前干预");
      add(actions, "通过签到、会员任务等机制提升用户活跃频次");
    }

    if (metricKey === "convRate") {
      add(reasons, "转化链路存在问题：页面体验、供给丰富度或履约时效恶化");
      if (subDown) add(reasons, "补贴 / 优惠力度减弱，下单决策动力不足");
      add(reasons, "新增流量占比上升摊薄整体转化（新客转化通常低于老客）");
      add(actions, "按 曝光→点击→下单→支付 拆解漏斗，定位转化损失最大环节");
      add(actions, "分析新老客 / 不同客群的转化差异，制定分群运营策略");
      add(actions, "进行价格力与供给盘点，补齐高需求低供给品类");
    }

    if (metricKey === "profit") {
      if (subUp) add(reasons, "营销补贴成本大幅上升（环比 " + fmtPct(w.subsidyCost) + "），投放效率下降");
      if (w.gmv !== null && w.gmv < -3) add(reasons, "GMV 收缩导致毛利盘子变小");
      if (aovDown) add(reasons, "客单价下降摊薄单均毛利");
      add(reasons, "高补贴低毛利订单占比上升，订单结构恶化");
      add(actions, "按用户分层 / 品类拆解补贴 ROI，砍掉低效补贴，向增量用户集中");
      add(actions, "优化券面额与门槛设计，用满减门槛带动客单价提升");
      add(actions, "建立利润预警机制，按城市设定补贴率上限");
    }

    return { reasons: reasons.slice(0, 4), actions: actions.slice(0, 4) };
  }

  // 扫描：城市 × 核心指标，环比下降超阈值 → 异常
  function detectAnomalies(rows) {
    var cities = uniqueCities(rows);
    var list = [];

    cities.forEach(function (city) {
      var cmp = periodCompare(rows, city);
      if (!cmp || !cmp.prevRange) return;

      METRIC_DEFS.forEach(function (m) {
        var change = cmp.wow[m.key];
        if (change === null || change >= ANOMALY_THRESHOLD) return;

        var diag = diagnose(m.key, city, cmp);
        list.push({
          city: city,
          metricKey: m.key,
          metricName: m.name,
          change: change,
          severity: change <= -20 ? "danger" : "warn",
          curr: cmp.curr[m.key],
          prev: cmp.prev[m.key],
          gmvShare: null, // 由调用方按全局 GMV 填充
          reasons: diag.reasons,
          actions: diag.actions
        });
      });
    });

    list.sort(function (a, b) { return a.change - b.change; });
    return list;
  }

  /* ---------------- 5. 格式化工具 ---------------- */

  function fmtNum(v) {
    if (v === null || v === undefined || isNaN(v)) return "-";
    return Math.round(v).toLocaleString("en-US");
  }

  function fmtMoney(v) {
    if (v === null || v === undefined || isNaN(v)) return "-";
    var neg = v < 0 ? "-" : "";
    v = Math.abs(v);
    if (v >= 1e8) return neg + (v / 1e8).toFixed(2) + " 亿";
    if (v >= 1e4) return neg + (v / 1e4).toFixed(1) + " 万";
    return neg + Math.round(v).toLocaleString("en-US");
  }

  function fmtPct(v, signed) {
    if (v === null || v === undefined || isNaN(v)) return "-";
    var s = (v > 0 ? "+" : "") + v.toFixed(1) + "%";
    return signed === false ? Math.abs(v).toFixed(1) + "%" : s;
  }

  /* ---------------- 6. AI 复盘报告生成 ---------------- */

  function generateReport(rows) {
    var cmp = periodCompare(rows, "all");
    if (!cmp || !cmp.prevRange) return "数据周期不足，无法生成环比分析报告。请上传至少覆盖两个周期的数据。";

    var w = cmp.wow, c = cmp.curr, p = cmp.prev;
    var decomp = decomposeGMV(c, p);
    var anomalies = detectAnomalies(rows);
    var cities = uniqueCities(rows);

    // 城市维度表现排序（按 GMV 环比）
    var cityPerf = cities.map(function (city) {
      var cc = periodCompare(rows, city);
      return { city: city, gmvPct: cc && cc.wow.gmv !== null ? cc.wow.gmv : 0, gmv: cc ? cc.curr.gmv : 0 };
    }).sort(function (a, b) { return b.gmvPct - a.gmvPct; });
    var best = cityPerf[0], worst = cityPerf[cityPerf.length - 1];

    var dir = function (v) { return (v === null || Math.abs(v) < 0.5) ? "基本持平" : (v > 0 ? "上涨" : "下降"); };
    var arrow = function (v) { return (v === null || Math.abs(v) < 0.5) ? "" : (v > 0 ? "↑" : "↓"); };

    var lines = [];
    lines.push("# " + cmp.currRange[0] + " ~ " + cmp.currRange[1] + " 运营复盘报告");
    lines.push("@ 分析范围：" + cities.length + " 个城市 ｜ 对比周期：" + cmp.prevRange[0] + " ~ " + cmp.prevRange[1] + " ｜ 由 Operations Insight Copilot 自动生成");

    // 业务概况
    lines.push("## 【业务概况】");
    lines.push("本周期大盘整体" + (w.gmv >= 0 ? "保持增长态势" : "承压") + "。核心指标表现：GMV " + fmtMoney(c.gmv) +
      "（环比 " + fmtPct(w.gmv) + "），订单量 " + fmtNum(c.orders) + " 单（环比 " + fmtPct(w.orders) +
      "），日均活跃用户 " + fmtNum(c.avgActiveUsers) + "（环比 " + fmtPct(w.activeUsers) +
      "），整体转化率 " + c.convRate.toFixed(2) + "%（环比 " + fmtPct(w.convRate) +
      "），实现利润 " + fmtMoney(c.profit) + "（环比 " + fmtPct(w.profit) + "）。");
    lines.push("城市维度分化明显：" + best.city + "表现最优（GMV 环比 " + fmtPct(best.gmvPct) + "），" +
      worst.city + "压力最大（GMV 环比 " + fmtPct(worst.gmvPct) + "），需要重点关注。");

    // 关键变化
    lines.push("## 【关键变化】");
    lines.push("- GMV：" + fmtMoney(c.gmv) + "，环比" + dir(w.gmv) + " " + fmtPct(w.gmv, false) + " " + arrow(w.gmv) +
      "；客单价 " + c.aov.toFixed(1) + " 元（环比 " + fmtPct(w.aov) + "）。");
    lines.push("- 订单：" + fmtNum(c.orders) + " 单，环比" + dir(w.orders) + " " + fmtPct(w.orders, false) + " " + arrow(w.orders) + "。");
    lines.push("- 用户：日均活跃 " + fmtNum(c.avgActiveUsers) + "，环比" + dir(w.activeUsers) + " " + fmtPct(w.activeUsers, false) +
      "；新增用户 " + fmtNum(c.newUsers) + "，环比 " + fmtPct(w.newUsers) + "。");
    lines.push("- 成本与利润：补贴成本 " + fmtMoney(c.subsidyCost) + "（环比 " + fmtPct(w.subsidyCost) +
      "），补贴率 " + (c.gmv ? (c.subsidyCost / c.gmv * 100).toFixed(1) : "-") + "%；利润 " + fmtMoney(c.profit) +
      "（环比 " + fmtPct(w.profit) + "）。");

    // 问题诊断
    lines.push("## 【问题诊断】");
    if (anomalies.length === 0) {
      lines.push("本周期未检出环比降幅超过 " + Math.abs(ANOMALY_THRESHOLD) + "% 的异常指标，整体经营健康度良好。");
    } else {
      lines.push("系统共检出 " + anomalies.length + " 项异常（环比降幅超 " + Math.abs(ANOMALY_THRESHOLD) + "%），按严重程度排序：");
      anomalies.slice(0, 5).forEach(function (a, i) {
        lines.push("- " + (i + 1) + ". " + a.city + " " + a.metricName + "环比下降 " + Math.abs(a.change).toFixed(1) + "%" +
          (a.severity === "danger" ? "（严重）" : "（中度）"));
      });
      if (anomalies.length > 5) lines.push("- 其余 " + (anomalies.length - 5) + " 项详见「异常诊断」页。");
    }

    // 原因分析（基于指标拆解）
    lines.push("## 【原因分析】");
    if (decomp) {
      var di = {};
      decomp.items.forEach(function (it) { di[it.key] = it; });
      lines.push("按 GMV = 活跃用户 × 转化率 × 客单价 拆解，本周期 GMV " + dir(decomp.gmvPct) + " " +
        fmtPct(decomp.gmvPct, false) + " 中：用户规模变化贡献 " + fmtPct(di.activeUsers.contribPct) +
        "，转化效率变化贡献 " + fmtPct(di.convRate.contribPct) +
        "，客单价变化贡献 " + fmtPct(di.aov.contribPct) + "。");
      lines.push("核心结论：本周期 GMV 变化主要由「" + decomp.main.name + "」驱动（自身环比 " +
        fmtPct(decomp.main.change) + "）。" +
        (decomp.main.contribAbs < 0 ? "该因子的恶化是大盘最主要的拖累项，应作为下周期第一优先级解决。"
                                     : "该因子是大盘增长的主要引擎，建议持续加码并复制经验。"));
      var worstAno = anomalies[0];
      if (worstAno) {
        lines.push("结合城市粒度看，" + worstAno.city + "的" + worstAno.metricName + "恶化幅度最大，可能原因包括：" +
          worstAno.reasons.slice(0, 3).join("；") + "。");
      }
    } else {
      lines.push("当前数据不足以完成因子拆解。");
    }

    // 优化策略
    lines.push("## 【优化策略】");
    var strategies = [];
    if (w.convRate !== null && w.convRate < -3) {
      strategies.push("转化提效：按「曝光→点击→下单→支付」拆解漏斗，重点城市（如 " + worst.city + "）单独归因，本周内输出转化损失 Top3 环节与整改方案。");
    }
    if (w.activeUsers !== null && w.activeUsers < -3) {
      strategies.push("用户召回：圈选近 30 天沉默用户，分层匹配召回权益（券包 / 免配送费 / 专属价），并以 7 日回访率作为核心验收指标。");
    }
    if (w.subsidyCost !== null && w.subsidyCost > 10 && w.profit !== null && w.profit < 0) {
      strategies.push("补贴提效：对补贴率异常城市做 ROI 审计，砍掉对存量高频用户的无效补贴，预算向新客转化与流失召回场景集中。");
    }
    strategies.push("标杆复制：拆解 " + best.city + " 增长动作（供给、补贴结构、活动节奏），形成 SOP 在同类型城市灰度复制。");
    strategies.push("机制建设：将本报告的异常阈值（环比 -10%）沉淀为日级监控告警，异常发生当日即触达对应城市运营负责人，避免问题在周报中才暴露。");
    if (strategies.length < 4) {
      strategies.push("精细化运营：建立「城市 × 用户分层」双维度运营矩阵，针对高价值用户做留存深耕，针对价格敏感用户做精准补贴。");
    }
    strategies.slice(0, 5).forEach(function (s, i) { lines.push("- " + (i + 1) + ". " + s); });

    return lines.join("\n");
  }

  global.Analysis = {
    ANOMALY_THRESHOLD: ANOMALY_THRESHOLD,
    parseCSV: parseCSV,
    uniqueDates: uniqueDates,
    uniqueCities: uniqueCities,
    dailySeries: dailySeries,
    periodCompare: periodCompare,
    decomposeGMV: decomposeGMV,
    detectAnomalies: detectAnomalies,
    generateReport: generateReport,
    fmtNum: fmtNum, fmtMoney: fmtMoney, fmtPct: fmtPct
  };

})(window);
