import { runSequence } from "../src/reproduction.mjs";

console.log(JSON.stringify(await runSequence({ variant: "incident" }), null, 2));
