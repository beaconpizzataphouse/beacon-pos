// Modifier-flow tests for the Beacon POS order screen.
// Runs the REAL menu.js + modifiers.js + app.js in a vm context with
// DOM stubs (same pattern as pos-test.js).
// Checks: modifier data, display-name fixes, BYO whole/half topping
// math, specialty extra toppings, wing flavor + 1/2&1/2 flow, All
// Flats +$3, sauce-on-the-side math, flow navigation/back, cart
// merge rules with modifiers, and that orders persist the detail.
//
// Run from this folder: node pos-modifiers-test.js
"use strict";
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " — " + extra : "")); }
}

/* ---------- fake DOM (same as pos-test.js) ---------- */
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
vm.runInContext(fs.readFileSync("modifiers.js", "utf8"), sandbox);
vm.runInContext(fs.readFileSync("app.js", "utf8"), sandbox);
const POS = sandbox.POS;
const MODS = sandbox.BEACON_MODIFIERS;

/* ---------- modifier data ---------- */
console.log("modifier data:");
check("27 sets", Object.keys(MODS.sets).length === 27,
  "got " + Object.keys(MODS.sets).length);
check("562 options", Object.values(MODS.sets).reduce(function (n, s) { return n + s.length; }, 0) === 562);
check("whole sets have 29 each", ["whole_10", "whole_12", "whole_16", "whole_18"]
  .every(function (k) { return MODS.sets[k].length === 29; }));
check("half sets have 42 each", ["left_10", "left_12", "left_16", "left_18",
  "right_10", "right_12", "right_16", "right_18"]
  .every(function (k) { return MODS.sets[k].length === 42; }));
check("9 wing flavors", MODS.sets.wing_flavors.length === 9);
check("wing flavors all free", MODS.sets.wing_flavors.every(function (o) { return o[1] === 0; }));
check("display fix: Green Oniond", POS.displayName("Green Oniond") === "Green Onions");
check("display fix: Classic Pepperonii", POS.displayName("Classic Pepperonii") === "Classic Pepperoni");
check("display fix: 1/2 &1/2", POS.displayName("1/2 &1/2") === "1/2 & 1/2");
check("display fix: 1/2 Vinces Wings", POS.displayName("1/2 Vinces Wings") === "1/2 Vince's Wings");
check("unknown name passes through", POS.displayName("Pepperoni") === "Pepperoni");
check("null price counts as $0", POS.modPrice("half_half_wings", "1/2 Vinces Wings") === 0);
check("$310 CBR kept as-is", POS.modPrice("left_10", "Chicken Bacon Ranch") === 31000);
check("right 10 CBR is $3.10", POS.modPrice("right_10", "Chicken Bacon Ranch") === 310);
check("topping set keys", POS.toppingSetKey("16", "whole") === "whole_16" &&
  POS.toppingSetKey("gf", "left") === "left_10" &&
  POS.toppingSetKey("18", "right") === "right_18");
const split = POS.splitHalfSet(POS.modOptions("left_16"));
check("half set splits 29 + 13", split.toppings.length === 29 && split.specialty.length === 13,
  split.toppings.length + "+" + split.specialty.length);
check("specialty half names", split.specialty.some(function (o) { return o.name === "Hawaiian"; }) &&
  split.specialty.some(function (o) { return o.name === "Chicken Bacon Ranch"; }));

/* ---------- BYO pizza math ---------- */
console.log("BYO pizza math:");
let line = POS.buildPizzaLine("Build Your Own", "16", "whole", ["Pepperoni", "Mushrooms"]);
check("16in BYO + pep + mush = $24.20", line.priceCents === 2420, "got " + line.priceCents);
check("whole detail lists toppings", line.detail === "Pepperoni, Mushrooms", line.detail);
check("mods recorded with prices", line.mods.length === 2 &&
  line.mods[0].priceCents === 200 && line.mods[1].priceCents === 125);
