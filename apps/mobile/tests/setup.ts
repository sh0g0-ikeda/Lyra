import { vi } from 'vitest';

(globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = false;

vi.mock('expo-media-library', () => ({
  Asset: { create: vi.fn() },
  requestPermissionsAsync: vi.fn()
}));
