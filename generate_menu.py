#!/usr/bin/env python3
"""Generate menu.js for the Beacon POS order screen from the Square catalog export.

Source: ../beacon-kds/square-catalog-2026-11-21.csv (351 active items).
Every price in menu.js comes from the CSV — nothing is hand-copied.

Usage: python3 generate_menu.py   (writes menu.js next to this script)

RULES
- Active items only (Archived != 'Y').
- Pizzas: one entry per specialty pizza with per-size prices 12"/16"/18"
  plus GF 10" cauliflower crust. Square stores each size as its own row,
  so rows are grouped by normalized pizza name.
  GF price rule: the "Gluten Free" variation row is the true 10" cauliflower
  price; where a pizza has only the "Regular" row in the Gluten Free Pizzas
  category (Mexican, Buffalo Chicken, Chicken Bacon Ranch), that price is
  used. The "Regular" GF rows are otherwise $1 more than the GF rows and
  match the 12" price, i.e. stale duplicates — they are NOT used when a
  "Gluten Free" row exists.
- Drinks are grouped by Square category under the Drinks tab.
- Excluded (documented in README.md):
    * All Merchandise (13 rows) — no Merch tab on the order screen;
      includes the variable-price Gift Card.
    * 'Rebel - Mocha' (Bottled Beer, variable price — cannot be priced).
    * 'Super Bowl Buy-In' (event item, 2 rows).
    * 'Salad Fixings' ($100) and 'Square Spots' ($1) — internal/odd items,
      not customer menu items.
- Uncategorized items are placed by judgment (see PLACEMENTS below).
- 'Hot Honey' appears twice in Square ($4.00 and $6.00, the second with a
  trailing space in the name) — both rows are kept, distinguished by price.
"""
import csv
import json
import re
from collections import OrderedDict

SRC = "../beacon-kds/square-catalog-2026-11-21.csv"
OUT = "menu.js"

# Uncategorized items -> (tab, group) placement. Everything else uncategorized
# would raise, so a new Square item never silently vanishes.
PLACEMENTS = {
    "16 oz Fountain Drink": ("drinks", "Soda & More"),
    "2 Towns Prickly Pearadise Keg": ("drinks", "Kegs"),
    "Coors Banquet Keg": ("drinks", "Kegs"),
    "FW 805 Keg": ("drinks", "Kegs"),
    "Corn Tortilla": ("apps", None),
    "Flour Tortilla": ("apps", None),
    "Hell or High Watermelon Hefe": ("drinks", "Draft"),
    "October fest Marzen": ("drinks", "Draft"),
    "Parmesan Garlic Bites": ("apps", None),
    "Prime Rib Dinner Special": ("apps", None),
    "Red Bull Blaster/Lotus": ("drinks", "Soda & More"),
}

EXCLUDE = {
    "Super Bowl Buy-In",
    "Super Bowl Buy-IN",
    "Salad Fixings",
    "Square Spots",
    "Rebel - Mocha",  # variable price
}

# Square category -> (tab, drink group label or None)
CATEGORY_MAP = {
    "Sandwich, Sandwiches": ("sandwiches", None),
    "Pasta, Pastas": ("pasta", None),
    "BONELESS WINGS, Chicken Wings": ("wings", None),
    "Chicken Wings": ("wings", None),
    "Salad, Salads": ("salad", None),
    "Sides": ("apps", None),
    "Appetizers": ("apps", None),
    "Soups": ("soups", None),
    "Dessert": ("desserts", None),
    "Draft": ("drinks", "Draft"),
    "Can Alcohol": ("drinks", "Cans"),
    "Growler": ("drinks", "Growlers"),
    "Pitchers": ("drinks", "Pitchers"),
    "Bottled Beer": ("drinks", "Bottled Beer"),
    "Wine by the glass": ("drinks", "Wine by the Glass"),
    "Wine by the bottle": ("drinks", "Wine by the Bottle"),
    "Seltzers": ("drinks", "Seltzers"),
    "Cider": ("drinks", "Cider"),
    "NA Beer": ("drinks", "NA Beer"),
    "Beverage": ("drinks", "Soda & More"),
    "Draft, Sides": ("drinks", "Soda & More"),  # Side of Clamato / Side of OJ
}

