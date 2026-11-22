/* ================================================================
   BEACON POS — front counter order screen
   ----------------------------------------------------------------
   DEMO ONLY. Orders are saved to this iPad's localStorage and do
   NOT reach the kitchen. Payment stays in Square — this screen
   takes the order only; there is no payment flow here.

   Menu data comes from menu.js, generated from the Square Item
   Library export (see generate_menu.py). Prices are exact Square
   prices. Modifier data (toppings, wing flavors) comes from
   modifiers.js, generated from modifiers.json, which was read from
   the Square Dashboard's modifier lists (see generate_modifiers.py).
   Pizza, wing, sandwich, and pasta items walk a step-by-step
   modifier flow (one question per window); other items add
   straight to the order.

   Money is handled in integer cents everywhere to avoid float
   rounding. Tax is 6% (Square's Sales Tax rate in the export).

   TO WIRE UP SQUARE LATER: replace sendOrder()'s localStorage
   save with a Square Orders API create-order call, and have the
   kitchen display (beacon-kds) read the same orders. The order
   shape below already matches what the KDS expects:
     { number, type: "dine-in"|"pickup", name,
       items: [{ name, size, qty, priceCents, notes, detail,
                 mods: [{ name, priceCents }] }],
       subtotalCents, taxCents, totalCents, placedAt, status }
   ================================================================ */
