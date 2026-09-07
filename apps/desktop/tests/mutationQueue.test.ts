import assert from "node:assert/strict";
import test from "node:test";

import { createMutationQueue } from "../src/app/mutationQueue";

interface Clock {
    now: () => number;
    delay: (ms: number) => Promise<void>;
}

// A clock the test drives itself: `delay` resolves on the next microtask and
// moves the reading forward, so a timeout is reached without waiting for it.
function fakeClock(): Clock {
    let current = 0;
    return {
        now: () => current,
        delay: (ms: number) => {
            current += ms;
            return Promise.resolve();
        },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

test("a mutation asked for while another runs waits instead of being dropped", async () => {
    const queue = createMutationQueue({ blocked: () => false, ...fakeClock() });
    const first = deferred<boolean>();
    const order: string[] = [];

    const running = queue.run(async () => { order.push("first start"); const value = await first.promise; order.push("first end"); return value; });
    const queued = queue.run(async () => { order.push("second"); return true; }, { onQueued: () => order.push("queued") });

    first.resolve(true);
    assert.equal(await running, true);
    assert.equal(await queued, true);
    assert.deepEqual(order, ["queued", "first start", "first end", "second"]);
});

test("two presses of the same command are one command", async () => {
    const queue = createMutationQueue({ blocked: () => false, ...fakeClock() });
    const first = deferred<boolean>();

    const running = queue.run(() => first.promise, { key: "fetch" });
    const repeated = queue.run(async () => true, { key: "fetch" });
    const other = queue.run(async () => true, { key: "pull" });

    assert.equal(await repeated, false);
    first.resolve(true);
    assert.equal(await running, true);
    assert.equal(await other, true);
});

test("the same command can be asked for again once it has finished", async () => {
    const queue = createMutationQueue({ blocked: () => false, ...fakeClock() });
    assert.equal(await queue.run(async () => true, { key: "fetch" }), true);
    assert.equal(await queue.run(async () => true, { key: "fetch" }), true);
});

test("a task waits for a hold outside the queue", async () => {
    let blocked = true;
    const queue = createMutationQueue({ blocked: () => blocked, ...fakeClock() });
    let started = false;

    const held = queue.run(async () => { started = true; return true; }, { onQueued: () => { blocked = false; } });

    assert.equal(started, false);
    assert.equal(await held, true);
    assert.equal(started, true);
});

test("a hold that never clears refuses the task rather than wedging the queue", async () => {
    const queue = createMutationQueue({ blocked: () => true, timeout: 1_000, interval: 100, ...fakeClock() });
    let started = false;

    assert.equal(await queue.run(async () => { started = true; return true; }), false);
    assert.equal(started, false);
});

test("the queue holds a bounded number of waiting tasks", async () => {
    const queue = createMutationQueue({ blocked: () => false, limit: 2, ...fakeClock() });
    const first = deferred<boolean>();

    const running = queue.run(() => first.promise);
    const accepted = [queue.run(async () => true), queue.run(async () => true)];
    const refused = queue.run(async () => true);

    assert.equal(queue.waiting, 2);
    assert.equal(await refused, false);
    first.resolve(true);
    assert.equal(await running, true);
    assert.deepEqual(await Promise.all(accepted), [true, true]);
    assert.equal(queue.waiting, 0);
});

test("a failing task does not stop the one behind it", async () => {
    const queue = createMutationQueue({ blocked: () => false, ...fakeClock() });
    const failing = queue.run(async () => { throw new Error("push rejected"); });
    const next = queue.run(async () => true);

    await assert.rejects(failing, /push rejected/);
    assert.equal(await next, true);
});
