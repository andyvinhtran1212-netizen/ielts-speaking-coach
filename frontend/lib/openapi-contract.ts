import type { paths } from '@/types/api';

export type ApiGetPath = {
  [Path in keyof paths]: paths[Path] extends { get: infer Operation }
    ? [Operation] extends [never] ? never : Path
    : never;
}[keyof paths];

export type ApiPostPath = {
  [Path in keyof paths]: paths[Path] extends { post: infer Operation }
    ? [Operation] extends [never] ? never : Path
    : never;
}[keyof paths];

export type ApiPatchPath = {
  [Path in keyof paths]: paths[Path] extends { patch: infer Operation }
    ? [Operation] extends [never] ? never : Path
    : never;
}[keyof paths];

export type ApiDeletePath = {
  [Path in keyof paths]: paths[Path] extends { delete: infer Operation }
    ? [Operation] extends [never] ? never : Path
    : never;
}[keyof paths];

type Json200<Operation> = Operation extends {
  responses: {
    200: { content: { 'application/json': infer Payload } };
  };
} ? Payload : never;

/** JSON response declared by FastAPI for a successful GET endpoint. */
export type ApiGetJson<Path extends ApiGetPath> = Json200<
  paths[Path] extends { get: infer Operation } ? Operation : never
>;

/** JSON response declared by FastAPI for a successful POST endpoint. */
export type ApiPostJson<Path extends ApiPostPath> = Json200<
  paths[Path] extends { post: infer Operation } ? Operation : never
>;

/** JSON response declared by FastAPI for a successful PATCH endpoint. */
export type ApiPatchJson<Path extends ApiPatchPath> = Json200<
  paths[Path] extends { patch: infer Operation } ? Operation : never
>;

/** JSON body of the first declared success status (200, else 201, else 202). */
type JsonSuccess<Operation> = Operation extends {
  responses: { 200: { content: { 'application/json': infer Payload } } };
} ? Payload : Operation extends {
  responses: { 201: { content: { 'application/json': infer Payload } } };
} ? Payload : Operation extends {
  responses: { 202: { content: { 'application/json': infer Payload } } };
} ? Payload : never;

/** POST response for endpoints that answer 201/202 as well as 200 (Json200 alone gives never). */
export type ApiPostSuccessJson<Path extends ApiPostPath> = JsonSuccess<
  paths[Path] extends { post: infer Operation } ? Operation : never
>;

/** JSON response declared by FastAPI for a successful DELETE endpoint. */
export type ApiDeleteJson<Path extends ApiDeletePath> = JsonSuccess<
  paths[Path] extends { delete: infer Operation } ? Operation : never
>;
