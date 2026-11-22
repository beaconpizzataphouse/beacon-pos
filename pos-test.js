// Smoke test for the Beacon POS order screen.
// Runs the REAL menu.js + app.js in a vm context with DOM stubs.
// Checks: menu data (counts, spot prices, sizes), cart add/merge/qty,
// notes, tax math, send-order persistence + order numbers, orders view,
// and that rendering runs without throwing.
//
// Run from this folder: node pos-test.js
// (Loads menu.js + app.js WITHOUT modifiers.js, so it also covers the
// no-modifiers fallback: pizzas add plain with no flow.)
"use strict";
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " — " + extra : "")); }
}

/* ---------- fake DOM ---------- */
function fakeEl(id) {
  const el = {
    id: id || "", innerHTML: "", textContent: "", disabled: false,
    value: "", hidden: false, dataset: {}, nodeType: 1,
    _cls: new Set(), _listeners: {},
    classList: {
      add: function (c) { el._cls.add(c); },
      remove: function (c) { el._cls.delete(c); },
      toggle: function (c, force) {
        if (force === undefined) { el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c); }
        else if (force) el._cls.add(c); else el._cls.delete(c);
      },
      contains: function (c) { return el._cls.has(c); }
    },
    addEventListener: function (type, fn) {
      (el._listeners[type] = el._listeners[type] || []).push(fn);
    },
    getAttribute: function () { return null; },
    querySelectorAll: function () { return []; },
    scrollIntoView: function () {}
  };
  return el;
}

const byId = {};
const sandboxDocument = {
  readyState: "complete",
  getElementById: function (id) {
    if (!byId[id]) byId[id] = fakeEl(id);
    return byId[id];
  },
  addEventListener: function () {}
};

