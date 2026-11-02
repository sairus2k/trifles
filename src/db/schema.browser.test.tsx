import { afterAll, expect, test } from "vitest";
import { db } from "./schema";

afterAll(() => db.delete());

// Read back from the IndexedDB the browser actually created, not from Dexie's declaration.
test("tables, keys and indexes match the schema", async () => {
  await db.open();
  const idb = db.backendDB();
  const names = [...idb.objectStoreNames];
  const tx = idb.transaction(names, "readonly");
  const stores = Object.fromEntries(
    names.map((name) => {
      const store = tx.objectStore(name);
      return [name, { key: store.keyPath, indexes: [...store.indexNames].sort() }];
    }),
  );

  expect(stores).toEqual({
    accounts: { key: "id", indexes: [] },
    categories: { key: "id", indexes: [] },
    merchants: { key: "id", indexes: [] },
    transactions: { key: "id", indexes: ["accountId", "date"] },
    suggestions: { key: "merchantName", indexes: [] },
    outbox: { key: "clientId", indexes: ["createdAt"] },
    meta: { key: "key", indexes: [] },
  });
});
