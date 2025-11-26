export class EventEmitterStub {
  event = () => ({ dispose: () => {} });
  fire() {}
  dispose() {}
}
