import assert from "node:assert/strict";
import { test } from "node:test";
import {
  connectUpdater, initialUpdateState, type NativeUpdateState, type UpdateTransport,
} from "../src/lib/updateClient";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const available: NativeUpdateState = {
  ...initialUpdateState, status: "available", version: "2.0.0", notes: "Patch notes",
};

function harness() {
  const calls: string[] = [];
  const states: NativeUpdateState[] = [];
  const snapshot = deferred<NativeUpdateState>();
  let emit!: (state: NativeUpdateState) => void;
  let stopped = 0;
  let command: Promise<void> = Promise.resolve();
  const transport: UpdateTransport = {
    async listen(callback) { emit = callback; return () => { stopped += 1; }; },
    async invoke<T>(name: string): Promise<T> {
      calls.push(name);
      return (name === "get_update_state" ? snapshot.promise : command) as Promise<T>;
    },
  };
  const client = connectUpdater(transport, (state) => states.push(state));
  return {
    calls, states, snapshot, client,
    emit: (state: NativeUpdateState) => emit(state),
    stopped: () => stopped,
    command: (value: Promise<void>) => { command = value; },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("native events win over a stale initial snapshot", async () => {
  const h = harness();
  await flush();
  h.emit(available);
  h.snapshot.resolve(initialUpdateState);
  await flush();
  assert.deepEqual(h.states, [available]);
  h.client.dispose();
  assert.equal(h.stopped(), 1);
});

test("checks and installs use native commands and retain notes after failure", async () => {
  const h = harness();
  h.snapshot.resolve(available);
  await flush();
  await h.client.check();
  const attempt = deferred<void>();
  h.command(attempt.promise);
  const installing = h.client.install();
  await flush();
  h.emit({ ...available, status: "downloading", progress: 25 });
  h.emit({ ...available, status: "error", error: "Signature verification failed" });
  attempt.reject("delayed command failure");
  await installing;
  assert.deepEqual(h.calls, ["get_update_state", "check_update", "install_update"]);
  assert.equal(h.states.at(-1)?.error, "Signature verification failed");
  assert.equal(h.states.at(-1)?.notes, "Patch notes");
  h.client.dispose();
});

test("concurrent clicks and native busy states cannot start another operation", async () => {
  const h = harness();
  h.snapshot.resolve(available);
  await flush();
  const attempt = deferred<void>();
  h.command(attempt.promise);
  const installing = h.client.install();
  await h.client.check();
  await h.client.install();
  await flush();
  assert.equal(h.calls.filter((call) => call === "install_update").length, 1);
  attempt.resolve();
  await installing;
  for (const status of ["checking", "downloading", "installing", "ready"] as const) {
    h.emit({ ...available, status });
    await h.client.check();
    await h.client.install();
  }
  assert.deepEqual(h.calls, ["get_update_state", "install_update"]);
  h.client.dispose();
});

test("no release means no install; IPC failures remain visible", async () => {
  const h = harness();
  h.snapshot.resolve(initialUpdateState);
  await flush();
  await h.client.install();
  const attempt = deferred<void>();
  h.command(attempt.promise);
  const checking = h.client.check();
  await flush();
  attempt.reject(new Error("IPC unavailable"));
  await checking;
  assert.deepEqual(h.calls, ["get_update_state", "check_update"]);
  assert.equal(h.states.at(-1)?.error, "IPC unavailable");
  h.client.dispose();
});

test("disposing during listener registration removes the eventual listener", async () => {
  const listener = deferred<() => void>();
  let stopped = 0;
  let invoked = false;
  const states: NativeUpdateState[] = [];
  const client = connectUpdater({
    listen: () => listener.promise,
    async invoke<T>() { invoked = true; return initialUpdateState as T; },
  }, (state) => states.push(state));
  client.dispose();
  listener.resolve(() => { stopped += 1; });
  await flush();
  assert.equal(stopped, 1);
  assert.equal(invoked, false);
  assert.deepEqual(states, []);
});

test("disposing suppresses late snapshots, events, errors, and commands", async () => {
  const h = harness();
  await flush();
  h.client.dispose();
  h.snapshot.reject("closed window");
  h.emit(available);
  await h.client.check();
  await flush();
  assert.deepEqual(h.states, []);
  assert.deepEqual(h.calls, ["get_update_state"]);
  assert.equal(h.stopped(), 1);
});

test("a failed event subscription is visible and prevents unobservable installs", async () => {
  const states: NativeUpdateState[] = [];
  const client = connectUpdater({
    async listen() { throw new Error("Event listener unavailable"); },
    async invoke<T>(): Promise<T> { throw new Error("must not invoke"); },
  }, (state) => states.push(state));
  await client.install();
  assert.equal(states.at(-1)?.error, "Event listener unavailable");
  client.dispose();
});
