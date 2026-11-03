import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupDigests,
  renderDigest,
  unsubscribeToken,
  verifyUnsubscribeToken,
  type QueuedNotification,
} from "./notifyDigest";

const row = (over: Partial<QueuedNotification>): QueuedNotification => ({
  id: 1,
  user_id: "u1",
  item_id: "rice",
  item_name: "Rice",
  status: "in_stock",
  kind: "report",
  created_at: "2026-11-01T12:00:00Z",
  ...over,
});

test("one digest per user", () => {
  const digests = groupDigests([row({ id: 1 }), row({ id: 2, user_id: "u2" }), row({ id: 3, item_id: "beans", item_name: "Beans" })]);
  assert.equal(digests.length, 2);
  const u1 = digests.find((d) => d.userId === "u1")!;
  assert.deepEqual(u1.items.map((i) => i.name), ["Beans", "Rice"]);
  assert.deepEqual(u1.rowIds, [1, 3]);
});

test("several updates to one item collapse to the latest, but every row is covered", () => {
  const [d] = groupDigests([
    row({ id: 1, status: "low", created_at: "2026-11-01T12:00:00Z" }),
    row({ id: 3, status: "in_stock", kind: "confirm", created_at: "2026-11-01T12:09:00Z" }),
    row({ id: 2, status: "out", created_at: "2026-11-01T12:05:00Z" }),
  ]);
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].status, "in_stock");
  assert.equal(d.items[0].kind, "confirm");
  assert.deepEqual(d.rowIds, [1, 3, 2]);
});

test("same timestamp: the later row wins", () => {
  const [d] = groupDigests([row({ id: 5, status: "low" }), row({ id: 4, status: "out" })]);
  assert.equal(d.items[0].status, "low");
});

test("subject names a single item, counts several", () => {
  const one = renderDigest([{ itemId: "r", name: "Rice", status: "in_stock", kind: "report" }], links);
  assert.equal(one.subject, "Rice: in stock");
  const two = renderDigest(
    [
      { itemId: "r", name: "Rice", status: "in_stock", kind: "report" },
      { itemId: "b", name: "Beans", status: "low", kind: "confirm" },
    ],
    links,
  );
  assert.equal(two.subject, "2 wishlist products are available");
  assert.match(two.text, /Beans: Low \(confirmed/);
  assert.match(two.text, /Rice: In stock \(reported/);
});

const links = { app: "https://x.test/", wishlist: "https://x.test/wishlist", unsubscribe: "https://x.test/u?t=1" };

test("item names are escaped in html", () => {
  const { html } = renderDigest([{ itemId: "r", name: "<b>Rice</b> & Co", status: "low", kind: "report" }], links);
  assert.ok(html.includes("&lt;b&gt;Rice&lt;/b&gt; &amp; Co"));
  assert.ok(!html.includes("<b>Rice"));
});

test("unsubscribe token round-trips and rejects tampering", async () => {
  const token = await unsubscribeToken("s3cret", "user-1");
  assert.equal(await verifyUnsubscribeToken("s3cret", token), "user-1");
  assert.equal(await verifyUnsubscribeToken("other", token), null);
  assert.equal(await verifyUnsubscribeToken("s3cret", token.replace("user-1", "user-2")), null);
  assert.equal(await verifyUnsubscribeToken("s3cret", "garbage"), null);
});

test("availability digests exclude out-of-stock products and refuse an empty alert", () => {
  const email=renderDigest([{itemId:'rice',name:'Rice',status:'in_stock',kind:'report'},{itemId:'beans',name:'Beans',status:'out',kind:'report'}],links)
  assert.match(email.text,/Rice/)
  assert.doesNotMatch(email.text,/Beans/)
  assert.throws(()=>renderDigest([{itemId:'beans',name:'Beans',status:'out',kind:'report'}],links),/No available wishlist/)
})
