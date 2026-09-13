// All requests are mocked; no provider or production data is read or written.
// PLAYWRIGHT_MODULE may point to an installed Playwright module for isolated runtimes.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { clientDeskHtml } from '../crm-mirror-worker/src/client-desk.js';

const proofDir = process.env.CLIENT_DESK_PROFILE_PROOF_DIR || await fs.mkdtemp(path.join(tmpdir(), 'amari-client-desk-profile-browser-proof-'));
await fs.mkdir(proofDir, { recursive: true });

const displayName = (state) => [state.firstName, state.lastName].filter(Boolean).join(' ') || 'Unnamed client';
const states = {
  'contact-a': { firstName: 'Avery', lastName: 'Example', authority: 'provider_mirror', revision: 0 },
  'contact-b': { firstName: 'Blair', lastName: 'Example', authority: 'provider_mirror', revision: 0 },
};
let schemaReady = true;
const commandResults = new Map();
const requests = [];
const unexpected = [];
let mode = 'success';
let releaseCommand;
let commandArrived;

function externalRename(contactId, firstName, lastName) {
  const state = states[contactId];
  state.firstName = firstName;
  state.lastName = lastName;
  state.authority = 'owned';
  state.revision += 1;
}

function profile(contactId) {
  const state = states[contactId];
  const name = displayName(state);
  return {
    contact: { id: contactId, display_name: name, ghl_contact_id: contactId === 'contact-a' ? 'abc123' : 'def456' },
    fields: Array.from({ length: 24 }, (_, index) => ({ attribute_key: `profile_field_${index}`, attribute_value: `Value ${index}` })),
    tasks: [],
    notes: Array.from({ length: 16 }, (_, index) => ({ id: `note-${contactId}-${index}`, authored_by: 'Imported note', body: `Stable record history ${index}`, created_at: '2026-09-01T12:00:00.000Z' })),
    appointments: [], purchases: [], invoices: [], activityTimeline: [],
    ownedNoteAuthority: { state: 'ready' },
    ownedTaskAuthority: { state: 'ready' },
    ownedClassificationAuthority: { state: 'ready', tags: [], roles: [] },
    ownedContactProfileAuthority: schemaReady ? {
      state: 'ready', allowedActions: ['revise_name'],
      name: { firstName: state.firstName, lastName: state.lastName, displayName: name, authority: state.authority, revision: state.revision },
    } : { state: 'unavailable', allowedActions: [], name: null },
  };
}

function commandKey(command) { return `${command.actor}\n${command.idempotencyKey}`; }
function commandResult(command) {
  const key = commandKey(command);
  const prior = commandResults.get(key);
  if (prior) return { profile: { ...prior, deduped: true } };
  const state = states[command.contactId];
  if (!state || command.expectedRevision !== state.revision) {
    return { error: 'stale_profile_revision', detail: 'contact profile revision is stale' };
  }
  state.firstName = command.firstName.trim();
  state.lastName = command.lastName.trim();
  state.authority = 'owned';
  state.revision += 1;
  const result = {
    contactId: command.contactId,
    action: 'revise_name',
    expectedRevision: command.expectedRevision,
    resultRevision: state.revision,
    displayName: displayName(state),
  };
  commandResults.set(key, result);
  return { profile: { ...result, deduped: false } };
}

function nextCommand() {
  return new Promise((resolve) => { commandArrived = resolve; });
}

const frameUrl = (actor) => `https://crm.test/client-desk?contact=contact-a&parent_origin=https%3A%2F%2Famarimethod.com#dashboard_session=9999999999.${Buffer.from(actor).toString('base64url')}.fixture`;
const html = clientDeskHtml();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
context.on('page', (tab) => tab.on('pageerror', (error) => pageErrors.push(String(error.message || error))));

