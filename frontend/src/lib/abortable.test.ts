import assert from "node:assert/strict";
import test from "node:test";
import { abortable } from "./abortable.ts";

test("cancelling one consumer leaves the shared snapshot available to another", async () => {
  let finish!: (value: string) => void;
  const snapshot = new Promise<string>((resolve) => { finish = resolve; });
  const controller = new AbortController();
  const cancelled = abortable(snapshot, controller.signal);
  const active = abortable(snapshot, new AbortController().signal);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  finish("cached season");
  assert.equal(await active, "cached season");
});

test("snapshot failures propagate to active consumers", async () => {
  await assert.rejects(abortable(Promise.reject(new Error("HTTP 404")), new AbortController().signal), /HTTP 404/);
});
