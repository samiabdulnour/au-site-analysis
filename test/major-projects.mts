/* The Major Projects register's listing and project pages, parsed from
 * trimmed copies of their markup (September 2026), and the matching of the
 * State's council-area names to the listing's filter. No network: CI never
 * calls the Planning Portal.
 *
 *   npx tsx test/major-projects.mts
 */

import { parseListing, parseProjectPage, parseLgaOptions, lgaOptionFor, lgaKey, stageClassOf } from '../src/fetch/majorProjects.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// ---- the listing -------------------------------------------------------------------

const card = (num: string, stage: string | null, type: string, title: string, addr: string, slug: string) => `
<div class="grid__col-6--mid grid__col-4 grid__col grid__fill-height">
<div class="card ">
  <div class="card__content">
      <div class="row row--small">
       <b><div class="field field-field-case-id field-type-string field-label-hidden">
            ${num}
      </div>
</b>
${stage ? `                    <div class="tag tag--fixed">
            ${stage}
      </div>` : ''}
      </div>
       <div class="tag  tag--fixed spacing--top-m"><div class="field field-field-case-type field-type-list-string field-label-hidden">
            ${type}
      </div>
</div>
      <span class="card__sub">City of Sydney</span>
        <h3 class="card__title">
                            ${title}
                    </h3>
         <div> <span class="icon icon--pin"></span>
            ${addr}
     </div>
              <div class="field field-node-link field-type-ds field-label-hidden">
              <a href="/major-projects/projects/${slug}" class="spacing--top-l icon button--icon-only icon--arrow-right" hreflang="en">Read more</a>
      </div>
      </div>
</div>
</div>`;

const listing = `
<form class="views-exposed-form" action="/major-projects/projects" method="get">
<select data-drupal-selector="edit-lga" id="edit-lga" name="lga" class="form-select"><option value="All">- Any -</option><option value="6">Bayside</option><option value="30" selected="selected">City of Sydney</option><option value="59">Inner West</option><option value="88">North Sydney</option><option value="91">Orange City</option><option value="112">The Hills Shire</option><option value="15">Canterbury-Bankstown</option></select>
</form>
<div class="form__item form__item--meta"><div>Showing: 276 results</div></div>
<div class="grid__row">
${card('SSD-76534472', 'Prepare EIS', 'State Significant Development', '50-52 Phillip Street, Sydney - Hotel', '50-52 Phillip Street, Sydney', '50-52-phillip-street-sydney-hotel')}
${card('SSD-55388456', 'Determination', 'State Significant Development', 'USYD &amp; RPA Sydney Biomedical Accelerator Project', 'Missenden Road, Camperdown', 'usyd-rpa-sydney-biomedical-accelerator-project')}
${card('SSD-80911502-Mod-1', null, 'SSD Modifications', 'Modification 1 to Early Works for Waterloo Mixed Use Development', '881-885 Bourke Street Waterloo Nsw 2017', 'modification-1-early-works-waterloo-mixed-use-development')}
</div>
<nav class="pager"><a href="?lga=30&amp;case_type=State%20Significant%20Development&amp;status=All&amp;page=1">2</a> <a href="?lga=30&amp;case_type=State%20Significant%20Development&amp;status=All&amp;page=30">Last</a></nav>`;

const l = parseListing(listing);
check('listing: three cards', l.cards.length === 3, `${l.cards.length}`);
check('listing: the result count', l.total === 276, `${l.total}`);
check('listing: the last page from the escaped pager links', l.lastPage === 30, `${l.lastPage}`);
const c0 = l.cards[0], c1 = l.cards[1], c2 = l.cards[2];
check('card: number', c0?.number === 'SSD-76534472', c0?.number);
check('card: stage', c0?.stage === 'Prepare EIS', c0?.stage);
check('card: case type, not the stage', c0?.caseType === 'State Significant Development', c0?.caseType);
check('card: council area', c0?.lga === 'City of Sydney', c0?.lga);
check('card: title', c0?.title === '50-52 Phillip Street, Sydney - Hotel', c0?.title);
check('card: address', c0?.address === '50-52 Phillip Street, Sydney', c0?.address);
check('card: absolute page URL', c0?.url === 'https://www.planningportal.nsw.gov.au/major-projects/projects/50-52-phillip-street-sydney-hotel', c0?.url);
check('card: entities decoded', c1?.title === 'USYD & RPA Sydney Biomedical Accelerator Project', c1?.title);
check('card: a modification has no stage tag', c2?.stage === undefined && c2?.caseType === 'SSD Modifications', JSON.stringify(c2));

