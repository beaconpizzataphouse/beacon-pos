// Modifier-flow tests for the Beacon POS order screen.
// Runs the REAL menu.js + modifiers.js + app.js in a vm context with
// DOM stubs (same pattern as pos-test.js).
// Checks: modifier data, display-name fixes, BYO whole/half topping
// math, specialty extra toppings (whole + half-and-half), wing
// flavor + 1/2&1/2 flow, All Flats +$3, sauce-on-the-side math
// (multiples at $0.50 each), sandwich cheese/veggie/meat flow,
// pasta sauce/noodle/add-in flow, soup add-ons flow,
// flow navigation/back, cart merge rules with modifiers, and that
// orders persist the detail.
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
check("wing sauces on the side: 6 at $0.50 (ours; $0.15 in Square)",
  MODS.sets.wing_sauce_side.length === 6 &&
  MODS.sets.wing_sauce_side.every(function (o) { return o[1] === 0.5; }));
check("wing sauce display names drop 'on the side'",
  POS.displayName("Ranch on the side") === "Ranch" &&
  POS.displayName("BBQ on the side") === "BBQ");
check("cheese set: 7 at $0.50", MODS.sets.cheese.length === 7 &&
  MODS.sets.cheese.every(function (o) { return o[1] === 0.5; }));
check("meats set: 7 (Bacon $2.50, Prime Rib $9.00)", MODS.sets.meats.length === 7 &&
  MODS.sets.meats.find(function (o) { return o[0] === "Bacon"; })[1] === 2.5 &&
  MODS.sets.meats.find(function (o) { return o[0] === "Prime Rib"; })[1] === 9);
check("veggie add-ons: 13 at $0.60, incl. Lettuce + Tomatoes",
  MODS.sets.veggie_addons.length === 13 &&
  MODS.sets.veggie_addons.every(function (o) { return o[1] === 0.6; }) &&
  MODS.sets.veggie_addons.some(function (o) { return o[0] === "Lettuce"; }) &&
  MODS.sets.veggie_addons.some(function (o) { return o[0] === "Tomatoes"; }));
check("pasta sauce: Red/Alfredo free, Pink +$1", MODS.sets.pasta_sauce.length === 3 &&
  MODS.sets.pasta_sauce.find(function (o) { return o[0] === "Pink Sauce"; })[1] === 1);
check("pasta noodle: 3, all free", MODS.sets.pasta_noodle.length === 3 &&
  MODS.sets.pasta_noodle.every(function (o) { return o[1] === 0; }));
check("pasta add-ins: 17", MODS.sets.pasta_addins.length === 17);
/* Square has no condiment set and no "No ..." removal option — the
   flows add only; removals and condiments stay in the Notes field. */
check("no condiment set in Square data",
  Object.keys(MODS.sets).every(function (k) { return k.indexOf("condiment") === -1; }));
check("veggie add-ons have no No-... removal options",
  MODS.sets.veggie_addons.every(function (o) { return o[0].indexOf("No ") !== 0; }));
/* Square has no sour cream in any set — the soup flow can't offer it;
   it stays in the Notes field, like condiments. (Cream Cheese in the
   cheese set is not sour cream.) */
check("sour cream is not in any modifier set",
  Object.keys(MODS.sets).every(function (k) {
    return MODS.sets[k].every(function (o) {
      return o[0].toLowerCase().indexOf("sour cream") === -1;
    });
  }));
check("display fix: Green Oniond", POS.displayName("Green Oniond") === "Green Onions");
check("display fix: Classic Pepperonii", POS.displayName("Classic Pepperonii") === "Classic Pepperoni");
check("display fix: 1/2 &1/2", POS.displayName("1/2 &1/2") === "1/2 & 1/2");
check("display fix: 1/2 Vinces Wings", POS.displayName("1/2 Vinces Wings") === "1/2 Vince's Wings");
check("unknown name passes through", POS.displayName("Pepperoni") === "Pepperoni");
check("null price counts as $0", POS.modPrice("half_half_wings", "1/2 Vinces Wings") === 0);
check("left 10 CBR fixed to $3.10 in our data (Square still shows $310)",
  POS.modPrice("left_10", "Chicken Bacon Ranch") === 310);
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
check("GF left CBR is $3.10 in our data", line.priceCents === 1595 + 310, "got " + line.priceCents);

/* ---------- half-and-half BYO math ---------- */
console.log("half-and-half BYO math:");
line = POS.buildHalfHalfLine("Build Your Own", "16", ["Pepperoni"], ["Hawaiian"]);
check("16in half pep / half Hawaiian = $24.65", line.priceCents === 2465, "got " + line.priceCents);
check("half-and-half detail", line.detail === "Left: Pepperoni; Right: Hawaiian", line.detail);
check("half-and-half mods priced per side", line.mods.length === 2 &&
  line.mods[0].priceCents === 150 && line.mods[1].priceCents === 220);
line = POS.buildHalfHalfLine("Build Your Own", "16", ["Pepperoni"], []);
check("one half plain = $22.45", line.priceCents === 2245, "got " + line.priceCents);
check("plain half says cheese only",
  line.detail === "Left: Pepperoni; Right: cheese only", line.detail);
line = POS.buildHalfHalfLine("Build Your Own", "16", [], []);
check("both halves plain = base price", line.priceCents === 2095);
check("both plain detail",
  line.detail === "Left: cheese only; Right: cheese only", line.detail);
