import t = require('tap');
//t.runOnly = true;

import {
    Cell,
    CellFn,
    InnerGet,
    Thunk,
    logFn,
    logMain,
    logOnChange,
    logTest,
    logTestMark,
    logTestLog,
    logTestExpect,
    sleep,
} from '../cell';

class Logger {
    logs: string[] = [];
    expected: string[] = [];
    constructor() {
        logTest('--- Logger begin ---');
    }
    log(msg: string) {
        logTestLog(`--- ${msg} ---`);
        this.logs.push(msg);
    }
    expect(msg: string) {
        logTestExpect(`--- ${msg} ---`);
        this.expected.push(msg);
    }
    marker(msg: string, verbose: boolean = true) {
        if (verbose) {
            logTestMark(`--- ${msg} ---`);
        }
        this.logs.push(msg);
        this.expected.push(msg);
    }
    async sleep(ms: number) {
        logTest(`===--- sleep... ---===`);
        await sleep(ms);
        logTest(`===--- ...sleep ---===`);
        this.marker('sleep-' + ms, false);
    }
}

t.test('id generation', async (t: any) => {
    let a = new Cell<string>('a');
    t.true(a.id.startsWith('cell:'), 'cell made with no id is assigned one');
    t.done();
});

t.test('const cell immediate onchange', async (t: any) => {
    let log = new Logger();
    log.marker('init');

    let a = new Cell<string>('a', 'cellA');
    a.onChange(val => {
        t.true(a.isReady(), 'const cell is ready inside onChange');
        let msg = `1.${a.id}->${JSON.stringify(val)}`;
        logOnChange(msg);
        log.log(msg);
    });
    a.onStale(() => {
        t.false(a.isReady(), 'const cell is not ready inside onStale');
        let msg = `1.${a.id}->stale`;
        logOnChange(msg);
        log.log(msg);
    });

    log.marker('end-main');
    // onchange is called just after init, even for const cells
    // because cells always start off stale, then become ready on nextTick
    log.expect('1.cellA->"a"');
    // onStale is not called right now because it starts off stale, it doesn't "become" stale
    await log.sleep(50); //--------------------------------------------------

    // add another onChange later.
    // this one should not be called right now
    a.onChange(val => {
        t.true(a.isReady(), 'const cell is ready inside onChange');
        let msg = `2.${a.id}->${JSON.stringify(val)}`;
        logOnChange(msg);
        log.log(msg);
    });

    await log.sleep(51); //--------------------------------------------------

    // change, and both are called
    a.set('aa');
    log.expect('1.cellA->stale');
    log.expect('1.cellA->"aa"');
    log.expect('2.cellA->"aa"');

    await log.sleep(52); //--------------------------------------------------

    t.strictSame(log.logs, log.expected, 'logs match');
    t.done();
});

t.test('one const cell', async (t: any) => {
    let log = new Logger();
    log.marker('init');

    let a = new Cell<string>('a', 'cellA');
    t.false(a.isReady(), 'const cell is not ready on instantiation');
    t.same(a.getNow(), 'a', 'const cell value is set on instantiation');
    let unsub = a.onChange(val => {
        t.true(a.isReady(), 'const cell is ready inside onChange');
        let msg = `${a.id}->${JSON.stringify(val)}`;
        logOnChange(msg);
        log.log(msg);
    });

    log.marker('end-main');
    log.expect('cellA->"a"');  // onchange is called even for const cells
    process.nextTick(() => {
        log.marker('nextTick');
        t.true(a.isReady(), 'const cell becomes ready after nextTick');
    });
    await log.sleep(50); //--------------------------------------------------

    t.same(await a.getWhenReady(), 'a', 'const cell getWhenReady is correct after instantiation');

    await log.sleep(51); //--------------------------------------------------

    log.marker('set-aa');
    t.true(a.isReady(), 'ready before set');
    a.set('aa');
    t.false(a.isReady(), 'not ready after set');
    log.marker('set-aaa');
    a.set('aaa');

    t.same(await a.getWhenReady(), 'aaa', 'const cell getWhenReady is correct after set()');
    t.true(a.isReady(), 'ready after await getWhenReady');

    log.expect('cellA->"aaa"');  // unsure if this is before or after getWhenReady

    await log.sleep(52); //--------------------------------------------------

    log.marker('unsub');
    unsub();
    a.set('aaaa');
    // no more onchange events

    await log.sleep(53); //--------------------------------------------------
    t.same(log.logs.indexOf('cellA->"aaaa"'), -1, 'onchange unsub works');
    t.strictSame(log.logs, log.expected, 'logs match');
    t.done();
});

