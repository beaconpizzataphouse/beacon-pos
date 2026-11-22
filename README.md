# Beacon POS — Front Counter Order Screen

A simple tap-first order screen for the iPads at Beacon Pizza & Tap House's
front counter. Dependency-free static site (HTML + CSS + JS, no build step,
no login), published on GitHub Pages like the count app and the kitchen
display.

**Status: DEMO.** Orders are saved to the iPad's own localStorage and do
NOT reach the kitchen. Payment stays in Square — this screen takes the
order only. There is no payment flow here, by design.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page shell: demo banner, tabs, item grid, order panel, modals |
| `style.css` | Light, clean front-counter look; big touch targets; cart on the right in landscape, stacked below the menu in portrait |
| `app.js` | Cart, totals (6% tax), size picker, modifier flows, send-to-kitchen (demo), Orders view, Reports view |
| `menu.js` | Menu data — **generated, do not hand-edit** (see below) |
| `generate_menu.py` | Builds `menu.js` from the Square Item Library CSV export |
| `modifiers.json` | Modifier lists read from the Square Dashboard (27 sets, 562 options with prices) |
| `modifiers.js` | Modifier data — **generated, do not hand-edit** (see below) |
| `generate_modifiers.py` | Builds `modifiers.js` from `modifiers.json` |
| `pos-test.js` | Regression harness (95 checks): menu, cart, tax, orders, reports — run with `node pos-test.js` |
| `pos-modifiers-test.js` | Modifier-flow harness (217 checks): topping/wing/sandwich/pasta math, flows, merge rules, report modifier revenue — run with `node pos-modifiers-test.js` |

## Modifier source

`modifiers.js` is generated from `modifiers.json`, which was read from
the Square Dashboard > Items > Modifiers (read-only, Nov 22 2026):
whole-pizza topping sets per size (29 options each), half-pizza sets
per side per size (42 each = 29 toppings + 13 specialty-pizza halves),
wing flavors (9, all free), celery choice, All Flats (+$3.00),
sauces on the side ($0.15), plus cheese/meats/veggie/pasta sets for
later. Every price is exact — nothing is hand-copied. To refresh,
re-read the Dashboard into `modifiers.json` and re-run
`generate_modifiers.py`.

**Known Square quirk:** Left Side 10" Chicken Bacon Ranch is **$310.00**
in Square (every other size/side is $2.60–$3.25) — almost certainly a
typo. Vince (Nov 22 2026) said to leave Square alone and fix it in
ours, so `modifiers.json` / `modifiers.js` use **$3.10**; Square itself
still shows $310.00 and has NOT been changed. Do not "correct" our
$3.10 back to $310.00.

## Modifier flows (pizza + wings + sandwiches + pasta)

One question per window, big buttons, Back on every step:

1. **Build Your Own pizza:** tap pizza → size picker → coverage
   (Whole / Left half / Right half) → topping picker from the right
   set for that size + coverage. For a half, Done on the first half
   walks to the other half ("Now the right half"), so both halves
   get toppings; Done with nothing picked leaves that half cheese
   only. Back from the second half returns to the first half with
   its picks kept. Toppings toggle on/off, each shows its price.
   For halves, toppings come first, then a "Specialty half" section
   with the 13 specialty halves. The line shows both halves
   (e.g. `16" BYO — Left: Pepperoni; Right: Hawaiian`).
2. **Specialty pizzas:** after the size picker, "Add extra toppings?"
   offers Whole pizza / Left half / Right half / No extra toppings.
   Whole uses the whole-pizza set for that size; a half walks both
   halves exactly like Build Your Own (finish one half, get offered
   the other, with the Specialty half section on each). The line
   shows only halves that have picks
   (e.g. `18" Hawaiian — Left: Jalapeños; Right: Olives`; one half
   only reads `18" Hawaiian — Left: Jalapeños`) — no "cheese only"
   for an untouched half, since the base pizza already covers it.
   "No extra toppings" (or Done with none chosen) rings up the plain
   pizza, as before.
3. **Wings** (Bone-in; Boneless 5/10/15): tap wing item → flavor
   picker (9 flavors, required, all free) → if "1/2 & 1/2", a second
   picker for the two half flavors (exactly 2) → celery choice
   (Celery / No Celery, required) → one extras screen: flats/drums
   (bone-in only), spicy dry rub, extra sauces on the side ($0.15
   each). The line shows flavor + choices
   (e.g. `Buffalo · Celery · All Flats · + BBQ on the side`).