line = POS.buildHalfHalfLine("Build Your Own", "gf", ["Chicken Bacon Ranch"], ["Pepperoni"]);
check("GF half CBR / half pep = $19.80", line.priceCents === 1980, "got " + line.priceCents);
check("GF half-and-half detail",
  line.detail === "Left: Chicken Bacon Ranch; Right: Pepperoni", line.detail);
line = POS.buildHalfHalfLine("Build Your Own", "12", ["Mushrooms", "Onions"], ["Bacon", "Extra Cheese"]);
check("12in two toppings each side = $19.15", line.priceCents === 1915, "got " + line.priceCents);
check("half-and-half unknown pizza returns null",
  POS.buildHalfHalfLine("Nope", "16", [], []) === null);

/* ---------- specialty pizza extras ---------- */
console.log("specialty pizza extras:");
line = POS.buildPizzaLine("Classic Pepperoni", "12", "whole", ["Extra Cheese"]);
check("12in pepperoni + extra cheese = $20.20", line.priceCents === 2020, "got " + line.priceCents);
check("specialty detail has + prefix", line.detail === "+ Extra Cheese", line.detail);
line = POS.buildPizzaLine("Jibe", "18", "whole", []);
check("plain specialty still works", line.priceCents === 2995 && line.detail === "");
check("unknown pizza returns null", POS.buildPizzaLine("Nope", "16", "whole", []) === null);

/* ---------- specialty half-and-half math ---------- */
console.log("specialty half-and-half math:");
/* Note: Square spells it "Jalapenos" (no accent) in the 16"/18" sets
   and "Jalapeños" in the 10"/12" sets. The raw key stays as Square has
   it, but the display fix normalizes it to "Jalapeños" on screen. */
line = POS.buildHalfHalfLine("Hawaiian", "18", ["Jalapenos"], ["Olives"]);
check("18in Hawaiian + left jalapenos + right olives = $29.55", line.priceCents === 2955, "got " + line.priceCents);
check("specialty half detail", line.detail === "Left: Jalapeños; Right: Olives", line.detail);
check("specialty half mods priced per side", line.mods.length === 2 &&
  line.mods[0].priceCents === 80 && line.mods[1].priceCents === 80);
line = POS.buildHalfHalfLine("Hawaiian", "18", ["Jalapenos"], []);
check("one half only = $28.75", line.priceCents === 2875, "got " + line.priceCents);
check("one-half-only detail has no cheese only",
  line.detail === "Left: Jalapeños", line.detail);
line = POS.buildHalfHalfLine("Hawaiian", "18", [], []);
check("both halves plain specialty = base price, no detail",
  line.priceCents === 2795 && line.detail === "");
line = POS.buildHalfHalfLine("Classic Pepperoni", "16", ["Hawaiian"], []);
check("16in pepperoni + left Hawaiian half = $25.15", line.priceCents === 2515, "got " + line.priceCents);
check("specialty half can hold a specialty half",
  line.detail === "Left: Hawaiian", line.detail);
line = POS.buildHalfHalfLine("Hawaiian", "gf", ["Jalapeños"], ["Olives"]);
check("GF Hawaiian halves use 10in sets = $20.65", line.priceCents === 2065, "got " + line.priceCents);
check("GF specialty half detail", line.detail === "Left: Jalapeños; Right: Olives", line.detail);

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
  [["BBQ on the side", 1], ["Ranch on the side", 1]]);
check("2 sauces on the side = $19.99", line.priceCents === 1999, "got " + line.priceCents);
check("sauces in detail", line.detail.indexOf("+ BBQ") !== -1 &&
  line.detail.indexOf("+ Ranch") !== -1, line.detail);
check("qty-1 sauce shows no x1", line.detail.indexOf("\u00d7") === -1, line.detail);
line = POS.buildWingLine("Bone-in Wings", 1899, "Buffalo", [], "Celery", "none", false,
  [["Ranch on the side", 3]]);
check("3x Ranch on the side = $20.49", line.priceCents === 2049, "got " + line.priceCents);
check("multi-qty sauce shows count", line.detail.indexOf("Ranch \u00d73") !== -1, line.detail);
check("multi-qty sauce is one mod at the combined price",
  line.mods.length === 1 && line.mods[0].name === "Ranch" && line.mods[0].priceCents === 150,
  JSON.stringify(line.mods));
line = POS.buildWingLine("Bone-in Wings", 1899, "Buffalo", [], "Celery", "none", false,
  [["Ranch on the side", 3], ["BBQ on the side", 1]]);
check("3x Ranch + 1x BBQ = $20.99", line.priceCents === 2099, "got " + line.priceCents);
check("mixed sauce detail", line.detail.indexOf("+ Ranch \u00d73, + BBQ") !== -1, line.detail);
line = POS.buildWingLine("Bone-in Wings", 1899, "Vince's Wings", [], "Celery", "All Flats", true,
  [["Louisiana on the side", 1]]);
check("flats + dry rub + sauce = $22.49", line.priceCents === 2249, "got " + line.priceCents);
check("dry rub in detail", line.detail.indexOf("Spicy dry rub") !== -1, line.detail);
line = POS.buildWingLine("Boneless Wings \u2014 10 pc", 1399, "Carolina", [], "Celery", "none", false, []);
check("boneless 10 carolina = $13.99", line.priceCents === 1399);

