import { vi } from 'vitest';

(globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = false;

vi.mock('expo-media-library', () => ({
  Asset: { create: vi.fn() },
  requestPermissionsAsync: vi.fn()
}));

vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000000')
}));

vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined)
}));
