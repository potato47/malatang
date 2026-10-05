import { checkHostStyles } from "../packages/sdk/src/style-check";
const diagnostics = checkHostStyles(await Bun.file("frontend/style.css").text());
if (diagnostics.length) throw new Error(diagnostics.join("\n"));
console.log("Host style ownership checked");
