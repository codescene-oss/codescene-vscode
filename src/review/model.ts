// This details the structure of the JSON output from the 'cs review' command
export interface ReviewResult {
  score: number;
  review: ReviewIssue[];
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'raw-score': any;
}

export interface ReviewIssue {
  category: string;
  description: string;
  functions?: IssueDetails[];
}

export interface IssueDetails {
  details: string;
  title: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'start-line': number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'end-line': number;
}