/* ---------- sandwich math ---------- */
console.log("sandwich math:");
line = POS.buildSandwichLine("BLT", 1199, ["Swiss"], ["Lettuce", "Tomatoes"], ["Bacon"]);
check("BLT + swiss + lettuce + tomatoes + bacon = $16.19", line.priceCents === 1619, "got " + line.priceCents);
check("sandwich detail", line.detail === "+ Swiss, Lettuce, Tomatoes, Bacon", line.detail);
check("sandwich mods priced per set", line.mods.length === 4 &&
  line.mods[0].priceCents === 50 && line.mods[1].priceCents === 60 &&
  line.mods[2].priceCents === 60 && line.mods[3].priceCents === 250);
line = POS.buildSandwichLine("Beacon Prime Dip", 1699, [], [], []);
check("plain sandwich = base price, no detail", line.priceCents === 1699 && line.detail === "");
line = POS.buildSandwichLine("Build Your Own Sandwich", 1099, ["Pepper Jack", "Cheddar"], [], ["Prime Rib"]);
check("BYO sandwich + 2 cheeses + prime rib = $20.99", line.priceCents === 2099, "got " + line.priceCents);
check("BYO sandwich detail", line.detail === "+ Pepper Jack, Cheddar, Prime Rib", line.detail);
line = POS.buildSandwichLine("BLT", 1199, [], ["Jalapenos"], []);
check("sandwich jalapenos display fixed", line.detail === "+ Jalapeños", line.detail);

/* ---------- pasta math ---------- */
console.log("pasta math:");
line = POS.buildPastaLine("Build Your Own Pasta", 1299, "Pink Sauce", "Gluten Free", ["Chicken", "Broccoli"]);
check("BYO pasta pink + GF + chicken + broccoli = $16.09", line.priceCents === 1609, "got " + line.priceCents);
check("pasta detail", line.detail === "Pink Sauce \u00b7 Gluten Free \u00b7 + Chicken, Broccoli", line.detail);
check("pasta mods: pink sauce + add-ins only (noodle is $0)",
  line.mods.length === 3 && line.mods[0].priceCents === 100 &&
  line.mods[1].priceCents === 150 && line.mods[2].priceCents === 60);
line = POS.buildPastaLine("Spaghetti", 1499, "Alfredo", "Spaghetti", []);
check("spaghetti alfredo = base price, no mods", line.priceCents === 1499 && line.mods.length === 0);
check("free sauce + noodle still show in detail", line.detail === "Alfredo \u00b7 Spaghetti", line.detail);
line = POS.buildPastaLine("Bernie Pasta", 1899, null, null, []);
check("plain pasta = base price, no detail", line.priceCents === 1899 && line.detail === "");
line = POS.buildPastaLine("Spaghetti & Meatballs", 1699, null, null, ["Mushrooms", "Anchovies"]);
check("add-ins only = $21.99", line.priceCents === 2199, "got " + line.priceCents);
check("add-ins-only detail", line.detail === "+ Mushrooms, Anchovies", line.detail);

/* ---------- soup math ---------- */
console.log("soup math:");
line = POS.buildSoupLine("Clam Chowder", 1099, ["Cheddar"], ["Red Onions"]);
check("clam chowder + cheddar + red onions = $12.09", line.priceCents === 1209, "got " + line.priceCents);
check("soup detail", line.detail === "+ Cheddar, Red Onions", line.detail);
check("soup mods priced per set", line.mods.length === 2 &&
  line.mods[0].priceCents === 50 && line.mods[1].priceCents === 60);
check("soup line category is soups", line.category === "soups");
line = POS.buildSoupLine("Smoked Brisket Chili", 1099, [], []);
check("plain soup = base price, no detail", line.priceCents === 1099 && line.detail === "");
line = POS.buildSoupLine("Clam Chowder", 1099, ["Cheddar", "Pepper Jack"], ["Red Onions", "Jalapenos"]);
check("chowder + 2 cheeses + 2 veggies = $13.19", line.priceCents === 1319, "got " + line.priceCents);
check("soup jalapenos display fixed",
  line.detail === "+ Cheddar, Pepper Jack, Red Onions, Jalapeños", line.detail);

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
check("extras show sauce steppers",
  byId["flow-options"].innerHTML.indexOf("sauce-row") !== -1 &&
  byId["flow-options"].innerHTML.indexOf("sauce-plus") !== -1);
POS.flowPick("sauce-plus", "BBQ on the side");
POS.flowDone();
check("wing flow adds 1 line", POS.state.cart.length === 1);
check("wing line total $22.49", POS.state.cart[0].priceCents === 2249,
  "got " + (POS.state.cart[0] && POS.state.cart[0].priceCents));
check("wing line detail", POS.state.cart[0].detail ===
  "1/2 Buffalo, 1/2 BBQ \u00b7 No Celery \u00b7 All Flats \u00b7 + BBQ",
  POS.state.cart[0].detail);
check("flow closed after done", POS.state.flow === null);

/* sauce stepper: multiples, minus back down, minus at 0 is a no-op */
POS.clearCart();
POS.startWingFlow("Bone-in Wings", 1899);
POS.flowPick("flavor", "Buffalo");
POS.flowPick("celery", "Celery");
POS.flowPick("sauce-minus", "Ranch on the side");
check("minus at 0 does nothing", POS.state.flow.sauces["Ranch on the side"] === undefined &&
  POS.state.flow.saucesOrder.length === 0);
