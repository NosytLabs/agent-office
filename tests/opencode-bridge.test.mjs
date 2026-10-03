import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

const bridgeUrl = new URL('../opencode/index.js', import.meta.url).href;

function recordEvents(events, customHome = false) {
  const home = mkdtempSync(join(tmpdir(), 'agent-office-bridge-'));
  const hermesHome = customHome ? join(home, 'custom-hermes') : join(home, '.hermes');
  const script = `
    import bridgeFactory from ${JSON.stringify(bridgeUrl)};
    const bridge = await bridgeFactory();
    for (const event of JSON.parse(process.argv[1])) await bridge.event({event});
  `;
  try {
    const env = {...process.env, HOME: home};
    delete env.HERMES_HOME;
    if (customHome) env.HERMES_HOME = hermesHome;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(events)], {env, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const path = join(hermesHome, 'pixel-office', 'events.jsonl');
    return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  } finally {
    rmSync(home, {recursive: true, force: true});
  }
}

test('OpenCode writes events to the configured HERMES_HOME', () => {
  const events = recordEvents([{type: 'session.created', data: {id: 'custom-home-session'}}], true);
  assert.equal(events.length, 1);
  assert.equal(events[0].session_id, 'custom-home-session');
});

test('OpenCode session creation and deletion use properties.info.id', () => {
  const info = {id: 'sdk-session', title: 'Review changes', version: '1', time: {created: 1, updated: 2}};
  const events = recordEvents([
    {type: 'session.created', properties: {info}},
    {type: 'session.deleted', properties: {info}},
  ]);
  assert.deepEqual(events.map(({event, session_id}) => ({event, session_id})), [
    {event: 'session_start', session_id: 'sdk-session'},
    {event: 'session_end', session_id: 'sdk-session'},
  ]);
});

test('OpenCode approval events retain the requesting session and response', () => {
  const events = recordEvents([
    {type: 'permission.asked', properties: {id: 'permission-1', sessionID: 'approval-session', permission: 'bash', patterns: ['npm test'], metadata: {}}},
    {type: 'permission.replied', properties: {sessionID: 'approval-session', requestID: 'permission-1', reply: 'once'}},
  ]);
  assert.deepEqual(events.map(({event, session_id, command, choice}) => ({event, session_id, command, choice})), [
    {event: 'approval_request', session_id: 'approval-session', command: 'bash', choice: undefined},
    {event: 'approval_response', session_id: 'approval-session', command: undefined, choice: 'once'},
  ]);
});

test('OpenCode session errors from properties remain attributed to the session', () => {
  const events = recordEvents([{type: 'session.error', properties: {sessionID: 'failed-session', error: {name: 'UnknownError', data: {message: 'fixture failure'}}}}]);
  assert.equal(events.length, 1);
  assert.equal(events[0].session_id, 'failed-session');
  assert.equal(events[0].status, 'error');
});

test('OpenCode retains support for legacy data payloads', () => {
  const events = recordEvents([{type: 'session.created', data: {sessionID: 'legacy-session'}}]);
  assert.equal(events.length, 1);
  assert.equal(events[0].session_id, 'legacy-session');
});
