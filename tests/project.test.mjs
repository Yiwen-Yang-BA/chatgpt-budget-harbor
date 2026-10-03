import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../project.mjs";
import { ValidationError } from "../lib/validate.mjs";

const th = "id,date,type,category,amount,note",
  bh = "month,category,amount";
const defaults = {
  transactionsCsv: `${th}\ni1,2024-02-01,income,工资,1000,\ne1,2024-02-02,expense,餐饮,100,\ne2,2024-02-03,expense,交通,50,\nt1,2024-02-04,transfer,内部转账,500,`,
  budgetsCsv: `${bh}\n2024-02,餐饮,200`,
  month: "2024-02",
  currency: "CNY",
};
const demo = { generate: async (spec) => spec.demo() };

test("integer cents make 0.10 plus 0.20 exactly 0.30", async () => {
  const result = await run(
    {
      ...defaults,
      transactionsCsv: `${th}\na,2024-02-01,expense,食物,0.10,\nb,2024-02-01,expense,食物,0.20,`,
      budgetsCsv: `${bh}\n2024-02,食物,0.30`,
    },
    demo,
  );
  assert.equal(result.summary.expense, 0.3);
  assert.equal(result.summary.budgetRemaining, 0);
  assert.equal(result.categories[0].actual, 0.3);
  assert.equal(result.categories[0].utilization, 1);
  assert.equal(result.daily[0].netCashFlow, -0.3);
});

test("income and expenses produce net 850 while a transfer stays outside budgets and net flow", async () => {
  const result = await run(defaults, demo);
  assert.equal(result.summary.income, 1000);
  assert.equal(result.summary.expense, 150);
  assert.equal(result.summary.netCashFlow, 850);
  assert.equal(result.summary.transferVolume, 500);
  assert.equal(result.summary.transferCount, 1);
  assert.equal(result.summary.budgetRemaining, 50);
  assert.equal(result.summary.transactionCount, 4);
  assert.equal(result.daily[3].netCashFlow, 0);
  assert.equal(result.daily.at(-1).cumulativeNet, 850);
  assert.ok(
    result.categories.every(
      (item) => !["工资", "内部转账"].includes(item.category),
    ),
  );
});

test("missing, zero and unused budgets remain distinguishable with zero-denominator nulls", async () => {
  const result = await run(
    { ...defaults, budgetsCsv: `${bh}\n2024-02,餐饮,0\n2024-02,书籍,50` },
    demo,
  );
  const food = result.categories.find((item) => item.category === "餐饮"),
    transport = result.categories.find((item) => item.category === "交通");
  assert.equal(food.hasBudget, true);
  assert.equal(food.utilization, null);
  assert.equal(transport.hasBudget, false);
  assert.equal(transport.budget, 0);
  assert.equal(result.summary.unbudgetedExpense, 50);
  assert.equal(result.summary.overBudgetCount, 2);
  assert.equal(result.summary.budgetRemaining, -100);
  assert.equal(
    result.categories.find((item) => item.category === "书籍").remaining,
    50,
  );
});

test("full-month calendars handle leap years and filter transactions and budgets by month", async () => {
  const result = await run(
    {
      ...defaults,
      transactionsCsv:
        defaults.transactionsCsv +
        "\nl1,2024-02-29,expense,餐饮,1,\nm1,2024-03-01,income,工资,200,",
      budgetsCsv: defaults.budgetsCsv + "\n2024-01,餐饮,10",
    },
    demo,
  );
  assert.equal(result.daily.length, 29);
  assert.equal(result.daily.at(-1).date, "2024-02-29");
  assert.equal(result.summary.income, 1000);
  assert.deepEqual(result.months, ["2024-01", "2024-02", "2024-03"]);
  for (const [month, days] of [
    ["1900-02", 28],
    ["2000-02", 29],
    ["2100-02", 28],
  ]) {
    const empty = await run(
      { ...defaults, month, transactionsCsv: th, budgetsCsv: bh },
      demo,
    );
    assert.equal(empty.daily.length, days);
  }
});

test("canonical duplicates are ignored but conflicts including different notes are rejected", async () => {
  const transactionsCsv = `${th}\na,2024-02-01,expense, 餐饮 ,01.20,相同备注\na,2024-02-01,expense,餐饮,1.2,相同备注\nb,2024-02-01,expense,餐饮,1.20,相同备注`;
  const result = await run({ ...defaults, transactionsCsv }, demo);
  assert.equal(result.summary.expense, 2.4);
  assert.equal(result.summary.transactionCount, 2);
  assert.equal(result.summary.duplicateRowsIgnored, 1);
  assert.equal(result.transactions[0].category, "餐饮");
  await assert.rejects(
    run(
      {
        ...defaults,
        transactionsCsv:
          transactionsCsv + "\na,2024-03-01,expense,餐饮,1.2,相同备注",
      },
      demo,
    ),
    /冲突/,
  );
  await assert.rejects(
    run(
      {
        ...defaults,
        transactionsCsv:
          transactionsCsv + "\na,2024-02-01,expense,餐饮,1.2,不同备注",
      },
      demo,
    ),
    /冲突/,
  );
});