(function () {
  "use strict";

  var MENU = (typeof window !== "undefined" && window.BEACON_MENU) || null;
  var MODS = (typeof window !== "undefined" && window.BEACON_MODIFIERS) || null;
  var TAX_RATE = MENU ? MENU.taxRate : 0.06;

  var ORDERS_KEY = "beacon-pos-orders-v1";
  var COUNTER_KEY = "beacon-pos-counter-v1";
  var FIRST_ORDER_NUMBER = 101;

  var SIZE_LABELS = { "12": "12\u2033", "16": "16\u2033", "18": "18\u2033", "gf": "GF 10\u2033" };
  var SIZE_ORDER = ["12", "16", "18", "gf"];
  /* topping sets are keyed by inch size; GF 10" uses the 10" sets */
  var TOPPING_SIZE = { "12": "12", "16": "16", "18": "18", "gf": "10" };
  var BYO_NAME = "Build Your Own";
  var HALF_HALF_FLAVOR = "1/2 &1/2"; /* raw Square name; displayed "1/2 & 1/2" */

  var state = {
    tab: "pizzas",
    view: "order",          // "order" | "orders"
    cart: [],               // { key, name, size, priceCents, qty, notes, category, detail, mods }
    orderType: "dine-in",
    tableName: "",
    pendingPizza: null,     // pizza awaiting a size choice
    flow: null,             // active modifier flow, see startPizzaFlow/startWingFlow/startSandwichFlow/startPastaFlow
    lastOrder: null
  };

  /* ---------------- storage (safe when unavailable) ---------------- */
  function lsGet(k) {
    try { return (typeof localStorage !== "undefined") ? localStorage.getItem(k) : null; }
    catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(k, v); }
    catch (e) { /* demo: ignore */ }
  }

  /* ---------------- money ---------------- */
  function toCents(dollars) { return Math.round(dollars * 100); }
  function fmt(cents) { return "$" + (cents / 100).toFixed(2); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- menu lookups ---------------- */
  function categoryById(id) {
    if (!MENU) return null;
    for (var i = 0; i < MENU.categories.length; i++) {
      if (MENU.categories[i].id === id) return MENU.categories[i];
    }
    return null;
  }

  function pizzaByName(name) {
    var cat = categoryById("pizzas");
    if (!cat) return null;
    for (var i = 0; i < cat.items.length; i++) {
      if (cat.items[i].name === name) return cat.items[i];
    }
    return null;
  }

  /* ---------------- modifiers ---------------- */
  /* What the screen shows for a Square option name. Square has a
     few spelling quirks ("Green Oniond", "Classic Pepperonii");
     modifiers.js carries the fix map. Unknown names pass through. */
  function displayName(raw) {
    if (MODS && MODS.displayNameFixes && MODS.displayNameFixes[raw]) {
      return MODS.displayNameFixes[raw];
    }
    return raw;
  }

  /* Raw [name, priceDollars] pairs for a modifier set key. */
  function modSet(key) {
    if (!MODS || !MODS.sets) return [];
    return MODS.sets[key] || [];
  }

  /* Options as { name (raw), display, priceCents }. A null price in
     Square (blank field) counts as $0.00. */
  function modOptions(key) {
    return modSet(key).map(function (o) {
      return { name: o[0], display: displayName(o[0]),
               priceCents: toCents(o[1] == null ? 0 : o[1]) };
    });
  }

  function modPrice(key, rawName) {
    var opts = modSet(key);
    for (var i = 0; i < opts.length; i++) {
      if (opts[i][0] === rawName) return toCents(opts[i][1] == null ? 0 : opts[i][1]);
    }
    return 0;
  }

  /* Topping set for a pizza size + coverage: whole_12, left_16, ... */
  function toppingSetKey(sizeKey, coverage) {
    var sz = TOPPING_SIZE[sizeKey] || "12";
    if (coverage === "left") return "left_" + sz;
    if (coverage === "right") return "right_" + sz;
    return "whole_" + sz;
  }

  /* Half-pizza sets list 29 toppings first, then the 13 specialty-
     pizza halves. Split them so the picker can show two sections. */
  function splitHalfSet(options) {
    var nSpecialty = 13;
    var cut = Math.max(0, options.length - nSpecialty);
    return { toppings: options.slice(0, cut), specialty: options.slice(cut) };
  }

  function otherSide(side) { return side === "left" ? "right" : "left"; }

  /* The pick state for the topping picker currently on screen. Half
     flows (any pizza) keep one pick set per side so Back keeps each
     half's toppings; whole-pizza flows use the flow's own
     picked/pickedOrder. Both shapes have picked + pickedOrder. */
  function flowPicks(f) {
    if (f.kind === "pizza" && f.side) return f.picksBySide[f.side];
    return f;
  }

  /* ---------------- cart ---------------- */
  /* Cart-line keys go into data-* attributes in the cart HTML, so
     the separator must survive an HTML round-trip. \u0000 does NOT:
     the HTML parser replaces NUL in attribute values with U+FFFD,
     so getAttribute returned a key that never matched — Remove,
     qty +/-, and notes silently did nothing in the browser (the
     node tests never caught it because they call the functions
     directly, bypassing the DOM). \u001F (unit separator) survives
     parsing and can never be typed on the iPad keyboard. */
  var KEY_SEP = "\u001F";
  function lineKey(name, size, detail, notes) {
    return name + KEY_SEP + (size || "") + KEY_SEP + (detail || "") + KEY_SEP + (notes || "");
  }

  function addToCart(name, size, priceCents, category, detail, mods) {
    var key = lineKey(name, size, detail || "", "");
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].key === key) { state.cart[i].qty += 1; return state.cart[i]; }
    }
    var line = { key: key, name: name, size: size || "", priceCents: priceCents,
                 qty: 1, notes: "", category: category || "",
                 detail: detail || "", mods: mods || [] };
    state.cart.push(line);
    return line;
  }

  function addPizza(pizzaName, sizeKey) {
    var pizza = pizzaByName(pizzaName);
    if (!pizza) return null;
    var price = pizza.sizes[sizeKey];
    if (price == null) return null;
    return addToCart(pizzaName, SIZE_LABELS[sizeKey] || sizeKey, toCents(price), "pizza");
  }

  /* Build a pizza cart line from a finished modifier flow.
     pickedNames: raw Square option names, in the order tapped.
     coverage: "whole" | "left" | "right". */
  function buildPizzaLine(pizzaName, sizeKey, coverage, pickedNames) {
    var pizza = pizzaByName(pizzaName);
    if (!pizza) return null;
    var price = pizza.sizes[sizeKey];
    if (price == null) return null;
    var isBYO = pizzaName === BYO_NAME;
    var setKey = toppingSetKey(sizeKey, coverage);
    var mods = pickedNames.map(function (n) {
      return { name: displayName(n), priceCents: modPrice(setKey, n) };
    });
    var priceCents = toCents(price);
    for (var i = 0; i < mods.length; i++) priceCents += mods[i].priceCents;
    var detail = "";
    var names = mods.map(function (m) { return m.name; }).join(", ");
    if (isBYO) {
      if (coverage === "left" || coverage === "right") {
        var side = coverage === "left" ? "Left" : "Right";
        detail = side + ": " + (names || "cheese only");
      } else {
        detail = names; /* plain cheese BYO has no detail */
      }
    } else {
      detail = names ? "+ " + names : "";
    }
    return { name: pizzaName, size: SIZE_LABELS[sizeKey] || sizeKey,
             priceCents: priceCents, detail: detail, mods: mods, category: "pizza" };
  }

  /* Build a half-and-half line from both halves' picks.
     leftPicks / rightPicks: raw Square option names, in tap order.
     Each side is priced from its own half set. Detail always reads
     Left first, then Right. For Build Your Own a side with no picks
     reads "cheese only"; for a specialty pizza only halves with
     picks are shown (the base pizza already covers a plain half),
     so a specialty with no picks on either half has no detail. */
  function buildHalfHalfLine(pizzaName, sizeKey, leftPicks, rightPicks) {
    var pizza = pizzaByName(pizzaName);
    if (!pizza) return null;
    var price = pizza.sizes[sizeKey];
    if (price == null) return null;
    var isBYO = pizzaName === BYO_NAME;
    function sideMods(side, picks) {
      var setKey = toppingSetKey(sizeKey, side);
      return (picks || []).map(function (n) {
        return { name: displayName(n), priceCents: modPrice(setKey, n) };
      });
    }
    function sideNames(ms) {
      return ms.map(function (m) { return m.name; }).join(", ");
    }
    function sideDetail(ms) {
      return sideNames(ms) || "cheese only";
    }
    var leftMods = sideMods("left", leftPicks);
    var rightMods = sideMods("right", rightPicks);
    var mods = leftMods.concat(rightMods);
    var priceCents = toCents(price);
    for (var i = 0; i < mods.length; i++) priceCents += mods[i].priceCents;
    var detail;
    if (isBYO) {
      detail = "Left: " + sideDetail(leftMods) + "; Right: " + sideDetail(rightMods);
    } else {
      var parts = [];
      if (leftMods.length) parts.push("Left: " + sideNames(leftMods));
      if (rightMods.length) parts.push("Right: " + sideNames(rightMods));
      detail = parts.join("; ");
    }
    return { name: pizzaName, size: SIZE_LABELS[sizeKey] || sizeKey,
             priceCents: priceCents, detail: detail,
             mods: mods, category: "pizza" };
  }

  /* Build a wings cart line from a finished modifier flow.
     flavor: raw wing_flavors name; halves: raw half_half_wings names
     (only when flavor is 1/2 & 1/2); celery: "Celery"|"No Celery";
     flats: "none"|"All Flats"|"All Drums"; sauceNames: raw
     wing_sauce_side names. */
  function buildWingLine(name, priceCents, flavor, halves, celery, flats, dryRub, sauceNames) {
    var mods = [];
    var parts = [];
    if (flavor === HALF_HALF_FLAVOR) {
      parts.push(halves.map(displayName).join(", "));
    } else {
      parts.push(displayName(flavor));
    }
    parts.push(displayName(celery));
    if (flats === "All Flats") {
      mods.push({ name: "All Flats", priceCents: modPrice("flats_drums", "All Flats") });
      parts.push("All Flats");
    } else if (flats === "All Drums") {
      parts.push("All Drums");
    }
    if (dryRub) parts.push("Spicy dry rub");
    var sauces = (sauceNames || []).map(function (n) {
      mods.push({ name: displayName(n), priceCents: modPrice("wing_sauce_side", n) });
      return "+ " + displayName(n);
    });
    if (sauces.length) parts.push(sauces.join(", "));
    var total = priceCents;
    for (var i = 0; i < mods.length; i++) total += mods[i].priceCents;
    return { name: name, size: "", priceCents: total,
             detail: parts.join(" \u00b7 "), mods: mods, category: "wings" };
  }

  /* Build a sandwich cart line from a finished modifier flow.
     cheeseNames / veggieNames / meatNames: raw Square option names,
     in tap order, priced from the cheese / veggie_addons / meats
     sets. Nothing picked on a step = no change on that step; a
     sandwich with nothing picked anywhere is the plain sandwich.
     Square's data has no "No ..." removal option and no condiment
     set at all, so removals and condiments stay in the Notes field. */
  function buildSandwichLine(name, priceCents, cheeseNames, veggieNames, meatNames) {
    var mods = [];
    function addMods(setKey, names) {
      (names || []).forEach(function (n) {
        mods.push({ name: displayName(n), priceCents: modPrice(setKey, n) });
      });
    }
    addMods("cheese", cheeseNames);
    addMods("veggie_addons", veggieNames);
    addMods("meats", meatNames);
    var total = priceCents;
    for (var i = 0; i < mods.length; i++) total += mods[i].priceCents;
    var detail = mods.length
      ? "+ " + mods.map(function (m) { return m.name; }).join(", ") : "";
    return { name: name, size: "", priceCents: total,
             detail: detail, mods: mods, category: "sandwiches" };
  }

  /* Build a pasta cart line from a finished modifier flow.
     sauce / noodle: raw pasta_sauce / pasta_noodle names, or null
     when the step was skipped (kept as it comes). addinNames: raw
     pasta_addins names, in tap order. Sauce and noodle are $0
     choices (except Pink Sauce, +$1.00), so they show in the detail
     only; add-ins are priced and recorded as mods. */
  function buildPastaLine(name, priceCents, sauce, noodle, addinNames) {
    var mods = [];
    var parts = [];
    if (sauce) {
      var saucePrice = modPrice("pasta_sauce", sauce);
      if (saucePrice > 0) mods.push({ name: displayName(sauce), priceCents: saucePrice });
      parts.push(displayName(sauce));
    }
    if (noodle) parts.push(displayName(noodle));
    var addins = (addinNames || []).map(function (n) {
      mods.push({ name: displayName(n), priceCents: modPrice("pasta_addins", n) });
      return displayName(n);
    });
    if (addins.length) parts.push("+ " + addins.join(", "));
    var total = priceCents;
    for (var i = 0; i < mods.length; i++) total += mods[i].priceCents;
    return { name: name, size: "", priceCents: total,
             detail: parts.join(" \u00b7 "), mods: mods, category: "pasta" };
  }

  function findLine(key) {
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].key === key) return state.cart[i];
    }
    return null;
  }

  function changeQty(key, delta) {
    var line = findLine(key);
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) removeLine(key);
  }

  function removeLine(key) {
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].key === key) { state.cart.splice(i, 1); return; }
    }
  }

  function setLineNotes(key, notes) {
    var line = findLine(key);
    if (!line) return;
    line.notes = notes;
    line.key = lineKey(line.name, line.size, line.detail, notes);
  }

  function clearCart() { state.cart = []; }

  function cartTotals() {
    var subtotal = 0;
    for (var i = 0; i < state.cart.length; i++) {
      subtotal += state.cart[i].priceCents * state.cart[i].qty;
    }
    var tax = Math.round(subtotal * TAX_RATE);
    return { subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax };
  }

  /* ---------------- orders (localStorage) ---------------- */
  function loadOrders() {
    try {
      var raw = lsGet(ORDERS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function saveOrders(list) { lsSet(ORDERS_KEY, JSON.stringify(list)); }

  function nextOrderNumber() {
    var n = parseInt(lsGet(COUNTER_KEY) || "", 10);
    if (isNaN(n) || n < FIRST_ORDER_NUMBER) n = FIRST_ORDER_NUMBER;
    lsSet(COUNTER_KEY, String(n + 1));
    return n;
  }

  function sendOrder() {
    if (state.cart.length === 0) return null;
    var totals = cartTotals();
    var order = {
      number: nextOrderNumber(),
      type: state.orderType,
      name: state.tableName.trim(),
      items: state.cart.map(function (l) {
        return { name: l.name, size: l.size, qty: l.qty,
                 priceCents: l.priceCents, notes: l.notes,
                 detail: l.detail || "", mods: l.mods || [] };
      }),
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      placedAt: Date.now(),
      status: "Sent"
    };
    var list = loadOrders();
    list.push(order);
    saveOrders(list);
    state.lastOrder = order;
    clearCart();
    state.tableName = "";
    return order;
  }

  function isToday(ts) {
    var d = new Date(ts), now = new Date();
    return d.getFullYear() === now.getFullYear() &&
           d.getMonth() === now.getMonth() &&
           d.getDate() === now.getDate();
  }

  function todaysOrders() {
    return loadOrders().filter(function (o) { return isToday(o.placedAt); });
  }

  /* Delete a saved order by number (Orders view). Saved orders are
     real customer orders, so the UI asks once ("Remove this order?")
     before calling this. Removing a number that isn't there is a
     no-op. */
  function removeOrder(number) {
    var list = loadOrders().filter(function (o) { return o.number !== number; });
    saveOrders(list);
  }

  /* ---------------- HTML builders (pure, testable) ---------------- */
  function tabsHTML() {
    if (!MENU) return "";
    return MENU.categories.map(function (c) {
      return '<button type="button" class="tab-btn' + (c.id === state.tab ? " active" : "") +
        '" data-tab="' + c.id + '">' + esc(c.label) + "</button>";
    }).join("");
  }

  function itemButtonHTML(item, categoryId) {
    return '<button type="button" class="item-btn" data-name="' + esc(item.name) +
      '" data-price="' + item.price + '" data-cat="' + categoryId + '">' +
      '<span class="item-name">' + esc(item.name) + "</span>" +
      '<span class="item-price">' + fmt(toCents(item.price)) + "</span></button>";
  }

  function pizzaButtonHTML(pizza) {
    var low = Math.min(pizza.sizes["12"], pizza.sizes["16"], pizza.sizes["18"], pizza.sizes["gf"]);
    return '<button type="button" class="item-btn pizza" data-pizza="' + esc(pizza.name) + '">' +
      '<span class="item-name">' + esc(pizza.name) + "</span>" +
      '<span class="item-price">from ' + fmt(toCents(low)) + "</span></button>";
  }

  function gridHTML() {
    var cat = categoryById(state.tab);
    if (!cat) return "";
    if (cat.kind === "pizzas") {
      return cat.items.map(pizzaButtonHTML).join("");
    }
    if (cat.kind === "grouped") {
      var html = "";
      cat.groups.forEach(function (g, gi) {
        html += '<h3 class="group-head" id="drink-group-' + gi + '">' + esc(g.label) + "</h3>";
        html += g.items.map(function (it) { return itemButtonHTML(it, cat.id); }).join("");
      });
      return html;
    }
    return cat.items.map(function (it) { return itemButtonHTML(it, cat.id); }).join("");
  }

  function drinkJumpHTML() {
    var cat = categoryById("drinks");
    if (!cat || state.tab !== "drinks") return "";
    return cat.groups.map(function (g, gi) {
      return '<button type="button" class="jump-chip" data-group="' + gi + '">' +
        esc(g.label) + "</button>";
    }).join("");
  }

  /* Newest line first, so what was just added is at the top without
     scrolling. Display order only — the cart array itself stays in
     the order items were added, so totals, merging, and saved
     orders are unaffected. */
  function cartLinesHTML() {
    return state.cart.slice().reverse().map(function (l) {
      var sizePart = l.size ? ' <span class="line-size">' + esc(l.size) + "</span>" : "";
      var detailPart = l.detail ? '<div class="line-detail">' + esc(l.detail) + "</div>" : "";
      return '<div class="cart-line">' +
        '<div class="line-top"><span class="line-name">' + esc(l.name) + sizePart + "</span>" +
        '<span class="line-total">' + fmt(l.priceCents * l.qty) + "</span></div>" +
        detailPart +
        '<div class="line-controls">' +
        '<button type="button" class="qty-btn" data-qty="-1" data-key="' + esc(l.key) + '">&minus;</button>' +
        '<span class="qty">' + l.qty + "</span>" +
        '<button type="button" class="qty-btn" data-qty="1" data-key="' + esc(l.key) + '">+</button>' +
        '<button type="button" class="line-remove" data-remove="' + esc(l.key) + '">Remove</button>' +
        "</div>" +
        '<input class="line-notes" type="text" placeholder="Notes, e.g. extra cheese, no onions" ' +
        'value="' + esc(l.notes) + '" data-notes="' + esc(l.key) + '" maxlength="80">' +
        "</div>";
    }).join("");
  }

  function ordersHTML() {
    var list = todaysOrders().slice().reverse();
    if (list.length === 0) {
      return '<div class="orders-empty">No orders sent yet today.</div>';
    }
    return list.map(function (o) {
      var time = new Date(o.placedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      var who = o.name ? " &middot; " + esc(o.name) : "";
      var items = o.items.map(function (it) {
        var size = it.size ? " " + esc(it.size) : "";
        var detail = it.detail ? ' <span class="order-detail">' + esc(it.detail) + "</span>" : "";
        var notes = it.notes ? ' <em>(' + esc(it.notes) + ")</em>" : "";
        return "<li>" + it.qty + " &times; " + esc(it.name) + size + detail + notes + "</li>";
      }).join("");
      return '<div class="order-card">' +
        '<div class="order-card-top"><span class="order-num">Order #' + o.number + "</span>" +
        '<span class="order-total">' + fmt(o.totalCents) + "</span></div>" +
        '<div class="order-meta">' + time + " &middot; " +
        (o.type === "dine-in" ? "Dine-in" : "Pickup") + who + "</div>" +
        '<span class="order-status">' + esc(o.status) + " (demo)</span>" +
        "<ul class='order-items'>" + items + "</ul>" +
        '<button type="button" class="order-remove" data-remove-order="' + o.number + '">Remove order</button></div>';
    }).join("");
  }

  /* ---------------- DOM rendering ---------------- */
  function el(id) {
    return (typeof document !== "undefined") ? document.getElementById(id) : null;
  }

  function renderTabs() {
    var t = el("tabs");
    if (t) t.innerHTML = tabsHTML();
  }

  function renderGrid() {
    var g = el("grid");
    if (g) g.innerHTML = gridHTML();
    var j = el("drink-jump");
    if (j) {
      j.innerHTML = drinkJumpHTML();
      j.hidden = (state.tab !== "drinks");
    }
  }

  function renderCart() {
    var lines = el("cart-lines");
    if (lines) lines.innerHTML = cartLinesHTML();
    var empty = el("cart-empty");
    if (empty) empty.hidden = state.cart.length > 0;
    var totals = cartTotals();
    var sub = el("subtotal"), tax = el("tax"), tot = el("total"), send = el("send-btn");
    if (sub) sub.textContent = fmt(totals.subtotalCents);
    if (tax) tax.textContent = fmt(totals.taxCents);
    if (tot) tot.textContent = fmt(totals.totalCents);
    if (send) send.disabled = state.cart.length === 0;
  }

  function renderOrdersCount() {
    var c = el("orders-count");
    if (c) c.textContent = String(todaysOrders().length);
  }

  function renderTypeButtons() {
    var wrap = el("order-type");
    if (!wrap) return;
    var btns = wrap.querySelectorAll ? wrap.querySelectorAll(".type-btn") : [];
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute && btns[i].getAttribute("data-type") === state.orderType;
      if (btns[i].classList) btns[i].classList.toggle("active", !!on);
    }
  }

  function showView(view) {
    state.view = view;
    var ov = el("order-view"), xv = el("orders-view"), tabs = el("tabs");
    if (ov) ov.hidden = view !== "order";
    if (xv) xv.hidden = view !== "orders";
    if (tabs) tabs.hidden = view === "orders";
    if (view === "orders") {
      var list = el("orders-list");
      if (list) list.innerHTML = ordersHTML();
    }
    renderOrdersCount();
  }

  function openSizePicker(pizzaName) {
    var cat = categoryById("pizzas");
    if (!cat) return;
    var pizza = null;
    for (var i = 0; i < cat.items.length; i++) {
      if (cat.items[i].name === pizzaName) { pizza = cat.items[i]; break; }
    }
    if (!pizza) return;
    state.pendingPizza = pizza;
    var title = el("size-modal-title");
    if (title) title.textContent = pizza.name;
    var opts = el("size-options");
    if (opts) {
      opts.innerHTML = SIZE_ORDER.map(function (s) {
        return '<button type="button" class="size-btn" data-size="' + s + '">' +
          "<span>" + (s === "gf" ? "Gluten-free 10\u2033" : s + "\u2033") + "</span>" +
          '<span class="size-price">' + fmt(toCents(pizza.sizes[s])) + "</span></button>";
      }).join("");
    }
    var modal = el("size-modal");
    if (modal) modal.hidden = false;
  }

  function closeSizePicker() {
    state.pendingPizza = null;
    var modal = el("size-modal");
    if (modal) modal.hidden = true;
  }

  /* ---------------- modifier flows ----------------
     One question per window, big buttons, Back on every step.
     Pizza: size (size picker) -> coverage (Whole / Left half / Right
     half; specialty pizzas also offer "No extra toppings") ->
     toppings for the first half -> toppings for the other half
     (half-and-half only; Done with nothing picked leaves that half
     plain — cheese only on Build Your Own, the base pizza on a
     specialty). Wings: flavor -> half flavors (only for 1/2 & 1/2)
     -> celery -> extras. Sandwich: cheese -> veggies -> meats
     (each step multi-pick, Done with nothing = no change; "No
     changes" on the first step adds the sandwich plain). Pasta:
     sauce -> noodle -> add-ins (sauce and noodle are single-pick
     with a Skip button; add-ins are multi-pick). Single-pick steps
     advance on tap; multi-pick steps have a Done button. Back
     returns to the previous step, or to the size picker for pizzas
     / closes the flow for wings, sandwiches, and pastas. */
  function startPizzaFlow(pizzaName, sizeKey) {
    var isBYO = pizzaName === BYO_NAME;
    state.flow = {
      kind: "pizza", pizzaName: pizzaName, sizeKey: sizeKey, isBYO: isBYO,
      step: "coverage",
      coverage: null,
      side: null, halfStep: 1,
      picked: {}, pickedOrder: [],
      /* one pick set per side, so Back keeps each half's toppings */
      picksBySide: { left: { picked: {}, pickedOrder: [] },
                     right: { picked: {}, pickedOrder: [] } }
    };
    renderFlow();
    var modal = el("flow-modal");
    if (modal) modal.hidden = false;
  }

  function startWingFlow(name, priceCents) {
    state.flow = {
      kind: "wings", name: name, priceCents: priceCents,
      boneIn: name.indexOf("Bone-in") === 0,
      step: "flavor", flavor: null, halves: [], celery: null,
      flats: "none", dryRub: false, sauces: {}
    };
    renderFlow();
    var modal = el("flow-modal");
    if (modal) modal.hidden = false;
  }

  function startSandwichFlow(name, priceCents) {
    state.flow = {
      kind: "sandwich", name: name, priceCents: priceCents,
      step: "cheese",
      cheese: {}, cheeseOrder: [],
      veggies: {}, veggiesOrder: [],
      meats: {}, meatsOrder: []
    };
    renderFlow();
    var modal = el("flow-modal");
    if (modal) modal.hidden = false;
  }

  function startPastaFlow(name, priceCents) {
    state.flow = {
      kind: "pasta", name: name, priceCents: priceCents,
      step: "sauce", sauce: null, noodle: null,
      addins: {}, addinsOrder: []
    };
    renderFlow();
    var modal = el("flow-modal");
    if (modal) modal.hidden = false;
  }

  function closeFlow() {
    state.flow = null;
    var modal = el("flow-modal");
    if (modal) modal.hidden = true;
  }

  function optBtnHTML(action, value, label, priceCents, selected) {
    var pricePart = priceCents > 0
      ? '<span class="opt-price">+' + fmt(priceCents) + "</span>" : "";
    return '<button type="button" class="opt-btn' + (selected ? " selected" : "") +
      '" data-action="' + action + '" data-value="' + esc(value) + '">' +
      '<span class="opt-label">' + esc(label) + "</span>" + pricePart + "</button>";
  }

  function footBackHTML(label) {
    return '<button type="button" class="cancel-btn flow-back" data-action="back">' +
      esc(label) + "</button>";
  }

  function footDoneHTML(label, disabled) {
    return '<button type="button" class="send-btn flow-done" data-action="done"' +
      (disabled ? " disabled" : "") + ">" + esc(label) + "</button>";
  }

  function toppingGridHTML(options, picked) {
    return '<div class="flow-grid">' + options.map(function (o) {
      return optBtnHTML("topping", o.name, o.display, o.priceCents, !!picked[o.name]);
    }).join("") + "</div>";
  }

  function renderFlow() {
    var f = state.flow;
    if (!f) return;
    var title = el("flow-title"), sub = el("flow-sub"),
        opts = el("flow-options"), foot = el("flow-foot");
    var t = "", s = "", html = "", footHTML = "";
    if (f.kind === "pizza") {
      t = f.pizzaName + " — " + (SIZE_LABELS[f.sizeKey] || f.sizeKey);
      if (f.step === "coverage") {
        if (f.isBYO) {
          s = "Whole pizza, or just one half?";
          html = '<div class="flow-grid">' +
            optBtnHTML("coverage", "whole", "Whole pizza", 0, false) +
            optBtnHTML("coverage", "left", "Left half", 0, false) +
            optBtnHTML("coverage", "right", "Right half", 0, false) +
            "</div>";
        } else {
          s = "Add extra toppings?";
          html = '<div class="flow-grid">' +
            optBtnHTML("coverage", "whole", "Whole pizza", 0, false) +
            optBtnHTML("coverage", "left", "Left half", 0, false) +
            optBtnHTML("coverage", "right", "Right half", 0, false) +
            optBtnHTML("skip-toppings", "none", "No extra toppings", 0, false) +
            "</div>";
        }
        footHTML = footBackHTML("Back");
      } else {
        var picks = flowPicks(f);
        var options = modOptions(toppingSetKey(f.sizeKey, f.side || f.coverage));
        if (f.coverage !== "whole") {
          if (f.halfStep === 2) {
            s = "Now the " + f.side + " half \u2014 pick toppings";
          } else {
            s = "Pick toppings for the " + f.side + " half";
          }
          var split = splitHalfSet(options);
          html = '<h3 class="opt-section">Toppings</h3>' +
            toppingGridHTML(split.toppings, picks.picked) +
            '<h3 class="opt-section">Specialty half</h3>' +
            toppingGridHTML(split.specialty, picks.picked);
          var doneLabel = (f.halfStep === 1)
            ? "Next: " + otherSide(f.side) + " half"
            : "Add to order";
          footHTML = footBackHTML("Back") + footDoneHTML(doneLabel, false);
        } else if (f.isBYO) {
          s = "Pick your toppings";
          html = toppingGridHTML(options, picks.picked);
          footHTML = footBackHTML("Back") + footDoneHTML("Add to order", false);
        } else {
          s = "Add extra toppings? (optional)";
          html = toppingGridHTML(options, picks.picked) +
            '<button type="button" class="flow-skip" data-action="skip-toppings">' +
            "No extra toppings</button>";
          footHTML = footBackHTML("Back") + footDoneHTML("Add to order", false);
        }
      }
    } else if (f.kind === "wings") {
      t = f.name;
      if (f.step === "flavor") {
        s = "Pick a flavor";
        html = '<div class="flow-grid">' + modOptions("wing_flavors").map(function (o) {
          return optBtnHTML("flavor", o.name, o.display, o.priceCents, false);
        }).join("") + "</div>";
        footHTML = footBackHTML("Cancel");
      } else if (f.step === "halves") {
        s = "Pick the two half flavors";
        html = '<div class="flow-grid">' + modOptions("half_half_wings").map(function (o) {
          return optBtnHTML("half", o.name, o.display, o.priceCents,
            f.halves.indexOf(o.name) !== -1);
        }).join("") + "</div>";
        footHTML = footBackHTML("Back") + footDoneHTML("Next", f.halves.length !== 2);
      } else if (f.step === "celery") {
        s = "Celery with that?";
        html = '<div class="flow-grid">' + modOptions("wing_side").map(function (o) {
          return optBtnHTML("celery", o.name, o.display, o.priceCents, false);
        }).join("") + "</div>";
        footHTML = footBackHTML("Back");
      } else {
        s = "Any extras? (optional)";
        if (f.boneIn) {
          html += '<h3 class="opt-section">Flats or drums</h3><div class="flow-grid">' +
            optBtnHTML("flats", "none", "Mixed, as they come", 0, f.flats === "none") +
            optBtnHTML("flats", "All Flats", "All Flats",
              modPrice("flats_drums", "All Flats"), f.flats === "All Flats") +
            optBtnHTML("flats", "All Drums", "All Drums", 0, f.flats === "All Drums") +
            "</div>";
        }
        html += '<h3 class="opt-section">Dry rub</h3><div class="flow-grid">' +
          optBtnHTML("dryrub", "dryrub", "Add spicy dry rub", 0, f.dryRub) + "</div>";
        html += '<h3 class="opt-section">Sauces on the side</h3><div class="flow-grid">' +
          modOptions("wing_sauce_side").map(function (o) {
            return optBtnHTML("sauce", o.name, o.display, o.priceCents, !!f.sauces[o.name]);
          }).join("") + "</div>";
        footHTML = footBackHTML("Back") + footDoneHTML("Add to order", false);
      }
    } else if (f.kind === "sandwich") {
      t = f.name;
      if (f.step === "cheese") {
        s = "Add or change cheese? (optional)";
        html = '<div class="flow-grid">' + modOptions("cheese").map(function (o) {
          return optBtnHTML("cheese", o.name, o.display, o.priceCents, !!f.cheese[o.name]);
        }).join("") + "</div>" +
          '<button type="button" class="flow-skip" data-action="skip-all">' +
          "No changes — add it as it comes</button>";
        footHTML = footBackHTML("Back") + footDoneHTML("Next", false);
      } else if (f.step === "veggies") {
        s = "Add veggies? (optional)";
        html = '<div class="flow-grid">' + modOptions("veggie_addons").map(function (o) {
          return optBtnHTML("veggie", o.name, o.display, o.priceCents, !!f.veggies[o.name]);
        }).join("") + "</div>";
        footHTML = footBackHTML("Back") + footDoneHTML("Next", false);
      } else {
        s = "Add meats? (optional)";
        html = '<div class="flow-grid">' + modOptions("meats").map(function (o) {
          return optBtnHTML("meat", o.name, o.display, o.priceCents, !!f.meats[o.name]);
        }).join("") + "</div>";
        footHTML = footBackHTML("Back") + footDoneHTML("Add to order", false);
      }
    } else if (f.kind === "pasta") {
      t = f.name;
      if (f.step === "sauce") {
        s = "Pick a sauce";
        html = '<div class="flow-grid">' + modOptions("pasta_sauce").map(function (o) {
          return optBtnHTML("sauce-pasta", o.name, o.display, o.priceCents, f.sauce === o.name);
        }).join("") + "</div>" +
          '<button type="button" class="flow-skip" data-action="skip-all">' +
          "No changes — add it as it comes</button>";
        footHTML = footBackHTML("Back") +
          '<button type="button" class="send-btn flow-done" data-action="skip">Skip</button>';
      } else if (f.step === "noodle") {
        s = "Pick a noodle";
        html = '<div class="flow-grid">' + modOptions("pasta_noodle").map(function (o) {
          return optBtnHTML("noodle", o.name, o.display, o.priceCents, f.noodle === o.name);
        }).join("") + "</div>";
        footHTML = footBackHTML("Back") +
          '<button type="button" class="send-btn flow-done" data-action="skip">Skip</button>';
      } else {
        s = "Add-ins? (optional)";
        html = '<div class="flow-grid">' + modOptions("pasta_addins").map(function (o) {
          return optBtnHTML("addin", o.name, o.display, o.priceCents, !!f.addins[o.name]);
        }).join("") + "</div>";
        footHTML = footBackHTML("Back") + footDoneHTML("Add to order", false);
      }
    }
    if (title) title.textContent = t;
    if (sub) sub.textContent = s;
    if (opts) opts.innerHTML = html;
    if (foot) foot.innerHTML = footHTML;
  }

  /* Toggle one option in a multi-pick step's pick set + tap order. */
  function togglePick(picked, pickedOrder, value) {
    if (picked[value]) {
      delete picked[value];
      var i = pickedOrder.indexOf(value);
      if (i !== -1) pickedOrder.splice(i, 1);
    } else {
      picked[value] = true;
      pickedOrder.push(value);
    }
  }

  function flowPick(action, value) {
    var f = state.flow;
    if (!f) return;
    if (action === "coverage") {
      f.coverage = value;
      f.step = "toppings";
      if (value === "left" || value === "right") {
        f.side = value;
        f.halfStep = 1;
      } else {
        f.side = null;
      }
      renderFlow();
    } else if (action === "topping") {
      var p = flowPicks(f);
      if (p.picked[value]) {
        delete p.picked[value];
        p.pickedOrder = p.pickedOrder.filter(function (n) { return n !== value; });
      } else {
        p.picked[value] = true;
        p.pickedOrder.push(value);
      }
      renderFlow();
    } else if (action === "skip-toppings") {
      f.coverage = "whole"; /* plain pizza, no toppings */
      finishPizzaFlow();
    } else if (action === "flavor") {
      f.flavor = value;
      f.step = (value === HALF_HALF_FLAVOR) ? "halves" : "celery";
      renderFlow();
    } else if (action === "half") {
      var i = f.halves.indexOf(value);
      if (i !== -1) f.halves.splice(i, 1);
      else if (f.halves.length < 2) f.halves.push(value);
      renderFlow();
    } else if (action === "celery") {
      f.celery = value;
      f.step = "extras";
      renderFlow();
    } else if (action === "flats") {
      f.flats = value;
      renderFlow();
    } else if (action === "dryrub") {
      f.dryRub = !f.dryRub;
      renderFlow();
    } else if (action === "sauce") {
      if (f.sauces[value]) delete f.sauces[value];
      else f.sauces[value] = true;
      renderFlow();
    } else if (action === "cheese") {
      togglePick(f.cheese, f.cheeseOrder, value);
      renderFlow();
    } else if (action === "veggie") {
      togglePick(f.veggies, f.veggiesOrder, value);
      renderFlow();
    } else if (action === "meat") {
      togglePick(f.meats, f.meatsOrder, value);
      renderFlow();
    } else if (action === "sauce-pasta") {
      f.sauce = value;
      f.step = "noodle";
      renderFlow();
    } else if (action === "noodle") {
      f.noodle = value;
      f.step = "addins";
      renderFlow();
    } else if (action === "addin") {
      togglePick(f.addins, f.addinsOrder, value);
      renderFlow();
    } else if (action === "skip") {
      if (f.kind === "pasta" && f.step === "sauce") { f.step = "noodle"; renderFlow(); }
      else if (f.kind === "pasta" && f.step === "noodle") { f.step = "addins"; renderFlow(); }
    } else if (action === "skip-all") {
      if (f.kind === "sandwich") finishSandwichFlow();
      else if (f.kind === "pasta") finishPastaFlow();
    }
  }

  function flowBack() {
    var f = state.flow;
    if (!f) return;
    if (f.kind === "pizza") {
      if (f.step === "toppings" && f.coverage !== "whole" && f.halfStep === 2) {
        /* back to the first half; each half's picks are kept per side */
        f.side = f.coverage;
        f.halfStep = 1;
        renderFlow();
      } else if (f.step === "toppings") {
        f.step = "coverage";
        renderFlow();
      } else {
        var name = f.pizzaName;
        closeFlow();
        openSizePicker(name);
      }
    } else if (f.kind === "wings") {
      if (f.step === "flavor") closeFlow();
      else if (f.step === "halves") { f.step = "flavor"; renderFlow(); }
      else if (f.step === "celery") {
        f.step = (f.flavor === HALF_HALF_FLAVOR) ? "halves" : "flavor";
        renderFlow();
      } else { f.step = "celery"; renderFlow(); }
    } else if (f.kind === "sandwich") {
      if (f.step === "cheese") closeFlow();
      else if (f.step === "veggies") { f.step = "cheese"; renderFlow(); }
      else { f.step = "veggies"; renderFlow(); }
    } else if (f.kind === "pasta") {
      if (f.step === "sauce") closeFlow();
      else if (f.step === "noodle") { f.step = "sauce"; renderFlow(); }
      else { f.step = "noodle"; renderFlow(); }
    }
  }

  function flowDone() {
    var f = state.flow;
    if (!f) return;
    if (f.kind === "pizza" && f.step === "toppings") {
      if (f.coverage !== "whole" && f.halfStep === 1) {
        /* first half done — offer the other half next */
        f.side = otherSide(f.side);
        f.halfStep = 2;
        renderFlow();
      } else {
        finishPizzaFlow();
      }
    }
    else if (f.kind === "wings" && f.step === "halves") {
      if (f.halves.length === 2) { f.step = "celery"; renderFlow(); }
    } else if (f.kind === "wings" && f.step === "extras") finishWingFlow();
    else if (f.kind === "sandwich" && f.step === "cheese") { f.step = "veggies"; renderFlow(); }
    else if (f.kind === "sandwich" && f.step === "veggies") { f.step = "meats"; renderFlow(); }
    else if (f.kind === "sandwich" && f.step === "meats") finishSandwichFlow();
    else if (f.kind === "pasta" && f.step === "addins") finishPastaFlow();
  }

  function finishPizzaFlow() {
    var f = state.flow;
    if (!f) return;
    var line;
    if (f.coverage === "left" || f.coverage === "right") {
      line = buildHalfHalfLine(f.pizzaName, f.sizeKey,
        f.picksBySide.left.pickedOrder, f.picksBySide.right.pickedOrder);
    } else {
      line = buildPizzaLine(f.pizzaName, f.sizeKey, f.coverage, f.pickedOrder);
    }
    if (line) addToCart(line.name, line.size, line.priceCents, line.category, line.detail, line.mods);
    closeFlow();
    renderCart();
  }

  function finishWingFlow() {
    var f = state.flow;
    if (!f) return;
    var line = buildWingLine(f.name, f.priceCents, f.flavor, f.halves, f.celery,
      f.flats, f.dryRub, Object.keys(f.sauces));
    if (line) addToCart(line.name, line.size, line.priceCents, line.category, line.detail, line.mods);
    closeFlow();
    renderCart();
  }

  function finishSandwichFlow() {
    var f = state.flow;
    if (!f) return;
    var line = buildSandwichLine(f.name, f.priceCents,
      f.cheeseOrder, f.veggiesOrder, f.meatsOrder);
    if (line) addToCart(line.name, line.size, line.priceCents, line.category, line.detail, line.mods);
    closeFlow();
    renderCart();
  }

  function finishPastaFlow() {
    var f = state.flow;
    if (!f) return;
    var line = buildPastaLine(f.name, f.priceCents, f.sauce, f.noodle, f.addinsOrder);
    if (line) addToCart(line.name, line.size, line.priceCents, line.category, line.detail, line.mods);
    closeFlow();
    renderCart();
  }

  function onFlowClick(e) {
    var btn = closestBtn(e.target, "data-action");
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    if (action === "back") { flowBack(); return; }
    if (action === "done") { flowDone(); return; }
    flowPick(action, btn.getAttribute("data-value"));
  }

  function showConfirm(order) {
    var n = el("confirm-number"), t = el("confirm-total"), m = el("confirm-modal");
    if (n) n.textContent = "#" + order.number;
    if (t) t.textContent = fmt(order.totalCents);
    if (m) m.hidden = false;
  }

  function hideConfirm() {
    var m = el("confirm-modal");
    if (m) m.hidden = true;
  }

  function renderAll() {
    renderTabs();
    renderGrid();
    renderCart();
    renderTypeButtons();
    renderOrdersCount();
  }

  /* ---------------- events ---------------- */
  function closestBtn(target, attr) {
    var t = target;
    while (t) {
      if (t.getAttribute && t.getAttribute(attr) !== null) return t;
      t = t.parentElement || t.parentNode;
      if (t && t.nodeType !== 1) return null;
    }
    return null;
  }

  function onTabsClick(e) {
    var btn = closestBtn(e.target, "data-tab");
    if (!btn) return;
    state.tab = btn.getAttribute("data-tab");
    renderTabs();
    renderGrid();
  }

  function onGridClick(e) {
    var pizzaBtn = closestBtn(e.target, "data-pizza");
    if (pizzaBtn) { openSizePicker(pizzaBtn.getAttribute("data-pizza")); return; }
    var itemBtn = closestBtn(e.target, "data-name");
    if (itemBtn) {
      var cat = itemBtn.getAttribute("data-cat");
      var price = toCents(parseFloat(itemBtn.getAttribute("data-price")));
      if (cat === "wings" && MODS) {
        startWingFlow(itemBtn.getAttribute("data-name"), price);
      } else if (cat === "sandwiches" && MODS) {
        startSandwichFlow(itemBtn.getAttribute("data-name"), price);
      } else if (cat === "pasta" && MODS) {
        startPastaFlow(itemBtn.getAttribute("data-name"), price);
      } else {
        addToCart(itemBtn.getAttribute("data-name"), "", price, cat);
        renderCart();
      }
    }
  }

  function onJumpClick(e) {
    var chip = closestBtn(e.target, "data-group");
    if (!chip) return;
    var head = el("drink-group-" + chip.getAttribute("data-group"));
    if (head && head.scrollIntoView) head.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onCartClick(e) {
    var qtyBtn = closestBtn(e.target, "data-qty");
    if (qtyBtn) {
      changeQty(qtyBtn.getAttribute("data-key"), parseInt(qtyBtn.getAttribute("data-qty"), 10));
      renderCart();
      return;
    }
    var rmBtn = closestBtn(e.target, "data-remove");
    if (rmBtn) { removeLine(rmBtn.getAttribute("data-remove")); renderCart(); }
  }

  function onCartInput(e) {
    var input = e.target;
    if (input && input.getAttribute && input.getAttribute("data-notes") !== null) {
      setLineNotes(input.getAttribute("data-notes"), input.value);
    }
  }

  /* Saved orders are real customer orders, so removing one asks
     once ("Remove this order?") before deleting. */
  function onOrdersClick(e) {
    var rmBtn = closestBtn(e.target, "data-remove-order");
    if (!rmBtn) return;
    var number = parseInt(rmBtn.getAttribute("data-remove-order"), 10);
    if (isNaN(number)) return;
    var ok = (typeof window !== "undefined" && typeof window.confirm === "function")
      ? window.confirm("Remove this order?")
      : true;
    if (!ok) return;
    removeOrder(number);
    var list = el("orders-list");
    if (list) list.innerHTML = ordersHTML();
    renderOrdersCount();
  }

  function onTypeClick(e) {
    var btn = closestBtn(e.target, "data-type");
    if (!btn) return;
    state.orderType = btn.getAttribute("data-type");
    renderTypeButtons();
  }

  function onSizeOptionsClick(e) {
    var btn = closestBtn(e.target, "data-size");
    if (!btn || !state.pendingPizza) return;
    var sizeKey = btn.getAttribute("data-size");
    var pizzaName = state.pendingPizza.name;
    closeSizePicker();
    if (MODS) {
      startPizzaFlow(pizzaName, sizeKey);
    } else {
      /* modifiers.js missing — fall back to a plain pizza */
      addPizza(pizzaName, sizeKey);
      renderCart();
    }
  }

  function onSend() {
    var order = sendOrder();
    if (!order) return;
    var input = el("table-input");
    if (input) input.value = "";
    renderCart();
    renderOrdersCount();
    showConfirm(order);
  }

  function init() {
    if (typeof document === "undefined") return;
    var tabs = el("tabs"), grid = el("grid"), jump = el("drink-jump"),
        cart = el("cart-lines"), typeWrap = el("order-type"),
        tableInput = el("table-input"), send = el("send-btn"),
        clear = el("clear-btn"), ordersBtn = el("orders-btn"),
        back = el("back-btn"), sizeOpts = el("size-options"),
        sizeCancel = el("size-cancel"), confirmDone = el("confirm-done"),
        sizeModal = el("size-modal"), confirmModal = el("confirm-modal"),
        flowModal = el("flow-modal"), ordersList = el("orders-list");

    if (tabs) tabs.addEventListener("click", onTabsClick);
    if (grid) grid.addEventListener("click", onGridClick);
    if (jump) jump.addEventListener("click", onJumpClick);
    if (cart) {
      cart.addEventListener("click", onCartClick);
      cart.addEventListener("input", onCartInput);
    }
    if (ordersList) ordersList.addEventListener("click", onOrdersClick);
    if (typeWrap) typeWrap.addEventListener("click", onTypeClick);
    if (tableInput) {
      tableInput.addEventListener("input", function () { state.tableName = tableInput.value; });
    }
    if (send) send.addEventListener("click", onSend);
    if (clear) clear.addEventListener("click", function () { clearCart(); renderCart(); });
    if (ordersBtn) ordersBtn.addEventListener("click", function () { showView("orders"); });
    if (back) back.addEventListener("click", function () { showView("order"); });
    if (sizeOpts) sizeOpts.addEventListener("click", onSizeOptionsClick);
    if (sizeCancel) sizeCancel.addEventListener("click", closeSizePicker);
    if (confirmDone) confirmDone.addEventListener("click", hideConfirm);
    if (sizeModal) sizeModal.addEventListener("click", function (e) {
      if (e.target === sizeModal) closeSizePicker();
    });
    if (confirmModal) confirmModal.addEventListener("click", function (e) {
      if (e.target === confirmModal) hideConfirm();
    });
    if (flowModal) flowModal.addEventListener("click", function (e) {
      if (e.target === flowModal) { closeFlow(); return; }
      onFlowClick(e);
    });
    renderAll();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  /* ---------------- test / debug API ---------------- */
  var api = {
    state: state, TAX_RATE: TAX_RATE, SIZE_LABELS: SIZE_LABELS,
    toCents: toCents, fmt: fmt, esc: esc,
    categoryById: categoryById, pizzaByName: pizzaByName,
    displayName: displayName, modSet: modSet, modOptions: modOptions,
    modPrice: modPrice, toppingSetKey: toppingSetKey, splitHalfSet: splitHalfSet,
    buildPizzaLine: buildPizzaLine, buildHalfHalfLine: buildHalfHalfLine,
    buildWingLine: buildWingLine,
    buildSandwichLine: buildSandwichLine, buildPastaLine: buildPastaLine,
    addToCart: addToCart, addPizza: addPizza,
    changeQty: changeQty, removeLine: removeLine,
    setLineNotes: setLineNotes, clearCart: clearCart,
    cartTotals: cartTotals, sendOrder: sendOrder,
    loadOrders: loadOrders, todaysOrders: todaysOrders,
    removeOrder: removeOrder,
    nextOrderNumber: nextOrderNumber,
    tabsHTML: tabsHTML, gridHTML: gridHTML, drinkJumpHTML: drinkJumpHTML,
    cartLinesHTML: cartLinesHTML, ordersHTML: ordersHTML,
    renderAll: renderAll, showView: showView,
    openSizePicker: openSizePicker, closeSizePicker: closeSizePicker,
    startPizzaFlow: startPizzaFlow, startWingFlow: startWingFlow,
    startSandwichFlow: startSandwichFlow, startPastaFlow: startPastaFlow,
    closeFlow: closeFlow, renderFlow: renderFlow,
    flowPick: flowPick, flowBack: flowBack, flowDone: flowDone,
    finishPizzaFlow: finishPizzaFlow, finishWingFlow: finishWingFlow,
    finishSandwichFlow: finishSandwichFlow, finishPastaFlow: finishPastaFlow,
    HALF_HALF_FLAVOR: HALF_HALF_FLAVOR
  };
  if (typeof window !== "undefined") window.POS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
