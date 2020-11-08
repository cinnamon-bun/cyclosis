import chalk = require('chalk');

export let nop = (...args: any[]) => {};
export let logMain =       nop;//(                 ...args: any[]) => console.log(chalk.black.bgWhite(     'main       '), ...args);
export let logOnChange =   nop;//(                 ...args: any[]) => console.log(chalk.black.bgCyanBright('onChange   '), ...args);
export let logTest =       nop;//(                 ...args: any[]) => console.log(chalk.black.bgWhite(     'test       '), ...args);
export let logTestMark =   nop;//(                 ...args: any[]) => console.log(chalk.black.bgWhite(     'test ') + chalk.black.bgGray(       'mark  '), ...args);
export let logTestLog =    nop;//(                 ...args: any[]) => console.log(chalk.black.bgWhite(     'test ') + chalk.black.bgGreenBright('log   '), ...args);
export let logTestExpect = nop;//(                 ...args: any[]) => console.log(chalk.black.bgWhite(     'test ') + chalk.black.bgRedBright(  'expect'), ...args);
export let logC0 =         nop;//(cell: Cell<any>, ...args: any[]) => console.log(chalk.magentaBright(     '  cell     '), chalk.grey(cell.id.padEnd(8, ' ')), ...args);  // public api
export let logC1 =         nop;//(cell: Cell<any>, ...args: any[]) => console.log(chalk.magenta(           '    cell   '), chalk.grey(cell.id.padEnd(8, ' ')), ...args);  // semi-public api
export let logC2 =         nop;//(cell: Cell<any>, ...args: any[]) => console.log(chalk.red(               '      cell '), chalk.grey(cell.id.padEnd(8, ' ')), ...args);  // internal functions
export let logCUp =        nop;//(cell: Cell<any>, ...args: any[]) => console.log(chalk.yellow(            '    update '), chalk.grey(cell.id.padEnd(8, ' ')), ...args);  // update thread
export let logFn =         nop;//(cell: Cell<any>, ...args: any[]) => console.log(chalk.green(             '    fn     '), chalk.grey(cell.id.padEnd(8, ' ')), ...args);

//================================================================================
// HELPERS

export let sleep = async (ms : number) : Promise<void> => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
}

let _globalWaveId = 0;
let makeWaveId = () => {
    _globalWaveId++;
    return _globalWaveId;
}

//================================================================================
// TYPES

class BecameStaleError extends Error {
    constructor(message?: string) {
        super(message || '');
        this.name = 'BecameStaleError';
    }
}

export type Thunk = () => void;
export type OnChangeCb<T> = (val: T) => void;
export type OnStaleCb<T> = () => void;
export type InnerGet<U> = (cell: Cell<U>) => Promise<U>;
export type CellFn<T> = (get: InnerGet<any>) => Promise<T>;

//================================================================================

export class Cell<T> {
    id: string;
    _value: T | undefined = undefined;
    _fn: CellFn<T> | null = null;
    _onChangeCbs: Set<OnChangeCb<T>> = new Set<OnChangeCb<T>>();
    _onStaleCbs: Set<OnStaleCb<T>> = new Set<OnStaleCb<T>>();
    _children: Set<Cell<any>> = new Set<Cell<any>>();
    _parents: Set<Cell<any>> = new Set<Cell<any>>();
    _resolves: ((v: T) => void)[] = [];
    _currentWaveId: number | null = null;  // stale if not null
    //------------------------------------------------------------
    constructor(valOrFn: T | CellFn<T>, id?: string) {
        this.id = id === undefined ? ('cell:'+Math.random()) : id;
        logC0(this, `constructor(${valOrFn instanceof Function ? 'fn' : JSON.stringify(valOrFn)}, ${JSON.stringify(id)})`);
        this.set(valOrFn);
        logC0(this, `...constructor(${JSON.stringify(id)}): done`);
    }
    //------------------------------------------------------------
    // PUBLIC API
    onChange(cb: OnChangeCb<T>): Thunk {
        logC0(this, 'onChange(cb)');
        this._onChangeCbs.add(cb);
        return () => this._onChangeCbs.delete(cb);
    }
    onStale(cb: OnStaleCb<T>): Thunk {
        logC0(this, 'onStale(cb)');
        this._onStaleCbs.add(cb);
        return () => this._onStaleCbs.delete(cb);
    }
    isReady(): boolean {
        return this._currentWaveId === null;
    }
    set(valOrFn: T | CellFn<T>) {
        if (valOrFn instanceof Function) {
            logC0(this, `set(fn)`);
            this._value = undefined;
            this._fn = valOrFn;
        } else {
            logC0(this, `set(${JSON.stringify(valOrFn)})`);
            this._value = valOrFn;
            this._fn = null;
        }
        let waveId = makeWaveId();
        logC0(this, `...set: starting wave ${waveId}`);
        this._waveHitsMe(waveId);
        logC0(this, `...set: done`);
    }
    getNow(): T | undefined {
        logC0(this, 'getNow()');
        return this._value;
    }
    async getWhenReady(): Promise<T> {
        if (this._currentWaveId === null) {
            logC0(this, `getWhenReady() -- ready.  value = ${this._value}`);
            return this._value as T;
        } else {
            logC0(this, 'getWhenReady() -- queueing promise');
            return new Promise((resolve, reject) => {
                this._resolves.push(resolve);
            });
        }
    }
    //------------------------------------------------------------
    // INTERNAL API
    _addChild(cell: Cell<any>) {
        logC1(this, `_addChild: ${cell.id}`);
        this._children.add(cell);
    }
    _removeChild(cell: Cell<any>) {
        logC1(this, `_removeChild: ${cell.id}`);
        this._children.delete(cell);
    }

