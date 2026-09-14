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
