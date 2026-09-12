import { describe, expect, it } from 'vitest';
import { clientDeskHtml } from './client-desk.js';

function desk(actor = 'Eben', storage = new Map(), denied = false) {
  const element = { value: '', textContent: '', innerHTML: '', addEventListener() {}, replaceChildren() {} };
  const window = {
    location: { pathname: '/client-desk', search: '', hash: '#dashboard_session=9999999999.' + btoa(actor) + '.fixture' },
    addEventListener() {}, matchMedia: () => ({ matches: false }),
    sessionStorage: {
      getItem(key) { if (denied) throw new Error('denied'); return storage.get(key) || null; },
      setItem(key, value) { if (denied) throw new Error('denied'); storage.set(key, value); },
    },
  };
  window.parent = window;
  const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const end = script.lastIndexOf('})();');
  const instrumented = script.slice(0, end) + 'return { classificationMarkup, classificationDraft, persistClassificationDrafts, normalizedClassificationTag, validClassificationTag, tagCatalogMarkup, tagChoiceAllowed, tagCatalogs }; })();';
  return new Function('window', 'history', 'document', 'fetch', 'return ' + instrumented.trim())(
    window, { replaceState() {} }, { getElementById: () => element },
    async () => ({ ok: true, json: async () => ({ threads: [] }) }),
  );
}
const data = {contact:{id:'contact-a'},tags:['focus'],roles:['client'],ownedClassificationAuthority:{state:'ready',tags:[{value:'focus',source:'ghl'},{value:'focus',source:'owned:staff'}],roles:[{value:'client',source:'owned:quiz'}]}};
describe('Client Desk classification provenance and retry state',()=>{
  it('requires a deliberate reusable catalog choice or create-new selection',()=>{
    const helper=desk(), draft=helper.classificationDraft('contact-a'); draft.tag='Focus Tag';
    helper.tagCatalogs.set('contact-a',{state:'ready',query:draft.tag,entries:[{value:'Focus Tag',source:'ghl',canonicalValue:'focus-tag',reusable:true}],truncated:false});
    expect(helper.tagChoiceAllowed(data,draft)).toBe(false);
    draft.tagChoice={canonicalValue:'focus-tag',create:false};expect(helper.tagChoiceAllowed(data,draft)).toBe(true);
    expect(helper.tagCatalogMarkup(data)).toContain('Adds Amari tag: focus-tag');
    draft.tag='new';draft.tagChoice={canonicalValue:'new',create:true};
    helper.tagCatalogs.set('contact-a',{state:'ready',query:'new',entries:[],truncated:true});
    expect(helper.tagChoiceAllowed(data,draft)).toBe(false);
    expect(helper.tagCatalogMarkup(data)).toContain('Refine the search');
    helper.tagCatalogs.set('contact-a',{state:'ready',query:'new',entries:[],truncated:false});
    expect(helper.tagCatalogMarkup(data)).toContain('Create new Amari tag: new');
    expect(helper.tagChoiceAllowed(data,draft)).toBe(true);
  });
  it('disables current owned labels and never presents unavailable data as empty results',()=>{
    const helper=desk(),draft=helper.classificationDraft('contact-a');
    helper.tagCatalogs.set('contact-a',{state:'ready',query:'',entries:[{value:'focus',source:'ghl',canonicalValue:'focus',reusable:true}]});
    expect(helper.tagCatalogMarkup(data)).toContain('Already added in Amari CRM');
    draft.tagChoice={canonicalValue:'focus',create:false};expect(helper.tagChoiceAllowed(data,draft)).toBe(false);
    helper.tagCatalogs.set('contact-a',{state:'unavailable',query:''});
    expect(helper.tagCatalogMarkup(data)).toContain('Tag catalog unavailable');
    expect(helper.tagCatalogMarkup(data)).not.toContain('No matching tags');
  });
  it('offers removal only for owned:staff and explains persistent imported duplicates',()=>{
    const html=desk().classificationMarkup(data);
    expect(html).toContain('Remove Amari tag');
    expect(html).not.toContain('Revoke Amari role');
    expect(html).toContain('GHL history · read-only');
    expect(html).toContain('Quiz record · read-only');
    expect(html).toContain('leaves the imported label visible');
  });
  it('keeps labels read-only with unknown provenance or unavailable schema',()=>{
    const html=desk().classificationMarkup({...data,ownedClassificationAuthority:{state:'unavailable'}});
    expect(html).toContain('Source: unavailable · read-only');
    expect(html).toContain('roles and tags are unavailable');
    expect(html).not.toContain('data-classification-action');
    expect(html).not.toContain('id="classification-tag-form"');
  });
  it('preserves exact per-contact commands across renewal and isolates actors',()=>{
    const storage=new Map(), first=desk('Eben',storage);
    const command={action:'remove_tag',contactId:'contact-a',value:'focus',idempotencyKey:'retry-exact-001'};
    Object.assign(first.classificationDraft('contact-a'),{tag:'Draft',command});
    first.persistClassificationDrafts();
    expect(desk('Eben',storage).classificationDraft('contact-a')).toMatchObject({tag:'Draft',command});
    expect(desk('Eben',storage).classificationDraft('contact-b').command).toBeNull();
    expect(desk('Garrett',storage).classificationDraft('contact-a').command).toBeNull();
  });
  it('allows a removal retry independently of empty add fields and fails closed when storage is denied',()=>{
    const helper=desk();helper.classificationDraft('contact-a').command={action:'remove_tag',value:'focus'};
    const html=helper.classificationMarkup(data);
    expect(html).toContain('id="classification-retry"');
    expect(html).toContain('type="button" class="note-submit" id="classification-retry"');
    expect(html).not.toContain('data-classification-action');
    expect(desk('Eben',new Map(),true).classificationMarkup(data)).not.toContain('data-classification-action');
  });
});