try {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.hostname === 'amarimethod.com') {
      return route.fulfill({ contentType: 'text/html', body: `<iframe style="border:0;width:100%;height:100vh" src="${frameUrl('Eben')}"></iframe>` });
    }
    if (url.pathname === '/client-desk') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname.includes('/inbox')) {
      return json({ threads: Object.keys(states).map((contactId) => ({ contact_id: contactId, display_name: displayName(states[contactId]) })), freshness: { state: 'healthy' } });
    }
    if (url.pathname === '/client-desk/tag-catalog') return json({ state: 'ready', entries: [], truncated: false });
    if (url.pathname === '/contacts/profile-commands') {
      const command = route.request().postDataJSON();
      requests.push(command);
      commandArrived?.(command);
      commandArrived = null;
      if (mode === 'wait') await new Promise((resolve) => { releaseCommand = resolve; });
      if (mode === 'ambiguous') return json({ error: 'unavailable', detail: 'confirmation unavailable' }, 503);
      if (mode === 'ambiguous-after-apply') {
        const result = commandResult(command);
        assert.ok(result.profile, 'the mocked first attempt must apply before becoming ambiguous');
        return json({ error: 'unavailable', detail: 'confirmation unavailable' }, 503);
      }
      const result = commandResult(command);
      return result.error ? json(result, 409) : json(result);
    }
    if (url.pathname === '/contacts/classification-commands') return json({ classification: { contactId: 'contact-a', action: 'add_tag', value: 'draft' } });
    if (url.pathname.startsWith('/client-desk/contacts/')) return json(profile(url.pathname.split('/')[3]));
    unexpected.push(url.href);
    return route.abort();
  });

  const parent = await context.newPage();
  await parent.goto('https://amarimethod.com/fixture');
  let page;
  const getFrame = async () => {
    await parent.waitForTimeout(80);
    page = parent.frames().find((frame) => frame.url().includes('/client-desk'));
    await page.locator('#owned-contact-profile').waitFor({ timeout: 5_000 }).catch(async () => {
      throw new Error(`Client Desk profile did not mount: ${pageErrors.join(' | ') || await page.locator('body').innerText()}`);
    });
  };
  const replace = async (actor) => {
    await parent.evaluate((url) => {
      document.querySelector('iframe')?.remove();
      const frame = document.createElement('iframe');
      frame.style.cssText = 'border:0;width:100%;height:100vh';
      frame.src = url;
      document.body.append(frame);
    }, frameUrl(actor));
    await getFrame();
  };
  const choose = async (listName, expectedName = listName) => {
    await page.getByRole('button', { name: new RegExp(listName) }).click();
    await page.locator('.client-name').filter({ hasText: expectedName }).waitFor();
  };
  const edit = async (lastName) => {
    await page.locator('#contact-profile-edit').click();
    await page.locator('#contact-profile-last-name').fill(lastName);
  };
  const save = async () => page.locator('#owned-contact-profile-form button[type="submit"]').click();
  const retry = () => page.getByRole('button', { name: 'Retry save' });

  await getFrame();
  await page.locator('#new-note').fill('Keep note draft');
  await page.locator('#sms-reply').fill('Keep SMS draft');
  await page.locator('#task-title').fill('Keep task draft');
  await page.locator('#classification-tag').fill('Keep classification draft');

  await edit('Saved');
  await page.locator('#contact-profile-first-name').fill('Riley');
  await page.locator('#contact-profile-first-name').focus();
  mode = 'wait';
  const firstSave = nextCommand();
  await save();
  await firstSave;
  await page.locator('.record').evaluate((element) => { element.scrollTop = 72; });
  const initialScroll = await page.locator('.record').evaluate((element) => element.scrollTop);
  mode = 'success';
  releaseCommand();
  await page.getByText('Saved to Amari CRM.', { exact: true }).waitFor();
  assert.equal(await page.locator('.client-name').textContent(), 'Riley Saved');
  assert.equal(await page.locator('.client-head .avatar').textContent(), 'R');
  assert.equal(await page.getByRole('button', { name: /Riley Saved/ }).count(), 1);
  assert.equal(await page.locator('#new-note').inputValue(), 'Keep note draft');
  assert.equal(await page.locator('#sms-reply').inputValue(), 'Keep SMS draft');
  assert.equal(await page.locator('#task-title').inputValue(), 'Keep task draft');
  assert.equal(await page.locator('#classification-tag').inputValue(), 'Keep classification draft');
  assert.equal(await page.locator('.record').evaluate((element) => element.scrollTop), initialScroll);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'contact-profile-edit');

  mode = 'ambiguous';
  await edit('Retry');
  await save();
  await retry().waitFor();
  assert.equal(await retry().textContent(), 'Retry save');
  assert.equal(await retry().isDisabled(), false);
  const exactPending = structuredClone(requests.at(-1));
  await replace('Garrett');
  assert.equal(await page.locator('#owned-contact-profile-form').count(), 0);
  await replace('Eben');
  await retry().waitFor();
  assert.equal(await retry().isDisabled(), false);
  mode = 'success';
  await retry().click();
  await page.getByText('Saved to Amari CRM.', { exact: true }).waitFor();
  assert.deepEqual(requests.at(-1), exactPending);
  assert.equal(await page.locator('.client-name').textContent(), 'Riley Retry');

  // The first request writes revision 3 but its response is ambiguous. A
  // second operator then creates revision 4 before the exact-key retry.
  mode = 'ambiguous-after-apply';
  await edit('Command');
  await save();
  await retry().waitFor();
  externalRename('contact-a', 'Riley', 'Later');
  mode = 'success';
  await retry().click();
  await page.getByText('Already saved to Amari CRM.', { exact: true }).waitFor();
  assert.equal(await page.locator('#owned-contact-profile-form').count(), 0);
  assert.equal(await page.locator('.client-name').textContent(), 'Riley Later');
  assert.equal(await page.getByRole('button', { name: /Riley Later/ }).count(), 1);

  mode = 'wait';
  await edit('FocusSafe');
  const focusSafeSave = nextCommand();
  await save();
  await focusSafeSave;
  await page.locator('#new-note').fill('Keep note draft while name save finishes');
  await page.locator('#new-note').focus();
  mode = 'success';
  releaseCommand();
  await page.locator('.client-name').filter({ hasText: 'Riley FocusSafe' }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'new-note');
  assert.equal(await page.locator('#new-note').inputValue(), 'Keep note draft while name save finishes');

  mode = 'wait';
  await edit('Slow');
  const firstDelayed = nextCommand();
  await save();
  await firstDelayed;
  await choose('Blair Example');
  mode = 'success';
  releaseCommand();
  await parent.waitForTimeout(100);
  assert.equal(await page.locator('.client-name').textContent(), 'Blair Example');
  await choose('Riley FocusSafe', 'Riley Slow');

  mode = 'wait';
  await edit('Return');
  const secondDelayed = nextCommand();
  await save();
  await secondDelayed;
  await choose('Blair Example');
  await choose('Riley FocusSafe', 'Riley Slow');
  mode = 'success';
  releaseCommand();
  await page.locator('.client-name').filter({ hasText: 'Riley Return' }).waitFor();
  assert.equal(await page.locator('.client-name').textContent(), 'Riley Return');

  // A pristine editor follows a later authoritative readback. Once the user
  // types, it keeps the original revision and is forced through stale review.
  await page.locator('#contact-profile-edit').click();
  externalRename('contact-a', 'Riley', 'Current');
  await choose('Blair Example');
  await choose('Riley Return', 'Riley Current');
  assert.equal(await page.locator('#contact-profile-last-name').inputValue(), 'Current');
  await page.locator('#contact-profile-last-name').fill('Proposal');
  externalRename('contact-a', 'Riley', 'Newer');
  await choose('Blair Example');
  await choose('Riley Return', 'Riley Newer');
  assert.equal(await page.locator('#contact-profile-last-name').inputValue(), 'Proposal');
  await save();
  await page.locator('#contact-profile-conflict-retry').waitFor();
  assert.match(await page.locator('.owned-profile-conflict').textContent(), /Current: Riley Newer · revision/);
  assert.match(await page.locator('.owned-profile-conflict').textContent(), /Proposed: Riley Proposal/);
  assert.equal(states['contact-a'].lastName, 'Newer');

  for (const [name, width, height] of [['desktop', 1280, 800], ['mobile', 390, 844]]) {
    await parent.setViewportSize({ width, height });
    await page.locator('#owned-contact-profile').scrollIntoViewIfNeeded();
    await parent.screenshot({ path: path.join(proofDir, `${name}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  schemaReady = false;
  const unavailable = await context.newPage();
  await unavailable.goto(frameUrl('Eben'));
  await unavailable.locator('#owned-contact-profile').getByText('Name editing is unavailable').waitFor();
  assert.equal(await unavailable.locator('#contact-profile-edit').count(), 0);
  assert.deepEqual(unexpected, []);
  await fs.writeFile(path.join(proofDir, 'results.json'), JSON.stringify({
    pass: true,
    requests: requests.length,
    checks: [
      'mounted generated iframe click/save/readback updates header avatar and inbox label',
      'note SMS task and classification drafts plus focus and record scroll survive name readback',
      'a delayed name save does not steal focus from a later note draft',
      'ambiguous exact pending retry is enabled and preserved through same-actor renewal',
      'actor-scoped storage prevents another Staff session from retrying pending payload',
      'deduped immutable command confirmation accepts a newer authoritative revision',
      'delayed A-to-B and A-to-B-to-A responses respect selected contact',
      'pristine draft refreshes while dirty proposal keeps its original revision and conflicts',
      'desktop and mobile generated layouts have no horizontal overflow',
      'schema-gated authority does not advertise name editing',
    ],
  }, null, 2));
  console.log(`PASS mounted generated Client Desk profile UI; artifacts: ${proofDir}`);
} finally {
  await browser.close();
}
