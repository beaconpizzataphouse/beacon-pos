/* ================================================================
   BEACON POS — front counter order screen
   ----------------------------------------------------------------
   DEMO ONLY. Orders are saved to this iPad's localStorage and do
   NOT reach the kitchen. Payment stays in Square — this screen
   takes the order only; there is no payment flow here.

   Menu data comes from menu.js, generated from the Square Item
   Library export (see generate_menu.py). Prices are exact Square
   prices. Topping/modifier options are NOT in the Square export,
   so pizzas get size selection only and every line gets a
   free-text notes field instead (e.g. "extra cheese").

   Money is handled in integer cents everywhere to avoid float
   rounding. Tax is 6% (Square's Sales Tax rate in the export).

   TO WIRE UP SQUARE LATER: replace sendOrder()'s localStorage
   save with a Square Orders API create-order call, and have the
   kitchen display (beacon-kds) read the same orders. The order
   shape below already matches what the KDS expects:
     { number, type: "dine-in"|"pickup", name,
       items: [{ name, size, qty, priceCents, notes }],
       subtotalCents, taxCents, totalCents, placedAt, status }
   ================================================================ */
(function () {
  "use strict";

  var MENU = (typeof window !== "undefined" && window.BEACON_MENU) || null;
  var TAX_RATE = MENU ? MENU.taxRate : 0.06;

  var ORDERS_KEY = "beacon-pos-orders-v1";
  var COUNTER_KEY = "beacon-pos-counter-v1";
  var FIRST_ORDER_NUMBER = 101;

  var SIZE_LABELS = { "12": "12\u2033", "16": "16\u2033", "18": "18\u2033", "gf": "GF 10\u2033" };
  var SIZE_ORDER = ["12", "16", "18", "gf"];

  var state = {
    tab: "pizzas",
    view: "order",          // "order" | "orders"
    cart: [],               // { key, name, size, priceCents, qty, notes, category }
    orderType: "dine-in",
    tableName: "",
    pendingPizza: null,     // pizza awaiting a size choice
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

  /* ---------------- cart ---------------- */
  function lineKey(name, size, notes) {
    return name + "\u0000" + (size || "") + "\u0000" + (notes || "");
  }

  function addToCart(name, size, priceCents, category) {
    var key = lineKey(name, size, "");
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].key === key) { state.cart[i].qty += 1; return state.cart[i]; }
    }
    var line = { key: key, name: name, size: size || "", priceCents: priceCents,
                 qty: 1, notes: "", category: category || "" };
    state.cart.push(line);
    return line;
  }

  function addPizza(pizzaName, sizeKey) {
    var cat = categoryById("pizzas");
    if (!cat) return null;
    for (var i = 0; i < cat.items.length; i++) {
      if (cat.items[i].name === pizzaName) {
        var price = cat.items[i].sizes[sizeKey];
        if (price == null) return null;
        return addToCart(pizzaName, SIZE_LABELS[sizeKey] || sizeKey, toCents(price), "pizza");
      }
    }
    return null;
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
    line.key = lineKey(line.name, line.size, notes);
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
                 priceCents: l.priceCents, notes: l.notes };
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

  function cartLinesHTML() {
    return state.cart.map(function (l) {
      var sizePart = l.size ? ' <span class="line-size">' + esc(l.size) + "</span>" : "";
      return '<div class="cart-line">' +
        '<div class="line-top"><span class="line-name">' + esc(l.name) + sizePart + "</span>" +
        '<span class="line-total">' + fmt(l.priceCents * l.qty) + "</span></div>" +
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
        var notes = it.notes ? ' <em>(' + esc(it.notes) + ")</em>" : "";
        return "<li>" + it.qty + " &times; " + esc(it.name) + size + notes + "</li>";
      }).join("");
      return '<div class="order-card">' +
        '<div class="order-card-top"><span class="order-num">Order #' + o.number + "</span>" +
        '<span class="order-total">' + fmt(o.totalCents) + "</span></div>" +
        '<div class="order-meta">' + time + " &middot; " +
        (o.type === "dine-in" ? "Dine-in" : "Pickup") + who + "</div>" +
        '<span class="order-status">' + esc(o.status) + " (demo)</span>" +
        "<ul class='order-items'>" + items + "</ul></div>";
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
      addToCart(itemBtn.getAttribute("data-name"), "",
        toCents(parseFloat(itemBtn.getAttribute("data-price"))),
        itemBtn.getAttribute("data-cat"));
      renderCart();
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

  function onTypeClick(e) {
    var btn = closestBtn(e.target, "data-type");
    if (!btn) return;
    state.orderType = btn.getAttribute("data-type");
    renderTypeButtons();
  }

  function onSizeOptionsClick(e) {
    var btn = closestBtn(e.target, "data-size");
    if (!btn || !state.pendingPizza) return;
    addPizza(state.pendingPizza.name, btn.getAttribute("data-size"));
    closeSizePicker();
    renderCart();
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
        sizeModal = el("size-modal"), confirmModal = el("confirm-modal");

    if (tabs) tabs.addEventListener("click", onTabsClick);
    if (grid) grid.addEventListener("click", onGridClick);
    if (jump) jump.addEventListener("click", onJumpClick);
    if (cart) {
      cart.addEventListener("click", onCartClick);
      cart.addEventListener("input", onCartInput);
    }
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
    categoryById: categoryById,
    addToCart: addToCart, addPizza: addPizza,
    changeQty: changeQty, removeLine: removeLine,
    setLineNotes: setLineNotes, clearCart: clearCart,
    cartTotals: cartTotals, sendOrder: sendOrder,
    loadOrders: loadOrders, todaysOrders: todaysOrders,
    nextOrderNumber: nextOrderNumber,
    tabsHTML: tabsHTML, gridHTML: gridHTML, drinkJumpHTML: drinkJumpHTML,
    cartLinesHTML: cartLinesHTML, ordersHTML: ordersHTML,
    renderAll: renderAll, showView: showView,
    openSizePicker: openSizePicker, closeSizePicker: closeSizePicker
  };
  if (typeof window !== "undefined") window.POS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
