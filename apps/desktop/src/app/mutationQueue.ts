/**
 * Runs repository mutations one at a time, in the order they were asked for.
 *
 * A click that lands while another operation is running used to be dropped,
 * which from the outside is indistinguishable from a click that never
 * registered at all. Gittyup binds the new operation to the end of the running
 * one instead, and so does this: the second operation waits rather than
 * disappearing.
 */
export interface MutationQueueOptions {
    /**
     * True while something outside the queue holds the repository -- an
     * overview reload, a tab being opened. A queued task waits for it to clear
     * before it starts.
     */
    blocked: () => boolean;
    /** Milliseconds between two checks of `blocked`. */
    interval?: number;
    /**
     * How long a task waits for `blocked` to clear before giving up. A holder
     * that never releases must not wedge every later mutation forever.
     */
    timeout?: number;
    /** Tasks allowed to wait behind the running one. */
    limit?: number;
    now?: () => number;
    delay?: (ms: number) => Promise<void>;
}

export interface QueuedMutationOptions {
    /**
     * Identifies the kind of operation. A task is dropped when one carrying
     * the same key is already running or waiting: a repository-wide command
     * asked for twice is one command, and the second press is the same press.
     * Tasks without a key never collide -- staging two different files is two
     * operations however quickly they follow each other.
     */
    key?: string;
    /** Called when the task cannot start immediately. */
    onQueued?: () => void;
}

export interface MutationQueue {
    /** Tasks waiting behind the one currently running. */
    readonly waiting: number;
    /** True while a task is running. */
    readonly running: boolean;
    run(task: () => Promise<boolean>, options?: QueuedMutationOptions): Promise<boolean>;
}

export function createMutationQueue(options: MutationQueueOptions): MutationQueue {
    const interval = options.interval ?? 25;
    const timeout = options.timeout ?? 60_000;
    const limit = options.limit ?? 8;
    const now = options.now ?? (() => Date.now());
    const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));

    let tail: Promise<void> = Promise.resolve();
    // Every task that has been accepted and has not finished, the running one
    // included. Counting at acceptance rather than at start is what makes two
    // clicks in the same tick two queue entries.
    let depth = 0;
    let running = false;
    let runningKey: string | null = null;
    const acceptedKeys: string[] = [];

    async function untilFree(): Promise<boolean> {
        const deadline = now() + timeout;
        while (options.blocked()) {
            if (now() >= deadline) return false;
            await delay(interval);
        }
        return true;
    }

    function forget(key: string | undefined) {
        if (key === undefined) return;
        const index = acceptedKeys.indexOf(key);
        if (index >= 0) acceptedKeys.splice(index, 1);
    }

    return {
        // One accepted task is always the one at the front, whether or not it
        // has reached its microtask yet; the rest are waiting.
        get waiting() { return Math.max(depth - 1, 0); },
        get running() { return running; },
        run(task, queued) {
            const key = queued?.key;
            if (key !== undefined && (runningKey === key || acceptedKeys.includes(key))) return Promise.resolve(false);
            if (Math.max(depth - 1, 0) >= limit) return Promise.resolve(false);

            const immediate = depth === 0 && !options.blocked();
            ++depth;
            if (key !== undefined) acceptedKeys.push(key);
            if (!immediate) queued?.onQueued?.();

            const started = tail.then(async () => {
                running = true;
                runningKey = key ?? null;
                forget(key);
                try {
                    // A task that never got its turn reports the same failure a
                    // refused one does; it has not touched the repository.
                    if (!await untilFree()) return false;
                    return await task();
                } finally {
                    running = false;
                    runningKey = null;
                    --depth;
                }
            });
            tail = started.then(() => undefined, () => undefined);
            return started;
        },
    };
}
