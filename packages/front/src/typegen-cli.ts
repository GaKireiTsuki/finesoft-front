#!/usr/bin/env node
import { generateFrontTypes, generateControllerTypes } from "./typegen";
const root = process.argv[2] ?? process.cwd();
generateFrontTypes({ root });
generateControllerTypes({ root });
