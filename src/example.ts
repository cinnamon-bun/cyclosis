import { Cell } from './cell';

let main = async () => {
    /*
        BUILD A NETWORK OF CELLS

        firstName  lastName
               |    |
               V    V
              fullName
    */

    // make some cells with plain old string values
    // to sit at the top of the network
    let firstName = new Cell<string>('Suzy');
    let lastName = new Cell<string>('Smith');
    // and a function cell that depends on the previous cells
    let fullName = new Cell<string>(async (get) => {
        return `${await get(firstName)} ${await get(lastName)}`;
    });

    // READ THEM
    // subscribe to changes...
    fullName.onChange(val => console.log('fullName onChange:', val));
    // or await a cell to get its value when it settles.
    console.log('fullName is ready:', await fullName.getWhenReady());

    // CHANGE THEM
    // change one of the input cells...
    firstName.set('Suzanne');
    // and its dependents will update.
    console.log('fullName is ready:', await fullName.getWhenReady());
    // and onChange will be called again.
    
    /*
        CHANGE HOW THEY'RE CONNECTED
        let's add a middle name cell.

        firstName  middleName  lastName
                \      |       / 
                 \     |      /  
                  V    V     V
                    fullName
    */
    let middleName = new Cell<string>('Q.');
    // And update the fullName to depend on it also.
    // The new dependency will be detected.
    fullName.set(async (get) => {
        let first = await get(firstName);
        let middle = await get(middleName);
        let last = await get(lastName);
        return `${first} ${middle} ${last}`;
    });
    // wait for the fullName cell to be updated:
    console.log('fullName is ready:', await fullName.getWhenReady());
    // and onChange will also be called again.
}
main();
