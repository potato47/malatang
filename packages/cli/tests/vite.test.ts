import { expect, test } from "bun:test";
import fia from "../src/vite.ts";
test("proxy mounts match path segments, not similarly named frontend modules",()=>{
 const keys=Object.keys(fia({nativeOrigin:"http://127.0.0.1:1234"}).config().server.proxy);
 const matches=(path:string)=>keys.some(key=>new RegExp(key.slice(1)).test(path));
 expect(matches("/api")).toBe(true);expect(matches("/api/chats")).toBe(true);expect(matches("/api?x=1")).toBe(true);
 expect(matches("/api.ts")).toBe(false);expect(matches("/apiary")).toBe(false);
 expect(matches("/_fia/native")).toBe(true);expect(matches("/_fia.ts")).toBe(false);
 const key=Object.keys(fia({backendMount:"/service.v1"}).config().server.proxy)[1]!;
 expect(new RegExp(key).test("/service.v1/items")).toBe(true);
 expect(new RegExp(key).test("/serviceXv1/items")).toBe(false);
});
