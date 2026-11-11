/**
 * The objectives snapshot published by cs-ide (`objectives.json`), mirrored from the contract
 * `cli/src/codescene/devtools/ide/objectives_schema.clj`. Keys are kebab-case on the wire.
 */

export type ObjectiveKind = "policy" | "target" | "goal";

export type ObjectiveResult = "satisfied" | "violated" | "indeterminate";

/** ok when the objectives could be read, otherwise why there are none. */
export type ObjectivesState =
  "ok" | "signed-out" | "no-project" | "no-area" | "off" | "unavailable";

/** The condition the objective sets on its metric. */
export interface ObjectiveThreshold {
  /** How the value is compared with the threshold, for example greater-than-or-equal. */
  operator: string;
  /** How the threshold is set: absolute, or relative to a baseline captured on the server. */
  mode: string;
  /** The threshold as configured. */
  value: number;
  /** The value the metric is compared with, when it does not depend on a file. */
  "comparison-value"?: number;
}

/** What a Goal contributes to. */
export interface ObjectiveParent {
  kind: ObjectiveKind;
  id: number;
  /** Who created the parent objective. Absent when it could not be resolved. */
  "created-by-display-name"?: string;
}

/** A file a Goal is about. */
export interface ObjectiveSubjectFile {
  /** Path of the file, relative to the repository root. */
  path: string;
}

/** Evidence behind a hotspot recommendation. */
export interface ObjectiveRecommendationEvidence {
  /**
   * The Code Health issues the Goal tracks: one for a generated Goal, several for a Goal
   * created before findings were tracked one by one.
   */
  "code-health-issues": string[];
  revisions?: number;
  loc?: number;
  "cyclomatic-complexity"?: number;
  defects?: number;
}

/** The hotspot recommendation a recommendation Goal tracks a finding of. */
export interface ObjectiveRecommendation {
  /** Whether the finding is of a function or of the file as a whole. */
  scope: "function" | "file";
  /** The function, for example processOrder, or processOrder:18 for an issue found at a line. */
  target: string;
  "recommendation-type": string;
  /** Why the recommendation matters. */
  text: string;
  evidence: ObjectiveRecommendationEvidence;
}

/** What the objective is measured on. */
export interface ObjectiveSubject {
  /**
   * An Area, a set of files, or one file with a Code Health finding. A recommendation Goal is
   * satisfied when its finding is resolved, not by a score threshold.
   */
  type: "area" | "files" | "recommendation";
  /** The files of a Goal that live in this repository. */
  files?: ObjectiveSubjectFile[];
  /** The recommendation of a recommendation Goal. */
  recommendation?: ObjectiveRecommendation;
}

/** The latest result stored on the server. Absent when the objective was never evaluated. */
export interface SharedResult {
  /** current, pending, stale, not-evaluated, inactive or completed. */
  applicability: string;
  /** satisfied, violated or indeterminate. Absent when there is no evaluation of the current revision. */
  result?: string;
  /** The value of the metric the server measured. */
  value?: number;
  /** When the server evaluated it, an ISO timestamp. */
  "evaluated-at"?: string;
  /** The point in time of the analysis data the evaluation used, an ISO timestamp. */
  "as-of"?: string;
}

/** How one file of a Goal fares in the working tree. */
export interface LocalFileResult {
  /** Path of the file, relative to the repository root. */
  path: string;
  result: ObjectiveResult;
  /**
   * Why, for example threshold-met, threshold-not-met or subject-removed; for a recommendation
   * Goal finding-present, finding-resolved or findings-unavailable.
   */
  reason: string;
  /** Current Code Health of the file. */
  value?: number;
  /** The value it is compared with. */
  "comparison-value"?: number;
}

/** The result measured in the working tree. */
export interface LocalResult {
  result: ObjectiveResult;
  /** Why, for example threshold-met, area-aggregate-unsupported, no-local-files or invalid-definition. */
  reason: string;
  /** The result per file, for a File Goal evaluated locally. */
  files?: LocalFileResult[];
}

/** A participant in a Goal work session. */
export interface WorkSessionParticipant {
  actor: string;
  /** The participant's name. Absent when it could not be resolved. */
  "display-name"?: string;
  you: boolean;
  "started-at": string;
}

/** Goal work session presence and state. */
export interface GoalWorkSessions {
  state: "ok" | "scope-missing" | "unavailable";
  reauthorize: boolean;
  participants: WorkSessionParticipant[];
  mine?: {
    "session-id": number;
    "started-at": string;
  };
}

/** A Policy, Target or Goal that covers the repository. */
export interface Objective {
  kind: ObjectiveKind;
  /** Id of the objective, unique within its kind. */
  id: number;
  revision: number;
  /** Id of the Area the objective is defined on. */
  "area-id": number;
  /** The metric, for example average-code-health. */
  "metric-id": string;
  threshold: ObjectiveThreshold;
  /** Who created the objective. Absent when it could not be resolved. */
  "created-by-display-name"?: string;
  parent?: ObjectiveParent;
  subject: ObjectiveSubject;
  shared?: SharedResult;
  local: LocalResult;
  /** Goal work sessions (Goals only). */
  "work-sessions"?: GoalWorkSessions;
}

/** The CodeScene project the repository is linked to. */
export interface ObjectiveProject {
  id: string;
  name: string;
}

/** The objectives that cover a repository. Sorted by kind, then Area id, then id. */
export interface ObjectivesSnapshot {
  /** Root of the repository. */
  "repo-root": string;
  state: ObjectivesState;
  project?: ObjectiveProject;
  /** When the server was last read successfully, an ISO timestamp. */
  "refreshed-at"?: string;
  objectives: Objective[];
}