t.test('one fn cell', async (t: any) => {
    let log = new Logger();

    log.marker('init');

    let a = new Cell<string>(async (get) => 'a', 'cellA');
    t.false(a.isReady(), 'not ready at instantiation');
    t.same(a.getNow(), undefined, 'fn cell value is NOT set on instantiation');
    a.onChange(val => {
        t.true(a.isReady(), 'ready in onChange');
        let msg = `${a.id}->${JSON.stringify(val)}`;
        logOnChange(msg);
        log.log(msg);
    });
    // this doesn't ever run in this test since the fn cell never goes from fresh to stale
    a.onStale(() => {
        t.false(a.isReady(), 'fn cell is not ready inside onStale');
        let msg = `${a.id}->stale`;
        logOnChange(msg);
        log.log(msg);
    });

    log.marker('end-main');
    process.nextTick(() => {
        log.marker('nextTick')
        log.expect('cellA->"a"');  // this takes an extra nextTick to run because _fn is async
    });
    await log.sleep(50); //--------------------------------------------------

    t.same(await a.getWhenReady(), 'a', 'fn cell getWhenReady after instantiation');
    t.true(a.isReady(), 'ready after await getWhenReady()');

    await log.sleep(51); //--------------------------------------------------
    t.strictSame(log.logs, log.expected, 'logs match');
    t.done();
});

t.test('one fn cell getWhenReady just after instantiation', async (t: any) => {
    let log = new Logger();

    log.marker('init');

    let a = new Cell<string>(async (get) => 'a', 'cellA');
    t.same(a.getNow(), undefined, 'fn cell value is NOT set on instantiation');
    log.marker('end-main');
    t.same(await a.getWhenReady(), 'a', 'fn cell getWhenReady just after instantiation');
    t.true(a.isReady(), 'ready after await getWhenReady()');

    await log.sleep(51); //--------------------------------------------------
    t.strictSame(log.logs, log.expected, 'logs match');
    t.done();
});

t.only('const --> fn', async (t: any) => {
    let log = new Logger();

    log.marker('init');

    let a = new Cell<string>('a', 'cellA');
    let b = new Cell<string>(async (get) => `${await get(a)}+b`, 'cellB');
    t.false(a.isReady(), 'a not ready at instantiation');
    t.false(b.isReady(), 'b not ready at instantiation');

    t.same(a.getNow(), 'a', 'a start off a');
    t.same(b.getNow(), undefined, 'b starts off undefined');

    a.onChange(val => {
        let msg = `${a.id}->${JSON.stringify(val)}`;
        logOnChange(msg);
        log.log(msg);
    });
    b.onChange(val => {
        let msg = `${b.id}->${JSON.stringify(val)}`;
        logOnChange(msg);
        log.log(msg);
    });
    b.onStale(() => {
        t.false(b.isReady(), 'fn cell is not ready inside onStale');
        let msg = `${b.id}->stale`;
        logOnChange(msg);
        log.log(msg);
    });

    log.marker('end-main');
    log.expect('cellA->"a"');
    process.nextTick(() => {
        log.marker('nextTick')
        log.expect('cellB->"a+b"');
    });
    await log.sleep(51); //--------------------------------------------------

    t.true(a.isReady(), 'a eventually ready');
    t.true(b.isReady(), 'b eventually ready');

    t.same(a.getNow(), 'a', 'a settles on correct value');
    t.same(b.getNow(), 'a+b', 'b settles on correct value');

    await log.sleep(52); //--------------------------------------------------

    t.true(a.isReady(), 'a ready before setting a');
    t.true(b.isReady(), 'b ready before setting a');
    log.marker('set-a=aa');
    a.set('aa');
    log.expect('cellB->stale');
    t.false(a.isReady(), 'a not ready after setting a');
    t.false(b.isReady(), 'b not ready after setting a (staleness propagates instantly)');
    log.marker('set-a=aaa');
    a.set('aaa');
    // should not call b.onStale again, it's already stale
    t.same(a.getNow(), 'aaa', 'a after set');
    t.same(b.getNow(), 'a+b', 'b after set keeps old value while stale');

    log.expect('cellA->"aaa"');
    process.nextTick(() => {
        log.marker('nextTick')
        log.expect('cellB->"aaa+b"');
    });
    await log.sleep(53); //--------------------------------------------------

    t.true(a.isReady(), 'a eventually ready');
    t.true(b.isReady(), 'b eventually ready');

    t.same(a.getNow(), 'aaa', 'a settles on correct value');
    t.same(b.getNow(), 'aaa+b', 'b settles on correct value');

    t.strictSame(log.logs, log.expected, 'logs match');
    t.done();
});