// ---- the council-area filter -------------------------------------------------------

const options = parseLgaOptions(listing);
check('options: "- Any -" dropped', options.length === 7 && !options.some((o) => o.id === 'All'), JSON.stringify(options));
const pickId = (lga: string, council?: string) => lgaOptionFor(options, lga, council)?.id;
check('SYDNEY / Council of the City of Sydney -> City of Sydney', pickId('SYDNEY', 'Council of the City of Sydney') === '30');
check('NORTH SYDNEY is not City of Sydney', pickId('NORTH SYDNEY', 'North Sydney Council') === '88');
check('INNER WEST', pickId('INNER WEST', 'Inner West Council') === '59');
check('ORANGE -> Orange City', pickId('ORANGE', 'Orange City Council') === '91');
check('THE HILLS SHIRE', pickId('THE HILLS SHIRE') === '112');
check('CANTERBURY-BANKSTOWN', pickId('CANTERBURY-BANKSTOWN', 'Canterbury-Bankstown Council') === '15');
check('an area the register does not list', pickId('WAVERLEY', 'Waverley Council') === undefined);
check('lgaKey drops the qualifiers only', lgaKey('Council of the City of Sydney') === 'sydney' && lgaKey('North Sydney Council') === 'north sydney');

// ---- a project page -----------------------------------------------------------------

const page = `
<script type="application/json" data-drupal-selector="drupal-settings-json">{"geofield_google_map":{"geofield-map":{"data":{"features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[151.18447599999999,-33.888612999999999]},"properties":{}}]}}}}</script>
<div class="content-heading "><p class="content-heading__sub"> State Significant Development </p><div class="tag tag--green tag--fixed"> Determination </div><h1>USYD &amp; RPA Sydney Biomedical Accelerator Project</h1><p>City of Sydney</p></div>
<h2 class="heading--xs text--blue js-jump-ignore project__status-heading spacing--bottom-reset"> Current Status: <span class="text--blue"> Determination </span> </h2>
<div class="field field-field-project-description field-type-text-long field-label-hidden"> <p>Construction and operation of a medical research building and associated infrastructure and public domain works.</p> </div>
<div class="field field-major-projects-modifications field-type-ds field-label-hidden"> <div class="spacing--bottom-xl project__modifications"><h2 class="heading--m">Modifications</h2>
 <div class="row"> <div> <a href="/major-projects/projects/usyd-rpa-sba-project-mod-1-design-changes" hreflang="en">USYD &amp; RPA SBA Project MOD 1 - Design changes</a> </div> <div class="tag"> <div class="field field-field-case-stage field-type-list-string field-label-hidden"> Determination </div> </div> </div>
 <div class="row"> <div> <a href="/major-projects/projects/modification-2-minor-design-amendments" hreflang="en">Modification 2 Minor Design Amendments</a> </div> <div class="tag"> <div class="field field-field-case-stage field-type-list-string field-label-hidden"> Assessment </div> </div> </div> </div> </div>
<div class="field field-major-project-attachments field-type-ds field-label-hidden"><a href="/x">EIS (40)</a></div>
<div class="project__details"> <h2 class="heading--m">Project Details</h2> <div class="spacing--bottom-l" >
 <div class="row row--small "> <b>Application Number</b> <div><div class="field field-field-case-id field-type-string field-label-hidden"> SSD-55388456 </div> </div> </div>
 <div class="row row--small"> <b>Assessment Type</b> <div> State Significant Development </div> </div>
 <div class="row row--small"> <b>Development Type</b> <div><div class="field field-field-development field-type-list-string field-label-hidden"> Hospitals, medical centres and health research facilities </div> </div> </div>
 <div class="row row--small"> <b>Local Government Areas</b> <div>City of Sydney</div> </div>
 <div class="row row--small"> <b>Decision</b> <div> Approved </div> </div>
 <div class="row row--small"> <b>Determination Date</b> <div><div class="field field-field-date-of-determination-mp field-type-datetime field-label-hidden"> <time datetime="2024-11-18T13:00:00Z">19/11/2024</time> </div> </div> </div>
 <div class="row row--small "> <b>Decider</b> <div style="text-align:right;"><div class="field field-field-determination-authority field-type-string field-label-hidden"> Director </div> </div> </div>
 <div class="field field-major-projects-last-modified field-type-ds field-label-hidden"> <div><div class="row row--small"><b>Last Modified By</b><div>SSD-55388456-Mod-2</div></div><div class="row row--small"><b>Last Modified On</b><div>21/09/2026</div></div></div> </div> </div>
 <details class="accordion closed spacing--top-m" open> <summary class="accordion__title"><p class="heading--xs auto-margin">Contact Planner</p></summary> <div class="row row--small "> <b>Name</b> <div>A Planner</div></div></details></div>`;

