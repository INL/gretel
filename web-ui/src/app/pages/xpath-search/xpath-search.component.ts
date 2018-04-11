import {Component, OnInit, ViewChild} from '@angular/core';
import {Crumb} from "../../components/breadcrumb-bar/breadcrumb-bar.component";
import {HttpClient, HttpHeaders} from '@angular/common/http';
import {SessionService} from "../../services/session.service";
import {ResultService} from "../../services/result.service";
import {GlobalState, Step, XpathInputStep, ResultStep, SelectTreebankStep} from "./steps";
import {Transition, Transitions, IncreaseTransition, DecreaseTransition} from './transitions'
import {TreebankService} from "../../services/treebank.service";
import {ResultsService} from "../../services/results.service";

/**
 * The xpath search component is the main component for the xpath search page. It keeps track of global state of the page
 * It uses steps and transitions to determine the next state.
 */

@Component({
    selector: 'app-x-path-search',
    templateUrl: './xpath-search.component.html',
    styleUrls: ['./xpath-search.component.scss']
})
export class XpathSearchComponent implements OnInit {
    inputStep: XpathInputStep;
    globalState: GlobalState;
    configuration: any;
    transitions: Transitions;
    crumbs: Crumb[] = [
        {
            name: "XPath",
            number: 1,
        },
        {
            name: "Treebanks",
            number: 2,
        },
        {
            name: "Results",
            number: 3,
        },
        {
            name: "Analysis",
            number: 4,
        },
    ];


    //All the components. used to call functions on.
    @ViewChild('xpathInput')
    xpathInput;
    @ViewChild('selectTreebanks')
    selectTreebanks;
    @ViewChild('hiddenForm')
    form;
    @ViewChild('resultComponentRef')
    resultComponent;


    constructor(private http: HttpClient, private sessionService: SessionService, private resultService: ResultService, private treebankService: TreebankService, private resultsService: ResultsService) {
        this.inputStep = new XpathInputStep(0);

        this.globalState = {
            results: undefined,
            selectedTreebanks: undefined,
            currentStep: {number: 0, step: this.inputStep},
            valid: false,
            XPath: '//node'
        };

        this.configuration = {
            steps: [
                this.inputStep,
                new SelectTreebankStep(1, this.treebankService, this.http, this.resultService),
                new ResultStep(2,this.resultsService),
            ]

        };
        this.transitions = new Transitions([new IncreaseTransition(this.configuration.steps), new DecreaseTransition(this.configuration.steps)]);
    }


    ngOnInit() {
    }


    /**
     * Go back one step
     */
    prev() {
        this.transitions.fire('decrease', this.globalState).subscribe((s) => {
            this.globalState = s;
        });

    }


    /**
     *  go to next step. Only can continue of the current step is valid.
     */
    next() {
        if (this.globalState.valid) {
            this.transitions.fire('increase', this.globalState).subscribe((s) => {
                this.globalState = s;
            });
        } else {
            this.showWarning();
        }
    }

    /**
     * Sets
     * @param boolean
     */
    setValid(valid: boolean) {
        this.globalState.valid = valid
    }

    /**
     * Show the warning of the appropriate component.
     */
    showWarning() {
        switch (this.globalState.currentStep.number) {
            case 1: {
                this.xpathInput.showWarning();
                break;
            }
            case 2: {
                this.selectTreebanks.showWarning();
                break;
            }
            case 3: {
                this.resultComponent.showWarning();
                break;
            }


        }

    }

    updateSelected(e) {
        this.globalState.selectedTreebanks = e
    }

}
