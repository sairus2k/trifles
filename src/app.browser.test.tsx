import { render, screen } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { App } from './app';

test('renders the app shell', () => {
  render(() => <App />);
  expect(screen.getByRole('heading', { name: 'Sure Quick Entry' })).toBeTruthy();
});
