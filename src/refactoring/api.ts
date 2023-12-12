interface Review {
  category: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  start_line: number;
}

interface SourceSnippet {
  language: 'JavaScript'; // 'TypeScript'
  // eslint-disable-next-line @typescript-eslint/naming-convention
  start_line: number;
  end_line: number;
  content: string;
}

interface RefactorRequest {
  review: Review[];
  // eslint-disable-next-line @typescript-eslint/naming-convention
  source_snippet: SourceSnippet;
}

interface RefactorResponse {
  code: string;
  result: string;
  success: boolean;
}
