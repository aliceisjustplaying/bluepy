import fs from 'fs';

void fetch('https://lingva.phanpy.social/api/v1/languages/source')
  .then((response) => response.json())
  .then((json) => {
    const file = './src/data/lingva-source-languages.json';
    console.log(`Writing ${file}...`);
    fs.writeFileSync(file, JSON.stringify(json.languages, null, '\t'), 'utf8');
    return undefined;
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

void fetch('https://lingva.phanpy.social/api/v1/languages/target')
  .then((response) => response.json())
  .then((json) => {
    const file = './src/data/lingva-target-languages.json';
    console.log(`Writing ${file}...`);
    fs.writeFileSync(file, JSON.stringify(json.languages, null, '\t'), 'utf8');
    return undefined;
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
