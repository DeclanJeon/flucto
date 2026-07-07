export const parseBatchFileContent = (content: string): string[] => {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      return !['#', ';', ']'].includes(line.charAt(0));
    });
};

export const runWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  let nextIndex = 0;
  const width = Math.max(1, Math.min(concurrency, items.length));

  const runNext = async (): Promise<void> => {
    const currentIndex = nextIndex;
    nextIndex += 1;
    if (currentIndex >= items.length) return;
    results[currentIndex] = await worker(items[currentIndex], currentIndex);
    await runNext();
  };

  await Promise.all(Array.from({ length: width }, () => runNext()));
  return results;
};