const store = {};
const sandbox = {
  console: console,
  setTimeout: function () { return 0; },
  clearTimeout: function () {},
  Date: Date, JSON: JSON, Math: Math,
  document: sandboxDocument,
  localStorage: {
    getItem: function (k) { return store[k] === undefined ? null : store[k]; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  },
  window: {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("menu.js", "utf8"), sandbox);
vm.runInContext(fs.readFileSync("app.js", "utf8"), sandbox);
const POS = sandbox.POS;
const MENU = sandbox.BEACON_MENU;

/* ---------- menu data ---------- */
console.log("menu data:");
check("9 categories", MENU.categories.length === 9, "got " + MENU.categories.length);
check("tab order", MENU.categories.map(function (c) { return c.id; }).join(",") ===
  "pizzas,sandwiches,wings,pasta,salad,apps,soups,desserts,drinks");
const pizzas = POS.categoryById("pizzas").items;
check("14 pizzas", pizzas.length === 14, "got " + pizzas.length);
const pep = pizzas.find(function (p) { return p.name === "Classic Pepperoni"; });
check("pepperoni prices", pep.sizes["12"] === 18.95 && pep.sizes["16"] === 22.95 &&
  pep.sizes["18"] === 25.95 && pep.sizes["gf"] === 17.95, JSON.stringify(pep.sizes));
check("no 10-inch regular", pizzas.every(function (p) { return !("10" in p.sizes); }));
check("every pizza has all 4 sizes", pizzas.every(function (p) {
  return ["12", "16", "18", "gf"].every(function (s) { return typeof p.sizes[s] === "number"; });
}));
check("buffalo + chicken bacon ranch exist",
  pizzas.some(function (p) { return p.name === "Buffalo Chicken"; }) &&
  pizzas.some(function (p) { return p.name === "Chicken Bacon Ranch"; }));
check("9 sandwiches", POS.categoryById("sandwiches").items.length === 9);
check("prime dip $16.99", POS.categoryById("sandwiches").items
  .find(function (i) { return i.name === "Beacon Prime Dip"; }).price === 16.99);
check("4 wing items", POS.categoryById("wings").items.length === 4);
check("boneless 10 is $13.99", POS.categoryById("wings").items
  .find(function (i) { return i.name === "Boneless Wings — 10 pc"; }).price === 13.99);
check("salad bar labeled", POS.categoryById("salad").items
  .every(function (i) { return i.name.indexOf("Salad Bar") === 0; }));
const drinks = POS.categoryById("drinks");
check("12 drink groups", drinks.groups.length === 12, "got " + drinks.groups.length);
check("222 drinks", drinks.groups.reduce(function (n, g) { return n + g.items.length; }, 0) === 222);
check("draft has 76", drinks.groups.find(function (g) { return g.label === "Draft"; }).items.length === 76);
check("kegs group has 3", drinks.groups.find(function (g) { return g.label === "Kegs"; }).items.length === 3);
check("no merch in menu", JSON.stringify(MENU).indexOf("T-shirt") === -1 &&
  JSON.stringify(MENU).indexOf("Gift Card") === -1);
check("no super bowl buy-in", JSON.stringify(MENU).toLowerCase().indexOf("super bowl") === -1);
check("all prices numeric", (function () {
  let ok = true;
  MENU.categories.forEach(function (c) {
    (c.items || []).forEach(function (i) {
      if (i.price !== undefined && typeof i.price !== "number") ok = false;
      if (i.sizes) Object.values(i.sizes).forEach(function (p) { if (typeof p !== "number") ok = false; });
    });
    (c.groups || []).forEach(function (g) {
      g.items.forEach(function (i) { if (typeof i.price !== "number") ok = false; });
    });
  });
  return ok;
})());

/* ---------- cart ---------- */
console.log("cart:");
POS.clearCart();
POS.addToCart("Beacon Prime Dip", "", 1699, "sandwich");
check("add item: 1 line", POS.state.cart.length === 1);
POS.addToCart("Beacon Prime Dip", "", 1699, "sandwich");
check("same item merges, qty 2", POS.state.cart.length === 1 && POS.state.cart[0].qty === 2);
POS.addPizza("Classic Pepperoni", "16");
check("pizza 16in added at $22.95",
  POS.state.cart.some(function (l) { return l.name === "Classic Pepperoni" && l.size === "16\u2033" && l.priceCents === 2295; }));
POS.addPizza("Classic Pepperoni", "gf");
check("pizza GF added at $17.95",
  POS.state.cart.some(function (l) { return l.name === "Classic Pepperoni" && l.size === "GF 10\u2033" && l.priceCents === 1795; }));
check("different sizes are separate lines",
  POS.state.cart.filter(function (l) { return l.name === "Classic Pepperoni"; }).length === 2);
POS.addPizza("Classic Pepperoni", "12");
check("pizza 12in is $18.95",
  POS.state.cart.some(function (l) { return l.size === "12\u2033" && l.priceCents === 1895; }));
const key = POS.state.cart[0].key;
POS.changeQty(key, -1);
check("qty minus works", POS.state.cart[0].qty === 1);
POS.changeQty(key, -1);
check("qty to zero removes line", POS.state.cart.every(function (l) { return l.name !== "Beacon Prime Dip"; }));
POS.addToCart("Ranch", "", 50, "side");
const ranchKey = POS.state.cart.find(function (l) { return l.name === "Ranch"; }).key;
POS.setLineNotes(ranchKey, "extra, on the side");
check("notes saved on line", POS.state.cart.find(function (l) { return l.name === "Ranch"; }).notes === "extra, on the side");
POS.addToCart("Ranch", "", 50, "side");
check("noted line does not merge with plain add",
  POS.state.cart.filter(function (l) { return l.name === "Ranch"; }).length === 2);

/* Line keys go into data-* attributes in the cart HTML. NUL (\u0000)
   separators used to be mangled by the HTML parser (replaced with
   U+FFFD), so Remove, qty +/-, and notes silently did nothing in the
   browser. Keys must contain no NUL, and the values in the rendered
   HTML must match the keys exactly. */
const keyLine = POS.state.cart.find(function (l) { return l.name === "Ranch"; });
check("line key has no NUL separator", keyLine.key.indexOf("\u0000") === -1,
  JSON.stringify(keyLine.key));
check("cart HTML data-remove values match line keys", (function () {
  const h = POS.cartLinesHTML();
  const vals = [];
  const re = /data-remove="([^"]*)"/g;
  let m;
  while ((m = re.exec(h)) !== null) vals.push(m[1]);
  return vals.length === POS.state.cart.length &&
    vals.every(function (v) { return POS.state.cart.some(function (l) { return l.key === v; }); });
})());
check("cart HTML data-qty keys match line keys", (function () {
  const h = POS.cartLinesHTML();
  const vals = [];
  const re = /data-key="([^"]*)"/g;
  let m;
  while ((m = re.exec(h)) !== null) vals.push(m[1]);
  return vals.length === POS.state.cart.length * 2 &&
    vals.every(function (v) { return POS.state.cart.some(function (l) { return l.key === v; }); });
})());
check("removeLine with the key from the cart HTML removes the line", (function () {
  POS.clearCart();
  POS.addToCart("BLT", "", 1199, "sandwiches");
  POS.addToCart("Ranch", "", 50, "side");
  const h = POS.cartLinesHTML();
  const m = h.match(/data-remove="([^"]*)"/);
  if (!m) return false;
  POS.removeLine(m[1]);
  return POS.state.cart.length === 1 && POS.state.cart[0].name === "BLT";
})());

