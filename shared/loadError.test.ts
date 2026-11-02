import { test } from "node:test";
import assert from "node:assert/strict";
import { isNetworkError, loadErrorMessage } from "./loadError";

test("fetch failures from each browser count as network errors", () => {
  for (const message of ["TypeError: Failed to fetch", "TypeError: Load failed", "TypeError: NetworkError when attempting to fetch resource."]) {
    assert.equal(isNetworkError({ code: "", message }), true, message);
  }
});

test("database and API errors are not network errors", () => {
  assert.equal(isNetworkError({ code: "42703", message: "column available_items.reported_by_me does not exist" }), false);
  assert.equal(isNetworkError({ code: "PGRST301", message: "JWT expired" }), false);
  assert.equal(isNetworkError({ code: "", message: "Bad Gateway" }), false);
  assert.equal(isNetworkError(null), false);
});

test("offline is a network error whatever the error says", () => {
  assert.equal(isNetworkError({ code: "42703", message: "x" }, false), true);
});

test("message says older data may be out of date only when some is shown", () => {
  const db = { code: "42703", message: "column does not exist" };
  assert.equal(loadErrorMessage(db, { what: "items", hasData: false }), "Something went wrong loading items. Try again in a few minutes.");
  assert.match(loadErrorMessage(db, { what: "items", hasData: true }), /items below may be out of date/);
  assert.match(loadErrorMessage({ code: "", message: "TypeError: Load failed" }, { what: "items", hasData: false }), /^Can't reach the server/);
});