line = POS.buildPizzaLine("Build Your Own", "16", "left", ["Hawaiian"]);
check("16in BYO left Hawaiian = $23.15", line.priceCents === 2315, "got " + line.priceCents);
check("half detail shows side", line.detail === "Left: Hawaiian", line.detail);
line = POS.buildPizzaLine("Build Your Own", "16", "right", ["Pepperoni", "Hawaiian"]);
check("16in BYO right pep + Hawaiian = $24.65", line.priceCents === 2465, "got " + line.priceCents);
check("half detail mixes toppings + specialty",
  line.detail === "Right: Pepperoni, Hawaiian", line.detail);
line = POS.buildPizzaLine("Build Your Own", "16", "left", []);
check("half with no toppings = base price", line.priceCents === 2095);
check("half with no toppings says cheese only", line.detail === "Left: cheese only", line.detail);
line = POS.buildPizzaLine("Build Your Own", "16", "whole", []);
check("plain BYO whole = base price, no detail", line.priceCents === 2095 && line.detail === "");
line = POS.buildPizzaLine("Build Your Own", "gf", "left", ["Chicken Bacon Ranch"]);
check("GF left CBR shows the $310 as-is", line.priceCents === 1595 + 31000, "got " + line.priceCents);

/* ---------- specialty pizza extras ---------- */
console.log("specialty pizza extras:");
line = POS.buildPizzaLine("Classic Pepperoni", "12", "whole", ["Extra Cheese"]);
check("12in pepperoni + extra cheese = $20.20", line.priceCents === 2020, "got " + line.priceCents);
check("specialty detail has + prefix", line.detail === "+ Extra Cheese", line.detail);
line = POS.buildPizzaLine("Jibe", "18", "whole", []);
check("plain specialty still works", line.priceCents === 2995 && line.detail === "");
check("unknown pizza returns null", POS.buildPizzaLine("Nope", "16", "whole", []) === null);

/* ---------- wing math ---------- */
console.log("wing math:");
line = POS.buildWingLine("Bone-in Wings", 1899, "Buffalo", [], "Celery", "none", false, []);
check("bone-in buffalo + celery = $18.99", line.priceCents === 1899, "got " + line.priceCents);
check("wing detail", line.detail === "Buffalo \u00b7 Celery", line.detail);
line = POS.buildWingLine("Bone-in Wings", 1899, "1/2 &1/2", ["1/2 Buffalo", "1/2 BBQ"], "No Celery", "none", false, []);
check("1/2 & 1/2 wings = $18.99", line.priceCents === 1899);
check("1/2 & 1/2 detail", line.detail === "1/2 Buffalo, 1/2 BBQ \u00b7 No Celery", line.detail);
line = POS.buildWingLine("Bone-in Wings", 1899, "BBQ", [], "Celery", "All Flats", false, []);
check("All Flats +$3 = $21.99", line.priceCents === 2199, "got " + line.priceCents);
check("All Flats in detail", line.detail.indexOf("All Flats") !== -1, line.detail);
line = POS.buildWingLine("Bone-in Wings", 1899, "BBQ", [], "Celery", "All Drums", false, []);
check("All Drums is free", line.priceCents === 1899);
line = POS.buildWingLine("Bone-in Wings", 1899, "Plain", [], "No Celery", "none", false,
  ["BBQ on the side", "Ranch on the side"]);
check("2 sauces on the side = $19.29", line.priceCents === 1929, "got " + line.priceCents);
check("sauces in detail", line.detail.indexOf("+ BBQ on the side") !== -1 &&
  line.detail.indexOf("+ Ranch on the side") !== -1, line.detail);
line = POS.buildWingLine("Bone-in Wings", 1899, "Vince's Wings", [], "Celery", "All Flats", true,
  ["Louisiana on the side"]);
