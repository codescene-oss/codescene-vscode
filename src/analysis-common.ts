// TODO - move this to some analysis-common place
export type AnalysisEventType = 'start' | 'end' | 'idle';
export interface AnalysisEvent {
  type: AnalysisEventType;
}
