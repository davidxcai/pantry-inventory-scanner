import { test } from "node:test";
import assert from "node:assert/strict";
import { filterCatalog, type CatalogRow } from "./catalogView";

const row = (o: Partial<CatalogRow> & { name: string }): CatalogRow => ({
  id: o.name,
  category: "snacks",
  thumbnail_path: null,
  availability: "in_stock",
  updated_at: null,
  updated_by_name: null,
  ...o,
});

const rows = [
  row({ name: "Ritz Crackers", availability: "low" }),
  row({ name: "Barilla Spaghetti", category: "pasta_grains_rice", availability: "out" }),
  row({ name: "Café Mocha", category: "beverages" }),
  row({ name: "Apple Juice", category: "beverages" }),
];
const base = { search: "", category: null, hideOut: false };
const names = (r: CatalogRow[]) => r.map((x) => x.name);

test("most recently updated first, never-updated last, ties by name", () => {
  const dated = [
    row({ name: "Never Updated" }),
    row({ name: "Old", updated_at: "2026-01-01T00:00:00Z" }),
    row({ name: "New", updated_at: "2026-03-01T00:00:00Z", availability: "out" }),
    row({ name: "Also Never" }),
  ];
  assert.deepEqual(names(filterCatalog(dated, base)), ["New", "Old", "Also Never", "Never Updated"]);
});

test("search ignores accents and case, and matches category words", () => {
  assert.deepEqual(names(filterCatalog(rows, { ...base, search: "CAFE" })), ["Café Mocha"]);
  assert.deepEqual(names(filterCatalog(rows, { ...base, search: "pasta spag" })), ["Barilla Spaghetti"]);
});

test("category filter and hide out of stock", () => {
  assert.deepEqual(names(filterCatalog(rows, { ...base, category: "beverages" })), ["Apple Juice", "Café Mocha"]);
  assert.equal(filterCatalog(rows, { ...base, hideOut: true }).some((r) => r.availability === "out"), false);
});