4. **Sandwiches:** tap a sandwich → cheese picker (7 cheeses,
   $0.50 each) → veggie add-ons (13, $0.60 each — lettuce,
   tomatoes, pickles, ...) → meats (7, e.g. Bacon $2.50, Prime
   Rib $9.00). Each step is multi-pick with a Done button; Done
   with nothing picked means no change on that step, and "No
   changes" on the first step adds the sandwich plain. The line
   shows the additions (e.g. `+ Swiss, Lettuce, Tomatoes, Bacon`).
   Square's data has **no condiment set and no "No ..." removal
   option**, so condiments and removals (e.g. no tomato) stay in
   the line's Notes field — nothing was invented for them.
5. **Pastas:** tap a pasta → sauce (Red / Alfredo free, Pink
   Sauce +$1.00) → noodle (Angel Hair / Spaghetti / Gluten Free,
   all free) → add-ins (17, e.g. Chicken $1.50, Anchovies $4.50).
   Sauce and noodle are single-pick with a Skip button (skipped
   means kept as it comes); add-ins are multi-pick. "No changes"
   on the first step adds the pasta plain. The line shows the
   choices (e.g. `Pink Sauce · Gluten Free · + Chicken, Broccoli`).

Modifier prices flow into the line total, subtotal, 6% tax, and
total (integer cents throughout). Lines with different modifiers
stay separate; identical lines merge. The notes field still works
on every line. If `modifiers.js` fails to load, pizzas, wings,
sandwiches, and pastas fall back to the old plain add (no flow)
so ordering never breaks.

## Sales report

**Reports** (top right, next to Orders) reads the same saved
orders as the Orders view — orders taken on THIS iPad only — and
turns them into a Square-style sales report. No fake data: with
no orders it shows zeros and "No orders sent yet."

