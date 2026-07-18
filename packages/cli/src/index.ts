#!/usr/bin/env bun

import { runCLI } from "./cli.ts";

process.exitCode = await runCLI(process.argv.slice(2));
