import { useEffect, useState } from 'react';

// Keep only the last viewed record in the same parent and workspace while the
// navigation guard handles remote removal. This cache grants no API permission.
export function useRetainedSelection<T extends { id: string }>(records: readonly T[], selectedId: string, scope: string): T | null {
  const [retained, setRetained] = useState<{ scope: string; record: T } | null>(null);
  const selected = records.find((record) => record.id === selectedId) ?? (selectedId.length === 0 ? records[0] ?? null : null);
  useEffect(() => {
    if (selected !== null) setRetained((current) => current?.scope === scope && current.record === selected ? current : { scope, record: selected });
  }, [scope, selected]);
  return selected ?? (retained?.scope === scope && retained.record.id === selectedId ? retained.record : null);
}
