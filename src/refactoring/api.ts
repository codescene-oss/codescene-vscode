/* eslint-disable @typescript-eslint/naming-convention */
interface Review {
  category: string;
  start_line: number;
}

interface SourceSnippet {
  language: 'JavaScript'; // 'TypeScript'
  start_line: number;
  end_line: number;
  content: string;
}

interface RefactorRequest {
  review: Review[];
  source_snippet: SourceSnippet;
}

interface RefactorConfidence {
  description: string;
  level: number;
  recommendedAction: { description: string; details: string };
}

interface RefactorResponse {
  confidence: RefactorConfidence;
  reasons: string[];
  code: string;
  success?: boolean; // probably redundant - do not use
}

interface SupportedData {
  languages: string[];
  codeSmells: string[];
}

interface PreFlightResponse {
  supported: SupportedData;
  maxInputTokens: number;
}