DRINK_GROUP_ORDER = [
    "Draft", "Cans", "Bottled Beer", "Pitchers", "Growlers",
    "Wine by the Glass", "Wine by the Bottle", "Seltzers", "Cider",
    "NA Beer", "Soda & More", "Kegs",
]

SIZE_RE = re.compile(r'^(\d+)[\"\u201d]\s*(.*)$')
GF_RE = re.compile(r'^Gluten Free\s+(.*)$', re.IGNORECASE)


def clean_name(name):
    """Normalize a pizza name: strip size prefix, 'Gluten Free' prefix,
    trailing ' Pizza', and parentheticals like '(Meat Eater)'."""
    n = name.strip()
    m = SIZE_RE.match(n)
    if m:
        n = m.group(2).strip()
    m = GF_RE.match(n)
    if m:
        n = m.group(1).strip()
    n = re.sub(r"\s*\([^)]*\)\s*$", "", n).strip()
    n = re.sub(r"\s+Pizza$", "", n, flags=re.IGNORECASE).strip()
    return n


def display_name(name, tab):
    """Display name for a non-pizza item. Mostly the Square name, with a
    few readability fixes that never change the price or identity."""
    n = name.strip()
    if tab == "wings":
        m = re.match(r"^(\d+)\s+pieces\s+BONELESS WINGS$", n, re.IGNORECASE)
        if m:
            return "Boneless Wings — %s pc" % m.group(1)
    if tab == "salad":
        pretty = {
            "All you can eat": "All You Can Eat",
            "Single Serve": "Single Serve",
            "To Go Salad": "To Go",
        }
        return "Salad Bar — " + pretty.get(n, n)
    if n.lower() == "big cookies":
        return "BIG Cookies"
    return n


def price_of(row):
    try:
        return float(row["Price"])
    except (ValueError, TypeError):
        return None


