import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { faChevronLeft, faChevronRight, faLock, faTags } from '@fortawesome/free-solid-svg-icons';

import { map } from 'rxjs/operators';
import { Subscription } from 'rxjs';

import { animations } from '../../../animations';
import { GlobalStateExampleBased, StepType } from '../../../pages/multi-step-page/steps';
import { Treebank, TreebankSelection, TreebankStub } from '../../../treebank';
import { StateService, TreebankService, TreebankSelectionService } from '../../../services/_index';
import { StepDirective } from '../step.directive';
import { capitalize, upperFirst } from 'lodash';
import { UserProvider } from './select-treebank-providers.component';


@Component({
    animations,
    selector: 'grt-select-treebanks',
    templateUrl: './select-treebanks.component.html',
    styleUrls: ['./select-treebanks.component.scss']
})
export class SelectTreebanksComponent extends StepDirective<GlobalStateExampleBased> implements OnInit, OnDestroy {
    faChevronLeft = faChevronLeft;
    faChevronRight = faChevronRight;
    faLock = faLock;
    faTags = faTags;

    public treebanks: Array<Treebank&{color: string, userName: string, preConfigured: boolean, selected: boolean}> = [];
    public loading = true;
    public stepType = StepType.SelectTreebanks;
    public selection: TreebankSelection;
    public filterText = '';

    public showPreConfigured = true;
    public showUserTags = false;
    public showUsers: number[] = [];

    @Output()
    public prev = new EventEmitter();

    @Output()
    public next = new EventEmitter();

    private readonly subscriptions: Subscription[];

    public users = new class {
        // bulma.io tag colors
        private colors = [
            'primary',
            'link',
            'info',
            'success',
            'warning',
            'danger'
        ];

        private _users = new Map<number, UserProvider>();
        
        public get(): UserProvider[] {
            return Array.from(this._users.values()).sort((a, b) => a.name.localeCompare(b.name));
        }

        public getOrCreate(userId?: number, email?: string, username?: string): UserProvider {
            if (!userId) return {color: this.colors[0], id: -1, name: 'Pre-configured'};
            if (this._users.has(userId)) return this._users.get(userId)!;

            return this._users
                .set(userId, {
                    id: userId,
                    color: this.colors[this._users.size % this.colors.length],
                    name: username || this.usernameFromEmail(email) || `Unknown user [${userId}]`
                })
                .get(userId)!;
        }

        /** Return supplied username, or compute a fallback from the email address. */
        private usernameFromEmail(email?: string): string|undefined {
            return email?.
                split('@', 1)[0] // part before '@' (or whole string if no '@')
                .split('.') // split on dots
                .map(upperFirst) // capitalize every part
                .join(' '); // spaces between 
            // e.g. koen.mertens@... -> 'Koen Mertens'
        }
    }

    constructor(treebankService: TreebankService,
        private treebankSelectionService: TreebankSelectionService,
        stateService: StateService<GlobalStateExampleBased>) {
        super(stateService);

        this.subscriptions = [
            treebankService.treebanks$.pipe(
                // add extra info
                map(tbs => tbs.map(tb => ({
                    ...tb, 
                    color: this.users.getOrCreate(tb.userId, tb.email).color,
                    userName: this.users.getOrCreate(tb.userId, tb.email).name,
                    preConfigured: (tb.userId ?? null) == null,
                    selected: this.selection && this.selection.isSelected(tb.provider, tb.id)
                })))
                // sort by treebank name, then by upload date
            )
            .subscribe(treebanks => {
                this.treebanks = treebanks;
                this.showUsers = this.users.get().map(user => user.id);
            }),
            treebankSelectionService.state$.subscribe(selection => {
                this.selection = selection;
                this.treebanks = this.treebanks.map(treebank => {
                    treebank.selected = selection.isSelected(treebank.provider, treebank.id);
                    return treebank;
                });
            }),
            treebankService.loading$.subscribe(loading => this.loading = loading)
        ];
    }

    ngOnInit() {
        super.ngOnInit();
    }

    ngOnDestroy() {
        super.ngOnDestroy();
        this.subscriptions.forEach(s => s.unsubscribe());
    }

    toggleTreebank(corpus: Treebank) {
        this.treebankSelectionService.toggleCorpus(corpus);
    }

    public getWarningMessage() {
        return 'Please select a treebank and the components.';
    }
}
