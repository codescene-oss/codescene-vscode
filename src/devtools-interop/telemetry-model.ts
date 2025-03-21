/* eslint-disable @typescript-eslint/naming-convention */
export interface TelemetryEvent {
    /**
     * Name of editor, for example VSCode.
     */
    "editor-type": string;
    /**
     * Name of event, this should be unique for each tracked function.
     */
    "event-name": string;
    /**
     * Version of CodeScene extension.
     */
    "extension-version": string;
    /**
     * Set to true to mark the event as 'internal'. Used for filtering.
     */
    internal?: boolean;
    /**
     * Unique identifier of user. Could be CodeScene user id.
     */
    "user-id"?: string;
    [property: string]: any;
}
