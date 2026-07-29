import type { ReactNode } from 'react';

interface PageCompletionActionsProps {
  exportSection: ReactNode;
  generationSection: ReactNode;
}

export function PageCompletionActions({
  exportSection,
  generationSection
}: PageCompletionActionsProps): React.JSX.Element {
  return (
    <>
      {generationSection}
      {exportSection}
    </>
  );
}
