import throttle from 'lodash.throttle';

export const REVIEW_QUEUE_THROTTLE_MS = 250;

export interface ReviewQueueSnapshot {
  count: number;
  files: string[];
}

type CancelableEmit = (() => void) & { cancel(): void };

export class ReviewQueueProgress {
  private latest: ReviewQueueSnapshot = { count: 0, files: [] };
  private readonly emit: CancelableEmit;

  constructor(private readonly onChange: (snapshot: ReviewQueueSnapshot) => void) {
    this.emit = throttle(() => this.onChange(this.latest), REVIEW_QUEUE_THROTTLE_MS, {
      leading: true,
      trailing: true,
    });
  }

  update(snapshot: ReviewQueueSnapshot): void {
    this.latest = snapshot;
    if (snapshot.count === 0) {
      this.emit.cancel();
      this.onChange(this.latest);
      return;
    }
    this.emit();
  }

  dispose(): void {
    this.emit.cancel();
  }
}