POS.flowPick("sauce-plus", "Ranch on the side");
POS.flowPick("sauce-plus", "Ranch on the side");
POS.flowPick("sauce-plus", "Ranch on the side");
check("3x plus = qty 3", POS.state.flow.sauces["Ranch on the side"] === 3);
POS.flowPick("sauce-minus", "Ranch on the side");
check("minus drops qty to 2", POS.state.flow.sauces["Ranch on the side"] === 2);
POS.flowPick("sauce-plus", "BBQ on the side");
POS.flowPick("sauce-minus", "BBQ on the side");
check("minus to 0 removes the sauce",
  POS.state.flow.sauces["BBQ on the side"] === undefined &&
  POS.state.flow.saucesOrder.indexOf("BBQ on the side") === -1);
POS.flowPick("sauce-plus", "BBQ on the side");
POS.flowDone();
check("stepper order adds 1 line", POS.state.cart.length === 1);
check("stepper line total $20.49", POS.state.cart[0].priceCents === 2049,
  "got " + (POS.state.cart[0] && POS.state.cart[0].priceCents));
check("stepper line detail", POS.state.cart[0].detail ===
  "Buffalo \u00b7 Celery \u00b7 + Ranch \u00d72, + BBQ", POS.state.cart[0].detail);

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
check("first-half Done offers the other half",
  byId["flow-foot"].innerHTML.indexOf("Next: right half") !== -1);
POS.flowPick("topping", "Hawaiian");
POS.flowDone();
check("Done on first half advances, does not finish",
  POS.state.flow !== null && POS.state.flow.halfStep === 2 && POS.state.cart.length === 0);
check("second half heading says Now the right half",
  byId["flow-sub"].textContent.indexOf("Now the right half") !== -1,
  byId["flow-sub"].textContent);
POS.flowDone(); // right half left plain
check("BYO flow adds 1 line", POS.state.cart.length === 1);
check("BYO left Hawaiian line is $23.15", POS.state.cart[0].priceCents === 2315);
check("BYO line detail shows both halves",
  POS.state.cart[0].detail === "Left: Hawaiian; Right: cheese only", POS.state.cart[0].detail);
POS.flowBack(); // no flow open; must not throw
check("flowBack with no flow is safe", POS.state.flow === null);

POS.startPizzaFlow("Classic Pepperoni", "12");
check("specialty starts at coverage",
  POS.state.flow.step === "coverage");
check("specialty coverage asks about extra toppings",
  byId["flow-sub"].textContent === "Add extra toppings?");
check("specialty coverage offers 4 choices",
  (byId["flow-options"].innerHTML.match(/opt-btn/g) || []).length === 4);
check("specialty coverage offers skip",
  byId["flow-options"].innerHTML.indexOf("No extra toppings") !== -1);
POS.flowPick("coverage", "whole");
check("specialty whole goes to toppings",
  POS.state.flow.step === "toppings");
