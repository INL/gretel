import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { ConfigurationService } from './configuration.service';
import { NotificationService } from './notification.service';

type UserResponse = {
    user: undefined|{
        id: number;
        username: string;
    }
    token: undefined|string;
}

class InternalUser {
    id: number;
    username: string;
    token: string;

    constructor(response: UserResponse) {
        this.token = response.token;
        this.id = response.user.id;
        this.username = response.user.username;
    }
};


export type User = {
    [key in keyof InternalUser]: InternalUser[key]
}


@Injectable({
    providedIn: 'root'
})
export class UserService {
    private _user$: BehaviorSubject<User>;

    constructor(
        private http: HttpClient,
        private configurationService: ConfigurationService,
        private notificationService: NotificationService) { }

    public get user$() {
        if (this._user$) {
            return this._user$.asObservable();
        }

        this._user$ = new BehaviorSubject<User>(undefined);
        this.retrieveCurrent();
        return this._user$;
    }

    /**
     * Retrieve the current user or set it to undefined
     */
    private async retrieveCurrent(): Promise<boolean> {
        try {
            const currentUrl = await this.configurationService.getDjangoUrl('auth/user/');
            const response = await this.http.get<UserResponse>(currentUrl).toPromise();
            return this.setUser(response.user ? new InternalUser(response) : undefined);
        } catch (e) {
            console.error('failed to get current user?', e);
            return false;
        }
    }

    /**
     * Logs the user in, returns true if successful
     */
    async login(username: string, password: string): Promise<boolean> {
        try {
            if (this._user$.value) {
                console.error('User already logged in');
                return false;
            }
            const jsonbody = {username, password};
            const loginResponse = await this.http.post<UserResponse>(await this.configurationService.getDjangoUrl('auth/login/'),jsonbody,).toPromise();
            return this.setUser(new InternalUser(loginResponse));
        } catch (e) {
            console.error('Failed to login', e);
            return false;
        }
    }

    /**
     * Logs the user out, returns true if successful
     */
    async logout(): Promise<boolean> {
        try {
            const user = await this.user$.toPromise()
            if (!user || !user.token) {
                console.error('No token found for user. Cannot perform logout');
                return false;
            }
            const response = await this.http.post(await this.configurationService.getDjangoUrl('auth/logout/'), {token: user.token}).toPromise()
            return this.setUser(undefined);
        } catch (e) {
            console.error('Failed to logout', e);
            return false;
        }
    }

    /** Update the current user and return a boolean indicating whether a user is now logged in (or not). */
    private setUser(user?: InternalUser): boolean {
        if (!this._user$) {
            this._user$ = new BehaviorSubject<User>(undefined);
        }

        this._user$.next(user);
        return !!user;
    }
}
