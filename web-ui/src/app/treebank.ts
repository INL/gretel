import {isEqual} from 'lodash';

export class FuzzyNumber {
    public value = 0;
    public unknown = false;
    constructor(value?: number |string | '?' | FuzzyNumber) {
        if (value !== undefined) {
            this.add(value);
        }
    }

    /**
     * Adds a value to this number and modifies this instance.
     * @param value
     */
    public add(value: number | string | '?' | FuzzyNumber): FuzzyNumber {
        if (value instanceof FuzzyNumber) {
            this.value += value.value;
            this.unknown = this.unknown || value.unknown;
        } else if (value === '?') {
            this.unknown = true;
        } else if (typeof value === 'string') {
            const v= parseInt(value, 10);
            if (isNaN(v)) {
                this.unknown = true;
            } else {
                this.value += v;
            }
        } else if (typeof value === 'number') {
            this.value += value;
        } else {
            // should never happen
            this.unknown = true;
        }
        return this;
    }
    
    public toString() {
        if (this.unknown) {
            if (this.value === 0) {
                return '?';
            } else {
                return '≥ ' + this.value.toString();
            }
        } else {
            return this.value.toString();
        }
    }

    public toLocaleString() {
        if (this.unknown) {
            if (this.value === 0) {
                return '?';
            } else {
                return '≥ ' + this.value.toLocaleString();
            }
        } else {
            return this.value.toLocaleString();
        }
    }
}

type TreebankBase = {
    provider: string; 
    id: string;
    displayName: string;
    helpUrl: string;
    description: string;
    multiOption: boolean;
    isPublic: boolean;
    userId?: number;
    email?: string;
    uploaded?: Date;
    processed?: Date;
}

/** A treebank where details/contents have not been loaded yet. */
export type TreebankStub = TreebankBase & {
    loaded: false;
    groups: Array<{slug: string, description: string}>
    variants: string[];
}

/** A treebank where content has loaded */
export type TreebankLoaded = TreebankBase & {
    loaded: true;
    metadata: TreebankMetadata[];
    components: Record<string, TreebankComponent>;
    componentGroups: ComponentGroup[];
    /** In the same order as the components array in every group. */
    variants: TreebankVariant[];
    wordCount: FuzzyNumber;
    sentenceCount: FuzzyNumber;
}

/** 
 * We don't know whether it has loaded, check the 'loaded' property.
 * To load/wait for the contents, use the treebankService.loadTreebank() method.
 */
export type Treebank = TreebankStub | TreebankLoaded;

export interface TreebankVariant {
    id: string;
    sentenceCount: FuzzyNumber;
    wordCount: FuzzyNumber;
    /** 
     * Contains one component for every group in the treebank.
     * Might contain undefined when the variant doesn't have a component for a certain group.
     */
    components: Array<TreebankComponent|undefined>;
}

/** 
 * A group represents a few components that are a "variant" of the same data.
 * For example different languages for the same texts.
 * See groups and variants as a 2d table,
 * where groups are the rows and variants are the columns.
 */
export interface ComponentGroup {
    id: string;
    /** 
     * Contains one component for every variant in the treebank.
     * Might contain undefined when the group doesn't have a component for a certain variant.
     */
    components: Array<TreebankComponent|undefined>;
    description?: string;
    sentenceCount: FuzzyNumber;
    wordCount: FuzzyNumber;
}

/**
 * Component of a treebank.
 */
export interface TreebankComponent {
    /** Serverside id  */
    id: string;
    /** Friendly name */
    title: string;
    sentenceCount: FuzzyNumber;
    wordCount: FuzzyNumber;
    description: string;
    disabled: boolean;

    /** The ComponentGroup */
    group?: string;
    /** The Variant */
    variant?: string;
}

export interface TreebankMetadata {
    field: string;
    type: 'text' | 'int' | 'date';
    facet: 'checkbox' | 'slider' | 'range' | 'dropdown';
    show: boolean;
    minValue?: number | Date;
    maxValue?: number | Date;
}

export type EncodedTreebankSelection = {
    [provider: string]: { [treebank: string]: string[] } 
}

type LegacyEncodedTreebankSelection = {
    corpus: string;
    components: string[];
}
function isLegacy(selection: EncodedTreebankSelection|LegacyEncodedTreebankSelection): selection is LegacyEncodedTreebankSelection {
    return typeof selection.corpus === 'string' && Array.isArray(selection.components);
}