check("specialty toppings still offer skip",
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
check("skip from coverage adds plain specialty", POS.state.cart[2].priceCents === 2995 &&
  POS.state.cart[2].detail === "");

/* back from toppings returns to coverage for BYO */
POS.startPizzaFlow("Build Your Own", "12");
POS.flowPick("coverage", "right");
POS.flowBack();
check("back from BYO toppings returns to coverage", POS.state.flow.step === "coverage");
POS.closeFlow();

/* GF 10in half shows CBR at the fixed $3.10 (Square still shows $310) */
POS.startPizzaFlow("Build Your Own", "gf");
POS.flowPick("coverage", "left");
check("GF left toppings show CBR at $3.10",
  byId["flow-options"].innerHTML.indexOf("Chicken Bacon Ranch</span><span class=\"opt-price\">+$3.10</span>") !== -1);
check("no $310.00 price anywhere in GF left toppings",
  byId["flow-options"].innerHTML.indexOf("+$310.00") === -1);
POS.closeFlow();

/* ---------- half-and-half flow ---------- */
console.log("half-and-half flow:");
POS.clearCart();
POS.startPizzaFlow("Build Your Own", "16");
POS.flowPick("coverage", "left");
POS.flowPick("topping", "Pepperoni");
POS.flowDone();
POS.flowPick("topping", "Hawaiian");
POS.flowDone();
check("half-and-half flow adds 1 line", POS.state.cart.length === 1);
check("half-and-half line $24.65", POS.state.cart[0].priceCents === 2465,
  "got " + (POS.state.cart[0] && POS.state.cart[0].priceCents));
check("half-and-half line detail", POS.state.cart[0].detail === "Left: Pepperoni; Right: Hawaiian",
  POS.state.cart[0].detail);
check("flow closed after both halves", POS.state.flow === null);

/* right first, then left — detail still reads Left first */
POS.startPizzaFlow("Build Your Own", "16");
POS.flowPick("coverage", "right");
POS.flowPick("topping", "Mushrooms");
POS.flowDone();
check("right-first continues to the left half",
  byId["flow-sub"].textContent.indexOf("Now the left half") !== -1,
  byId["flow-sub"].textContent);
POS.flowPick("topping", "Pepperoni");
POS.flowDone();
check("right-first line $23.15", POS.state.cart[1].priceCents === 2315,
  "got " + (POS.state.cart[1] && POS.state.cart[1].priceCents));
check("detail still Left first", POS.state.cart[1].detail === "Left: Pepperoni; Right: Mushrooms",
  POS.state.cart[1].detail);

/* first half left plain, second half topped */
POS.startPizzaFlow("Build Your Own", "12");
POS.flowPick("coverage", "right");
POS.flowDone(); // right half: nothing picked
check("plain first half still offers the other half",
  POS.state.flow !== null && POS.state.flow.halfStep === 2);
POS.flowPick("topping", "Pineapple");
POS.flowDone();
check("plain right + left pineapple $17.40", POS.state.cart[2].priceCents === 1740,
  "got " + (POS.state.cart[2] && POS.state.cart[2].priceCents));
check("plain-half detail", POS.state.cart[2].detail === "Left: Pineapple; Right: cheese only",
  POS.state.cart[2].detail);

/* Back from the second half keeps both halves' picks */
POS.startPizzaFlow("Build Your Own", "16");
POS.flowPick("coverage", "left");
POS.flowPick("topping", "Pepperoni");
POS.flowPick("topping", "Mushrooms");
POS.flowDone(); // onto the right half
POS.flowPick("topping", "Hawaiian");
POS.flowBack(); // back to the left half
check("back from second half returns to first half",
  POS.state.flow.step === "toppings" && POS.state.flow.halfStep === 1 &&
  byId["flow-sub"].textContent.indexOf("left half") !== -1);
check("first-half picks kept after Back",
  POS.state.flow.picksBySide.left.pickedOrder.join(",") === "Pepperoni,Mushrooms" &&
  byId["flow-options"].innerHTML.indexOf('class="opt-btn selected" data-action="topping" data-value="Pepperoni"') !== -1 &&
  byId["flow-options"].innerHTML.indexOf('class="opt-btn selected" data-action="topping" data-value="Mushrooms"') !== -1);
POS.flowDone(); // forward to the right half again
check("second-half picks kept after Back + Next",
  POS.state.flow.picksBySide.right.pickedOrder.join(",") === "Hawaiian" &&
  byId["flow-options"].innerHTML.indexOf('class="opt-btn selected" data-action="topping" data-value="Hawaiian"') !== -1);
POS.flowDone();
check("back-and-forth line $25.35", POS.state.cart[3].priceCents === 2535,
  "got " + (POS.state.cart[3] && POS.state.cart[3].priceCents));
check("back-and-forth detail",
  POS.state.cart[3].detail === "Left: Pepperoni, Mushrooms; Right: Hawaiian",
  POS.state.cart[3].detail);

/* identical half-and-half lines merge */
POS.clearCart();
function halfHalf16() {
  POS.startPizzaFlow("Build Your Own", "16");
  POS.flowPick("coverage", "left");
  POS.flowPick("topping", "Pepperoni");
  POS.flowDone();
  POS.flowPick("topping", "Hawaiian");
  POS.flowDone();
}
halfHalf16();
halfHalf16();
check("identical half-and-half lines merge to qty 2",
  POS.state.cart.length === 1 && POS.state.cart[0].qty === 2);

/* ---------- specialty half-and-half flow ---------- */
console.log("specialty half-and-half flow:");
POS.clearCart();
POS.startPizzaFlow("Hawaiian", "18");
check("Hawaiian starts at coverage", POS.state.flow.step === "coverage");
POS.flowPick("coverage", "left");
check("specialty left goes to toppings", POS.state.flow.step === "toppings");
check("specialty half picker has Specialty half section",
  byId["flow-options"].innerHTML.indexOf("Specialty half") !== -1);
POS.flowPick("topping", "Jalapenos");
POS.flowDone();
check("specialty Done on first half offers the other half",
  POS.state.flow !== null && POS.state.flow.halfStep === 2 &&
  byId["flow-sub"].textContent.indexOf("Now the right half") !== -1);
POS.flowPick("topping", "Olives");
POS.flowDone();
check("specialty half-and-half adds 1 line", POS.state.cart.length === 1);
check("specialty half-and-half line $29.55", POS.state.cart[0].priceCents === 2955,
  "got " + (POS.state.cart[0] && POS.state.cart[0].priceCents));
check("specialty half-and-half detail",
  POS.state.cart[0].detail === "Left: Jalapeños; Right: Olives", POS.state.cart[0].detail);
check("flow closed after both halves", POS.state.flow === null);

/* one half only via the flow — no "cheese only" on a specialty */
POS.startPizzaFlow("Hawaiian", "18");
POS.flowPick("coverage", "right");
POS.flowPick("topping", "Olives");
POS.flowDone();
POS.flowDone(); // left half: nothing picked
check("one-half-only specialty line $28.75", POS.state.cart[1].priceCents === 2875,
  "got " + (POS.state.cart[1] && POS.state.cart[1].priceCents));
check("one-half-only detail, no cheese only",
  POS.state.cart[1].detail === "Right: Olives", POS.state.cart[1].detail);

/* Back from the second half keeps both halves' picks (specialty) */
POS.startPizzaFlow("Classic Pepperoni", "16");
POS.flowPick("coverage", "left");
POS.flowPick("topping", "Mushrooms");
POS.flowDone(); // onto the right half
POS.flowPick("topping", "Hawaiian");
POS.flowBack(); // back to the left half
check("specialty back from second half returns to first half",
  POS.state.flow.step === "toppings" && POS.state.flow.halfStep === 1 &&
  byId["flow-sub"].textContent.indexOf("left half") !== -1);
check("specialty first-half picks kept after Back",
  POS.state.flow.picksBySide.left.pickedOrder.join(",") === "Mushrooms" &&
  byId["flow-options"].innerHTML.indexOf('class="opt-btn selected" data-action="topping" data-value="Mushrooms"') !== -1);
POS.flowDone(); // forward to the right half again
check("specialty second-half picks kept after Back + Next",
  POS.state.flow.picksBySide.right.pickedOrder.join(",") === "Hawaiian" &&
  byId["flow-options"].innerHTML.indexOf('class="opt-btn selected" data-action="topping" data-value="Hawaiian"') !== -1);
POS.flowDone();
check("specialty back-and-forth line $25.85", POS.state.cart[2].priceCents === 2585,
  "got " + (POS.state.cart[2] && POS.state.cart[2].priceCents));
check("specialty back-and-forth detail",
  POS.state.cart[2].detail === "Left: Mushrooms; Right: Hawaiian", POS.state.cart[2].detail);

/* Back from specialty whole toppings returns to coverage */
POS.startPizzaFlow("Jibe", "18");
POS.flowPick("coverage", "whole");
POS.flowBack();
check("back from specialty toppings returns to coverage", POS.state.flow.step === "coverage");
POS.closeFlow();

/* GF specialty half uses the 10in sets (CBR at fixed $3.10) */
POS.startPizzaFlow("Hawaiian", "gf");
POS.flowPick("coverage", "left");
check("GF specialty left toppings show CBR at $3.10",
  byId["flow-options"].innerHTML.indexOf("Chicken Bacon Ranch</span><span class=\"opt-price\">+$3.10</span>") !== -1);
check("no $310.00 price anywhere in GF specialty left toppings",
  byId["flow-options"].innerHTML.indexOf("+$310.00") === -1);
POS.closeFlow();

/* identical specialty half-and-half lines merge */
POS.clearCart();
function halfHalfHawaiian18() {
  POS.startPizzaFlow("Hawaiian", "18");
  POS.flowPick("coverage", "left");
  POS.flowPick("topping", "Jalapenos");
  POS.flowDone();
  POS.flowPick("topping", "Olives");
  POS.flowDone();
}
halfHalfHawaiian18();
halfHalfHawaiian18();
check("identical specialty half-and-half lines merge to qty 2",
  POS.state.cart.length === 1 && POS.state.cart[0].qty === 2);

/* ---------- flow state machine: sandwich ---------- */
console.log("sandwich flow:");
POS.clearCart();
POS.startSandwichFlow("BLT", 1199);
check("sandwich flow starts at cheese", POS.state.flow.step === "cheese");
check("cheese step offers No changes shortcut",
  byId["flow-options"].innerHTML.indexOf("No changes") !== -1);
POS.flowPick("cheese", "Swiss");
POS.flowDone();
check("cheese Done advances to veggies", POS.state.flow.step === "veggies");
check("veggies step shows Lettuce + Tomatoes",
  byId["flow-options"].innerHTML.indexOf("Lettuce") !== -1 &&
  byId["flow-options"].innerHTML.indexOf("Tomatoes") !== -1);
POS.flowPick("veggie", "Lettuce");
POS.flowPick("veggie", "Tomatoes");
POS.flowBack();
check("back from veggies returns to cheese", POS.state.flow.step === "cheese");
check("cheese pick kept after Back",
  POS.state.flow.cheeseOrder.join(",") === "Swiss" &&
  byId["flow-options"].innerHTML.indexOf('class="opt-btn selected" data-action="cheese" data-value="Swiss"') !== -1);
POS.flowDone(); // forward to veggies again
check("veggie picks kept after Back + Next",
  POS.state.flow.veggiesOrder.join(",") === "Lettuce,Tomatoes");
POS.flowDone(); // onto meats
check("veggies Done advances to meats", POS.state.flow.step === "meats");
POS.flowPick("meat", "Bacon");
POS.flowDone();
check("sandwich flow adds 1 line", POS.state.cart.length === 1);
check("sandwich line $16.19", POS.state.cart[0].priceCents === 1619,
  "got " + (POS.state.cart[0] && POS.state.cart[0].priceCents));
check("sandwich line detail", POS.state.cart[0].detail === "+ Swiss, Lettuce, Tomatoes, Bacon",
  POS.state.cart[0].detail);
check("flow closed after sandwich done", POS.state.flow === null);

/* skip-all adds the plain sandwich at once */
POS.startSandwichFlow("Beacon Club", 1399);
POS.flowPick("skip-all");
check("skip-all adds plain sandwich", POS.state.cart.length === 2 &&
  POS.state.cart[1].priceCents === 1399 && POS.state.cart[1].detail === "");

/* Done with nothing on every step = plain sandwich */
POS.startSandwichFlow("Italian Sub", 1399);
POS.flowDone();
POS.flowDone();
POS.flowDone();
check("all-skipped sandwich is plain", POS.state.cart.length === 3 &&
  POS.state.cart[2].priceCents === 1399 && POS.state.cart[2].detail === "");

/* toggle off removes the pick */
POS.startSandwichFlow("BLT", 1199);
POS.flowPick("cheese", "Swiss");
POS.flowPick("cheese", "Swiss");
POS.flowDone();
POS.flowDone();
POS.flowDone();
check("toggled-off cheese is not charged", POS.state.cart[3].priceCents === 1199 &&
  POS.state.cart[3].detail === "");

/* Back from cheese cancels the flow */
POS.startSandwichFlow("BLT", 1199);
POS.flowBack();
check("back from cheese cancels the flow", POS.state.flow === null && POS.state.cart.length === 4);

/* identical sandwich lines merge */
POS.clearCart();
function swissBLT() {
  POS.startSandwichFlow("BLT", 1199);
  POS.flowPick("cheese", "Swiss");
  POS.flowDone();
  POS.flowDone();
  POS.flowDone();
}
swissBLT();
swissBLT();
check("identical sandwich lines merge to qty 2",
  POS.state.cart.length === 1 && POS.state.cart[0].qty === 2);
POS.startSandwichFlow("BLT", 1199);
POS.flowPick("cheese", "Cheddar");
POS.flowDone();
POS.flowDone();
POS.flowDone();
check("different cheese is a separate line", POS.state.cart.length === 2);

/* ---------- flow state machine: pasta ---------- */
console.log("pasta flow:");
POS.clearCart();
POS.startPastaFlow("Build Your Own Pasta", 1299);
check("pasta flow starts at sauce", POS.state.flow.step === "sauce");
check("sauce step offers No changes shortcut",
  byId["flow-options"].innerHTML.indexOf("No changes") !== -1);
check("sauce step has a Skip button",
  byId["flow-foot"].innerHTML.indexOf("Skip") !== -1);
POS.flowPick("sauce-pasta", "Pink Sauce");
check("sauce pick advances to noodle", POS.state.flow.step === "noodle");
POS.flowBack();
check("back from noodle returns to sauce", POS.state.flow.step === "sauce");
check("sauce pick kept after Back", POS.state.flow.sauce === "Pink Sauce");
POS.flowPick("sauce-pasta", "Pink Sauce");
check("re-picking sauce advances to noodle", POS.state.flow.step === "noodle");
POS.flowPick("noodle", "Gluten Free");
check("noodle pick advances to add-ins", POS.state.flow.step === "addins");
check("add-ins step shows Chicken + Broccoli",
  byId["flow-options"].innerHTML.indexOf("Chicken") !== -1 &&
  byId["flow-options"].innerHTML.indexOf("Broccoli") !== -1);
POS.flowPick("addin", "Chicken");
POS.flowPick("addin", "Broccoli");
POS.flowDone();
check("pasta flow adds 1 line", POS.state.cart.length === 1);
check("pasta line $16.09", POS.state.cart[0].priceCents === 1609,
  "got " + (POS.state.cart[0] && POS.state.cart[0].priceCents));
check("pasta line detail",
  POS.state.cart[0].detail === "Pink Sauce \u00b7 Gluten Free \u00b7 + Chicken, Broccoli",
  POS.state.cart[0].detail);
check("flow closed after pasta done", POS.state.flow === null);

/* Skip sauce + noodle, add-ins only */
POS.startPastaFlow("Spaghetti & Meatballs", 1699);
POS.flowPick("skip");
check("Skip on sauce advances to noodle", POS.state.flow.step === "noodle");
POS.flowPick("skip");
check("Skip on noodle advances to add-ins", POS.state.flow.step === "addins");
POS.flowPick("addin", "Mushrooms");
POS.flowDone();
check("add-ins-only pasta line $17.49", POS.state.cart[1].priceCents === 1749,
  "got " + (POS.state.cart[1] && POS.state.cart[1].priceCents));
check("add-ins-only line detail", POS.state.cart[1].detail === "+ Mushrooms",
  POS.state.cart[1].detail);

/* skip-all adds the plain pasta at once */
POS.startPastaFlow("Bernie Pasta", 1899);
POS.flowPick("skip-all");
check("skip-all adds plain pasta", POS.state.cart.length === 3 &&
  POS.state.cart[2].priceCents === 1899 && POS.state.cart[2].detail === "");

/* Back from sauce cancels the flow */
POS.startPastaFlow("Spaghetti", 1499);
POS.flowBack();
check("back from sauce cancels the flow", POS.state.flow === null && POS.state.cart.length === 3);

/* identical pasta lines merge */
POS.clearCart();
function alfredoSpaghetti() {
  POS.startPastaFlow("Spaghetti", 1499);
  POS.flowPick("sauce-pasta", "Alfredo");
  POS.flowPick("skip");
  POS.flowDone();
}
alfredoSpaghetti();
alfredoSpaghetti();
check("identical pasta lines merge to qty 2",
  POS.state.cart.length === 1 && POS.state.cart[0].qty === 2);

/* ---------- flow state machine: soup ---------- */
console.log("soup flow:");
POS.clearCart();
POS.startSoupFlow("Clam Chowder", 1099);
check("soup flow starts at addons", POS.state.flow.step === "addons");
check("add-ons window shows Cheese + Veggies sections",
  byId["flow-options"].innerHTML.indexOf("Cheese") !== -1 &&
  byId["flow-options"].innerHTML.indexOf("Veggies") !== -1);
check("add-ons window offers No changes shortcut",
  byId["flow-options"].innerHTML.indexOf("No changes") !== -1);
POS.flowPick("cheese", "Cheddar");
POS.flowPick("veggie", "Red Onions");
POS.flowPick("veggie", "Red Onions");
check("toggling a veggie off removes it", POS.state.flow.veggiesOrder.length === 0);
POS.flowPick("veggie", "Red Onions");
POS.flowDone();
check("soup flow adds 1 line", POS.state.cart.length === 1);
check("soup line $12.09", POS.state.cart[0].priceCents === 1209,
  "got " + (POS.state.cart[0] && POS.state.cart[0].priceCents));
check("soup line detail", POS.state.cart[0].detail === "+ Cheddar, Red Onions",
  POS.state.cart[0].detail);
check("flow closed after soup done", POS.state.flow === null);

/* Done with nothing = plain soup */
POS.startSoupFlow("Smoked Brisket Chili", 1099);
POS.flowDone();
check("done with nothing adds plain soup", POS.state.cart.length === 2 &&
  POS.state.cart[1].priceCents === 1099 && POS.state.cart[1].detail === "");

/* skip-all adds the plain soup at once */
POS.startSoupFlow("Clam Chowder", 1099);
POS.flowPick("skip-all");
check("skip-all adds plain soup", POS.state.cart.length === 3 &&
  POS.state.cart[2].priceCents === 1099 && POS.state.cart[2].detail === "");

/* Back cancels the flow */
POS.startSoupFlow("Clam Chowder", 1099);
POS.flowBack();
check("back from add-ons cancels the flow", POS.state.flow === null && POS.state.cart.length === 3);

/* identical soup lines merge */
POS.clearCart();
function cheddarChowder() {
  POS.startSoupFlow("Clam Chowder", 1099);
  POS.flowPick("cheese", "Cheddar");
  POS.flowDone();
}
cheddarChowder();
cheddarChowder();
check("identical soup lines merge to qty 2",
  POS.state.cart.length === 1 && POS.state.cart[0].qty === 2);
POS.startSoupFlow("Clam Chowder", 1099);
POS.flowPick("cheese", "Swiss");
POS.flowDone();
check("different cheese is a separate line", POS.state.cart.length === 2);

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
POS.flowDone(); // onto the right half
POS.flowDone(); // right half plain
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
  POS.startSandwichFlow("BLT", 1199);
  POS.flowPick("cheese", "Swiss");
  POS.flowDone();
  POS.renderFlow();
  POS.startPastaFlow("Build Your Own Pasta", 1299);
  POS.flowPick("sauce-pasta", "Pink Sauce");
  POS.flowPick("noodle", "Spaghetti");
  POS.renderFlow();
  POS.closeFlow();
  POS.renderAll();
} catch (e) { threw = e; }
check("flow renders run without throwing", threw === null, threw && threw.message);