/* ---------- totals / tax ---------- */
console.log("totals:");
POS.clearCart();
POS.addPizza("Classic Pepperoni", "16"); // 2295
POS.addToCart("Beacon Prime Dip", "", 1699, "sandwich");
const t = POS.cartTotals();
check("subtotal $39.94", t.subtotalCents === 3994, "got " + t.subtotalCents);
check("tax 6% = $2.40", t.taxCents === 240, "got " + t.taxCents); // 3994*.06=239.64 -> 240
check("total $42.34", t.totalCents === 4234, "got " + t.totalCents);
POS.clearCart();
POS.addToCart("Ranch", "", 50, "side");
const t2 = POS.cartTotals();
check("tiny order tax rounds ($0.50 -> $0.03)", t2.taxCents === 3 && t2.totalCents === 53,
  JSON.stringify(t2));
check("fmt", POS.fmt(4234) === "$42.34" && POS.fmt(50) === "$0.50");
check("esc escapes html", POS.esc('<a href="x">&\'') === "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");

/* ---------- send order ---------- */
console.log("send order:");
POS.clearCart();
check("empty cart send returns null", POS.sendOrder() === null);
POS.addPizza("Jibe", "18"); // 2995
POS.addToCart("Bone-in Wings", "", 1899, "wings");
POS.state.orderType = "pickup";
POS.state.tableName = "Mike R.";
const order = POS.sendOrder();
check("order number starts at 101", order && order.number === 101, order && order.number);
check("order type + name kept", order.type === "pickup" && order.name === "Mike R.");
check("order total $51.88", order.totalCents === 5188, "got " + (order && order.totalCents)); // 4894 + 294
check("cart cleared after send", POS.state.cart.length === 0);
check("table name cleared after send", POS.state.tableName === "");
check("order persisted", POS.loadOrders().length === 1 && POS.loadOrders()[0].number === 101);
check("todays orders lists it", POS.todaysOrders().length === 1);
POS.addToCart("Water", "", 150, "drink");
const order2 = POS.sendOrder();
check("second order is #102", order2 && order2.number === 102);
check("two orders today", POS.todaysOrders().length === 2);
const oh = POS.ordersHTML();
check("orders HTML shows both numbers", oh.indexOf("#101") !== -1 && oh.indexOf("#102") !== -1);
check("orders HTML shows pickup + name", oh.indexOf("Pickup") !== -1 && oh.indexOf("Mike R.") !== -1);
check("orders HTML escapes notes", (function () {
  POS.addToCart("Ranch", "", 50, "side");
  const k = POS.state.cart[0].key;
  POS.setLineNotes(k, "<script>alert(1)</script>");
  POS.sendOrder();
  const h = POS.ordersHTML();
  return h.indexOf("<script>") === -1 && h.indexOf("&lt;script&gt;") !== -1;
})());

