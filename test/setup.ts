import { faker } from '@faker-js/faker';
import { beforeEach } from 'vitest';

// Reseed before every test, not once per file, so a test's data does not depend on which tests ran before it.
beforeEach(() => {
  faker.seed(20261101);
});
