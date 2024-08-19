import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { SubTreebanksComponent } from './sub-treebanks.component';
import { commonTestBed } from '../../../common-test-bed';
import { ComponentGroup, FuzzyNumber, TreebankComponent, TreebankLoaded, TreebankVariant } from '../../../treebank';

const cast = <T>(p: T) => p

describe('SubTreebanksComponents', () => {
    let component: SubTreebanksComponent;
    let fixture: ComponentFixture<SubTreebanksComponent>;

    beforeEach(waitForAsync(() => {
        commonTestBed().testingModule.compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(SubTreebanksComponent);
        component = fixture.componentInstance;


        /*
                      variant 1 | variant 2
            group 1 | comp1     |  none
            group 2 | none      |  comp2
        */

        const components: Record<string, TreebankComponent> = {
            'comp1': {
                id: 'comp1',
                title: 'component 1',
                description: '',
                disabled: true,
                sentenceCount: new FuzzyNumber(10),
                wordCount: new FuzzyNumber(100),
                variant: '1',
                group: '1'
            }, 
            'comp2': {
                id: 'comp2',
                title: 'component 2',
                description: '',
                disabled: false,
                sentenceCount: new FuzzyNumber(10),
                wordCount: new FuzzyNumber(100),
                variant: '2',
                group: '2'
            }
        }
        const componentGroups: ComponentGroup[] = [{
            id: '1',
            components: [components.comp1, undefined],
            sentenceCount: new FuzzyNumber(10),
            wordCount: new FuzzyNumber(100),
        }, {
            id: '2',
            components: [undefined, components.comp2],
            sentenceCount: new FuzzyNumber(10),
            wordCount: new FuzzyNumber(100),
        }];
        const variants: TreebankVariant[] = [{
            id: '1',
            components: [components.comp1, undefined],
            sentenceCount: new FuzzyNumber(10),
            wordCount: new FuzzyNumber(100),
        }, {
            id: '2',
            sentenceCount: new FuzzyNumber(10),
            wordCount: new FuzzyNumber(100),
            components: [undefined, components.comp2]
        }];

        component.treebank = cast<TreebankLoaded>({
            provider: 'test-provider',
            id: 'test-treebank',
            multiOption: false,
            displayName: 'test-treebank',
            isPublic: true,
            description: 'test-description',
            helpUrl: 'test-help-url',
            loaded: true,
            sentenceCount: new FuzzyNumber(10),
            wordCount: new FuzzyNumber(100),
            email: 'test.user@test.gretel',
            userId: 1,
            processed: new Date(),
            uploaded: new Date(),
            
            componentGroups,
            variants,
            components,
            metadata: [],
        });

        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