def main():
    with open(SRC, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    active = [r for r in rows if r["Archived"] != "Y"]
    pizzas = {}   # normalized name -> {"12": p, "16": p, "18": p, "gf": p}
    gf_regular = {}  # fallback GF price from the "Regular" GF row
    tabs = OrderedDict([
        ("sandwiches", []),
        ("wings", []),
        ("pasta", []),
        ("salad", []),
        ("apps", []),
        ("soups", []),
        ("desserts", []),
    ])
    drink_groups = OrderedDict((g, []) for g in DRINK_GROUP_ORDER)
    excluded, used_rows = [], 0

    for r in active:
        name = r["Item Name"].strip()
        cats = r["Categories"]
        price = price_of(r)

        if name in EXCLUDE or "Merchandise" in cats:
            excluded.append(name)
            continue

        # ---- Pizzas: group sized rows + GF rows by normalized name ----
        if "Pizza" in cats or "pizza" in name.lower():
            base = clean_name(name)
            if base not in pizzas:
                pizzas[base] = {}
            m = SIZE_RE.match(name.strip())
            if m:
                pizzas[base][m.group(1)] = price
            elif name.strip().lower().startswith("gluten free"):
                if r["Variation Name"] == "Gluten Free":
                    pizzas[base]["gf"] = price
                else:
                    gf_regular.setdefault(base, price)
            else:
                raise SystemExit("Unparsed pizza row: %r" % name)
            used_rows += 1
            continue

        # ---- Everything else: map by category or placement ----
        if cats in CATEGORY_MAP:
            tab, group = CATEGORY_MAP[cats]
        elif not cats and name in PLACEMENTS:
            tab, group = PLACEMENTS[name]
        else:
            raise SystemExit("No placement for %r (categories %r)" % (name, cats))

        if price is None:
            raise SystemExit("Unpriced item included: %r" % name)
        item = {"name": display_name(name, tab), "price": price}
        if tab == "drinks":
            drink_groups[group].append(item)
        else:
            tabs[tab].append(item)
        used_rows += 1

    # GF fallback: pizzas with only a "Regular" GF row use that price.
    for base, entry in pizzas.items():
        if "gf" not in entry and base in gf_regular:
            entry["gf"] = gf_regular[base]

    # Sanity: every pizza must have all four sizes.
    for base, entry in sorted(pizzas.items()):
        missing = [s for s in ("12", "16", "18", "gf") if s not in entry]
        if missing:
            raise SystemExit("Pizza %r missing sizes %s" % (base, missing))

    # Sort: pizzas alphabetically; other tabs alphabetically by name;
    # drink groups keep Square's order within each group (alphabetical).
    pizza_items = [
        {"name": base, "sizes": {s: pizzas[base][s] for s in ("12", "16", "18", "gf")}}
        for base in sorted(pizzas)
    ]
    for tab_items in tabs.values():
        tab_items.sort(key=lambda i: i["name"].lower())
    for group_items in drink_groups.values():
        group_items.sort(key=lambda i: i["name"].lower())

    categories = [
        {"id": "pizzas", "label": "Pizzas", "kind": "pizzas", "items": pizza_items},
        {"id": "sandwiches", "label": "Sandwiches", "items": tabs["sandwiches"]},
        {"id": "wings", "label": "Wings", "items": tabs["wings"]},
        {"id": "pasta", "label": "Pasta", "items": tabs["pasta"]},
        {"id": "salad", "label": "Salad Bar", "items": tabs["salad"]},
        {"id": "apps", "label": "Apps & Sides", "items": tabs["apps"]},
        {"id": "soups", "label": "Soups", "items": tabs["soups"]},
        {"id": "desserts", "label": "Desserts", "items": tabs["desserts"]},
        {"id": "drinks", "label": "Drinks", "kind": "grouped",
         "groups": [{"label": g, "items": items}
                    for g, items in drink_groups.items() if items]},
    ]

    menu = {
        "generatedFrom": "square-catalog-2026-11-21.csv (Square Item Library export, Nov 21 2026)",
        "taxRate": 0.06,
        "categories": categories,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* Beacon POS — menu data.\n")
        f.write("   Generated by generate_menu.py from the Square Item Library export\n")
        f.write("   (square-catalog-2026-11-21.csv). Do not hand-edit prices here;\n")
        f.write("   re-run generate_menu.py after a fresh export.\n")
        f.write("   Prices are in dollars, exactly as Square lists them.\n")
        f.write("   Pizzas carry per-size prices: 12\"/16\"/18\" plus GF 10\" cauliflower.\n")
        f.write("   Modifier/topping options are NOT in the export, so no topping\n")
        f.write("   prices exist in this file — the app uses free-text notes instead.\n")
        f.write("*/\n")
        f.write("window.BEACON_MENU = ")
        f.write(json.dumps(menu, indent=2, ensure_ascii=False))
        f.write(";\n")

    n_entries = len(pizza_items) + sum(len(v) for v in tabs.values()) \
        + sum(len(g["items"]) for g in categories[-1]["groups"])
    print("active rows: %d | rows used: %d | rows excluded: %d"
          % (len(active), used_rows, len(excluded)))
    print("menu entries: %d (pizzas %d, food %d, drinks %d)"
          % (n_entries, len(pizza_items),
             sum(len(v) for v in tabs.values()),
             sum(len(g["items"]) for g in categories[-1]["groups"])))
    print("excluded: %s" % sorted(set(excluded)))
    for c in categories:
        if c["id"] == "drinks":
            print("  drinks groups: " + ", ".join(
                "%s %d" % (g["label"], len(g["items"])) for g in c["groups"]))
        else:
            print("  %s: %d" % (c["id"], len(c["items"])))


if __name__ == "__main__":
    main()
