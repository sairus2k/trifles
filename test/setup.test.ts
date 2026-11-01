import { faker } from '@faker-js/faker';
import Dexie from 'dexie';
import { expect, test } from 'vitest';

test('IndexedDB is available through fake-indexeddb', async () => {
  const db = new Dexie('smoke');
  db.version(1).stores({ items: 'id' });
  await db.table('items').put({ id: 1, name: 'coffee' });
  expect(await db.table('items').get(1)).toEqual({ id: 1, name: 'coffee' });
  await db.delete();
});

test('faker is seeded before each test', () => {
  const first = faker.string.uuid();
  faker.seed(20261101);
  expect(faker.string.uuid()).toBe(first);
});
