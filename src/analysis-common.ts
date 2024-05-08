export type AnalysisEventType = 'start' | 'end' | 'idle';

export interface AnalysisEvent {
  type: AnalysisEventType;
}