/* ---------- rendering smoke ---------- */
console.log("rendering:");
POS.state.tab = "pizzas";
const gh = POS.gridHTML();
check("pizza grid shows names", gh.indexOf("Classic Pepperoni") !== -1 && gh.indexOf("Beacon Supreme") !== -1);
check("pizza buttons show from-price", gh.indexOf("from $") !== -1);
POS.state.tab = "drinks";
const dh = POS.gridHTML();
check("drinks grid has group headers", dh.indexOf("Draft") !== -1 && dh.indexOf("Kegs") !== -1);
check("drink jump chips: 12", (POS.drinkJumpHTML().match(/jump-chip/g) || []).length === 12);
POS.state.tab = "sandwiches";
check("sandwich grid shows price", POS.gridHTML().indexOf("$16.99") !== -1);
check("tabs HTML has 9 tabs", (POS.tabsHTML().match(/tab-btn/g) || []).length === 9);
POS.clearCart();
POS.addToCart("BLT", "", 1199, "sandwich");
check("cart HTML shows line + total", POS.cartLinesHTML().indexOf("BLT") !== -1 &&
  POS.cartLinesHTML().indexOf("$11.99") !== -1);
POS.addToCart("Ranch", "", 50, "side");
const ch = POS.cartLinesHTML();
check("newest line renders first in the order panel",
  ch.indexOf("Ranch") !== -1 && ch.indexOf("Ranch") < ch.indexOf("BLT"));
let renderThrew = null;
try {
  POS.renderAll();
  POS.showView("orders");
  POS.showView("order");
  POS.openSizePicker("Classic Pepperoni");
  POS.closeSizePicker();
} catch (e) { renderThrew = e; }
check("render/showView/size picker run without throwing", renderThrew === null,
  renderThrew && renderThrew.message);
check("render filled the grid element", byId["grid"].innerHTML.indexOf("BLT") !== -1 ||
  byId["grid"].innerHTML.length > 100);
check("orders count element updated", byId["orders-count"].textContent === "3");

/* ---------- remove saved order ---------- */
console.log("remove saved order:");
check("orders HTML has a Remove button per order",
  (POS.ordersHTML().match(/data-remove-order/g) || []).length === 3);
POS.removeOrder(101);
check("removeOrder drops the order from storage",
  POS.loadOrders().length === 2 && POS.loadOrders().every(function (o) { return o.number !== 101; }));
check("removed order no longer in today's list",
  POS.todaysOrders().length === 2 && POS.todaysOrders().every(function (o) { return o.number !== 101; }));
check("orders HTML no longer shows the removed order",
  POS.ordersHTML().indexOf("#101") === -1 && POS.ordersHTML().indexOf("#102") !== -1);
POS.removeOrder(999);
check("removing a missing order number is a no-op", POS.loadOrders().length === 2);
check("order count element updates after removal", (function () {
  POS.showView("orders");
  return byId["orders-count"].textContent === "2";
})());