const p = parseProjectPage(page);
check('page: the point', p.lon !== undefined && Math.abs(p.lon - 151.184476) < 1e-6 && Math.abs((p.lat ?? 0) + 33.888613) < 1e-6, `${p.lon},${p.lat}`);
check('page: current status', p.status === 'Determination', p.status);
check('page: description', p.description === 'Construction and operation of a medical research building and associated infrastructure and public domain works.', p.description);
check('page: development type', p.developmentType === 'Hospitals, medical centres and health research facilities', p.developmentType);
check('page: decision', p.decision === 'Approved', p.decision);
check('page: determination date in Sydney, not UTC', p.determined === '2024-11-19', p.determined);
check('page: decider', p.decider === 'Director', p.decider);
check('page: last modified by', p.lastModifiedBy === 'SSD-55388456-Mod-2', p.lastModifiedBy);
check('page: last modified on', p.lastModifiedOn === '2026-09-21', p.lastModifiedOn);
check('page: two modifications with their stages', p.modifications.length === 2 && p.modifications[0].title === 'USYD & RPA SBA Project MOD 1 - Design changes' && p.modifications[1].stage === 'Assessment', JSON.stringify(p.modifications));
check('page: the planner\'s name is not a detail', p.decider !== 'A Planner');

const bare = parseProjectPage('<h1>No details yet</h1>');
check('bare page: no point, no decision, no modifications', bare.lon === undefined && bare.decision === undefined && bare.modifications.length === 0);
check('a point outside NSW is dropped', parseProjectPage('{"type":"Point","coordinates":[0,0]}').lon === undefined);

// ---- stage classes ---------------------------------------------------------------------

check('determined: a decision', stageClassOf('Determination', { decision: 'Approved' }) === 'determined');
check('determined: refused is determined', stageClassOf('Determination', { decision: 'Refused', determined: '2025-01-01' }) === 'determined');
check('active: at the determination stage with no decision yet', stageClassOf('Determination', {}) === 'active');
check('active: in assessment', stageClassOf('Assessment', {}) === 'active');
check('withdrawn', stageClassOf('Withdrawn', {}) === 'withdrawn');
check('withdrawn: only the page says so', stageClassOf(undefined, { status: 'Withdrawn' }) === 'withdrawn');
check('lapsed: the SEARs expired', stageClassOf(undefined, { status: 'SEARs Expired' }) === 'withdrawn');
check('active: no card stage, the page in assessment', stageClassOf(undefined, { status: 'Response to Submissions' }) === 'active');

if (failures.length) {
  console.error(`major projects: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('major projects: all checks passed');