t.test('3 const --> 1 fn', async (t: any) => {
    let log = new Logger();
    log.marker('init');

    let a1 = new Cell<string>('a1', 'cellA1');
    let a2 = new Cell<string>('a2', 'cellA2');
    let a3 = new Cell<string>('a3', 'cellA3');
    let b = new Cell<string>(async (get) => {
        let a1v = await get(a1);
        let a2v = await get(a2);
        let a3v = await get(a3);
        return `${a1v}+${a2v}+${a3v}+b`;
    }, 'cellB');
    t.false(a1.isReady(), 'a1 not ready on start');
    t.false(a2.isReady(), 'a2 not ready on start');
    t.false(a3.isReady(), 'a3 not ready on start');
    t.false(b.isReady(), 'b not ready on start');

    log.marker('end-main');

    t.same(await b.getWhenReady(), 'a1+a2+a3+b', 'b when ready');
    t.same(await a1.getWhenReady(), 'a1', 'a1 when ready');
    t.same(await a2.getWhenReady(), 'a2', 'a2 when ready');
    t.same(await a3.getWhenReady(), 'a3', 'a3 when ready');

    t.true(a1.isReady(), 'a1 ready after await getWhenReady');
    t.true(a2.isReady(), 'a2 ready after await getWhenReady');
    t.true(a3.isReady(), 'a3 ready after await getWhenReady');
    t.true(b.isReady(), 'b ready after await getWhenReady');

    log.marker('set-a1');
    a1.set('aa1');
    t.false(a1.isReady(), 'a1 not ready after set');
    t.false(b.isReady(), 'b not ready after set');
    a1.set('aaa1');
    t.same(await b.getWhenReady(), 'aaa1+a2+a3+b', 'b responds to change in a1');
    t.true(b.isReady(), 'b ready after await getWhenReady');

    a1.set('aaaa1');
    a2.set('aaaa2');
    a3.set('aaaa3');
    t.same(await b.getWhenReady(), 'aaaa1+aaaa2+aaaa3+b', 'b responds to change in a1, a2, and a3');

    log.marker('remove-a3-from-b');
    b.set(async (get) => {
        let a1v = await get(a1);
        let a2v = await get(a2);
        return `${a1v}+${a2v}+b`;
    });
    t.false(b.isReady(), 'b not ready after changing its fn');
    t.same(await b.getWhenReady(), 'aaaa1+aaaa2+b', 'b remove dep on a3; updates itself correctly');
    t.true(b.isReady(), 'b ready after await getWhenReady');

    a2.set('A2');
    t.false(b.isReady(), 'a2 change; b is stale');
    t.same(await b.getWhenReady(), 'aaaa1+A2+b', 'a2 change; b updates');
    t.true(b.isReady(), 'a2 change; b is ready');

    a3.set('A3');
    t.true(b.isReady(), 'a3 change; b is ready (not affected)');
    t.same(await b.getWhenReady(), 'aaaa1+A2+b', 'a3 change; b remains the same');

    t.strictSame(log.logs, log.expected, 'logs match');
    t.done();
});

