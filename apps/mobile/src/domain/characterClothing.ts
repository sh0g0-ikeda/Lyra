export function mergeCharacterClothingDescription(
  existingClothing: Readonly<Record<string, unknown>>,
  description: string,
): Record<string, unknown> {
  const clothing = { ...existingClothing };
  const normalizedDescription = description.trim();
  if (normalizedDescription.length === 0) {
    delete clothing.description;
  } else {
    clothing.description = normalizedDescription;
  }
  return clothing;
}
