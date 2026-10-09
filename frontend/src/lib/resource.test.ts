import assert from "node:assert/strict";
import test from "node:test";
import type { ResourceResult } from "./resource.ts";
import { resolveResource } from "./resource.ts";

test("publishes successful data and ends loading", async () => {
  const results: ResourceResult<number>[] = [];
  await resolveResource(async () => 42, new AbortController().signal, (result) => results.push(result));
  assert.deepEqual(results, [{ data: 42, error: null, loading: false }]);
});

test("request failures clear data and expose an error", async () => {
  const results: ResourceResult<never>[] = [];
  await resolveResource(async () => { throw new Error("Snapshot missing"); }, new AbortController().signal, (result) => results.push(result));
  assert.deepEqual(results, [{ data: null, error: "Snapshot missing", loading: false }]);
});

test("a synchronous loader failure also becomes a readable error", async () => {
  const results: ResourceResult<never>[] = [];
  await resolveResource(() => { throw "unexpected failure"; }, new AbortController().signal, (result) => results.push(result));
  assert.deepEqual(results, [{ data: null, error: "Daten konnten nicht geladen werden.", loading: false }]);
});

test("an obsolete success cannot replace a newer selection even if its loader ignores abort", async () => {
  let finish!: (value: string) => void;
  const pending = new Promise<string>((resolve) => { finish = resolve; });
  const obsolete = new AbortController();
  const results: ResourceResult<string>[] = [];
  const oldRequest = resolveResource(() => pending, obsolete.signal, (result) => results.push(result));
  obsolete.abort();
  await resolveResource(async () => "new season", new AbortController().signal, (result) => results.push(result));
  finish("old season");
  await oldRequest;
  assert.deepEqual(results, [{ data: "new season", error: null, loading: false }]);
});

test("an obsolete failure cannot clear the current request's loading state", async () => {
  let fail!: (reason: Error) => void;
  const pending = new Promise<never>((_, reject) => { fail = reject; });
  const controller = new AbortController();
  const results: ResourceResult<never>[] = [];
  const request = resolveResource(() => pending, controller.signal, (result) => results.push(result));
  controller.abort();
  fail(new Error("Old request failed"));
  await request;
  assert.deepEqual(results, []);
});

test("an already cancelled consumer does not start a request", async () => {
  const controller = new AbortController();
  controller.abort();
  await resolveResource(() => assert.fail("must not load"), controller.signal, () => assert.fail("must not publish"));
});
