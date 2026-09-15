import { lookup } from "node:dns/promises";
import type { DnsLookup } from "@finesoft/core";

/** Uses the OS resolver, including hosts-file entries, matching Node fetch. */
export const nodeDnsLookup: DnsLookup = async (hostname) =>
    (await lookup(hostname, { all: true })).map(({ address }) => address);