- **Period toggle:** Today / This week (last 7 days, calendar
  days — an order exactly at midnight 6 days ago counts, one
  millisecond before it doesn't).
- **Summary cards:** Gross sales (item prices before tax, like
  Square's Gross Sales), Orders (count), Average sale
  (gross ÷ orders). No Net/Discounts/Refunds — the app has no
  discounts or refunds, so none are shown.
- **Top items:** top 10, Gross / Count toggle. Pizzas are listed
  by size, e.g. `18″ Beacon Supreme`. Modifier prices are already
  folded into each line's price, so they count toward the item's
  gross (a $29.55 half-and-half Hawaiian counts as $29.55).
- **Top categories:** Gross / Count toggle. Categories come from
  a menu lookup by item name (names are unique across
  categories); an item no longer on the menu falls under "Other".
- **Sales by hour** (Today — only hours with sales) and **Sales
  by day** (This week — all 7 days, oldest first, $0.00 days
  shown). Plain CSS bars, no chart library.
- The view carries two honest notes: "Totals cover orders taken
  on this iPad only" and "Card/cash and fees come with the Square
  link-up" — payment still happens in Square, so there is no
  payment-type split yet, and the "vs previous Saturday"
  comparison waits until there is history to compare.

## Next steps (not built yet)

- **Pasta/sandwich extras Square doesn't price:** the sets have no
  extra-bread or soda-upgrade option, so those stay as notes.
- **Condiments:** no condiment set exists in Square's modifier
  data. If Vince wants mayo/mustard/etc. as tappable options,
  the set has to be created in Square first, then read into
  `modifiers.json` like the others — do not invent prices.

## Menu source

`menu.js` is generated from `../beacon-kds/square-catalog-2026-11-21.csv`
(351 active Square items) by `generate_menu.py`. Every price is exact —
nothing is hand-copied. To refresh after a new Square export, drop the new
CSV next to the script (or update the `SRC` path) and re-run it.

Result: **280 menu entries** — 14 specialty pizzas (12"/16"/18" + GF 10"
cauliflower crust), 9 sandwiches, 4 wing items, 9 pastas, 3 salad bar
options, 15 apps & sides, 2 soups, 2 desserts, 222 drinks in 12 groups
(Draft, Cans, Bottled Beer, Pitchers, Growlers, Wine by the Glass/Bottle,
Seltzers, Cider, NA Beer, Soda & More, Kegs).

## Judgment calls (from the CSV's quirks)

- **Gluten-free duplicates.** Each GF pizza appears twice in Square: a
  "Gluten Free" variation row (the true 10" cauliflower price) and a
  "Regular" row priced like the 12". The generator uses the "Gluten Free"
  row where it exists; Mexican, Buffalo Chicken, and Chicken Bacon Ranch
  have only the "Regular" GF row, so that price is used for those three.
- **Topping prices are in.** The Square export lists which modifier
  sets apply, not the topping choices or prices — those were read
  from the Dashboard's modifier pages into `modifiers.json` (Nov 22
  2026). Square's topping prices do NOT rise smoothly with size
  (Extra Cheese $1.00/$1.25/$0.75/$1.00 across 10/12/16/18) and
  left/right half prices differ slightly in places — all recorded
  exactly as shown, never smoothed.
- **Flats/drums is bone-in only.** Boneless wings have no flats or
  drums, so the All Flats / All Drums choice appears only for
  Bone-in Wings. Dry rub and sauces on the side are offered for
  both.
- **Half-and-half wings** use Square's separate half-flavor list
  (8 options). "1/2 Vinces Wings" has a blank price in Square —
  treated as $0.00 like every other half flavor.
- **Salads are a salad bar** ("All You Can Eat" $15.99 / "Single Serve"
  $9.99 / "To Go" $13.99), labelled "Salad Bar — …" so tickets read clearly.
- **Boneless wings** are 5/10/15 pieces ($7.99/$13.99/$18.99); Bone-in
  Wings ($18.99) has no count in Square.
- **Hot Honey appears twice** in Square ($4.00 and $6.00) — both buttons
  are shown, distinguished by price. Square gives no other difference.
- **Uncategorized items placed by judgment:** the three kegs under Drinks
  → Kegs; two draft beers missing a category (Hell or High Watermelon
  Hefe, October fest Marzen) under Draft; 16 oz Fountain Drink and Red
  Bull Blaster/Lotus under Soda & More; Corn/Flour Tortilla, Parmesan
  Garlic Bites, and the Prime Rib Dinner Special under Apps & Sides.
- **Excluded (18 rows):** all Merchandise (glass, mug, hoodies,
  sweatshirts, T-shirts, Employee Hoodie, variable-price Gift Card) —
  there is no Merch tab, so merch still rings up in Square; Rebel - Mocha
  (variable price, cannot be priced); Super Bowl Buy-In (event item);
  Salad Fixings ($100) and Square Spots ($1) (internal/odd items, not
  customer menu items).
- **Order numbers** start at 101 and count up per iPad (localStorage).
  They will collide across iPads until orders go through Square.
- **Cart-line keys use \u001F, not \u0000.** Keys go into data-*
  attributes in the cart HTML, and the HTML parser replaces NUL in
  attribute values with U+FFFD — so with \u0000 separators, Remove,
  qty +/-, and notes silently did nothing in the browser (the node
  tests never caught it because they call the functions directly).
  \u001F survives parsing and can't be typed on the iPad keyboard.

## How it works

1. Tap a category tab, tap items to add them. Tapping a pizza opens the
   size picker (12"/16"/18"/GF 10") with per-size prices, then the
   topping flow: whole / left / right for extra toppings on every
   pizza (specialty pizzas can also skip toppings entirely). Tapping
   wings opens the flavor flow (flavor → celery → extras). Tapping
   a sandwich opens cheese → veggies → meats; tapping a pasta opens
   sauce → noodle → add-ins. Every step is skippable, and "No
   changes" on the first step adds the item plain. Other items add
   straight to the order.
2. The order panel (right side) shows lines newest first, so what
   was just added sits at the top without scrolling. Each line has
   quantity +/-, a notes field, and Remove. Subtotal, 6% sales tax,
   and total update live. Money is kept in integer cents to avoid
   rounding errors.
3. Pick Dine-in or Pickup, enter a table number or name, tap
   **Send to kitchen**. The order is saved on this iPad and a
   confirmation shows the order number and total.
4. **Orders** (top right) lists today's sent orders from this iPad.
   Each order card has a Remove button, which asks once ("Remove
   this order?") before deleting — saved orders are real customer
   orders, so removal is deliberate.
5. **Reports** (top right) shows gross sales, order count, and
   average sale for Today or This week, plus top items, top
   categories, and sales by hour/day — all from the orders saved
   on this iPad. See "Sales report" above.

## Wiring it up later (Square)

`sendOrder()` in app.js is the one place orders leave the app — replace
its localStorage save with a Square Orders API create-order call, and
have the kitchen display (`beacon-kds`) read the same orders. The order
shape already matches what the KDS expects. Needs a Square developer app
(OAuth) authorized by the owner; do not attempt a live Square connection
until then. Cross-iPad order numbers and bump sync come with that step.
