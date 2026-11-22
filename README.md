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
| `app.js` | Cart, totals (6% tax), size picker, send-to-kitchen (demo), Orders view |
| `menu.js` | Menu data — **generated, do not hand-edit** (see below) |
| `generate_menu.py` | Builds `menu.js` from the Square Item Library CSV export |

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
- **No topping prices.** The export lists which modifier sets apply, not
  the topping choices or their prices. Pizzas get size selection only;
  every line has a free-text notes field ("extra cheese", "no onions").
  Real modifier options need the Square API later.
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

## How it works

1. Tap a category tab, tap items to add them. Tapping a pizza opens the
   size picker (12"/16"/18"/GF 10") with per-size prices.
2. The order panel (right side) shows lines with quantity +/-, a notes
   field per line, and Remove. Subtotal, 6% sales tax, and total update
   live. Money is kept in integer cents to avoid rounding errors.
3. Pick Dine-in or Pickup, enter a table number or name, tap
   **Send to kitchen**. The order is saved on this iPad and a
   confirmation shows the order number and total.
4. **Orders** (top right) lists today's sent orders from this iPad.

## Wiring it up later (Square)

`sendOrder()` in app.js is the one place orders leave the app — replace
its localStorage save with a Square Orders API create-order call, and
have the kitchen display (`beacon-kds`) read the same orders. The order
shape already matches what the KDS expects. Needs a Square developer app
(OAuth) authorized by the owner; do not attempt a live Square connection
until then. Cross-iPad order numbers and bump sync come with that step.
