# Cyclosis

A reactive Cell class that can depend on other Cells.  Updates propagate across the network of Cells.

## Full Example

See [example.ts](https://github.com/cinnamon-bun/cyclosis/blob/main/src/example.ts) for a complete demonstration.

## Making a network of cells

Cells can hold either a plain value or a function that computes a value.

```ts
let firstName = new Cell<string>('Suzy');
let lastName = new Cell<string>('Smith');

let fullName = new Cell<string>(async (get) => {
    return `${await get(firstName)} ${await get(lastName)}`;
});
```

Cell functions are automatically re-run whenever the inputs change.  Their dependencies are discovered by running the function and noticing which other cells it reads.

## Changing values

Cells can be Ready or Stale.  When a cell changes, all its dependents instantly become Stale, then slowly become Ready as they finish recomputing.

```ts
firstName.set('Suzanne');
console.log(await fullName.getWhenReady());
```

Function cells can also be directly changed to a new function.  They are allowed to change which cells they depend on.

```ts
// fullName will no longer depend on firstName
fullName.set(async (get) => {
    return `Dr. ${await get(lastName)}`;
});
```

Function cells can also be long-running operations like network requests.  If their dependencies update while they're still running, they will be halted and restarted for you.

```ts
let searchResults = new Cell(async (get) => {
    let search = await get(searchTermCell);
    return await fetch(`/api/search/${search}`);
});
```

So if you quickly change the `searchTermCell` several times, only the last search terms will be reflected in the eventual Ready state of `searchResults`.

## Consistency

If several input cells are set simultaneously, cells that depend on them will only ever see a consistent combination of their values, even if slow async cells are present in the network of cells:

```ts
// make a network that slowly trickles the firstName
// and lastName together, with different delays on each:
let delayedFirstName = new Cell(async (get) => {
    await sleep(50);
    return await get(firstName);
});
let delayedLastName = new Cell(async (get) => {
    await sleep(100);
    return await get(firstName);
});
let delayedFullName = new Cell(async (get) => {
    return `${await get(delayedFirstName)} ${await get(delayedLastName)}`;
});
delayedFullName.onChange(val => console.log(val)):

// Start an update...

firstName.set('Annie');
lastName.set('Apple');

await sleep(75);

// Annie finished, but Apple is still running, and the
// fullName is waiting for them to both be ready.

// That update will be cancelled and replaced by a new one:

firstName.set('Bonnie');
lastName.set('Blueberry');

// give Bonnie and Blueberry time to finish
await sleep(500);

firstName.set('Connie');
lastName.set('Cherry');

// This will output:
//
//     Bonnie Blueberry
//     Connie Cherry
//
// It will never output a mixed combination like "Bonnie Cherry",
// because the first and last names were always set in the same tick.
```

# Timing of callbacks

For a plain value cell:

```
new Cell("hello")
    --- nextTick ---
    cell becomes ready
    onChange callbacks fire
```

For a function cell:

```
new Cell(async (get) => /* function here */);
    --- nextTick ---
    function begins running
    --- nextTick ---
    cell becomes ready
    onChange callbacks fire after nextTick
```

For any kind of cell:

```
foo.set(val)
    foo and its children fire onStale callbacks synchronously with set()
    --- nextTick ---
    function begins running, if this is a function cell
    --- eventually ---
    foo becomes ready
    foo onChange callbacks fire
```

# API

## Constructing cells

```ts
new Cell<string>("my initial value")
```

Create a new cell that holds a string, with the given initial value.

```ts
new Cell<string>(async (get) => {
    return await get(otherCell) + '!!!!';
});
```

Create a new function cell.

New cells always start off Stale, and become Ready after nextTick.  This means if you call `getNow` on them just after constructing them, you'll get `undefined`.

Cells can be given an `id`, a string, as the second argument in their constructor.  This is mostly useful for debugging.

## Reading cells

```ts
cell.getWhenReady() --> Promise<value>
```

Once the cell is Ready, return its value.  If the cell is Ready right now, this will still return a Promise but it will be resolved right away.

```ts
cell.getNow() --> value | undefined
```

Read the cell synchronously.  If the cell is Stale this returns the previous value; if the cell was just instantiated this can return `undefined` since it isn't Ready yet.

```ts
cell.isReady() --> boolean
```

Check if a cell is Ready.

## Events

```ts
let unsubscribe = cell.onChange((newVal) => {
    // do something here
});
unsubscribe();
```

Subscribe to changes in a cell.  The callback will run whenever the cell changes from Stale to Ready.

Note that newly created cells start off Stale and become Ready on nextTick.  So if you create a cell and immediately subscribe to it, the callback will fire on nextTick.  If you subscribe to a cell later after it already exists, the callback won't fire until the cell changes.

```ts
let unsubscribe = cell.onStale(() => {
    // do something here
});
```

Run a callback when a cell becomes stale.

```ts
let unsubscribe = cell.onError(err => {
    // do something here
});
```

Run a callback when a cell's function throws an error.

```ts
let unsubscribe = cell.onDestroy(() => {
    // do something here
});
```

Run a callback when a cell is destroyed.

## Setting values

```ts
cell.set(val or fn)
```

Change the value of a cell.

This always returns instantly.  The function will be run on nextTick.  The cell will become Stale right now and will become Ready again on nextTick.

If you `set` a cell several times in the same tick, only the last value will be used and propagated through the rest of the cells.

```ts
firstName.set('a');  // this will not be used
firstName.set('b');  // only this one will be used
```

## Destroying a cell

```ts
cell.destroy();
```

Destroy a cell.  This removes its connections to other cells, stops its function from running, removes references to its `_value` so it can be garbage collected, removes all callbacks, and calls the `onDestroy` callbacks.

Once a cell has been destroyed it can't be used anymore.  Calling any function will throw a `CellWasDestroyed` error.  Cells that depend on it will get `CellWasDestroyed` errors when trying to read it, and so that will become their error state.

The only thing you can safely do with a destroyed cell is call `destroy()` again (which does nothing) or call `isDestroyed()`.

```ts
cell.isDestroyed() --> boolean
```

Check if a cell is destroyed.

# Errors

If a cell's function throws an error, the cell enters an error state.  Trying to get the value of the cell will instead throw the error.

Cells that depend on an error'd cell will also throw that error.

```ts
// a function cell that always throws an error
let oopsCell = new Cell<string>(async (get) => {
    throw new Error("oops");
});

oopsCell.getNow();  // throws "oops"
await oopsCell.getWhenReady();  // throws "oops"

// errors propagate to other cells.
// make a cell that depends on the error'd cell...
let shout = new Cell<string>(async (get) => {
    // this will throw "oops" when it tries to get(oopsCell)...
    return await get(oopsCell) + '!!!';
});

await shout.getWhenReady();  // throws "oops"

// go back to a normal state
oopsCell.set('hello');
await shout.getWhenReady(); // returns "hello!!!"
```

# Fun fact

Cyclosis is named for the way [the contents of fungus cells flow from cell to cell](https://en.wikipedia.org/wiki/Cytoplasmic_streaming).

