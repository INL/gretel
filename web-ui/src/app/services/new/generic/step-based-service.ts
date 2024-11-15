import { combineLatest, debounceTime, Observable, of, switchMap } from "rxjs";
import ServiceWithStream, {TransitionResult} from "./stream-based-service";

type QueryParams = Record<string, string|object[]|Record<string, string>>;

export interface UrlBoundState<S, Q extends QueryParams> {
	decodeState(state: S, urlState: Partial<Q>): Promise<TransitionResult>;
	encodeState(state: S): Partial<Q>;
}

export abstract class Step<S, Q extends QueryParams> implements UrlBoundState<S, Q> {
	abstract decodeState(state: S, urlState: Partial<Q>): Promise<TransitionResult>;
	abstract encodeState(state: S): Partial<Q>;
	async canLeave(state: Readonly<S>): Promise<boolean> { return true; }
	async canEnter(state: Readonly<S>): Promise<boolean> { return true; }
	async leave(state: S): Promise<TransitionResult> { return this.canLeave(state) ? TransitionResult.OK : TransitionResult.error('Cannot leave current step'); }
	async enter(state: S): Promise<TransitionResult> { return this.canEnter(state) ? TransitionResult.OK : TransitionResult.error('Cannot enter current step'); }
}


export type StepManagerState = {step: number, transitioning: boolean};
export type StepManagerUrlState = {step: string};
export class StepManager<MainState extends ServiceWithStream<any>, Q extends QueryParams> 
	extends ServiceWithStream<StepManagerState> 
	implements UrlBoundState<StepManagerState, StepManagerUrlState> 
{
	constructor(protected mainState: MainState, protected steps: Array<Step<MainState, Q>>) {
		super({step: 0, transitioning: false});
	}


	public canEnterNextStep$ = combineLatest([this.mainState.state$, this.state$]).pipe(
		switchMap(async ([_, {transitioning, step}]) => {
			if (transitioning) return of(false);
			if (step >= this.steps.length - 1) return of(false);
			const cur = this.steps[step];
			const next = this.steps[step + 1];
			return cur.canEnter(this.mainState).then(r => r && next.canLeave(this.mainState))
		}))

	public canEnterPreviousStep$ = combineLatest([this.mainState.state$, this.state$]).pipe(
		switchMap(async ([_, {transitioning, step}]) => {
			if (transitioning) return of(false);
			if (step <= 0) return of(false);
			const cur = this.steps[step];
			const next = this.steps[step - 1];
			return cur.canEnter(this.mainState).then(r => r && next.canLeave(this.mainState))
		}))
		
	
	// this one needs its own little state
	protected async advanceUntil(step: number): Promise<TransitionResult> {
		while (this.state.step < step) {
			const r = await this.advanceStep();
			if (!r.ok) return r;
		}
		return TransitionResult.OK;
	}
	protected async returnUntil(step: number): Promise<TransitionResult> {
		while (this.state.step > step) {
			const r = await this.returnStep();
			if (!r.ok) return r;
		}
		return TransitionResult.OK;
	}

	private async transition(cur: number, next: number) {
		if (Math.abs(cur - next) !== 1) return TransitionResult.error('Invalid transition');
		if (this.state.transitioning) return TransitionResult.error('Already transitioning');

		const curStep = this.steps[cur];
		const nextStep = this.steps[next];
		if (!curStep) return TransitionResult.error(`Cannot transition from non-existent step ${cur}`);
		if (!nextStep) return TransitionResult.error(`Cannot transition to non-existent step ${next}`);

		this.state.transitioning = true;
		let r = await curStep.leave(this.mainState);
		if (r.ok) r = await nextStep.enter(this.mainState);
		if (r.ok) this.state.step = next;
		this.state.transitioning = false;
		return r;
	}

	async advanceStep(): Promise<TransitionResult> {
		return this.transition(this.state.step, this.state.step + 1);
	}
	async returnStep(): Promise<TransitionResult> {
		return this.transition(this.state.step, this.state.step - 1);
	}

	async decodeState(state, urlState): Promise<TransitionResult> {
		if ('step' in urlState) {
			const step = parseInt(urlState.step);
			if (isNaN(step) || step < 0 || step >= this.steps.length) return TransitionResult.OK; // invalid step, stay on initial step.
			if (this.state.step < step) return this.advanceUntil(step);
			if (this.state.step > step) return this.returnUntil(step);
		}

		return TransitionResult.OK;
	}

	encodeState(state: StepManagerState): StepManagerUrlState {
		return {step: state.step.toString()};
	}
}