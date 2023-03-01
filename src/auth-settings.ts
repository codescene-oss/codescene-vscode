import { ExtensionContext, SecretStorage } from "vscode";


export default class AuthSettings {
    private static _instance: AuthSettings

    constructor(private secretStorage: SecretStorage) {}

    static init(context: ExtensionContext): void {
        /*
        Create instance of new AuthSettings.
        */
        console.log('CodeScene: initializing sectrets storage');
        AuthSettings._instance = new AuthSettings(context.secrets)
    }

    static get instance(): AuthSettings {
        /*
        Getter of our AuthSettings existing instance.
        */
        return AuthSettings._instance
    }

    async storeTelemetryKey(key?: string): Promise<void> {
        if (key) {
            this.secretStorage.store("telemetry_key", key)
        }
    }

    async getTelemetryKey() {
		return await this.secretStorage.get("telemetry_key");
    }

}
