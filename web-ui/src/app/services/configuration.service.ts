import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable()
export class ConfigurationService {
    private config: Promise<Config>;

    constructor(private httpClient: HttpClient) {
        this.config = this.loadConfig();
    }

    async getDjangoUrl(path: string) {
        return (await this.config).django + path;
    }

    private async loadConfig() {
        return this.httpClient.get<Config>(`assets/config/config.${environment.name}.json`).toPromise();
    }

    async getRootUrl() { return (await this.config).django; }
    async getLegacyUploadUrl() { return (await this.config).legacy_upload; }
    async getLegacyProviders() { return (await this.config).legacy_providers; }
}

interface Config {
    django: string;

    legacy_upload: string;
    legacy_providers: Record<string, string>;
}
