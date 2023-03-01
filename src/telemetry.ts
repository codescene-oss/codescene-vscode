// This module provides a global interface to the CodeScene telemetry.
import * as vscode from 'vscode';
import axios from 'axios';
import * as jws from 'jws';
import AuthSettings from './auth-settings';



console.log('CodeScene: creating telemetry logger');

async function signPayload (data :any) {
  const telemetryKey = await AuthSettings.instance.getTelemetryKey();
  return jws.sign({
    header: { alg: 'HS256' },
    payload: data,
    secret: telemetryKey, 
  });
}

function toJsonString (eventName :string, eventData? :Record<string, any>) {
  let dataMap :Map<string, any> = new Map();
  dataMap.set('event-time',(new Date()).toISOString());
  dataMap.set('event-type', eventName);
  if (eventData) {
    Object.entries(eventData).forEach(([key, value]) => {
      dataMap.set(key, value);
    });
  }
  return JSON.stringify(Object.fromEntries(dataMap));
}

function postTelemetry (jsonString :string) {
  const config = {
    headers: { 'content-type': 'application/json' },
    timeout: 5000 //milliseconds
  }

  axios.interceptors.request.use(
    async config => {
      const signature = await signPayload(config.data);
      config.headers['x-codescene-devtools'] = signature;
      return config
    },
    error => {
      return Promise.reject(error)
    }
  );
  
  axios.post('http://localhost:10000', jsonString, config)
    .catch((error) => {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.log('CodeScene telemetry error: server responded with status ', error.response.status);
      } else if (error.request) {
        // The request was made but no response was received
        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        console.log('CodeScene telemetry error: the request was made but no response was recieved.');
      } else {
        // Something happened in setting up the request that triggered an Error
        console.log('CodeScene telemetry error: ', error.message);
      }
    })
}

const sender: vscode.TelemetrySender = {
  sendEventData: async (eventName, eventData)  => {
    const jsonString = toJsonString(eventName, eventData);
    postTelemetry(jsonString);
  },
  sendErrorData: (error) => {
    console.log(error);
  }
};

const telemetryLogger: vscode.TelemetryLogger = vscode.env.createTelemetryLogger(sender);

export { telemetryLogger };