import { render, screen } from "@solidjs/testing-library";
import Dexie, { type EntityTable } from "dexie";
import { type Accessor, Loading, createEffect, createRoot, createSignal } from "solid-js";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createLiveQuery } from "./live";

interface Item {
  id: number;
  group: string;
}

// Browser test files run in parallel against one origin, so this file keeps its own database.
const db = new Dexie(`live-test-${crypto.randomUUID()}`) as Dexie & {
  items: EntityTable<Item, "id">;
};
db.version(1).stores({ items: "id, group" });

beforeEach(async () => {
  await db.items.clear();
  await db.items.bulkPut([
    { id: 1, group: "a" },
    { id: 2, group: "b" },
  ]);
  runs.length = 0;
});

afterAll(() => db.delete());

function record<T>(create: () => Accessor<T>) {
  const values: T[] = [];
  const dispose = createRoot((dispose) => {
    createEffect(create(), (value) => {
      values.push(value);
    });
    return dispose;
  });
  return { values, dispose };
}

// Every run of the query is recorded: a subscription that was not closed runs again on a write.
// vi.mock("dexie") could count subscriptions directly, but under load @vitest/browser-playwright
// silently skips module mocks (vitest-dev/vitest#11780).
const runs: string[] = [];
const idsIn = (group: string) => {
  runs.push(group);
  return db.items.where("group").equals(group).primaryKeys();
};

// Dexie notifies subscriptions in the order they started listening, and each one runs its query
// as soon as it is notified. The watcher subscribes last, so once it has seen the write, any
// subscription left open has already run again.
async function writeAndSettle(item: Item) {
  const watcher = record(() => createLiveQuery(() => db.items.count()));
  await vi.waitFor(() => expect(watcher.values).toHaveLength(1));
  await db.items.put(item);
  await vi.waitFor(() => expect(watcher.values).toHaveLength(2));
  watcher.dispose();
}

test("emits the current result, then a new one on every change", async () => {
  const { values, dispose } = record(() => createLiveQuery(() => idsIn("a")));
  await vi.waitFor(() => expect(values).toEqual([[1]]));

  await db.items.put({ id: 3, group: "a" });
  await vi.waitFor(() => expect(values).toEqual([[1], [1, 3]]));

  await db.items.delete(1);
  await vi.waitFor(() => expect(values).toEqual([[1], [1, 3], [3]]));

  dispose();
});

test("unsubscribes from Dexie on dispose", async () => {
  const { values, dispose } = record(() => createLiveQuery(() => idsIn("a")));
  await vi.waitFor(() => expect(values).toEqual([[1]]));
  expect(runs).toEqual(["a"]);

  dispose();
  await writeAndSettle({ id: 3, group: "a" });
  expect(runs).toEqual(["a"]);
});

test("re-subscribes when a reactive parameter changes", async () => {
  const [group, setGroup] = createSignal("a");
  const { values, dispose } = record(() => createLiveQuery(group, idsIn));
  await vi.waitFor(() => expect(values).toEqual([[1]]));

  setGroup("b");
  await vi.waitFor(() => expect(values).toEqual([[1], [2]]));
  expect(runs).toEqual(["a", "b"]);

  await writeAndSettle({ id: 3, group: "a" });
  expect(runs).toEqual(["a", "b"]);

  await db.items.put({ id: 4, group: "b" });
  await vi.waitFor(() => expect(values).toEqual([[1], [2], [2, 4]]));
  expect(runs).toEqual(["a", "b", "b"]);

  dispose();
  await writeAndSettle({ id: 5, group: "b" });
  expect(runs).toEqual(["a", "b", "b"]);
});

test("shows the Loading fallback until the first result and unsubscribes on unmount", async () => {
  const { unmount } = render(() => {
    const ids = createLiveQuery(() => idsIn("a"));
    return (
      <Loading fallback={<p>loading</p>}>
        <p>ids: {ids().join(",")}</p>
      </Loading>
    );
  });
  expect(screen.getByText("loading")).toBeTruthy();
  expect(await screen.findByText("ids: 1")).toBeTruthy();

  await db.items.put({ id: 3, group: "a" });
  expect(await screen.findByText("ids: 1,3")).toBeTruthy();

  expect(runs).toEqual(["a", "a"]);

  unmount();
  await writeAndSettle({ id: 4, group: "a" });
  expect(runs).toEqual(["a", "a"]);
});
