import { render, screen } from "@solidjs/testing-library";
import Dexie, { type EntityTable, type Observer } from "dexie";
import { type Accessor, Loading, createEffect, createRoot, createSignal } from "solid-js";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createLiveQuery } from "./live";

// Counts Dexie subscriptions so the tests can prove that cleanup and re-subscription really close
// the previous one, not only stop updating the UI.
const subscriptions = vi.hoisted(() => ({ opened: 0, closed: 0 }));

vi.mock("dexie", async (importOriginal) => {
  const dexie = await importOriginal<typeof import("dexie")>();
  return {
    ...dexie,
    liveQuery: <T,>(querier: () => T | Promise<T>) => {
      // In browser mode importOriginal() returns Dexie's namespace without the liveQuery export;
      // Dexie's own import wrapper reads it from the class, so do the same.
      const observable = dexie.Dexie.liveQuery(querier);
      return {
        subscribe(observer: Observer<T>) {
          subscriptions.opened++;
          const subscription = observable.subscribe(observer);
          return {
            get closed() {
              return subscription.closed;
            },
            unsubscribe() {
              subscriptions.closed++;
              subscription.unsubscribe();
            },
          };
        },
      };
    },
  };
});

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
  subscriptions.opened = 0;
  subscriptions.closed = 0;
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

const idsIn = (group: string) => db.items.where("group").equals(group).primaryKeys();

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
  expect(subscriptions).toEqual({ opened: 1, closed: 0 });

  dispose();
  expect(subscriptions).toEqual({ opened: 1, closed: 1 });
});

test("re-subscribes when a reactive parameter changes", async () => {
  const [group, setGroup] = createSignal("a");
  const { values, dispose } = record(() => createLiveQuery(group, idsIn));
  await vi.waitFor(() => expect(values).toEqual([[1]]));

  setGroup("b");
  await vi.waitFor(() => expect(values).toEqual([[1], [2]]));
  expect(subscriptions).toEqual({ opened: 2, closed: 1 });

  await db.items.put({ id: 3, group: "b" });
  await vi.waitFor(() => expect(values).toEqual([[1], [2], [2, 3]]));

  dispose();
  expect(subscriptions).toEqual({ opened: 2, closed: 2 });
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

  unmount();
  expect(subscriptions).toEqual({ opened: 1, closed: 1 });
});
