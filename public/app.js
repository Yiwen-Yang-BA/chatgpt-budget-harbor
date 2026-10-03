import {
  $,
  escape,
  toast,
  download,
  csv,
  load,
  save,
  init,
  run,
  busy,
  resultMeta,
  fileText,
} from "./ui.js";
import { num, pct, lines } from "./charts.js";
import { reportHTML } from "./reports.js";
let result = null,
  pending = false;
const key = "budget-harbor.v1",
  types = { income: "收入", expense: "支出", transfer: "内部转账" },
  categoryHeaders = [
    "类别",
    "预算",
    "实际支出",
    "预算余额",
    "使用率",
    "是否设预算",
  ];
function lock(on) {
  pending = on;
  document
    .querySelectorAll(
      ".data-layout input,.data-layout textarea,.data-layout select,#sample,#analyze,#add-entry,#save-local,#backup,#mode",
    )
    .forEach((el) => (el.disabled = on));
}
function snapshot() {
  return {
    kind: "budget-harbor",
    version: 1,
    month: $("#month").value,
    currency: $("#currency").value,
    transactionsCsv: $("#transactions").value,
    budgetsCsv: $("#budgets").value,
  };
}
function restore(s) {
  if (
    !s ||
    s.kind !== "budget-harbor" ||
    s.version !== 1 ||
    !["CNY", "USD", "EUR"].includes(s.currency) ||
    typeof s.month !== "string" ||
    s.month.length > 7 ||
    typeof s.transactionsCsv !== "string" ||
    s.transactionsCsv.length > 225000 ||
    typeof s.budgetsCsv !== "string" ||
    s.budgetsCsv.length > 25000
  )
    throw Error("不是有效的 Budget Harbor v1 输入备份");
  $("#month").value = s.month;
  $("#currency").value = s.currency;
  $("#transactions").value = s.transactionsCsv;
  $("#budgets").value = s.budgetsCsv;
}
function sample() {
  restore({
    kind: "budget-harbor",
    version: 1,
    month: "2025-03",
    currency: "CNY",
    transactionsCsv:
      "id,date,type,category,amount,note\nf01,2025-02-05,income,工资,9000,上月示例\nf02,2025-02-06,expense,居住,2500,上月租金\nm01,2025-03-01,income,工资,10000,月度工资\nm02,2025-03-02,expense,居住,3000,租金\nm03,2025-03-04,expense,餐饮,580.50,日常采购\nm04,2025-03-08,expense,餐饮,210.20,周末餐饮\nm05,2025-03-10,expense,交通,120,公共交通\nm06,2025-03-12,transfer,内部转账,2000,自有账户间转账\nm07,2025-03-15,income,奖金,800,项目奖金\nm08,2025-03-20,expense,娱乐,450,本月活动\nm09,2025-03-23,expense,医疗,200,未设置预算的支出",
    budgetsCsv:
      "month,category,amount\n2025-02,居住,2500\n2025-03,居住,3000\n2025-03,餐饮,1000\n2025-03,交通,300\n2025-03,娱乐,400\n2025-03,学习,300",
  });
  $("#entry-date").value = "2025-03-24";
}
function table(headers, rows) {
  return (
    '<table class="data-table"><thead><tr>' +
    headers.map((h) => "<th>" + escape(h) + "</th>").join("") +
    "</tr></thead><tbody>" +
    rows
      .map(
        (row) =>
          "<tr>" +
          row.map((c) => "<td>" + escape(c) + "</td>").join("") +
          "</tr>",
      )
      .join("") +
    "</tbody></table>"
  );
}
function categoryRows() {
  return result.categories.map((c) => [
    c.category,
    num(c.budget),
    num(c.actual),
    num(c.remaining),
    pct(c.utilization),
    c.hasBudget ? "已设置" : "未设置",
  ]);
}
function budgetChart() {
  const items = [...result.categories]
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 20);
  if (!items.length) return '<p class="muted">本月没有支出或预算。</p>';
  const width = 780,
    left = 145,
    right = 130,
    h = items.length * 52 + 45,
    max = Math.max(1, ...items.flatMap((c) => [c.budget, c.actual]));
  return `<svg class="data-chart" viewBox="0 0 ${width} ${h}" role="img" aria-label="分类预算与实际支出"><title>预算与实际支出</title>${items
    .map((c, i) => {
      const y = 15 + i * 52;
      return `<text x="${left - 12}" y="${y + 22}" text-anchor="end" font-size="12" fill="#657e75">${escape(c.category.slice(0, 20))}</text><rect x="${left}" y="${y}" width="${(c.budget / max) * (width - left - right)}" height="13" rx="3" fill="#b0c6bf"/><rect x="${left}" y="${y + 18}" width="${(c.actual / max) * (width - left - right)}" height="13" rx="3" fill="${c.remaining < 0 ? "#b47561" : "#377e75"}"/><text x="${width - right + 12}" y="${y + 10}" font-size="11" fill="#7b9189">${num(c.budget)}</text><text x="${width - right + 12}" y="${y + 29}" font-size="11" fill="#377e75">${num(c.actual)}</text>`;
    })
    .join(
      "",
    )}</svg><div class="chart-legend"><span><i style="background:#b0c6bf"></i>预算</span><span><i style="background:#377e75"></i>实际支出</span><span><i style="background:#b47561"></i>超预算</span></div>${result.categories.length > 20 ? '<p class="hint">图示支出最高的20个类别，完整数据见下表。</p>' : ""}`;
}
function txnRows() {
  return result.transactions.map((t) => [
    t.date,
    types[t.type],
    t.category,
    num(t.amount),
    t.note,
  ]);
}
function render(r) {
  result = { ...r.data, meta: r.meta };
  const s = result.summary;
  $("#metrics").innerHTML = [
    ["本月收入", s.income],
    ["本月支出", s.expense],
    ["本月净流入", s.netCashFlow],
    ["总预算余额", s.budgetRemaining],
  ]
    .map(
      ([label, value]) =>
        `<div class="metric-card"><span>${label} · ${result.settings.currency}</span><strong>${num(value)}</strong></div>`,
    )
    .join("");
  $("#month-label").textContent =
    result.settings.month + " · " + result.settings.currency;
  $("#budget-chart").innerHTML = budgetChart();
  $("#categories").innerHTML = table(categoryHeaders, categoryRows());
  $("#flow-chart").innerHTML = lines(
    [
      {
        name: "累计净流入",
        values: result.daily.map((d) => d.cumulativeNet),
        labels: result.daily.map((d) => d.date),
      },
    ],
    { label: "月内累计净流入" },
  );
  $("#transfer-info").textContent =
    `内部转账 ${num(s.transferVolume)}，共 ${s.transferCount} 笔，均未计入收入、支出或净流入。未预算支出 ${num(s.unbudgetedExpense)}；超预算类别 ${s.overBudgetCount} 个。`;
  $("#transactions-table").innerHTML = table(
    ["日期", "类型", "类别", "金额", "备注"],
    txnRows(),
  );
  $("#warnings").textContent = result.warnings.join("\n");
  $("#meta").innerHTML = resultMeta(r.meta);
  $("#insight").textContent = result.insight;
  $("#exports").hidden = false;
}
$("#sample").onclick = sample;
for (const [id, max] of [
  ["transactions", 225000],
  ["budgets", 25000],
])
  $("#" + id + "-file").onchange = async (e) => {
    if (pending) return;
    lock(true);
    try {
      const f = e.target.files[0];
      if (!f) return;
      if (!/\.csv$/i.test(f.name)) throw Error("请选择 CSV 文件");
      const text = await fileText(f, max * 3);
      if (text.length > max) throw Error(`超过 ${max} 字符限制`);
      $("#" + id).value = text;
    } catch (err) {
      toast(err.message, true);
    } finally {
      e.target.value = "";
      lock(false);
    }
  };
$("#budget-form").onsubmit = async (e) => {
  e.preventDefault();
  if (pending) return;
  lock(true);
  busy($("#analyze"), true, "核对收支与预算…");
  try {
    const s = snapshot();
    render(
      await run({
        transactionsCsv: s.transactionsCsv,
        budgetsCsv: s.budgetsCsv || "month,category,amount",
        month: s.month,
        currency: s.currency,
      }),
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy($("#analyze"), false);
    lock(false);
  }
};
$("#entry-form").onsubmit = (e) => {
  e.preventDefault();
  if (pending) return;
  const base =
      $("#transactions").value.trim() || "id,date,type,category,amount,note",
    fields = base
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/, 1)[0]
      .split(",")
      .map((s) => s.trim().replace(/^"(.*)"$/, "$1")),
    values = {
      id: crypto.randomUUID(),
      date: $("#entry-date").value,
      type: $("#entry-type").value,
      category: $("#category").value.trim(),
      amount: $("#amount").value,
      note: $("#note").value,
    };
  if (
    fields.length !== 6 ||
    new Set(fields).size !== 6 ||
    fields.some((k) => !Object.hasOwn(values, k))
  ) {
    toast("请先核对标准的六列收支表头。", true);
    return;
  }
  const row = fields
      .map((k) => '"' + String(values[k]).replaceAll('"', '""') + '"')
      .join(","),
    text = base + "\n" + row;
  if (text.length > 225000) {
    toast("收支记录超过字符限制", true);
    return;
  }
  $("#transactions").value = text;
  $("#amount").value = "";
  toast("已加入记录，请重新查看本月收支。");
};
$("#save-local").onclick = () => {
  if (save(key, snapshot())) toast("当前输入已保存到此浏览器。");
};
$("#backup").onclick = () =>
  download(
    "budget-backup.json",
    JSON.stringify(snapshot(), null, 2),
    "application/json",
  );
$("#restore").onchange = async (e) => {
  if (pending) return;
  lock(true);
  try {
    const f = e.target.files[0];
    if (!f) return;
    restore(JSON.parse(await fileText(f, 800000)));
    toast("备份已恢复，请重新分析所选月份。");
  } catch (err) {
    toast(err.message, true);
  } finally {
    e.target.value = "";
    lock(false);
  }
};
$("#export-json").onclick = () =>
  result &&
  download(
    "budget-analysis.json",
    JSON.stringify(result, null, 2),
    "application/json",
  );
$("#export-csv").onclick = () =>
  result &&
  download(
    "monthly-transactions.csv",
    csv([
      ["id", "date", "type", "category", "amount", "note"],
      ...result.transactions.map((t) => [
        t.id,
        t.date,
        t.type,
        t.category,
        t.amount,
        t.note,
      ]),
    ]),
    "text/csv;charset=utf-8",
  );
$("#export-html").onclick = () => {
  if (!result) return;
  const s = result.summary;
  download(
    "budget-report.html",
    reportHTML({
      title: "月度收支与预算报告",
      subtitle: `Budget Harbor · ${result.settings.month} · ${result.settings.currency}`,
      metrics: [
        { label: "收入", value: num(s.income) },
        { label: "支出", value: num(s.expense) },
        { label: "净流入", value: num(s.netCashFlow) },
        { label: "预算余额", value: num(s.budgetRemaining) },
      ],
      sections: [
        { title: "分类预算", headers: categoryHeaders, rows: categoryRows() },
        {
          title: "收支记录",
          headers: ["日期", "类型", "类别", "金额", "备注"],
          rows: txnRows(),
        },
        {
          title: "内部转账",
          text: `${s.transferCount} 笔，共 ${num(s.transferVolume)}，均不计入收入或支出。`,
        },
        { title: "解读", text: result.insight },
      ],
      notes: [
        "金额以整数分求和。预算余额可以为负，零预算使用率留空。",
        "净流入和预算余额均不是账户余额，不含银行同步或跨月预算滚存。",
        "CSV对公式形态文本做安全转义；如需原样恢复输入，请使用JSON输入备份。",
        ...result.warnings,
      ],
    }),
    "text/html;charset=utf-8",
  );
};
const saved = load(key, null);
if (saved) {
  try {
    restore(saved);
  } catch {
    toast("已保存输入无法识别，请导入有效备份。", true);
  }
}
await init();