    _waveHitsMyParent(waveId: number) {
        logC1(this, `_waveHitsMyParent(${waveId})`);
        this._waveHitsMe(waveId);
    }

    //------------------------------------------------------------
    // PRIVATE
    private _waveHitsMe(waveId: number) {
        logC2(this, `_waveHitsMe(${waveId})`);
        if (waveId !== this._currentWaveId) {
            let wasReady = this._currentWaveId === null;
            this._currentWaveId = waveId;  // changing this will tell the existing update thread, if there is one, to stop
            // propagate wave instantly to children
            logC2(this, `..._waveHitsMe(${waveId}): propagate wave to children`);
            for (let child of this._children) {
                child._waveHitsMyParent(waveId);
            }
            // run onStale callbacks
            if (wasReady) {
                for (let cb of this._onStaleCbs) { cb(); }
            }
            // queue up an update thread for this wave
            logC2(this, `..._waveHitsMe(${waveId}): queue up _updateThread on nextTick`);
            process.nextTick(() => this._updateThread(waveId));
        } else {
            logC2(this, `..._waveHitsMe(${waveId}) -- skipping because already processing this wave`);
        }
        logC2(this, `..._waveHitsMe(${waveId}): done`);
    }
    private async _updateThread(waveId: number) {
        logCUp(this, `_updateThread(${waveId}): starting`);
        if (waveId !== this._currentWaveId) {
            logCUp(this, `..._updateThread(${waveId}): obsolete wave; quitting`);
            return;
        }

        // clear parent relationships
        logCUp(this, `..._updateThread(${waveId}): clearing parent relationships`);
        for (let p of this._parents) { p._removeChild(this); }
        this._parents.clear();

        if (this._fn === null) {
            // this is a const cell
            logCUp(this, `..._updateThread(${waveId}): this is a const cell; finishing wave right away`);
            this._finishWave(waveId, this._value as T);
        } else {
            // this is a fn cell
            let innerGet: InnerGet<any> = async (cell: Cell<any>): Promise<any> => {
                if (waveId !== this._currentWaveId) { throw new BecameStaleError('a'); }
                this._parents.add(cell);
                cell._addChild(this);
                let v = await cell.getWhenReady();
                if (waveId !== this._currentWaveId) { throw new BecameStaleError('b'); }
                return v;
            };
            try {
                logCUp(this, `..._updateThread(${waveId}): running _fn`);
                let val = await this._fn(innerGet);
                logCUp(this, `..._updateThread(${waveId}): ..._fn returned ${JSON.stringify(val)}`);
                logCUp(this, `..._updateThread(${waveId}): finishing wave`);
                this._finishWave(waveId, val);
                logCUp(this, `..._updateThread(${waveId}): done`);
            } catch (e) {
                if (e instanceof BecameStaleError) {
                    logCUp(this, `..._updateThread(${waveId}): ..._fn threw BecameStaleError(${JSON.stringify(e.message)})`);
                    logCUp(this, `..._updateThread(${waveId}): quitting`);
                    return;
                } else {
                    // TODO: how to recover from error in _fn?
                    logCUp(this, `..._updateThread(${waveId}): ..._fn threw a real error; rethrowing and quitting: ${e.name}`);
                    throw e;
                }
            }
        }
    }
    private _finishWave(waveId: number, v: T) {
        logC2(this, `_finishWave(${waveId}, ${JSON.stringify(v)})`);
        if (waveId !== this._currentWaveId) {
            logC2(this, `...finishWave(${waveId}): obsolete wave; quitting`);
            return;
        }

        this._value = v;
        this._currentWaveId = null;

        // release waiting children
        logC2(this, `..._finishWave(${waveId}): releasing waiting children`);
        for (let resolve of this._resolves) { resolve(this._value); }
        this._resolves = [];

        // notify onChange subscribers
        logC2(this, `..._finishWave(${waveId}): notifying onChange subscribers`);
        for (let cb of this._onChangeCbs) { cb(this._value); }

        logC2(this, `..._finishWave(${waveId}): done`);
    }
}