t.test('2 const --> 2 fn --> 2 fn', async (t: any) => {
    let log = new Logger();
    log.marker('init');

    let a1 = new Cell<string>('a1', 'cellA1');
    let a2 = new Cell<string>('a2', 'cellA2');
    let b1 = new Cell<string>(async (get) => `(b1=${await get(a1)}+${await get(a2)})`, 'cellB1');
    let b2 = new Cell<string>(async (get) => `(b2=${await get(a1)}+${await get(a2)})`, 'cellB2');
    let c1 = new Cell<string>(async (get) => `[c1=${await get(b1)}+${await get(b2)}]`, 'cellC1');
    let c2 = new Cell<string>(async (get) => `[c2=${await get(b1)}+${await get(b2)}]`, 'cellC2');

    c1.onChange(val => {
        t.true(c1.isReady(), 'c1 is ready in onChange');
        let msg = `${c1.id}->${JSON.stringify(val)}`;
        logOnChange(msg);
        log.log(msg);
    });

    log.marker('end-main');

    t.same(await b1.getWhenReady(), '(b1=a1+a2)', 'b1 when ready');
    t.same(await c1.getWhenReady(), '[c1=(b1=a1+a2)+(b2=a1+a2)]', 'c1 when ready');
    t.same(await b2.getWhenReady(), '(b2=a1+a2)', 'b1 when ready');
    t.same(await c2.getWhenReady(), '[c2=(b1=a1+a2)+(b2=a1+a2)]', 'c2 when ready');
    log.expect('cellC1->"[c1=(b1=a1+a2)+(b2=a1+a2)]"');

    log.marker('set:a=a1');
    a1.set('aaaaaaaaaa');
    a1.set('aa1');
    t.same(await b1.getWhenReady(), '(b1=aa1+a2)', 'b1 after change to a1');
    t.same(await c1.getWhenReady(), '[c1=(b1=aa1+a2)+(b2=aa1+a2)]', 'c1 after change to a1');
    t.same(await b2.getWhenReady(), '(b2=aa1+a2)', 'b1 after change to a1');
    t.same(await c2.getWhenReady(), '[c2=(b1=aa1+a2)+(b2=aa1+a2)]', 'c2 after change to a1');
    log.expect('cellC1->"[c1=(b1=aa1+a2)+(b2=aa1+a2)]"');

    // remove link from b1 to a2
    log.marker('remove-b1-to-a2');
    b1.set(async (get) => `(b1=${await get(a1)})`);
    t.same(await b1.getWhenReady(), '(b1=aa1)', 'b1 after removing link from b1 to a2');
    t.same(await c1.getWhenReady(), '[c1=(b1=aa1)+(b2=aa1+a2)]', 'c1 after removing link from b1 to a2');
    t.same(await b2.getWhenReady(), '(b2=aa1+a2)', 'b1 after removing link from b1 to a2');
    t.same(await c2.getWhenReady(), '[c2=(b1=aa1)+(b2=aa1+a2)]', 'c2 after removing link from b1 to a2');
    log.expect('cellC1->"[c1=(b1=aa1)+(b2=aa1+a2)]"');

    log.marker('set:a=aaa1');
    a1.set('aaa1');
    t.same(await b1.getWhenReady(), '(b1=aaa1)', 'b1 after change to a1');
    t.same(await c1.getWhenReady(), '[c1=(b1=aaa1)+(b2=aaa1+a2)]', 'c1 after change to a1');
    t.same(await b2.getWhenReady(), '(b2=aaa1+a2)', 'b1 after change to a1');
    t.same(await c2.getWhenReady(), '[c2=(b1=aaa1)+(b2=aaa1+a2)]', 'c2 after change to a1');
    log.expect('cellC1->"[c1=(b1=aaa1)+(b2=aaa1+a2)]"');

    t.strictSame(log.logs, log.expected, 'logs match');
    t.done();
});