check("flats + dry rub + sauce = $22.14", line.priceCents === 2214, "got " + line.priceCents);
check("dry rub in detail", line.detail.indexOf("Spicy dry rub") !== -1, line.detail);
line = POS.buildWingLine("Boneless Wings \u2014 10 pc", 1399, "Carolina", [], "Celery", "none", false, []);
check("boneless 10 carolina = $13.99", line.priceCents === 1399);

/* ---------- flow state machine: wings ---------- */
console.log("wing flow:");
POS.clearCart();
POS.startWingFlow("Bone-in Wings", 1899);
check("wing flow starts at flavor", POS.state.flow.step === "flavor");
POS.flowPick("flavor", "Buffalo");
check("flavor pick advances to celery", POS.state.flow.step === "celery");
POS.flowBack();
check("back from celery returns to flavor", POS.state.flow.step === "flavor");
POS.flowPick("flavor", "1/2 &1/2");
check("1/2 & 1/2 goes to halves step", POS.state.flow.step === "halves");
POS.flowPick("half", "1/2 Buffalo");
POS.flowDone();
check("Done blocked with only 1 half picked", POS.state.flow.step === "halves");
POS.flowPick("half", "1/2 BBQ");
POS.flowDone();
check("2 halves advance to celery", POS.state.flow.step === "celery");
POS.flowPick("celery", "No Celery");
check("celery pick advances to extras", POS.state.flow.step === "extras");
check("bone-in extras offer All Flats",
  byId["flow-options"].innerHTML.indexOf("All Flats") !== -1);
POS.flowPick("flats", "All Flats");
POS.flowPick("sauce", "BBQ on the side");
POS.flowDone();
check("wing flow adds 1 line", POS.state.cart.length === 1);
check("wing line total $22.14", POS.state.cart[0].priceCents === 2214,
  "got " + (POS.state.cart[0] && POS.state.cart[0].priceCents));
check("wing line detail", POS.state.cart[0].detail ===
  "1/2 Buffalo, 1/2 BBQ \u00b7 No Celery \u00b7 All Flats \u00b7 + BBQ on the side",
  POS.state.cart[0].detail);
check("flow closed after done", POS.state.flow === null);

/* boneless: no flats/drums choice */
POS.startWingFlow("Boneless Wings \u2014 10 pc", 1399);
POS.flowPick("flavor", "Plain");
POS.flowPick("celery", "Celery");
check("boneless extras hide flats/drums",
  byId["flow-options"].innerHTML.indexOf("All Flats") === -1 &&
  byId["flow-options"].innerHTML.indexOf("Flats or drums") === -1);
check("boneless extras still offer sauces",
  byId["flow-options"].innerHTML.indexOf("Ranch on the side") !== -1);
POS.flowBack();
check("back from extras returns to celery", POS.state.flow.step === "celery");
POS.flowBack();
check("back from celery returns to flavor", POS.state.flow.step === "flavor");
POS.flowBack();
check("back from flavor cancels the flow", POS.state.flow === null);

/* ---------- flow state machine: pizza ---------- */
console.log("pizza flow:");
POS.clearCart();
POS.startPizzaFlow("Build Your Own", "16");
check("BYO starts at coverage", POS.state.flow.step === "coverage");
check("coverage step shows 3 choices",
  (byId["flow-options"].innerHTML.match(/opt-btn/g) || []).length === 3);
POS.flowPick("coverage", "left");
check("coverage pick advances to toppings", POS.state.flow.step === "toppings");
check("half toppings show Specialty half section",
  byId["flow-options"].innerHTML.indexOf("Specialty half") !== -1);
POS.flowPick("topping", "Hawaiian");
POS.flowDone();
check("BYO flow adds 1 line", POS.state.cart.length === 1);
check("BYO left Hawaiian line is $23.15", POS.state.cart[0].priceCents === 2315);
check("BYO line detail", POS.state.cart[0].detail === "Left: Hawaiian", POS.state.cart[0].detail);
POS.flowBack(); // no flow open; must not throw
check("flowBack with no flow is safe", POS.state.flow === null);

