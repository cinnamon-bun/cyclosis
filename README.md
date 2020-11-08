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

Function cells can also be directly changed to a new function.  They are allowed to change their dependencies too.

```ts
// fullName will no longer depend on firstName
fullName.set(async (get) => {
    return `Dr. ${await get(lastName)}`;
});
```

Function cells can also be long-running operations like network requests.  If their dependencies change while they're still running, they will be halted and restarted for you.

```ts
let matchingProducts = new Cell(async (get) => {
    let search = await get(searchTermCell);
    return await fetch(`/api/search/${search}`);
});
```

## Consistency

If several input cells are set simultaneously, cells that depend on them will only ever see a consistent combination of their values, even if slow async cells are present in the network:

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

# API

## Constructing cells

New cells always start off Stale, and become Ready after nextTick.  This means if you call `getNow` on them just after constructing them, you'll get `undefined`.

```ts
new Cell<string>("my initial value")
```

Create a new cell that holds a string, with the given initial value.

```ts
new Cell<string>("my initial value")
```

## Reading cells

```ts
cell.getWhenReady() --> Promise<value>
```

Once the cell is Ready, return its value.  If the cell is Ready right now, this will still return a Promise but it will be resolved right away.

```ts
cell.getNow() --> value | undefined
```

Read the cell synchronously.  If the cell is Stale this returns the previous value; if the cell was just instantiated this will return `undefined`.

```ts
cell.isReady() --> boolean
```

Check if a cell is Ready.

```ts
let unsubscribe = cell.onChange((newVal) => {
    // do something here
});
unsubscribe();
```

Subscribe to changes in a cell.

Note that this will be called on the cell's initial value if you subscribe during the same tick that the cell was created.  That's because cells always begin their life Stale and then become Ready in the next tick, triggering their subscribers.

If you subscribe later in a cell's life, the callback will only run when the value actually changes.

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

## Fun fact

Cyclosis is named for the way cytoplasm flows between fungus cells.