/* ---------- sales report ---------- */
console.log("sales report:");
function seedOrder(number, placedAt, items) {
  const subtotal = items.reduce(function (s, it) { return s + it.priceCents * it.qty; }, 0);
  const tax = Math.round(subtotal * 0.06);
  return { number: number, type: "dine-in", name: "", items: items.map(function (it) {
    return { name: it.name, size: it.size || "", qty: it.qty, priceCents: it.priceCents,
             notes: "", detail: "", mods: it.mods || [] };
  }), subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax,
    placedAt: placedAt, status: "Sent" };
}
const t0 = (function () { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const weekStart = (function () {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6); return d.getTime();
})();
const H = 60 * 60 * 1000, D = 24 * H;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDay(ts) {
  const d = new Date(ts);
  return WD[d.getDay()] + " " + MO[d.getMonth()] + " " + d.getDate();
}

/* empty state — no fake sales data, just zeros */
POS.saveOrders([]);
POS.state.report.period = "today";
const rEmpty = POS.computeReport(POS.reportOrders("today"), "today");
check("empty today report is all zeros",
  rEmpty.orderCount === 0 && rEmpty.grossCents === 0 && rEmpty.avgCents === 0);
check("empty report has no top items or categories",
  rEmpty.topItemsByGross.length === 0 && rEmpty.topCategoriesByGross.length === 0);
const rEmptyWeek = POS.computeReport(POS.reportOrders("week"), "week");
check("empty week report: 7 day buckets, all zero",
  rEmptyWeek.buckets.length === 7 &&
  rEmptyWeek.buckets.every(function (b) { return b.grossCents === 0; }));
check("empty report HTML says no orders sent yet",
  POS.reportsHTML().indexOf("No orders sent yet") !== -1);
check("empty report HTML shows zero cards", POS.reportsHTML().indexOf("$0.00") !== -1);
check("report HTML carries the honest notes",
  POS.reportsHTML().indexOf("this iPad only") !== -1 &&
  POS.reportsHTML().indexOf("Square link-up") !== -1);

/* scripted orders across the week boundary */
POS.saveOrders([
  seedOrder(201, t0 + 12 * H + 30 * 60 * 1000, [ // today 12:30 PM — $60.40
    { name: "Beacon Supreme", size: "18\u2033", qty: 2, priceCents: 2995 },
    { name: "Ranch", qty: 1, priceCents: 50 }]),
  seedOrder(202, t0 + 17 * H + 15 * 60 * 1000, [ // today 5:15 PM — $67.92
    { name: "Beacon Supreme", size: "18\u2033", qty: 1, priceCents: 2995 },
    { name: "BLT", qty: 3, priceCents: 1199 },
    { name: "Ranch", qty: 4, priceCents: 50 }]),
  seedOrder(203, t0 - D + 18 * H, [ // yesterday 6 PM — $22.95
    { name: "Classic Pepperoni", size: "16\u2033", qty: 1, priceCents: 2295 }]),
  seedOrder(204, t0 - 6 * D + 12 * H, [ // 6 days ago noon — $37.98
    { name: "Bone-in Wings", qty: 2, priceCents: 1899 }]),
  seedOrder(205, t0 - 7 * D + 12 * H, [ // 7 days ago — outside the week
    { name: "Spaghetti", qty: 1, priceCents: 1499 }]),
  seedOrder(206, weekStart, [ // exactly at the week boundary — included
    { name: "Ranch", qty: 1, priceCents: 50 }]),
  seedOrder(207, weekStart - 1, [ // 1ms before the boundary — excluded
    { name: "Ranch", qty: 1, priceCents: 50 }])
]);
check("today filter returns the 2 orders from today",
  POS.reportOrders("today").length === 2);
check("week filter returns 5 orders (boundary in, 7-day-out out)", (function () {
  const nums = POS.reportOrders("week").map(function (o) { return o.number; }).sort();
  return nums.join(",") === "201,202,203,204,206";
})());

const rToday = POS.computeReport(POS.reportOrders("today"), "today");
check("today math: gross $128.32, 2 orders, avg $64.16",
  rToday.grossCents === 12832 && rToday.orderCount === 2 && rToday.avgCents === 6416,
  JSON.stringify({ g: rToday.grossCents, n: rToday.orderCount, a: rToday.avgCents }));
const rWeek = POS.computeReport(POS.reportOrders("week"), "week");
check("week math: gross $189.75, 5 orders, avg $37.95",
  rWeek.grossCents === 18975 && rWeek.orderCount === 5 && rWeek.avgCents === 3795,
  JSON.stringify({ g: rWeek.grossCents, n: rWeek.orderCount, a: rWeek.avgCents }));

check("top items by gross: 18-inch Supreme first at $89.85",
  rToday.topItemsByGross[0].label === "18\u2033 Beacon Supreme" &&
  rToday.topItemsByGross[0].grossCents === 8985);
check("top items by gross order: Supreme, BLT, Ranch",
  rToday.topItemsByGross.map(function (r) { return r.label; }).join("|") ===
  "18\u2033 Beacon Supreme|BLT|Ranch");
check("top items by count: Ranch first with 5",
  rToday.topItemsByCount[0].label === "Ranch" && rToday.topItemsByCount[0].qty === 5);
check("top items by count tie breaks alphabetically (Supreme before BLT)",
  rToday.topItemsByCount[1].label === "18\u2033 Beacon Supreme" &&
  rToday.topItemsByCount[2].label === "BLT");
check("top categories by gross: Pizzas first at $89.85",
  rToday.topCategoriesByGross[0].label === "Pizzas" &&
  rToday.topCategoriesByGross[0].grossCents === 8985);
check("top categories by count: Apps & Sides first with 5",
  rToday.topCategoriesByCount[0].label === "Apps & Sides" &&
  rToday.topCategoriesByCount[0].qty === 5);
check("category lookup by menu name", POS.categoryForItem("Beacon Supreme").id === "pizzas" &&
  POS.categoryForItem("BLT").id === "sandwiches" &&
  POS.categoryForItem("Bone-in Wings").id === "wings" &&
  POS.categoryForItem("Ranch").id === "apps" &&
  POS.categoryForItem("Spaghetti").id === "pasta");
check("unknown item falls under Other", POS.categoryForItem("No Such Item").id === "other");

check("hourly buckets: 12 PM $60.40 and 5 PM $67.92",
  rToday.buckets.length === 2 &&
  rToday.buckets[0].label === "12 PM" && rToday.buckets[0].grossCents === 6040 &&
  rToday.buckets[1].label === "5 PM" && rToday.buckets[1].grossCents === 6792,
  JSON.stringify(rToday.buckets));
check("week buckets: 7 days, oldest first",
  rWeek.buckets.length === 7 &&
  rWeek.buckets[0].grossCents === 3848 && // 6 days ago: wings + boundary ranch
  rWeek.buckets[5].grossCents === 2295 && // yesterday
  rWeek.buckets[6].grossCents === 12832 && // today
  rWeek.buckets[1].grossCents === 0, JSON.stringify(rWeek.buckets));
check("week bucket labels match the calendar",
  rWeek.buckets[0].label === shortDay(weekStart) &&
  rWeek.buckets[6].label === shortDay(t0));

POS.state.report.period = "today";
POS.state.report.itemsMode = "gross";
const rhToday = POS.reportsHTML();
check("report HTML (today) shows gross, top item, sales by hour",
  rhToday.indexOf("$128.32") !== -1 &&
  rhToday.indexOf("18\u2033 Beacon Supreme") !== -1 &&
  rhToday.indexOf("Sales by hour") !== -1);
POS.state.report.period = "week";
const rhWeek = POS.reportsHTML();
check("report HTML (week) shows gross and sales by day",
  rhWeek.indexOf("$189.75") !== -1 && rhWeek.indexOf("Sales by day") !== -1);
POS.state.report.period = "today";
POS.state.report.itemsMode = "count";
const rhCount = POS.reportsHTML();
check("count toggle reorders top items (Ranch first)",
  rhCount.indexOf("Ranch") !== -1 &&
  rhCount.indexOf("Ranch") < rhCount.indexOf("18\u2033 Beacon Supreme"));
POS.state.report.itemsMode = "gross";
const rhGross = POS.reportsHTML();
check("gross toggle reorders top items (Supreme first)",
  rhGross.indexOf("18\u2033 Beacon Supreme") < rhGross.indexOf("Ranch"));
/* PIN lock: showView("reports") while locked opens the pad instead
   of rendering, so unlock through the pad first. */
POS.setReportsPin("1234");
POS.openPinPad("unlock");
"1234".split("").forEach(function (d) { POS.pinPress(d); });
let reportThrew = null;
try {
  POS.showView("reports");
} catch (e) { reportThrew = e; }
check("showView(reports) runs without throwing and fills the body",
  reportThrew === null && byId["reports-body"].innerHTML.indexOf("Gross sales") !== -1,
  reportThrew && reportThrew.message);
POS.showView("order");
check("leaving Reports locks it again and clears the numbers",
  POS.state.reportsUnlocked === false && byId["reports-body"].innerHTML === "");

/* ---------- reports PIN lock ---------- */
console.log("reports PIN lock:");
/* clean slate: no code set, locked, on the order view */
delete store[POS.REPORTS_PIN_KEY];
POS.lockReports();
POS.showView("order");
check("no code set on a fresh iPad", POS.pinIsSet() === false);
check("locked on a fresh iPad", POS.state.reportsUnlocked === false);

/* tapping Reports with no code opens setup, shows no numbers */
POS.showView("reports");
check("Reports with no code opens the setup pad",
  !!POS.state.pin && POS.state.pin.mode === "setup" && POS.state.pin.step === "new");
check("report stays hidden until a code is set",
  POS.state.view === "order" && byId["reports-body"].innerHTML === "");
check("setup pad shows the set-code prompt",
  byId["pin-title"].textContent === "Set a code" &&
  byId["pin-sub"].textContent.indexOf("4-digit code") !== -1);

/* setup: mismatched confirmation is rejected, no code saved */
"1234".split("").forEach(function (d) { POS.pinPress(d); });
check("setup first entry moves to confirm",
  POS.state.pin.step === "confirm" && POS.state.pin.entry === "");
"5678".split("").forEach(function (d) { POS.pinPress(d); });
check("mismatched confirmation rejected, back to the first entry",
  POS.pinIsSet() === false && POS.state.pin.step === "new" &&
  POS.state.pin.error === "Codes didn't match, try again.");

/* setup: matching confirmation saves the code and opens the report */
"1234".split("").forEach(function (d) { POS.pinPress(d); });
"1234".split("").forEach(function (d) { POS.pinPress(d); });
check("matching confirmation sets the code and opens Reports",
  POS.pinIsSet() === true && POS.state.reportsUnlocked === true &&
  POS.state.view === "reports" && POS.state.pin === null &&
  byId["reports-body"].innerHTML.indexOf("Gross sales") !== -1);
check("report has a Change code button",
  POS.reportsHTML().indexOf("Change code") !== -1);

/* leaving locks again; tapping Reports asks for the code */
POS.showView("order");
check("leaving Reports locks it again", POS.state.reportsUnlocked === false);
POS.showView("reports");
check("Reports with a code set opens the unlock pad",
  !!POS.state.pin && POS.state.pin.mode === "unlock" &&
  POS.state.view === "order");
"9999".split("").forEach(function (d) { POS.pinPress(d); });
check("wrong code stays locked with an error",
  POS.state.reportsUnlocked === false && POS.state.view === "order" &&
  !!POS.state.pin && POS.state.pin.error === "Wrong code, try again." &&
  POS.state.pin.entry === "");
"1234".split("").forEach(function (d) { POS.pinPress(d); });
check("right code opens the report",
  POS.state.reportsUnlocked === true && POS.state.view === "reports" &&
  POS.state.pin === null);

/* backspace + cancel */
POS.showView("order");
POS.showView("reports");
POS.pinPress("1"); POS.pinPress("2"); POS.pinBackspace();
check("backspace drops the last digit", POS.state.pin.entry === "1");
POS.pinCancel();
check("cancel closes the pad and stays locked",
  POS.state.pin === null && POS.state.reportsUnlocked === false &&
  POS.state.view === "order");

/* the Orders view stays unlocked — the crew needs it */
let ordersThrew = null;
try { POS.showView("orders"); } catch (e) { ordersThrew = e; }
check("Orders view opens without a code",
  ordersThrew === null && POS.state.view === "orders" && POS.state.pin === null);
POS.showView("order");

/* change code: wrong current code is rejected, code unchanged */
POS.showView("reports");
"1234".split("").forEach(function (d) { POS.pinPress(d); });
POS.changePin();
check("change code asks for the current code",
  !!POS.state.pin && POS.state.pin.mode === "change" &&
  POS.state.pin.step === "current");
"9999".split("").forEach(function (d) { POS.pinPress(d); });
check("wrong current code rejected",
  POS.state.pin.step === "current" &&
  POS.state.pin.error === "Wrong code, try again.");
"1234".split("").forEach(function (d) { POS.pinPress(d); });
check("right current code moves to the new code",
  POS.state.pin.step === "new");
"5678".split("").forEach(function (d) { POS.pinPress(d); });
"0000".split("").forEach(function (d) { POS.pinPress(d); });
check("mismatched new-code confirmation rejected",
  POS.state.pin.step === "new" &&
  POS.state.pin.error === "Codes didn't match, try again.");
POS.pinCancel();
POS.showView("order");
POS.showView("reports");
"1234".split("").forEach(function (d) { POS.pinPress(d); });
check("old code still opens Reports after a failed change",
  POS.state.reportsUnlocked === true && POS.state.view === "reports");

/* change code: matching new code saves it, old code stops working */
POS.changePin();
"1234".split("").forEach(function (d) { POS.pinPress(d); });
"5678".split("").forEach(function (d) { POS.pinPress(d); });
"5678".split("").forEach(function (d) { POS.pinPress(d); });
check("change code saves the new code and stays in Reports",
  POS.state.pin === null && POS.state.view === "reports" &&
  POS.state.reportsUnlocked === true);
POS.showView("order");
POS.showView("reports");
"1234".split("").forEach(function (d) { POS.pinPress(d); });
check("old code no longer works after a change",
  POS.state.reportsUnlocked === false &&
  POS.state.pin.error === "Wrong code, try again.");
"5678".split("").forEach(function (d) { POS.pinPress(d); });
check("new code opens Reports",
  POS.state.reportsUnlocked === true && POS.state.view === "reports");

/* code persists across a simulated reload (fresh context, same store) */
function freshPOS(sharedStore) {
  const freshById = {};
  const freshDoc = {
    readyState: "complete",
    getElementById: function (id) {
      if (!freshById[id]) freshById[id] = fakeEl(id);
      return freshById[id];
    },
    addEventListener: function () {}
  };
  const fresh = {
    console: console,
    setTimeout: function () { return 0; },
    clearTimeout: function () {},
    Date: Date, JSON: JSON, Math: Math,
    document: freshDoc,
    localStorage: {
      getItem: function (k) { return sharedStore[k] === undefined ? null : sharedStore[k]; },
      setItem: function (k, v) { sharedStore[k] = String(v); },
      removeItem: function (k) { delete sharedStore[k]; }
    },
    window: {}
  };
  fresh.window = fresh;
  vm.createContext(fresh);
  vm.runInContext(fs.readFileSync("menu.js", "utf8"), fresh);
  vm.runInContext(fs.readFileSync("app.js", "utf8"), fresh);
  return fresh.POS;
}
const POS2 = freshPOS(store);
check("code persists across a simulated reload", POS2.pinIsSet() === true);
check("fresh load starts locked", POS2.state.reportsUnlocked === false);
POS2.openPinPad("unlock");
"5678".split("").forEach(function (d) { POS2.pinPress(d); });
check("reloaded app unlocks with the same code",
  POS2.state.reportsUnlocked === true && POS2.state.view === "reports");

/* the repo is public: the code must never appear in the source */
const appSrc = fs.readFileSync("app.js", "utf8");
check("no 4-digit code string is hard-coded in app.js",
  !/"[0-9]{4}"|'[0-9]{4}'/.test(appSrc));
check("PIN lives under the localStorage key only",
  appSrc.indexOf("beacon-pos-reports-pin-v1") !== -1 &&
  appSrc.indexOf("REPORTS_PIN_KEY") !== -1);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
