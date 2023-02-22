// This module provides a global interface to the CodeScene telemetry.
import * as vscode from 'vscode';

console.log('CodeScene: creating telemetry logger');

const sender: vscode.TelemetrySender = {
  sendEventData: (eventName, eventData)  => {
    console.log(eventName);
    console.log(new Date());
    console.log(`Data: ${JSON.stringify(eventData)}`);
  },
  sendErrorData: (error) => {
    console.log(error);
  }
};
let telemetryLogger: vscode.TelemetryLogger = vscode.env.createTelemetryLogger(sender);

export { telemetryLogger };