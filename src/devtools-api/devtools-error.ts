import { DevtoolsError as DevtoolsErrorModel } from './model';

export class DevtoolsError extends Error {
  [property: string]: any;
  constructor(devtoolsErrorObj: DevtoolsErrorModel) {
    super(devtoolsErrorObj.message);
    Object.getOwnPropertyNames(devtoolsErrorObj).forEach((propName) => {
      this[propName] = devtoolsErrorObj[propName];
    });
  }
}