t.test('const -> slow fn -> fast fn', async (t: any) => {
    let log = new Logger();
    log.marker('init');

    // a-->b-->c plus direct link from a-->c
    // b is slow

    let a = new Cell<string>('a', 'cellA');
    let b = new Cell<string>(async (get) => {
        await sleep(50);
        let av = await get(a);
        await sleep(50);
        return `(b=${av})`;
    }, 'cellB');
    let c = new Cell<string>(async (get) => `[c=${await get(a)}+${await get(b)}]`, 'cellC');

    log.marker('end-main');

    t.same(await a.getWhenReady(), 'a', 'a when ready');
    t.same(await b.getWhenReady(), '(b=a)', 'b when ready');
    t.same(await c.getWhenReady(), '[c=a+(b=a)]', 'c when ready');

    a.set('a-dummy');
    a.set('aa');
    t.ok(true, 'a.set("aa")');
    t.same(await a.getWhenReady(), 'aa', 'a after change to a');
    t.same(await b.getWhenReady(), '(b=aa)', 'b after change to a');
    t.same(await c.getWhenReady(), '[c=aa+(b=aa)]', 'c after change to a');

    a.set('a-dummy2');
    a.set('aaa');
    t.ok(true, 'a.set("aaa")');
    t.same(await a.getWhenReady(), 'aaa', 'a after change to a');
    t.same(await c.getWhenReady(), '[c=aaa+(b=aaa)]', 'c after change to a -- value is consistent');
    t.same(await b.getWhenReady(), '(b=aaa)', 'b after change to a');

    await sleep(33);    //----------------------------------------

    t.ok(true, 'start a double wave delayed by 25 ms');
    log.marker('start-wave-1');
    a.set('A');
    await sleep(25);
    log.marker('start-wave-2');
    a.set('AA');

    t.same(await a.getWhenReady(), 'AA', 'a after double wave');
    t.same(await c.getWhenReady(), '[c=AA+(b=AA)]', 'c after double wave');
    t.same(await b.getWhenReady(), '(b=AA)', 'b after double wave');

    await sleep(34);    //----------------------------------------

    t.ok(true, 'start a double wave delayed by 75 ms');
    log.marker('start-wave-1');
    a.set('A2');
    await sleep(75);
    log.marker('start-wave-2');
    a.set('AA2');

    t.same(await a.getWhenReady(), 'AA2', 'a after double wave');
    t.same(await c.getWhenReady(), '[c=AA2+(b=AA2)]', 'c after double wave');
    t.same(await b.getWhenReady(), '(b=AA2)', 'b after double wave');

    await sleep(35);    //----------------------------------------

    t.ok(true, 'start a double wave delayed by 125 ms');
    log.marker('start-wave-1');
    a.set('A3');
    await sleep(125);
    log.marker('start-wave-2');
    a.set('AA3');

    t.same(await a.getWhenReady(), 'AA3', 'a after double wave');
    t.same(await c.getWhenReady(), '[c=AA3+(b=AA3)]', 'c after double wave');
    t.same(await b.getWhenReady(), '(b=AA3)', 'b after double wave');

    await sleep(35);    //----------------------------------------

    t.ok(true, 'start a wave...');
    log.marker('start-wave-1');
    a.set('A');

    await sleep(10);
    t.ok(true, 'disconnect from a and connect to aPrime...');
    let aPrime = new Cell<string>('aPrime', 'cellAPrime');
    b.set(async (get) => {
        await sleep(50);
        let av = await get(aPrime);
        await sleep(50);
        return `(b=${av})`;
    });
    c.set(async (get) => `[c=${await get(aPrime)}+${await get(b)}]`);

    await sleep(10);
    t.ok(true, 'start another wave...');
    log.marker('start-wave-2');
    aPrime.set('aPrime2');

    t.same(await c.getWhenReady(), '[c=aPrime2+(b=aPrime2)]', 'c after double wave');
    t.same(await b.getWhenReady(), '(b=aPrime2)', 'b after double wave');

    await sleep(36);    //----------------------------------------

    t.ok(true, 'start a wave...');
    log.marker('start-wave-1');
    aPrime.set('foo');

    await sleep(10);
    t.ok(true, 'disconnect from aPrime and connect to aDoublePrime...');
    let aDoublePrime = new Cell<string>('aDoublePrime', 'cellADoublePrime');
    b.set(async (get) => {
        await sleep(50);
        let av = await get(aDoublePrime);
        await sleep(50);
        return `(b=${av})`;
    });
    c.set(async (get) => `[c=${await get(aDoublePrime)}+${await get(b)}]`);

    await sleep(75);
    t.ok(true, 'start another wave...');
    log.marker('start-wave-2');
    aDoublePrime.set('aDoublePrime2');

    t.same(await c.getWhenReady(), '[c=aDoublePrime2+(b=aDoublePrime2)]', 'c after double wave');
    t.same(await b.getWhenReady(), '(b=aDoublePrime2)', 'b after double wave');

    await sleep(37);    //----------------------------------------

    t.ok(true, 'start a wave...');
    log.marker('start-wave-1');
    aPrime.set('foo');

    await sleep(10);
    t.ok(true, 'disconnect from aPrime and connect to aDoublePrime...');
    let aTriplePrime = new Cell<string>('aTriplePrime', 'cellATriplePrime');
    b.set(async (get) => {
        await sleep(50);
        let av = await get(aTriplePrime);
        await sleep(50);
        return `(b=${av})`;
    });
    c.set(async (get) => `[c=${await get(aTriplePrime)}+${await get(b)}]`);

    await sleep(125);
    t.ok(true, 'start another wave...');
    log.marker('start-wave-2');
    aTriplePrime.set('aTriplePrime2');

    t.same(await c.getWhenReady(), '[c=aTriplePrime2+(b=aTriplePrime2)]', 'c after double wave');
    t.same(await b.getWhenReady(), '(b=aTriplePrime2)', 'b after double wave');

    t.strictSame(log.logs, log.expected, 'logs match');
    t.done();
});

// TODO: test changing a single cell back and forth between const and fn modes

// TODO: cache prev value and avoid useless updates if nothing changes
