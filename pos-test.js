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

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
