import * as assert from 'assert';
import { RoutingGate } from '../../telemetry-routing-gate';

suite('RoutingGate Test Suite', () => {
  test('sends immediately when not held', () => {
    const sent: string[] = [];
    const gate = new RoutingGate<string>({
      send: (item) => sent.push(item),
    });

    gate.submit('event1');
    gate.submit('event2');

    assert.deepStrictEqual(sent, ['event1', 'event2']);
  });

  test('holds until ready', () => {
    const sent: string[] = [];
    const gate = new RoutingGate<string>({
      send: (item) => sent.push(item),
    });

    const generation = gate.hold();
    gate.submit('event1');
    gate.submit('event2');

    assert.deepStrictEqual(sent, [], 'Events should be queued while held');

    gate.ready(generation);

    assert.deepStrictEqual(sent, ['event1', 'event2'], 'Events should be released in order');
  });

  test('ignores a stale generation', () => {
    const sent: string[] = [];
    const gate = new RoutingGate<string>({
      send: (item) => sent.push(item),
    });

    const gen1 = gate.hold();
    gate.submit('event1');

    const gen2 = gate.hold();
    gate.submit('event2');

    gate.ready(gen1);
    assert.deepStrictEqual(sent, [], 'Should not release with stale generation');

    gate.ready(gen2);
    assert.deepStrictEqual(sent, ['event1', 'event2'], 'Should release with current generation');
  });

  test('releases when the bound runs out', (done) => {
    const sent: string[] = [];
    const gate = new RoutingGate<string>({
      boundMs: 50,
      send: (item) => sent.push(item),
    });

    gate.hold();
    gate.submit('event1');
    gate.submit('event2');

    setTimeout(() => {
      try {
        assert.deepStrictEqual(sent, ['event1', 'event2'], 'Events should be released after bound timeout');
        done();
      } catch (e) {
        done(e);
      }
    }, 100);
  });

  test('drops the oldest beyond the maximum', () => {
    const sent: string[] = [];
    const gate = new RoutingGate<string>({
      maxHeld: 3,
      send: (item) => sent.push(item),
    });

    const generation = gate.hold();
    gate.submit('event1');
    gate.submit('event2');
    gate.submit('event3');
    gate.submit('event4');
    gate.submit('event5');

    gate.ready(generation);

    assert.deepStrictEqual(sent, ['event3', 'event4', 'event5'], 'Should keep only the last 3 events');
  });

  test('releases in logging order with session-started first', () => {
    const sent: string[] = [];
    const gate = new RoutingGate<string>({
      isFirst: (item) => item.includes('session-started'),
      send: (item) => sent.push(item),
    });

    const generation = gate.hold();
    gate.submit('event1');
    gate.submit('event2');
    gate.submit('session-started');
    gate.submit('event3');

    gate.ready(generation);

    assert.deepStrictEqual(sent, ['session-started', 'event1', 'event2', 'event3'], 'session-started should be moved to the front');
  });

  test('close releases and ignores later holds', () => {
    const sent: string[] = [];
    const gate = new RoutingGate<string>({
      send: (item) => sent.push(item),
    });

    const gen1 = gate.hold();
    gate.submit('event1');

    gate.close();

    assert.deepStrictEqual(sent, ['event1'], 'Events should be released on close');

    const gen2 = gate.hold();
    gate.submit('event2');

    assert.strictEqual(gen1, gen2, 'Generation should not change after close');
    assert.deepStrictEqual(sent, ['event1', 'event2'], 'Events should be sent immediately after close');
  });
});
