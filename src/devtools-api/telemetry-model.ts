/* eslint-disable @typescript-eslint/naming-convention */
export interface TelemetryEvent {
  /**
   * Name of editor, for example VSCode.
   */
  'editor-type': string;
  /**
   * Version of editor, for example 1.112.0.
   */
  'editor-version'?: string;
  /**
   * Name of event, this should be unique for each tracked function.
   */
  'event-name': string;
  /**
   * Version of CodeScene extension.
   */
  'extension-version': string;
  /**
   * Set to true to mark the event as 'internal'. Used for filtering.
   */
  internal?: boolean;
  /**
   * Unique identifier of user. Could be CodeScene user id.
   */
  'user-id'?: string;
  /**
   * Per-activation UUID identifying this IDE session.
   */
  'session-id'?: string;
  /**
   * Absolute local paths whose git repositories the event concerns.
   * Used for enrichment and never forwarded.
   */
  'repository-paths'?: string[];
  [property: string]: any;
}

/**
 * Telemetry API Response model
 */
export interface TelemetryResponse {
  status: number;
}