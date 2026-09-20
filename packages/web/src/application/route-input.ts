import type {
    ExtractParamNames,
    InferParams,
    InferQuery,
    ParamSchema,
    QuerySchemaMap,
} from "@finesoft/core";
import type { PageRoute } from "../bootstrap/define-routes";
import type { RouteParams } from "../router/types";

type Simplify<T> = { [K in keyof T]: T[K] };
type OptionalKeys<Path extends string> = {
    [K in ExtractParamNames<Path>]: Path extends `${string}:${K}?` | `${string}:${K}?/${string}`
        ? K
        : never;
}[ExtractParamNames<Path>];
type PathInput<Path extends string> = string extends Path
    ? RouteParams
    : { [K in Exclude<ExtractParamNames<Path>, OptionalKeys<Path>>]: string } & {
          [K in OptionalKeys<Path>]?: string;
      };
type Params<R> = R extends { params?: infer P extends Record<string, ParamSchema> }
    ? R extends { params: unknown }
        ? InferParams<P>
        : {} | InferParams<P>
    : {};
type Query<R> = R extends { query?: infer Q extends QuerySchemaMap }
    ? R extends { query: unknown }
        ? InferQuery<Q>
        : {} | InferQuery<Q>
    : {};
type WithCodecs<Path extends string, P> = P extends unknown
    ? Simplify<Omit<PathInput<Path>, keyof P> & P>
    : never;
type RouteInput<R> = R extends string
    ? { params: Simplify<PathInput<R>>; query: {} }
    : R extends { path: infer Path extends string }
      ? { params: WithCodecs<Path, Params<R>>; query: Query<R> }
      : never;

/** All accepted routes remain a union: a controller must handle every alias. */
export type RouteInputFor<Routes extends readonly (string | PageRoute)[]> =
    Routes extends readonly []
        ? { params: RouteParams; query: RouteParams }
        : RouteInput<Routes[number]>;

/** Reject codec keys that cannot be captured by the corresponding path. */
export type ValidRoutes<Routes extends readonly (string | PageRoute)[]> = {
    [I in keyof Routes]: Routes[I] extends { path: infer Path extends string; params: infer P }
        ? string extends Path
            ? Routes[I]
            : Exclude<keyof P, ExtractParamNames<Path>> extends never
              ? Routes[I]
              : never
        : Routes[I];
};
