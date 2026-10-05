/** Test-only global restoration shared by Vitest and Bun's compatible runner. */
export function createGlobalStubScope(): { stubGlobal(name: string, value: unknown): void; restore(): void } {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  return {
    stubGlobal(name: string, value: unknown): void {
      if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    },
    restore(): void {
      for (const [name, descriptor] of originals) {
        if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
        else Object.defineProperty(globalThis, name, descriptor);
      }
      originals.clear();
    },
  };
}
