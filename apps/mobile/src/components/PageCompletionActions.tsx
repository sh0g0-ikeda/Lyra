import type { ReactNode } from 'react';

interface PageCompletionActionsProps {
  confirmed: boolean;
  exportSection: ReactNode;
  generationSection: ReactNode;
}

export function PageCompletionActions({
  confirmed,
  exportSection,
  generationSection
}: PageCompletionActionsProps): React.JSX.Element {
  return (
    <>
      {confirmed ? null : generationSection}
      {exportSection}
    </>
  );
}
