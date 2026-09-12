import { runSequence } from "../src/reproduction.mjs";
import { loadTrigger } from "../src/trigger.mjs";

const trigger = await loadTrigger();
console.log(
  JSON.stringify(await runSequence({ variant: "incident", trigger }), null, 2),
);
