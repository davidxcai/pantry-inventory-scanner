import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanBox, resolveShelf, startsChecked } from "./shelfScan.js";

const catalog = [
  { id: "1", name: "Barilla Spaghetti" },
  { id: "2", name: "Campbell's Chicken Noodle Soup" },
];
const p = (name: string, confidence: "high" | "medium" | "low" = "high", box = [0, 0, 100, 100]) => ({ name, brand: null, confidence, box });

test("matches known items, flags the rest as unknown", () => {
  const { detections } = resolveShelf([p("Barilla Spaghetti"), p("Heinz Ketchup")], catalog);
  assert.equal(detections[0].match, "matched");
  assert.equal(detections[0].item_id, "1");
  assert.equal(detections[1].match, "unknown");
});

test("two products resolving to the same item collapse", () => {
  const { detections } = resolveShelf([p("Barilla Spaghetti"), p("barilla spaghetti")], catalog);
  assert.equal(detections.length, 1);
});

test("the same unmatched or uncertain product seen twice is one row with both boxes", () => {
  const { detections } = resolveShelf(
    [
      p("Kraft Pasta Roni", "low", [0, 0, 100, 100]),
      p("Kraft Pasta-Roni", "high", [200, 0, 300, 100]),
      p("Barilla Whole Grain Spaghetti"),
      p("Barilla Whole Grain Spaghetti", "high", [500, 500, 600, 600]),
    ],
    catalog,
  );
  assert.equal(detections.length, 2);
  assert.equal(detections[0].match, "unknown");
  assert.equal(detections[0].confidence, "high");
  assert.deepEqual(detections[0].more_boxes, [[200, 0, 300, 100]]);
  assert.equal(detections[1].match, "candidates");
  assert.equal(detections[1].more_boxes?.length, 1);
});

test("blocked products are dropped and counted, never listed", () => {
  const { detections, dropped } = resolveShelf([p("Bud Light Beer"), p("Barilla Spaghetti")], catalog);
  assert.equal(dropped, 1);
  assert.deepEqual(detections.map((d) => d.name), ["Barilla Spaghetti"]);
});

test("a near match becomes candidates, not a match", () => {
  const { detections } = resolveShelf([p("Barilla Whole Grain Spaghetti")], catalog);
  assert.equal(detections[0].match, "candidates");
  assert.equal(detections[0].candidates[0].item_id, "1");
});

test("only confident matches start ticked", () => {
  const [hi] = resolveShelf([p("Barilla Spaghetti", "high")], catalog).detections;
  const [lo] = resolveShelf([p("Barilla Spaghetti", "low")], catalog).detections;
  assert.equal(startsChecked(hi), true);
  assert.equal(startsChecked(lo), false);
});

test("cleanBox clamps and orders", () => {
  assert.deepEqual(cleanBox([900, 1200, -5, 40]), [0, 40, 900, 1000]);
});
