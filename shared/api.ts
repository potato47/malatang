import { defineAPI, z } from "@semicoder/fia/api";
const counter = z.strictObject({ value: z.number().int() });
export default defineAPI({
  methods: {
    "counter.get": { description: "Read the current shared counter.", input: z.strictObject({}), output: counter },
    "counter.increment": { description: "Add an integer to the shared counter.", input: z.strictObject({ by: z.number().int() }), output: counter, examples: [{ input: { by: 1 } }] },
  },
  events: { "counter.changed": { description: "The counter has been saved.", payload: counter } },
});
