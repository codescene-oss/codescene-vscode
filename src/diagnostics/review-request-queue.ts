import { ReviewOpts } from '../review/reviewer';

export class ReviewRequestQueue {
  private ongoingReviews = new Set<string>();
  private reviewQueue = new Map<string, ReviewOpts | undefined>();

  requestReview(fileName: string, reviewOpts?: ReviewOpts): boolean {
    // If there is already a review running for the file, this review will be queued
    // up for running later
    if (this.ongoingReviews.has(fileName)){
      this.reviewQueue.set(fileName, reviewOpts);
      return false;
    }
    this.ongoingReviews.add(fileName);
    return true;
  }

  finishReview(fileName: string) : ReviewOpts | undefined {
    // When review completes, return a queued up review request if there is one
    this.ongoingReviews.delete(fileName);
    if (this.reviewQueue.has(fileName)) {
      const opts = this.reviewQueue.get(fileName);
      this.reviewQueue.delete(fileName);
      return opts;
    }
  }
}
