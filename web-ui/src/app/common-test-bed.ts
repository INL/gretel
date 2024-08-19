import { APP_BASE_HREF } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';

import { ClipboardModule, ClipboardService } from 'ngx-clipboard';

import { declarations, imports, providers } from './app.module';
import { AppRoutingModule } from './app-routing/app-routing.module';
import { routes } from './app-routing/routes';

import { ClipboardServiceMock } from './mocks/clipboard.service.mock';
import { HttpClientMock } from './mocks/http-client.mock';

import {
    ConfigurationService,
    // UploadedTreebankResponse,
    // ConfiguredTreebanksResponse,
    StateService,
    TreebankService,
    NotificationService,
    DjangoTreebankResponse,
    DjangoTreebankMetadataResponse,
    DjangoComponentsForTreebankResponse
} from './services/_index';
import { ConfigurationServiceMock } from './services/configuration.service.mock';
import { GlobalState } from './pages/multi-step-page/steps';
import { TreebankSelection } from './treebank';


const cast = <T>(p: T) => p

export function commonTestBed() {
    const httpClientMock = new HttpClientMock();
    const stateService = new StateService<any>();
    stateService.init({}, []);

    const filteredImports = imports.filter(value => !(value in [AppRoutingModule, ClipboardModule, HttpClientModule]));
    filteredImports.push(
        RouterTestingModule.withRoutes(routes));

    const filteredProviders = providers.filter(provider => provider !== ConfigurationService);
    filteredProviders.push(
        {
            provide: APP_BASE_HREF,
            useValue: '/'
        }, {
            provide: ClipboardService,
            useClass: ClipboardServiceMock
        }, {
            provide: ConfigurationService,
            useValue: new ConfigurationServiceMock()
        }, {
            provide: HttpClient,
            useValue: httpClientMock
        }, {
            provide: StateService,
            useValue: stateService
        }, {
            provide: Title,
            useClass: Title
        });

    httpClientMock.setData('get', '/treebanks/treebank', cast<DjangoTreebankResponse[]>([{
        title: 'test title',
        description: 'test treebank',
        groups: [{
            slug: 'test-group',
            description: 'test group description'
        }],
        variants: ['v1', 'v2'],
        slug: 'test-slug',
        url_more_info: ''
        }])
    );

    httpClientMock.setData('get', '/treebanks/treebank/test-slug/metadata', cast<DjangoTreebankMetadataResponse[]>([{
        facet: 'range',
        field: 'test-field',
        max_value: '10',
        min_value: '1',
        type: 'int'
    }, {
        facet: 'checkbox',
        field: 'test-field2',
        max_value: '',
        min_value: '',
        type: 'text',
    }]))

    httpClientMock.setData('get', '/treebanks/treebank/test-slug/components', cast<DjangoComponentsForTreebankResponse[]>([{
        description: '',
        nr_sentences: 10,
        nr_words: 100,
        slug: 'test-component1',
        title: 'Test component 1',
        variant: 'v1',
        group: 'test-group'
    }, {
        description: '',
        nr_sentences: 20,
        nr_words: 200,
        slug: 'test-component2',
        title: 'Test component 2',
        variant: 'v2',
        group: 'test-group'
    }]));

    // httpClientMock.setData('post', '/gretel/api/src/router.php/treebank_counts', (body: any) => {
    //     return { 'TEST_DATABASE1_COMPONENT1': '42' };
    // });

    // httpClientMock.setData('post', '/gretel/api/src/router.php/results', (body: any) => {
    //     return false;
    // });

    return {
        testingModule: TestBed.configureTestingModule({
            declarations,
            imports: filteredImports,
            providers: [...filteredProviders, NotificationService]
        }),
        httpClientMock
    };
}

export function initStateService() {
    const stateService = TestBed.get(StateService) as StateService<GlobalState>;
    stateService.init({
        connectionError: false,
        currentStep: undefined,
        filterValues: {},
        retrieveContext: false,
        selectedTreebanks: new TreebankSelection(TestBed.get(TreebankService)),
        variableProperties: [],
        xpath: `//node[@cat="smain"
and node[@rel="su" and @pt="vnw"]
and node[@rel="hd" and @pt="ww"]
and node[@rel="predc" and @cat="np"
    and node[@rel="det" and @pt="lid"]
    and node[@rel="hd" and @pt="n"]]]`,
        valid: true,
        loading: false
    }, []);
}
