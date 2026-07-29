export const MOBILE_LIST_PAGE_SIZE = 40;

interface RecordWithId {
  id: string;
}

interface CursorPage {
  next_cursor: string | null;
}

export const flattenUniqueRecords = <T extends RecordWithId>(
  pages: readonly (readonly T[])[],
): T[] => {
  const seen = new Set<string>();
  const records: T[] = [];

  for (const page of pages) {
    for (const record of page) {
      if (seen.has(record.id)) {
        continue;
      }
      seen.add(record.id);
      records.push(record);
    }
  }

  return records;
};

export const nextCursorFromPage = (
  page: CursorPage,
): string | undefined => page.next_cursor ?? undefined;
