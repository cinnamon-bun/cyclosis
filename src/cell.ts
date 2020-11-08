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

class _UpdateWasCancelled extends Error {
    constructor(message?: string) {
        super(message || '');
        this.name = 'BecameStaleError';
    }
}

export class CellWasDestroyed extends Error {
    constructor(message?: string) {
        super(message || '');
        this.name = 'CellWasDestroyed';
    }
}

export type Thunk = () => void;
export type OnChangeCb<T> = (val: T) => void;
export type OnErrorCb = (err: Error) => void;
export type OnStaleCb = () => void;
export type OnDestroyCb = () => void;
export type InnerGet<U> = (cell: Cell<U>) => Promise<U>;
export type CellFn<T> = (get: InnerGet<any>) => Promise<T>;
export type ResolveAndReject<T> = {
    resolve: (v: T) => void,
    reject: (err: any) => void,
}

//================================================================================

export class Cell<T> {
    id: string;

    _fn: CellFn<T> | null = null;
    _value: T | undefined = undefined;
    _err: Error | null = null;

    _onChangeCbs: Set<OnChangeCb<T>> = new Set<OnChangeCb<T>>();
    _onErrorCbs: Set<OnErrorCb> = new Set<OnErrorCb>();
    _onStaleCbs: Set<OnStaleCb> = new Set<OnStaleCb>();
    _onDestroyCbs: Set<OnDestroyCb> = new Set<OnDestroyCb>();

    _children: Set<Cell<any>> = new Set<Cell<any>>();
    _parents: Set<Cell<any>> = new Set<Cell<any>>();

    _waiting: ResolveAndReject<T>[] = [];  // waiting promises from getWhenReady

    _currentWaveId: number | null = null;  // stale if not null

    _destroyed: boolean = false;

    //------------------------------------------------------------

    constructor(valOrFn: T | CellFn<T>, id?: string) {
        this.id = id === undefined ? ('cell:'+Math.random()) : id;
        logC0(this, `constructor(${valOrFn instanceof Function ? 'fn' : JSON.stringify(valOrFn)}, ${JSON.stringify(id)})`);
        this.set(valOrFn);
        logC0(this, `...constructor(${JSON.stringify(id)}): done`);
    }
    //------------------------------------------------------------
    // PUBLIC API
    _assertNotDestroyed(): void {
        if (this._destroyed) { throw new CellWasDestroyed(this.id); }
    }
    onChange(cb: OnChangeCb<T>): Thunk {
        logC0(this, 'onChange(cb)');
        this._assertNotDestroyed();
        this._onChangeCbs.add(cb);
        return () => this._onChangeCbs.delete(cb);
    }
    onError(cb: OnErrorCb): Thunk {
        logC0(this, 'onError(cb)');
        this._assertNotDestroyed();
        this._onErrorCbs.add(cb);
        return () => this._onErrorCbs.delete(cb);
    }
    onStale(cb: OnStaleCb): Thunk {
        logC0(this, 'onStale(cb)');
        this._assertNotDestroyed();
        this._onStaleCbs.add(cb);
        return () => this._onStaleCbs.delete(cb);
    }
    onDestroy(cb: OnDestroyCb): Thunk {
        logC0(this, 'onDestroy(cb)');
        if (this._destroyed) {
            // if it's already destroyed, run the callback once and forget it
            process.nextTick(cb);
            return () => {};
        } else {
            this._onDestroyCbs.add(cb);
            return () => this._onDestroyCbs.delete(cb);
        }
    }

    isReady(): boolean {
        // TODO: what should this do when the cell is destroyed?
        this._assertNotDestroyed();
        return this._currentWaveId === null;
    }
    isDestroyed(): boolean {
        return this._destroyed;
    }
    set(valOrFn: T | CellFn<T>) {
        this._assertNotDestroyed();
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
        // this can throw an error if the cell is in an error state
        logC0(this, 'getNow()');
        this._assertNotDestroyed();
        if (this._err !== null) { throw this._err; }
        return this._value;
    }
    async getWhenReady(): Promise<T> {
        // this can throw an error if the cell is in an error state
        // TODO: should this wait until the error goes away instead?
        this._assertNotDestroyed();
        if (this._currentWaveId === null) {
            logC0(this, `getWhenReady() -- ready.  value = ${this._value}; err = ${this._err}`);
            if (this._err !== null) { throw this._err; }
            return this._value as T;
        } else {
            logC0(this, 'getWhenReady() -- queueing promise');
            return new Promise((resolve, reject) => {
                this._waiting.push({resolve, reject});
            });
        }
    }
    destroy(): void {
        if (this._destroyed) { return; }

        // zero out our state to help with garbage collection
        this._value = undefined;
        this._err = null;
        this._destroyed = true;

        // remove ourself from our parents
        for (let p of this._parents) {
            p._children.delete(this);
        }
        this._parents.clear();
        this._children.clear();

        // anyone waiting on getWhenReady will get an error
        for (let {resolve, reject} of this._waiting) {
            reject(new CellWasDestroyed(this.id));
        }
        this._waiting = [];

        // call onDestroy callbacks, and remove all callbacks
        for (let cb of this._onDestroyCbs) { cb(); }
        this._onDestroyCbs.clear();
        this._onChangeCbs.clear();
        this._onErrorCbs.clear();
        this._onStaleCbs.clear();
    }

    //------------------------------------------------------------
    // INTERNAL API

