import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { icons } from '@iconify-json/mingcute';
import { parseIconSet, validateIconSet } from '@iconify/utils';

validateIconSet(icons);

const outputDir = path.join(process.cwd(), 'src/iconify-icons/mingcute');
const iconCount = Object.keys(icons.icons).length;
const metadataFile = path.join(outputDir, '.generated.json');
const metadata = JSON.stringify({
  count: iconCount,
  hash: createHash('sha256').update(JSON.stringify(icons.icons)).digest('hex'),
});
const iconNames = Object.keys(icons.icons);

try {
  const isCurrent = (await fs.readFile(metadataFile, 'utf-8')) === metadata;
  if (isCurrent) {
    await Promise.all(
      iconNames.map((iconName) =>
        fs.access(path.join(outputDir, `${iconName}.js`)),
      ),
    );
    console.log(`Generated icons already current in ${outputDir}`);
    process.exit(0);
  }
} catch {
  // Missing output dir is handled by the generation step below.
}

await fs.mkdir(outputDir, { recursive: true });

const writePromises = [];

parseIconSet(icons, (iconName, iconData) => {
  // console.log('🧬', iconName);
  writePromises.push(
    fs.writeFile(
      path.join(outputDir, `${iconName}.js`),
      `export default ${JSON.stringify(iconData)};`,
    ),
  );
});

await Promise.all(writePromises);
await fs.writeFile(metadataFile, metadata);

console.log(`Generated ${iconNames.length} icons in ${outputDir}`);