POS.startPizzaFlow("Classic Pepperoni", "12");
check("specialty starts at toppings (no coverage)",
  POS.state.flow.step === "toppings");
check("specialty toppings offer skip",
  byId["flow-options"].innerHTML.indexOf("No extra toppings") !== -1);
POS.flowPick("topping", "Extra Cheese");
POS.flowPick("topping", "Extra Cheese"); // toggle off
POS.flowPick("topping", "Mushrooms");
POS.flowDone();
check("specialty line $19.70 (pep 12 + mush)", POS.state.cart[1].priceCents === 1970,
  "got " + (POS.state.cart[1] && POS.state.cart[1].priceCents));
check("specialty detail", POS.state.cart[1].detail === "+ Mushrooms", POS.state.cart[1].detail);

POS.startPizzaFlow("Jibe", "18");
POS.flowPick("skip-toppings");
check("skip adds plain specialty", POS.state.cart[2].priceCents === 2995 &&
  POS.state.cart[2].detail === "");

/* back from toppings returns to coverage for BYO */
POS.startPizzaFlow("Build Your Own", "12");
POS.flowPick("coverage", "right");
POS.flowBack();
check("back from BYO toppings returns to coverage", POS.state.flow.step === "coverage");
POS.closeFlow();

/* GF 10in half shows the $310 CBR as-is */
POS.startPizzaFlow("Build Your Own", "gf");
POS.flowPick("coverage", "left");
check("GF left toppings show $310.00 CBR",
  byId["flow-options"].innerHTML.indexOf("+$310.00") !== -1);
POS.closeFlow();

/* ---------- cart merge + totals + orders ---------- */
console.log("cart merge, totals, orders:");
POS.clearCart();
POS.startPizzaFlow("Build Your Own", "16");
POS.flowPick("coverage", "whole");
POS.flowPick("topping", "Pepperoni");
POS.flowPick("topping", "Mushrooms");
POS.flowDone();
POS.startPizzaFlow("Build Your Own", "16");
POS.flowPick("coverage", "whole");
POS.flowPick("topping", "Pepperoni");
POS.flowPick("topping", "Mushrooms");
POS.flowDone();
check("identical BYO lines merge to qty 2", POS.state.cart.length === 1 && POS.state.cart[0].qty === 2);
POS.startPizzaFlow("Build Your Own", "16");
POS.flowPick("coverage", "left");
POS.flowPick("topping", "Pepperoni");
POS.flowDone();
check("different coverage is a separate line", POS.state.cart.length === 2);
const t = POS.cartTotals();
check("subtotal with modifiers $70.85", t.subtotalCents === 7085, "got " + t.subtotalCents); // 2420*2 + 2245
check("tax 6% = $4.25", t.taxCents === 425, "got " + t.taxCents);
check("total $75.10", t.totalCents === 7510, "got " + t.totalCents);
check("cart HTML shows topping detail", POS.cartLinesHTML().indexOf("Left: Pepperoni") !== -1);
POS.state.orderType = "dine-in";
POS.state.tableName = "Table 4";
const order = POS.sendOrder();
check("order keeps detail + mods", order.items[0].detail === "Pepperoni, Mushrooms" &&
  order.items[0].mods.length === 2, JSON.stringify(order.items[0]));
check("orders HTML shows detail", POS.ordersHTML().indexOf("Left: Pepperoni") !== -1);

/* ---------- render smoke ---------- */
console.log("render smoke:");
let threw = null;
try {
  POS.startPizzaFlow("Build Your Own", "16");
  POS.flowPick("coverage", "whole");
  POS.renderFlow();
  POS.startWingFlow("Bone-in Wings", 1899);
  POS.flowPick("flavor", "BBQ");
  POS.flowPick("celery", "Celery");
  POS.renderFlow();
  POS.closeFlow();
  POS.renderAll();
} catch (e) { threw = e; }
check("flow renders run without throwing", threw === null, threw && threw.message);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
