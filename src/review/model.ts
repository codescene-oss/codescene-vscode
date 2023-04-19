// This details the structure of the JSON output from the 'cs review' command
export interface ReviewResult {
  score: number;
  review: ReviewIssue[];
}

export interface ReviewIssue {
  category: string;
  code: string;
  description: string;
  functions?: IssueDetails[];
}

export interface IssueDetails {
  details: string;
  title: string;
  'start-line': number;
}