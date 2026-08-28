import fs from 'fs';
import path from 'path';
import { sanitizeMarkdownFilename } from '../transcript/markdownFormatter.js';

/**
 * Writes a Markdown file under outputDir with a collision-safe suffix
 * (`Title_YYYYMMDD.md`, then `Title_YYYYMMDD-2.md`, ...).
 */
export const saveMarkdownFile = (outputDir: string, title: string, markdown: string): string => {
  fs.mkdirSync(outputDir, { recursive: true });
  const parsed = path.parse(sanitizeMarkdownFilename(title));
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const filePath = path.join(outputDir, `${parsed.name}${suffix}${parsed.ext}`);
    try {
      fs.writeFileSync(filePath, markdown, { encoding: 'utf8', flag: 'wx' });
      return filePath;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
  throw new Error('Could not allocate a unique Markdown filename.');
};
