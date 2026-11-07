/* The character page's photographs: where a place's own picture is found from the URL Wikipedia gives for it.
 * No network.
 *
 *   npx tsx test/character.mts
 */

import { commonsFileOf, placeWords, judgePlacePhoto } from '../src/fetch/character.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// Wikipedia adds tracking parameters to the image URLs it serves; they are no part of the file's name
check('the query string is not the name', commonsFileOf('https://upload.wikimedia.org/wikipedia/commons/b/be/Averybuilding.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled') === 'Averybuilding.jpg');
check('a thumbnail names its original', commonsFileOf('https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Hyde_Park_Captain_Cook.JPG/320px-Hyde_Park_Captain_Cook.JPG') === 'Hyde Park Captain Cook.JPG');
check('an escaped name is read back', commonsFileOf('https://upload.wikimedia.org/wikipedia/commons/a/ab/St_Peter%27s_Church%2C_Darlinghurst_04.jpg') === "St Peter's Church, Darlinghurst 04.jpg");
// a file on Wikipedia alone is held under fair use, not a free licence: not a Commons file
check('a Wikipedia-only file is not taken', commonsFileOf('https://upload.wikimedia.org/wikipedia/en/1/12/Logo.png') === undefined);
check('no URL, no file', commonsFileOf(undefined) === undefined);

// A place's own picture is the one Commons' record says is the place. Wikidata's image for the Central Synagogue was
// a montage of Sydney (its P18, November 2026): a montage that does not name the place is not its picture.
const synagogue = { title: 'Central Synagogue (Sydney)', lon: 151.257, lat: -33.8901 };
check('the words of a title are its own', placeWords('Central Synagogue (Sydney)').join(' ') === 'central synagogue');
check('a number is a word of its own', placeWords('Electricity Substation No. 269').join(' ') === 'electricity substation 269');
check('a title of stop words keeps them', placeWords('The Park').join(' ') === 'park');
check('a montage of the city is not the place', judgePlacePhoto(synagogue, 'Montage of Sydney1.jpg', { description: 'Montage of Sydney', categories: ['Montages of Sydney'] }) === 'not');
check('a file that names the place is the place', judgePlacePhoto(synagogue, 'Central Synagogue Bondi Junction.jpg', { description: 'The synagogue from the street' }) === 'about');
check('a category that names the place is the place', judgePlacePhoto(synagogue, 'IMG 2041.jpg', { categories: ['Central Synagogue (Sydney)'] }) === 'about');
check('a view that names nothing is unsure', judgePlacePhoto(synagogue, 'IMG 2041.jpg', { description: 'A building' }) === 'unsure');
check('a logo is never the place', judgePlacePhoto(synagogue, 'Central Synagogue logo.png', {}) === 'not');
check('a photograph taken far away is not the place', judgePlacePhoto(synagogue, 'Central Synagogue.jpg', { lat: -33.8901, lon: 151.207 }) === 'not');
check('a photograph taken at the place is the place', judgePlacePhoto(synagogue, 'Central Synagogue.jpg', { lat: -33.8905, lon: 151.2572 }) === 'about');
check('a place with no position asks nothing of the photograph\'s', judgePlacePhoto({ title: 'Tamarama' }, 'Tamarama beach 2.jpg', { lat: -33.8, lon: 151.0 }) === 'about');

if (failures.length) { console.error(`character: ${failures.length} failure(s)\n${failures.map((f) => ` - ${f}`).join('\n')}`); process.exit(1); }
console.log('character: all checks passed');