    _addChild(cell: Cell<any>) {
        logC1(this, `_addChild: ${cell.id}`);
        this._assertNotDestroyed();
        this._children.add(cell);
    }
    _removeChild(cell: Cell<any>) {
        logC1(this, `_removeChild: ${cell.id}`);
        this._assertNotDestroyed();
        this._children.delete(cell);
    }

    //------------------------------------------------------------
    // PRIVATE

    private _waveHitsMe(waveId: number) {
        logC2(this, `_waveHitsMe(${waveId})`);
        if (this._destroyed) {
            logC2(this, `..._waveHitsMe(${waveId}): cell was destroyed; returning`);
            return;
        }
        if (waveId !== this._currentWaveId) {
            // we are ready or running a different wave
            let wasReady = this._currentWaveId === null;
            this._currentWaveId = waveId;  // changing this will tell the existing update thread, if there is one, to stop
            // run onStale callbacks
            if (wasReady) {
                logC2(this, `..._waveHitsMe(${waveId}): I've become stale; calling onStaleCbs`);
                for (let cb of this._onStaleCbs) { cb(); }
            }
            // propagate wave instantly to children
            logC2(this, `..._waveHitsMe(${waveId}): propagate wave to children`);
            for (let child of this._children) {
                child._waveHitsMe(waveId);
            }
            // queue up an update thread for this wave
            logC2(this, `..._waveHitsMe(${waveId}): queue up _updateThread on nextTick`);
            process.nextTick(() => this._updateThread(waveId));
        } else {
            // we are already running this wave
            logC2(this, `..._waveHitsMe(${waveId}) -- skipping because already processing this wave`);
        }
        logC2(this, `..._waveHitsMe(${waveId}): done`);
    }
    private async _updateThread(waveId: number) {
        logCUp(this, `_updateThread(${waveId}): starting`);
        if (this._destroyed) {
            logCUp(this, `..._updateThread(${waveId}): cell was destroyed; quitting`);
        }
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
            this._finishWave(waveId, this._value as T, null);
        } else {
            // this is a fn cell.

            let innerGet: InnerGet<any> = async (cell: Cell<any>): Promise<any> => {
                // the cell _fn will run this to get other cells.
                // throws _UpdateWasCancelled if we want the _fn to stop running.

                // if this cell itself was destroyed or this update became obsolete, kill the function
                if (this._destroyed) { throw new _UpdateWasCancelled(`1. this cell ${this.id} was destroyed`); }
                if (waveId !== this._currentWaveId) { throw new _UpdateWasCancelled(`1. this update wave is obsolete`); }

                this._parents.add(cell);
                cell._addChild(this);

                // this can throw CellWasDestroyed or the cell's error if it has one, from the parent cell
                // a CellWasDestroyed error will be treated as an error from the _fn like any other
                let v = await cell.getWhenReady();

                // check one more time to see if this cell is destroyed or this update is obsolete
                if (this._destroyed) { throw new _UpdateWasCancelled(`2. this cell ${this.id} was destroyed`); }
                if (waveId !== this._currentWaveId) { throw new _UpdateWasCancelled(`2. this update wave is obsolete`); }

                return v;
            };
            try {
                logCUp(this, `..._updateThread(${waveId}): running _fn`);
                let val = await this._fn(innerGet);
                logCUp(this, `..._updateThread(${waveId}): ..._fn returned ${JSON.stringify(val)}`);
                logCUp(this, `..._updateThread(${waveId}): finishing wave`);
                this._finishWave(waveId, val, null);
                logCUp(this, `..._updateThread(${waveId}): done`);
            } catch (err) {
                if (err instanceof _UpdateWasCancelled) {
                    logCUp(this, `..._updateThread(${waveId}): ..._fn threw BecameStaleError(${JSON.stringify(err.message)})`);
                    logCUp(this, `..._updateThread(${waveId}): quitting`);
                    return;
                } else {
                    // _fn threw an error.
                    logCUp(this, `..._updateThread(${waveId}): ..._fn threw a real error: ${err.name}`);
                    logCUp(this, `..._updateThread(${waveId}): finishing wave with error`);
                    this._finishWave(waveId, undefined, err);
                    logCUp(this, `..._updateThread(${waveId}): done`);
                }
            }
        }
    }
    private _finishWave(waveId: number, val: T | undefined, err: Error | null) {
        // either val is set and err is null, or val is undefined and err is set.

        logC2(this, `_finishWave(${waveId}, ${JSON.stringify(val)}, ${err === null ? null : err.message})`);
        if (waveId !== this._currentWaveId) {
            logC2(this, `...finishWave(${waveId}): obsolete wave; quitting`);
            return;
        }

        this._value = val;
        this._err = err;
        this._currentWaveId = null;

        // release waiting children
        logC2(this, `..._finishWave(${waveId}): releasing waiting children`);
        for (let {resolve, reject} of this._waiting) {
            if (this._err !== null) {
                reject(this._err);
            } else {
                resolve(this._value as T);
            }
        }
        this._waiting = [];

        // notify onChange and onError subscribers
        if (this._err !== null) {
            logC2(this, `..._finishWave(${waveId}): notifying onError subscribers`);
            for (let cb of this._onErrorCbs) { cb(this._err); }
        } else {
            logC2(this, `..._finishWave(${waveId}): notifying onChange subscribers`);
            for (let cb of this._onChangeCbs) { cb(this._value as T); }
        }

        logC2(this, `..._finishWave(${waveId}): done`);
    }
}