/** 
 * Part of the global state object (state.service). 
 * Provides interop between the state object and the url (though doesn't do any updating itself.)
 */
export class TreebankSelection {
    data: TreebankSelectionData;

    /** Get the current selection state for this treebank, creating it if there is currently no entry. */
    getTreebank(treebank: Pick<Treebank, 'provider'|'id'>): CorpusSelection {
        const provider = this.data[treebank.provider];
        if (!provider) {
            this.data[treebank.provider] = {};
        }
        const providerData = this.data[treebank.provider];
        if (!providerData[treebank.id]) {
            providerData[treebank.id] = { selected: false, components: {} };
        }
        return providerData[treebank.id];
    }

    /**
     * Return all selected treebanks and their components.
     * Returned treebanks are guaranteed to have at least one selected component.
     */
    get selectedTreebanks(): Array<{treebank: Treebank, selectedComponents: string[]}> {
        const r = [];
        for (const [provider, corpora] of Object.entries(this.data)) {
            for (const [corpus, {selected: treebankSelected, components}] of Object.entries(corpora)) {
                if (!treebankSelected) continue;
                const selectedComponents = Object.keys(components).filter(component => components[component]);
                if (selectedComponents.length) {
                    r.push({
                        treebank: this.treebankService.get(provider, corpus),
                        selectedComponents
                    });
                }
            }
        }
        r.sort((a, b) => a.treebank.displayName.localeCompare(b.treebank.displayName));
        r.forEach(({selectedComponents}) => selectedComponents.sort());
        return r;
    }

    encode(): EncodedTreebankSelection|undefined {
        if (!this.selectedTreebanks) return undefined;
        return this.selectedTreebanks.reduce<EncodedTreebankSelection>((selection, {treebank, selectedComponents}) => {
            const provider = selection[treebank.provider] || (selection[treebank.provider] = {});
            provider[treebank.id] = selectedComponents;
            return selection;
        }, {});
    }

    /** Decode the state. Overwrites current internal state. */
    decode(encoded: EncodedTreebankSelection|LegacyEncodedTreebankSelection) {
        this.data = {};
        // legacy format
        if (isLegacy(encoded)) {
            function databaseName(corpus: string, component: string) {
                return corpus.toUpperCase().replace('-', '_') + `_ID_${component}`;
            }
            const corpus = encoded.corpus;
            const components = encoded.components;
            this.data = { 
                gretel: {
                    [corpus]: { 
                        selected: true, 
                        components: components
                            .map(component => databaseName(corpus, component))
                            .reduce((selection, component) => { 
                                selection[component] = true; 
                                return selection; 
                            }, {} as Record<string, boolean>)
                    }
                }
            };
        } else {
            for (const provider of Object.keys(encoded)) {
                for (const [corpus, selectedComponents] of Object.entries(encoded[provider])) {
                    const state = this.getTreebank({provider, id: corpus});
                    state.selected = true;
                    selectedComponents.forEach(c => state.components[c] = true);
                }
            }
        }
    }

    equals(other: TreebankSelection) {
        return isEqual(other.encode(), this.encode());
    }

    hasAnySelection() {
        return this.selectedTreebanks.length > 0;
    }

    isSelected(providerName: string, corpusName: string, componentId?: string) {
        if (componentId) 
            return this.data[providerName]?.[corpusName]?.components[componentId];
        else 
            return this.data[providerName]?.[corpusName]?.selected;
    }

    constructor(private treebankService: TreebankService, state?: EncodedTreebankSelection|LegacyEncodedTreebankSelection) {
        this.data = {};
        if (state) {
            this.decode(state);
        }
    }

    clone() {
        const clone = new TreebankSelection(this.treebankService, this.encode());
        for (const [provider, corpora] of Object.entries(this.data)) {
            clone.data[provider] = { ...corpora };
        }
        return clone;
    }
}

// To prevent a circular dependency (actual TreebankService needs this file)
interface TreebankService {
    get(corpora: string, corpus: string): Treebank;
}

export interface TreebankSelectionData {
    [provider: string]: { [corpus: string]: CorpusSelection };
}

export interface CorpusSelection {
    selected: boolean;
    components: { [component: string]: boolean };
}
