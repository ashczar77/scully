import { runSequence } from "../src/reproduction.mjs";

console.log(JSON.stringify(await runSequence(), null, 2));
