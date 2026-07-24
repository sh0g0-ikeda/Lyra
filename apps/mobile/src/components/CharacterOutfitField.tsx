import { FormField } from '@/components/FormField';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface CharacterOutfitFieldProps {
  language: UiLanguage;
  onChange: (value: string) => void;
  value: string;
}

export function CharacterOutfitField({
  language,
  onChange,
  value,
}: CharacterOutfitFieldProps): React.JSX.Element {
  return (
    <FormField
      help={t(language, "generated.components.CharacterOutfitField.describe.the.clothing.shape.material.col.3a4efa8a")}
      label={t(language, "generated.components.CharacterOutfitField.clothing.details.e2391e1f")}
      maxLength={1000}
      multiline
      onChangeText={onChange}
      value={value}
    />
  );
}
