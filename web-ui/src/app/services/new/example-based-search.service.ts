
import { TokenAttributes } from 'src/app/models/matrix';
import { FilterValues } from '../results.service';
import ServiceWithStream, { TransitionResult } from './generic/stream-based-service';
import { Step, StepManager } from './generic/step-based-service';
import { HttpClient } from '@angular/common/http';
import { ConfigurationService } from '../configuration.service';
import { AlpinoService } from '../alpino.service';
import { TreebankService } from '../treebank.service';
import { TreebankSelectionService } from '../treebank-selection.service';


type ExampleBasedUrlState = Partial<{
	step: number;
	
	/** Example sentence entered */
	inputSentence: string;
	/** Generated xpath from example parse, or xpath entered by the user */
	xpath: string;
	/** Was xpath edited by the user */
	isCustomXpath: '1'|'0';
	
	retrieveContext: '1'|'0';
	respectOrder: '1'|'0';
	ignoreTopNode: '1'|'0';
	
	/** Unsure. Looks like "~rel::~pt::" */
	attributes: string;

	selectedTreebanks: Record<string, Record<string, string[]>>;

	// TODO filters don't enter the URL.
}>

type ExampleBasedState = {
	// step: number;

	inputSentence?: string;
	xpath?: string;

	test: string[];
	
	filterValues: FilterValues;
	
	/** Include context in results (the preceding and following sentence) */
	retrieveContext: boolean;
	/** Query additional custom properties for variables */
	variableProperties: Array<{
		// start with $, refers to an existing variable extracted from
		// the query tree
		variableName: string;
		// start with _
		propertyName: string;
		propertyExpression: string;
		enabled: boolean;
	}>;
	isCustomXPath: boolean;
		
	exampleXml: string;
	subTreeXml: string;
	
	/** ?? */
	tokens: string[];
	attributes: TokenAttributes[];
	/** Ignores properties of the dominating node */
	ignoreTopNode: boolean;
	/** Respect word order */
	respectOrder: boolean;
}

class ExampleBasedStep0 extends Step<StateManagerExampleBased, any> {
	canLeave(state: Readonly<StateManagerExampleBased>): Promise<boolean> {
		return state.
	}

	decodeState(state: StateManagerExampleBased, urlState: Partial<any>): Promise<TransitionResult> {
		throw new Error('Method not implemented.');
	}
	encodeState(state: StateManagerExampleBased): Partial<any> {
		throw new Error('Method not implemented.');
	}
	
}

class StateManagerExampleBased extends ServiceWithStream<any> {
	private readonly attributesSeparator = ':';

	private stepManager = new StepManager(this, []);


	constructor(
		private treebankService: TreebankService,
		private treebankSelectionService: TreebankSelectionService,
		private stepManager: StepManager<any, any>,
	) {
		super({});
	}

	decodeStateImpl(queryParams: QueryParams): Promise<TransitionResult> {
		let attributes: string[];
		let isCustomXPath: boolean;
		if (Array.isArray(queryParams.attributes)) {
			// fallback for old URLs
			attributes = queryParams.attributes;
			isCustomXPath = true; // preserve the existing XPath
		} else {
			attributes = queryParams.attributes?.split(this.attributesSeparator);
			isCustomXPath = this.decodeBool(queryParams.isCustomXPath)
		}

		// ideally you have the selected treebanks here, or nothing makes any sense.
		// so we need to load the treebanks first, and then load the state (if there is a selection in the query params)
		// in the selection component, we want to 

		
		this.state.treebanks = new TreebankService(this.http, this.configurationService),
		this.state.selection = new TreebankSelection({}),
		this.state.xpath = queryParams.xpath || undefined,
		this.state.inputSentence = queryParams.inputSentence || undefined,
		this.state.isCustomXPath =
		this.state.attributes = this.alpinoService.attributesFromString(attributes),
		this.state.retrieveContext = this.decodeBool(queryParams.retrieveContext),
		this.state.respectOrder = this.decodeBool(queryParams.respectOrder),
		this.state.ignoreTopNode = this.decodeBool(queryParams.ignoreTopNode)
	
	}

	inputSentence(sentence: string) {
		this.state.inputSentence = sentence;
	}
}


class StateManagerExampleBased extends StepBasedState<QueryParams, ExampleBasedState> {
	private readonly attributesSeparator = ':';

	constructor(
		private http: HttpClient, 
		private configurationService: ConfigurationService, 
		private treebankService: TreebankService,
		private treebankSelectionService: TreebankSelectionService,
	) {
		super();
	}

	protected get urlState$(): Observable<QueryParams> {
		return this.state$.pipe(skip(1), take(1), first());
	}

	
	// we want to expose the loading state on the treebank itself maybe, 
	// perhaps we can create a stub-stub version of the treebank that we can create from the url.
	// the components can then use this to show a loading state.

	decodeGlobalState(queryParams: Record<string, any>): ExampleBasedState {
		let attributes: string[];
		let isCustomXPath: boolean;
		if (Array.isArray(queryParams.attributes)) {
			// fallback for old URLs
			attributes = queryParams.attributes;
			isCustomXPath = true; // preserve the existing XPath
		} else {
			attributes = queryParams.attributes?.split(this.attributesSeparator);
			isCustomXPath = this.decodeBool(queryParams.isCustomXPath)
		}

		// ideally you have the selected treebanks here, or nothing makes any sense.
		// so we need to load the treebanks first, and then load the state (if there is a selection in the query params)
		// in the selection component, we want to 

		return {
			treebanks: new TreebankService(this.http, this.configurationService),
			selection: new TreebankSelection({}),
			xpath: queryParams.xpath || undefined,
			inputSentence: queryParams.inputSentence || undefined,
			isCustomXPath,
			attributes: this.alpinoService.attributesFromString(attributes),
			retrieveContext: this.decodeBool(queryParams.retrieveContext),
			respectOrder: this.decodeBool(queryParams.respectOrder),
			ignoreTopNode: this.decodeBool(queryParams.ignoreTopNode)
		};


		// need to wait a bit for the selection etc to become available.
		// ideally we only want to load the treebanks when we need them


		// what is the flow here
		// user clicks a treebank to select it
		// we async load it, then process the selection
		// all is good in the world

		// but what if we have a query param that selects a treebank
		// then we can already return the state, but without the treebanks/selection.
		// we can then load the treebanks, process the selection async

		// we need a second function that performs all required async actions to get the state ready
		// after that, we can jump to the correct step, as the state should be valid

	}
}