/* ---------- sales report: modifier revenue counts toward the item ---------- */
console.log("sales report (modifier revenue):");
function orderFromLines(number, lines) {
  const items = lines.map(function (l) {
    return { name: l.name, size: l.size, qty: l.qty, priceCents: l.priceCents,
             notes: "", detail: l.detail, mods: l.mods };
  });
  const subtotal = items.reduce(function (s, it) { return s + it.priceCents * it.qty; }, 0);
  const tax = Math.round(subtotal * 0.06);
  return { number: number, type: "dine-in", name: "", items: items,
    subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax,
    placedAt: Date.now(), status: "Sent" };
}
const hawaiian = POS.buildHalfHalfLine("Hawaiian", "18", ["Jalapenos"], ["Olives"]); // $29.55
hawaiian.qty = 2;
const blt = POS.buildSandwichLine("BLT", 1199, ["Swiss"], ["Lettuce", "Tomatoes"], ["Bacon"]); // $16.19
blt.qty = 1;
const wings = POS.buildWingLine("Bone-in Wings", 1899, "Buffalo", [], "Celery", "All Flats", false, []); // $21.99
wings.qty = 1;
const pasta = POS.buildPastaLine("Build Your Own Pasta", 1299, "Pink Sauce", "Gluten Free", ["Chicken", "Broccoli"]); // $16.09
pasta.qty = 1;
POS.saveOrders([orderFromLines(301, [hawaiian, blt, wings, pasta])]);
const rMod = POS.computeReport(POS.reportOrders("today"), "today");
check("report gross includes all modifier revenue: $113.37",
  rMod.grossCents === 11337, "got " + rMod.grossCents);
