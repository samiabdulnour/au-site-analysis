/* The character page's photographs: where a place's own picture is found from the URL Wikipedia gives for it.
 * No network.
 *
 *   npx tsx test/character.mts
 */

import { commonsFileOf } from '../src/fetch/character.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// Wikipedia adds tracking parameters to the image URLs it serves; they are no part of the file's name
check('the query string is not the name', commonsFileOf('https://upload.wikimedia.org/wikipedia/commons/b/be/Averybuilding.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled') === 'Averybuilding.jpg');
check('a thumbnail names its original', commonsFileOf('https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Hyde_Park_Captain_Cook.JPG/320px-Hyde_Park_Captain_Cook.JPG') === 'Hyde Park Captain Cook.JPG');
check('an escaped name is read back', commonsFileOf('https://upload.wikimedia.org/wikipedia/commons/a/ab/St_Peter%27s_Church%2C_Darlinghurst_04.jpg') === "St Peter's Church, Darlinghurst 04.jpg");
// a file on Wikipedia alone is held under fair use, not a free licence: not a Commons file
check('a Wikipedia-only file is not taken', commonsFileOf('https://upload.wikimedia.org/wikipedia/en/1/12/Logo.png') === undefined);
check('no URL, no file', commonsFileOf(undefined) === undefined);

if (failures.length) { console.error(`character: ${failures.length} failure(s)\n${failures.map((f) => ` - ${f}`).join('\n')}`); process.exit(1); }
console.log('character: all checks passed');
