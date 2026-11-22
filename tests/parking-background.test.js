const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../shared.js');

function worker(settings = {}, previousJobs = [], namespace = 'chrome') {
  const local = { 'etix.settings': { parkingExecutionEnabled: true, ...settings }, 'etix.jobs': previousJobs };
  const session = {};
  const calls = [];
  const area = (data) => ({
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in data).map((key) => [key, structuredClone(data[key])])),
    set: async (values) => { Object.assign(data, structuredClone(values)); },
    remove: async (key) => { delete data[key]; }
  });
  let response = { status: 'continue', contextPatch: { purchaseAttempted: true }, stage: 'purchase_parking' };
  const sandbox = {
    EtixCore: core, importScripts() {}, URL, crypto: { randomUUID: () => 'test-job' },
    setTimeout: () => 0, clearTimeout() {},
    [namespace]: {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
      tabs: { onUpdated: { addListener() {} }, query: async () => [{ id: 1, url: 'https://boxoffice.etix.com/ticket/boxoffice/orderDetails.vw' }], get: async () => ({ status: 'complete' }), sendMessage: async (_tab, message) => { calls.push(message); return response; } },
      storage: { local: area(local), session: area(session) }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), sandbox);
  return { local, session, calls, run: (payload) => sandbox.runParkingJob('apply', payload), message: (type, payload) => sandbox.handleMessage({ type, payload }), advance: () => sandbox.advanceActiveJob('test-job'), respond: (value) => { response = value; } };
}
const payload = { orderNumber: '12345678', quantities: { parking: 1, disabled: 0, comp: 0 }, registrations: { parking: ['AB12 CDE'], disabled: [], comp: [] } };

for (const namespace of ['chrome', 'browser']) {
test(`parking plates stay in session storage and are removed when settled (${namespace})`, async () => {
  const background = worker({}, [], namespace);
  const started = await background.run(payload);
  assert.equal(started.job.status, 'running');
  assert.equal(background.calls[0].type, 'RUN_ETIX_PARKING_STEP');
  assert.equal(background.calls[0].payload.registrations.parking[0], 'AB12 CDE');
  assert.equal(JSON.stringify(background.local).includes('AB12 CDE'), false);
  assert.equal(background.session['parking.test-job'].parking[0], 'AB12 CDE');
  background.respond({ status: 'completed', reason: 'Verified' });
  await background.advance();
  assert.deepEqual(background.session, {});
  assert.equal(background.local['etix.activeJob'], undefined);
  assert.equal(background.local['etix.jobs'][0].status, 'completed');
  assert.equal(JSON.stringify(background.local).includes('AB12 CDE'), false);
});
}

test('parking and optional confirmation settings are checked before any browser action', async () => {
  const disabled = worker({ parkingExecutionEnabled: false });
  assert.equal((await disabled.run(payload)).job.result.stopCode, 'parking_disabled');
  assert.equal(disabled.calls.length, 0);
  const emailDisabled = worker();
  assert.equal((await emailDisabled.run({ ...payload, sendConfirmation: true })).job.result.stopCode, 'email_sending_disabled');
  assert.equal(emailDisabled.calls.length, 0);
});

test('an earlier unknown parking purchase is guarded against a second submission', async () => {
  const background = worker({}, [{ id: 'earlier', action: 'add_parking', mode: 'apply', orderNumber: payload.orderNumber, status: 'failed', context: { purchaseAttempted: true }, updatedAt: new Date().toISOString() }]);
  const result = await background.run(payload);
  assert.equal(result.job.result.stopCode, 'duplicate_parking_guard');
  assert.equal(background.calls.length, 0);
  assert.deepEqual(background.session, {});
});

test('disabled workflows reject preview and live requests before starting jobs or browser actions', async () => {
  for (const [setting, types, request] of [
    ['carerWorkflowEnabled', ['PREVIEW_CARER_DISCOUNT', 'APPLY_CARER_DISCOUNT'], { orderNumber: '12345678', quantity: 1 }],
    ['emailWorkflowEnabled', ['PREVIEW_ORDER_CONFIRMATION_EMAIL', 'SEND_ORDER_CONFIRMATION_EMAIL'], { lookupValue: '12345678' }],
    ['parkingWorkflowEnabled', ['PREVIEW_ADD_PARKING', 'ADD_PARKING'], payload]
  ]) {
    for (const type of types) {
      const background = worker({ [setting]: false, liveExecutionEnabled: true, emailExecutionEnabled: true });
      const result = await background.message(type, request);
      assert.equal(result.ok, false, type);
      assert.match(result.error, /workflow is disabled in Settings/);
      assert.equal(background.calls.length, 0);
      assert.equal(background.local['etix.jobs'].length, 0);
      assert.equal(background.local['etix.activeJob'], undefined);
      assert.deepEqual(background.session, {});
    }
  }
});

test('disabling the email workflow blocks optional parking emails even when live email sending is permitted', async () => {
  const background = worker({ emailWorkflowEnabled: false, emailExecutionEnabled: true });
  const result = await background.run({ ...payload, sendConfirmation: true });
  assert.equal(result.job.status, 'blocked');
  assert.equal(result.job.result.stopCode, 'email_workflow_disabled');
  assert.equal(background.calls.length, 0);
  assert.deepEqual(background.session, {});
});
