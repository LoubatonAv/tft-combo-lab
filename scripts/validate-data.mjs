import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'server/data');
const champions = JSON.parse(await fs.readFile(path.join(root, 'champions.json'), 'utf8'));
const traits = JSON.parse(await fs.readFile(path.join(root, 'traits.json'), 'utf8'));
const metaComps = JSON.parse(await fs.readFile(path.join(root, 'metaComps.json'), 'utf8'));
const itemStats = JSON.parse(await fs.readFile(path.join(root, 'itemStats.json'), 'utf8'));
const itemCatalog = JSON.parse(await fs.readFile(path.join(root, 'itemCatalog.json'), 'utf8'));
const traitNames = new Set(traits.map(t => t.name));
const championIds = new Set(champions.map(c => c.id));
const errors = [];

for (const champ of champions) {
  for (const trait of champ.traits) {
    if (!traitNames.has(trait)) errors.push(`${champ.name} uses unknown trait: ${trait}`);
  }
  const hasDirectItems = Array.isArray(champ.items) && champ.items.length > 0;
  const hasImportedStats = Array.isArray(itemStats[champ.id]) && itemStats[champ.id].length > 0;
  if (!hasDirectItems && !hasImportedStats && Object.keys(itemCatalog).length === 0) {
    errors.push(`${champ.name} has no item data or fallback catalog`);
  }
}

for (const comp of metaComps) {
  for (const unit of comp.units) {
    if (!championIds.has(unit)) errors.push(`${comp.name} uses unknown champion id: ${unit}`);
  }
}

const duplicates = champions.map(c => c.id).filter((id, idx, arr) => arr.indexOf(id) !== idx);
if (duplicates.length) errors.push(`Duplicate champion ids: ${duplicates.join(', ')}`);

if (errors.length) {
  console.error('Data validation failed:');
  for (const err of errors) console.error(`- ${err}`);
  process.exit(1);
}

console.log(`Data OK: ${champions.length} champions, ${traits.length} traits, ${metaComps.length} meta comps.`);