check("half-and-half pizza gross counts both halves' toppings: 2 x $29.55",
  rMod.topItemsByGross[0].label === "18\u2033 Hawaiian" &&
  rMod.topItemsByGross[0].grossCents === 5910);
check("sandwich gross counts cheese + veggies + meat: $16.19",
  rMod.topItemsByGross.some(function (r) { return r.label === "BLT" && r.grossCents === 1619; }));
check("wings gross counts All Flats +$3.00: $21.99",
  rMod.topItemsByGross.some(function (r) { return r.label === "Bone-in Wings" && r.grossCents === 2199; }));
check("pasta gross counts Pink sauce + add-ins: $16.09",
  rMod.topItemsByGross.some(function (r) { return r.label === "Build Your Own Pasta" && r.grossCents === 1609; }));
check("category gross carries modifier revenue too",
  rMod.topCategoriesByGross.find(function (r) { return r.label === "Pizzas"; }).grossCents === 5910 &&
  rMod.topCategoriesByGross.find(function (r) { return r.label === "Sandwiches"; }).grossCents === 1619 &&
  rMod.topCategoriesByGross.find(function (r) { return r.label === "Wings"; }).grossCents === 2199 &&
  rMod.topCategoriesByGross.find(function (r) { return r.label === "Pasta"; }).grossCents === 1609);
POS.state.report.period = "today";
check("report HTML shows the modifier-built order",
  POS.reportsHTML().indexOf("$113.37") !== -1 &&
  POS.reportsHTML().indexOf("18\u2033 Hawaiian") !== -1);

/* the repo is public: the Reports code must never appear in the source */
const appSrc = fs.readFileSync("app.js", "utf8");
check("no 4-digit code string is hard-coded in app.js",
  !/"[0-9]{4}"|'[0-9]{4}'/.test(appSrc));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