test("strict decimal money rejects unsupported formats, zero transactions and excess amounts", async () => {
  for (const value of [
    "0",
    "-1",
    "+1",
    ".5",
    "1.",
    "1e2",
    "1.001",
    "1000000000.01",
    '"1,000"',
    "NaN",
  ]) {
    await assert.rejects(
      run(
        {
          ...defaults,
          transactionsCsv: `${th}\na,2024-02-01,expense,食物,${value},`,
        },
        demo,
      ),
      ValidationError,
    );
  }
  const maximum = await run(
    {
      ...defaults,
      transactionsCsv: `${th}\na,2024-02-01,income,工资,1000000000.00,`,
      budgetsCsv: bh,
    },
    demo,
  );
  assert.equal(maximum.summary.income, 1e9);
  const excess =
    `${th}\n` +
    Array.from(
      { length: 1001 },
      (_, i) => `a${i},2024-02-01,income,工资,1000000000,`,
    ).join("\n");
  await assert.rejects(
    run({ ...defaults, transactionsCsv: excess }, demo),
    /累计金额/,
  );
});

test("strict columns, ids, real dates, duplicate budgets and currency are checked", async () => {
  for (const invalid of [
    { currency: "JPY" },
    { month: "2024-13" },
    { month: "0000-02" },
    {
      transactionsCsv: defaults.transactionsCsv.replace(
        "2024-02-01",
        "2023-02-29",
      ),
    },
    { transactionsCsv: defaults.transactionsCsv.replace("i1,", "bad id,") },
    { transactionsCsv: defaults.transactionsCsv.replace(th, th + ",account") },
    { budgetsCsv: `${bh}\n2024-02,餐饮,1\n2024-02, 餐饮 ,2` },
  ])
    await assert.rejects(
      run({ ...defaults, ...invalid }, demo),
      ValidationError,
    );
  const reordered = await run(
    {
      ...defaults,
      transactionsCsv:
        "note,amount,category,type,date,id\n,1,食物,expense,2024-02-01,a",
      budgetsCsv: "amount,category,month\n2,食物,2024-02",
    },
    demo,
  );
  assert.equal(reordered.summary.budgetRemaining, 1);
});

test("empty ledgers still return a complete zero calendar and may have budgets only", async () => {
  const empty = await run(
    { ...defaults, month: "2024-01", transactionsCsv: th, budgetsCsv: bh },
    demo,
  );
  assert.equal(empty.daily.length, 31);
  assert.ok(
    empty.daily.every(
      (item) =>
        item.income === 0 && item.expense === 0 && item.cumulativeNet === 0,
    ),
  );
  assert.deepEqual(empty.categories, []);
  assert.deepEqual(empty.transactions, []);
  assert.deepEqual(empty.months, []);
  assert.equal(empty.summary.netCashFlow, 0);
  const budgetOnly = await run({ ...defaults, transactionsCsv: th }, demo);
  assert.equal(budgetOnly.summary.budgetRemaining, 200);
});

test("selected transactions sort by date and retain original same-day order", async () => {
  const result = await run(
    {
      ...defaults,
      transactionsCsv: `${th}\nc,2024-02-03,expense,食物,1,第三天\na,2024-02-01,expense,食物,2,先出现\nb,2024-02-01,expense,食物,3,后出现\nz,2024-03-01,expense,食物,4,跨月`,
    },
    demo,
  );
  assert.deepEqual(
    result.transactions.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.equal(result.summary.expense, 6);
  assert.equal(result.transactions[0].note, "先出现");
});

test("model receives only settings, summary and categories, excluding private transaction details", async () => {
  let observed;
  const result = await run(
    {
      ...defaults,
      transactionsCsv:
        defaults.transactionsCsv +
        "\nPRIVATE_ID,2024-02-05,expense,餐饮,1,PRIVATE_NOTE",
    },
    {
      generate: async (spec) => {
        observed = spec;
        return { text: "仅解释本月汇总。" };
      },
    },
  );
  const input = JSON.parse(observed.input);
  assert.deepEqual(Object.keys(input), ["settings", "summary", "categories"]);
  assert.equal(input.daily, undefined);
  assert.equal(input.transactions, undefined);
  assert.ok(!observed.input.includes("PRIVATE_ID"));
  assert.ok(!observed.input.includes("PRIVATE_NOTE"));
  assert.equal(result.insight, "仅解释本月汇总。");
  assert.match(observed.instructions, /not a bank balance or disposable funds/);
});
