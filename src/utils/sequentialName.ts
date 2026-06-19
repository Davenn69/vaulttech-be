const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const resolveSequentialName = (
  baseName: string,
  existingNames: string[],
) => {
  const normalizedBaseName = baseName.trim();
  const usedNumbers = new Set<number>();
  let baseTaken = false;

  const pattern = new RegExp(
    `^${escapeRegExp(normalizedBaseName)}(?: \\((\\d+)\\))?$`,
    "i",
  );

  for (const existingName of existingNames) {
    const trimmedName = existingName.trim();
    const match = trimmedName.match(pattern);

    if (!match) continue;

    if (!match[1]) {
      baseTaken = true;
      continue;
    }

    const number = Number(match[1]);
    if (Number.isInteger(number) && number > 0) {
      usedNumbers.add(number);
    }
  }

  if (!baseTaken && !usedNumbers.has(1)) {
    return normalizedBaseName;
  }

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return `${normalizedBaseName} (${nextNumber})`;
};
